-- =====================================================================
-- Migration 005 — Cleanup crons
-- =====================================================================
-- pg_cron має бути увімкнено (Database → Extensions → pg_cron).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cleanup expired editing_sessions (щохвилини)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'hq-cleanup-editing-sessions') then
    perform cron.unschedule('hq-cleanup-editing-sessions');
  end if;
end $$;

select cron.schedule(
  'hq-cleanup-editing-sessions',
  '* * * * *',  -- щохвилини
  $$
  delete from public.editing_sessions
  where expires_at < now();
  $$
);

-- ---------------------------------------------------------------------
-- 2. Hard-delete soft-deleted publications (старше 30 днів) — щодоби о 03:00 UTC
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'hq-cleanup-trashed-publications') then
    perform cron.unschedule('hq-cleanup-trashed-publications');
  end if;
end $$;

select cron.schedule(
  'hq-cleanup-trashed-publications',
  '0 3 * * *',  -- 03:00 UTC щодоби
  $$
  delete from public.publications
  where deleted_at is not null
    and deleted_at < now() - interval '30 days';
  $$
);

-- ---------------------------------------------------------------------
-- 3. Перевірка
-- ---------------------------------------------------------------------
-- select * from cron.job order by jobname;
-- select * from cron.job_run_details order by start_time desc limit 10;
