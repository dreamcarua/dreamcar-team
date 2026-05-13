-- =====================================================================
-- DreamCar HQ — Стіл SMM
-- Демо-дані (той же набір що в JS-моку)
--
-- ВАЖЛИВО: seed.sql використовує SECURITY DEFINER (обхід RLS) для
-- bulk-вставки. Виконувати через Supabase Dashboard SQL Editor
-- (звідти запити йдуть як service_role, RLS не блокує).
--
-- Якщо потім хочеш скинути дані:
--   truncate publications, creatives, launches, rubrics, users, desks
--   restart identity cascade;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Desk
-- ---------------------------------------------------------------------
insert into desks (id, slug, name, color)
values ('11111111-1111-1111-1111-111111111111', 'smm', 'Стіл SMM', '#cc0000')
on conflict (slug) do update set name = excluded.name;

-- ---------------------------------------------------------------------
-- 2. Users (без auth.users — на dev сервері; в prod auth_id = auth.uid())
-- ---------------------------------------------------------------------
insert into users (id, email, name, role, telegram_username) values
    ('aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vg@abrisart.com',      'Вадим', 'ceo',    null),
    ('aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'smth.mario@gmail.com', 'Давид', 'coo',    null),
    ('aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'lexbelov21@gmail.com', 'Саша',  'lead',   null),
    ('aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '1avrybak@gmail.com',   'Артем', 'member', null),
    ('aaaaaaa5-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'verusya.nec@gmail.com','Віра',  'member', null),
    ('aaaaaaa6-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'vdenishchuk@gmail.com','Вова',  'member', null)
on conflict (email) do nothing;

-- ---------------------------------------------------------------------
-- 3. Desk members (всі учасники одного стола)
-- ---------------------------------------------------------------------
insert into desk_members (desk_id, user_id, desk_role)
select '11111111-1111-1111-1111-111111111111', id, role from users
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 4. Rubrics
-- ---------------------------------------------------------------------
insert into rubrics (id, desk_id, slug, name, color, sort_order) values
    ('bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'sales',   'Продажний',    '#ff6577', 1),
    ('bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'expert',  'Експертний',   '#7ab0ff', 2),
    ('bbbbbbb3-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'fun',     'Розважальний', '#fbbf24', 3),
    ('bbbbbbb4-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'news',    'Новинний',     '#6ee7b7', 4),
    ('bbbbbbb5-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'partner', 'Партнерський', '#c89af0', 5)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. Launches
-- ---------------------------------------------------------------------
insert into launches (id, desk_id, name, starts_on, ends_on, color) values
    ('ccccccc1-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'AUDI E-TRON 2026',      current_date - 10, current_date + 35, '#ff6577'),
    ('ccccccc2-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'BMW X5 Hybrid #17',     current_date - 28, current_date + 14, '#7ab0ff'),
    ('ccccccc3-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'Bren brand-кампанія',   current_date + 5,  current_date + 50, '#fbbf24')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 6. Creatives
-- ---------------------------------------------------------------------
insert into creatives (id, desk_id, name, type, size_bytes, duration_sec, width_px, height_px, tags, uploaded_by, uploaded_at) values
    ('ddddddd1-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Audi-etron-front.jpg',     'photo', 4400000,  null, 4032, 3024, array['audi','etron','front'],     'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '3 days'),
    ('ddddddd2-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Audi-test-drive.mp4',      'video', 134000000, 47,  1080, 1920, array['audi','reels','drive'],    'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '2 days'),
    ('ddddddd3-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'BMW-winner-story.mp4',     'video', 220000000, 89,  1080, 1920, array['bmw','x5','winner'],       'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '5 days'),
    ('ddddddd4-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Tech-vacuum-process.mp4',  'video', 89000000,  32,  1920, 1080, array['tech','process','behind'], 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '7 days'),
    ('ddddddd5-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Team-photo-spring.jpg',    'photo', 2900000,   null, 3024, 4032, array['team','spring','office'],  'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '8 days'),
    ('ddddddd6-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Static-promo-bf.png',      'photo', 920000,    null, 1080, 1080, array['promo','bf','design'],     'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '1 day'),
    ('ddddddd7-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Carousel-1-numbers.png',   'photo', 730000,    null, 1080, 1350, array['carousel','stats'],        'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '4 days'),
    ('ddddddd8-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Funny-bts-fail.mp4',       'video', 56000000,  22,  1080, 1920, array['fun','bts','fail'],        'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '2 days'),
    ('ddddddd9-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'TZ-onboarding.pdf',        'doc',   1200000,   null, null, null, array['doc','onboarding'],        'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '12 days'),
    ('dddddda1-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'BMW-handover-emotion.jpg', 'photo', 5800000,   null, 4032, 3024, array['bmw','winner','emotion'],  'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '6 days'),
    ('dddddda2-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'YT-shorts-teaser.mp4',     'video', 39000000,  18,  1080, 1920, array['yt','shorts','teaser'],    'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '1 day'),
    ('dddddda3-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', 'Wallpaper-audi-night.jpg', 'photo', 7400000,   null, 4032, 6048, array['audi','wallpaper','night'],'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '9 days')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 7. Publications
-- ---------------------------------------------------------------------
insert into publications (id, desk_id, title, publish_at, content_type, text_body, hashtags, rubric_id, launch_id, status, deadline_on, created_by, created_at, updated_at) values
    ('eeeeeee1-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'Audi E-tron — перші тест-драйви',
        current_date - interval '12 days' + interval '14 hours', 'reels',
        E'Текст для публікації «Audi E-tron — перші тест-драйви».\nЛід-абзац. Розкриття. CTA.',
        array['#dreamcar','#автомрії','#expert'],
        'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ccccccc1-cccc-cccc-cccc-cccccccccccc',
        'published', current_date - 14, 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '15 days', now() - interval '12 days'),

    ('eeeeeee2-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'BMW X5 #17 — момент передачі ключів',
        current_date - interval '5 days' + interval '18 hours', 'reels',
        'Емоційний пост про щасливого власника.',
        array['#dreamcar','#bmw','#winner'],
        'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ccccccc2-cccc-cccc-cccc-cccccccccccc',
        'published', current_date - 7, 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '8 days', now() - interval '5 days'),

    ('eeeeeee3-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', '5 фактів про мікрохвильово-вакуумну сушку',
        current_date - interval '1 day' + interval '11 hours', 'carousel',
        'Освітній контент про технологію.',
        array['#dreamcar','#tech'],
        'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null,
        'rework', current_date - 3, 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '5 days', now() - interval '1 day'),

    ('eeeeeee4-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'AUDI E-TRON — фінальний countdown',
        current_date + interval '0 days' + interval '20 hours', 'post',
        'Сьогодні — фінал розіграшу. Останній шанс.',
        array['#dreamcar','#audi','#final'],
        'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ccccccc1-cccc-cccc-cccc-cccccccccccc',
        'review', current_date, 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '3 days', now()),

    ('eeeeeee5-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'Інтерв''ю з власником Audi #5',
        current_date + interval '1 day' + interval '17 hours', 'reels',
        'Розмова з реальним переможцем.',
        array['#dreamcar','#audi','#interview'],
        'bbbbbbb4-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ccccccc1-cccc-cccc-cccc-cccccccccccc',
        'review', current_date + 0, 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '4 days', now()),

    ('eeeeeee6-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'Дайджест тижня',
        current_date + interval '2 days' + interval '10 hours', 'carousel',
        'Що відбувалося — короткою стрічкою.',
        array['#dreamcar','#digest'],
        'bbbbbbb4-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null,
        'in_work', current_date + 1, 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '2 days', now() - interval '1 hour'),

    ('eeeeeee7-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'Mythbusting токенів',
        current_date + interval '3 days' + interval '15 hours', 'reels',
        'Розвінчуємо міфи про участь.',
        array['#dreamcar','#mythbusting'],
        'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null,
        'in_work', current_date + 2, 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '1 day', now()),

    ('eeeeeee8-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'Розпаковка — нове авто на склад',
        current_date + interval '5 days' + interval '13 hours', 'reels',
        'Емоційне розкриття нового авто.',
        array['#dreamcar','#unbox'],
        'bbbbbbb3-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ccccccc3-cccc-cccc-cccc-cccccccccccc',
        'draft', current_date + 3, 'aaaaaaa4-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '1 hour', now() - interval '1 hour'),

    ('eeeeeee9-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'Команда зростає — нова вакансія SMM',
        current_date + interval '6 days' + interval '12 hours', 'post',
        'Шукаємо SMM-менеджера у команду.',
        array['#dreamcar','#hr'],
        'bbbbbbb4-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null,
        'draft', current_date + 4, 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '2 hours', now()),

    ('eeeeeeea-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'Black Friday — фінальна заявка',
        current_date + interval '12 days' + interval '19 hours', 'post',
        'Останній день промо-кампанії.',
        array['#dreamcar','#bf','#promo'],
        'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb', null,
        'draft', current_date + 10, 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '3 hours', now()),

    ('eeeeeeeb-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', 'Підсумок місяця — цифри і перемоги',
        current_date + interval '14 days' + interval '11 hours', 'carousel',
        'Усе важливе за минулий місяць.',
        array['#dreamcar','#month'],
        'bbbbbbb4-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'ccccccc3-cccc-cccc-cccc-cccccccccccc',
        'draft', current_date + 12, 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', now() - interval '4 hours', now())
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 8. Publication platforms
-- ---------------------------------------------------------------------
insert into publication_platforms (publication_id, platform) values
    ('eeeeeee1-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeee1-eeee-eeee-eeee-eeeeeeeeeeee', 'tt'),
    ('eeeeeee1-eeee-eeee-eeee-eeeeeeeeeeee', 'yt'),
    ('eeeeeee2-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeee2-eeee-eeee-eeee-eeeeeeeeeeee', 'tt'),
    ('eeeeeee3-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeee4-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeee4-eeee-eeee-eeee-eeeeeeeeeeee', 'tg'),
    ('eeeeeee4-eeee-eeee-eeee-eeeeeeeeeeee', 'fb'),
    ('eeeeeee5-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeee5-eeee-eeee-eeee-eeeeeeeeeeee', 'yt'),
    ('eeeeeee6-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeee6-eeee-eeee-eeee-eeeeeeeeeeee', 'tg'),
    ('eeeeeee7-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeee7-eeee-eeee-eeee-eeeeeeeeeeee', 'tt'),
    ('eeeeeee8-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeee8-eeee-eeee-eeee-eeeeeeeeeeee', 'tt'),
    ('eeeeeee8-eeee-eeee-eeee-eeeeeeeeeeee', 'yt'),
    ('eeeeeee9-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeee9-eeee-eeee-eeee-eeeeeeeeeeee', 'tg'),
    ('eeeeeee9-eeee-eeee-eeee-eeeeeeeeeeee', 'th'),
    ('eeeeeeea-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeeea-eeee-eeee-eeee-eeeeeeeeeeee', 'tg'),
    ('eeeeeeea-eeee-eeee-eeee-eeeeeeeeeeee', 'fb'),
    ('eeeeeeeb-eeee-eeee-eeee-eeeeeeeeeeee', 'ig'),
    ('eeeeeeeb-eeee-eeee-eeee-eeeeeeeeeeee', 'tg')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 9. Responsibles
-- ---------------------------------------------------------------------
insert into publication_responsibles (publication_id, user_id, role)
select id, created_by, 'generic'::responsibility from publications
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 10. Approvers — CEO на все
-- ---------------------------------------------------------------------
insert into publication_approvers (publication_id, user_id)
select id, 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa' from publications
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 11. Creative-publication links (приклади)
-- ---------------------------------------------------------------------
insert into creative_publications (publication_id, creative_id) values
    ('eeeeeee1-eeee-eeee-eeee-eeeeeeeeeeee', 'ddddddd2-dddd-dddd-dddd-dddddddddddd'),
    ('eeeeeee2-eeee-eeee-eeee-eeeeeeeeeeee', 'ddddddd3-dddd-dddd-dddd-dddddddddddd'),
    ('eeeeeee2-eeee-eeee-eeee-eeeeeeeeeeee', 'dddddda1-dddd-dddd-dddd-dddddddddddd'),
    ('eeeeeee3-eeee-eeee-eeee-eeeeeeeeeeee', 'ddddddd7-dddd-dddd-dddd-dddddddddddd'),
    ('eeeeeee4-eeee-eeee-eeee-eeeeeeeeeeee', 'ddddddd1-dddd-dddd-dddd-dddddddddddd'),
    ('eeeeeee5-eeee-eeee-eeee-eeeeeeeeeeee', 'ddddddd2-dddd-dddd-dddd-dddddddddddd'),
    ('eeeeeee6-eeee-eeee-eeee-eeeeeeeeeeee', 'ddddddd7-dddd-dddd-dddd-dddddddddddd'),
    ('eeeeeee8-eeee-eeee-eeee-eeeeeeeeeeee', 'ddddddd8-dddd-dddd-dddd-dddddddddddd'),
    ('eeeeeeea-eeee-eeee-eeee-eeeeeeeeeeee', 'ddddddd6-dddd-dddd-dddd-dddddddddddd')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 12. Зразкові коментарі і історія (для тестування UI)
-- ---------------------------------------------------------------------
insert into comments (publication_id, author_id, body) values
    ('eeeeeee3-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     'Чудовий ракурс, тільки текст переробіть: третій абзац здається зайвим.');

insert into publication_history (publication_id, actor_id, action, detail) values
    ('eeeeeee3-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'create',  ''),
    ('eeeeeee3-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaa3-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'status',  'Чернетка → На погодженні'),
    ('eeeeeee3-eeee-eeee-eeee-eeeeeeeeeeee', 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'reject',  'Текст переробити');

-- ---------------------------------------------------------------------
-- Готово. Дані сіяні.
-- =====================================================================
