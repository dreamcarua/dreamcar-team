-- 05.06.2026: Захист від rapid duplicate assigned/status notifications
-- Деплоїться окремо через mcp__supabase__apply_migration; цей файл — для історії.
--
-- Зміни:
--   A. WHEN clause на trigger: фірить ТІЛЬКИ при зміні status/assignee_id/watchers/completed_at/deleted_at/depends_on/due_date/priority/title.
--      Це усуває холості fires на updated_at-only апдейтах.
--   B. dedupe key для assigned/status_changed на UPDATE — minute precision замість мілісекундної.
--      Повторне assignment/status_changed того ж task+recipient у ту ж хвилину блокується on conflict.

create or replace function public.team_tasks_notify_trigger()
returns trigger language plpgsql as $$
declare
  v_payload jsonb;
  v_watcher uuid;
begin
  v_payload := jsonb_build_object(
    'title',    new.title,
    'status',   new.status,
    'priority', new.priority,
    'due_date', new.due_date,
    'tags',     new.tags
  );

  if (tg_op = 'INSERT') then
    if new.assignee_id is not null then
      perform public.enqueue_team_task_notification(
        new.assignee_id, new.id, 'assigned', v_payload,
        null, 'assigned:'||new.id::text||':'||new.assignee_id::text
      );
    end if;
  elsif (tg_op = 'UPDATE') then
    if new.assignee_id is distinct from old.assignee_id then
      if new.assignee_id is not null then
        perform public.enqueue_team_task_notification(
          new.assignee_id, new.id, 'assigned', v_payload,
          null, 'assigned:'||new.id::text||':'||new.assignee_id::text||':'||to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI')
        );
      end if;
      if old.assignee_id is not null then
        perform public.enqueue_team_task_notification(
          old.assignee_id, new.id, 'unassigned', v_payload,
          null, 'unassigned:'||new.id::text||':'||old.assignee_id::text||':'||to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI')
        );
      end if;
    end if;
    if new.status is distinct from old.status then
      v_payload := v_payload || jsonb_build_object('old_status', old.status);
      if new.assignee_id is not null then
        perform public.enqueue_team_task_notification(
          new.assignee_id, new.id, 'status_changed', v_payload,
          null, 'status:'||new.id::text||':'||new.status::text||':'||to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI')
        );
      end if;
      foreach v_watcher in array coalesce(new.watchers, '{}') loop
        perform public.enqueue_team_task_notification(
          v_watcher, new.id, 'status_changed', v_payload,
          null, 'status_w:'||new.id::text||':'||v_watcher::text||':'||new.status::text||':'||to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI')
        );
      end loop;
    end if;
    if new.status = 'done' and (old.status is null or old.status <> 'done') then
      perform public.enqueue_team_task_notification(
        t.assignee_id, t.id, 'dependency_done',
        jsonb_build_object('blocker_title', new.title, 'blocker_id', new.id),
        null,
        'depdone:'||t.id::text||':'||new.id::text
      )
      from public.team_tasks t
      where new.id = any(t.depends_on) and t.status <> 'done' and t.assignee_id is not null;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_team_tasks_notify on public.team_tasks;
create trigger trg_team_tasks_notify
  after insert or update of status, assignee_id, watchers, completed_at, deleted_at, depends_on, due_date, priority, title
  on public.team_tasks
  for each row execute function public.team_tasks_notify_trigger();
