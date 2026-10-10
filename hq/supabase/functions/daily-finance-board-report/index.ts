// daily-finance-board-report v3 (10.10.2026)
// - executors are data-driven (any utm_term with a meaningful share is shown), labels from EXECUTOR_LABELS
// - fail-closed auth: x-cron-secret must equal app_secrets.hq_cron_secret
// - dry_run mode (returns text, sends nothing)
// - sane deltas, HTML escaping, TG 4096 chunking, honest ok=false when TG send fails
// v3.1 (10.10.2026, audit B9): code moved into git (was deployed manually only); constant-time secret compare.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_TOKEN = Deno.env.get("TG_BOT_TOKEN")!;
const BOARD_CHAT_ID = -1003883456849;

// Label per utm_term. Unknown utm_term values are shown as-is, so a new executor appears without a deploy.
const EXECUTOR_LABELS: Record<string, string> = {
  "claude_vadym": "Claude + Vadym (Meta, DreamCar.ua UAH)",
  "vadym": "Vadym (Meta, стара мітка)",
  "fortunatos": "Fortunatos (Meta, CLUB UAH)",
  "vira": "Vira (ретеншн)",
  "artem": "Artem",
  "volodka": "Volodka",
  "iнший": "Без мітки utm_term",
};
const EMPTY_KEY = "iнший"; // as returned by dashboard_executors_stats for empty utm_term
const MIN_SHARE = 0.01; // executors below 1% of revenue and without spend are folded into "Решта"
const MIN_BASE_FOR_PCT = 1000; // do not print % deltas against a tiny or negative base

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

type Ex = { revenue: number; leads: number; paid: number; ad_spend: number };

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
function deltaSimple(curr: number, prev: number): string {
  if (!isFinite(prev) || prev <= 0) return curr > 0 ? "NEW" : "—";
  if (prev < MIN_BASE_FOR_PCT) return "";
  const pct = ((curr - prev) / prev) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}
function kyivYesterday(): string {
  const kyivStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = new Date(kyivStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function dayBefore(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function fmtDateUA(iso: string): string {
  const [y, m, d] = String(iso).split("-");
  return `${d}.${m}.${y}`;
}

function splitForTG(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let buf = "";
  for (const line of text.split("\n")) {
    if (buf.length + line.length + 1 > max) { parts.push(buf); buf = ""; }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf) parts.push(buf);
  return parts;
}

async function sendTG(chatId: number, text: string): Promise<{ ok: boolean; err?: string; parts: number }> {
  const parts = splitForTG(text);
  for (const part of parts) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: "HTML", disable_web_page_preview: true }),
      });
      const j = await r.json();
      if (!j.ok) return { ok: false, err: j.description, parts: parts.length };
    } catch (e: any) { return { ok: false, err: String(e?.message || e), parts: parts.length }; }
  }
  return { ok: true, parts: parts.length };
}

function toMap(rows: any[]): Record<string, Ex> {
  const m: Record<string, Ex> = {};
  for (const row of (rows || [])) {
    const k = String(row.executor || EMPTY_KEY).toLowerCase();
    if (!m[k]) m[k] = { revenue: 0, leads: 0, paid: 0, ad_spend: 0 };
    m[k].revenue += Number(row.revenue || 0);
    m[k].leads += Number(row.leads || 0);
    m[k].paid += Number(row.paid || 0);
    m[k].ad_spend += Number(row.ad_spend || 0);
  }
  return m;
}
function labelFor(key: string): string {
  return EXECUTOR_LABELS[key] ?? key;
}

// Lines for one period. prev = previous-day map (optional). pnlSpend = ad spend from P&L, to expose unattributed spend.
function renderExecutors(curr: Record<string, Ex>, prev: Record<string, Ex> | null, pnlSpend: number | null, withShare: boolean): string[] {
  const out: string[] = [];
  const keys = Object.keys(curr).sort((a, b) => curr[b].revenue - curr[a].revenue);
  const totalRev = keys.reduce((s, k) => s + curr[k].revenue, 0);
  const rest: Ex = { revenue: 0, leads: 0, paid: 0, ad_spend: 0 };
  let restN = 0;
  for (const k of keys) {
    const c = curr[k];
    const share = totalRev > 0 ? c.revenue / totalRev : 0;
    if (share < MIN_SHARE && c.ad_spend <= 0) {
      rest.revenue += c.revenue; rest.paid += c.paid; restN++;
      continue;
    }
    const spend = c.ad_spend > 0 ? ` · spend ${fmtUAH(c.ad_spend)} · ROAS ${(c.revenue / c.ad_spend).toFixed(2)}` : "";
    const sharePart = withShare ? ` (${(share * 100).toFixed(0)}%)` : "";
    let deltaPart = "";
    if (prev) { const d = deltaSimple(c.revenue, prev[k]?.revenue || 0); if (d) deltaPart = ` <i>${d}</i>`; }
    out.push(`• <b>${esc(labelFor(k))}</b>: ${fmtUAH(c.revenue)}${sharePart} · ${c.paid} оплат${deltaPart}${spend}`);
  }
  if (restN > 0) out.push(`• Решта (${restN}): ${fmtUAH(rest.revenue)} · ${rest.paid} оплат`);
  if (pnlSpend != null) {
    const attributed = keys.reduce((s, k) => s + curr[k].ad_spend, 0);
    const gap = Number(pnlSpend) - attributed;
    if (Math.abs(gap) >= 1) out.push(`• <i>Spend без виконавця: ${fmtUAH(gap)}</i>`);
  }
  if (out.length === 0) out.push("• оплат немає");
  return out;
}

