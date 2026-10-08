-- =====================================================================
-- 038_general_plan.sql — GENERAL: план проєкту (08.10.2026)
-- ТЗ Давида 07.10 + критика архітектора/операцій. Принципи:
--   • одне джерело правди для акцій = public.ad_events (його читає ad_watchdog)
--   • часи зберігаються timestamptz, переводяться з/у Europe/Kyiv ТІЛЬКИ тут (DST 25.10!)
--   • доступ лише через SECURITY DEFINER RPC з перевіркою ролі; фінанси не віддаємо
--   • редагують тільки ceo/coo; журнал змін пише тригер (ловить і SQL/сервіс)
-- Зворотність: усі нові колонки nullable/default, нові таблиці окремі.
-- =====================================================================

-- ---------- 1. launches: факти рівня проєкту ----------
alter table public.launches
  add column if not exists cycle_no  smallint,
  add column if not exists kind      text not null default 'raffle',
  add column if not exists starts_at timestamptz,
  add column if not exists stop_at   timestamptz,
  add column if not exists live_at   timestamptz,
  add column if not exists live_url  text,
  add column if not exists packages  jsonb not null default '[]'::jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='launches_kind_check') then
    alter table public.launches add constraint launches_kind_check check (kind in ('raffle','content','other'));
  end if;
end $$;
create unique index if not exists launches_cycle_no_uniq on public.launches(cycle_no) where cycle_no is not null;

update public.launches set kind='content' where code='CONTENT';
update public.launches set kind='other'   where code='LIFE' or (code is null and name ilike 'Iphone за 99%');
update public.launches set cycle_no=17 where code='DC17_X5'          and cycle_no is null;
update public.launches set cycle_no=19 where code='mustang'          and cycle_no is null;
update public.launches set cycle_no=20 where code='X6M'              and cycle_no is null;
update public.launches set cycle_no=21 where code='audi_q7_prestige' and cycle_no is null;
update public.launches set cycle_no=22 where code='bmw330'           and cycle_no is null;

-- ---------- 2. landings (нова таблиця, до FK з ad_events) ----------
create table if not exists public.launch_landings (
  id            uuid primary key default gen_random_uuid(),
  launch_id     uuid not null references public.launches(id) on delete cascade,
  url           text not null check (url ~ '^https://[a-z0-9.-]+\.dreamcar\.ua(/|$)'),
  role          text not null default 'other' check (role in ('main','vip','fortunatos','preview','ab_variant','other')),
  ab_label      text,
  experiment_id text references public.experiments(id) on delete set null,
  internal_only boolean not null default false,
  description   text,
  sort          smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (launch_id, url)
);

-- ---------- 3. ad_events → план акцій ----------
alter table public.ad_events
  add column if not exists launch_id   uuid references public.launches(id) on delete restrict,
  add column if not exists audience    text not null default 'all',
  add column if not exists segment     text,
  add column if not exists conditions  text,
  add column if not exists client_text text,
  add column if not exists limit_qty   integer,
  add column if not exists limit_note  text,
  add column if not exists landing_id  uuid references public.launch_landings(id) on delete set null,
  add column if not exists channels    jsonb not null default '[]'::jsonb,
  add column if not exists utm_slug    text,
  add column if not exists reveal_at   timestamptz,
  add column if not exists owner_id    uuid references public.users(id) on delete set null,
  add column if not exists plan_day    date generated always as ((starts_at at time zone 'Europe/Kyiv')::date) stored;

