-- =====================================================================
-- 019 — Tech-request #3 (Олександр, 02.08.2026)
-- Сторінка «Нотатки»: ідеї для реалізації + Апрув/Відхилено від
-- Вадима (ceo), Артема (cfo), Давида (coo).
-- Застосовано на прод 02.08.2026 (migration tech3_hq_notes_with_votes).
-- =====================================================================

create table if not exists public.hq_notes (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 1 and 500),
  details     text,
  author_id   uuid not null references public.users(id) on delete restrict,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.hq_note_votes (
  note_id     uuid not null references public.hq_notes(id) on delete cascade,
  voter_id    uuid not null references public.users(id) on delete cascade,
  vote        text not null check (vote in ('approve','reject')),
  comment     text,
  voted_at    timestamptz not null default now(),
  primary key (note_id, voter_id)
);

create index if not exists hq_notes_status_idx     on public.hq_notes (status) where deleted_at is null;
create index if not exists hq_notes_author_idx     on public.hq_notes (author_id);
create index if not exists hq_note_votes_voter_idx on public.hq_note_votes (voter_id);

-- Хто голосує. Ролі, не UUID — щоб не ламалось при зміні складу.
create or replace function public.hq_note_voter_roles()
returns user_role[] language sql immutable as
$$ select array['ceo','cfo','coo']::user_role[] $$;

-- Хоч один «Відхилено» → rejected; усі активні дали «Апрув» → approved; інакше pending.
create or replace function public.hq_notes_recompute_status(p_note uuid)
returns void language plpgsql security definer set search_path to 'public' as
$$
declare v_required int; v_approve int; v_reject int; v_status text;
begin
  select count(*) into v_required from public.users u
   where u.role = any (public.hq_note_voter_roles()) and u.is_active is not false;

  select count(*) filter (where v.vote = 'approve'), count(*) filter (where v.vote = 'reject')
    into v_approve, v_reject
    from public.hq_note_votes v join public.users u on u.id = v.voter_id
   where v.note_id = p_note and u.role = any (public.hq_note_voter_roles()) and u.is_active is not false;

  v_status := case when v_reject > 0 then 'rejected'
                   when v_required > 0 and v_approve >= v_required then 'approved'
                   else 'pending' end;

  update public.hq_notes set status = v_status, updated_at = now()
   where id = p_note and status is distinct from v_status;
end;
$$;

create or replace function public.hq_note_votes_after_change()
returns trigger language plpgsql security definer set search_path to 'public' as
$$
begin
  perform public.hq_notes_recompute_status(coalesce(new.note_id, old.note_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_hq_note_votes_recompute on public.hq_note_votes;
create trigger trg_hq_note_votes_recompute
  after insert or update or delete on public.hq_note_votes
  for each row execute function public.hq_note_votes_after_change();

-- TG: автору — про голос, голосувальникам — про нову ідею (Edge hq-notes-notify).
create or replace function public.hq_notes_notify()
returns trigger language plpgsql security definer set search_path to 'public' as
$$
declare v_note_id uuid; v_event text; v_actor uuid;
begin
  if tg_table_name = 'hq_notes' then
    if tg_op <> 'INSERT' then return new; end if;
    v_note_id := new.id; v_event := 'note_created'; v_actor := new.author_id;
  else
    if tg_op = 'DELETE' then return old; end if;
    v_note_id := new.note_id; v_event := 'vote'; v_actor := new.voter_id;
    if tg_op = 'UPDATE' and old.vote is not distinct from new.vote then return new; end if;
  end if;

  perform net.http_post(
    url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/hq-notes-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hq-secret', '10b4e4588f679775068f0de314851e40157b8146f71f628da2303d7dfccef5dd'
    ),
    body := jsonb_build_object('note_id', v_note_id, 'event', v_event, 'actor_id', v_actor),
    timeout_milliseconds := 15000
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_hq_notes_notify on public.hq_notes;
create trigger trg_hq_notes_notify after insert on public.hq_notes
  for each row execute function public.hq_notes_notify();

drop trigger if exists trg_hq_note_votes_notify on public.hq_note_votes;
create trigger trg_hq_note_votes_notify after insert or update on public.hq_note_votes
  for each row execute function public.hq_notes_notify();

-- ---------------------------------------------------------------------
-- RLS: читають усі свої; додає ідею будь-хто (за себе);
--      голосують ТІЛЬКИ ceo/cfo/coo і тільки за себе.
-- ---------------------------------------------------------------------
alter table public.hq_notes      enable row level security;
alter table public.hq_note_votes enable row level security;

drop policy if exists "hq_notes: read all team"            on public.hq_notes;
drop policy if exists "hq_notes: insert own"               on public.hq_notes;
drop policy if exists "hq_notes: update author or c-level" on public.hq_notes;

create policy "hq_notes: read all team" on public.hq_notes
  for select using (public.current_user_id() is not null);
create policy "hq_notes: insert own" on public.hq_notes
  for insert with check (author_id = public.current_user_id());
create policy "hq_notes: update author or c-level" on public.hq_notes
  for update using (author_id = public.current_user_id()
                    or public.current_user_has_role(array['ceo','coo']::user_role[]));

drop policy if exists "hq_note_votes: read all team"       on public.hq_note_votes;
drop policy if exists "hq_note_votes: vote own by c-level" on public.hq_note_votes;
drop policy if exists "hq_note_votes: update own by c-level" on public.hq_note_votes;
drop policy if exists "hq_note_votes: delete own by c-level" on public.hq_note_votes;

create policy "hq_note_votes: read all team" on public.hq_note_votes
  for select using (public.current_user_id() is not null);
create policy "hq_note_votes: vote own by c-level" on public.hq_note_votes
  for insert with check (voter_id = public.current_user_id()
                         and public.current_user_has_role(public.hq_note_voter_roles()));
create policy "hq_note_votes: update own by c-level" on public.hq_note_votes
  for update using (voter_id = public.current_user_id()
                    and public.current_user_has_role(public.hq_note_voter_roles()));
create policy "hq_note_votes: delete own by c-level" on public.hq_note_votes
  for delete using (voter_id = public.current_user_id()
                    and public.current_user_has_role(public.hq_note_voter_roles()));

grant select, insert, update on public.hq_notes to authenticated;
grant select, insert, update, delete on public.hq_note_votes to authenticated;
