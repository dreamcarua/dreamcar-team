// ОДНОРАЗОВА: RPC для серверної агрегації (щоб не вантажити 13k рядків у браузер).
// Guard ?key=dckasa-rpc-Ws3
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-rpc-Ws3";
const SQL = `
create or replace function public.kasa_monthly_cashflow(p_from date)
returns table(month text, inflow numeric, outflow numeric)
language sql stable security invoker as $$
  select to_char(occurred_at,'YYYY-MM') as month,
    coalesce(sum(amount_uah) filter (where direction='in'),0)  as inflow,
    coalesce(sum(amount_uah) filter (where direction='out'),0) as outflow
  from public.kasa_transactions
  where not is_internal and occurred_at >= p_from
  group by 1 order by 1;
$$;

create or replace function public.kasa_account_ops()
returns table(account_id uuid, ops numeric)
language sql stable security invoker as $$
  select account_id, sum(case when direction='in' then amount_uah else -amount_uah end) as ops
  from public.kasa_transactions group by account_id;
$$;

grant execute on function public.kasa_monthly_cashflow(date) to authenticated;
grant execute on function public.kasa_account_ops() to authenticated;
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const cf = await sql`select * from public.kasa_monthly_cashflow('2025-06-01')`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, cashflow: cf }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