do $$ begin
  if not exists (select 1 from pg_constraint where conname='ad_events_audience_check') then
    alter table public.ad_events add constraint ad_events_audience_check check (audience in ('all','retention','fortunatos'));
  end if;
  if not exists (select 1 from pg_constraint where conname='ad_events_limit_qty_check') then
    alter table public.ad_events add constraint ad_events_limit_qty_check check (limit_qty is null or limit_qty > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='ad_events_utm_slug_check') then
    alter table public.ad_events add constraint ad_events_utm_slug_check check (utm_slug is null or utm_slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$');
  end if;
  if not exists (select 1 from pg_constraint where conname='ad_events_ends_after_start') then
    alter table public.ad_events add constraint ad_events_ends_after_start check (ends_at is null or ends_at >= starts_at);
  end if;
end $$;

create index if not exists ad_events_launch_idx on public.ad_events(launch_id, starts_at);
create unique index if not exists ad_events_utm_slug_uniq on public.ad_events(lower(utm_slug)) where utm_slug is not null;

-- події #21 (Audi Q7 Prestige) прив'язуємо до launch
update public.ad_events set launch_id='424f1dbc-01ab-47b5-bef0-b3ad3c273e32'
 where project='dreamcar' and cycle='21' and launch_id is null;
-- канонічні UTM для очевидних подарунків #21 (ретро-перевірка мапінгу оплат)
update public.ad_events set utm_slug='audiq7_applewatch' where cycle='21' and title='Подарунок дня: Apple Watch'     and utm_slug is null;
update public.ad_events set utm_slug='audiq7_ps5'        where cycle='21' and title='Подарунок дня: PlayStation 5'  and utm_slug is null;
update public.ad_events set utm_slug='audiq7_macbook'    where cycle='21' and title='Подарунок дня: MacBook Neo'    and utm_slug is null;
update public.ad_events set utm_slug='audiq7_iphoneair'  where cycle='21' and title='Подарунок дня: iPhone Air'     and utm_slug is null;
update public.ad_events set utm_slug='audiq7_ecoflow'    where cycle='21' and title='Подарунок дня: EcoFlow / Bluetti' and utm_slug is null;

-- ---------- 4. шапки сайту по періодах ----------
create table if not exists public.launch_banners (
  id          uuid primary key default gen_random_uuid(),
  launch_id   uuid not null references public.launches(id) on delete cascade,
  from_day    date not null,
  to_day      date not null,
  text        text,
  status      text not null default 'pending' check (status in ('pending','approved','live')),
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  ad_event_id bigint references public.ad_events(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (to_day >= from_day),
  unique (launch_id, from_day)
);

-- ---------- 5. явні позначки дня («без акцій» / «задати») ----------
-- «очікує план» = відсутність акцій І позначок; рядків-днів не зберігаємо
create table if not exists public.launch_day_marks (
  launch_id  uuid not null references public.launches(id) on delete cascade,
  day        date not null,
  audience   text not null check (audience in ('all','retention','fortunatos')),
  state      text not null check (state in ('no_promo','tbd')),
  note       text,
  updated_at timestamptz not null default now(),
  primary key (launch_id, day, audience)
);

-- ---------- 6. журнал змін ----------
create table if not exists public.general_change_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    uuid,
  actor_label text,
  launch_id   uuid,
  entity      text not null,
  entity_id   text,
  action      text not null check (action in ('insert','update','delete')),
  diff        jsonb not null
);
create index if not exists general_change_log_launch_at on public.general_change_log(launch_id, at desc);

-- RLS: жодних політик → тільки через RPC / service role
alter table public.launch_landings    enable row level security;
alter table public.launch_banners     enable row level security;
alter table public.launch_day_marks   enable row level security;
alter table public.general_change_log enable row level security;
revoke all on public.launch_landings, public.launch_banners, public.launch_day_marks, public.general_change_log from anon;

-- ---------- 7. тригери: updated_at + журнал ----------
create or replace function public.general_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace trigger launch_landings_touch before update on public.launch_landings for each row execute function public.general_touch();
create or replace trigger launch_banners_touch before update on public.launch_banners for each row execute function public.general_touch();
create or replace trigger launch_day_marks_touch before update on public.launch_day_marks for each row execute function public.general_touch();

create or replace function public.general_log_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old jsonb; v_new jsonb; v_row jsonb; v_diff jsonb := '{}'::jsonb; k text;
  v_launch uuid; v_actor uuid; v_label text; v_eid text;
  skip text[] := array['updated_at','created_at','gift_cost_uah','plan_day','layers','budget_plan','budget_actual','prize_cost_uah','prize_notes','kpi_targets','kpi_actuals'];
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('UPDATE','INSERT') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      continue when k = any(skip);
      if (v_old -> k) is distinct from (v_new -> k) then
        v_diff := v_diff || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
      end if;
    end loop;
    if v_diff = '{}'::jsonb then return null; end if;
  else
    v_diff := v_row - skip;
  end if;

  if tg_table_name = 'launches' then
    v_launch := (v_row ->> 'id')::uuid;
  else
    v_launch := nullif(v_row ->> 'launch_id', '')::uuid;
  end if;
  if v_launch is null then return null; end if;   -- події без проєкту (не GENERAL) не логуємо

  v_eid := case when tg_table_name = 'launch_day_marks'
                then (v_row ->> 'day') || ':' || (v_row ->> 'audience')
                else v_row ->> 'id' end;
  begin v_actor := public.current_user_id(); exception when others then v_actor := null; end;
  select name into v_label from public.users where id = v_actor;

  insert into public.general_change_log(actor_id, actor_label, launch_id, entity, entity_id, action, diff)
  values (v_actor, coalesce(v_label, 'система'), v_launch, tg_table_name, v_eid, lower(tg_op), v_diff);
  return null;
end $$;

create or replace trigger ad_events_general_log after insert or update or delete on public.ad_events
  for each row execute function public.general_log_change();
create or replace trigger launch_landings_general_log after insert or update or delete on public.launch_landings
  for each row execute function public.general_log_change();
create or replace trigger launch_banners_general_log after insert or update or delete on public.launch_banners
  for each row execute function public.general_log_change();
create or replace trigger launch_day_marks_general_log after insert or update or delete on public.launch_day_marks
  for each row execute function public.general_log_change();
create or replace trigger launches_general_log after update of starts_at, stop_at, live_at, live_url, cycle_no, packages, name on public.launches
  for each row execute function public.general_log_change();

-- ---------- 8. доступ ----------
create or replace function public.general_can_read() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_has_role(array['ceo','coo','lead','member','designer','cfo','buyer']::user_role[]);
$$;
create or replace function public.general_can_edit() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.current_user_has_role(array['ceo','coo']::user_role[]);
$$;

-- київський локальний рядок ↔ timestamptz
create or replace function public.general_kyiv(ts timestamptz) returns text
language sql immutable as $$ select to_char(ts at time zone 'Europe/Kyiv', 'YYYY-MM-DD"T"HH24:MI') $$;
create or replace function public.general_from_kyiv(s text) returns timestamptz
language sql immutable as $$ select case when nullif(s,'') is null then null else (replace(s,'T',' ')::timestamp at time zone 'Europe/Kyiv') end $$;

-- ---------- 9. читання ----------
create or replace function public.general_list_launches() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Europe/Kyiv')::date; v_default uuid;
begin
  if not public.general_can_read() then raise exception 'Немає доступу до GENERAL' using errcode = '42501'; end if;
  select id into v_default from public.launches
   where kind='raffle' and status not in ('idea','archived','completed') and starts_on is not null
   order by (v_today between starts_on and coalesce(ends_on, starts_on)) desc,
            (starts_on >= v_today) desc, abs(starts_on - v_today)
   limit 1;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'name', l.name, 'code', l.code, 'cycle_no', l.cycle_no, 'status', l.status,
      'starts_on', l.starts_on, 'ends_on', l.ends_on,
      'archived', l.status in ('completed','archived'),
      'is_default', l.id = v_default) order by l.starts_on desc)
    from public.launches l
    where l.kind='raffle' and l.status <> 'idea' and l.starts_on is not null), '[]'::jsonb);
