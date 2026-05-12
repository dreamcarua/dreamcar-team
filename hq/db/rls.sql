-- =====================================================================
-- DreamCar HQ — Стіл SMM
-- Row-Level Security політики
-- v1.1 — травень 2026
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
-- =====================================================================

-- ---------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------
alter table users enable row level security;

create policy "users: read all (active members)" on users
    for select using (
        exists (select 1 from users me where me.auth_id = auth.uid() and me.is_active)
    );

create policy "users: insert by CEO/COO/lead" on users
    for insert with check (current_user_has_role(array['ceo','coo','lead']::user_role[]));

create policy "users: update by CEO/COO or self" on users
    for update using (
        current_user_has_role(array['ceo','coo']::user_role[])
        or auth_id = auth.uid()
    );

create policy "users: delete by CEO only" on users
    for delete using (current_user_has_role(array['ceo']::user_role[]));

-- ---------------------------------------------------------------------
-- DESKS — публічно читаються (на пілоті 1 стіл), пишуть тільки CEO/COO
-- ---------------------------------------------------------------------
alter table desks enable row level security;

create policy "desks: read all" on desks
    for select using (auth.role() = 'authenticated');

create policy "desks: write by CEO/COO" on desks
    for all using (current_user_has_role(array['ceo','coo']::user_role[]))
    with check (current_user_has_role(array['ceo','coo']::user_role[]));

-- ---------------------------------------------------------------------
-- DESK_MEMBERS
-- ---------------------------------------------------------------------
alter table desk_members enable row level security;

create policy "desk_members: read all" on desk_members
    for select using (auth.role() = 'authenticated');

