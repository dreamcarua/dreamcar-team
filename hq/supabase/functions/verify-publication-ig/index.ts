// =====================================================================
// DreamCar HQ — Verify Publication via Instagram Graph API
// Викликається cron щохвилини для pubs з publish_at + 3 хв = NOW
// Перевіряє чи з'явилось media у @dreamcar.ua і:
//   - якщо ТАК → status='published', verified_status='ok', notify ✅ ВСІМ stakeholders
//   - якщо НІ  → verified_status='missed', АЛЯРМ 🚨 ВСІМ + group chat з кнопками
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN       = Deno.env.get("TG_BOT_TOKEN") ?? "";
const TG_GROUP_CHAT_ID   = Deno.env.get("DCSMM_GROUP_CHAT_ID") || "-1003933841573";
const SUPABASE_URL       = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_CRON_SECRET     = Deno.env.get("HQ_CRON_SECRET") ?? "";

// IG credentials (потрібно встановити у Supabase secrets)
const IG_BUSINESS_ACCOUNT_ID = Deno.env.get("IG_BUSINESS_ACCOUNT_ID") ?? "";
const IG_PAGE_ACCESS_TOKEN   = Deno.env.get("IG_PAGE_ACCESS_TOKEN") ?? "";

const HQ_BASE = "https://dreamcarua.github.io/dreamcar-team/hq/";

interface IGMedia {
  id: string;
  caption?: string;
  permalink: string;
  timestamp: string; // ISO
  media_type: string; // IMAGE / VIDEO / CAROUSEL_ALBUM
}

interface UserRow {
  id: string; name: string; tg_chat_id: number | null;
}

// ----- Helpers -----
function escHtml(s: string): string { return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

async function tgSend(chatId: number|string, text: string, opts: any = {}) {
  if (!TG_BOT_TOKEN) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode:"HTML", disable_web_page_preview: false, ...opts }),
    });
    if (!r.ok) console.error("tgSend fail", r.status, await r.text());
  } catch (e) { console.error("tgSend threw", e); }
}

async function getStakeholders(sb: any, pubId: string, createdBy: string|null): Promise<UserRow[]> {
  const userIds = new Set<string>();
  if (createdBy) userIds.add(createdBy);

  const { data: appr } = await sb.from("publication_approvers").select("user_id").eq("publication_id", pubId);
  (appr ?? []).forEach((r: any) => userIds.add(r.user_id));

  const { data: resp } = await sb.from("publication_responsibles").select("user_id").eq("publication_id", pubId);
  (resp ?? []).forEach((r: any) => userIds.add(r.user_id));

  if (!userIds.size) return [];
  const { data: users } = await sb.from("users")
    .select("id, name, tg_chat_id")
    .in("id", Array.from(userIds))
    .not("tg_chat_id", "is", null);
  return (users ?? []) as UserRow[];
}

