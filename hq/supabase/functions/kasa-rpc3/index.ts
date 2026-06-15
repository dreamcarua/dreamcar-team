// ОДНОРАЗОВА: RPC kasa_cashflow(from,to,gran) + kasa_account_cashflow(from,to). Guard ?key=dckasa-rpc3-Qm8
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-rpc3-Qm8";
const SQL = `
create or replace function public.kasa_cashflow(p_from date, p_to date, p_gran text default 'month')
returns table(bucket text, inflow numeric, outflow numeric)
language sql stable security invoker as $$
  select to_char(occurred_at, case when p_gran='day' then 'YYYY-MM-DD' else 'YYYY-MM' end) as bucket,
    coalesce(sum(amount_uah) filter (where direction='in'),0)  as inflow,
    coalesce(sum(amount_uah) filter (where direction='out'),0) as outflow
  from public.kasa_transactions
  where not is_internal and occurred_at >= p_from and occurred_at <= p_to
  group by 1 order by 1;
$$;

create or replace function public.kasa_account_cashflow(p_from date, p_to date)
returns table(account_id uuid, inflow numeric, outflow numeric)
language sql stable security invoker as $$
  select account_id,
    coalesce(sum(amount_uah) filter (where direction='in'),0)  as inflow,
    coalesce(sum(amount_uah) filter (where direction='out'),0) as outflow
  from public.kasa_transactions
  where not is_internal and occurred_at >= p_from and occurred_at <= p_to
  group by account_id;
$$;
grant execute on function public.kasa_cashflow(date,date,text) to authenticated;
grant execute on function public.kasa_account_cashflow(date,date) to authenticated;
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const d = await sql`select * from public.kasa_cashflow((now() - interval '7 days')::date, now()::date, 'day')`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, sample7d: d }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
