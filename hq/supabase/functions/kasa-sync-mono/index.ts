// ============================================================================
// kasa-sync-mono — синк виписок monobank (особисті токени ФОП) у kasa_transactions.
// Креди беруться з таблиці public.kasa_bank_creds (bank='monobank', is_active).
// Поважає ліміт monobank: <= 1 statement-запит /60с на ТОКЕН (1 виклик/токен за раз).
// Guard: header x-cron-key (або ?key=) == kasa_config.cron_key.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MONO_API = "https://api.monobank.ua";
const WINDOW_DAYS = 31;
const INC_REFRESH_MIN = 55;
const BACKFILL_DAYS = Number(Deno.env.get("KASA_MONO_BACKFILL_DAYS") || 1095);

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const unix = (d: Date) => Math.floor(d.getTime() / 1000);

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

async function ensureAccounts(token: string, label: string) {
  const info = await monoGET("/personal/client-info", token);
  const created: string[] = [];
  for (const a of info.accounts || []) {
    if (a.currencyCode !== 980) continue; // тільки UAH
    const { data: exist } = await sb.from("kasa_accounts").select("id").eq("mono_account_id", a.id).maybeSingle();
    if (exist) continue;
    const last4 = (a.maskedPan?.[0] || a.iban || a.id).toString().slice(-4);
    await sb.from("kasa_accounts").insert({
      name: `monobank ${label} ·${last4}`, kind: "bank", bank: "monobank", currency: "UAH",
      mono_account_id: a.id, mono_token_label: label, iban: a.iban || null,
      icon: "⚫", color: "#111111", sort_order: 60,
    });
    created.push(`monobank ${label} ·${last4}`);
  }
  return created;
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

async function syncOneCallForToken(token: string, label: string) {
  const target = new Date(); target.setDate(target.getDate() - BACKFILL_DAYS);

  const { data: accs } = await sb.from("kasa_accounts")
    .select("*").eq("bank", "monobank").eq("mono_token_label", label).eq("is_active", true).order("sort_order");

  if (!accs || !accs.length) {
    const created = await ensureAccounts(token, label);
    return { token: label, action: "mapped_accounts", created };
  }

  const incAcc = accs
    .filter((a) => !a.mono_last_inc || (Date.now() - new Date(a.mono_last_inc).getTime()) > INC_REFRESH_MIN * 60000)
    .sort((a, b) => new Date(a.mono_last_inc || 0).getTime() - new Date(b.mono_last_inc || 0).getTime())[0];
  if (incAcc) {
    const to = new Date(); const from = new Date(); from.setDate(from.getDate() - WINDOW_DAYS);
    const items = await monoGET(`/personal/statement/${incAcc.mono_account_id}/${unix(from)}/${unix(to)}`, token);
    const n = await upsertStatement(incAcc.id, items);
    const patch: any = { mono_last_inc: new Date().toISOString() };
    if (!incAcc.mono_synced_from) patch.mono_synced_from = dayStr(from);
    await sb.from("kasa_accounts").update(patch).eq("id", incAcc.id);
    return { token: label, action: "incremental", account: incAcc.name, fetched: n };
  }

  const bfAcc = accs
    .filter((a) => a.mono_synced_from && new Date(a.mono_synced_from) > target)
    .sort((a, b) => new Date(b.mono_synced_from).getTime() - new Date(a.mono_synced_from).getTime())[0];
  if (bfAcc) {
    const to = new Date(bfAcc.mono_synced_from); const from = new Date(to); from.setDate(from.getDate() - WINDOW_DAYS);
    if (from < target) from.setTime(target.getTime());
    const items = await monoGET(`/personal/statement/${bfAcc.mono_account_id}/${unix(from)}/${unix(to)}`, token);
    const n = await upsertStatement(bfAcc.id, items);
    await sb.from("kasa_accounts").update({ mono_synced_from: dayStr(from) }).eq("id", bfAcc.id);
    return { token: label, action: "backfill", account: bfAcc.name, window: `${dayStr(from)}..${dayStr(to)}`, fetched: n };
  }

  return { token: label, action: "idle" };
}

Deno.serve(async (req) => {
  if (!(await guardOk(req))) return new Response("forbidden", { status: 403 });
  const { data: creds } = await sb.from("kasa_bank_creds").select("*").eq("bank", "monobank").eq("is_active", true);
  if (!creds || !creds.length) {
    return new Response(JSON.stringify({ ok: true, note: "no monobank creds in kasa_bank_creds" }), { headers: { "Content-Type": "application/json" } });
  }
  const results: any[] = [];
  for (const c of creds) {
    try {
      const r = await syncOneCallForToken(c.token, c.label);
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
