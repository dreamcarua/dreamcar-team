import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-diag-Vy0";
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    const tot = await sql`select count(*)::int total, min(occurred_at) mn, max(occurred_at) mx,
      count(distinct (source||':'||coalesce(external_id,id::text)))::int distinct_ext from public.kasa_transactions`;
    const months = await sql`select to_char(occurred_at,'YYYY-MM') m, count(*)::int c,
      round(sum(amount_uah) filter (where direction='in'  and not is_internal))::bigint inflow,
      round(sum(amount_uah) filter (where direction='out' and not is_internal))::bigint outflow
      from public.kasa_transactions group by 1 order by 1`;
    const bysrc = await sql`select source, count(*)::int c from public.kasa_transactions group by source`;
    await sql.end();
    return new Response(JSON.stringify({ tot, months, bysrc }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