end $$;

create or replace function public.general_get_plan(p_launch uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_l public.launches; v_today date := (now() at time zone 'Europe/Kyiv')::date; v_res jsonb;
begin
  if not public.general_can_read() then raise exception 'Немає доступу до GENERAL' using errcode = '42501'; end if;
  select * into v_l from public.launches where id = p_launch and kind='raffle';
  if not found then raise exception 'Проєкт не знайдено'; end if;

  select jsonb_build_object(
    'launch', jsonb_build_object(
      'id', v_l.id, 'name', v_l.name, 'code', v_l.code, 'cycle_no', v_l.cycle_no, 'status', v_l.status,
      'starts_on', v_l.starts_on, 'ends_on', v_l.ends_on,
      'starts_local', public.general_kyiv(v_l.starts_at), 'stop_local', public.general_kyiv(v_l.stop_at),
      'live_local', public.general_kyiv(v_l.live_at), 'live_url', v_l.live_url, 'packages', v_l.packages),
    'today', v_today,
    'now_local', public.general_kyiv(now()),
    'can_edit', public.general_can_edit(),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'n', (d::date - v_l.starts_on) + 1) order by d)
                      from generate_series(v_l.starts_on, coalesce(v_l.ends_on, v_l.starts_on), interval '1 day') d), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'title', e.title, 'offer', e.offer, 'mechanic', e.mechanic,
        'conditions', e.conditions, 'client_text', e.client_text, 'audience', e.audience, 'segment', e.segment,
        'starts_local', public.general_kyiv(e.starts_at), 'ends_local', public.general_kyiv(e.ends_at),
        'day_from', e.plan_day, 'day_to', coalesce((e.ends_at at time zone 'Europe/Kyiv')::date, e.plan_day),
        'limit_qty', e.limit_qty, 'limit_note', e.limit_note, 'landing_id', e.landing_id,
        'channels', e.channels, 'utm_slug', e.utm_slug, 'status', e.status, 'notes', e.notes,
        'owner_id', e.owner_id, 'owner_name', u.name, 'updated_at', e.updated_at) order by e.starts_at, e.audience)
      from public.ad_events e left join public.users u on u.id = e.owner_id
      where e.launch_id = v_l.id and e.status <> 'cancelled'), '[]'::jsonb),
    'landings', coalesce((select jsonb_agg(to_jsonb(x) - 'created_at' order by x.sort, x.url)
      from public.launch_landings x where x.launch_id = v_l.id), '[]'::jsonb),
    'banners', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'from_day', b.from_day, 'to_day', b.to_day, 'text', b.text, 'status', b.status,
        'approved_by_name', ua.name, 'approved_at', public.general_kyiv(b.approved_at), 'ad_event_id', b.ad_event_id,
        'note', b.note, 'updated_at', b.updated_at) order by b.from_day)
      from public.launch_banners b left join public.users ua on ua.id = b.approved_by
      where b.launch_id = v_l.id), '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(jsonb_build_object('day', m.day, 'audience', m.audience, 'state', m.state, 'note', m.note) order by m.day)
      from public.launch_day_marks m where m.launch_id = v_l.id), '[]'::jsonb),
    'retention', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'channel', r.channel, 'title', r.title, 'status', r.status,
        'publish_local', public.general_kyiv(r.publish_at), 'day', (r.publish_at at time zone 'Europe/Kyiv')::date) order by r.publish_at)
      from public.retention_messages r where r.project_id = v_l.id and r.deleted_at is null), '[]'::jsonb),
    'users', case when public.general_can_edit() then coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name)
      from public.users where is_active and role <> 'media'), '[]'::jsonb) else '[]'::jsonb end
  ) into v_res;
  return v_res;
