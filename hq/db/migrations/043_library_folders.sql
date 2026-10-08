-- 042_library_folders.sql — бібліотека креативів: папки Проєкт → Акція → Формат (08.10.2026).
-- Застосовано через Supabase MCP (043_library_folders). Бекфіл: 441 файл за публікаціями,
-- 665 за датою завантаження; акцію визначено для 41, формат для 475. UI: hq/app-library-folders.js.
-- Повні тіла функцій library_guess_launch, library_guess_event, library_on_creative_insert,
-- library_on_creative_pub, library_folders, library_assign — у БД (pg_get_functiondef). Суть:
--  • creatives.launch_id / ad_event_id / format (stories|reels|post|carousel) / folder_source (publication|upload_window|manual)
--  • новий файл → проєкт за датою: розіграш, у вікні якого [старт−14; ефір або кінець+1] лежить дата завантаження
--  • креатив додали в публікацію → проєкт публікації, акція = єдина загальна акція цього дня, формат = content_type
--    (ручне перенесення folder_source='manual' не перетирається)
--  • library_folders() — мапа для UI (акції не віддаються ролі media); library_assign() — ceo/coo/lead/member/designer
alter table public.creatives
  add column if not exists launch_id uuid references public.launches(id) on delete set null,
  add column if not exists ad_event_id bigint references public.ad_events(id) on delete set null,
  add column if not exists format text,
  add column if not exists folder_source text;
create index if not exists creatives_launch_idx on public.creatives(launch_id, ad_event_id);
