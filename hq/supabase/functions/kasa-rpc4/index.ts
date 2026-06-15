// ОДНОРАЗОВА: RPC рахують лише по АКТИВНИХ рахунках (виключити неактивні/особисті). Guard ?key=dckasa-rpc4-Hf2
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-rpc4-Hf2";
const SQL = `
create or replace function public.kasa_cashflow(p_from date, p_to date, p_gran text default 'month')
returns table(bucket text, inflow numeric, outflow numeric)
language sql stable security invoker as $$
  select to_char(t.occurred_at, case when p_gran='day' then 'YYYY-MM-DD' else 'YYYY-MM' end) as bucket,
    coalesce(sum(t.amount_uah) filter (where t.direction='in'),0)  as inflow,
    coalesce(sum(t.amount_uah) filter (where t.direction='out'),0) as outflow
  from public.kasa_transactions t
  join public.kasa_accounts a on a.id = t.account_id and a.is_active
  where not t.is_internal and t.occurred_at >= p_from and t.occurred_at <= p_to
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
  where not t.is_internal and t.occurred_at >= p_from and t.occurred_at <= p_to
  group by t.account_id;
$$;

create or replace function public.kasa_account_ops()
returns table(account_id uuid, ops numeric)
language sql stable security invoker as $$
  select t.account_id, sum(case when t.direction='in' then t.amount_uah else -t.amount_uah end) as ops
  from public.kasa_transactions t
  join public.kasa_accounts a on a.id = t.account_id and a.is_active
  group by t.account_id;
$$;
grant execute on function public.kasa_cashflow(date,date,text) to authenticated;
grant execute on function public.kasa_account_cashflow(date,date) to authenticated;
grant execute on function public.kasa_account_ops() to authenticated;
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const d = await sql`select * from public.kasa_cashflow('2026-05-01', now()::date, 'month')`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, active_only: d }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
