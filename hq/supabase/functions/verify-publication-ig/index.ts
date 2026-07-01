// =====================================================================
// DreamCar — Verify Publication v7 (01.07.2026)
// v7 (#554): actor_id для publication_history insert (колонка NOT NULL) —
//     було actor_id:null → insert падав → auto-verify TG «✅ Автопідтверджено»
//     не слалась + cron verify_pub_ не чистився. Тепер SYSTEM_ACTOR_ID (founder).
// v6: FB токен резолвиться з ENV АБО з app_secrets (service-role-only table),
//     бо Supabase Edge НЕ має FB_ACCESS_TOKEN у оточенні → IG-автоперевірка
//     ніколи не працювала (auto_verified_ig=0). +?diag=1 для перевірки.
// v5: СПЕРШУ IG Graph API check → auto status='published'; інакше manual question.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN     = Deno.env.get("TG_BOT_TOKEN") ?? "";
const TG_GROUP_CHAT_ID = Deno.env.get("DCSMM_GROUP_CHAT_ID") || "-1003933841573";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_CRON_SECRET   = Deno.env.get("HQ_CRON_SECRET") ?? "";

// v5: hard-coded для @dreamcar.ua
const IG_USER_ID    = "17841403783002317";
// v6: токен резолвиться пізніше (env або app_secrets)
let FB_ACCESS_TOKEN = "";
// #554: системний actor для publication_history.actor_id (NOT NULL) — будь-який founder.
// Без цього insert падав (actor_id:null) → auto-verify TG-нотифікація не слалась + cron не чистився.
let SYSTEM_ACTOR_ID: string | null = null;

async function resolveFbToken(sb: any) {
  FB_ACCESS_TOKEN = Deno.env.get("FB_ACCESS_TOKEN") ?? Deno.env.get("IG_PAGE_ACCESS_TOKEN") ?? "";
  if (FB_ACCESS_TOKEN) return;
  try {
    const { data } = await sb.from("app_secrets").select("value").eq("key", "fb_access_token").maybeSingle();
    if (data?.value) FB_ACCESS_TOKEN = data.value;
  } catch (e) { console.error("resolveFbToken failed", e); }
}

const HQ_BASE = "https://dreamcarua.github.io/dreamcar-team/hq/";

interface IGMedia { id: string; caption?: string; permalink: string; timestamp: string; media_type: string; }
interface UserRow { id: string; name: string; tg_chat_id: number | null; }

function escHtml(s: string): string { return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function fmtKyiv(iso: string): string {
  return new Intl.DateTimeFormat("uk-UA", { timeZone:"Europe/Kyiv", day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", hour12:false }).format(new Date(iso));
}

async function tgSend(chatId: number|string, text: string, opts: any = {}) {
  if (!TG_BOT_TOKEN) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ chat_id: chatId, text, parse_mode:"HTML", disable_web_page_preview:false, ...opts }),
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
  const { data: users } = await sb.from("users").select("id, name, tg_chat_id").in("id", Array.from(userIds)).not("tg_chat_id", "is", null);
  return (users ?? []) as UserRow[];
}

async function fetchIGRecentMedia(): Promise<IGMedia[]> {
  if (!FB_ACCESS_TOKEN) throw new Error("MISSING_FB_ACCESS_TOKEN");
  const url = `https://graph.facebook.com/v21.0/${IG_USER_ID}/media?fields=id,caption,permalink,timestamp,media_type&limit=25&access_token=${FB_ACCESS_TOKEN}`;
  const r = await fetch(url);
  if (!r.ok) { const t = await r.text(); throw new Error(`IG API ${r.status}: ${t.slice(0, 300)}`); }
  const j = await r.json();
  return (j.data ?? []) as IGMedia[];
}

function findMatchingMedia(media: IGMedia[], publishAt: string, pubText: string|null): IGMedia | null {
  const target = new Date(publishAt).getTime();
  const winMs = 30 * 60 * 1000;
  const inWindow = media.filter(m => Math.abs(new Date(m.timestamp).getTime() - target) <= winMs);
  if (inWindow.length === 0) return null;
  if (inWindow.length === 1) return inWindow[0];
  if (pubText) {
    const needle = pubText.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (needle.length > 10) {
      for (const m of inWindow) {
        const cap = (m.caption || "").toLowerCase().replace(/\s+/g, " ");
        if (cap.includes(needle)) return m;
      }
    }
  }
  inWindow.sort((a, b) => Math.abs(new Date(a.timestamp).getTime() - target) - Math.abs(new Date(b.timestamp).getTime() - target));
  return inWindow[0];
}

async function notifySuccess(pub: any, evidence: IGMedia, stakeholders: UserRow[]) {
  const text = [
    `✅ <b>SMM · Автопідтверджено</b>`,
    `«${escHtml(pub.title || "")}»`,
    `📅 ${fmtKyiv(pub.publish_at)}`,
    `🔗 <a href="${evidence.permalink}">Відкрити пост у Instagram</a>`,
    ``,
    `<i>✓ Знайдено у @dreamcar.ua автоматично (IG Graph API)</i>`,
  ].join("\n");
  if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text);
  for (const u of stakeholders) if (u.tg_chat_id) await tgSend(u.tg_chat_id, text);
}

