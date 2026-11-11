-- Відкат 2026-11-11_compress_queue_parallel.sql: визначення функцій черги, зняті з проду 11.11.2026 до змін.
-- Колонка creatives.compress_progress лишається (не заважає старому коду).

CREATE OR REPLACE FUNCTION public.claim_compress_jobs(worker_name text, max_jobs integer DEFAULT 1)
 RETURNS TABLE(id uuid, name text, type text, thumbnail_url text, size_bytes bigint, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- A: відновити stuck processing > 25 хв тому
  update creatives
     set compressed_status   = 'pending',
         compress_error      = coalesce(compress_error,'') || ' [auto-recovered stuck]',
         compress_started_at = null
   where compressed_status = 'processing'
     and compress_started_at is not null
     and compress_started_at < now() - interval '25 minutes';

  return query
  with claimed as (
    update creatives c
       set compressed_status   = 'processing',
           -- FIX: НЕ перезаписуємо compress_error worker_name'ом
           --   Якщо це retry після помилки — стара помилка лишається у history (через trigger),
           --   а compress_error очищується щоб не дублювати після успіху.
           compress_error      = null,
           compress_started_at = now(),
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
$function$
;

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
         compress_error        = null
   where id = cre_id;
end;
$function$
;

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
           compress_started_at = null
     where id = cre_id;
  else
    update creatives
       set compressed_status   = 'pending',
           compress_error      = err,
           compress_started_at = null
     where id = cre_id;
  end if;
end;
$function$
;

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
           and c.compress_started_at < now() - interval '25 minutes')
     );
$function$
;

DROP FUNCTION IF EXISTS public.compress_queue_info(uuid[]);
