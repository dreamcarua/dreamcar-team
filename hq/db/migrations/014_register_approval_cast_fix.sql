-- ============================================================
-- FIX register_approval RPC — cast text → publication_status (#139)
-- ============================================================
-- Bug: "column status is of type publication_status but expression is of type text"
-- Причина: CASE expression повертає тип TEXT, а publications.status — enum
-- publication_status. PostgreSQL не auto-кастить text→enum у UPDATE.
-- Fix: explicit ::publication_status cast у UPDATE.
--
-- Bonus: RPC тепер також оновлює publication_approvers.is_approved + decided_at,
-- що було missing — notify-tg v7 #124 (chain progress) використовує is_approved
-- для рендера "👍 Погодили (1/2): Вадим ✓".

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

  policy_str := coalesce(pub_record.approver_policy::text, 'all');

  if policy_str = 'any' then
    all_approved := array_length(new_approvals, 1) > 0;
  else
    all_approved := required_approvers <@ new_approvals;
  end if;

  -- FIX: explicit cast text → publication_status enum
  update public.publications
  set
    approved_by = new_approvals,
    status = (case when all_approved then 'approved' else 'review' end)::publication_status,
    updated_at = now(),
    last_action_via = 'register_approval'
  where id = pub_id;

  -- BONUS: sync publication_approvers.is_approved for chain-progress UI/TG
  update public.publication_approvers
  set is_approved = true, decided_at = now()
  where publication_id = pub_id and user_id = by_user;

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

grant execute on function public.register_approval(uuid, uuid) to authenticated;
