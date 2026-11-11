-- 11.11.2026 (Вадим): бот у чатах команди має сам аналізувати результат публікацій.
-- Нові види для team_bot_find (лише читання, без даних учасників, без витрат на рекламу):
--   ig_posts   — пости/рілс IG зі статистикою (пошук: shortcode/посилання, текст підпису або дата YYYY-MM-DD)
--   ig_stories — сторіз IG зі статистикою (пошук: дата YYYY-MM-DD)
--   ig_account — денні показники акаунту IG (пошук: дата YYYY-MM-DD = від цієї дати)
--   tg_posts   — статистика постів у TG-каналі (перегляди, реакції, пересилання, кліки кнопок) по картках HQ
--   sales      — оплати по UTM у вікні часу: кількість і сума, згруповано. Пошук = JSON:
--                {"from":"2026-11-10T20:00","to":"2026-11-11T20:00","group":"utm_medium|utm_campaign|utm_content|utm_source|hour","medium":"instagram_reels","project":"RANGE"}
--                час без зони = Київ; сума — виручка (без витрат, без прибутку, без контактів).
CREATE OR REPLACE FUNCTION public.team_bot_find(p_kind text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v jsonb; q text := nullif(trim(coalesce(p_search, '')), ''); n int := least(greatest(coalesce(p_limit, 20), 1), 30);
  d date; s jsonb; t_from timestamptz; t_to timestamptz; grp text;
BEGIN
  BEGIN d := q::date; EXCEPTION WHEN others THEN d := NULL; END;
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
      SELECT l.id, l.name, l.code, l.cycle_no, l.kind, l.status::text AS status, l.starts_at, l.stop_at, l.live_at, l.live_url, l.packages, l.deal_aliases
        FROM launches l
       WHERE (q IS NULL OR l.name ILIKE '%' || q || '%' OR l.code ILIKE '%' || q || '%')
       ORDER BY l.starts_at DESC NULLS LAST LIMIT n) r;
  ELSIF p_kind = 'history' THEN
    SELECT coalesce(jsonb_agg(r), '[]') INTO v FROM (
      SELECT h.publication_id, h.action, h.detail, h.at FROM publication_history h
       WHERE q IS NOT NULL AND h.publication_id::text = q ORDER BY h.at DESC LIMIT n) r;
  ELSIF p_kind = 'ig_posts' THEN
    SELECT coalesce(jsonb_agg(r), '[]') INTO v FROM (
      SELECT m.permalink, m.media_product_type AS type, m.published_at AT TIME ZONE 'Europe/Kyiv' AS published_kyiv,
             left(m.caption, 300) AS caption, m.views, m.plays, m.reach, m.like_count AS likes, m.comments_count AS comments,
             m.saved, m.shares, m.total_interactions, m.engagement_rate, m.profile_visits, m.avg_watch_sec, m.replays,
             m.hook_type, m.has_cta, m.synced_at
        FROM dashboard_ig_media m
       WHERE q IS NULL OR m.permalink ILIKE '%' || q || '%' OR m.caption ILIKE '%' || q || '%'
          OR (d IS NOT NULL AND (m.published_at AT TIME ZONE 'Europe/Kyiv')::date = d)
       ORDER BY m.published_at DESC LIMIT n) r;
  ELSIF p_kind = 'ig_stories' THEN
    SELECT coalesce(jsonb_agg(r), '[]') INTO v FROM (
      SELECT s2.permalink, s2.media_type, s2.published_at AT TIME ZONE 'Europe/Kyiv' AS published_kyiv, s2.reach, s2.replies,
             s2.exits, s2.taps_forward, s2.taps_back, s2.total_interactions, s2.synced_at
        FROM dashboard_ig_stories s2
       WHERE q IS NULL OR (d IS NOT NULL AND (s2.published_at AT TIME ZONE 'Europe/Kyiv')::date = d)
       ORDER BY s2.published_at DESC LIMIT n) r;
  ELSIF p_kind = 'ig_account' THEN
    SELECT coalesce(jsonb_agg(r), '[]') INTO v FROM (
      SELECT a.date, a.followers_count, a.reach, a.profile_views, a.website_clicks, a.accounts_engaged, a.total_interactions
        FROM dashboard_ig_account_daily a
       WHERE d IS NULL OR a.date >= d
       ORDER BY a.date DESC LIMIT n) r;
  ELSIF p_kind = 'tg_posts' THEN
    SELECT coalesce(jsonb_agg(r), '[]') INTO v FROM (
      SELECT t.publication_id, p.title, t.first_published_at AT TIME ZONE 'Europe/Kyiv' AS published_kyiv, t.views,
             t.reactions_total, t.forwards, t.clicks_total, t.clicks_by_button, t.comments_count, t.last_synced_at
        FROM tg_post_analytics t LEFT JOIN publications p ON p.id = t.publication_id
       WHERE q IS NULL OR t.publication_id::text = q OR p.title ILIKE '%' || q || '%'
          OR (d IS NOT NULL AND (t.first_published_at AT TIME ZONE 'Europe/Kyiv')::date = d)
       ORDER BY t.first_published_at DESC NULLS LAST LIMIT n) r;
  ELSIF p_kind = 'sales' THEN
    BEGIN s := coalesce(q, '{}')::jsonb; EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('error', 'sales: search must be JSON {"from","to","group","medium","campaign","content","project"}'); END;
    t_from := coalesce((s->>'from')::timestamp AT TIME ZONE 'Europe/Kyiv', now() - interval '24 hours');
    t_to   := coalesce((s->>'to')::timestamp AT TIME ZONE 'Europe/Kyiv', now());
    IF t_to - t_from > interval '45 days' THEN RETURN jsonb_build_object('error', 'sales: window max 45 days'); END IF;
    grp := coalesce(s->>'group', 'utm_medium');
    IF grp NOT IN ('utm_medium','utm_campaign','utm_content','utm_source','utm_term','hour','day','project','tariff') THEN
      RETURN jsonb_build_object('error', 'sales: group must be utm_medium|utm_campaign|utm_content|utm_source|utm_term|hour|day|project|tariff'); END IF;
    SELECT jsonb_build_object(
      'window_kyiv', jsonb_build_array(t_from AT TIME ZONE 'Europe/Kyiv', t_to AT TIME ZONE 'Europe/Kyiv'),
      'group', grp,
      'total', (SELECT jsonb_build_object('payments', count(*), 'revenue_uah', round(coalesce(sum(amount),0)))
                  FROM dashboard_deals dd WHERE dd.status = 'pay' AND dd.paid_at >= t_from AND dd.paid_at < t_to
                   AND (s->>'medium' IS NULL OR dd.utm_medium ILIKE s->>'medium')
                   AND (s->>'campaign' IS NULL OR dd.utm_campaign ILIKE '%' || (s->>'campaign') || '%')
                   AND (s->>'content' IS NULL OR dd.utm_content ILIKE '%' || (s->>'content') || '%')
                   AND (s->>'project' IS NULL OR dd.project ILIKE '%' || (s->>'project') || '%')),
      'rows', coalesce((SELECT jsonb_agg(x ORDER BY x.payments DESC) FROM (
          SELECT CASE grp WHEN 'hour' THEN to_char(dd.paid_at AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD HH24:00')
                          WHEN 'day'  THEN to_char(dd.paid_at AT TIME ZONE 'Europe/Kyiv', 'YYYY-MM-DD')
                          WHEN 'utm_campaign' THEN dd.utm_campaign WHEN 'utm_content' THEN dd.utm_content
                          WHEN 'utm_source' THEN dd.utm_source WHEN 'utm_term' THEN dd.utm_term
                          WHEN 'project' THEN dd.project WHEN 'tariff' THEN dd.tariff
                          ELSE dd.utm_medium END AS key,
                 count(*) AS payments, round(coalesce(sum(dd.amount),0)) AS revenue_uah
            FROM dashboard_deals dd
           WHERE dd.status = 'pay' AND dd.paid_at >= t_from AND dd.paid_at < t_to
             AND (s->>'medium' IS NULL OR dd.utm_medium ILIKE s->>'medium')
             AND (s->>'campaign' IS NULL OR dd.utm_campaign ILIKE '%' || (s->>'campaign') || '%')
             AND (s->>'content' IS NULL OR dd.utm_content ILIKE '%' || (s->>'content') || '%')
             AND (s->>'project' IS NULL OR dd.project ILIKE '%' || (s->>'project') || '%')
           GROUP BY 1 ORDER BY 2 DESC LIMIT 60) x), '[]'::jsonb),
      'note', 'utm_medium з префіксом facebook_/instagram_/messenger_ = платна реклама Meta; account/post/stories/postpush/telegram_bot/tma/threads_feed = органіка й власні канали; ціль UTM у картці публікації не зберігається — зіставляй за часом і utm_medium/utm_content')
    INTO v;
    RETURN v;
  ELSE
    RETURN jsonb_build_object('error', 'kind must be publications | retention | launches | history | ig_posts | ig_stories | ig_account | tg_posts | sales');
  END IF;
  RETURN jsonb_build_object('rows', v);
END;
$function$;
REVOKE ALL ON FUNCTION public.team_bot_find(text, text, integer) FROM public, anon, authenticated;
