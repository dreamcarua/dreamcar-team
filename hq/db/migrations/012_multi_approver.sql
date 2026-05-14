-- ============================================================
-- Multi-approver AND logic — migration 012
-- ============================================================
-- Якщо у публікації approvers >= 2, статус 'approved' ставиться
-- ТІЛЬКИ коли ВСІ approvers натиснули "Погодити".
-- Якщо approver_policy='any' — достатньо одного.
-- При поверненні на доопрацювання approved_by скидається.

-- 1. approved_by — array of user ids who've approved this pub
alter table public.publications
  add column if not exists approved_by uuid[] default '{}'::uuid[];

-- 2. Function: register an approval atomically
create or replace function public.register_approval(pub_id uuid, by_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pub_record public.publications;
  required_approvers uuid[];
  current_approvals uuid[];
  new_approvals uuid[];
  policy_str text;
  all_approved boolean;
begin
  select * into pub_record from public.publications where id = pub_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'publication not found');
  end if;

  -- Тільки коли публікація реально на погодженні
  if pub_record.status not in ('review','approved') then
    return jsonb_build_object('ok', false, 'error', 'publication is not in review status');
  end if;

  select coalesce(array_agg(user_id), '{}'::uuid[]) into required_approvers
  from public.publication_approvers
  where publication_id = pub_id;

  if array_length(required_approvers, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'no approvers configured');
  end if;

  if not (by_user = ANY(required_approvers)) then
    return jsonb_build_object('ok', false, 'error', 'user is not an approver');
  end if;

  current_approvals := coalesce(pub_record.approved_by, '{}'::uuid[]);

  if by_user = ANY(current_approvals) then
    new_approvals := current_approvals;
  else
    new_approvals := array_append(current_approvals, by_user);
  end if;

  policy_str := coalesce(pub_record.approver_policy, 'all');

  if policy_str = 'any' then
    all_approved := array_length(new_approvals, 1) > 0;
  else
    all_approved := required_approvers <@ new_approvals;
  end if;

  update public.publications
  set
    approved_by = new_approvals,
    status = case when all_approved then 'approved' else 'review' end,
    updated_at = now(),
    last_action_via = 'register_approval'
  where id = pub_id;

  insert into public.publication_history(publication_id, actor_id, action, detail)
  values (
    pub_id, by_user,
    case when all_approved then 'approve' else 'partial_approve' end,
    case when all_approved then 'Усі погоджувачі підтвердили'
         else format('%s/%s', array_length(new_approvals, 1), array_length(required_approvers, 1)) end
  );

  return jsonb_build_object(
    'ok', true,
    'status', case when all_approved then 'approved' else 'review' end,
    'approved_count', array_length(new_approvals, 1),
    'required_count', array_length(required_approvers, 1),
    'all_approved', all_approved,
    'policy', policy_str,
    'approvers', required_approvers,
    'approved_by', new_approvals
  );
end;
$$;

-- 3. Reset approved_by на rework/draft/in_work
create or replace function public.reset_approvals_on_rework()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'review' and new.status in ('rework', 'draft', 'in_work') then
    new.approved_by := '{}'::uuid[];
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_approvals on public.publications;
create trigger trg_reset_approvals
  before update on public.publications
  for each row
  execute function public.reset_approvals_on_rework();

-- 4. Permissions
grant execute on function public.register_approval(uuid, uuid) to authenticated;
