-- 041_team_plan_digest.sql — ранковий план проєкту в робочі чати команди (08.10.2026).
-- Застосовано через Supabase MCP частинами 041, 042, 042b. Замінює DM «Календар реклами» з ad_watchdog
-- (dreamcar-dashboard, CALENDAR_DM=1 повертає старий DM).
-- Чати: tg_listening_chats.team_digest=true. Хто живий і як називається — перевіряє edge-функція
-- tg-chat-audit (getChat, лише читання). Надсилання — через tg_notify_queue → tg-notify-queue-flush.

alter table public.tg_listening_chats
  add column if not exists team_digest boolean not null default false,
  add column if not exists tg_alive boolean,
  add column if not exists tg_type text,
  add column if not exists tg_members integer,
  add column if not exists tg_checked_at timestamptz,
  add column if not exists tg_real_title text,
  add column if not exists tg_error text;

-- Після запуску tg-chat-audit (08.10.2026): справжні назви старих записів і вибір чатів для плану.
update public.tg_listening_chats set chat_title = tg_real_title || case when tg_type = 'group' and tg_members is null then ' (стара група до supergroup)' else '' end
 where chat_title ~ '^Group [0-9]+$' and tg_real_title is not null;
update public.tg_listening_chats set team_digest = true
 where tg_alive and tg_type = 'supergroup' and tg_real_title in ('DreamCar BOARD','DreamCar SMM','DreamCar TECH','DreamCar LTV RETENTION');