// ----- IG Graph API -----
async function fetchIGRecentMedia(): Promise<IGMedia[]> {
  if (!IG_BUSINESS_ACCOUNT_ID || !IG_PAGE_ACCESS_TOKEN) {
    throw new Error("MISSING_IG_CREDENTIALS — set IG_BUSINESS_ACCOUNT_ID + IG_PAGE_ACCESS_TOKEN у Supabase secrets");
  }
  const url = `https://graph.facebook.com/v18.0/${IG_BUSINESS_ACCOUNT_ID}/media?fields=id,caption,permalink,timestamp,media_type&limit=25&access_token=${IG_PAGE_ACCESS_TOKEN}`;
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`IG API ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  return (j.data ?? []) as IGMedia[];
}

// Match: media timestamp у вікні [publish_at - 30min, publish_at + 30min]
// Якщо є caption text — порівнюємо substring (нижній регістр, перші 40 символів)
function findMatchingMedia(media: IGMedia[], publishAt: string, pubText: string|null): IGMedia | null {
  const target = new Date(publishAt).getTime();
  const winMs = 30 * 60 * 1000; // ±30 хв

  // Спочатку — фільтр по часу
  const inWindow = media.filter(m => {
    const t = new Date(m.timestamp).getTime();
    return Math.abs(t - target) <= winMs;
  });
  if (inWindow.length === 0) return null;
  if (inWindow.length === 1) return inWindow[0];

  // Якщо кілька кандидатів — порівняємо по caption substring
  if (pubText) {
    const needle = pubText.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (needle.length > 10) {
      for (const m of inWindow) {
        const cap = (m.caption || "").toLowerCase().replace(/\s+/g, " ");
        if (cap.includes(needle)) return m;
      }
    }
  }
  // Fallback — найближче по часу
  inWindow.sort((a, b) => Math.abs(new Date(a.timestamp).getTime() - target) - Math.abs(new Date(b.timestamp).getTime() - target));
  return inWindow[0];
}

// ----- Notify -----
async function notifySuccess(sb: any, pub: any, evidence: IGMedia, stakeholders: UserRow[]) {
  const text = [
    `✅ <b>SMM · Опубліковано (verified)</b>`,
    `«${escHtml(pub.title)}»`,
    `📅 ${new Date(pub.publish_at).toLocaleString("uk-UA", { timeZone: "Europe/Kiev" })}`,
    `🔗 <a href="${evidence.permalink}">Відкрити пост у Instagram</a>`,
    ``,
    `<i>✓ Автоматично знайдено у @dreamcar.ua</i>`,
  ].join("\n");

  // У group chat
  if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text);

  // Кожному stakeholder
  for (const u of stakeholders) {
    if (u.tg_chat_id) await tgSend(u.tg_chat_id, text);
  }
}

async function notifyMissed(sb: any, pub: any, stakeholders: UserRow[]) {
  const kyivTime = new Date(pub.publish_at).toLocaleString("uk-UA", { timeZone: "Europe/Kiev" });
  const text = [
    `🚨 <b>АЛЯРМ: публікація НЕ ВИЙШЛА!</b>`,
    `«${escHtml(pub.title)}»`,
    `📅 Мала вийти: ${kyivTime}`,
    `❌ У Instagram @dreamcar.ua не знайдено посту за останні 30 хв`,
    ``,
    `Хто був відповідальний — терміново перевір!`,
  ].join("\n");
  const kb = {
    inline_keyboard: [
      [
        { text: "✓ Я опублікував — перевір ще", callback_data: `vrfy:retry:${pub.id}` },
        { text: "↻ Перенести +1 год", callback_data: `vrfy:resched:${pub.id}:60` }
      ],
      [{ text: "🔗 Відкрити у SMM", url: `${HQ_BASE}#publication/${pub.id}` }],
    ]
  };

  if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text, { reply_markup: kb });

  for (const u of stakeholders) {
    if (u.tg_chat_id) await tgSend(u.tg_chat_id, text, { reply_markup: kb });
  }
}

async function notifyError(pub: any, errMsg: string) {
  const text = [
    `⚠️ <b>SMM verify ERROR</b>`,
    `«${escHtml(pub.title)}»`,
    `<i>${escHtml(errMsg)}</i>`,
    `Перевірка пропущена — потрібна manual перевірка.`,
  ].join("\n");
  if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text);
}

// Auto-cleanup: видалити cron job після виконання (one-shot pattern)
async function cleanupCronJob(sb: any, pubId: string) {
  const jobName = "verify_pub_" + pubId.replace(/-/g, "");
  try {
    await sb.rpc("safe_unschedule", { job_name: jobName });
  } catch (e) { console.warn("cleanup cron failed", e); }
}

