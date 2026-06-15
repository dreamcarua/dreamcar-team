// ОДНОРАЗОВА: свіжий пере-anchor opening = api - ops (черга порожня). Guard ?key=dckasa-reanchor2-Ux3
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-reanchor2-Ux3";
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    const pend = await sql`select count(*)::int n from public.kasa_mono_queue where status='pending'`;
    await sql`
      update public.kasa_accounts a
      set opening_balance = round(a.api_balance - coalesce((
        select sum(case when t.direction='in' then t.amount_uah else -t.amount_uah end)
        from public.kasa_transactions t where t.account_id=a.id),0),2)
      where a.bank in ('monobank','privatbank') and a.is_active and a.api_balance is not null`;
    const chk = await sql`
      select a.name, a.api_balance,
        round(a.api_balance - a.opening_balance - coalesce((select sum(case when t.direction='in' then t.amount_uah else -t.amount_uah end)
          from public.kasa_transactions t where t.account_id=a.id),0),2) residual
      from public.kasa_accounts a where a.bank in ('monobank','privatbank') and a.is_active order by a.name`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, pending_windows: pend[0].n, check: chk }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
