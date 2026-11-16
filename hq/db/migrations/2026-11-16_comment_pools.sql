-- 16.11.2026 · Пули учасників з коментарів Instagram-поста (team.dreamcar.ua/comments/)
-- Пише і читає лише Edge Function `comment-pool` (service role). RLS увімкнено без політик:
-- anon / authenticated доступу напряму не мають.
create table if not exists public.comment_pools (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  created_by_name text,
  url           text not null,
  shortcode     text not null,
  media_id      text,
  title         text not null default '',
  config        jsonb not null default '{}'::jsonb,
  status        text not null default 'queued' check (status in ('queued','fetching','ready','error')),
  error         text,
  fetched_at    timestamptz,
  post          jsonb not null default '{}'::jsonb,
  rows          jsonb not null default '[]'::jsonb,
  draws         jsonb not null default '[]'::jsonb,
  deleted_at    timestamptz
);
create index if not exists comment_pools_created_idx on public.comment_pools (created_at desc) where deleted_at is null;
alter table public.comment_pools enable row level security;
revoke all on public.comment_pools from anon, authenticated;
comment on table public.comment_pools is 'Пули учасників за коментарями IG-поста; доступ лише через edge comment-pool';
