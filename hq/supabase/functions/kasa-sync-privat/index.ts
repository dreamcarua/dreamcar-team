// ============================================================================
// kasa-sync-privat — синк виписок ПриватБанк (Автоклієнт Приват24 для бізнесу)
// у kasa_transactions. Privat не має жорсткого ліміту як mono — тягнемо вікно
// з пагінацією за один виклик.
//
// ENV (Supabase function secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (авто)
//   PRIVAT_AUTOCLIENT_ID, PRIVAT_AUTOCLIENT_TOKEN  — з Автоклієнта у Приват24 Бізнес
//   CRON_SECRET — (опц.) header x-cron-key
//
// Виклик:
//   POST .../kasa-sync-privat              → інкрементал (останні 35 днів)
//   POST .../kasa-sync-privat?from=01-01-2024&to=31-01-2024  → backfill вікна
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ACP = "https://acp.privatbank.ua/api/statements/transactions";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const ID = Deno.env.get("PRIVAT_AUTOCLIENT_ID") || "";
const TOKEN = Deno.env.get("PRIVAT_AUTOCLIENT_TOKEN") || "";

const ddmmyyyy = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

// DAT_OD "dd.mm.yyyy" → "yyyy-mm-dd"
function toISO(dat: string): string {
  if (!dat) return new Date().toISOString().slice(0, 10);
  const m = dat.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : new Date().toISOString().slice(0, 10);
}

async function fetchPage(startDate: string, endDate: string, followId?: string) {
  const u = new URL(ACP);
  u.searchParams.set("startDate", startDate);
  u.searchParams.set("endDate", endDate);
  u.searchParams.set("limit", "100");
  if (followId) u.searchParams.set("followId", followId);
  const r = await fetch(u.toString(), { headers: { id: ID, token: TOKEN, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`privat ${r.status}: ${await r.text()}`);
  return r.json();
}

async function resolveAccount(acc: string, cache: Map<string, string>, privatAccounts: any[]) {
  if (cache.has(acc)) return cache.get(acc)!;
  let row = privatAccounts.find((a) => a.privat_acc === acc || a.iban === acc);
  if (!row && privatAccounts.length === 1) row = privatAccounts[0]; // один рахунок — все туди
  if (!row) {
    const ins = await sb.from("kasa_accounts").insert({
      name: `ПриватБанк ·${acc.slice(-4)}`, kind: "bank", bank: "privatbank",
      currency: "UAH", privat_acc: acc, iban: acc, icon: "🟢", color: "#2BA24C", sort_order: 21,
    }).select("id").single();
    row = ins.data; privatAccounts.push({ ...row, privat_acc: acc, iban: acc });
  }
  cache.set(acc, row.id);
  return row.id;
}

Deno.serve(async (req) => {
  const need = Deno.env.get("CRON_SECRET");
  if (need && req.headers.get("x-cron-key") !== need) return new Response("forbidden", { status: 403 });
  if (!ID || !TOKEN) {
    return new Response(JSON.stringify({ error: "PRIVAT_AUTOCLIENT_ID/TOKEN not set" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const url = new URL(req.url);
  const today = new Date();
  const from35 = new Date(); from35.setDate(from35.getDate() - 35);
  const startDate = url.searchParams.get("from") || ddmmyyyy(from35);
  const endDate = url.searchParams.get("to") || ddmmyyyy(today);

  const { data: privatAccounts } = await sb.from("kasa_accounts")
    .select("*").eq("bank", "privatbank");
  const cache = new Map<string, string>();
  const pacc = privatAccounts || [];

  let inserted = 0, scanned = 0, followId: string | undefined, guard = 0;
  try {
    do {
      const page = await fetchPage(startDate, endDate, followId);
      const txs = page.transactions || [];
      scanned += txs.length;
      const rows = [];
      for (const t of txs) {
        const accId = await resolveAccount(t.AUT_MY_ACC || t.aut_my_acc || "unknown", cache, pacc);
        const ext = String(t.ID || t.REF || `${t.AUT_MY_ACC}-${t.DAT_OD}-${t.SUM}-${(t.OSND || "").slice(0, 16)}`);
        rows.push({
          account_id: accId,
          direction: (t.TRANTYPE === "C" || t.trantype === "C") ? "in" : "out",
          amount_uah: Math.abs(parseFloat(t.SUM || t.sum || "0")),
          occurred_at: toISO(t.DAT_OD || t.dat_od),
          description: t.OSND || t.osnd || null,
          counterparty: t.AUT_CNTR_NAM || t.aut_cntr_nam || null,
          source: "privatbank",
          external_id: ext,
          raw: t,
          created_by: "kasa-sync-privat",
        });
      }
      if (rows.length) {
        const { error } = await sb.from("kasa_transactions")
          .upsert(rows, { onConflict: "source,external_id", ignoreDuplicates: true });
        if (error) throw error;
        inserted += rows.length;
      }
      followId = page.exist_next_page ? page.next_page_id : undefined;
      guard++;
    } while (followId && guard < 100);
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), scanned, inserted }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true, window: `${startDate}..${endDate}`, scanned, upserted: inserted }, null, 2), { headers: { "Content-Type": "application/json" } });
});
