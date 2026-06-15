// ОДНОРАЗОВА: якщо черга mono порожня -> пере-заякорити opening = api - ops. Guard ?key=dckasa-reanchor-Jp4
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-reanchor-Jp4";
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    const pend = await sql`select count(*)::int n from public.kasa_mono_queue where status='pending'`;
    const pending = pend[0].n;
    let anchored = false;
    if (pending === 0) {
      await sql`
        update public.kasa_accounts a
        set opening_balance = round(a.api_balance - coalesce((
          select sum(case when t.direction='in' then t.amount_uah else -t.amount_uah end)
          from public.kasa_transactions t where t.account_id=a.id),0),2)
        where a.bank in ('monobank','privatbank') and a.api_balance is not null`;
      anchored = true;
    }
    const chk = await sql`
      select a.name, a.api_balance, a.opening_balance,
        coalesce((select sum(case when t.direction='in' then t.amount_uah else -t.amount_uah end)
          from public.kasa_transactions t where t.account_id=a.id),0) ops,
        round(a.api_balance - a.opening_balance - coalesce((select sum(case when t.direction='in' then t.amount_uah else -t.amount_uah end)
          from public.kasa_transactions t where t.account_id=a.id),0),2) residual
      from public.kasa_accounts a where a.bank in ('monobank','privatbank') and a.is_active order by a.name`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, pending, anchored, check: chk }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
