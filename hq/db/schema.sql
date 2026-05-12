-- =====================================================================
-- DreamCar HQ — Стіл SMM (Пілот)
-- Postgres-схема для Supabase
-- v1.1 — травень 2026
--
-- Виконання: Supabase Dashboard → SQL Editor → New Query → Run
-- Або:       supabase db push (якщо використовуєш CLI)
--
-- Порядок:
--   1. schema.sql  (цей файл)        — таблиці, типи, тригери
--   2. rls.sql                       — Row-Level Security політики
--   3. seed.sql                      — демо-дані
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";        -- для повнотекстового пошуку

-- ---------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------
create type user_role        as enum ('ceo', 'coo', 'lead', 'member', 'designer');
create type publication_status as enum ('draft', 'in_work', 'review', 'approved', 'published', 'rework');
create type content_type     as enum ('post', 'reels', 'stories', 'carousel', 'longread');
create type platform         as enum ('ig', 'tg', 'tt', 'th', 'yt', 'fb');
create type creative_type    as enum ('photo', 'video', 'doc', 'audio');
create type approver_policy  as enum ('all', 'any');
create type responsibility   as enum ('scriptwriter', 'videographer', 'editor', 'publisher', 'generic');

-- ---------------------------------------------------------------------
-- users
-- Інтегровано з Supabase Auth (auth.users) — id = auth.uid()
-- ---------------------------------------------------------------------
create table users (
    id          uuid primary key default uuid_generate_v4(),
    auth_id     uuid unique references auth.users(id) on delete cascade,
    email       text unique not null,
    name        text not null,
    initial     text generated always as (upper(substring(name, 1, 1))) stored,
    role        user_role not null default 'member',
    telegram_username text,
    avatar_url  text,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index idx_users_role on users(role);

-- ---------------------------------------------------------------------
-- user_vacations (v1.1 — auto-delegation при відпустці)
-- ---------------------------------------------------------------------
create table user_vacations (
    id          uuid primary key default uuid_generate_v4(),
    user_id     uuid not null references users(id) on delete cascade,
    from_date   date not null,
    to_date     date not null,
    delegate_to uuid references users(id),
    note        text,
    created_at  timestamptz not null default now(),
    check (to_date >= from_date)
);
create index idx_vacations_user on user_vacations(user_id);
create index idx_vacations_range on user_vacations(from_date, to_date);

-- ---------------------------------------------------------------------
-- desks (на пілоті — один SMM)
-- ---------------------------------------------------------------------
create table desks (
    id          uuid primary key default uuid_generate_v4(),
    slug        text unique not null,
    name        text not null,
    color       text,
    created_at  timestamptz not null default now()
);
insert into desks (slug, name, color) values ('smm', 'Стіл SMM', '#cc0000') on conflict do nothing;

-- ---------------------------------------------------------------------
-- desk_members (зв'язок користувачів зі столами + роль усередині стола)
-- ---------------------------------------------------------------------
create table desk_members (
    desk_id     uuid not null references desks(id) on delete cascade,
    user_id     uuid not null references users(id) on delete cascade,
    desk_role   user_role not null,
    added_at    timestamptz not null default now(),
    primary key (desk_id, user_id)
);

-- ---------------------------------------------------------------------
-- rubrics
-- ---------------------------------------------------------------------
create table rubrics (
    id          uuid primary key default uuid_generate_v4(),
    desk_id     uuid not null references desks(id) on delete cascade,
    slug        text not null,
    name        text not null,
    color       text,
    sort_order  int not null default 0,
    created_at  timestamptz not null default now(),
    unique (desk_id, slug)
);

-- ---------------------------------------------------------------------
-- launches (запуски — спрощені проєкти)
-- ---------------------------------------------------------------------
create table launches (
    id          uuid primary key default uuid_generate_v4(),
    desk_id     uuid not null references desks(id) on delete cascade,
    name        text not null,
    starts_on   date,
    ends_on     date,
    color       text,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now()
);
create index idx_launches_active on launches(is_active);

-- ---------------------------------------------------------------------
-- creatives (метадані медіафайлів; самі файли — в Google Drive)
-- ---------------------------------------------------------------------
create table creatives (
    id              uuid primary key default uuid_generate_v4(),
    desk_id         uuid not null references desks(id) on delete cascade,
    name            text not null,
    type            creative_type not null,
    drive_file_id   text,                                    -- Google Drive ID
    size_bytes      bigint,
    duration_sec    int,                                     -- для відео/аудіо
    width_px        int,
    height_px       int,
    thumbnail_url   text,                                    -- кеш-превью в Supabase Storage
    tags            text[] not null default array[]::text[],
    rubric_id       uuid references rubrics(id) on delete set null,
    uploaded_by     uuid not null references users(id),
    uploaded_at     timestamptz not null default now(),
    archived_at     timestamptz,                             -- soft delete (30 днів)
    deleted_at      timestamptz
);
create index idx_creatives_desk on creatives(desk_id);
create index idx_creatives_type on creatives(type);
create index idx_creatives_tags on creatives using gin (tags);
create index idx_creatives_archived on creatives(archived_at) where archived_at is not null;

-- ---------------------------------------------------------------------
-- publications
-- ---------------------------------------------------------------------
create table publications (
    id              uuid primary key default uuid_generate_v4(),
    desk_id         uuid not null references desks(id) on delete cascade,
    title           text not null,
    publish_at      timestamptz not null,
    content_type    content_type not null,
    text_body       text not null default '',
    hashtags        text[] not null default array[]::text[],
    rubric_id       uuid references rubrics(id) on delete set null,
    launch_id       uuid references launches(id) on delete set null,
    status          publication_status not null default 'draft',
    approver_policy approver_policy not null default 'all',
    deadline_on     date,
    published_url   text,
    published_at    timestamptz,
    created_by      uuid not null references users(id),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    -- v1.1: full-text search support
    search_tsv      tsvector generated always as (
                      setweight(to_tsvector('simple', coalesce(title,'')), 'A') ||
                      setweight(to_tsvector('simple', coalesce(text_body,'')), 'B') ||
                      setweight(to_tsvector('simple', coalesce(array_to_string(hashtags, ' '),'')), 'C')
                    ) stored
);
create index idx_pubs_desk on publications(desk_id);
create index idx_pubs_status on publications(status);
create index idx_pubs_publish_at on publications(publish_at);
create index idx_pubs_launch on publications(launch_id);
create index idx_pubs_search on publications using gin (search_tsv);

-- ---------------------------------------------------------------------
-- publication_platforms (M:N — публікація на яких майданчиках)
-- ---------------------------------------------------------------------
create table publication_platforms (
    publication_id  uuid not null references publications(id) on delete cascade,
    platform        platform not null,
    primary key (publication_id, platform)
);
create index idx_pub_platforms_platform on publication_platforms(platform);

-- ---------------------------------------------------------------------
-- publication_responsibles
-- ---------------------------------------------------------------------
create table publication_responsibles (
    publication_id  uuid not null references publications(id) on delete cascade,
    user_id         uuid not null references users(id) on delete cascade,
    role            responsibility not null default 'generic',
    primary key (publication_id, user_id, role)
);
create index idx_pub_resp_user on publication_responsibles(user_id);

-- ---------------------------------------------------------------------
-- publication_approvers
-- ---------------------------------------------------------------------
create table publication_approvers (
    publication_id  uuid not null references publications(id) on delete cascade,
    user_id         uuid not null references users(id) on delete cascade,
    is_approved     boolean,                                 -- null = ще не прийняв рішення
    decided_at      timestamptz,
    comment         text,
    primary key (publication_id, user_id)
);
create index idx_pub_approvers_user on publication_approvers(user_id);

-- ---------------------------------------------------------------------
-- creative_publications (M:N — креативи в публікаціях)
-- ---------------------------------------------------------------------
create table creative_publications (
    publication_id  uuid not null references publications(id) on delete cascade,
    creative_id     uuid not null references creatives(id) on delete cascade,
    sort_order      int not null default 0,
    primary key (publication_id, creative_id)
);

-- ---------------------------------------------------------------------
-- publication_history (повний audit-log)
-- ---------------------------------------------------------------------
create table publication_history (
    id              uuid primary key default uuid_generate_v4(),
    publication_id  uuid not null references publications(id) on delete cascade,
    actor_id        uuid not null references users(id),
    action          text not null,                           -- create|edit|status|approve|reject|move|publish|delete
    detail          text,                                    -- довільний коментар
    diff            jsonb,                                   -- опційно: що саме змінилось
    at              timestamptz not null default now()
);
create index idx_history_pub on publication_history(publication_id);
create index idx_history_at on publication_history(at);

-- ---------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------
create table comments (
    id              uuid primary key default uuid_generate_v4(),
    publication_id  uuid not null references publications(id) on delete cascade,
    author_id       uuid not null references users(id),
    body            text not null,
    mentions        uuid[] not null default array[]::uuid[],  -- @згадки → user_ids
    created_at      timestamptz not null default now(),
    edited_at       timestamptz,
    deleted_at      timestamptz
);
create index idx_comments_pub on comments(publication_id);

-- ---------------------------------------------------------------------
-- publication_drafts (v1.1 — auto-save)
-- ---------------------------------------------------------------------
create table publication_drafts (
    id              uuid primary key default uuid_generate_v4(),
    publication_id  uuid not null references publications(id) on delete cascade,
    author_id       uuid not null references users(id),
    snapshot        jsonb not null,                          -- повний стан полів на момент збереження
    saved_at        timestamptz not null default now()
);
create index idx_drafts_pub on publication_drafts(publication_id, saved_at desc);
-- Цикл очистки: тримати останні 20 чернеток на публікацію (cron task)

-- ---------------------------------------------------------------------
-- editing_sessions (v1.1 — soft-lock одночасного редагування)
-- ---------------------------------------------------------------------
create table editing_sessions (
    publication_id  uuid not null references publications(id) on delete cascade,
    user_id         uuid not null references users(id) on delete cascade,
    started_at      timestamptz not null default now(),
    last_ping       timestamptz not null default now(),
    expires_at      timestamptz not null default (now() + interval '2 minutes'),
    primary key (publication_id, user_id)
);
create index idx_editing_expires on editing_sessions(expires_at);
-- Логіка: при відкритті картки клієнт пише сесію. Кожні 30s — оновлює last_ping/expires_at.
-- Запит активних редакторів: where expires_at > now().
-- Cron щохвилини: delete from editing_sessions where expires_at < now();

-- ---------------------------------------------------------------------
-- notifications (трігер для UI + Telegram + Email)
-- ---------------------------------------------------------------------
create table notifications (
    id              uuid primary key default uuid_generate_v4(),
    recipient_id    uuid not null references users(id) on delete cascade,
    publication_id  uuid references publications(id) on delete cascade,
    trigger_type    text not null,                           -- assigned|mentioned|missed|review_24h|...
    title           text not null,
    body            text,
    sent_inapp      boolean not null default false,
    sent_telegram   boolean not null default false,
    sent_email      boolean not null default false,
    read_at         timestamptz,
    created_at      timestamptz not null default now()
);
create index idx_notif_recipient_unread on notifications(recipient_id, read_at);
create index idx_notif_publication on notifications(publication_id);

-- ---------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------
create table notification_preferences (
    user_id         uuid not null references users(id) on delete cascade,
    trigger_type    text not null,
    via_inapp       boolean not null default true,
    via_telegram    boolean not null default true,
    via_email       boolean not null default false,
    primary key (user_id, trigger_type)
);

-- ---------------------------------------------------------------------
-- access_requests
-- ---------------------------------------------------------------------
create table access_requests (
    id              uuid primary key default uuid_generate_v4(),
    user_id         uuid not null references users(id) on delete cascade,
    desk_id         uuid references desks(id) on delete cascade,
    note            text,
    status          text not null default 'pending',         -- pending|granted|declined
    created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- updated_at тригер
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

create trigger users_updated_at        before update on users        for each row execute function set_updated_at();
create trigger publications_updated_at before update on publications for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Helper: чи поточний користувач має одну з ролей
-- ---------------------------------------------------------------------
create or replace function current_user_has_role(roles user_role[]) returns boolean as $$
    select exists (
        select 1 from users
        where auth_id = auth.uid()
        and role = any (roles)
        and is_active = true
    );
$$ language sql security definer stable;

-- ---------------------------------------------------------------------
-- Helper: id поточного користувача
-- ---------------------------------------------------------------------
create or replace function current_user_id() returns uuid as $$
    select id from users where auth_id = auth.uid() limit 1;
$$ language sql security definer stable;

-- ---------------------------------------------------------------------
-- View: dashboard daily digest (для крон-задачі сповіщень)
-- ---------------------------------------------------------------------
create or replace view daily_digest as
select
    desk_id,
    count(*) filter (where date(publish_at) = current_date)                   as today_count,
    count(*) filter (where status = 'review')                                 as on_review,
    count(*) filter (where status != 'approved' and publish_at::date <= current_date + 1) as urgent,
    count(*) filter (where status = 'published' and date(published_at) = current_date - 1) as yesterday_published
from publications
where status != 'draft'
group by desk_id;

-- =====================================================================
-- Кінець schema.sql
-- Далі: rls.sql → seed.sql
-- =====================================================================
