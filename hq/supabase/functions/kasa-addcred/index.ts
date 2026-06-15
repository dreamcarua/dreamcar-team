// ОДНОРАЗОВА kasa-addcred: приймає креди у POST body і пише у kasa_bank_creds.
// Токени НЕ в коді — приходять у тілі запиту. Після використання — видалити файл.
// Guard: ?key=dckasa-addcred-Vr4m9
import postgres from "npm:postgres@3.4.4";
const GUARD = "dckasa-addcred-Vr4m9";

Deno.serve(async (req) => {
  if (new URL(req.url).searchParams.get("key") !== GUARD) return new Response("forbidden", { status: 403 });
  const conn = Deno.env.get("SUPABASE_DB_URL");
  if (!conn) return new Response(JSON.stringify({ error: "no SUPABASE_DB_URL" }), { status: 500 });
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "bad json" }), { status: 400 }); }
  const { bank, label, token, privat_id } = body || {};
  if (!bank || !label || !token) return new Response(JSON.stringify({ error: "need bank,label,token" }), { status: 400 });
  let sql: any;
  try {
    sql = postgres(conn, { prepare: false, ssl: "require", max: 1 });
    await sql`delete from public.kasa_bank_creds where bank=${bank} and label=${label}`;
    const ins = await sql`insert into public.kasa_bank_creds (bank,label,token,privat_id,is_active)
      values (${bank},${label},${token},${privat_id || null},true) returning id`;
    let kicked = false;
    try { await sql`select public.kasa_kick()`; kicked = true; } catch (_) {}
    await sql.end();
    return new Response(JSON.stringify({ ok: true, id: ins[0].id, kicked }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    try { if (sql) await sql.end(); } catch (_) {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
