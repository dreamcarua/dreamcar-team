-- 04.11.2026: сире повідомлення Telegram у задачі owner-dm (щоб передати файли запиту у відділ креативів)
-- і посилання на створений запит creative_requests. Уже накочено через Supabase MCP.
-- Rollback: ALTER TABLE public.owner_dm_jobs DROP COLUMN raw_message, DROP COLUMN creative_request_id;
ALTER TABLE public.owner_dm_jobs ADD COLUMN IF NOT EXISTS raw_message jsonb, ADD COLUMN IF NOT EXISTS creative_request_id bigint;
