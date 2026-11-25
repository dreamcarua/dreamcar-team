-- 25.11.2026: тип TG-поста. standard = звичайний пост / альбом (сітка), carousel = свайп (sendRichMessage + slideshow).
-- Наявні картки отримують 'standard' з дефолту; updated_at і статуси не чіпаються.
alter table public.publications
  add column if not exists tg_post_type text not null default 'standard';
alter table public.publications drop constraint if exists publications_tg_post_type_check;
alter table public.publications
  add constraint publications_tg_post_type_check check (tg_post_type in ('standard','carousel'));
notify pgrst, 'reload schema';
