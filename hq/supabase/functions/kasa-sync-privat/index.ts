// ============================================================================
// kasa-sync-privat — синк виписок ПриватБанк (Автоклієнт) для кількох ФОП.
// Креди з public.kasa_bank_creds (bank='privatbank', is_active): privat_id + token + label.
// Кожен запуск: інкрементал (35 днів) + одне вікно backfill (курсор synced_from).
// Backfill НЕ глибше KASA_BACKFILL_FROM (дефолт 2026-03-01).
// Guard: header x-cron-key (або ?key=) == kasa_config.cron_key.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ACP = "https://acp.privatbank.ua/api/statements/transactions";
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
  const r = await fetch(u.toString(), { headers: { id, token, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`privat ${r.status}: ${await r.text()}`);
  return r.json();
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
      const { error } = await sb.from("kasa_transactions").upsert(rows, { onConflict: "source,external_id", ignoreDuplicates: true });
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

  // 1) інкрементал (останні 35 днів)
  const incFrom = new Date(); incFrom.setDate(incFrom.getDate() - 35);
  const inc = await pullWindow(cred, ddmmyyyy(incFrom), ddmmyyyy(today), pacc, cache);

  const patch: any = { last_inc: new Date().toISOString(), last_status: `inc:${inc.upserted}` };
  let bf: any = null;

  // 2) одне вікно backfill (курсор synced_from), не глибше target
  let cursor = cred.synced_from ? new Date(cred.synced_from) : null;
  if (!cursor) { cursor = new Date(incFrom); patch.synced_from = dayStr(incFrom); }
  else if (cursor > target) {
    const to = new Date(cursor); const from = new Date(to); from.setDate(from.getDate() - WINDOW_DAYS);
    if (from < target) from.setTime(target.getTime());
    bf = await pullWindow(cred, ddmmyyyy(from), ddmmyyyy(to), pacc, cache);
    patch.synced_from = dayStr(from);
    patch.last_status = `inc:${inc.upserted} bf:${bf.upserted} (${dayStr(from)})`;
  }

  await sb.from("kasa_bank_creds").update(patch).eq("id", cred.id);
  return { label: cred.label, incremental: inc, backfill: bf };
}

Deno.serve(async (req) => {
  if (!(await guardOk(req))) return new Response("forbidden", { status: 403 });
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
