// =====================================================================
// DreamCar HQ — Daily Personal Digest
// =====================================================================
// Викликається через pg_cron щодня о 06:00 UTC (≈09:00 Kyiv).
// Для кожного юзера з прив'язаним tg_chat_id — шле особисте зведення:
//   • сьогоднішні публікації загалом (підсумок)
//   • моя черга погоджень (для approvers)
//   • мої активні (для responsibles)
//   • пропущені — загалом
//
// Авторизація: x-hq-cron-secret (той же що для daily-digest)
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN     = Deno.env.get("TG_BOT_TOKEN")     ?? "";
const HQ_CRON_SECRET   = Deno.env.get("HQ_CRON_SECRET")   ?? "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")     ?? Deno.env.get("HQ_DB_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";

const HQ_URL = "https://dreamcarua.github.io/dreamcar-team/hq/";

const STATUS_EMOJI: Record<string, string> = {
  draft: "📝", in_work: "⚙️", review: "👀",
  approved: "✅", published: "🚀", rework: "↩️",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Чернетка", in_work: "В роботі", review: "На погодженні",
  approved: "Погоджено", published: "Опубліковано", rework: "Доопрацювання",
};

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tgSend(chatId: number | string, text: string): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
      }),
    });
    if (!r.ok) console.error("tgSend fail", r.status, await r.text());
  } catch (e) { console.error("tgSend threw", e); }
}

function todayBoundsKyiv() {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return {
    startIso: `${y}-${m}-${d}T00:00:00+02:00`,
    endIso:   `${y}-${m}-${d}T23:59:59+03:00`,
    dateLabel: `${d}.${m}.${y}`,
  };
}

interface UserRow {
  id: string; name: string | null; email: string | null; role: string | null;
  tg_chat_id: number | string | null;
}
interface PubRow {
  id: string; title: string; status: string; publish_at: string;
  deadline_on: string | null;
}