function buildReport(data: any, projects: any[], execY: Record<string, Ex>, execP: Record<string, Ex>, execLT: Record<string, Record<string, Ex>>, dateStr: string): string {
  const pnl = data.pnl || {};
  const prev = data.pnl_prev || {};
  const mtd = data.mtd || {};
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
  if (Number(pnl.variable_costs || 0) > 0) lines.push(`• Variable: ${fmtUAH(pnl.variable_costs)}`);
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

  lines.push(`👥 <b>Виконавці за utm_term (вчора vs ${fmtDateUA(data.prev_date)}):</b>`);
  lines.push(...renderExecutors(execY, execP, pnl.ad_spend ?? null, false));
  lines.push("");

  if (mtd.revenue != null) {
    const avgPerDay = mtd.days > 0 ? Number(mtd.net_profit) / mtd.days : 0;
    lines.push(`📅 <b>MTD (${mtd.days} дн.):</b>`);
    lines.push(`• Revenue: <b>${fmtUAH(mtd.revenue)}</b>`);
    lines.push(`• Net Profit: <b>${fmtUAH(mtd.net_profit)}</b>`);
    lines.push(`• Avg/день: ${fmtUAH(avgPerDay)}`);
    lines.push("");
  }

  if (projects && projects.length > 0) {
    lines.push(`🏎 <b>Активні проєкти (від старту):</b>`);
    for (const p of projects) {
      lines.push("");
      const netEm = Number(p.net_profit || 0) >= 0 ? "🟢" : "🔴";
      const dtf = p.days_to_finish != null ? `· до фіналу: <b>${p.days_to_finish}</b> дн.` : "";
      lines.push(`<b>${esc(p.name)}</b>`);
      lines.push(`<i>Старт ${fmtDateUA(p.starts_on)}${p.ends_on ? ` → фінал ${fmtDateUA(p.ends_on)}` : ""} · ${p.days_active} дн. ${dtf}</i>`);
      lines.push(`• Revenue: <b>${fmtUAH(p.revenue)}</b>`);
      lines.push(`• Ad Spend: ${fmtUAH(p.ad_spend)}`);
      lines.push(`• % з угод: ${fmtUAH(p.percent_costs)}`);
      lines.push(`• Fixed: ${fmtUAH(p.fixed_costs)}`);
      lines.push(`• Призовий: ${fmtUAH(p.prize_cost)} <i>(з ${fmtUAH(p.prize_full)})</i>`);
      if (Number(p.variable_costs || 0) > 0) lines.push(`• Variable: ${fmtUAH(p.variable_costs)}`);
      lines.push(`• Total Cost: ${fmtUAH(p.total_cost)}`);
      lines.push(`• ${netEm} <b>Net Profit: ${fmtUAH(p.net_profit)}</b> · margin ${fmtPct(p.margin_pct)}`);
      const lt = execLT[p.code ?? p.starts_on];
      if (lt) {
        lines.push(`<i>👥 Виконавці за весь проєкт:</i>`);
        lines.push(...renderExecutors(lt, null, p.ad_spend ?? null, true));
      }
    }
    if (projects.length > 1) {
      lines.push("");
      lines.push(`<i>⚠️ Активних проєктів кілька: цифри кожного рахуються за датами, а не за проєктом, тому перетинаються.</i>`);
    }
    lines.push("");
  }

  lines.push(`<a href="https://dashboard.dreamcar.ua/finance/">/finance/</a>`);
  return lines.join("\n");
}

// Constant-time compare: SHA-256 of both strings, XOR over all bytes.
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
    const prevDate = dayBefore(reportDate);

    const { data: pnlData, error: pnlErr } = await sb.rpc("dashboard_daily_finance_report", { p_date: reportDate });
    if (pnlErr) { console.error("P&L RPC error", pnlErr); return json({ ok: false, error: pnlErr.message }, 500); }

    const { data: projData, error: projErr } = await sb.rpc("dashboard_active_projects_lifetime", { p_to: reportDate });
    if (projErr) console.error("projects RPC error", projErr);
    const projects = projData?.projects || [];

    const [y, p] = await Promise.all([
      sb.rpc("dashboard_executors_stats", { p_from: reportDate, p_to: reportDate }),
      sb.rpc("dashboard_executors_stats", { p_from: prevDate, p_to: prevDate }),
    ]);
    if (y.error) { console.error("executors RPC error", y.error); return json({ ok: false, error: y.error.message }, 500); }
    const execY = toMap(y.data || []);
    const execP = toMap(p.data || []);

    const execLT: Record<string, Record<string, Ex>> = {};
    for (const pr of projects) {
      const { data: r } = await sb.rpc("dashboard_executors_stats", { p_from: pr.starts_on, p_to: reportDate });
      execLT[pr.code ?? pr.starts_on] = toMap(r || []);
    }

    const text = buildReport(pnlData, projects, execY, execP, execLT, reportDate);

    if (dryRun) return json({ ok: true, dry_run: true, date: reportDate, text_length: text.length, text });

    const result = await sendTG(BOARD_CHAT_ID, text);
    return json({ ok: result.ok, date: reportDate, sent: result, projects_count: projects.length, text_length: text.length }, result.ok ? 200 : 502);
  } catch (e: any) {
    console.error("Fatal", e);
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});
