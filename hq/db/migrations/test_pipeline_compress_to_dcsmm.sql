-- ============================================================
-- ONE-SHOT TEST PIPELINE — compress + autopost end-to-end
-- ============================================================
-- Спочатку прогони (у порядку): 016e → 017 → 018, потім цей файл.
-- ============================================================

do $$
declare
    v_creative_id  uuid := 'e377a758-f501-46f1-81f9-2b5e18faf08e';
    v_desk_id      uuid := '11111111-1111-1111-1111-111111111111';
    v_dcsmm_test   text := '-1003933841573';
    v_user_id      uuid;
    v_pub_id       uuid;
    v_publish_at   timestamptz := now() + interval '2 minutes';
    v_title        text := 'TEST compress→autopost ' || to_char(now() at time zone 'utc', 'HH24:MI:SS');
begin
    -- 1. Шукаємо Creator. Послідовність:
    --    a) Email vg@abrisart.com (production)
    --    b) Email vg@dreamcar.ua
    --    c) Email vadimgrishin@gmail.com (Google login alias)
    --    d) Перший CEO або COO
    --    e) Перший будь-який active user
    select id into v_user_id from public.users
     where email = 'vg@abrisart.com' and is_active limit 1;

    if v_user_id is null then
      select id into v_user_id from public.users
       where email = 'vg@dreamcar.ua' and is_active limit 1;
    end if;

    if v_user_id is null then
      select id into v_user_id from public.users
       where email = 'vadimgrishin@gmail.com' and is_active limit 1;
    end if;

    if v_user_id is null then
      select id into v_user_id from public.users
       where role in ('ceo','coo') and is_active
       order by created_at asc limit 1;
    end if;

    if v_user_id is null then
      select id into v_user_id from public.users
       where is_active
       order by created_at asc limit 1;
    end if;

    if v_user_id is null then
        raise exception 'Жодного active user не знайдено у public.users. Створи юзера через HQ або вручну.';
    end if;

    raise notice 'Creator user_id: %', v_user_id;
    raise notice 'Publish at:      %', v_publish_at;
    raise notice 'DCSMM chat:      %', v_dcsmm_test;

    -- 2. Reset creative
    update public.creatives
       set compressed_status      = 'pending',
           compressed_url         = null,
           compressed_size_bytes  = null,
           compressed_at          = null,
           compress_error         = null
     where id = v_creative_id;

    if not found then
        raise exception 'Creative % не знайдено. Можливо інший id у БД.', v_creative_id;
    end if;

    -- Якщо 016e застосовано — скинути attempts/started_at теж
    begin
      update public.creatives
         set compress_attempts = 0,
             compress_started_at = null
       where id = v_creative_id;
    exception when undefined_column then
      raise notice '[warn] compress_attempts/compress_started_at колонок немає — застосуй 016e_compress_robustness.sql спочатку';
    end;
    raise notice 'Creative % reset to pending', v_creative_id;

    -- 3. Створюємо publication
    insert into public.publications (
        desk_id, title, publish_at, content_type, text_body, hashtags,
        status, approver_policy, created_by
    ) values (
        v_desk_id,
        v_title,
        v_publish_at,
        'reels'::content_type,
        E'🧪 TEST автопостингу з нового compress-воркера (target-bitrate 2-pass H.264 high).\n\nЯкщо ти це бачиш — значить:\n• 2-pass H.264 high profile target-bitrate спрацював\n• compressed_url зчитався з R2\n• autopost-воркер забрав готове відео\n• sendVideo пройшов inline у Telegram\n\nЦе тестова публікація, її можна видалити.',
        array[]::text[],
        'approved'::publication_status,
        'all'::approver_policy,
        v_user_id
    )
    returning id into v_pub_id;
    raise notice 'Publication % created', v_pub_id;

    insert into public.creative_publications (publication_id, creative_id, sort_order)
    values (v_pub_id, v_creative_id, 0)
    on conflict do nothing;

    insert into public.publication_platforms (publication_id, platform)
    values (v_pub_id, 'tg'::platform)
    on conflict do nothing;

    insert into public.tg_autopost_queue (
        publication_id, status, target_chat_id, enqueued_at, attempts
    ) values (
        v_pub_id, 'pending', v_dcsmm_test, now(), 0
    )
    on conflict (publication_id) where status in ('pending','processing')
       do update set
         target_chat_id = excluded.target_chat_id,
         status = 'pending',
         attempts = 0,
         last_error = null,
         claimed_at = null;

    raise notice '';
    raise notice '═══════════════════════════════════════════════════════════';
    raise notice '✓ Pipeline armed.';
    raise notice '   Pub ID:       %', v_pub_id;
    raise notice '   Creative ID:  %', v_creative_id;
    raise notice '   Publish at:   %', v_publish_at;
    raise notice '   T+0..3 хв  → compress worker';
    raise notice '   T+3..8 хв  → autopost worker → DCSMM';
    raise notice '═══════════════════════════════════════════════════════════';
end $$;

-- ── Перевірка хто у public.users (раскоментуй щоб діагностувати):
-- select id, email, name, role, is_active from public.users order by created_at limit 20;
