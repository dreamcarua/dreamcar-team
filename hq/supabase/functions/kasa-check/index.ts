// ОДНОРАЗОВА перевірка: ?key=dckasa-check-Zz4 [&kick=1]
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-check-Zz4";
Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (u.searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    if (u.searchParams.get("kick") === "1") {
      await sql`select public.kasa_kick_one('kasa-sync-mono')`;
      await sql`select public.kasa_kick_one('kasa-sync-privat')`;
    }
    const acc = await sql`
      select a.name, a.is_active, a.api_balance, a.api_balance_at,
        coalesce((select round(sum(case when t.direction='in' then t.amount_uah else -t.amount_uah end))
          from public.kasa_transactions t where t.account_id=a.id),0) as ops_balance
      from public.kasa_accounts a where a.bank in ('monobank','privatbank') and a.is_active
      order by a.bank, a.name`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, accounts: acc }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
