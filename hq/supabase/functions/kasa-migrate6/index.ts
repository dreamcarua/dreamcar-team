// ОДНОРАЗОВА migrate6: вимкнути порожні privat-рахунки (0 баланс + 0 операцій).
// Guard ?key=dckasa-migrate6-Cw1
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-migrate6-Cw1";
const SQL = `
update public.kasa_accounts set is_active=false
where bank='privatbank' and coalesce(api_balance,0)=0
  and id not in (select distinct account_id from public.kasa_transactions where account_id is not null);
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    const acc = await sql`select name, is_active, api_balance from public.kasa_accounts where bank in ('monobank','privatbank') order by is_active desc, name`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, acc }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
