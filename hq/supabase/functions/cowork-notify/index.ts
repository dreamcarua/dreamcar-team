// =====================================================================
// DreamCar HQ — Cowork → TG Notify v1
// =====================================================================
// Edge Function для push-нотифікацій від Claude (Cowork mode) у TG.
// Викликається curl-ом з будь-якої Cowork-сесії після значного action-у
// (git push, Edge Function deploy, SQL migration, sprint completion).
//
// Шле DM Вадиму через @dreamcar_team_bot (chat_id береться з users
// таблиці за email vg@abrisart.com).
//
// Authentication: secret token у header `x-cowork-token` (env COWORK_NOTIFY_TOKEN).
// Без токена — 401. Це не суворо — токен лежить у Global Instructions,
// але обмежує public spam.
//
// Body schema:
//   { text: string (max 500), link?: string, type?: "deploy"|"task"|"info" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN     = Deno.env.get("TG_BOT_TOKEN")      ?? "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")      ?? Deno.env.get("HQ_DB_URL") ?? "";
const SUP_KEY_RAW      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_KEY_RAW       = Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";
const SERVICE_ROLE_KEY = HQ_KEY_RAW || SUP_KEY_RAW;
const COWORK_TOKEN     = Deno.env.get("COWORK_NOTIFY_TOKEN") ?? "";

// Hardcoded — отримує тільки Вадим. Інші користувачі — окремий endpoint.
const RECEIVER_EMAIL = "vg@abrisart.com";

const TYPE_EMOJI: Record<string, string> = {
  deploy: "🚀",
  task: "✅",
  info: "ℹ️",
  warn: "⚠️",
  error: "🔴",
};

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tgSendMessage(chatId: number, text: string): Promise<void> {
  if (!TG_BOT_TOKEN) throw new Error("TG_BOT_TOKEN missing");
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: false,
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`TG send failed: ${r.status} ${err}`);
  }
}

Deno.serve(async (req: Request) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, x-cowork-token, authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Auth via secret token (loose — щоб обмежити public spam)
  if (COWORK_TOKEN) {
    const got = req.headers.get("x-cowork-token");
    if (got !== COWORK_TOKEN) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
  }

  let body: { text?: string; link?: string; type?: string };
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ ok: false, error: "bad json" }), { status: 400, headers: { "Content-Type": "application/json" } }); }

  const rawText = (body.text || "").trim();
  if (!rawText) {
    return new Response(JSON.stringify({ ok: false, error: "text required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  if (rawText.length > 500) {
    return new Response(JSON.stringify({ ok: false, error: "text too long (>500)" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "supabase config missing" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Знайти chat_id Вадима
  const { data: user, error: e1 } = await supabase
    .from("users")
    .select("tg_chat_id, name")
    .eq("email", RECEIVER_EMAIL)
    .maybeSingle();
  if (e1) {
    console.error("user lookup:", e1);
    return new Response(JSON.stringify({ ok: false, error: e1.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
  if (!user || !user.tg_chat_id) {
    return new Response(JSON.stringify({ ok: false, error: "receiver has no tg_chat_id" }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  // Сформувати повідомлення
  const emoji = TYPE_EMOJI[body.type || ""] || "🤖";
  const ts = new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
  let text = `${emoji} <b>Cowork</b> · ${escHtml(ts)}\n\n${escHtml(rawText)}`;
  if (body.link) {
    text += `\n\n🔗 <a href="${body.link.replace(/"/g, "")}">Відкрити</a>`;
  }

  try {
    await tgSendMessage(user.tg_chat_id as number, text);
  } catch (e) {
    console.error("tgSend err:", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true, sent_to: user.name }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
