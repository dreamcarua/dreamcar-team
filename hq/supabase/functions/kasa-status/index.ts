import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-status-Lp7";
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    const creds = await sql`select bank,label,is_active,synced_from,last_status,last_inc from public.kasa_bank_creds order by bank,label`;
    const tx = await sql`select source, count(*)::int n, min(occurred_at) min_d, max(occurred_at) max_d,
      round(sum(amount_uah) filter (where direction='in'))::bigint inflow,
      round(sum(amount_uah) filter (where direction='out'))::bigint outflow
      from public.kasa_transactions group by source order by source`;
    const acc = await sql`select name from public.kasa_accounts where bank='privatbank' order by name`;
    await sql.end();
    return new Response(JSON.stringify({ creds, tx, privat_accounts: acc }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
