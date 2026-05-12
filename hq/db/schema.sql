-- =====================================================================
-- DreamCar HQ — Стіл SMM (Пілот)
-- Postgres-схема для Supabase
-- v1.2 — травень 2026
--
-- Виконання: Supabase Dashboard → SQL Editor → New Query → Run
-- Або:       supabase db push (якщо використовуєш CLI)
--
-- Порядок:
--   0. reset.sql                     — (опційно) повне видалення схеми
--   1. schema.sql  (цей файл)        — таблиці, типи, тригери
--   2. rls.sql                       — Row-Level Security політики
--   3. seed.sql                      — демо-дані
--
-- Цей файл idempotent: можна виконувати повторно без помилок.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";        -- для повнотекстового пошуку

-- ---------------------------------------------------------------------
-- Enum types (idempotent через DO блоки)
-- ---------------------------------------------------------------------
do $$ begin create type user_role          as enum ('ceo', 'coo', 'lead', 'member', 'designer');                          exception when duplicate_object then null; end $$;
do $$ begin create type publication_status as enum ('draft', 'in_work', 'review', 'approved', 'published', 'rework');     exception when duplicate_object then null; end $$;
do $$ begin create type content_type       as enum ('post', 'reels', 'stories', 'carousel', 'longread');                  exception when duplicate_object then null; end $$;
do $$ begin create type platform           as enum ('ig', 'tg', 'tt', 'th', 'yt', 'fb');                                  exception when duplicate_object then null; end $$;
do $$ begin create type creative_type      as enum ('photo', 'video', 'doc', 'audio');                                    exception when duplicate_object then null; end $$;
do $$ begin create type approver_policy    as enum ('all', 'any');                                                        exception when duplicate_object then null; end $$;
do $$ begin create type responsibility     as enum ('scriptwriter', 'videographer', 'editor', 'publisher', 'generic');    exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- users
-- Інтегровано з Supabase Auth (auth.users) — id = auth.uid()
-- ---------------------------------------------------------------------
create table if not exists users (
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
create index if not exists idx_users_role on users(role);

-- ---------------------------------------------------------------------
-- user_vacations (v1.1 — auto-delegation при відпустці)
-- ---------------------------------------------------------------------
create table if not exists user_vacations (
    id          uuid primary key default uuid_generate_v4(),
    user_id     uuid not null references users(id) on delete cascade,
    from_date   date not null,
    to_date     date not null,
    delegate_to uuid references users(id),
    note        text,
    created_at  timestamptz not null default now(),
    check (to_date >= from_date)
);
create index if not exists idx_vacations_user on user_vacations(user_id);
create index if not exists idx_vacations_range on user_vacations(from_date, to_date);

-- ---------------------------------------------------------------------
-- desks (на пілоті — один SMM)
-- ---------------------------------------------------------------------
create table if not exists desks (
    id          uuid primary key default uuid_generate_v4(),
    slug        text unique not null,
    name        text not null,
    color       text,
    created_at  timestamptz not null default now()
);
insert into desks (slug, name, color) values ('smm', 'Стіл SMM', '#cc0000') on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- desk_members
-- ---------------------------------------------------------------------
create table if not exists desk_members (
    desk_id     uuid not null references desks(id) on delete cascade,
    user_id     uuid not null references users(id) on delete cascade,
    desk_role   user_role not null,
    added_at    timestamptz not null default now(),
    primary key (desk_id, user_id)
);

-- ---------------------------------------------------------------------
-- rubrics
-- ---------------------------------------------------------------------
create table if not exists rubrics (
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
-- launches
-- ---------------------------------------------------------------------
create table if not exists launches (
    id          uuid primary key default uuid_generate_v4(),
    desk_id     uuid not null references desks(id) on delete cascade,
    name        text not null,
    starts_on   date,
    ends_on     date,
    color       text,
    is_active   boolean not null default true,
    created_at  timestamptz not null default now()
);
create index if not exists idx_launches_active on launches(is_active);

-- ---------------------------------------------------------------------
-- creatives
-- ---------------------------------------------------------------------
create table if not exists creatives (
    id              uuid primary key default uuid_generate_v4(),
    desk_id         uuid not null references desks(id) on delete cascade,
    name            text not null,
    type            creative_type not null,
    drive_file_id   text,
    size_bytes      bigint,
    duration_sec    int,
    width_px        int,
    height_px       int,
    thumbnail_url   text,
    tags            text[] not null default array[]::text[],
    rubric_id       uuid references rubrics(id) on delete set null,
    uploaded_by     uuid not null references users(id),
    uploaded_at     timestamptz not null default now(),
    archived_at     timestamptz,
    deleted_at      timestamptz
);
create index if not exists idx_creatives_desk on creatives(desk_id);
create index if not exists idx_creatives_type on creatives(type);
create index if not exists idx_creatives_tags on creatives using gin (tags);
create index if not exists idx_creatives_archived on creatives(archived_at) where archived_at is not null;

-- ---------------------------------------------------------------------
-- publications
-- search_tsv — звичайна колонка, заповнюється тригером (див. нижче)
-- ---------------------------------------------------------------------
create table if not exists publications (
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
    search_tsv      tsvector
);
create index if not exists idx_pubs_desk on publications(desk_id);
create index if not exists idx_pubs_status on publications(status);
create index if not exists idx_pubs_publish_at on publications(publish_at);
create index if not exists idx_pubs_launch on publications(launch_id);
create index if not exists idx_pubs_search on publications using gin (search_tsv);

-- ---------------------------------------------------------------------
-- Full-text search trigger
-- Population через тригер замість generated column,
-- бо text→regconfig cast не immutable і не пропускається у generated.
-- Усередині plpgsql ці обмеження не діють.
-- ---------------------------------------------------------------------
create or replace function publications_tsv_update() returns trigger as $$
begin
    new.search_tsv :=
        setweight(to_tsvector('simple'::regconfig, coalesce(new.title,'')), 'A') ||
        setweight(to_tsvector('simple'::regconfig, coalesce(new.text_body,'')), 'B') ||
        setweight(to_tsvector('simple'::regconfig, coalesce(array_to_string(new.hashtags, ' '),'')), 'C');
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_publications_tsv on publications;
create trigger trg_publications_tsv before insert or update on publications
    for each row execute function publications_tsv_update();

-- ---------------------------------------------------------------------
-- publication_platforms
-- ---------------------------------------------------------------------
create table if not exists publication_platforms (
    publication_id  uuid not null references publications(id) on delete cascade,
    platform        platform not null,
    primary key (publication_id, platform)
);
create index if not exists idx_pub_platforms_platform on publication_platforms(platform);

-- ---------------------------------------------------------------------
-- publication_responsibles
-- ---------------------------------------------------------------------
create table if not exists publication_responsibles (
    publication_id  uuid not null references publications(id) on delete cascade,
    user_id         uuid not null references users(id) on delete cascade,
    role            responsibility not null default 'generic',
    primary key (publication_id, user_id, role)
);
create index if not exists idx_pub_resp_user on publication_responsibles(user_id);

-- ---------------------------------------------------------------------
-- publication_approvers
-- ---------------------------------------------------------------------
create table if not exists publication_approvers (
    publication_id  uuid not null references publications(id) on delete cascade,
    user_id         uuid not null references users(id) on delete cascade,
    is_approved     boolean,
    decided_at      timestamptz,
    comment         text,
    primary key (publication_id, user_id)
);
create index if not exists idx_pub_approvers_user on publication_approvers(user_id);

-- ---------------------------------------------------------------------
-- creative_publications
-- ---------------------------------------------------------------------
create table if not exists creative_publications (
    publication_id  uuid not null references publications(id) on delete cascade,
    creative_id     uuid not null references creatives(id) on delete cascade,
    sort_order      int not null default 0,
    primary key (publication_id, creative_id)
);

-- ---------------------------------------------------------------------
-- publication_history (повний audit-log)
-- ---------------------------------------------------------------------
create table if not exists publication_history (
    id              uuid primary key default uuid_generate_v4(),
    publication_id  uuid not null references publications(id) on delete cascade,
    actor_id        uuid not null references users(id),
    action          text not null,
    detail          text,
    diff            jsonb,
    at              timestamptz not null default now()
);
create index if not exists idx_history_pub on publication_history(publication_id);
create index if not exists idx_history_at on publication_history(at);

-- ---------------------------------------------------------------------
-- comments
-- ---------------------------------------------------------------------
create table if not exists comments (
    id              uuid primary key default uuid_generate_v4(),
    publication_id  uuid not null references publications(id) on delete cascade,
    author_id       uuid not null references users(id),
    body            text not null,
    mentions        uuid[] not null default array[]::uuid[],
    created_at      timestamptz not null default now(),
    edited_at       timestamptz,
    deleted_at      timestamptz
);
create index if not exists idx_comments_pub on comments(publication_id);

-- ---------------------------------------------------------------------
-- publication_drafts (v1.1 — auto-save)
-- ---------------------------------------------------------------------
create table if not exists publication_drafts (
    id              uuid primary key default uuid_generate_v4(),
    publication_id  uuid not null references publications(id) on delete cascade,
    author_id       uuid not null references users(id),
    snapshot        jsonb not null,
    saved_at        timestamptz not null default now()
);
create index if not exists idx_drafts_pub on publication_drafts(publication_id, saved_at desc);

-- ---------------------------------------------------------------------
-- editing_sessions (v1.1 — soft-lock)
-- ---------------------------------------------------------------------
create table if not exists editing_sessions (
    publication_id  uuid not null references publications(id) on delete cascade,
    user_id         uuid not null references users(id) on delete cascade,
    started_at      timestamptz not null default now(),
    last_ping       timestamptz not null default now(),
    expires_at      timestamptz not null default (now() + interval '2 minutes'),
    primary key (publication_id, user_id)
);
create index if not exists idx_editing_expires on editing_sessions(expires_at);

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
create table if not exists notifications (
    id              uuid primary key default uuid_generate_v4(),
    recipient_id    uuid not null references users(id) on delete cascade,
    publication_id  uuid references publications(id) on delete cascade,
    trigger_type    text not null,
    title           text not null,
    body            text,
    sent_inapp      boolean not null default false,
    sent_telegram   boolean not null default false,
    sent_email      boolean not null default false,
    read_at         timestamptz,
    created_at      timestamptz not null default now()
);
create index if not exists idx_notif_recipient_unread on notifications(recipient_id, read_at);
create index if not exists idx_notif_publication on notifications(publication_id);

-- ---------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------
create table if not exists notification_preferences (
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
create table if not exists access_requests (
    id              uuid primary key default uuid_generate_v4(),
    user_id         uuid not null references users(id) on delete cascade,
    desk_id         uuid references desks(id) on delete cascade,
    note            text,
    status          text not null default 'pending',
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

drop trigger if exists users_updated_at on users;
create trigger users_updated_at        before update on users        for each row execute function set_updated_at();

drop trigger if exists publications_updated_at on publications;
create trigger publications_updated_at before update on publications for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------
create or replace function current_user_has_role(roles user_role[]) returns boolean as $$
    select exists (
        select 1 from users
        where auth_id = auth.uid()
        and role = any (roles)
        and is_active = true
    );
$$ language sql security definer stable;

create or replace function current_user_id() returns uuid as $$
    select id from users where auth_id = auth.uid() limit 1;
$$ language sql security definer stable;

-- ---------------------------------------------------------------------
-- View: daily digest
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
