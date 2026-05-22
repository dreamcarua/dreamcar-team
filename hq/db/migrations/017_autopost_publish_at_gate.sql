-- ============================================================
-- Migration 017 — autopost claim hardening
-- ============================================================
-- Виявлені проблеми:
--   1. claim_autopost_jobs не дивиться на publish_at → ловить queue одразу
--   2. Стара queue row у processing не відновлюється якщо worker помер
--   3. Defer-логіка через publish_at не працює (бо не використовується)

drop function if exists public.claim_autopost_jobs(text, int);

create function public.claim_autopost_jobs(worker_name text, max_jobs int default 5)
returns setof public.tg_autopost_queue
language plpgsql security definer
set search_path = public
as $$
begin
    -- A. Відновлюємо stuck processing > 30 хв тому
    update public.tg_autopost_queue
       set status = 'pending', claimed_at = null, worker_id = null,
           last_error = coalesce(last_error,'') || ' [auto-recovered]'
     where status = 'processing'
       and claimed_at is not null
       and claimed_at < now() - interval '30 minutes';

    -- B. Claim тільки тих що:
    --    1) status = 'pending'
    --    2) related publication.publish_at <= now()
    --    3) attempts < 3
    return query
    with claimed as (
        update public.tg_autopost_queue q
        set
            status     = 'processing',
            claimed_at = now(),
            worker_id  = worker_name,
            attempts   = q.attempts + 1
        where q.id in (
            select tq.id
              from public.tg_autopost_queue tq
              join public.publications p on p.id = tq.publication_id
             where tq.status = 'pending'
               and tq.attempts < 3
               and p.publish_at <= now()
             order by p.publish_at asc
             limit max_jobs
             for update of tq skip locked
        )
        returning q.*
    )
    select * from claimed;
end;
$$;

grant execute on function public.claim_autopost_jobs(text, int) to service_role;

-- C. One-shot recovery: повернути всі застрягшіся processing > 5 хв тому
update public.tg_autopost_queue
   set status = 'pending', claimed_at = null, worker_id = null
 where status = 'processing'
   and claimed_at < now() - interval '5 minutes';