create policy "desk_members: managed by CEO/COO/lead" on desk_members
    for all using (current_user_has_role(array['ceo','coo','lead']::user_role[]))
    with check (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- ---------------------------------------------------------------------
-- RUBRICS
-- ---------------------------------------------------------------------
alter table rubrics enable row level security;

create policy "rubrics: read by all members of desk" on rubrics
    for select using (
        exists (
            select 1 from desk_members dm
            where dm.desk_id = rubrics.desk_id and dm.user_id = current_user_id()
        )
    );

create policy "rubrics: managed by lead+" on rubrics
    for all using (current_user_has_role(array['ceo','coo','lead']::user_role[]))
    with check (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- ---------------------------------------------------------------------
-- LAUNCHES
-- ---------------------------------------------------------------------
alter table launches enable row level security;

create policy "launches: read all" on launches
    for select using (auth.role() = 'authenticated');

create policy "launches: write by lead+" on launches
    for all using (current_user_has_role(array['ceo','coo','lead']::user_role[]))
    with check (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- ---------------------------------------------------------------------
-- PUBLICATIONS
-- ---------------------------------------------------------------------
alter table publications enable row level security;

-- Усі активні члени стола бачать публікації
create policy "publications: read by desk members" on publications
    for select using (
        exists (
            select 1 from desk_members dm
            where dm.desk_id = publications.desk_id and dm.user_id = current_user_id()
        )
    );

-- Створювати може будь-який член стола
create policy "publications: insert by desk members" on publications
    for insert with check (
        exists (
            select 1 from desk_members dm
            where dm.desk_id = publications.desk_id and dm.user_id = current_user_id()
        )
        and created_by = current_user_id()
    );

-- Оновлювати: CEO/COO/lead — все; учасник — тільки якщо він відповідальний
create policy "publications: update by lead+ or responsible" on publications
    for update using (
        current_user_has_role(array['ceo','coo','lead']::user_role[])
        or exists (
            select 1 from publication_responsibles pr
            where pr.publication_id = publications.id and pr.user_id = current_user_id()
        )
    );

-- Видаляти може тільки CEO/COO/lead
create policy "publications: delete by lead+" on publications
    for delete using (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- ---------------------------------------------------------------------
-- PUBLICATION_PLATFORMS / RESPONSIBLES / APPROVERS / CREATIVES
-- (Управління — як в parent publication)
-- ---------------------------------------------------------------------
alter table publication_platforms     enable row level security;
alter table publication_responsibles  enable row level security;
alter table publication_approvers     enable row level security;
alter table creative_publications     enable row level security;

create policy "pub_platforms: read" on publication_platforms
    for select using (
        exists (select 1 from publications p where p.id = publication_id)
    );
create policy "pub_platforms: write by editor" on publication_platforms
    for all using (
        current_user_has_role(array['ceo','coo','lead']::user_role[])
        or exists (
            select 1 from publication_responsibles pr
            where pr.publication_id = publication_platforms.publication_id and pr.user_id = current_user_id()
        )
    );

create policy "pub_resp: read" on publication_responsibles
    for select using (auth.role() = 'authenticated');
create policy "pub_resp: write by lead+" on publication_responsibles
    for all using (current_user_has_role(array['ceo','coo','lead']::user_role[]));

create policy "pub_apr: read" on publication_approvers
    for select using (auth.role() = 'authenticated');
create policy "pub_apr: write by lead+ or by themselves" on publication_approvers
    for all using (
        current_user_has_role(array['ceo','coo','lead']::user_role[])
        or user_id = current_user_id()
    );

create policy "creative_pub: read" on creative_publications
    for select using (auth.role() = 'authenticated');
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

create policy "creatives: read by desk members" on creatives
    for select using (
        exists (
            select 1 from desk_members dm
            where dm.desk_id = creatives.desk_id and dm.user_id = current_user_id()
        )
        and deleted_at is null
    );

create policy "creatives: insert by desk members or designer" on creatives
    for insert with check (
        current_user_has_role(array['ceo','coo','lead','member','designer']::user_role[])
        and uploaded_by = current_user_id()
    );

create policy "creatives: update by uploader or lead+" on creatives
    for update using (
        current_user_has_role(array['ceo','coo','lead']::user_role[])
        or uploaded_by = current_user_id()
    );

-- Soft delete тільки — physical delete заборонено
create policy "creatives: no physical delete" on creatives
    for delete using (false);

-- ---------------------------------------------------------------------
-- COMMENTS
-- ---------------------------------------------------------------------
alter table comments enable row level security;

create policy "comments: read by desk members" on comments
    for select using (
        exists (
            select 1 from publications p
            join desk_members dm on dm.desk_id = p.desk_id
            where p.id = comments.publication_id and dm.user_id = current_user_id()
        )
        and deleted_at is null
    );

create policy "comments: insert by author=self" on comments
    for insert with check (author_id = current_user_id());

create policy "comments: edit/delete own only" on comments
    for update using (author_id = current_user_id());
create policy "comments: delete own or by lead+" on comments
    for delete using (
        author_id = current_user_id()
        or current_user_has_role(array['ceo','coo','lead']::user_role[])
    );

-- ---------------------------------------------------------------------
-- HISTORY (append-only, повна видимість для команди)
-- ---------------------------------------------------------------------
alter table publication_history enable row level security;

create policy "history: read by desk members" on publication_history
    for select using (
        exists (
            select 1 from publications p
            join desk_members dm on dm.desk_id = p.desk_id
            where p.id = publication_history.publication_id and dm.user_id = current_user_id()
        )
    );

-- Тільки сервер пише через service_role (через backend trigger чи RPC)
create policy "history: insert by actor=self" on publication_history
    for insert with check (actor_id = current_user_id());

-- Заборонено редагувати або видаляти історію
create policy "history: no update" on publication_history for update using (false);
create policy "history: no delete" on publication_history for delete using (false);

-- ---------------------------------------------------------------------
-- DRAFTS (auto-save — тільки своя)
-- ---------------------------------------------------------------------
alter table publication_drafts enable row level security;

create policy "drafts: read own" on publication_drafts
    for select using (author_id = current_user_id());

create policy "drafts: write own" on publication_drafts
    for all using (author_id = current_user_id())
    with check (author_id = current_user_id());

-- ---------------------------------------------------------------------
-- EDITING_SESSIONS (soft-lock — всі бачать, керує своєю кожен)
-- ---------------------------------------------------------------------
alter table editing_sessions enable row level security;

create policy "editing: read all" on editing_sessions
    for select using (auth.role() = 'authenticated');

create policy "editing: write own" on editing_sessions
    for all using (user_id = current_user_id())
    with check (user_id = current_user_id());

-- ---------------------------------------------------------------------
-- USER_VACATIONS
-- ---------------------------------------------------------------------
alter table user_vacations enable row level security;

create policy "vacations: read all (для розуміння auto-delegation)" on user_vacations
    for select using (auth.role() = 'authenticated');

create policy "vacations: own or lead+" on user_vacations
    for all using (
        user_id = current_user_id()
        or current_user_has_role(array['ceo','coo','lead']::user_role[])
    );

-- ---------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------
alter table notifications enable row level security;

create policy "notifications: read own" on notifications
    for select using (recipient_id = current_user_id());

create policy "notifications: mark read own" on notifications
    for update using (recipient_id = current_user_id());

-- Створює бекенд (service_role)
create policy "notifications: server inserts" on notifications
    for insert with check (false);  -- only service_role bypasses this

-- ---------------------------------------------------------------------
-- NOTIFICATION_PREFERENCES
-- ---------------------------------------------------------------------
alter table notification_preferences enable row level security;

create policy "notif_pref: own" on notification_preferences
    for all using (user_id = current_user_id())
    with check (user_id = current_user_id());

-- ---------------------------------------------------------------------
-- ACCESS_REQUESTS
-- ---------------------------------------------------------------------
alter table access_requests enable row level security;

create policy "access_req: own or lead+" on access_requests
    for select using (
        user_id = current_user_id()
        or current_user_has_role(array['ceo','coo','lead']::user_role[])
    );

create policy "access_req: create own" on access_requests
    for insert with check (user_id = current_user_id());

create policy "access_req: decide by lead+" on access_requests
    for update using (current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- =====================================================================
-- Кінець rls.sql
-- Далі: seed.sql
-- =====================================================================
