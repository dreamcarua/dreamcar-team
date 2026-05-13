-- =====================================================================
-- DreamCar HQ — Стіл SMM
-- Row-Level Security політики
-- v1.2 — травень 2026
--
-- Принципи:
--   1. Усі таблиці закриті за замовчуванням (alter ... enable row level security).
--   2. Доступ — через політики SELECT/INSERT/UPDATE/DELETE окремо.
--   3. CEO/COO бачать і змінюють усе.
--   4. Тимлід — повний доступ у межах свого стола.
--   5. Учасник — бачить усе, редагує тільки свої публікації.
--   6. Designer — тільки бібліотека креативів.
--
-- Виконати ПІСЛЯ schema.sql.
-- Idempotent: можна виконувати повторно — DROP POLICY IF EXISTS перед кожним CREATE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- USERS
-- ВАЖЛИВО: не звертатись до users всередині policy на users — infinite recursion.
-- Замість цього використовуємо auth.role() = 'authenticated' для SELECT
-- і SECURITY DEFINER helper functions для INSERT/UPDATE/DELETE.
-- ---------------------------------------------------------------------
alter table users enable row level security;

drop policy if exists "users: read all (active members)" on users;
drop policy if exists "users: read all (authenticated)" on users;
create policy "users: read all (authenticated)" on users
    for select using (auth.role() = 'authenticated');

drop policy if exists "users: insert by CEO/COO/lead" on users;
create policy "users: insert by CEO/COO/lead" on users
    for insert with check (current_user_has_role(array['ceo','coo','lead']::user_role[]));

drop policy if exists "users: update by CEO/COO or self" on users;
create policy "users: update by CEO/COO or self" on users
    for update using (
        current_user_has_role(array['ceo','coo']::user_role[])
        or auth_id = auth.uid()
    );

drop policy if exists "users: delete by CEO only" on users;
create policy "users: delete by CEO only" on users
    for delete using (current_user_has_role(array['ceo']::user_role[]));

-- ---------------------------------------------------------------------
-- DESKS
-- ---------------------------------------------------------------------
alter table desks enable row level security;

drop policy if exists "desks: read all" on desks;
create policy "desks: read all" on desks
    for select using (auth.role() = 'authenticated');

drop policy if exists "desks: write by CEO/COO" on desks;
create policy "desks: write by CEO/COO" on desks
    for all using (current_user_has_role(array['ceo','coo']::user_role[]))
    with check (current_user_has_role(array['ceo','coo']::user_role[]));

-- ---------------------------------------------------------------------
-- DESK_MEMBERS
-- ---------------------------------------------------------------------
alter table desk_members enable row level security;

drop policy if exists "desk_members: read all" on desk_members;
create policy "desk_members: read all" on desk_members
    for select using (auth.role() = 'authenticated');

