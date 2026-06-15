// ОДНОРАЗОВА: occurred_ts (час) + тригер + kasa_search + kasa_internal_flow. Guard ?key=dckasa-time-Nv6
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-time-Nv6";
const SQL = `
alter table public.kasa_transactions add column if not exists occurred_ts timestamptz;

update public.kasa_transactions set occurred_ts = case
  when source='monobank' and (raw ? 'time') then to_timestamp((raw->>'time')::bigint)
  when source='privatbank' and (raw ? 'DATE_TIME_DAT_OD_TIM_P')
     then (to_timestamp(raw->>'DATE_TIME_DAT_OD_TIM_P','DD.MM.YYYY HH24:MI:SS')::timestamp at time zone 'Europe/Kyiv')
  else occurred_at::timestamptz end
where occurred_ts is null;

create or replace function public.kasa_mark_internal() returns trigger language plpgsql as $fn$
begin
  if NEW.source in ('monobank','privatbank') then
    NEW.is_internal := (
      coalesce(NEW.description,'') ~* 'власн[іиого]* рахун|між власними|переказ власних|власних кошт'
      or coalesce(NEW.raw->>'AUT_CNTR_ACC','') in (select iban from public.kasa_accounts where iban is not null and iban <> '')
      or exists (select 1 from public.kasa_bank_creds c where coalesce(c.owner_name,'') <> '' and (
          coalesce(NEW.counterparty,'') ilike '%'||split_part(c.owner_name,' ',1)||'%'
          or coalesce(NEW.description,'')  ilike '%'||split_part(c.owner_name,' ',1)||'%'))
    );
  end if;
  begin
    if NEW.source='monobank' and (NEW.raw ? 'time') then
      NEW.occurred_ts := to_timestamp((NEW.raw->>'time')::bigint);
    elsif NEW.source='privatbank' and (NEW.raw ? 'DATE_TIME_DAT_OD_TIM_P') then
      NEW.occurred_ts := (to_timestamp(NEW.raw->>'DATE_TIME_DAT_OD_TIM_P','DD.MM.YYYY HH24:MI:SS')::timestamp at time zone 'Europe/Kyiv');
    else
      NEW.occurred_ts := coalesce(NEW.occurred_ts, NEW.occurred_at::timestamptz);
    end if;
  exception when others then
    NEW.occurred_ts := coalesce(NEW.occurred_ts, NEW.occurred_at::timestamptz);
  end;
  return NEW;
end $fn$;

create or replace function public.kasa_search(p_text text, p_min numeric, p_max numeric, p_limit int default 300)
returns table(occurred_ts timestamptz, occurred_at date, account_id uuid, description text, counterparty text, direction text, amount_uah numeric, source text, is_internal boolean)
language sql stable security invoker as $$
  select t.occurred_ts, t.occurred_at, t.account_id, t.description, t.counterparty, t.direction, t.amount_uah, t.source, t.is_internal
  from public.kasa_transactions t
  join public.kasa_accounts a on a.id = t.account_id and a.is_active
  where (coalesce(p_text,'')='' or t.description ilike '%'||p_text||'%' or t.counterparty ilike '%'||p_text||'%')
    and (p_min is null or t.amount_uah >= p_min)
    and (p_max is null or t.amount_uah <= p_max)
  order by t.occurred_ts desc nulls last
  limit greatest(1, least(p_limit, 1000));
$$;
grant execute on function public.kasa_search(text,numeric,numeric,int) to authenticated;

-- внутрішні переміщення по рахунках (is_internal): надійшло / відправлено
create or replace function public.kasa_internal_flow(p_from date, p_to date)
returns table(account_id uuid, moved_in numeric, moved_out numeric)
language sql stable security invoker as $$
  select t.account_id,
    coalesce(sum(t.amount_uah) filter (where t.direction='in'),0)  as moved_in,
    coalesce(sum(t.amount_uah) filter (where t.direction='out'),0) as moved_out
  from public.kasa_transactions t
  join public.kasa_accounts a on a.id = t.account_id and a.is_active
  where t.is_internal and t.occurred_at >= p_from and t.occurred_at <= p_to
  group by t.account_id;
$$;
grant execute on function public.kasa_internal_flow(date,date) to authenticated;
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const nn = await sql`select count(*)::int n, count(occurred_ts)::int with_ts from public.kasa_transactions`;
    const inf = await sql`select * from public.kasa_internal_flow('2026-05-01', now()::date)`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, counts: nn, internal_flow: inf }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
