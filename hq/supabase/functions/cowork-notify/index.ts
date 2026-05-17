// =====================================================================
// DreamCar HQ — Cowork → TG Notify v2
// =====================================================================
// Edge Function для push-нотифікацій від Claude (Cowork mode) у TG.
// Викликається curl-ом з будь-якої Cowork-сесії після значного action-у.
//
// Receiver: береться з env COWORK_NOTIFY_CHAT_ID (primary), або з users
// таблиці за email vg@abrisart.com / dreamcarua@gmail.com (fallback).
//
// Authentication: secret token у header `x-cowork-token` (env COWORK_NOTIFY_TOKEN).
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
const COWORK_CHAT_ID   = Deno.env.get("COWORK_NOTIFY_CHAT_ID") ?? "";

// Fallback emails якщо env не задано
const FALLBACK_EMAILS = ["vg@abrisart.com", "dreamcarua@gmail.com", "vg@dreamcar.ua"];

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

async function resolveChatId(supabase: ReturnType<typeof createClient>): Promise<{ chatId: number | null; source: string; }> {
  // 1. Primary: env var
  if (COWORK_CHAT_ID) {
    const n = Number(COWORK_CHAT_ID);
    if (!isNaN(n) && n > 0) return { chatId: n, source: "env" };
  }
  // 2. Fallback: DB by emails
  for (const email of FALLBACK_EMAILS) {
    const { data } = await supabase
      .from("users")
      .select("tg_chat_id, name")
      .eq("email", email)
      .maybeSingle();
    if (data && data.tg_chat_id) {
      return { chatId: data.tg_chat_id as number, source: "db:" + email };
    }
  }
  // 3. Fallback: any CEO with tg_chat_id
  const { data: ceos } = await supabase
    .from("users")
    .select("tg_chat_id, name, email")
    .eq("role", "ceo")
    .not("tg_chat_id", "is", null)
    .limit(1);
  if (ceos && ceos.length > 0 && ceos[0].tg_chat_id) {
    return { chatId: ceos[0].tg_chat_id as number, source: "db:ceo-fallback" };
  }
  return { chatId: null, source: "none" };
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

  // Auth via secret token
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

  const { chatId, source } = await resolveChatId(supabase);
  if (!chatId) {
    return new Response(JSON.stringify({
      ok: false,
      error: "no chat_id available — set COWORK_NOTIFY_CHAT_ID env, or bind your TG to HQ via /start hq_<userId>"
    }), { status: 404, headers: { "Content-Type": "application/json" } });
  }

  const emoji = TYPE_EMOJI[body.type || ""] || "🤖";
  const ts = new Date().toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });
  let text = `${emoji} <b>Cowork</b> · ${escHtml(ts)}\n\n${escHtml(rawText)}`;
  if (body.link) {
    text += `\n\n🔗 <a href="${body.link.replace(/"/g, "")}">Відкрити</a>`;
  }

  try {
    await tgSendMessage(chatId, text);
  } catch (e) {
    console.error("tgSend err:", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e), source }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true, chat_id: chatId, source }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
