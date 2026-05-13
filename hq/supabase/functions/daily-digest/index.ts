// =====================================================================
// DreamCar HQ — Daily Digest Edge Function
// =====================================================================
// Викликається через cron (pg_cron або Supabase Cron) щодня о 09:00 Kyiv.
// Шле в TG-групу зведення:
//   • публікації сьогодні (по платформах + час)
//   • що чекає погодження (queue per approver)
//   • дедлайни сьогодні (з матеріалів)
//   • що "горить" (urgent / missed)
//
// Викликається БЕЗ webhook payload — просто HTTP POST.
// Для безпеки перевіряється header x-hq-cron-secret.
//
// Конфіг (Edge Functions → Manage secrets):
//   TG_BOT_TOKEN
//   TG_GROUP_CHAT_ID
//   HQ_CRON_SECRET            (окремий від webhook secret)
//   SUPABASE_URL              (auto)
//   SUPABASE_SERVICE_ROLE_KEY (auto)
//
// Тест:
//   curl -X POST <function-url> -H "x-hq-cron-secret: <secret>"
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN     = Deno.env.get("TG_BOT_TOKEN")     ?? "";
const TG_GROUP_CHAT_ID = Deno.env.get("TG_GROUP_CHAT_ID") ?? "";
const HQ_CRON_SECRET   = Deno.env.get("HQ_CRON_SECRET")   ?? "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")     ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PLATFORM_NAMES: Record<string, string> = {
  ig: "Instagram", tg: "Telegram", tt: "TikTok",
  yt: "YT Shorts", fb: "Facebook", th: "Threads",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Чернетка", in_work: "В роботі", review: "На погодженні",
  approved: "Погоджено", published: "Опубліковано", rework: "Доопрацювання",
};

interface PubRow {
  id: string;
  title: string;
  status: string;
  publish_at: string;
  deadline_on: string | null;
  platform_schedule: Record<string, string> | null;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function todayBoundsKyiv(): { startIso: string; endIso: string; dateLabel: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(now);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  const startIso = `${y}-${m}-${d}T00:00:00+02:00`;
  const endIso   = `${y}-${m}-${d}T23:59:59+03:00`;
  return { startIso, endIso, dateLabel: `${d}.${m}.${y}` };
}

async function tgSend(chatId: string | number, text: string): Promise<void> {
  if (!TG_BOT_TOKEN) { console.warn("TG_BOT_TOKEN missing"); return; }
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) console.error(`TG send fail ${r.status}: ${await r.text()}`);
}

