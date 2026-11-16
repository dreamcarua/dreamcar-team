-- 16.11.2026 · відхилені після вибору учасники (✗ видаляє спробу з журналу, а учасника — з наступних спроб)
alter table public.comment_pools add column if not exists skipped jsonb not null default '[]'::jsonb;
