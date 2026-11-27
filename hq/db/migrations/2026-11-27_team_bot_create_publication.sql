-- 27.11.2026: бот команди створює НОВІ чернетки публікацій за списком колеги (постійний дозвіл власника).
-- Лише insert зі status=draft і обмеженим набором полів. Rollback: ..._rollback.sql
create or replace function public.team_bot_create_publication(p_fields jsonb, p_actor_tg bigint)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  actor uuid; k text; new_id uuid; dup uuid;
  allowed text[] := array['title','text_body','hashtags','publish_at','deadline_on','next_action_note'];
  v_title text; v_raw text; v_at timestamptz; v_deadline date; v_tags text[] := array[]::text[];
begin
  select id into actor from users where tg_chat_id = p_actor_tg and is_active limit 1;
  if actor is null then return jsonb_build_object('ok', false, 'error', 'автор не знайдений серед користувачів HQ'); end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'потрібен JSON-обʼєкт з полями');
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if not (k = any(allowed)) then
      return jsonb_build_object('ok', false, 'needs_owner', true, 'error', 'поле ' || k || ' не можна задавати без ✅ власника');
    end if;
    if k <> 'hashtags' and jsonb_typeof(p_fields->k) not in ('string','null') then
      return jsonb_build_object('ok', false, 'error', 'поле ' || k || ' має бути рядком');
    end if;
  end loop;

  v_title := btrim(coalesce(p_fields->>'title', ''));
  if v_title = '' or length(v_title) > 300 then return jsonb_build_object('ok', false, 'error', 'назва обовʼязкова, до 300 символів'); end if;
  if length(coalesce(p_fields->>'text_body', '')) > 10000 or length(coalesce(p_fields->>'next_action_note', '')) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'задовгий текст або нотатка');
  end if;
  if p_fields ? 'hashtags' and jsonb_typeof(p_fields->'hashtags') <> 'null' then
    if jsonb_typeof(p_fields->'hashtags') <> 'array' then return jsonb_build_object('ok', false, 'error', 'hashtags має бути списком'); end if;
    if exists (select 1 from jsonb_array_elements(p_fields->'hashtags') e where jsonb_typeof(e) <> 'string') then
      return jsonb_build_object('ok', false, 'error', 'кожен хештег має бути рядком');
    end if;
    v_tags := array(select jsonb_array_elements_text(p_fields->'hashtags'));
  end if;

  v_raw := btrim(coalesce(p_fields->>'publish_at', ''));
  if v_raw !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}(:?\d{2})?)?$' then
    return jsonb_build_object('ok', false, 'error', 'потрібні дата й час: YYYY-MM-DDTHH:MM (Київ)');
  end if;
  begin
    -- без зони = київський час
    if v_raw ~ '(Z|[+-]\d{2}(:?\d{2})?)$' then v_at := v_raw::timestamptz;
    else v_at := (v_raw::timestamp) at time zone 'Europe/Kyiv'; end if;
    v_deadline := nullif(btrim(coalesce(p_fields->>'deadline_on', '')), '')::date;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'некоректна дата');
  end;

  -- повтор тієї самої команди не плодить дублів
  perform pg_advisory_xact_lock(hashtext('team_bot_create:' || v_title || v_at::text));
  select id into dup from publications where deleted_at is null and title = v_title and publish_at = v_at limit 1;
  if dup is not null then
    return jsonb_build_object('ok', false, 'duplicate', true, 'id', dup, 'error', 'карточка з такою назвою і часом уже є');
  end if;

  -- content_type обовʼязковий у таблиці: ставимо 'post', тип і платформи команда обирає в HQ
  insert into publications (desk_id, title, publish_at, content_type, text_body, hashtags, deadline_on, next_action_note, status, created_by, last_action_via)
  values ((select id from desks where slug = 'smm'), v_title, v_at, 'post', coalesce(p_fields->>'text_body', ''), v_tags,
          v_deadline, nullif(p_fields->>'next_action_note', ''), 'draft', actor, 'tg-bot')
  returning id into new_id;
  insert into publication_history (publication_id, actor_id, action, detail, at)
  values (new_id, actor, 'create', 'Бот у TG: створено чернетку', now());
  return jsonb_build_object('ok', true, 'id', new_id, 'status', 'draft', 'title', v_title,
                            'publish_at_kyiv', to_char(v_at at time zone 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI'));
end $$;
revoke all on function public.team_bot_create_publication(jsonb, bigint) from public, anon, authenticated;
grant execute on function public.team_bot_create_publication(jsonb, bigint) to service_role;
