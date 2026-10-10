// daily-finance-report v2 (10.10.2026) — щоденний фінансовий звіт у TG (09:30 Kyiv)
// Шле DM Vadym (1138351072) + Артем CFO (422100819)
// Тригер: pg_cron 1520. v2: fail-closed auth (x-cron-secret = app_secrets.hq_cron_secret), dry_run, чесний ok.
// v2.1 (10.10.2026, аудит B9): код перенесено в git (раніше лише ручний деплой); порівняння секрету в сталий час.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_TOKEN = Deno.env.get("TG_BOT_TOKEN")!;

const VADYM_CHAT_ID = 1138351072;
const ARTEM_CHAT_ID = 422100819;
const MIN_BASE_FOR_PCT = 1000;

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

function esc(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtUAH(v: number | null | undefined): string {
  if (v == null || isNaN(Number(v))) return "—";
  return new Intl.NumberFormat("uk-UA").format(Math.round(Number(v))) + " ₴";
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || isNaN(Number(v))) return "—";
  return Number(v).toFixed(digits) + "%";
}

function deltaArrow(curr: number, prev: number): string {
  const diff = curr - prev;
  const sign = diff >= 0 ? "↑" : "↓";
  const abs = `${sign} ${fmtUAH(Math.abs(diff))}`;
  if (!isFinite(prev) || prev < MIN_BASE_FOR_PCT) return abs;
  const pct = (diff / prev) * 100;
  return `${abs} (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)`;
}

function kyivYesterday(): string {
  const now = new Date();
  const kyivStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
  const d = new Date(kyivStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function fmtDateUA(iso: string): string {
  const [y, m, d] = String(iso).split("-");
  return `${d}.${m}.${y}`;
}

async function sendTG(chatId: number, text: string): Promise<{ ok: boolean; err?: string }> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const j = await r.json();
    if (!j.ok) return { ok: false, err: j.description };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, err: String(e?.message || e) };
  }
}