async function buildDigest(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { startIso, endIso, dateLabel } = todayBoundsKyiv();

  const { data: todayPubs } = await supabase
    .from("publications")
    .select("id, title, status, publish_at, deadline_on, platform_schedule")
    .gte("publish_at", startIso).lte("publish_at", endIso)
    .is("deleted_at", null).order("publish_at", { ascending: true });

  const ids = (todayPubs ?? []).map(p => p.id);
  const platformsByPub: Record<string, string[]> = {};
  if (ids.length > 0) {
    const { data: pp } = await supabase
      .from("publication_platforms").select("publication_id, platform").in("publication_id", ids);
    (pp ?? []).forEach(r => { (platformsByPub[r.publication_id] ||= []).push(r.platform); });
  }

  const { data: pendingReview } = await supabase
    .from("publications").select("id, title, publish_at")
    .eq("status", "review").is("deleted_at", null);

  const nowIso = new Date().toISOString();
  const inTwoDaysIso = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
  const { data: urgent } = await supabase
    .from("publications").select("id, title, publish_at, status")
    .gte("publish_at", nowIso).lte("publish_at", inTwoDaysIso)
    .not("status", "in", "(approved,published)").is("deleted_at", null)
    .order("publish_at", { ascending: true });

  const { data: missed } = await supabase
    .from("publications").select("id, title, publish_at, status")
    .lt("publish_at", nowIso)
    .not("status", "in", "(published)").is("deleted_at", null)
    .order("publish_at", { ascending: false }).limit(10);

  const todayDate = startIso.slice(0, 10);
  const { data: deadlines } = await supabase
    .from("publications").select("id, title, deadline_on, status")
    .eq("deadline_on", todayDate)
    .not("status", "in", "(approved,published)").is("deleted_at", null);

  const lines: string[] = [];
  lines.push(`📅 <b>Daily digest · ${dateLabel}</b>`); lines.push("");

  if (todayPubs && todayPubs.length > 0) {
    lines.push(`📤 <b>Публікації сьогодні (${todayPubs.length})</b>`);
    for (const p of todayPubs as unknown as PubRow[]) {
      const plats = (platformsByPub[p.id] || []).map(x => PLATFORM_NAMES[x] || x).join(", ") || "—";
      const status = STATUS_LABELS[p.status] || p.status;
      const time = fmtTime(p.publish_at);
      lines.push(`• ${time} — «${escHtml(p.title)}» · ${escHtml(plats)} · ${escHtml(status)}`);
    }
    lines.push("");
  }

  if (deadlines && deadlines.length > 0) {
    lines.push(`⏳ <b>Дедлайни матеріалу сьогодні (${deadlines.length})</b>`);
    for (const p of deadlines) {
      lines.push(`• «${escHtml(p.title as string)}» · ${escHtml(STATUS_LABELS[p.status as string] || p.status as string)}`);
    }
    lines.push("");
  }

  if (pendingReview && pendingReview.length > 0) {
    lines.push(`✅ <b>Чекає погодження (${pendingReview.length})</b>`);
    for (const p of pendingReview.slice(0, 8)) {
      lines.push(`• «${escHtml(p.title as string)}» · ${fmtTime(p.publish_at as string)}`);
    }
    if (pendingReview.length > 8) lines.push(`<i>... і ще ${pendingReview.length - 8}</i>`);
    lines.push("");
  }

  if (urgent && urgent.length > 0) {
    lines.push(`🔥 <b>Горить (≤48 год, не погоджено) — ${urgent.length}</b>`);
    for (const p of urgent.slice(0, 5)) {
      lines.push(`• «${escHtml(p.title as string)}» · ${fmtTime(p.publish_at as string)} · ${escHtml(STATUS_LABELS[p.status as string] || p.status as string)}`);
    }
    lines.push("");
  }

  if (missed && missed.length > 0) {
    lines.push(`⚠️ <b>Пропущено (опублікувати/відкласти) — ${missed.length}</b>`);
    for (const p of missed.slice(0, 5)) {
      lines.push(`• «${escHtml(p.title as string)}» · ${escHtml(STATUS_LABELS[p.status as string] || p.status as string)}`);
    }
    if (missed.length > 5) lines.push(`<i>... і ще ${missed.length - 5}</i>`);
    lines.push("");
  }

  if ((!todayPubs || todayPubs.length === 0) && (!pendingReview || pendingReview.length === 0) &&
      (!urgent || urgent.length === 0) && (!missed || missed.length === 0) && (!deadlines || deadlines.length === 0)) {
    lines.push("🌿 Сьогодні все тихо. Гарного дня!");
  }

  lines.push(""); lines.push(`🔗 <a href="https://dreamcarua.github.io/dreamcar-team/hq/">Відкрити HQ</a>`);
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST" && req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  if (HQ_CRON_SECRET) {
    const headerSecret = req.headers.get("x-hq-cron-secret");
    const urlSecret = new URL(req.url).searchParams.get("secret");
    if (headerSecret !== HQ_CRON_SECRET && urlSecret !== HQ_CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response("Missing service config", { status: 500 });
  if (!TG_BOT_TOKEN || !TG_GROUP_CHAT_ID) return new Response("Missing TG config", { status: 500 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  try {
    const text = await buildDigest(supabase);
    await tgSend(TG_GROUP_CHAT_ID, text);
    return new Response(JSON.stringify({ ok: true, sentChars: text.length }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("digest error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
