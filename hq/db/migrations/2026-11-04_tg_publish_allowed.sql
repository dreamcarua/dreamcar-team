-- 04.11.2026 (Вадим): у публічний TG-канал іде ЛИШЕ публікація SMM-столу, яку погодили.
-- tg_publish_allowed(pub) повертає NULL, якщо можна публікувати, інакше причину відмови.
-- Правила:
--   1) публікація існує, не видалена, статус approved або published, платформа tg;
--   2) є подія погодження (publication_history.action = 'approve');
--   3) publish_at не старше 24 год (старі тестові/застарілі картки не потрапляють у канал);
--   4) після ОСТАННЬОГО погодження не було reject / partial_approve і жодної зміни статусу,
--      крім «Погоджено → Опубліковано» (будь-яке повернення на погодження/доопрацювання = блок).
-- Rollback: DROP FUNCTION public.tg_publish_allowed(uuid);
CREATE OR REPLACE FUNCTION public.tg_publish_allowed(p_pub uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pub record;
  v_last_approve timestamptz;
  v_after text;
BEGIN
  SELECT id, status::text AS status, deleted_at, publish_at INTO v_pub FROM publications WHERE id = p_pub;
  IF NOT FOUND THEN RETURN 'публікацію не знайдено'; END IF;
  IF v_pub.deleted_at IS NOT NULL THEN RETURN 'публікацію видалено'; END IF;
  IF v_pub.status NOT IN ('approved', 'published') THEN RETURN 'статус ' || v_pub.status || ' (не погоджено)'; END IF;
  IF v_pub.publish_at IS NOT NULL AND v_pub.publish_at < now() - interval '24 hours' THEN
    RETURN 'publish_at прострочено >24 год';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM publication_platforms WHERE publication_id = p_pub AND platform = 'tg') THEN
    RETURN 'платформа tg не обрана';
  END IF;

  SELECT max(at) INTO v_last_approve FROM publication_history WHERE publication_id = p_pub AND action = 'approve';
  IF v_last_approve IS NULL THEN RETURN 'немає погодження в історії'; END IF;

  SELECT action || ': ' || coalesce(detail, '') INTO v_after
  FROM publication_history
  WHERE publication_id = p_pub AND at > v_last_approve
    AND (action IN ('reject', 'partial_approve')
         OR (action = 'status' AND coalesce(detail, '') <> 'Погоджено → Опубліковано'))
  ORDER BY at
  LIMIT 1;
  IF v_after IS NOT NULL THEN RETURN 'після погодження: ' || left(v_after, 120); END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_publish_allowed(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_publish_allowed(uuid) TO service_role;