end $$;

-- акції по днях для плиток SMM (розгортає багатоденні)
create or replace function public.general_day_promos(p_from date, p_to date)
returns table(day date, launch_id uuid, launch_name text, audience text, kind text, title text, event_id bigint)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.general_can_read() then return; end if;
  return query
  select d::date, e.launch_id, l.name, e.audience, e.kind, e.title, e.id
  from public.ad_events e
  join public.launches l on l.id = e.launch_id and l.kind = 'raffle'
  cross join lateral generate_series(e.plan_day, coalesce((e.ends_at at time zone 'Europe/Kyiv')::date, e.plan_day), interval '1 day') d
  where e.status <> 'cancelled' and d::date between p_from and p_to
  order by d, e.audience, e.starts_at;
end $$;

create or replace function public.general_change_log(p_launch uuid, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.general_can_edit() then raise exception 'Журнал змін бачать тільки CEO і COO' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', public.general_kyiv(g.at), 'who', g.actor_label,
      'entity', g.entity, 'entity_id', g.entity_id, 'action', g.action, 'diff', g.diff) order by g.at desc)
    from (select * from public.general_change_log where launch_id = p_launch order by at desc limit least(greatest(p_limit,1),1000)) g), '[]'::jsonb);
end $$;

-- ---------- 10. запис (тільки ceo/coo) ----------
create or replace function public.general_assert_edit() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.general_can_edit() then raise exception 'Редагувати план можуть тільки CEO і COO' using errcode = '42501'; end if;
end $$;

