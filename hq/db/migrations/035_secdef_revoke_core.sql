-- 035_secdef_revoke_core.sql — застосування 032 (частина: лише 50 DreamCar-core).
-- Least-privilege: REVOKE EXECUTE FROM authenticated на worker/queue/notify/cron/trigger
-- SECDEF-функціях, які НЕ кличе браузерний фронт. Тригери спрацьовують із table-privs
-- (не EXECUTE), cron/воркери — service_role, тож REVOKE їх не зачіпає.
--
-- ВІДМІННОСТІ від підготовленого 032:
--  * publications_trash() — ВИКЛЮЧЕНО з REVOKE: фронт HQ кличе rpc('publications_trash')
--    (перевірено гребом dashboard+hq). Залишаємо authenticated EXECUTE.
--  * 117 health_*/hi_* (DayWeft) — ВІДКЛАДЕНО: інший проєкт, потрібен власний смоук DayWeft.
--  * 4 UNCERTAIN (fail_compress_job, retry_compress_all_failed, ghost_calendar_events,
--    kasa_stale_accounts) — не чіпаємо (fail_compress_job та ghost_calendar_events фронт кличе).
-- Відкат: GRANT EXECUTE ON FUNCTION ... TO authenticated.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.check_project_alias_collision() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.detect_silent_upload_failures(p_max_age_hours integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.detect_stuck_tasks() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_team_task_notification(p_recipient uuid, p_task uuid, p_kind team_task_notify_kind, p_payload jsonb, p_comment uuid, p_dedupe text, p_channels team_task_notify_channel[]) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.find_similar_open_task(p_task_id uuid, p_title text, p_threshold real) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.find_unmapped_projects(p_days integer, p_min_deals integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_cron_repeating_failures(p_threshold integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.hq_note_votes_after_change() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.hq_notes_notify() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.inv_set_updated_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.kasa_preserve_marks() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.kasa_try_reanchor() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_team_task_notification_done(p_id uuid, p_channel team_task_notify_channel, p_ok boolean, p_error text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.peek_compress_jobs() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.pick_bank_replies(n integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publication_approved_to_task() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publication_auto_close_team_task() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publication_to_task_on_rework() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publications_check_platforms_before_status() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publications_notify_with_dedup() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.publications_soft_delete_guard() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_dashboard_projects_stats() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_materialized_view_concurrent(p_mv text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_materialized_view_simple(p_mv text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_mv_dashboard_filter_options() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_mv_dashboard_project_pnl() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.reset_approver_rows_on_rework() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.retention_messages_notify() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.schedule_publication_verify(p_pub_id uuid, p_publish_at timestamp with time zone) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.smm_today_schedule() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_dashboard_project_status() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.tasks_trash() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.team_task_comments_notify_trigger() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.team_tasks_auto_verify_trigger() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.team_tasks_notify() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.team_tasks_notify_trigger() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.team_tasks_soft_delete_guard() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_autopost_instant_fire() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_button_clicks_aggregate(p_pub_id uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_proposed_tasks_expire() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_creatives_scope_retention() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_creatives_scope_smm() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_dc_media_archive_publication() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_dispatch_compress_on_video() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_pub_platforms_reschedule_verify() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_publications_schedule_verify() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_publications_schedule_verify_for(p_id uuid, p_status text, p_publish_at timestamp with time zone, p_deleted_at timestamp with time zone, p_verified_at timestamp with time zone) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_publications_unschedule_verify() FROM authenticated;

COMMIT;
