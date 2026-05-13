-- =====================================================================
-- Migration 010 — Publication templates (B3)
-- =====================================================================
-- Шаблони публікацій з заданими полями (платформи, рубрика, час, ЦА,
-- відповідальні-за-замовчанням). SMM натискає «З шаблону» → 80% полів
-- заповнюються автоматично.
-- =====================================================================

create table if not exists public.pub_templates (
  id          uuid primary key default gen_random_uuid(),
  desk_id     uuid not null references public.desks(id) on delete cascade,
  name        text not null,
  description text,
  icon        text default '📋',
  preset_data jsonb not null default '{}'::jsonb,
  visible_for_user_ids uuid[],
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists idx_pub_templates_desk on public.pub_templates(desk_id);
create index if not exists idx_pub_templates_created on public.pub_templates(created_at desc);

comment on table public.pub_templates is
  'Шаблони публікацій. preset_data — JSON з полями: platforms[], rubric, time, audience, tone, length, responsibles[], approvers[], hashtags[]';

-- RLS
alter table public.pub_templates enable row level security;

drop policy if exists "templates: read all" on public.pub_templates;
create policy "templates: read all" on public.pub_templates
  for select to authenticated
  using (true);

drop policy if exists "templates: write by lead+" on public.pub_templates;
create policy "templates: write by lead+" on public.pub_templates
  for all to authenticated
  using (
    exists(
      select 1 from public.users u
      where u.auth_id = auth.uid()
        and u.role in ('ceo', 'coo', 'team_lead')
    )
  )
  with check (
    exists(
      select 1 from public.users u
      where u.auth_id = auth.uid()
        and u.role in ('ceo', 'coo', 'team_lead')
    )
  );

create or replace function update_pub_templates_updated_at() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_pub_templates_updated_at on public.pub_templates;
create trigger trg_pub_templates_updated_at
  before update on public.pub_templates
  for each row execute function update_pub_templates_updated_at();

-- =====================================================================
-- Seed: 4 default templates для DreamCar SMM desk
-- =====================================================================

insert into public.pub_templates (desk_id, name, description, icon, preset_data) values
  (
    '11111111-1111-1111-1111-111111111111',
    'Анонс переможця',
    'Оголошення переможця сезону. IG+TG+FB о 20:00.',
    '🏆',
    jsonb_build_object(
      'platforms', jsonb_build_array('ig', 'tg', 'fb'),
      'rubric', 'winner_announcement',
      'time', '20:00',
      'audience', 'спільнота DreamCar — активні учасники + новачки',
      'tone', 'playful',
      'length', 'medium',
      'hashtags', jsonb_build_array('#DreamCar', '#Переможець', '#СпільнотаDreamCar'),
      'contentType', 'reel'
    )
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'Новий запуск авто',
    'Анонс нового проєкту-сезону з конкретним авто. Серія постів IG+TG+FB+TikTok.',
    '🚗',
    jsonb_build_object(
      'platforms', jsonb_build_array('ig', 'tg', 'fb', 'tt'),
      'rubric', 'product_launch',
      'time', '12:00',
      'audience', 'нові потенційні учасники + поточна аудиторія',
      'tone', 'salesy',
      'length', 'long',
      'hashtags', jsonb_build_array('#DreamCar', '#НовийСезон', '#АвтоМрії'),
      'contentType', 'carousel'
    )
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'Експертний пост про AI',
    'Пост про AI-сервіс, його застосування. Telegram + LinkedIn (через Threads).',
    '🤖',
    jsonb_build_object(
      'platforms', jsonb_build_array('tg', 'th'),
      'rubric', 'expert_content',
      'time', '14:00',
      'audience', 'продуктові спеціалісти, маркетологи, B2B-аудиторія',
      'tone', 'expert',
      'length', 'long',
      'hashtags', jsonb_build_array('#AI', '#DreamCar', '#ШІдляБізнесу'),
      'contentType', 'post'
    )
  ),
  (
    '11111111-1111-1111-1111-111111111111',
    'Сторіз — UGC',
    'Швидкий сторіз з контентом учасника. Тільки IG Stories.',
    '📸',
    jsonb_build_object(
      'platforms', jsonb_build_array('ig'),
      'rubric', 'ugc',
      'time', '18:00',
      'audience', 'спільнота — поточні активні',
      'tone', 'casual',
      'length', 'short',
      'hashtags', jsonb_build_array('#DreamCarUGC', '#СпільнотаDreamCar'),
      'contentType', 'story'
    )
  )
on conflict do nothing;

-- Перевірка:
-- select id, name, icon, preset_data from public.pub_templates order by created_at;
