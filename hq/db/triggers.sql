-- =====================================================================
-- DreamCar HQ — Triggers
-- v1.0
-- Виконати в Supabase SQL Editor ПІСЛЯ schema.sql + rls.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- handle_new_user
-- ---------------------------------------------------------------------
-- Коли в auth.users з'являється новий запис (Google OAuth логін),
-- автоматично створюємо відповідний рядок у public.users.
-- SECURITY DEFINER дозволяє обійти RLS (інакше insert заблокується,
-- бо RLS insert-policy дозволяє лише CEO).
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_role public.user_role;
  v_email text;
begin
  v_email := lower(new.email);

  -- ім'я з метаданих або з email
  v_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(v_email, '@', 1)
  );

  -- спеціальні акаунти отримують CEO одразу
  if v_email in ('vg@abrisart.com', 'dreamcarua@gmail.com') then
    v_role := 'ceo'::public.user_role;
  else
    v_role := 'member'::public.user_role;
  end if;

  insert into public.users (auth_id, email, name, role, active)
  values (new.id, v_email, v_name, v_role, true)
  on conflict (email) do update
    set auth_id = excluded.auth_id,
        name    = coalesce(public.users.name, excluded.name),
        active  = true;

  return new;
end;
$$;

-- Створюємо тригер заново (ідемпотентно)
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Backfill існуючих auth.users у public.users
-- ---------------------------------------------------------------------
-- Якщо ви вже залогінилися до того, як цей тригер було створено,
-- запустіть цей блок щоб не залишити «бездомних» юзерів.
-- ---------------------------------------------------------------------

insert into public.users (auth_id, email, name, role, active)
select
  au.id,
  lower(au.email),
  coalesce(
    au.raw_user_meta_data->>'full_name',
    au.raw_user_meta_data->>'name',
    split_part(lower(au.email), '@', 1)
  ),
  case
    when lower(au.email) in ('vg@abrisart.com', 'dreamcarua@gmail.com')
      then 'ceo'::public.user_role
    else 'member'::public.user_role
  end,
  true
from auth.users au
where au.email is not null
on conflict (email) do update
  set auth_id = excluded.auth_id,
      active  = true;

-- ---------------------------------------------------------------------
-- Готово. Перевірка:
--   select email, role, active from public.users order by created_at desc;
-- ---------------------------------------------------------------------