async function requestManualConfirmation(pub: any, stakeholders: UserRow[], platforms: string[]) {
  const platformLabels: Record<string, string> = { ig:"📷 Instagram", tg:"✈️ Telegram", fb:"📘 Facebook", tt:"🎵 TikTok", yt:"▶️ YouTube", th:"🧵 Threads" };
  const platformsList = platforms.length ? platforms.map(p => platformLabels[p] || p).join(", ") : "(не вказано)";
  const text = [
    `🕒 <b>Час публікації!</b> <i>(IG не підтвердив, перевірте вручну)</i>`,
    `«${escHtml(pub.title || "")}»`,
    ``,
    `📅 Запланована: ${fmtKyiv(pub.publish_at)}`,
    `📲 Платформи: ${platformsList}`,
    ``,
    `<i>Хто відповідає — підтверди статус однією кнопкою.</i>`
  ].join("\n");
  const kb = { inline_keyboard: [
    [{ text:"✅ Опубліковано", callback_data:`vrfy:confirm:${pub.id}` }, { text:"❌ Не вийшло", callback_data:`vrfy:miss:${pub.id}` }],
    [{ text:"↻ Переніс +1 год", callback_data:`vrfy:resched:${pub.id}:60` }, { text:"🔗 Відкрити в SMM", url:`${HQ_BASE}#publication/${pub.id}` }]
  ]};
  if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text, { reply_markup: kb });
  for (const u of stakeholders) if (u.tg_chat_id) await tgSend(u.tg_chat_id, text, { reply_markup: kb });
}

async function cleanupCronJob(sb: any, pubId: string) {
  const jobName = "verify_pub_" + pubId.replace(/-/g, "");
  try { await sb.rpc("safe_unschedule", { job_name: jobName }); } catch {}
}

async function verifyPublication(sb: any, pubId: string, igMediaCache: IGMedia[] | null = null) {
  const { data: pub } = await sb.from("publications").select("*").eq("id", pubId).maybeSingle();
  if (!pub) { await cleanupCronJob(sb, pubId); return { result: "not_found" }; }
  if (pub.verified_at || pub.status === "published") { await cleanupCronJob(sb, pubId); return { result: "already" }; }

  const { data: plats } = await sb.from("publication_platforms").select("platform").eq("publication_id", pubId);
  const platforms = (plats ?? []).map((p: any) => p.platform);
  const stakeholders = await getStakeholders(sb, pubId, pub.created_by);

  const hasIG = platforms.length === 0 || platforms.includes("ig");
  if (hasIG && FB_ACCESS_TOKEN) {
    try {
      const media = igMediaCache ?? await fetchIGRecentMedia();
      const match = findMatchingMedia(media, pub.publish_at, pub.text_body || pub.title);
      if (match) {
        await sb.from("publications").update({
          status: "published",
          verified_at: new Date().toISOString(),
          verified_status: "ok",
          verified_evidence_url: match.permalink,
          published_at: new Date(match.timestamp).toISOString(),
        }).eq("id", pubId);
        await sb.from("publication_history").insert({
          publication_id: pubId, action: "auto_verified_ig",
          detail: `IG Graph API match: ${match.permalink} (timestamp ${match.timestamp})`, actor_id: SYSTEM_ACTOR_ID,
        });
        await notifySuccess(pub, match, stakeholders);
        await cleanupCronJob(sb, pubId);
        return { result: "auto_published", evidence: match.permalink };
      }
    } catch (e: any) {
      console.error("IG check failed for", pubId, e?.message || e);
    }
  }

  if (pub.verified_status === "requested") {
    return { result: "already_asked" };
  }

  await sb.from("publications").update({ verified_status: "requested" }).eq("id", pubId);
  await sb.from("publication_history").insert({
    publication_id: pubId, action: "verify_question_sent",
    detail: `T+3min manual question (IG check empty) → group + ${stakeholders.length} DM`, actor_id: SYSTEM_ACTOR_ID,
  });
  await requestManualConfirmation(pub, stakeholders, platforms);
  return { result: "asked" };
}

