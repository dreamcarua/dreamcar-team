// ============================================================================
// kasa-sync-privat — ПриватБанк (Автоклієнт), кілька ФОП.
// ВАЖЛИВО: Privat ACP віддає тіло у windows-1251 — декодуємо саме так (інакше кирилиця = сміття).
// Фактичний баланс через /api/statements/balance -> api_balance.
// Виписки: інкрементал (35 днів) + backfill (курсор, не глибше 2026-03-01).
// upsert оновлює existing рядки (щоб виправити старий текст). Guard: x-cron-key.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ACP = "https://acp.privatbank.ua/api/statements/transactions";
const ACP_BAL = "https://acp.privatbank.ua/api/statements/balance";
const WINDOW_DAYS = 31;
const BACKFILL_FROM = Deno.env.get("KASA_BACKFILL_FROM") || "2026-03-01";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const dayStr = (d: Date) => d.toISOString().slice(0, 10);
const ddmmyyyy = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
function toISO(dat: string): string {
  if (!dat) return new Date().toISOString().slice(0, 10);
  const m = dat.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : new Date().toISOString().slice(0, 10);
}

// Privat віддає windows-1251 — читаємо як cp1251, потім JSON.parse
async function privatJSON(url: string, id: string, token: string) {
  const r = await fetch(url, { headers: { id, token, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`privat ${r.status}: ${await r.text()}`);
  const buf = await r.arrayBuffer();
  const text = new TextDecoder("windows-1251").decode(buf);
  return JSON.parse(text);
}

async function guardOk(req: Request): Promise<boolean> {
  const { data } = await sb.from("kasa_config").select("value").eq("key", "cron_key").maybeSingle();
  const expected = data?.value;
  const got = req.headers.get("x-cron-key") || new URL(req.url).searchParams.get("key");
  return !!expected && got === expected;
}

async function fetchPage(id: string, token: string, startDate: string, endDate: string, followId?: string) {
  const u = new URL(ACP);
  u.searchParams.set("startDate", startDate);
  u.searchParams.set("endDate", endDate);
  u.searchParams.set("limit", "100");
  if (followId) u.searchParams.set("followId", followId);
  return privatJSON(u.toString(), id, token);
}

async function refreshBalances(cred: any, pacc: any[], cache: Map<string, string>) {
  const u = new URL(ACP_BAL);
  u.searchParams.set("startDate", ddmmyyyy(new Date()));
  u.searchParams.set("limit", "100");
  let data: any;
  try { data = await privatJSON(u.toString(), cred.privat_id, cred.token); } catch { return 0; }
  const now = new Date().toISOString();
  const seen = new Set<string>();
  let n = 0;
  for (const b of data.balances || []) {
    const acc = b.acc || b.account || "";
    if (!acc || seen.has(acc)) continue;
    seen.add(acc);
    const bal = parseFloat(b.balanceOutEq ?? b.balanceOut ?? "0");
    const accId = await resolveAccount(acc, cred.label, cache, pacc);
    await sb.from("kasa_accounts").update({ api_balance: bal, api_balance_at: now }).eq("id", accId);
    n++;
  }
  return n;
}

async function resolveAccount(acc: string, label: string, cache: Map<string, string>, pacc: any[]) {
  const key = acc || ("nolabel-" + label);
  if (cache.has(key)) return cache.get(key)!;
  let row = pacc.find((a) => a.privat_acc === acc || a.iban === acc);
  if (!row) {
    const ins = await sb.from("kasa_accounts").insert({
      name: `ПриватБанк ${label} ·${(acc || "").slice(-4)}`, kind: "bank", bank: "privatbank",
      currency: "UAH", privat_acc: acc, iban: acc, mono_token_label: label,
      icon: "🟢", color: "#2BA24C", sort_order: 21,
    }).select("id").single();
    row = ins.data; pacc.push({ ...row, privat_acc: acc, iban: acc });
  }
  cache.set(key, row.id);
  return row.id;
}

async function pullWindow(cred: any, startDate: string, endDate: string, pacc: any[], cache: Map<string, string>) {
  let upserted = 0, scanned = 0, followId: string | undefined, guard = 0;
  do {
    const page = await fetchPage(cred.privat_id, cred.token, startDate, endDate, followId);
    const txs = page.transactions || [];
    scanned += txs.length;
    const rows = [];
    for (const t of txs) {
      const accId = await resolveAccount(t.AUT_MY_ACC || t.aut_my_acc || "", cred.label, cache, pacc);
      const ext = String(t.ID || t.REF || `${t.AUT_MY_ACC}-${t.DAT_OD}-${t.SUM}-${(t.OSND || "").slice(0, 16)}`);
      rows.push({
        account_id: accId,
        direction: (t.TRANTYPE === "C" || t.trantype === "C") ? "in" : "out",
        amount_uah: Math.abs(parseFloat(t.SUM || t.sum || "0")),
        occurred_at: toISO(t.DAT_OD || t.dat_od),
        description: t.OSND || t.osnd || null,
        counterparty: t.AUT_CNTR_NAM || t.aut_cntr_nam || null,
        source: "privatbank", external_id: ext, raw: t, created_by: "kasa-sync-privat",
      });
    }
    if (rows.length) {
      // ignoreDuplicates:false -> оновлює existing (виправляє старий зламаний текст)
      const { error } = await sb.from("kasa_transactions").upsert(rows, { onConflict: "source,external_id" });
      if (error) throw error;
      upserted += rows.length;
    }
    followId = page.exist_next_page ? page.next_page_id : undefined;
    guard++;
  } while (followId && guard < 100);
  return { scanned, upserted };
}

async function syncCred(cred: any) {
  const today = new Date();
  const target = new Date(BACKFILL_FROM);
  const { data: pa } = await sb.from("kasa_accounts").select("*").eq("bank", "privatbank");
  const pacc = pa || [];
  const cache = new Map<string, string>();

  let bal = 0; try { bal = await refreshBalances(cred, pacc, cache); } catch (_) {}

  const incFrom = new Date(); incFrom.setDate(incFrom.getDate() - 35);
  const inc = await pullWindow(cred, ddmmyyyy(incFrom), ddmmyyyy(today), pacc, cache);

  const patch: any = { last_inc: new Date().toISOString(), last_status: `bal:${bal} inc:${inc.upserted}` };
  let bf: any = null;

  let cursor = cred.synced_from ? new Date(cred.synced_from) : null;
  if (!cursor) { cursor = new Date(incFrom); patch.synced_from = dayStr(incFrom); }
  else if (cursor > target) {
    const to = new Date(cursor); const from = new Date(to); from.setDate(from.getDate() - WINDOW_DAYS);
    if (from < target) from.setTime(target.getTime());
    bf = await pullWindow(cred, ddmmyyyy(from), ddmmyyyy(to), pacc, cache);
    patch.synced_from = dayStr(from);
    patch.last_status = `bal:${bal} inc:${inc.upserted} bf:${bf.upserted} (${dayStr(from)})`;
  }

  await sb.from("kasa_bank_creds").update(patch).eq("id", cred.id);
  return { label: cred.label, balances: bal, incremental: inc, backfill: bf };
}

Deno.serve(async (req) => {
  if (!(await guardOk(req))) return new Response("forbidden", { status: 403 });
  const u = new URL(req.url);
  // ?repair=1 — скинути курсор, щоб перетягнути все з виправленим кодуванням
  if (u.searchParams.get("repair") === "1") {
    await sb.from("kasa_bank_creds").update({ synced_from: null }).eq("bank", "privatbank");
  }
  const { data: creds } = await sb.from("kasa_bank_creds").select("*").eq("bank", "privatbank").eq("is_active", true);
  if (!creds || !creds.length) {
    return new Response(JSON.stringify({ ok: true, note: "no privatbank creds" }), { headers: { "Content-Type": "application/json" } });
  }
  const results: any[] = [];
  for (const c of creds) {
    try { results.push(await syncCred(c)); }
    catch (e) {
      const msg = String(e?.message || e);
      results.push({ label: c.label, error: msg });
      await sb.from("kasa_bank_creds").update({ last_status: "ERR: " + msg.slice(0, 80) }).eq("id", c.id);
    }
  }
  return new Response(JSON.stringify({ ok: true, results }, null, 2), { headers: { "Content-Type": "application/json" } });
});
