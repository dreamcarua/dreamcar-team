-- 11.11.2026 Черга стиснення: паралельні слоти, watchdog, позиція в черзі і прогрес у картці.
-- • creatives.compress_progress (0–100): воркер пише відсоток енкоду, картка його показує.
-- • claim_compress_jobs: завислу задачу (воркер зник) повертаємо в чергу через 20 хв, а не 25
--   (сам воркер обриває задачу через 15 хв watchdog'ом і ставить її на повтор).
--   Блокування на рівні задачі як і було: FOR UPDATE SKIP LOCKED, одне відео не беруть двічі.
-- • compress_queue_info(ids): статус, позиція в черзі, прогрес для карток бібліотеки.
-- Відкат: 2026-11-11_compress_queue_parallel_rollback.sql (колонка лишається, вона нічого не ламає).

ALTER TABLE public.creatives ADD COLUMN IF NOT EXISTS compress_progress smallint;

CREATE OR REPLACE FUNCTION public.claim_compress_jobs(worker_name text, max_jobs integer DEFAULT 1)
 RETURNS TABLE(id uuid, name text, type text, thumbnail_url text, size_bytes bigint, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A: відновити stuck processing > 20 хв тому (воркер-раннер зник; живий воркер сам обриває задачу на 15 хв)
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
    returning c.id as cid, c.name as cname,
              (c.type)::text as ctype,
              c.thumbnail_url as curl,
              c.size_bytes as csize,
              c.compress_attempts as catt
  )
  select cid, cname, ctype, curl, csize, catt from claimed;
end;
$function$;

CREATE OR REPLACE FUNCTION public.peek_compress_jobs()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

CREATE OR REPLACE FUNCTION public.complete_compress_job(cre_id uuid, out_url text, out_size_bytes bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  update creatives
     set compressed_url        = out_url,
         compressed_size_bytes = out_size_bytes,
         compressed_status     = 'ready',
         compressed_at         = now(),
         compress_started_at   = null,
         compress_progress     = null,
         compress_error        = null
   where id = cre_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fail_compress_job(cre_id uuid, err text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cur_attempts int;
begin
  select compress_attempts into cur_attempts from creatives where id = cre_id;
  if cur_attempts >= 3 then
    update creatives
       set compressed_status   = 'failed',
           compress_error      = err,
           compress_started_at = null,
           compress_progress   = null
     where id = cre_id;
  else
    update creatives
       set compressed_status   = 'pending',
           compress_error      = err,
           compress_started_at = null,
           compress_progress   = null
     where id = cre_id;
  end if;
end;
$function$;

-- Для карток бібліотеки: [{id, s: статус, pos: місце в черзі (лише pending), prog: % (лише processing)}]
CREATE OR REPLACE FUNCTION public.compress_queue_info(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

REVOKE ALL ON FUNCTION public.compress_queue_info(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.compress_queue_info(uuid[]) TO authenticated, service_role;
