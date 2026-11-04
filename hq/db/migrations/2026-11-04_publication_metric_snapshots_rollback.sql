-- Rollback 2026-11-04_publication_metric_snapshots.sql: знімає воркер і таблицю знімків. Картки не зачіпає.
SELECT cron.unschedule('publication-report-10min');
DROP TABLE IF EXISTS public.publication_metric_snapshots;
