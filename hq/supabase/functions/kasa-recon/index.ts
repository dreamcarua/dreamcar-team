// ОДНОРАЗОВА діагностика: куди «дівається» різниця між (надходження-витрати) і балансом.
// Guard ?key=dckasa-recon-R7
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-recon-R7";
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    const r = await sql`
      with t as (
        select x.*, a.kind, a.is_active
        from public.kasa_transactions x
        join public.kasa_accounts a on a.id = x.account_id
        where a.is_active
      )
      select
        (select coalesce(sum(amount_uah),0) from t where direction='in'  and not (is_internal or excl_pnl)) as pnl_in,
        (select coalesce(sum(amount_uah),0) from t where direction='out' and not (is_internal or excl_pnl)) as pnl_out,
        (select coalesce(sum(amount_uah),0) from t where direction='in')  as all_in,
        (select coalesce(sum(amount_uah),0) from t where direction='out') as all_out,
        (select coalesce(sum(amount_uah),0) from t where div_to is not null and direction='out') as dividends_out,
        (select coalesce(sum(amount_uah),0) from t where excl_pnl and div_to is null and direction='out') as excl_other_out,
        (select coalesce(sum(amount_uah),0) from t where is_internal and direction='out') as internal_out,
        (select coalesce(sum(amount_uah),0) from t where is_internal and direction='in')  as internal_in,
        (select coalesce(sum(amount_uah),0) from t where excl_pnl and direction='in')  as excl_in,
        (select coalesce(sum(opening_balance),0) from public.kasa_accounts where is_active) as opening_total,
        (select coalesce(sum(api_balance),0) from public.kasa_accounts where is_active and kind='bank') as api_bank_total,
        (select coalesce(sum(opening_balance),0) from public.kasa_accounts where is_active and kind in ('cash','dividends')) as opening_nonbank
    `;
    const x = r[0];
    const bal = Number(x.api_bank_total);
    const pnl_net = Number(x.pnl_in) - Number(x.pnl_out);
    const out = {
      ...x,
      pnl_net,
      gap_pnlnet_minus_balance: pnl_net - bal,
      explain_gap: Number(x.dividends_out) + Number(x.excl_other_out) - Number(x.opening_total),
    };
    await sql.end();
    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