create or replace function public.general_tg_esc(s text) returns text language sql immutable as $$
  select replace(replace(replace(coalesce(s,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

create or replace function public.general_team_digest_text(p_today date default (now() at time zone 'Europe/Kyiv')::date)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  l record; e record; b record; v_out text := ''; v_block text; v_day date; v_lbl text; v_any boolean;
  v_ch text; v_n int; v_total int; v_left interval; v_mails text[];
  aud jsonb := '{"all":"Загальна","retention":"Ретеншн","fortunatos":"Fortunatos"}';
  chn jsonb := '{"viber":"Viber","bot":"Бот","tg":"Бот","email":"Email","push":"Push","sms":"SMS"}';
begin
  for l in select * from public.launches
           where kind = 'raffle' and is_active and starts_on is not null
             and status not in ('idea','completed','archived')
             and p_today between starts_on - 1 and coalesce((live_at at time zone 'Europe/Kyiv')::date, ends_on, starts_on)
           order by starts_on
  loop
    v_total := coalesce(l.ends_on, l.starts_on) - l.starts_on + 1;
    v_n := p_today - l.starts_on + 1;
    v_block := '🗓 <b>План проєкту' || coalesce(' · #' || l.cycle_no, '') || ' · ' || general_tg_esc(l.name) || '</b>';
    if v_n between 1 and v_total then
      v_block := v_block || E'\nДень ' || v_n || ' з ' || v_total;
      if l.stop_at is not null and l.stop_at > now() then
        v_left := l.stop_at - now();
        v_block := v_block || ' · до STOP ' || case when extract(day from v_left) >= 1
          then extract(day from v_left)::int || ' д ' || extract(hour from v_left)::int || ' год'
          else extract(hour from v_left)::int || ' год ' || extract(minute from v_left)::int || ' хв' end
          || ' (' || to_char(l.stop_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI') || ')';
      end if;
    elsif v_n < 1 then
      v_block := v_block || E'\nСтарт завтра' || coalesce(' о ' || to_char(l.starts_at at time zone 'Europe/Kyiv', 'HH24:MI'), '');
    else
      v_block := v_block || E'\nЗбір завершено' || coalesce(' · ефір ' || to_char(l.live_at at time zone 'Europe/Kyiv', 'DD.MM HH24:MI'), '');
    end if;

    foreach v_day in array array[p_today, p_today + 1] loop
      continue when v_day < l.starts_on or v_day > coalesce((l.live_at at time zone 'Europe/Kyiv')::date, l.ends_on, l.starts_on);
      v_lbl := case when v_day = p_today then 'Сьогодні' else 'Завтра' end;
      v_block := v_block || E'\n\n<b>' || v_lbl || ' ' || to_char(v_day, 'DD.MM') || '</b>';
      v_any := false; v_mails := '{}';
      for e in select * from public.ad_events
               where launch_id = l.id and status <> 'cancelled'
                 and v_day between plan_day and coalesce((ends_at at time zone 'Europe/Kyiv')::date, plan_day)
               order by audience = 'all' desc, starts_at
      loop
        v_any := true;
        v_block := v_block || E'\n• ' || (aud->>e.audience) || coalesce(' ' || upper(e.segment), '') || ' · '
          || case when e.kind = 'live' or (e.starts_at at time zone 'Europe/Kyiv')::time <> '00:00'
                  then case when (e.starts_at at time zone 'Europe/Kyiv')::date = v_day then to_char(e.starts_at at time zone 'Europe/Kyiv', 'HH24:MI') || ' · ' else '' end
                  else '' end
          || general_tg_esc(e.title)
          || coalesce(' · ' || nullif(general_tg_esc(e.conditions), ''), '')
          || coalesce(' · ліміт ' || e.limit_qty, '');
        select string_agg(coalesce(chn->>(c->>'ch'), c->>'ch') || coalesce(' ' || (c->>'at'), ''), ', ') into v_ch
          from jsonb_array_elements(e.channels) c
          where c->>'note' is null or c->>'note' like to_char(v_day, 'DD.MM') || '%' or c->>'note' !~ '^\d\d\.\d\d';
        if v_ch is not null then v_mails := v_mails || v_ch; end if;
      end loop;
      if not v_any then
        select string_agg((aud->>dm.audience) || ': ' || case when dm.state = 'tbd' then 'акцію ще не обрано' || coalesce(' (' || general_tg_esc(dm.note) || ')', '') else 'без акцій' end, '; ')
          into v_ch from public.launch_day_marks dm
          where dm.launch_id = l.id and dm.day = v_day and dm.removed_at is null and dm.audience <> 'fortunatos';
        v_block := v_block || E'\n• ' || coalesce(v_ch, 'план на цей день ще не заповнено');
      else
        select string_agg('⏳ ' || (aud->>dm.audience) || ': акцію ще не обрано', '; ') into v_ch
          from public.launch_day_marks dm where dm.launch_id = l.id and dm.day = v_day and dm.state = 'tbd' and dm.removed_at is null;
        if v_ch is not null then v_block := v_block || E'\n• ' || v_ch; end if;
      end if;
      if array_length(v_mails, 1) > 0 then
        v_block := v_block || E'\nРозсилки: ' || general_tg_esc(array_to_string(v_mails, '; '));
      end if;
      select * into b from public.launch_banners where launch_id = l.id and removed_at is null and v_day between from_day and to_day limit 1;
      if found then
        v_block := v_block || E'\nШапка: ' || case when b.text is null then 'тексту ще немає' else '«' || general_tg_esc(left(b.text, 140)) || '»' end
          || case b.status when 'pending' then ' (очікує погодження)' when 'approved' then '' else ' (на сайті)' end;
      end if;
    end loop;
    v_block := v_block || E'\n\n<a href="https://team.dreamcar.ua/projects/#project/' || l.id || '">Відкрити план проєкту</a>';
    v_out := v_out || case when v_out = '' then '' else E'\n\n———\n\n' end || v_block;
  end loop;
  return nullif(v_out, '');
end $$;
revoke all on function public.general_team_digest_text(date) from public, anon, authenticated;

-- 07:00–11:00 Києва, раз на день (cron двічі-тричі на годину поруч, бо DST: '50 4,5,6 * * *' UTC)
create or replace function public.general_team_digest_enqueue(p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamp := now() at time zone 'Europe/Kyiv'; v_text text; v_n int := 0;
begin
  if not p_force then
    if extract(hour from v_now) < 7 or extract(hour from v_now) >= 11 then return jsonb_build_object('skip', 'not morning'); end if;
    if exists (select 1 from public.tg_notify_queue where source = 'general-digest' and (created_at at time zone 'Europe/Kyiv')::date = v_now::date) then
      return jsonb_build_object('skip', 'already sent today');
    end if;
  end if;
  v_text := public.general_team_digest_text(v_now::date);
  if v_text is null then return jsonb_build_object('skip', 'no active project'); end if;
  insert into public.tg_notify_queue(chat_id, text, parse_mode, disable_web_page_preview, source, status, scheduled_at)
  select chat_id, v_text, 'HTML', true, 'general-digest', 'pending', now() from public.tg_listening_chats where team_digest;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'chats', v_n);
end $$;
revoke all on function public.general_team_digest_enqueue(boolean) from public, anon, authenticated;

-- select cron.schedule('general-team-digest-morning', '50 4,5,6 * * *', $$select public.general_team_digest_enqueue(false)$$);
