// ============================================================================
// kasa-sync-mono — monobank: фактичний баланс (client-info) + ПОВНЕ захоплення
// виписок через чергу вікон kasa_mono_queue (обхід ліміту ~500 операцій/запит).
// Якщо вікно впирається в 500 — ділиться навпіл і доганяється. 1 запит/60с на токен.
// Баланс і виписки йдуть у РІЗНІ цикли крону (по 1 запиту/токен/запуск), тож
// часте оновлення балансу не порушує ліміт monobank.
// Guard: x-cron-key == kasa_config.cron_key.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MONO_API = "https://api.monobank.ua";
const PAGE_LIMIT = 500;        // ліміт monobank на один statement-запит
const BAL_REFRESH_MIN = 5;     // як часто освіжати API-баланс (хв). Менше = менша розбіжність із операціями.

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const nowUnix = () => Math.floor(Date.now() / 1000);

async function guardOk(req: Request): Promise<boolean> {
  const { data } = await sb.from("kasa_config").select("value").eq("key", "cron_key").maybeSingle();
  const expected = data?.value;
  const got = req.headers.get("x-cron-key") || new URL(req.url).searchParams.get("key");
  return !!expected && got === expected;
}

async function monoGET(path: string, token: string) {
  const r = await fetch(MONO_API + path, { headers: { "X-Token": token } });
  if (r.status === 429) throw new Error("rate_limit");
  if (!r.ok) throw new Error(`mono ${r.status}: ${await r.text()}`);
  return r.json();
}

async function refreshFromClientInfo(token: string, label: string) {
  const info = await monoGET("/personal/client-info", token);
  const now = new Date().toISOString();
  let updated = 0, created = 0;
  for (const a of info.accounts || []) {
    if (a.currencyCode !== 980) continue;
    const { data: exist } = await sb.from("kasa_accounts").select("id").eq("mono_account_id", a.id).maybeSingle();
    if (exist) {
      await sb.from("kasa_accounts").update({ api_balance: a.balance / 100, api_balance_at: now }).eq("id", exist.id);
      updated++;
    } else {
      const last4 = (a.maskedPan?.[0] || a.iban || a.id).toString().slice(-4);
      await sb.from("kasa_accounts").insert({
        name: `monobank ${label} ·${last4}`, kind: "bank", bank: "monobank", currency: "UAH",
        mono_account_id: a.id, mono_token_label: label, iban: a.iban || null,
        api_balance: a.balance / 100, api_balance_at: now, is_active: false,
        icon: "⚫", color: "#111111", sort_order: 60,
      });
      created++;
    }
  }
  return { updated, created };
}

async function upsertStatement(accId: string, items: any[]) {
  if (!items.length) return 0;
  const rows = items.map((it) => ({
    account_id: accId,
    direction: it.amount >= 0 ? "in" : "out",
    amount_uah: Math.abs(it.amount) / 100,
    occurred_at: dayStr(new Date(it.time * 1000)),
    description: it.description || null,
    counterparty: it.counterName || it.description || null,
    source: "monobank", external_id: it.id, raw: it, created_by: "kasa-sync-mono",
  }));
  const { error } = await sb.from("kasa_transactions").upsert(rows, { onConflict: "source,external_id", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

async function processToken(token: string, label: string) {
  const { data: accs } = await sb.from("kasa_accounts")
    .select("*").eq("bank", "monobank").eq("mono_token_label", label).eq("is_active", true).order("sort_order");

  if (!accs || !accs.length) {
    const r = await refreshFromClientInfo(token, label);
    return { token: label, action: "mapped_accounts", ...r };
  }
  const accIds = accs.map((a) => a.id);

  // 1) баланс із API (кожні BAL_REFRESH_MIN хв)
  const balStale = accs.some((a) => !a.api_balance_at || (Date.now() - new Date(a.api_balance_at).getTime()) > BAL_REFRESH_MIN * 60000);
  if (balStale) { const r = await refreshFromClientInfo(token, label); return { token: label, action: "balances", ...r }; }

  // 2) обробити одне вікно з черги
  const { data: pend } = await sb.from("kasa_mono_queue")
    .select("*").in("account_id", accIds).eq("status", "pending").order("id").limit(1);
  if (pend && pend.length) {
    const w = pend[0];
    const items = await monoGET(`/personal/statement/${w.mono_account_id}/${w.from_unix}/${w.to_unix}`, token);
    const n = await upsertStatement(w.account_id, items);
    let split = false;
    if (items.length >= PAGE_LIMIT && (w.to_unix - w.from_unix) > 3600) {
      const mid = Math.floor((w.from_unix + w.to_unix) / 2);
      await sb.from("kasa_mono_queue").insert([
        { account_id: w.account_id, mono_account_id: w.mono_account_id, from_unix: w.from_unix, to_unix: mid },
        { account_id: w.account_id, mono_account_id: w.mono_account_id, from_unix: mid, to_unix: w.to_unix },
      ]);
      split = true;
    }
    await sb.from("kasa_mono_queue").update({ status: "done" }).eq("id", w.id);
    return { token: label, action: "queue", fetched: n, split, window_days: Math.round((w.to_unix - w.from_unix) / 86400) };
  }

  // 3) черга порожня → освіжити останні 2 дні (новий рух)
  const acc = accs.sort((a, b) => new Date(a.mono_last_inc || 0).getTime() - new Date(b.mono_last_inc || 0).getTime())[0];
  const to = nowUnix(); const from = to - 2 * 86400;
  const items = await monoGET(`/personal/statement/${acc.mono_account_id}/${from}/${to}`, token);
  const n = await upsertStatement(acc.id, items);
  await sb.from("kasa_accounts").update({ mono_last_inc: new Date().toISOString() }).eq("id", acc.id);
  if (items.length >= PAGE_LIMIT) {
    await sb.from("kasa_mono_queue").insert([{ account_id: acc.id, mono_account_id: acc.mono_account_id, from_unix: from, to_unix: to }]);
  }
  return { token: label, action: "recent", account: acc.name, fetched: n };
}

Deno.serve(async (req) => {
  if (!(await guardOk(req))) return new Response("forbidden", { status: 403 });
  const { data: creds } = await sb.from("kasa_bank_creds").select("*").eq("bank", "monobank").eq("is_active", true);
  if (!creds || !creds.length) {
    return new Response(JSON.stringify({ ok: true, note: "no monobank creds" }), { headers: { "Content-Type": "application/json" } });
  }
  const results: any[] = [];
  for (const c of creds) {
    try {
      const r = await processToken(c.token, c.label);
      results.push(r);
      await sb.from("kasa_bank_creds").update({ last_inc: new Date().toISOString(), last_status: r.action }).eq("id", c.id);
    } catch (e) {
      const msg = String(e?.message || e);
      results.push({ token: c.label, error: msg });
      await sb.from("kasa_bank_creds").update({ last_status: "ERR: " + msg.slice(0, 80) }).eq("id", c.id);
    }
  }
  return new Response(JSON.stringify({ ok: true, results }, null, 2), { headers: { "Content-Type": "application/json" } });
});
