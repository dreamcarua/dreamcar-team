import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-chk3-Rr1";
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    const r = await sql`
      select a.name, a.bank, round(f.moved_in) moved_in, round(f.moved_out) moved_out
      from public.kasa_internal_flow('2026-05-01', now()::date) f
      join public.kasa_accounts a on a.id=f.account_id order by a.name`;
    // приклади описів внутрішніх по напрямку
    const ex = await sql`
      select a.name, t.direction, left(t.description,40) d, round(t.amount_uah) amt
      from public.kasa_transactions t join public.kasa_accounts a on a.id=t.account_id and a.is_active
      where t.is_internal order by t.amount_uah desc limit 6`;
    await sql.end();
    return new Response(JSON.stringify({ flow: r, examples: ex }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
