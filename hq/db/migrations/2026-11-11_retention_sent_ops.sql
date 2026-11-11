-- 11.11.2026 · Ретеншн: правка / видалення вже надісланої бот-розсилки з картки HQ (запит Віри).
--
-- retention_sent_ops — черга операцій над надісланим (edit | delete | preview) з прогресом.
-- Виконує retention-bot-broadcast?op=<id> порціями (~100 с на виклик), сам себе продовжує;
-- pg_cron щохвилини підхоплює операцію, якщо ланцюжок обірвався (heartbeat старший за 2 хв).
-- Права: ceo / coo / lead або відповідальний за картку. Вмикач: app_secrets.retention_sent_ops_enabled = '1'.
-- Відкат: вимкнути вмикач (кнопки зникають, нічого не виконується) або _rollback.sql.

CREATE TABLE IF NOT EXISTS public.retention_sent_ops (
  id bigserial PRIMARY KEY,
  retention_message_id uuid NOT NULL REFERENCES public.retention_messages(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('edit','delete','preview')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
  requested_by uuid REFERENCES public.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  heartbeat_at timestamptz,
  total int, done_ok int NOT NULL DEFAULT 0, failed int NOT NULL DEFAULT 0, too_old int NOT NULL DEFAULT 0,
  cursor text,
  errors jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text
);
CREATE UNIQUE INDEX IF NOT EXISTS retention_sent_ops_one_active
  ON public.retention_sent_ops (retention_message_id) WHERE status IN ('queued','running') AND action <> 'preview';
ALTER TABLE public.retention_sent_ops ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.retention_sent_ops FROM anon, authenticated;

-- що було надіслано (медіа), щоб правка знала, чи міняти медіа
ALTER TABLE public.retention_messages ADD COLUMN IF NOT EXISTS sent_media jsonb;

CREATE OR REPLACE FUNCTION public._retention_can_manage(p_message_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  select public.current_user_has_role(array['ceo','coo','lead']::user_role[])
      or exists (select 1 from public.retention_message_responsibles r
                  where r.message_id = p_message_id and r.user_id = public.current_user_id());
$$;

CREATE OR REPLACE FUNCTION public._retention_kick_op(p_op_id bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
declare v_secret text;
begin
  select value into v_secret from public.app_secrets where key = 'hq_cron_secret';
  if v_secret is null then return; end if;
  perform net.http_post(
    url := 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/retention-bot-broadcast?op=' || p_op_id,
    headers := jsonb_build_object('Content-Type','application/json','x-hq-cron-secret', v_secret),
    body := '{}'::jsonb, timeout_milliseconds := 5000);
end $$;
REVOKE ALL ON FUNCTION public._retention_kick_op(bigint) FROM PUBLIC, anon, authenticated;

-- Статус для картки: вмикач, права, статистика доставок, останні операції.
CREATE OR REPLACE FUNCTION public.retention_sent_info(p_message_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
declare v_uid uuid := public.current_user_id(); v jsonb;
begin
  if v_uid is null then raise exception 'Немає доступу' using errcode = '42501'; end if;
  select jsonb_build_object(
    'enabled', coalesce((select value from app_secrets where key = 'retention_sent_ops_enabled'), '0') = '1',
    'can_manage', public._retention_can_manage(p_message_id),
    'has_tg_chat', exists (select 1 from users where id = v_uid and tg_chat_id is not null),
    'recipients', (select count(*) from retention_deliveries d where d.retention_message_id = p_message_id),
    'active', (select count(*) from retention_deliveries d where d.retention_message_id = p_message_id and d.deleted_at is null),
    'deletable', (select count(*) from retention_deliveries d where d.retention_message_id = p_message_id and d.deleted_at is null and d.sent_at > now() - interval '48 hours'),
    'edited', (select count(*) from retention_deliveries d where d.retention_message_id = p_message_id and d.edited_at is not null and d.deleted_at is null),
    'first_sent_at', (select min(sent_at) from retention_deliveries d where d.retention_message_id = p_message_id),
    'last_sent_at', (select max(sent_at) from retention_deliveries d where d.retention_message_id = p_message_id),
    'ops', coalesce((select jsonb_agg(o order by o.id desc) from (
        select op.id, op.action, op.status, op.requested_at, op.started_at, op.finished_at, op.total, op.done_ok,
               op.failed, op.too_old, op.errors, op.note, coalesce(u.name, u.email) as by
          from retention_sent_ops op left join users u on u.id = op.requested_by
         where op.retention_message_id = p_message_id order by op.id desc limit 10) o), '[]'::jsonb)
  ) into v;
  return v;
end $$;
GRANT EXECUTE ON FUNCTION public.retention_sent_info(uuid) TO authenticated;

-- Запит операції з картки.
CREATE OR REPLACE FUNCTION public.retention_sent_op_request(p_message_id uuid, p_action text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
declare v_uid uuid := public.current_user_id(); m record; v_total int; v_id bigint;
begin
  if v_uid is null then raise exception 'Немає доступу' using errcode = '42501'; end if;
  if coalesce((select value from app_secrets where key = 'retention_sent_ops_enabled'), '0') <> '1' then
    raise exception 'Функцію вимкнено' using errcode = 'P0001'; end if;
  if p_action not in ('edit','delete','preview') then raise exception 'Невідома дія %', p_action; end if;
  if not public._retention_can_manage(p_message_id) then
    raise exception 'Лише ретеншн (lead), CEO/COO або відповідальний за картку' using errcode = '42501'; end if;
  select id, status, send_mode, deleted_at into m from retention_messages where id = p_message_id;
  if m.id is null or m.deleted_at is not null then raise exception 'Картку не знайдено'; end if;

  if p_action = 'preview' then
    if not exists (select 1 from users where id = v_uid and tg_chat_id is not null) then
      raise exception 'У твоєму профілі немає Telegram chat_id'; end if;
    v_total := 1;
  else
    select count(*) into v_total from retention_deliveries d
     where d.retention_message_id = p_message_id and d.deleted_at is null
       and (p_action = 'edit' or d.sent_at > now() - interval '48 hours');
    if v_total = 0 then
      raise exception '%', case when p_action = 'delete'
        then 'Немає повідомлень, молодших за 48 год: Telegram не дозволяє боту видаляти старіші'
        else 'Немає надісланих ботом повідомлень цієї розсилки' end;
    end if;
  end if;

  begin
    insert into retention_sent_ops (retention_message_id, action, requested_by, total)
    values (p_message_id, p_action, v_uid, v_total) returning id into v_id;
  exception when unique_violation then
    raise exception 'Над цією розсилкою вже виконується операція — дочекайся завершення';
  end;
  insert into retention_message_history (message_id, action, detail, actor_id)
  values (p_message_id, 'tg_' || p_action || '_requested', 'отримувачів: ' || v_total, v_uid);
  perform public._retention_kick_op(v_id);
  return jsonb_build_object('op_id', v_id, 'total', v_total);
end $$;
GRANT EXECUTE ON FUNCTION public.retention_sent_op_request(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.retention_sent_op_cancel(p_op_id bigint)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
declare v_msg uuid;
begin
  select retention_message_id into v_msg from retention_sent_ops where id = p_op_id;
  if v_msg is null or not public._retention_can_manage(v_msg) then raise exception 'Немає доступу' using errcode = '42501'; end if;
  update retention_sent_ops set status = 'cancelled', finished_at = now()
   where id = p_op_id and status in ('queued','running');
  insert into retention_message_history (message_id, action, detail, actor_id)
  values (v_msg, 'tg_op_cancelled', 'операція #' || p_op_id, public.current_user_id());
end $$;
GRANT EXECUTE ON FUNCTION public.retention_sent_op_cancel(bigint) TO authenticated;

-- Оренда для виконавця: одна операція — один живий виклик.
CREATE OR REPLACE FUNCTION public.retention_sent_op_lease(p_op_id bigint)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
declare n int;
begin
  update retention_sent_ops
     set status = 'running', started_at = coalesce(started_at, now()), heartbeat_at = now()
   where id = p_op_id and status in ('queued','running')
     and (heartbeat_at is null or heartbeat_at < now() - interval '2 minutes');
  get diagnostics n = row_count;
  return n > 0;
end $$;
REVOKE ALL ON FUNCTION public.retention_sent_op_lease(bigint) FROM PUBLIC, anon, authenticated;

-- Страховка: щохвилини підхопити операцію, ланцюжок якої обірвався.
CREATE OR REPLACE FUNCTION public.retention_sent_ops_resume()
 RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
declare r record; n int := 0;
begin
  for r in select id from retention_sent_ops
            where status in ('queued','running')
              and (heartbeat_at is null or heartbeat_at < now() - interval '2 minutes')
              and requested_at > now() - interval '1 day'
  loop perform public._retention_kick_op(r.id); n := n + 1; end loop;
  -- старші за добу й незавершені — позначити як збій, щоб не висіли
  update retention_sent_ops set status = 'failed', finished_at = now(), note = coalesce(note,'') || ' [timeout 24h]'
   where status in ('queued','running') and requested_at <= now() - interval '1 day';
  return n;
end $$;
REVOKE ALL ON FUNCTION public.retention_sent_ops_resume() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('retention-sent-ops-resume', '* * * * *', $c$select public.retention_sent_ops_resume()$c$)
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention-sent-ops-resume');

INSERT INTO public.app_secrets(key, value) VALUES ('retention_sent_ops_enabled', '1')
ON CONFLICT (key) DO NOTHING;
