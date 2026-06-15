// ОДНОРАЗОВА: модель дивідендів через тег (excl_pnl/div_to), оновлені RPC, чистка хибних переказів.
// Guard ?key=dckasa-div-Tz2
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-div-Tz2";
const SQL = `
alter table public.kasa_transactions add column if not exists excl_pnl boolean not null default false;
alter table public.kasa_transactions add column if not exists div_to text;

create or replace function public.kasa_cashflow(p_from date, p_to date, p_gran text default 'month')
returns table(bucket text, inflow numeric, outflow numeric)
language sql stable security invoker as $$
  select to_char(t.occurred_at, case when p_gran='day' then 'YYYY-MM-DD' else 'YYYY-MM' end) as bucket,
    coalesce(sum(t.amount_uah) filter (where t.direction='in'),0)  as inflow,
    coalesce(sum(t.amount_uah) filter (where t.direction='out'),0) as outflow
  from public.kasa_transactions t
  join public.kasa_accounts a on a.id = t.account_id and a.is_active
  where not (t.is_internal or t.excl_pnl) and t.occurred_at >= p_from and t.occurred_at <= p_to
  group by 1 order by 1;
$$;

create or replace function public.kasa_account_cashflow(p_from date, p_to date)
returns table(account_id uuid, inflow numeric, outflow numeric)
language sql stable security invoker as $$
  select t.account_id,
    coalesce(sum(t.amount_uah) filter (where t.direction='in'),0)  as inflow,
    coalesce(sum(t.amount_uah) filter (where t.direction='out'),0) as outflow
  from public.kasa_transactions t
  join public.kasa_accounts a on a.id = t.account_id and a.is_active
  where not (t.is_internal or t.excl_pnl) and t.occurred_at >= p_from and t.occurred_at <= p_to
  group by t.account_id;
$$;

create or replace function public.kasa_dividends(p_from date, p_to date)
returns table(who text, amt numeric)
language sql stable security invoker as $$
  select w.who,
    coalesce((select sum(case when t.div_to=w.who then t.amount_uah when t.div_to='split' then t.amount_uah/2 else 0 end)
      from public.kasa_transactions t
      where t.div_to is not null and t.direction='out' and t.occurred_at >= p_from and t.occurred_at <= p_to),0) as amt
  from (values ('vadym'),('artem')) w(who);
$$;
grant execute on function public.kasa_dividends(date,date) to authenticated;

delete from public.kasa_transfers where to_account_id in (select id from public.kasa_accounts where kind='dividends');
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const d = await sql`select * from public.kasa_dividends('2026-05-01', now()::date)`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, dividends: d }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
