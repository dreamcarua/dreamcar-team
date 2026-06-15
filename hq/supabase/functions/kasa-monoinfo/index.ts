// ОДНОРАЗОВА діагностика: типи/баланси monobank-рахунків. Guard ?key=dckasa-monoinfo-Hh3
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-monoinfo-Hh3";
Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  let sql: any;
  try {
    sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, ssl: "require", max: 1 });
    const creds = await sql`select label, token from public.kasa_bank_creds where bank='monobank' and is_active`;
    await sql.end();
    const out: any[] = [];
    for (const c of creds) {
      try {
        const r = await fetch("https://api.monobank.ua/personal/client-info", { headers: { "X-Token": c.token } });
        if (!r.ok) { out.push({ label: c.label, error: `${r.status}` }); continue; }
        const info = await r.json();
        out.push({
          label: c.label, name: info.name,
          accounts: (info.accounts || []).map((a: any) => ({
            last4: (a.maskedPan?.[0] || a.iban || a.id).toString().slice(-4),
            type: a.type, ccy: a.currencyCode, balance: a.balance / 100, iban: a.iban,
          })),
          jars: (info.jars || []).map((j: any) => ({ title: j.title, balance: j.balance / 100 })),
        });
      } catch (e) { out.push({ label: c.label, error: String(e?.message || e) }); }
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
