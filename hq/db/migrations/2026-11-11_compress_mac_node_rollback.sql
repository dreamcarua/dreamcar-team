-- Відкат 2026-11-11_compress_mac_node.sql: прод-визначення станом на 11.11.2026 22:20.
DROP FUNCTION IF EXISTS public.claim_compress_jobs(text, integer, text);
CREATE OR REPLACE FUNCTION public.claim_compress_jobs(worker_name text, max_jobs integer DEFAULT 1)
 RETURNS TABLE(id uuid, name text, type text, thumbnail_url text, size_bytes bigint, attempts integer)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
begin
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
          and c2.thumbnail_url is not null
          and c2.deleted_at is null
          and c2.compress_attempts < 3
        order by c2.uploaded_at asc nulls last
        limit max_jobs
        for update skip locked
     )
    returning c.id as cid, c.name as cname, (c.type)::text as ctype, c.thumbnail_url as curl,
              c.size_bytes as csize, c.compress_attempts as catt
  )
  select cid, cname, ctype, curl, csize, catt from claimed;
end;
$function$;

DROP FUNCTION IF EXISTS public.peek_compress_jobs(text);
CREATE OR REPLACE FUNCTION public.peek_compress_jobs()
 RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
  select count(*)::int from creatives c
   where c.type in ('video','photo')
     and c.thumbnail_url is not null
     and c.deleted_at is null
     and c.compress_attempts < 3
     and (
       c.compressed_status = 'pending'
       or (c.compressed_status = 'processing'
           and c.compress_started_at is not null
           and c.compress_started_at < now() - interval '20 minutes')
     );
$function$;

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
         and c.thumbnail_url is not null
         and c.deleted_at is null
         and c.compress_attempts < 3
    )
    select jsonb_agg(jsonb_build_object('id', c.id, 's', c.compressed_status, 'pos', q.pos,
             'prog', case when c.compressed_status = 'processing' then c.compress_progress end))
      from public.creatives c left join q on q.id = c.id
     where c.id = any(p_ids[1:300])
  ), '[]'::jsonb);
end $function$;

DELETE FROM public.app_secrets WHERE key = 'compress_node_secret_sha256';
-- На Mac Studio: launchctl bootout gui/$(id -u)/ua.dreamcar.compress-node