async function buildPersonalDigest(supabase: ReturnType<typeof createClient>, user: UserRow): Promise<string | null> {
  const { startIso, endIso, dateLabel } = todayBoundsKyiv();
  const nowIso = new Date().toISOString();

  // Сьогоднішні (всі)
  const { data: todayPubs } = await supabase
    .from("publications")
    .select("id, title, status, publish_at, deadline_on")
    .gte("publish_at", startIso).lte("publish_at", endIso)
    .is("deleted_at", null)
    .order("publish_at", { ascending: true });

  // Платформи
  const todayIds = (todayPubs ?? []).map(p => p.id);
  const platformsByPub: Record<string, string[]> = {};
  if (todayIds.length > 0) {
    const { data: pp } = await supabase
      .from("publication_platforms").select("publication_id, platform").in("publication_id", todayIds);
    (pp ?? []).forEach(r => { (platformsByPub[r.publication_id] ||= []).push(r.platform); });
  }

  // Моя черга погоджень
  const { data: apprList } = await supabase
    .from("publication_approvers")
    .select("publication_id, publications!inner(id, title, status, publish_at, deleted_at)")
    .eq("user_id", user.id);
  const queue = (apprList ?? [])
    // @ts-ignore — join shape
    .map(r => r.publications as PubRow & { deleted_at?: string | null })
    .filter(p => p && p.status === "review" && !(p as { deleted_at?: string | null }).deleted_at);

  // Мої активні (responsible, не published)
  const { data: respList } = await supabase
    .from("publication_responsibles")
    .select("publication_id, publications!inner(id, title, status, publish_at, deleted_at)")
    .eq("user_id", user.id);
  const myActive = (respList ?? [])
    // @ts-ignore
    .map(r => r.publications as PubRow & { deleted_at?: string | null })
    .filter(p => p && !(p as { deleted_at?: string | null }).deleted_at && p.status !== "published");

  // Пропущені загальні
  const { count: missedCount } = await supabase
    .from("publications").select("id", { count: "exact", head: true })
    .lt("publish_at", nowIso).not("status", "in", "(published)").is("deleted_at", null);

  // Якщо нічого цікавого — повідомлення не шлемо
  const interesting = (todayPubs && todayPubs.length > 0) || queue.length > 0 || myActive.length > 0 || (missedCount ?? 0) > 0;
  if (!interesting) return null;

  const lines: string[] = [];
  lines.push(`☀️ <b>Ранковий дайджест · ${dateLabel}</b>`);
  lines.push(`<b>${escHtml(user.name || "")}</b> · ${escHtml(user.role || "")}\n`);

  // #330 HARD RULE: Europe/Kyiv для всіх timestamp у нотифікаціях
  const kyivT = (iso: string) => new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(iso));
  const kyivDT = (iso: string) => new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(iso)).replace(",", "");

  // Сьогодні
  if (todayPubs && todayPubs.length > 0) {
    lines.push(`📅 <b>Сьогодні (${todayPubs.length})</b>`);
    for (const p of todayPubs.slice(0, 6)) {
      const t = kyivT(p.publish_at);
      const plats = (platformsByPub[p.id] || []).join("/") || "—";
      lines.push(`${STATUS_EMOJI[p.status] || "•"} <code>${t}</code> · ${escHtml(p.title)} · ${plats}`);
    }
    if (todayPubs.length > 6) lines.push(`<i>... і ще ${todayPubs.length - 6}</i>`);
    lines.push("");
  }

  // Черга
  if (queue.length > 0) {
    lines.push(`✅ <b>Чекає твого погодження (${queue.length})</b>`);
    for (const p of queue.slice(0, 5)) {
      lines.push(`👀 <code>${kyivDT(p.publish_at)}</code> · ${escHtml(p.title)}`);
    }
    if (queue.length > 5) lines.push(`<i>... ще ${queue.length - 5}</i>`);
    lines.push(`<i>Тисни /queue або /approve для швидкого погодження</i>\n`);
  }

  // Мої активні
  if (myActive.length > 0) {
    lines.push(`📋 <b>Твої активні (${myActive.length})</b>`);
    for (const p of myActive.slice(0, 5)) {
      lines.push(`${STATUS_EMOJI[p.status] || "•"} <code>${kyivDT(p.publish_at)}</code> · ${escHtml(p.title)} · ${STATUS_LABEL[p.status]}`);
    }
    if (myActive.length > 5) lines.push(`<i>... /my для повного списку</i>`);
    lines.push("");
  }

  // Пропущені
  if (missedCount && missedCount > 0) {
    lines.push(`⚠️ Пропущених загалом: <b>${missedCount}</b> → /late`);
    lines.push("");
  }

  lines.push(`🔗 <a href="${HQ_URL}">Відкрити HQ</a>`);
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST" && req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  // cron secret
  if (HQ_CRON_SECRET) {
    const got = req.headers.get("x-hq-cron-secret");
    const urlSec = new URL(req.url).searchParams.get("secret");
    if (got !== HQ_CRON_SECRET && urlSec !== HQ_CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response("Missing config", { status: 500 });
  if (!TG_BOT_TOKEN) return new Response("TG_BOT_TOKEN missing", { status: 500 });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Всі прив'язані юзери
  const { data: users, error } = await supabase
    .from("users").select("id, name, email, role, tg_chat_id")
    .not("tg_chat_id", "is", null);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  let sent = 0, skipped = 0;
  for (const u of (users ?? []) as UserRow[]) {
    if (!u.tg_chat_id) { skipped++; continue; }
    try {
      const text = await buildPersonalDigest(supabase, u);
      if (!text) { skipped++; continue; }
      await tgSend(u.tg_chat_id, text);
      sent++;
      // Throttle: 25 повідомлень/сек у TG. Спимо 100мс між.
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      console.error("personal digest for", u.id, "failed:", e);
      skipped++;
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, skipped }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
