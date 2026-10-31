-- threads-director: сторож пульсу Mac Studio (31.10.2026).
-- Mac (launchd `td heartbeat dreamcar`, кожні 10 хв) пише public.threads_config.td_heartbeat_dreamcar.
-- Ця функція (pg_cron кожні 10 хв) пише в TECH-чат через tg_notify_queue, якщо:
--   mac_silent  — пульсу немає > 40 хв (Mac вимкнений, заснув, launchd або мережа впали);
--   tick_stuck  — пульс є, але td tick не біг > 15 хв (публікація стоїть);
--   no_posts    — 13–23 Київ, не на паузі, не dry_run, а останній пост старший за 5 год (мозок не планує).
-- Повтор не частіше ніж раз на 3 год, «відновилось» — одним повідомленням. Стан: public.ops_alert_state (td_<slug>_<cond>).
-- Чат: threads_config.td_alert_chat (значення задається в БД, не в репо: репо публічне).
-- Відкат: select cron.unschedule('td-heartbeat-check'); drop function public.td_heartbeat_check(text);

create or replace function public.td_heartbeat_check(p_slug text default 'dreamcar')
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_hb record;
  v_beat jsonb;
  v_hour int := extract(hour from now() at time zone 'Europe/Kyiv');
  v_chat text;
  v_age_min int;
  v_tick_min int;
  v_post_min int;
  v_paused boolean;
  v_out text := '';
  c record;
  v_st public.ops_alert_state;
  v_key text;
begin
  select value #>> '{}' into v_chat from public.threads_config where key = 'td_alert_chat';
  if v_chat is null then return 'no td_alert_chat'; end if;
  if v_hour < 8 then return 'night'; end if;  -- 08:00–23:59 Київ

  select value, updated_at into v_hb from public.threads_config where key = 'td_heartbeat_' || p_slug;
  v_beat := coalesce(v_hb.value, '{}'::jsonb);
  v_age_min := floor(extract(epoch from now() - coalesce(v_hb.updated_at, now() - interval '1 day')) / 60);
  v_tick_min := floor(extract(epoch from now() - coalesce((v_beat->>'last_tick')::timestamptz, now() - interval '1 day')) / 60);
  v_post_min := floor(extract(epoch from now() - coalesce((v_beat->>'last_published')::timestamptz, now() - interval '1 day')) / 60);
  v_paused := coalesce((v_beat->>'paused_until')::timestamptz > now(), false);

  for c in
    select * from (values
      ('mac_silent', v_age_min > 40,
       '🔴 <b>Threads ' || p_slug || ': Mac Studio мовчить ' || v_age_min || ' хв</b>' || chr(10) ||
       'Пости, відповіді й браузер стоять. Перевір: Mac увімкнений і в мережі, launchd: launchctl list | grep td.' || p_slug,
       '🟢 <b>Threads ' || p_slug || ': Mac Studio знову на зв''язку</b>'),
      ('tick_stuck', v_age_min <= 40 and v_tick_min > 15,
       '🟠 <b>Threads ' || p_slug || ': публікація стоїть ' || v_tick_min || ' хв</b>' || chr(10) ||
       'Пульс є, а td tick не біг. Лог: ~/Library/Logs/threads-director/' || p_slug || '-tick.err',
       '🟢 <b>Threads ' || p_slug || ': публікація знову йде</b>'),
      ('no_posts', v_age_min <= 40 and v_hour >= 13 and not v_paused and not coalesce((v_beat->>'dry_run')::boolean, false)
                   and v_post_min > 300,
       '🟠 <b>Threads ' || p_slug || ': ' || (v_post_min / 60) || ' год без жодного поста</b>' || chr(10) ||
       'У черзі: ' || coalesce(v_beat->>'queued', '?') || '. Мабуть, не спрацювали задачі «TD ' || p_slug || ': план/тренди» у Claude на Mac Studio.',
       '🟢 <b>Threads ' || p_slug || ': пости знову виходять</b>')
    ) t(cond, bad, msg_bad, msg_ok)
  loop
    v_key := 'td_' || p_slug || '_' || c.cond;
    insert into public.ops_alert_state(key) values (v_key) on conflict do nothing;
    select * into v_st from public.ops_alert_state where key = v_key for update;
    if c.bad then
      if not v_st.firing or v_st.last_sent_at < now() - interval '3 hours' then
        insert into public.tg_notify_queue(chat_id, text, parse_mode, source, status, scheduled_at)
        values (v_chat, c.msg_bad, 'HTML', 'td-heartbeat', 'pending', now());
        update public.ops_alert_state set firing = true, fired_at = case when firing then fired_at else now() end,
          last_sent_at = now() where key = v_key;
        v_out := v_out || c.cond || ':alert ';
      else
        v_out := v_out || c.cond || ':firing ';
      end if;
    elsif v_st.firing then
      insert into public.tg_notify_queue(chat_id, text, parse_mode, source, status, scheduled_at)
      values (v_chat, c.msg_ok || chr(10) || 'Пауза з ' || to_char(v_st.fired_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI') || ' (Київ).',
              'HTML', 'td-heartbeat', 'pending', now());
      update public.ops_alert_state set firing = false, resolved_at = now() where key = v_key;
      v_out := v_out || c.cond || ':resolved ';
    end if;
  end loop;
  return coalesce(nullif(v_out, ''), 'ok') || ' hb=' || v_age_min || 'm tick=' || v_tick_min || 'm post=' || v_post_min || 'm';
end $$;

revoke all on function public.td_heartbeat_check(text) from public, anon, authenticated;

select cron.schedule('td-heartbeat-check', '*/10 * * * *', $$select public.td_heartbeat_check('dreamcar')$$);
