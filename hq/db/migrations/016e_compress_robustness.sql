-- ============================================================
-- Migration 016e — robustness fixes for compress pipeline
-- ============================================================
-- Виявлено під час test-pipeline E2E:
--   1. Воркер міг померти між claim і complete → row застрягав у 'processing' назавжди
--   2. Не було лічильника спроб → нескінченний retry на bad input
--   3. CREATE OR REPLACE з зміненим RETURNS TABLE — fail. Треба DROP first.

-- 1. Лічильник спроб + дедлайн на ту саму job
alter table creatives
  add column if not exists compress_attempts int not null default 0,
  add column if not exists compress_started_at timestamptz;

create index if not exists idx_creatives_compress_processing
  on creatives (compressed_status, compress_started_at)
  where compressed_status = 'processing';

-- 2. DROP старих функцій (RETURNS TABLE структура змінилась)
drop function if exists public.claim_compress_jobs(text, int);
drop function if exists public.fail_compress_job(uuid, text);
drop function if exists public.complete_compress_job(uuid, text, bigint);

-- 3. Покращений claim з auto-recovery stuck rows
--    Будь-який row у 'processing' > 25 хв тому — мертвий, повертаємо у 'pending'
create function public.claim_compress_jobs(worker_name text, max_jobs int default 1)
returns table(id uuid, name text, type text, thumbnail_url text, size_bytes bigint, attempts int)
language plpgsql security definer
as $$
begin
  -- A: відновити stuck processing > 25 хв тому
  update creatives
     set compressed_status   = 'pending',
         compress_error      = coalesce(compress_error,'') || ' [auto-recovered stuck]',
         compress_started_at = null
   where compressed_status = 'processing'
     and compress_started_at is not null
     and compress_started_at < now() - interval '25 minutes';

  -- B: claim до max_jobs з pending (attempts < 3)
  return query
  with claimed as (
    update creatives c
       set compressed_status   = 'processing',
           compress_error      = worker_name,
           compress_started_at = now(),
           compress_attempts   = c.compress_attempts + 1
     where c.id in (
       select c2.id from creatives c2
        where c2.compressed_status = 'pending'
          and c2.type = 'video'
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
$$;

-- 4. fail — статус 'failed' тільки на 3-й спробі, інакше повертаємо у 'pending'
create function public.fail_compress_job(cre_id uuid, err text)
returns void
language plpgsql security definer
as $$
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
$$;

-- 5. complete — зануляємо started_at
create function public.complete_compress_job(
  cre_id uuid,
  out_url text,
  out_size_bytes bigint
)
returns void
language plpgsql security definer
as $$
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
$$;

-- 6. One-shot recovery
update creatives
   set compressed_status = 'pending',
       compress_started_at = null,
       compress_attempts = 0
 where compressed_status = 'processing';

update creatives
   set compressed_status = 'pending',
       compress_started_at = null,
       compress_attempts = 0,
       compress_error = null
 where compressed_status = 'failed'
   and (compress_attempts is null or compress_attempts < 3);

-- 7. Grants
grant execute on function public.claim_compress_jobs(text, int) to service_role;
grant execute on function public.complete_compress_job(uuid, text, bigint) to service_role;
grant execute on function public.fail_compress_job(uuid, text) to service_role;
