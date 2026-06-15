// ============================================================================
// kasa-sync-mono — синк виписок monobank (особистий токен ФОП) у kasa_transactions
// Поважає ліміт monobank: <= 1 запит /60с на ТОКЕН. За один виклик робить
// максимум ОДИН statement-запит на кожен токен. Прогрес — через cron (кожні 2-3 хв).
//
// ENV (Supabase function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (автоматично)
//   MONO_TOKENS   — JSON: [{"token":"...","label":"vadym"},{"token":"...","label":"artem"}]
//                   або просто один рядок-токен.
//   CRON_SECRET   — (опц.) якщо задано, потрібен header x-cron-key з тим самим значенням
//   KASA_MONO_BACKFILL_DAYS — (опц.) глибина історії, дефолт 1095 (3 роки)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MONO_API = "https://api.monobank.ua";
const WINDOW_DAYS = 31;             // ліміт monobank на одну виписку
const INC_REFRESH_MIN = 55;        // інкрементал не частіше ніж раз на 55 хв на рахунок

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function parseTokens(): { token: string; label: string }[] {
  const raw = (Deno.env.get("MONO_TOKENS") || "").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      return JSON.parse(raw)
        .filter((t: any) => t && t.token)
        .map((t: any, i: number) => ({ token: String(t.token), label: String(t.label || `mono${i + 1}`) }));
    } catch { return []; }
  }
  return [{ token: raw, label: "mono1" }];
}

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

async function monoGET(path: string, token: string) {
  const r = await fetch(MONO_API + path, { headers: { "X-Token": token } });
  if (r.status === 429) throw new Error("rate_limit");
  if (!r.ok) throw new Error(`mono ${r.status}: ${await r.text()}`);
  return r.json();
}

// мапимо рахунки токена (тільки UAH = currencyCode 980)
async function ensureAccounts(token: string, label: string) {
  const info = await monoGET("/personal/client-info", token);
  const created: string[] = [];
  for (const a of info.accounts || []) {
    if (a.currencyCode !== 980) continue; // тільки гривня
    const { data: exist } = await sb.from("kasa_accounts")
      .select("id").eq("mono_account_id", a.id).maybeSingle();
    if (exist) continue;
    const nm = `monobank ${label} ·${(a.maskedPan?.[0] || a.iban || a.id).toString().slice(-4)}`;
    await sb.from("kasa_accounts").insert({
      name: nm, kind: "bank", bank: "monobank", currency: "UAH",
      mono_account_id: a.id, mono_token_label: label, iban: a.iban || null,
      icon: "⚫", color: "#111111", sort_order: 60,
    });
    created.push(nm);
  }
  return created;
}

async function upsertStatement(accountRow: any, items: any[]) {
  if (!items.length) return 0;
  const rows = items.map((it) => ({
    account_id: accountRow.id,
    direction: it.amount >= 0 ? "in" : "out",
    amount_uah: Math.abs(it.amount) / 100,
    occurred_at: dayStr(new Date(it.time * 1000)),
    description: it.description || null,
    counterparty: it.counterName || it.description || null,
    source: "monobank",
    external_id: it.id,
    raw: it,
    created_by: "kasa-sync-mono",
  }));
  const { error } = await sb.from("kasa_transactions")
    .upsert(rows, { onConflict: "source,external_id", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

// один statement-запит для токена: спочатку інкрементал, потім backfill
async function syncOneCallForToken(token: string, label: string) {
  const target = new Date();
  target.setDate(target.getDate() - Number(Deno.env.get("KASA_MONO_BACKFILL_DAYS") || 1095));

  const { data: accs } = await sb.from("kasa_accounts")
    .select("*").eq("bank", "monobank").eq("mono_token_label", label).eq("is_active", true)
    .order("sort_order");

  if (!accs || !accs.length) {
    const created = await ensureAccounts(token, label);
    return { token: label, action: "mapped_accounts", created };
  }

  // 1) інкрементал: рахунок з найстарішим mono_last_inc (або null)
  const incAcc = accs
    .filter((a) => !a.mono_last_inc || (Date.now() - new Date(a.mono_last_inc).getTime()) > INC_REFRESH_MIN * 60000)
    .sort((a, b) => new Date(a.mono_last_inc || 0).getTime() - new Date(b.mono_last_inc || 0).getTime())[0];

  if (incAcc) {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - WINDOW_DAYS);
    const items = await monoGET(`/personal/statement/${incAcc.mono_account_id}/${unix(from)}/${unix(to)}`, token);
    const n = await upsertStatement(incAcc, items);
    const patch: any = { mono_last_inc: new Date().toISOString() };
    if (!incAcc.mono_synced_from) patch.mono_synced_from = dayStr(from);
    await sb.from("kasa_accounts").update(patch).eq("id", incAcc.id);
    return { token: label, action: "incremental", account: incAcc.name, fetched: n };
  }

  // 2) backfill: рахунок з найбільшим mono_synced_from що ще > target
  const bfAcc = accs
    .filter((a) => a.mono_synced_from && new Date(a.mono_synced_from) > target)
    .sort((a, b) => new Date(b.mono_synced_from).getTime() - new Date(a.mono_synced_from).getTime())[0];

  if (bfAcc) {
    const to = new Date(bfAcc.mono_synced_from);
    const from = new Date(to); from.setDate(from.getDate() - WINDOW_DAYS);
    if (from < target) from.setTime(target.getTime());
    const items = await monoGET(`/personal/statement/${bfAcc.mono_account_id}/${unix(from)}/${unix(to)}`, token);
    const n = await upsertStatement(bfAcc, items);
    await sb.from("kasa_accounts").update({ mono_synced_from: dayStr(from) }).eq("id", bfAcc.id);
    return { token: label, action: "backfill", account: bfAcc.name, window: `${dayStr(from)}..${dayStr(to)}`, fetched: n };
  }

  return { token: label, action: "idle (up to date)" };
}

Deno.serve(async (req) => {
  const need = Deno.env.get("CRON_SECRET");
  if (need && req.headers.get("x-cron-key") !== need) {
    return new Response("forbidden", { status: 403 });
  }
  const tokens = parseTokens();
  if (!tokens.length) {
    return new Response(JSON.stringify({ error: "MONO_TOKENS not set" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const results: any[] = [];
  for (const t of tokens) {
    try { results.push(await syncOneCallForToken(t.token, t.label)); }
    catch (e) { results.push({ token: t.label, error: String(e?.message || e) }); }
  }
  return new Response(JSON.stringify({ ok: true, results }, null, 2), { headers: { "Content-Type": "application/json" } });
});
