-- 04.11.2026 (Вадим): бот у робочих чатах відповідає колегам (тег або reply), бачить контекст,
-- робить дрібні правки карточок SMM-столу і ретеншну; усе інше — план на ✅ власнику в особисті.
-- Сесія колег на Mac Studio НЕ має доступу до файлів і shell: лише ці дві функції через edge owner-dm.
-- Каса, банк, P&L, бюджети, користувачі, секрети — поза цими функціями повністю.
-- Rollback: DROP FUNCTION public.team_bot_find(text,text,int); DROP FUNCTION public.team_bot_update(text,uuid,jsonb,bigint);
--           ALTER TABLE public.owner_dm_jobs DROP COLUMN mode, DROP COLUMN from_tg_id, DROP COLUMN from_name, DROP COLUMN chat_title;

ALTER TABLE public.owner_dm_jobs
  ADD COLUMN IF NOT EXISTS mode       text NOT NULL DEFAULT 'owner' CHECK (mode IN ('owner','team')),
  ADD COLUMN IF NOT EXISTS from_tg_id bigint,
  ADD COLUMN IF NOT EXISTS from_name  text,
  ADD COLUMN IF NOT EXISTS chat_title text;

-- Читання для колег: безпечні колонки, до 30 рядків. p_kind: publications | retention | launches | history
CREATE OR REPLACE FUNCTION public.team_bot_find(p_kind text, p_search text DEFAULT NULL, p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v jsonb; q text := nullif(trim(coalesce(p_search, '')), ''); n int := least(greatest(coalesce(p_limit, 20), 1), 30);
BEGIN
  IF p_kind = 'publications' THEN
    SELECT coalesce(jsonb_agg(r), '[]') INTO v FROM (
      SELECT p.id, p.title, left(p.text_body, 1500) AS text_body, p.status::text AS status, p.publish_at, p.deadline_on,
             p.autopost_status, p.autopost_error, p.next_action_note, l.name AS launch,
             (SELECT array_agg(pp.platform::text) FROM publication_platforms pp WHERE pp.publication_id = p.id) AS platforms
        FROM publications p LEFT JOIN launches l ON l.id = p.launch_id
       WHERE p.deleted_at IS NULL
         AND (q IS NULL OR p.id::text = q OR p.title ILIKE '%' || q || '%' OR p.text_body ILIKE '%' || q || '%')
       ORDER BY p.publish_at DESC NULLS LAST LIMIT n) r;
  ELSIF p_kind = 'retention' THEN
    SELECT coalesce(jsonb_agg(r), '[]') INTO v FROM (
      SELECT m.id, m.title, m.channel::text AS channel, left(m.body, 1500) AS body, m.preview_text, m.status::text AS status,
             m.publish_at, m.deadline_on, m.audience_count, m.sent_at, m.sent_count, m.failed_count, m.external_error, m.notes
        FROM retention_messages m
       WHERE m.deleted_at IS NULL
         AND (q IS NULL OR m.id::text = q OR m.title ILIKE '%' || q || '%' OR m.body ILIKE '%' || q || '%')
       ORDER BY m.publish_at DESC NULLS LAST LIMIT n) r;
  ELSIF p_kind = 'launches' THEN
    SELECT coalesce(jsonb_agg(r), '[]') INTO v FROM (
      SELECT l.id, l.name, l.code, l.cycle_no, l.kind, l.status::text AS status, l.starts_at, l.stop_at, l.live_at, l.live_url, l.packages
        FROM launches l
       WHERE (q IS NULL OR l.name ILIKE '%' || q || '%' OR l.code ILIKE '%' || q || '%')
       ORDER BY l.starts_at DESC NULLS LAST LIMIT n) r;
  ELSIF p_kind = 'history' THEN
    SELECT coalesce(jsonb_agg(r), '[]') INTO v FROM (
      SELECT h.publication_id, h.action, h.detail, h.at FROM publication_history h
       WHERE q IS NOT NULL AND h.publication_id::text = q ORDER BY h.at DESC LIMIT n) r;
  ELSE
    RETURN jsonb_build_object('error', 'kind must be publications | retention | launches | history');
  END IF;
  RETURN jsonb_build_object('rows', v);
END;
$$;

-- Дрібні правки для колег. Лише непогоджені карточки; погоджене/опубліковане/надіслане — тільки через ✅ власника.
-- publications: title, text_body, hashtags, publish_at, deadline_on, next_action_note; status лише серед draft/in_work/review/rework
-- retention:    title, body, preview_text, publish_at, deadline_on, notes;            status лише серед draft/review/rework
CREATE OR REPLACE FUNCTION public.team_bot_update(p_kind text, p_id uuid, p_fields jsonb, p_actor_tg bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE cur text; k text; allowed text[]; st_ok text[]; actor uuid; changed text[] := '{}';
BEGIN
  SELECT id INTO actor FROM users WHERE tg_chat_id = p_actor_tg LIMIT 1;
  IF actor IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'автор не знайдений серед користувачів HQ'); END IF;

  IF p_kind = 'publications' THEN
    allowed := ARRAY['title','text_body','hashtags','publish_at','deadline_on','next_action_note','status'];
    st_ok := ARRAY['draft','in_work','review','rework'];
    SELECT status::text INTO cur FROM publications WHERE id = p_id AND deleted_at IS NULL;
  ELSIF p_kind = 'retention' THEN
    allowed := ARRAY['title','body','preview_text','publish_at','deadline_on','notes','status'];
    st_ok := ARRAY['draft','review','rework'];
    SELECT status::text INTO cur FROM retention_messages WHERE id = p_id AND deleted_at IS NULL;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'kind must be publications | retention');
  END IF;

  IF cur IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'карточку не знайдено'); END IF;
  IF NOT (cur = ANY(st_ok)) THEN
    RETURN jsonb_build_object('ok', false, 'needs_owner', true, 'error', 'карточка в статусі ' || cur || ': правка лише з ✅ власника');
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_fields) LOOP
    IF NOT (k = ANY(allowed)) THEN RETURN jsonb_build_object('ok', false, 'needs_owner', true, 'error', 'поле ' || k || ' не можна змінювати без ✅ власника'); END IF;
  END LOOP;
  IF p_fields ? 'status' AND NOT ((p_fields->>'status') = ANY(st_ok)) THEN
    RETURN jsonb_build_object('ok', false, 'needs_owner', true, 'error', 'статус ' || (p_fields->>'status') || ' лише з ✅ власника');
  END IF;

  IF p_kind = 'publications' THEN
    UPDATE publications SET
      title            = CASE WHEN p_fields ? 'title' THEN p_fields->>'title' ELSE title END,
      text_body        = CASE WHEN p_fields ? 'text_body' THEN p_fields->>'text_body' ELSE text_body END,
      hashtags         = CASE WHEN p_fields ? 'hashtags' THEN ARRAY(SELECT jsonb_array_elements_text(p_fields->'hashtags')) ELSE hashtags END,
      publish_at       = CASE WHEN p_fields ? 'publish_at' THEN (p_fields->>'publish_at')::timestamptz ELSE publish_at END,
      deadline_on      = CASE WHEN p_fields ? 'deadline_on' THEN (p_fields->>'deadline_on')::date ELSE deadline_on END,
      next_action_note = CASE WHEN p_fields ? 'next_action_note' THEN p_fields->>'next_action_note' ELSE next_action_note END,
      status           = CASE WHEN p_fields ? 'status' THEN (p_fields->>'status')::publication_status ELSE status END,
      last_action_via  = 'tg-bot', updated_at = now()
     WHERE id = p_id;
    INSERT INTO publication_history (publication_id, actor_id, action, detail, at)
    VALUES (p_id, actor, 'bot_edit', 'Бот у TG: ' || (SELECT string_agg(x, ', ') FROM jsonb_object_keys(p_fields) x), now());
  ELSE
    UPDATE retention_messages SET
      title        = CASE WHEN p_fields ? 'title' THEN p_fields->>'title' ELSE title END,
      body         = CASE WHEN p_fields ? 'body' THEN p_fields->>'body' ELSE body END,
      preview_text = CASE WHEN p_fields ? 'preview_text' THEN p_fields->>'preview_text' ELSE preview_text END,
      publish_at   = CASE WHEN p_fields ? 'publish_at' THEN (p_fields->>'publish_at')::timestamptz ELSE publish_at END,
      deadline_on  = CASE WHEN p_fields ? 'deadline_on' THEN (p_fields->>'deadline_on')::date ELSE deadline_on END,
      notes        = CASE WHEN p_fields ? 'notes' THEN p_fields->>'notes' ELSE notes END,
      status       = CASE WHEN p_fields ? 'status' THEN (p_fields->>'status')::retention_status ELSE status END,
      last_action_via = 'tg-bot', updated_at = now()
     WHERE id = p_id;
    INSERT INTO retention_message_history (message_id, actor_id, action, detail, at)
    VALUES (p_id, actor, 'bot_edit', 'Бот у TG: ' || (SELECT string_agg(x, ', ') FROM jsonb_object_keys(p_fields) x), now());
  END IF;
  RETURN jsonb_build_object('ok', true, 'changed', (SELECT jsonb_agg(x) FROM jsonb_object_keys(p_fields) x));
END;
$$;

REVOKE ALL ON FUNCTION public.team_bot_find(text, text, int) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_bot_update(text, uuid, jsonb, bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_bot_find(text, text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.team_bot_update(text, uuid, jsonb, bigint) TO service_role;
