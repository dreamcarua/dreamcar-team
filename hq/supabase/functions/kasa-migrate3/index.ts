import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-migrate3-Wq2";
const SQL = `
drop index if exists public.kasa_tx_source_extid_uniq;
create unique index if not exists kasa_tx_source_extid_uniq
  on public.kasa_transactions(source, external_id);
`;
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    await sql.unsafe(SQL).simple();
    await sql`select public.kasa_kick()`;
    await sql.end();
    return new Response(JSON.stringify({ ok: true, kicked: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
