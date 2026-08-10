-- =====================================================================
-- 020 — SMM: «Чек-лист» (шаблон + інстанси на проєкт) + «Базовий контент-план»
-- Запит Олександра (SMM), 10.08.2026.
-- Патерн RLS — як 019 (current_user_id / current_user_has_role).
-- Desk SMM = '11111111-1111-1111-1111-111111111111' (єдиний стіл, як publications).
-- =====================================================================

-- ── ЧЕК-ЛИСТ: базовий шаблон (незмінний майстер) ──────────────────────
create table if not exists public.checklist_template_items (
  id          uuid primary key default gen_random_uuid(),
  desk_id     uuid not null default '11111111-1111-1111-1111-111111111111',
  section     text not null default 'Загальне',            -- етап/категорія (група)
  title       text not null check (length(btrim(title)) between 1 and 500),
  description text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,               -- чи потрапляє в нові інстанси
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists checklist_tpl_order_idx on public.checklist_template_items (sort_order) where deleted_at is null;

-- ── ЧЕК-ЛИСТ: інстанс на проєкт (копія шаблону) ──────────────────────
create table if not exists public.checklist_projects (
  id          uuid primary key default gen_random_uuid(),
  desk_id     uuid not null default '11111111-1111-1111-1111-111111111111',
  launch_id   uuid references public.launches(id) on delete set null,
  name        text not null default 'Чек-ліст проєкту',
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived    boolean not null default false,
  deleted_at  timestamptz
);
create index if not exists checklist_projects_launch_idx on public.checklist_projects (launch_id) where deleted_at is null;

create table if not exists public.checklist_project_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.checklist_projects(id) on delete cascade,
  section     text not null default 'Загальне',
  title       text not null,
  description text,
  sort_order  int  not null default 0,
  done        boolean not null default false,
  done_by     uuid references public.users(id) on delete set null,
  done_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists checklist_proj_items_pid_idx on public.checklist_project_items (project_id, sort_order);

-- ── БАЗОВИЙ КОНТЕНТ-ПЛАН: бібліотека карток без дати ─────────────────
create table if not exists public.base_content_items (
  id            uuid primary key default gen_random_uuid(),
  desk_id       uuid not null default '11111111-1111-1111-1111-111111111111',
  stage         text not null default 'Старт',              -- етап проєкту (група)
  seq           int  not null default 0,                    -- порядковий номер у етапі
  title         text not null check (length(btrim(title)) between 1 and 500),
  description   text,
  content_type  text not null default 'Пост',               -- Пост/Відео/Сторіз/Рубрика/Reels...
  rubric_id     uuid references public.rubrics(id) on delete set null,
  category      text,
  reference_url text,                                        -- посилання на приклад/референс
  sort_order    int  not null default 0,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists base_content_stage_idx on public.base_content_items (stage, sort_order) where deleted_at is null;

-- ── RPC: створити інстанс чек-листа з шаблону (копіює активні пункти) ──
create or replace function public.checklist_create_from_template(p_launch uuid default null, p_name text default null)
returns uuid language plpgsql security definer set search_path to 'public' as
$$
declare v_id uuid; v_name text;
begin
  v_name := coalesce(nullif(btrim(p_name), ''),
                     (select l.name from public.launches l where l.id = p_launch),
                     'Чек-ліст ' || to_char(now() at time zone 'Europe/Kyiv','DD.MM.YYYY'));
  insert into public.checklist_projects (launch_id, name, created_by)
    values (p_launch, v_name, public.current_user_id())
    returning id into v_id;
  insert into public.checklist_project_items (project_id, section, title, description, sort_order)
    select v_id, t.section, t.title, t.description, t.sort_order
      from public.checklist_template_items t
     where t.deleted_at is null and t.is_active
     order by t.sort_order;
  return v_id;
end;
$$;
grant execute on function public.checklist_create_from_template(uuid, text) to authenticated;

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.checklist_template_items enable row level security;
alter table public.checklist_projects       enable row level security;
alter table public.checklist_project_items  enable row level security;
alter table public.base_content_items       enable row level security;

-- Шаблон: читають усі; ред/видал — автор або ceo/coo/lead.
drop policy if exists "cl_tpl: read"    on public.checklist_template_items;
drop policy if exists "cl_tpl: insert"  on public.checklist_template_items;
drop policy if exists "cl_tpl: update"  on public.checklist_template_items;
drop policy if exists "cl_tpl: delete"  on public.checklist_template_items;
create policy "cl_tpl: read"   on public.checklist_template_items for select using (public.current_user_id() is not null);
create policy "cl_tpl: insert" on public.checklist_template_items for insert with check (public.current_user_id() is not null);
create policy "cl_tpl: update" on public.checklist_template_items for update using (public.current_user_id() is not null);
create policy "cl_tpl: delete" on public.checklist_template_items for delete using (created_by = public.current_user_id() or public.current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- Інстанси: читають усі; створює будь-хто; ред/видал — автор або c-level+lead.
drop policy if exists "cl_prj: read"   on public.checklist_projects;
drop policy if exists "cl_prj: insert" on public.checklist_projects;
drop policy if exists "cl_prj: update" on public.checklist_projects;
drop policy if exists "cl_prj: delete" on public.checklist_projects;
create policy "cl_prj: read"   on public.checklist_projects for select using (public.current_user_id() is not null);
create policy "cl_prj: insert" on public.checklist_projects for insert with check (public.current_user_id() is not null);
create policy "cl_prj: update" on public.checklist_projects for update using (public.current_user_id() is not null);
create policy "cl_prj: delete" on public.checklist_projects for delete using (created_by = public.current_user_id() or public.current_user_has_role(array['ceo','coo','lead']::user_role[]));

-- Пункти інстансу: будь-хто в команді може ставити галочки / додавати / видаляти.
drop policy if exists "cl_pit: all" on public.checklist_project_items;
create policy "cl_pit: all" on public.checklist_project_items for all using (public.current_user_id() is not null) with check (public.current_user_id() is not null);

-- Контент-план: читають усі; ред/видал — автор або c-level+lead.
drop policy if exists "bc: read"   on public.base_content_items;
drop policy if exists "bc: insert" on public.base_content_items;
drop policy if exists "bc: update" on public.base_content_items;
drop policy if exists "bc: delete" on public.base_content_items;
create policy "bc: read"   on public.base_content_items for select using (public.current_user_id() is not null);
create policy "bc: insert" on public.base_content_items for insert with check (public.current_user_id() is not null);
create policy "bc: update" on public.base_content_items for update using (public.current_user_id() is not null);
create policy "bc: delete" on public.base_content_items for delete using (created_by = public.current_user_id() or public.current_user_has_role(array['ceo','coo','lead']::user_role[]));

grant select, insert, update, delete on public.checklist_template_items to authenticated;
grant select, insert, update, delete on public.checklist_projects       to authenticated;
grant select, insert, update, delete on public.checklist_project_items  to authenticated;
grant select, insert, update, delete on public.base_content_items       to authenticated;
