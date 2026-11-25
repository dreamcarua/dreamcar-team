-- 25.11.2026 · Security hardening after the external scan of 21-24.11.2026
-- Audit IDs: SB-01 (Telegram bind without proof), SB-03 (bank tokens readable from the browser),
-- SB-04 (SECURITY DEFINER view bypasses RLS), SB-05 (deactivated staff keep access).
-- Rollback: see the block at the end of this file.

-- SB-01 · one-time Telegram bind tokens ------------------------------------------------
create table if not exists public.tg_bind_tokens (
  token      text primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 minutes',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
alter table public.tg_bind_tokens enable row level security;
revoke all on public.tg_bind_tokens from anon, authenticated;

create or replace function public.create_tg_bind_token()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_uid uuid := public.current_user_id();  -- active users only
  v_tok text;
begin
  if v_uid is null then
    raise exception 'not an active HQ user' using errcode = '42501';
  end if;
  delete from public.tg_bind_tokens
   where user_id = v_uid and (used_at is not null or expires_at < now());
  v_tok := replace(gen_random_uuid()::text, '-', '');
  insert into public.tg_bind_tokens(token, user_id) values (v_tok, v_uid);
  return v_tok;
end $$;
revoke all on function public.create_tg_bind_token() from public, anon;
grant execute on function public.create_tg_bind_token() to authenticated;

-- SB-03 · bank tokens: browser sees only the last 4 characters --------------------------
alter table public.kasa_bank_creds
  add column if not exists token_last4 text generated always as (right(token, 4)) stored;
revoke select on public.kasa_bank_creds from authenticated;
grant select (id, bank, label, privat_id, is_active, synced_from, last_inc, last_status,
              created_at, owner_name, token_last4)
  on public.kasa_bank_creds to authenticated;
-- INSERT / UPDATE / DELETE stay as they were (RLS kasa_is_allowed); edge functions use service_role.

-- SB-04 · the view runs with the caller's rights, so RLS of dashboard_deals applies -----
alter view public.ad_daily_real set (security_invoker = true);

-- SB-05 · deactivated staff: ban the auth account and drop their sessions ---------------
update auth.users a
   set banned_until = 'infinity'
  from public.users u
 where u.auth_id = a.id and u.is_active = false
   and (a.banned_until is null or a.banned_until < 'infinity');
delete from auth.refresh_tokens r
 using public.users u
 where u.is_active = false and r.user_id::uuid = u.auth_id;
delete from auth.sessions s
 using public.users u
 where u.is_active = false and s.user_id = u.auth_id;

-- Rollback (manual):
-- drop function public.create_tg_bind_token(); drop table public.tg_bind_tokens;
-- grant select on public.kasa_bank_creds to authenticated; alter table public.kasa_bank_creds drop column token_last4;
-- alter view public.ad_daily_real reset (security_invoker);
-- update auth.users set banned_until = null where id in (<auth ids of the two deactivated members>);

-- Part B (applied 25.11.2026): DB-level guard so the old tg-webhook (hq_<users.id>) cannot bind
-- before this branch is deployed. A service_role bind needs a token claimed in the last 5 minutes.
create or replace function public.users_guard_tg_bind()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $$
begin
  if new.tg_chat_id is not null and new.tg_chat_id is distinct from old.tg_chat_id
     and coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role'
     and not exists (select 1 from public.tg_bind_tokens t
                      where t.user_id = new.id and t.used_at > now() - interval '5 minutes') then
    raise exception 'Привʼязка Telegram лише через одноразове посилання з HQ' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists users_guard_tg_bind on public.users;
create trigger users_guard_tg_bind before update of tg_chat_id on public.users
  for each row execute function public.users_guard_tg_bind();
-- Rollback B: drop trigger users_guard_tg_bind on public.users; drop function public.users_guard_tg_bind();

-- Part C (applied 25.11.2026, after the kasa page stopped reading `token`, dreamcar-dashboard PR #7):
revoke select on public.kasa_bank_creds from authenticated, anon;
grant select (id, bank, label, privat_id, is_active, synced_from, last_inc, last_status, created_at, owner_name, token_last4)
  on public.kasa_bank_creds to authenticated;
-- Rollback C: grant select on public.kasa_bank_creds to authenticated;