create or replace function public.general_set_schedule(p_launch uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_l public.launches; v_start timestamptz; v_stop timestamptz; v_live timestamptz; v_cycle text;
begin
  perform public.general_assert_edit();
  select * into v_l from public.launches where id = p_launch for update;
  if not found then raise exception 'Проєкт не знайдено'; end if;
  v_start := case when p ? 'starts_local' then public.general_from_kyiv(p->>'starts_local') else v_l.starts_at end;
  v_stop  := case when p ? 'stop_local'   then public.general_from_kyiv(p->>'stop_local')   else v_l.stop_at end;
  v_live  := case when p ? 'live_local'   then public.general_from_kyiv(p->>'live_local')   else v_l.live_at end;
  if v_start is not null and v_stop is not null and v_stop <= v_start then raise exception 'STOP має бути пізніше старту'; end if;
  if v_live is not null and v_stop is not null and v_live < v_stop then raise exception 'Ефір має бути після STOP'; end if;

  update public.launches set
    starts_at = v_start, stop_at = v_stop, live_at = v_live,
    starts_on = coalesce((v_start at time zone 'Europe/Kyiv')::date, starts_on),
    ends_on   = coalesce((v_stop  at time zone 'Europe/Kyiv')::date, ends_on),
    live_url  = case when p ? 'live_url' then nullif(p->>'live_url','') else live_url end,
    cycle_no  = case when p ? 'cycle_no' then nullif(p->>'cycle_no','')::smallint else cycle_no end,
    packages  = case when p ? 'packages' then coalesce(p->'packages','[]'::jsonb) else packages end,
    updated_at = now()
  where id = p_launch returning * into v_l;

  -- подія «ефір» для календаря реклами (одна на проєкт, керується звідси)
  v_cycle := v_l.cycle_no::text;
  if v_l.live_at is not null then
    update public.ad_events set starts_at = v_l.live_at, ends_at = v_l.live_at + interval '1 hour', cycle = v_cycle
     where launch_id = v_l.id and source = 'general:live';
    if not found then
      insert into public.ad_events(project, cycle, launch_id, kind, title, starts_at, ends_at, audience, status, source, created_by)
      values ('dreamcar', v_cycle, v_l.id, 'live', 'Прямий ефір: розіграш ' || v_l.name, v_l.live_at, v_l.live_at + interval '1 hour',
              'all', 'planned', 'general:live', 'general');
    end if;
  else
    update public.ad_events set status = 'cancelled' where launch_id = v_l.id and source = 'general:live';
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.general_upsert_event(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint := nullif(p->>'id','')::bigint; v_l public.launches; v_cur public.ad_events;
        v_start timestamptz; v_end timestamptz; v_actor text;
begin
  perform public.general_assert_edit();
  select * into v_l from public.launches where id = (p->>'launch_id')::uuid;
  if not found then raise exception 'Проєкт не знайдено'; end if;
  v_start := public.general_from_kyiv(p->>'starts_local');
  v_end   := public.general_from_kyiv(p->>'ends_local');
  if v_start is null then raise exception 'Вкажи початок акції'; end if;
  if v_end is not null and v_end < v_start then raise exception 'Кінець акції раніше за початок'; end if;
  if coalesce(trim(p->>'title'),'') = '' then raise exception 'Вкажи назву акції'; end if;
  select name into v_actor from public.users where id = public.current_user_id();

  if v_id is not null then
    select * into v_cur from public.ad_events where id = v_id and launch_id = v_l.id for update;
    if not found then raise exception 'Акцію не знайдено'; end if;
    if p ? 'updated_at' and nullif(p->>'updated_at','') is not null
       and v_cur.updated_at <> (p->>'updated_at')::timestamptz then
      raise exception 'Цю акцію щойно змінив інший редактор — онови сторінку' using errcode = '40001';
    end if;
    update public.ad_events set
      kind = coalesce(nullif(p->>'kind',''), kind), title = trim(p->>'title'),
      offer = nullif(p->>'offer',''), mechanic = nullif(p->>'mechanic',''),
      conditions = nullif(p->>'conditions',''), client_text = nullif(p->>'client_text',''),
      audience = coalesce(nullif(p->>'audience',''), 'all'), segment = nullif(p->>'segment',''),
      starts_at = v_start, ends_at = v_end,
      limit_qty = nullif(p->>'limit_qty','')::int, limit_note = nullif(p->>'limit_note',''),
      landing_id = nullif(p->>'landing_id','')::uuid, channels = coalesce(p->'channels', '[]'::jsonb),
      utm_slug = nullif(lower(p->>'utm_slug'),''), status = coalesce(nullif(p->>'status',''), status),
      notes = nullif(p->>'notes',''), owner_id = nullif(p->>'owner_id','')::uuid,
      cycle = coalesce(v_l.cycle_no::text, cycle)
    where id = v_id;
  else
    insert into public.ad_events(project, cycle, launch_id, kind, title, offer, mechanic, conditions, client_text,
      audience, segment, starts_at, ends_at, limit_qty, limit_note, landing_id, channels, utm_slug, status, notes,
      owner_id, source, created_by)
    values ('dreamcar', v_l.cycle_no::text, v_l.id, coalesce(nullif(p->>'kind',''),'promo'), trim(p->>'title'),
      nullif(p->>'offer',''), nullif(p->>'mechanic',''), nullif(p->>'conditions',''), nullif(p->>'client_text',''),
      coalesce(nullif(p->>'audience',''),'all'), nullif(p->>'segment',''), v_start, v_end,
      nullif(p->>'limit_qty','')::int, nullif(p->>'limit_note',''), nullif(p->>'landing_id','')::uuid,
      coalesce(p->'channels','[]'::jsonb), nullif(lower(p->>'utm_slug'),''), coalesce(nullif(p->>'status',''),'planned'),
      nullif(p->>'notes',''), nullif(p->>'owner_id','')::uuid, 'general', 'general:' || coalesce(v_actor,'?'))
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  raise exception 'Такий UTM або така акція в цей час уже є';
end $$;

create or replace function public.general_cancel_event(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.general_assert_edit();
  update public.ad_events set status = 'cancelled' where id = p_id and launch_id is not null;
  if not found then raise exception 'Акцію не знайдено'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.general_upsert_landing(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  perform public.general_assert_edit();
  if v_id is null then
    insert into public.launch_landings(launch_id, url, role, ab_label, internal_only, description, sort)
    values ((p->>'launch_id')::uuid, trim(p->>'url'), coalesce(nullif(p->>'role',''),'other'), nullif(p->>'ab_label',''),
            coalesce((p->>'internal_only')::boolean,false), nullif(p->>'description',''), coalesce(nullif(p->>'sort','')::smallint,0))
    returning id into v_id;
  else
    update public.launch_landings set url = trim(p->>'url'), role = coalesce(nullif(p->>'role',''),'other'),
      ab_label = nullif(p->>'ab_label',''), internal_only = coalesce((p->>'internal_only')::boolean,false),
      description = nullif(p->>'description',''), sort = coalesce(nullif(p->>'sort','')::smallint, sort)
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when check_violation then raise exception 'Адреса має бути https://…dreamcar.ua/…';
          when unique_violation then raise exception 'Такий лендинг уже є';
end $$;

create or replace function public.general_delete_landing(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.general_assert_edit(); delete from public.launch_landings where id = p_id; return jsonb_build_object('ok', true); end $$;

create or replace function public.general_upsert_banner(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_launch uuid := (p->>'launch_id')::uuid;
        v_from date := (p->>'from_day')::date; v_to date := (p->>'to_day')::date; v_status text := coalesce(nullif(p->>'status',''),'pending');
begin
  perform public.general_assert_edit();
  if v_to < v_from then raise exception 'Кінець періоду раніше за початок'; end if;
  if exists (select 1 from public.launch_banners b where b.launch_id = v_launch and b.id is distinct from v_id
             and daterange(b.from_day, b.to_day, '[]') && daterange(v_from, v_to, '[]')) then
    raise exception 'Період шапки перетинається з іншим';
  end if;
  if v_id is null then
    insert into public.launch_banners(launch_id, from_day, to_day, text, status, ad_event_id, note, approved_by, approved_at)
    values (v_launch, v_from, v_to, nullif(p->>'text',''), v_status, nullif(p->>'ad_event_id','')::bigint, nullif(p->>'note',''),
            case when v_status <> 'pending' then public.current_user_id() end, case when v_status <> 'pending' then now() end)
    returning id into v_id;
  else
    update public.launch_banners set from_day = v_from, to_day = v_to, text = nullif(p->>'text',''),
      approved_by = case when v_status = 'pending' then null when status = 'pending' then public.current_user_id() else approved_by end,
      approved_at = case when v_status = 'pending' then null when status = 'pending' then now() else approved_at end,
      status = v_status, ad_event_id = nullif(p->>'ad_event_id','')::bigint, note = nullif(p->>'note','')
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.general_delete_banner(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.general_assert_edit(); delete from public.launch_banners where id = p_id; return jsonb_build_object('ok', true); end $$;

create or replace function public.general_mark_day(p_launch uuid, p_day date, p_audience text, p_state text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.general_assert_edit();
  if nullif(p_state,'') is null then
    delete from public.launch_day_marks where launch_id = p_launch and day = p_day and audience = p_audience;
  else
    insert into public.launch_day_marks(launch_id, day, audience, state, note) values (p_launch, p_day, p_audience, p_state, nullif(p_note,''))
    on conflict (launch_id, day, audience) do update set state = excluded.state, note = excluded.note;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 11. гранти ----------
do $$ declare f text; begin
  foreach f in array array[
    'general_can_read()','general_can_edit()','general_list_launches()','general_get_plan(uuid)',
    'general_day_promos(date,date)','general_change_log(uuid,integer)','general_assert_edit()',
    'general_set_schedule(uuid,jsonb)','general_upsert_event(jsonb)','general_cancel_event(bigint)',
    'general_upsert_landing(jsonb)','general_delete_landing(uuid)','general_upsert_banner(jsonb)',
    'general_delete_banner(uuid)','general_mark_day(uuid,date,text,text,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.general_log_change() from public, anon, authenticated';
end $$;

-- =====================================================================
-- ДОПОВНЕННЯ (застосовано 08.10.2026 частинами 038a…038g через Supabase MCP)
-- 1) Жорсткого видалення немає: лендинги/шапки/позначки дня прибираються м'яко
--    (removed_at), це оборотно і видно в журналі змін.
-- 2) general_get_plan віддає ще й сирі timestamptz (starts_at/stop_at/live_at,
--    events.starts_at/ends_at, retention.publish_at) для точних відліків у браузері.
-- Актуальні тіла функцій — у БД (pg_get_functiondef); нижче — що змінено відносно вище.
-- =====================================================================
alter table public.launch_landings  add column if not exists removed_at timestamptz;
alter table public.launch_banners   add column if not exists removed_at timestamptz;
alter table public.launch_day_marks add column if not exists removed_at timestamptz;

create or replace function public.general_delete_landing(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.general_assert_edit();
  update public.launch_landings set removed_at = now() where id = p_id and removed_at is null;
  update public.ad_events set landing_id = null where landing_id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.general_delete_banner(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.general_assert_edit();
  update public.launch_banners set removed_at = now() where id = p_id and removed_at is null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.general_mark_day(p_launch uuid, p_day date, p_audience text, p_state text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.general_assert_edit();
  if nullif(p_state,'') is null then
    update public.launch_day_marks set removed_at = now() where launch_id = p_launch and day = p_day and audience = p_audience;
  else
    insert into public.launch_day_marks(launch_id, day, audience, state, note) values (p_launch, p_day, p_audience, p_state, nullif(p_note,''))
    on conflict (launch_id, day, audience) do update set state = excluded.state, note = excluded.note, removed_at = null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- get_plan: фільтр removed_at is null для landings/banners/marks + сирі timestamptz
do $$ declare d text; begin
  d := pg_get_functiondef('public.general_get_plan(uuid)'::regprocedure);
  if d not like '%x.removed_at is null%' then
    d := replace(d, 'from public.launch_landings x where x.launch_id = v_l.id', 'from public.launch_landings x where x.launch_id = v_l.id and x.removed_at is null');
    d := replace(d, 'where b.launch_id = v_l.id', 'where b.launch_id = v_l.id and b.removed_at is null');
    d := replace(d, 'from public.launch_day_marks m where m.launch_id = v_l.id', 'from public.launch_day_marks m where m.launch_id = v_l.id and m.removed_at is null');
    d := replace(d, '''landings'', coalesce((select jsonb_agg(to_jsonb(x) - ''created_at''', '''landings'', coalesce((select jsonb_agg(to_jsonb(x) - ''created_at'' - ''removed_at''');
  end if;
  if d not like '%''stop_at'', v_l.stop_at%' then
    d := replace(d, '''live_url'', v_l.live_url,', '''live_url'', v_l.live_url, ''starts_at'', v_l.starts_at, ''stop_at'', v_l.stop_at, ''live_at'', v_l.live_at,');
    d := replace(d, '''ends_local'', public.general_kyiv(e.ends_at),', '''ends_local'', public.general_kyiv(e.ends_at), ''starts_at'', e.starts_at, ''ends_at'', e.ends_at,');
    d := replace(d, '''publish_local'', public.general_kyiv(r.publish_at),', '''publish_local'', public.general_kyiv(r.publish_at), ''publish_at'', r.publish_at,');
  end if;
  execute d;
end $$;
-- upsert_landing / upsert_banner: відроджують м'яко прибраний рядок з тим самим url / from_day
create or replace function public.general_upsert_landing(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_launch uuid := (p->>'launch_id')::uuid; v_url text := trim(p->>'url');
begin
  perform public.general_assert_edit();
  if v_id is null then
    select id into v_id from public.launch_landings where launch_id = v_launch and url = v_url and removed_at is not null;
  end if;
  if v_id is null then
    insert into public.launch_landings(launch_id, url, role, ab_label, internal_only, description, sort)
    values (v_launch, v_url, coalesce(nullif(p->>'role',''),'other'), nullif(p->>'ab_label',''),
            coalesce((p->>'internal_only')::boolean,false), nullif(p->>'description',''), coalesce(nullif(p->>'sort','')::smallint,0))
    returning id into v_id;
  else
    update public.launch_landings set url = v_url, role = coalesce(nullif(p->>'role',''),'other'),
      ab_label = nullif(p->>'ab_label',''), internal_only = coalesce((p->>'internal_only')::boolean,false),
      description = nullif(p->>'description',''), sort = coalesce(nullif(p->>'sort','')::smallint, sort), removed_at = null
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when check_violation then raise exception 'Адреса має бути https://…dreamcar.ua/…';
          when unique_violation then raise exception 'Такий лендинг уже є';
end $$;

create or replace function public.general_upsert_banner(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id','')::uuid; v_launch uuid := (p->>'launch_id')::uuid;
        v_from date := (p->>'from_day')::date; v_to date := (p->>'to_day')::date; v_status text := coalesce(nullif(p->>'status',''),'pending');
        v_prev text;
begin
  perform public.general_assert_edit();
  if v_to < v_from then raise exception 'Кінець періоду раніше за початок'; end if;
  if exists (select 1 from public.launch_banners b where b.launch_id = v_launch and b.id is distinct from v_id and b.removed_at is null
             and daterange(b.from_day, b.to_day, '[]') && daterange(v_from, v_to, '[]')) then
    raise exception 'Період шапки перетинається з іншим';
  end if;
  if v_id is null then
    select id into v_id from public.launch_banners where launch_id = v_launch and from_day = v_from and removed_at is not null;
    if v_id is not null then update public.launch_banners set status = 'pending', approved_by = null, approved_at = null where id = v_id; end if;
  end if;
  if v_id is null then
    insert into public.launch_banners(launch_id, from_day, to_day, text, status, ad_event_id, note, approved_by, approved_at)
    values (v_launch, v_from, v_to, nullif(p->>'text',''), v_status, nullif(p->>'ad_event_id','')::bigint, nullif(p->>'note',''),
            case when v_status <> 'pending' then public.current_user_id() end, case when v_status <> 'pending' then now() end)
    returning id into v_id;
  else
    select status into v_prev from public.launch_banners where id = v_id;
    update public.launch_banners set from_day = v_from, to_day = v_to, text = nullif(p->>'text',''),
      approved_by = case when v_status = 'pending' then null when v_prev = 'pending' then public.current_user_id() else approved_by end,
      approved_at = case when v_status = 'pending' then null when v_prev = 'pending' then now() else approved_at end,
      status = v_status, ad_event_id = nullif(p->>'ad_event_id','')::bigint, note = nullif(p->>'note',''), removed_at = null
    where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
