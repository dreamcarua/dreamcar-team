import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-diag2-Xb4";
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    const bysrc = await sql`
      select source, to_char(occurred_at,'YYYY-MM') m, count(*)::int c,
        round(sum(amount_uah) filter (where direction='in'))::bigint in_all,
        round(sum(amount_uah) filter (where direction='out'))::bigint out_all,
        round(sum(amount_uah) filter (where direction='in'  and is_internal))::bigint in_int,
        round(sum(amount_uah) filter (where direction='out' and is_internal))::bigint out_int
      from public.kasa_transactions group by 1,2 order by 2,1`;
    const cov = await sql`select source, min(occurred_at) mn, max(occurred_at) mx, count(*)::int c from public.kasa_transactions group by source`;
    const creds = await sql`select label, bank, synced_from, last_status from public.kasa_bank_creds order by bank,label`;
    const acctcov = await sql`select a.name, min(t.occurred_at) mn, max(t.occurred_at) mx, count(t.*)::int c
      from public.kasa_accounts a left join public.kasa_transactions t on t.account_id=a.id
      where a.is_active and a.bank in ('monobank','privatbank') group by a.name order by a.name`;
    await sql.end();
    return new Response(JSON.stringify({ bysrc, cov, creds, acctcov }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