async function batchProcessPending(sb: any) {
  const now = Date.now();
  const t3 = new Date(now - 3 * 60 * 1000).toISOString();
  const t60 = new Date(now - 60 * 60 * 1000).toISOString();

  const { data: pubs } = await sb.from("publications").select("id")
    .lte("publish_at", t3).gte("publish_at", t60)
    .is("verified_at", null).is("deleted_at", null)
    .in("status", ["approved", "review", "rework", "in_work"]);
  const ids = (pubs ?? []).map((p: any) => p.id);
  if (!ids.length) return { processed: 0, results: [] };

  let igMedia: IGMedia[] | null = null;
  if (FB_ACCESS_TOKEN) {
    try { igMedia = await fetchIGRecentMedia(); }
    catch (e: any) { console.error("batch fetchIG fail", e?.message || e); }
  }

  const results = [];
  for (const id of ids) {
    const r = await verifyPublication(sb, id, igMedia);
    results.push({ id, ...r });
  }
  return { processed: ids.length, results };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST" && req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  if (HQ_CRON_SECRET) {
    const got = req.headers.get("x-hq-cron-secret");
    const urlSec = new URL(req.url).searchParams.get("secret");
    if (got !== HQ_CRON_SECRET && urlSec !== HQ_CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response("Missing config", { status: 500 });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  await resolveFbToken(sb);
  // #554: резолв system actor для audit-log (publication_history.actor_id NOT NULL)
  try {
    const { data: sysActor } = await sb.from("users").select("id").in("role", ["ceo", "coo"]).limit(1);
    SYSTEM_ACTOR_ID = sysActor?.[0]?.id ?? null;
  } catch (e) { console.error("resolve SYSTEM_ACTOR_ID failed", e); }

  // v6 diag: перевірка що токен резолвиться і IG досяжний (не друкує токен)
  if (new URL(req.url).searchParams.get("diag") === "1") {
    let igTest: any = null;
    if (FB_ACCESS_TOKEN) {
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${IG_USER_ID}?fields=username,followers_count&access_token=${FB_ACCESS_TOKEN}`);
        igTest = { status: r.status, body: await r.json() };
      } catch (e) { igTest = { error: String(e) }; }
    }
    return new Response(JSON.stringify({ token_present: !!FB_ACCESS_TOKEN, token_len: FB_ACCESS_TOKEN.length, ig_test: igTest }, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch {} }

  try {
    if (body.publication_id) {
      const r = await verifyPublication(sb, body.publication_id);
      return new Response(JSON.stringify({ ok: true, version:"v7", mode: "single", id: body.publication_id, ...r }), { status: 200, headers: { "Content-Type":"application/json" } });
    } else {
      const r = await batchProcessPending(sb);
      return new Response(JSON.stringify({ ok: true, version:"v7", mode: "batch", ...r }), { status: 200, headers: { "Content-Type":"application/json" } });
    }
  } catch (e: any) {
    console.error("verify-publication-ig error:", e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500, headers: { "Content-Type":"application/json" } });
  }
});
