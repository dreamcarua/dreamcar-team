// ОДНОРАЗОВА: RPC kasa_account_cashflow(p_from) — доходи/витрати по рахунках. Guard ?key=dckasa-rpc2-Zk7
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-rpc2-Zk7";
const SQL = `
create or replace function public.kasa_account_cashflow(p_from date)
returns table(account_id uuid, inflow numeric, outflow numeric)
language sql stable security invoker as $$
  select account_id,
    coalesce(sum(amount_uah) filter (where direction='in'),0)  as inflow,
    coalesce(sum(amount_uah) filter (where direction='out'),0) as outflow
  from public.kasa_transactions
  where not is_internal and occurred_at >= p_from
  group by account_id;
$$;
grant execute on function public.kasa_account_cashflow(date) to authenticated;
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const r = await sql`select * from public.kasa_account_cashflow('2026-05-01')`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, rows: r }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
