-- 11.11.2026 Бібліотека: статус обробки відео в library_data().
-- Колонка creatives.compressed_status вже існує (pending → processing → ready | failed; старі записи 'n/a').
-- Нової колонки не додаємо: фронт трактує 'n/a' як «Готово». Тут лише віддаємо статус у бібліотеку:
-- items[20] = compressed_status, items[21] = compress_error, items[22] = compress_started_at.
-- Відкат: 2026-11-11_library_media_status_rollback.sql
CREATE OR REPLACE FUNCTION public.library_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_role text; v_uid uuid := public.current_user_id();
begin
  select u.role::text into v_role from public.users u where u.id = v_uid;
  if v_role is null then raise exception 'Немає доступу' using errcode = '42501'; end if;
  return jsonb_build_object(
    'me', v_uid, 'role', v_role,
    'can_edit', v_role in ('ceo','coo','lead','member','designer'),
    'can_delete', v_role in ('ceo','coo','lead'),
    'launches', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'cycle_no', l.cycle_no, 'kind', l.kind,
        'status', l.status, 'starts_on', l.starts_on, 'ends_on', l.ends_on) order by l.starts_on desc nulls last)
      from public.launches l where l.is_active and (l.kind = 'raffle' or exists (select 1 from public.creatives c where c.launch_id = l.id and c.deleted_at is null))), '[]'::jsonb),
    'events', case when public.general_can_read() then coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'launch_id', e.launch_id,
        'title', e.title, 'day', e.plan_day, 'audience', e.audience) order by e.starts_at)
      from public.ad_events e where e.launch_id is not null and e.status <> 'cancelled' and e.kind <> 'live'), '[]'::jsonb) else '[]'::jsonb end,
    'users', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.name)) from public.users u
      where exists (select 1 from public.creatives c where c.uploaded_by = u.id and c.deleted_at is null)), '[]'::jsonb),
    -- компактні рядки: [id, name, type, size_bytes, duration, w, h, uploaded_at, uploaded_by, launch_id, ad_event_id, format, folder_source, used_n, last_used_at, poster, thumb, compressed, compressed_hevc, tags, compressed_status, compress_error, compress_started_at]
    'items', coalesce((select jsonb_agg(jsonb_build_array(c.id, c.name, c.type, c.size_bytes, c.duration_sec, c.width_px, c.height_px,
        c.uploaded_at, c.uploaded_by, c.launch_id, c.ad_event_id, c.format, c.folder_source,
        coalesce(u.n, 0), u.last_at, c.poster_url, c.thumbnail_url, c.compressed_url, c.compressed_url_hevc, c.tags,
        c.compressed_status, case when c.compressed_status = 'failed' then left(c.compress_error, 200) end, c.compress_started_at)
        order by c.uploaded_at desc nulls last, c.id)
      from public.creatives c
      left join lateral (select count(*) n, max(p.publish_at) last_at from public.creative_publications cp
                         join public.publications p on p.id = cp.publication_id and p.deleted_at is null
                         where cp.creative_id = c.id) u on true
      where c.deleted_at is null), '[]'::jsonb)
  );
end $function$;
