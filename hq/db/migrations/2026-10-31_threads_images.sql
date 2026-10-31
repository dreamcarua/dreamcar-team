-- 31.10.2026 · Threads: картинки до постів (applied via Supabase MCP as migration threads_images_v1)
alter table public.threads_queue
  add column if not exists image_url text,
  add column if not exists image_brief jsonb,          -- {concept, overlay, mood} від плану дня
  add column if not exists image_status text check (image_status in ('wanted','generating','ready','failed','library','text_only')),
  add column if not exists image_creative_id uuid;     -- рядок public.creatives, якщо картинку зробив creative-director
create index if not exists threads_queue_image_wanted on public.threads_queue(image_status) where image_status in ('wanted','generating');
-- threads_config: image_posts_per_day (2), image_wait_min (25), image_library (12 URL фіналів проєкту №23 з медіабази)
