-- ============================================================
-- ONE-SHOT TEST PIPELINE — compress + autopost end-to-end
-- ============================================================
-- Призначення: за один прохід перевірити новий target-bitrate воркер
-- (commit fa235c7) ТА автопостинг у DCSMM test-канал.
--
-- ШО ПРОИЗОЙДЕ після виконання:
--   1. IMG_5405.MP4 (id e377a758-...) → compressed_status='pending'
--      cron-воркер `Compress Creative Worker` за ≤3 хв підхопить,
--      пройде через 2-pass H.264 high profile target-bitrate ≤49.5MB,
--      залиє у R2 і поставить compressed_status='ready'.
--   2. Створюється test publication "TEST compress→autopost <timestamp>"
--      зі статусом 'approved' і publish_at = NOW() + 8 хвилин.
--   3. Створюється tg_autopost_queue row з target_chat_id = DCSMM test (-1003933841573).
--   4. На +8min cron-воркер `TG Autopost` забере pub, побачить
--      compressed_status='ready', використає compressed_url, надішле sendVideo.
--
-- ПЕРЕДУМОВИ:
--   • Creative id 'e377a758-f501-46f1-81f9-2b5e18faf08e' існує (IMG_5405.MP4).
--   • desk_id 11111111-1111-1111-1111-111111111111 (smm) існує (з seed.sql).
--   • Вадим зареєстрований у public.users (auth_id linked).
--
-- ВИКОНАННЯ: Supabase Dashboard → SQL Editor → New Query → paste → Run.
-- ============================================================

do $$
declare
    v_creative_id  uuid := 'e377a758-f501-46f1-81f9-2b5e18faf08e';
    v_desk_id      uuid := '11111111-1111-1111-1111-111111111111';
    v_dcsmm_test   text := '-1003933841573';
    v_user_id      uuid;
    v_pub_id       uuid;
    v_publish_at   timestamptz := now() + interval '8 minutes';
    v_title        text := 'TEST compress→autopost ' || to_char(now() at time zone 'utc', 'HH24:MI:SS');
begin
    -- 1. Знайдемо Вадима (creator)
    select id into v_user_id
      from public.users
     where email = 'vg@abrisart.com'
       and is_active = true
     limit 1;

    if v_user_id is null then
        raise exception 'User vg@abrisart.com not found in public.users';
    end if;

    raise notice 'Creator: % | Publish at: % | DCSMM: %', v_user_id, v_publish_at, v_dcsmm_test;

    -- 2. Reset creative до pending (новий target-bitrate worker перепроцесить)
    update public.creatives
       set compressed_status      = 'pending',
           compressed_url         = null,
           compressed_size_bytes  = null,
           compressed_at          = null,
           compress_attempts      = 0,
           compress_error         = null
     where id = v_creative_id;

    if not found then
        raise exception 'Creative % not found', v_creative_id;
    end if;
    raise notice 'Creative % reset to pending', v_creative_id;

    -- 3. Створюємо publication (status='approved' щоб не вимагав схвалень)
    insert into public.publications (
        desk_id, title, publish_at, content_type, text_body, hashtags,
        status, approver_policy, created_by
    ) values (
        v_desk_id,
        v_title,
        v_publish_at,
        'reels'::content_type,
        E'🧪 TEST автопостингу з нового compress-воркера.\n\nЯкщо ти це бачиш — значить:\n• 2-pass H.264 high profile target-bitrate спрацював\n• compressed_url зчитався з R2\n• autopost-воркер забрав готове відео\n• sendVideo пройшов inline у Telegram\n\nЦе тестова публікація, її можна видалити.',
        array[]::text[],
        'approved'::publication_status,
        'all'::approver_policy,
        v_user_id
    )
    returning id into v_pub_id;

    raise notice 'Publication % created', v_pub_id;

    -- 4. Прив'язуємо креатив до публікації
    insert into public.creative_publications (publication_id, creative_id, sort_order)
    values (v_pub_id, v_creative_id, 0);

    -- 5. Прив'язуємо платформу TG
    insert into public.publication_platforms (publication_id, platform)
    values (v_pub_id, 'tg'::platform);

    -- 6. Створюємо queue-row для DCSMM test
    insert into public.tg_autopost_queue (
        publication_id, status, target_chat_id, enqueued_at, attempts
    ) values (
        v_pub_id, 'pending', v_dcsmm_test, v_publish_at, 0
    );

    raise notice 'Autopost queue row inserted for chat %', v_dcsmm_test;
    raise notice '';
    raise notice '═══════════════════════════════════════════════════════════';
    raise notice '✓ Pipeline armed. Очікувані події:';
    raise notice '   T+0..3 хв   → compress worker підхопить creative';
    raise notice '   T+8 хв      → autopost worker надішле у DCSMM (-1003933841573)';
    raise notice '';
    raise notice '   Pub ID:       %', v_pub_id;
    raise notice '   Creative ID:  %', v_creative_id;
    raise notice '   Publish at:   %', v_publish_at;
    raise notice '═══════════════════════════════════════════════════════════';
end $$;

-- Перевірочні запити (раскоментуй щоб бачити стан):
-- select id, compressed_status, compressed_url, compressed_size_bytes
--   from creatives where id = 'e377a758-f501-46f1-81f9-2b5e18faf08e';
-- select id, title, status, publish_at, autopost_status
--   from publications where title like 'TEST compress%' order by created_at desc limit 1;
-- select status, target_chat_id, attempts, last_error
--   from tg_autopost_queue
--  where publication_id = (select id from publications where title like 'TEST compress%' order by created_at desc limit 1);