drop policy if exists "desk_members: managed by CEO/COO/lead" on desk_members;
create policy "desk_members: managed by CEO/COO/lead" on desk_members
    for all using (current_user_has_role(array['ceo','coo','lead']::user_role[]))
    with check (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- ---------------------------------------------------------------------
-- RUBRICS
-- ---------------------------------------------------------------------
alter table rubrics enable row level security;

drop policy if exists "rubrics: read by all members of desk" on rubrics;
create policy "rubrics: read by all members of desk" on rubrics
    for select using (
        exists (
            select 1 from desk_members dm
            where dm.desk_id = rubrics.desk_id and dm.user_id = current_user_id()
        )
    );

drop policy if exists "rubrics: managed by lead+" on rubrics;
create policy "rubrics: managed by lead+" on rubrics
    for all using (current_user_has_role(array['ceo','coo','lead']::user_role[]))
    with check (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- ---------------------------------------------------------------------
-- LAUNCHES
-- ---------------------------------------------------------------------
alter table launches enable row level security;

drop policy if exists "launches: read all" on launches;
create policy "launches: read all" on launches
    for select using (auth.role() = 'authenticated');

drop policy if exists "launches: write by lead+" on launches;
create policy "launches: write by lead+" on launches
    for all using (current_user_has_role(array['ceo','coo','lead']::user_role[]))
    with check (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- ---------------------------------------------------------------------
-- PUBLICATIONS
-- ---------------------------------------------------------------------
alter table publications enable row level security;

drop policy if exists "publications: read by desk members" on publications;
create policy "publications: read by desk members" on publications
    for select using (
        exists (
            select 1 from desk_members dm
            where dm.desk_id = publications.desk_id and dm.user_id = current_user_id()
        )
    );

drop policy if exists "publications: insert by desk members" on publications;
create policy "publications: insert by desk members" on publications
    for insert with check (
        exists (
            select 1 from desk_members dm
            where dm.desk_id = publications.desk_id and dm.user_id = current_user_id()
        )
        and created_by = current_user_id()
    );

drop policy if exists "publications: update by lead+ or responsible" on publications;
create policy "publications: update by lead+ or responsible" on publications
    for update using (
        current_user_has_role(array['ceo','coo','lead']::user_role[])
        or exists (
            select 1 from publication_responsibles pr
            where pr.publication_id = publications.id and pr.user_id = current_user_id()
        )
    );

drop policy if exists "publications: delete by lead+" on publications;
create policy "publications: delete by lead+" on publications
    for delete using (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- ---------------------------------------------------------------------
-- PUBLICATION_PLATFORMS / RESPONSIBLES / APPROVERS / CREATIVES
-- ---------------------------------------------------------------------
alter table publication_platforms     enable row level security;
alter table publication_responsibles  enable row level security;
alter table publication_approvers     enable row level security;
alter table creative_publications     enable row level security;

drop policy if exists "pub_platforms: read" on publication_platforms;
create policy "pub_platforms: read" on publication_platforms
    for select using (
        exists (select 1 from publications p where p.id = publication_id)
    );
drop policy if exists "pub_platforms: write by editor" on publication_platforms;
create policy "pub_platforms: write by editor" on publication_platforms
    for all using (
        current_user_has_role(array['ceo','coo','lead']::user_role[])
        or exists (
            select 1 from publication_responsibles pr
            where pr.publication_id = publication_platforms.publication_id and pr.user_id = current_user_id()
        )
    );

drop policy if exists "pub_resp: read" on publication_responsibles;
create policy "pub_resp: read" on publication_responsibles
    for select using (auth.role() = 'authenticated');
drop policy if exists "pub_resp: write by lead+" on publication_responsibles;
create policy "pub_resp: write by lead+" on publication_responsibles
    for all using (current_user_has_role(array['ceo','coo','lead']::user_role[]));

drop policy if exists "pub_apr: read" on publication_approvers;
create policy "pub_apr: read" on publication_approvers
    for select using (auth.role() = 'authenticated');
drop policy if exists "pub_apr: write by lead+ or by themselves" on publication_approvers;
create policy "pub_apr: write by lead+ or by themselves" on publication_approvers
    for all using (
        current_user_has_role(array['ceo','coo','lead']::user_role[])
        or user_id = current_user_id()
    );

drop policy if exists "creative_pub: read" on creative_publications;
create policy "creative_pub: read" on creative_publications
    for select using (auth.role() = 'authenticated');
drop policy if exists "creative_pub: write by editor" on creative_publications;
create policy "creative_pub: write by editor" on creative_publications
    for all using (
        current_user_has_role(array['ceo','coo','lead']::user_role[])
        or exists (
            select 1 from publication_responsibles pr
            where pr.publication_id = creative_publications.publication_id and pr.user_id = current_user_id()
        )
    );

-- ---------------------------------------------------------------------
-- CREATIVES
-- ---------------------------------------------------------------------
alter table creatives enable row level security;

drop policy if exists "creatives: read by desk members" on creatives;
create policy "creatives: read by desk members" on creatives
    for select using (
        exists (
            select 1 from desk_members dm
            where dm.desk_id = creatives.desk_id and dm.user_id = current_user_id()
        )
        and deleted_at is null
    );

drop policy if exists "creatives: insert by desk members or designer" on creatives;
create policy "creatives: insert by desk members or designer" on creatives
    for insert with check (
        current_user_has_role(array['ceo','coo','lead','member','designer']::user_role[])
        and uploaded_by = current_user_id()
    );

drop policy if exists "creatives: update by uploader or lead+" on creatives;
create policy "creatives: update by uploader or lead+" on creatives
    for update using (
        current_user_has_role(array['ceo','coo','lead']::user_role[])
        or uploaded_by = current_user_id()
    );

drop policy if exists "creatives: no physical delete" on creatives;
create policy "creatives: no physical delete" on creatives
    for delete using (false);

-- ---------------------------------------------------------------------
-- COMMENTS
-- ---------------------------------------------------------------------
alter table comments enable row level security;

drop policy if exists "comments: read by desk members" on comments;
create policy "comments: read by desk members" on comments
    for select using (
        exists (
            select 1 from publications p
            join desk_members dm on dm.desk_id = p.desk_id
            where p.id = comments.publication_id and dm.user_id = current_user_id()
        )
        and deleted_at is null
    );

drop policy if exists "comments: insert by author=self" on comments;
create policy "comments: insert by author=self" on comments
    for insert with check (author_id = current_user_id());

drop policy if exists "comments: edit/delete own only" on comments;
create policy "comments: edit/delete own only" on comments
    for update using (author_id = current_user_id());

drop policy if exists "comments: delete own or by lead+" on comments;
create policy "comments: delete own or by lead+" on comments
    for delete using (
        author_id = current_user_id()
        or current_user_has_role(array['ceo','coo','lead']::user_role[])
    );

-- ---------------------------------------------------------------------
-- HISTORY (append-only)
-- ---------------------------------------------------------------------
alter table publication_history enable row level security;

drop policy if exists "history: read by desk members" on publication_history;
create policy "history: read by desk members" on publication_history
    for select using (
        exists (
            select 1 from publications p
            join desk_members dm on dm.desk_id = p.desk_id
            where p.id = publication_history.publication_id and dm.user_id = current_user_id()
        )
    );

drop policy if exists "history: insert by actor=self" on publication_history;
create policy "history: insert by actor=self" on publication_history
    for insert with check (actor_id = current_user_id());

drop policy if exists "history: no update" on publication_history;
create policy "history: no update" on publication_history for update using (false);
drop policy if exists "history: no delete" on publication_history;
create policy "history: no delete" on publication_history for delete using (false);

-- ---------------------------------------------------------------------
-- DRAFTS
-- ---------------------------------------------------------------------
alter table publication_drafts enable row level security;

drop policy if exists "drafts: read own" on publication_drafts;
create policy "drafts: read own" on publication_drafts
    for select using (author_id = current_user_id());

drop policy if exists "drafts: write own" on publication_drafts;
create policy "drafts: write own" on publication_drafts
    for all using (author_id = current_user_id())
    with check (author_id = current_user_id());

-- ---------------------------------------------------------------------
-- EDITING_SESSIONS
-- ---------------------------------------------------------------------
alter table editing_sessions enable row level security;

drop policy if exists "editing: read all" on editing_sessions;
create policy "editing: read all" on editing_sessions
    for select using (auth.role() = 'authenticated');

drop policy if exists "editing: write own" on editing_sessions;
create policy "editing: write own" on editing_sessions
    for all using (user_id = current_user_id())
    with check (user_id = current_user_id());

-- ---------------------------------------------------------------------
-- USER_VACATIONS
-- ---------------------------------------------------------------------
alter table user_vacations enable row level security;

drop policy if exists "vacations: read all (для розуміння auto-delegation)" on user_vacations;
create policy "vacations: read all (для розуміння auto-delegation)" on user_vacations
    for select using (auth.role() = 'authenticated');

drop policy if exists "vacations: own or lead+" on user_vacations;
create policy "vacations: own or lead+" on user_vacations
    for all using (
        user_id = current_user_id()
        or current_user_has_role(array['ceo','coo','lead']::user_role[])
    );

-- ---------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------
alter table notifications enable row level security;

drop policy if exists "notifications: read own" on notifications;
create policy "notifications: read own" on notifications
    for select using (recipient_id = current_user_id());

drop policy if exists "notifications: mark read own" on notifications;
create policy "notifications: mark read own" on notifications
    for update using (recipient_id = current_user_id());

drop policy if exists "notifications: server inserts" on notifications;
create policy "notifications: server inserts" on notifications
    for insert with check (false);

-- ---------------------------------------------------------------------
-- NOTIFICATION_PREFERENCES
-- ---------------------------------------------------------------------
alter table notification_preferences enable row level security;

drop policy if exists "notif_pref: own" on notification_preferences;
create policy "notif_pref: own" on notification_preferences
    for all using (user_id = current_user_id())
    with check (user_id = current_user_id());

-- ---------------------------------------------------------------------
-- ACCESS_REQUESTS
-- ---------------------------------------------------------------------
alter table access_requests enable row level security;

drop policy if exists "access_req: own or lead+" on access_requests;
create policy "access_req: own or lead+" on access_requests
    for select using (
        user_id = current_user_id()
        or current_user_has_role(array['ceo','coo','lead']::user_role[])
    );

drop policy if exists "access_req: create own" on access_requests;
create policy "access_req: create own" on access_requests
    for insert with check (user_id = current_user_id());

drop policy if exists "access_req: decide by lead+" on access_requests;
create policy "access_req: decide by lead+" on access_requests
    for update using (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- =====================================================================
-- Кінець rls.sql v1.2
-- =====================================================================