function buildReport(data: any, dateStr: string): string {
  const pnl = data.pnl || {};
  const prev = data.pnl_prev || {};
  const mtd = data.mtd || {};
  const kasa = data.kasa_day || {};
  const bal = data.kasa_balances || {};
  const balances = (bal.accounts || []).filter((a: any) => Number(a.balance || 0) > 0);

  const lines: string[] = [];
  lines.push(`💰 <b>Фінансовий звіт за ${fmtDateUA(dateStr)}</b>`);
  lines.push("");

  if (pnl.revenue == null) {
    lines.push(`⚠️ <b>Немає даних P&amp;L за цей день</b> (mv_finance_daily_pnl порожній). Цифри нижче неповні.`);
    lines.push("");
  }

  lines.push(`📊 <b>P&amp;L (вчора):</b>`);
  lines.push(`• Revenue: <b>${fmtUAH(pnl.revenue)}</b>`);
  lines.push(`• Ad Spend: ${fmtUAH(pnl.ad_spend)}`);
  lines.push(`• % з угод: ${fmtUAH(pnl.percent_costs)}`);
  lines.push(`• Fixed: ${fmtUAH(pnl.fixed_costs)}`);
  lines.push(`• Призовий: ${fmtUAH(pnl.prize_cost)}`);
  if (Number(pnl.variable_costs || 0) > 0) {
    lines.push(`• Variable: ${fmtUAH(pnl.variable_costs)}`);
  }
  lines.push(`• ──────`);
  lines.push(`• Total Cost: ${fmtUAH(pnl.total_cost)}`);
  const netEmoji = Number(pnl.net_profit || 0) >= 0 ? "🟢" : "🔴";
  lines.push(`• ${netEmoji} <b>Net Profit: ${fmtUAH(pnl.net_profit)}</b> · margin ${fmtPct(pnl.margin_pct)}`);
  lines.push(`• Активних проектів: ${pnl.active_projects || 0}`);
  lines.push("");

  if (prev.revenue != null) {
    lines.push(`📈 <b>vs ${fmtDateUA(data.prev_date)}:</b>`);
    lines.push(`• Revenue Δ: ${deltaArrow(Number(pnl.revenue || 0), Number(prev.revenue || 0))}`);
    lines.push(`• Net Profit Δ: ${deltaArrow(Number(pnl.net_profit || 0), Number(prev.net_profit || 0))}`);
    lines.push("");
  }

  if (mtd.revenue != null) {
    const avgPerDay = mtd.days > 0 ? Number(mtd.net_profit) / mtd.days : 0;
    lines.push(`📅 <b>MTD (${mtd.days} дн.):</b>`);
    lines.push(`• Revenue: <b>${fmtUAH(mtd.revenue)}</b>`);
    lines.push(`• Net Profit: <b>${fmtUAH(mtd.net_profit)}</b>`);
    lines.push(`• Avg/день: ${fmtUAH(avgPerDay)}`);
    lines.push("");
  }

  const dayDelta = Number(kasa.incoming || 0) - Number(kasa.outgoing || 0);
  const dayEmoji = dayDelta >= 0 ? "🟢" : "🔴";
  lines.push(`🏦 <b>Каса вчора:</b>`);
  lines.push(`• Надходжень: ${kasa.in_count || 0} шт. = <b>${fmtUAH(kasa.incoming)}</b>`);
  lines.push(`• Витрат: ${kasa.out_count || 0} шт. = ${fmtUAH(kasa.outgoing)}`);
  lines.push(`• ${dayEmoji} Δ день: ${fmtUAH(dayDelta)}`);
  lines.push("");

  lines.push(`💼 <b>Баланси рахунків (Σ ${fmtUAH(bal.total)}):</b>`);
  for (const acc of balances) {
    lines.push(`• ${esc(acc.name)}: <b>${fmtUAH(acc.balance)}</b>`);
  }
  lines.push("");

  lines.push(`<a href="https://dashboard.dreamcar.ua/finance/">/finance/</a> · <a href="https://dashboard.dreamcar.ua/kasa/">/kasa/</a>`);
  return lines.join("\n");
}

// Порівняння в сталий час: SHA-256 обох рядків і XOR по всіх байтах.
async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < ua.length; i++) d |= ua[i] ^ ub[i];
  return d === 0;
}

async function authorized(req: Request): Promise<boolean> {
  const h = req.headers.get("x-cron-secret") || req.headers.get("x-hq-cron-secret");
  if (!h || h.length < 32) return false;
  const { data, error } = await sb.from("app_secrets").select("value").eq("key", "hq_cron_secret").maybeSingle();
  if (error || !data?.value) return false; // fail closed
  return await safeEqual(h, data.value);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req) => {
  try {
    if (!(await authorized(req))) return json({ ok: false, error: "unauthorized" }, 401);

    const url = new URL(req.url);
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const dryRun = url.searchParams.get("dry_run") === "1" || body.dry_run === true;
    const reportDate = url.searchParams.get("date") || body.date || kyivYesterday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return json({ ok: false, error: "bad date" }, 400);

    const { data, error } = await sb.rpc("dashboard_daily_finance_report", { p_date: reportDate });
    if (error) {
      console.error("RPC error", error);
      return json({ ok: false, error: error.message }, 500);
    }

    const text = buildReport(data, reportDate);
    if (dryRun) return json({ ok: true, dry_run: true, date: reportDate, text_length: text.length });

    const results = await Promise.all([
      sendTG(VADYM_CHAT_ID, text),
      sendTG(ARTEM_CHAT_ID, text),
    ]);
    const ok = results[0].ok && results[1].ok;

    return json({
      ok,
      date: reportDate,
      sent: { vadym: results[0], artem: results[1] },
      text_length: text.length,
    }, ok ? 200 : 502);
  } catch (e: any) {
    console.error("Fatal", e);
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});