// ----- Core handler -----
async function verifyPublication(sb: any, pubId: string) {
  const { data: pub } = await sb.from("publications").select("*").eq("id", pubId).maybeSingle();
  if (!pub) { console.warn("pub not found", pubId); await cleanupCronJob(sb, pubId); return; }
  if (pub.verified_at) { console.log("already verified", pubId); await cleanupCronJob(sb, pubId); return; }

  // Перевірити чи IG у platforms
  const { data: plats } = await sb.from("publication_platforms").select("platform").eq("publication_id", pubId);
  const platforms = (plats ?? []).map((p: any) => p.platform);
  const hasIG = platforms.includes("ig");
  if (!hasIG) {
    console.log("skip pub", pubId, "— no IG platform");
    // Mark as verified with status='skipped' щоб cron більше не перевіряв
    await sb.from("publications").update({
      verified_at: new Date().toISOString(),
      verified_status: "skipped",
    }).eq("id", pubId);
    return;
  }

  const stakeholders = await getStakeholders(sb, pubId, pub.created_by);

  try {
    const media = await fetchIGRecentMedia();
    const match = findMatchingMedia(media, pub.publish_at, pub.text_body);

    if (match) {
      // ✅ Знайшли — auto-publish
      await sb.from("publications").update({
        status: "published",
        verified_at: new Date().toISOString(),
        verified_status: "ok",
        verified_evidence_url: match.permalink,
        last_action_via: "auto-verify-ig",
      }).eq("id", pubId);

      await sb.from("publication_history").insert({
        publication_id: pubId,
        action: "auto_published_ig",
        detail: `IG media ${match.id} timestamp=${match.timestamp}`,
        actor_id: null,
      });

      await notifySuccess(sb, pub, match, stakeholders);
      console.log("VERIFIED OK", pubId, "→", match.permalink);
    } else {
      // ❌ Не знайшли — alarm
      await sb.from("publications").update({
        verified_at: new Date().toISOString(),
        verified_status: "missed",
      }).eq("id", pubId);

      await sb.from("publication_history").insert({
        publication_id: pubId,
        action: "auto_verify_missed",
        detail: `IG check at T+3min: 0 matching media у вікні ±30хв`,
        actor_id: null,
      });

      await notifyMissed(sb, pub, stakeholders);
      console.log("VERIFIED MISSED", pubId);
    }
  } catch (e: any) {
    const errMsg = String(e?.message || e);
    await sb.from("publications").update({
      verified_at: new Date().toISOString(),
      verified_status: "error",
      verify_retry_count: (pub.verify_retry_count || 0) + 1,
    }).eq("id", pubId);
    await sb.from("publication_history").insert({
      publication_id: pubId,
      action: "auto_verify_error",
      detail: errMsg.slice(0, 500),
      actor_id: null,
    });
    await notifyError(pub, errMsg);
    console.error("VERIFY ERROR", pubId, errMsg);
  }
  // Auto-cleanup cron job (one-shot pattern)
  await cleanupCronJob(sb, pubId);
}

// ----- Batch (cron) handler -----
async function batchProcessPending(sb: any) {
  // Pubs з publish_at у вікні [-4min, -3min] від NOW, ще не verified
  const now = Date.now();
  const t3 = new Date(now - 3 * 60 * 1000).toISOString();
  const t4 = new Date(now - 4 * 60 * 1000).toISOString();

  const { data: pubs } = await sb.from("publications")
    .select("id")
    .lte("publish_at", t3)
    .gte("publish_at", t4)
    .is("verified_at", null)
    .is("deleted_at", null)
    .in("status", ["approved", "review", "rework", "in_work"]);

  const ids = (pubs ?? []).map((p: any) => p.id);
  for (const id of ids) {
    await verifyPublication(sb, id);
  }
  return ids.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST" && req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  // Auth: cron secret або body { publication_id }
  if (HQ_CRON_SECRET) {
    const got = req.headers.get("x-hq-cron-secret");
    const urlSec = new URL(req.url).searchParams.get("secret");
    if (got !== HQ_CRON_SECRET && urlSec !== HQ_CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response("Missing config", { status: 500 });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  let body: any = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch {}
  }

  try {
    if (body.publication_id) {
      // One-shot для конкретної pub (manual / retry)
      await verifyPublication(sb, body.publication_id);
      return new Response(JSON.stringify({ ok: true, mode: "single", id: body.publication_id }), {
        status: 200, headers: { "Content-Type":"application/json" }
      });
    } else {
      // Batch: cron mode
      const count = await batchProcessPending(sb);
      return new Response(JSON.stringify({ ok: true, mode: "batch", processed: count }), {
        status: 200, headers: { "Content-Type":"application/json" }
      });
    }
  } catch (e: any) {
    console.error("verify-publication-ig error:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { "Content-Type":"application/json" }
    });
  }
});
