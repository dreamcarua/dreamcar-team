-- 063_064: застосовано в прод 10.10.2026 через Supabase MCP (запис для історії).

-- 063 ad_events.reveal_at за замовчуванням = початок доби (00:00 Київ) дня старту події.
-- Рішення Вадима 10.10.2026: «з початку доби кожного разу, якщо в цей день є подарунок».
create or replace function public.ad_events_reveal_default()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.reveal_at is null and new.starts_at is not null then
    new.reveal_at := ((new.starts_at at time zone 'Europe/Kyiv')::date)::timestamp at time zone 'Europe/Kyiv';
  end if;
  return new;
end $$;
revoke all on function public.ad_events_reveal_default() from public, anon, authenticated;
create or replace trigger ad_events_reveal_default
  before insert or update of starts_at, reveal_at on public.ad_events
  for each row execute function public.ad_events_reveal_default();
update public.ad_events
   set reveal_at = ((starts_at at time zone 'Europe/Kyiv')::date)::timestamp at time zone 'Europe/Kyiv'
 where reveal_at is null and starts_at is not null and starts_at > now() - interval '30 days';

-- 064 ротація токена інжесту health 9d8f (світився в публічному репо).
-- Нові токени (значення НЕ в git):
--   health.ingest_tokens label 'apple-health-auto-export-2026-10'  -> застосунок Health Auto Export
--   health.ingest_tokens label 'health-bots-internal'              -> копія в public.app_secrets key 'health_bot_ing_token'
-- Edge health-tg-webhook v71, health-intake v17, health-food-analyze v20 читають токен з app_secrets (top-level await), а не з коду.
create or replace function public.health_retire_old_ingest_token()
returns text language plpgsql security definer set search_path = public, health, pg_temp as $$
begin
  if exists (select 1 from health.ingest_tokens where label='apple-health-auto-export-2026-10' and last_used is not null) then
    update health.ingest_tokens set active=false where label='apple-health-auto-export' and active;
    perform cron.unschedule('health-retire-old-ingest-token');
    insert into public.tg_notify_queue(chat_id, text, source)
      values (-1003571717453, '🔐 Health: старий токен інжесту 9d8f вимкнено, Auto Export працює на новому.', 'health-token-rotation');
    return 'retired';
  end if;
  return 'waiting';
end $$;
revoke all on function public.health_retire_old_ingest_token() from public, anon, authenticated;
select cron.schedule('health-retire-old-ingest-token', '*/10 * * * *', 'select public.health_retire_old_ingest_token()');
