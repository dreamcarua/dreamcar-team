-- 11.11.2026 · Mac Studio як основний вузол стиснення відео (compress-node)
--
-- 1. claim_compress_jobs отримує p_type: Mac бере лише відео (фото лишаються GitHub-воркеру з ImageMagick).
--    Стара 2-аргументна версія видаляється, інакше PostgREST не розрізнить виклики.
-- 2. Джерело = coalesce(thumbnail_url, compressed_url): фінали креатив-столу (cd-publish) не мають
--    thumbnail_url і висіли «у черзі» назавжди (range-rover-vidverta-rozmova-tg.mp4, з 11.11 18:51).
-- 3. peek / compress_queue_info — ті самі критерії, щоб черга в картці збігалась із воркером.
-- Відкат: 2026-11-11_compress_mac_node_rollback.sql

DROP FUNCTION IF EXISTS public.claim_compress_jobs(text, integer);

CREATE OR REPLACE FUNCTION public.claim_compress_jobs(worker_name text, max_jobs integer DEFAULT 1, p_type text DEFAULT NULL)
 RETURNS TABLE(id uuid, name text, type text, thumbnail_url text, size_bytes bigint, attempts integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A: відновити stuck processing > 20 хв тому (воркер зник; живий воркер сам обриває задачу на 15 хв)
  update creatives
     set compressed_status   = 'pending',
         compress_error      = coalesce(compress_error,'') || ' [auto-recovered stuck]',
         compress_started_at = null,
         compress_progress   = null
   where compressed_status = 'processing'
     and compress_started_at is not null
     and compress_started_at < now() - interval '20 minutes';

  return query
  with claimed as (
    update creatives c
       set compressed_status   = 'processing',
           compress_error      = null,
           compress_started_at = now(),
           compress_progress   = 0,
           compress_attempts   = c.compress_attempts + 1
     where c.id in (
       select c2.id from creatives c2
        where c2.compressed_status = 'pending'
          and c2.type in ('video','photo')
          and (p_type is null or c2.type::text = p_type)
          and coalesce(c2.thumbnail_url, c2.compressed_url) is not null
          and c2.deleted_at is null
          and c2.compress_attempts < 3
        order by c2.uploaded_at asc nulls last
        limit max_jobs
        for update skip locked
     )
    returning c.id as cid, c.name as cname,
              (c.type)::text as ctype,
              coalesce(c.thumbnail_url, c.compressed_url) as curl,
              c.size_bytes as csize,
              c.compress_attempts as catt
  )
  select cid, cname, ctype, curl, csize, catt from claimed;
end;
$function$;
REVOKE ALL ON FUNCTION public.claim_compress_jobs(text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_compress_jobs(text, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.peek_compress_jobs(p_type text DEFAULT NULL)
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  select count(*)::int from creatives c
   where c.type in ('video','photo')
     and (p_type is null or c.type::text = p_type)
     and coalesce(c.thumbnail_url, c.compressed_url) is not null
     and c.deleted_at is null
     and c.compress_attempts < 3
     and (
       c.compressed_status = 'pending'
       or (c.compressed_status = 'processing'
           and c.compress_started_at is not null
           and c.compress_started_at < now() - interval '20 minutes')
     );
$function$;
DROP FUNCTION IF EXISTS public.peek_compress_jobs();
REVOKE ALL ON FUNCTION public.peek_compress_jobs(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peek_compress_jobs(text) TO service_role;

CREATE OR REPLACE FUNCTION public.compress_queue_info(p_ids uuid[])
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid uuid := public.current_user_id();
begin
  if v_uid is null or not exists (select 1 from public.users u where u.id = v_uid) then
    raise exception 'Немає доступу' using errcode = '42501';
  end if;
  return coalesce((
    with q as (
      select c.id, row_number() over (order by c.uploaded_at asc nulls last, c.id) as pos
        from public.creatives c
       where c.compressed_status = 'pending'
         and c.type in ('video','photo')
         and coalesce(c.thumbnail_url, c.compressed_url) is not null
         and c.deleted_at is null
         and c.compress_attempts < 3
    )
    select jsonb_agg(jsonb_build_object(
             'id', c.id,
             's', c.compressed_status,
             'pos', q.pos,
             'prog', case when c.compressed_status = 'processing' then c.compress_progress end))
      from public.creatives c
      left join q on q.id = c.id
     where c.id = any(p_ids[1:300])
  ), '[]'::jsonb);
end $function$;

-- Токен вузла: у app_secrets лише sha256 (сам токен — у Keychain Mac Studio, compress-node-token).
-- Значення хеша вставляється окремо, не в цьому файлі.
