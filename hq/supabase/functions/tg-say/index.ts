// tg-say — надіслати довільне повідомлення у робочий чат/особисті від імені командного бота.
// Створено 01.08.2026 під правило Вадима: питання до команди (Саша/Віра/Артем/Давид)
// задаємо НАПРЯМУ в TG, а не через Вадима.
//
// POST/GET, потребує x-hq-cron-secret.
//   ?chat=<id|alias>  — куди (alias: smm | board | test). default: smm
//   ?text=<текст>     — що (або body {"text": "...", "chat": "..."})
//   ?reply_to=<msgid> — відповісти на повідомлення (опц.)
//   ?silent=1         — без звуку
//
// Приклад: /tg-say?chat=smm&text=Питання по клікабельному посиланню…
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TG = Deno.env.get("TG_BOT_TOKEN")!;
const CRON = Deno.env.get("DC_CRON_SECRET") ?? Deno.env.get("HQ_CRON_SECRET") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALIASES: Record<string, string> = {
  smm: Deno.env.get("DCSMM_GROUP_CHAT_ID") || "-1003933841573", // робоча SMM-група
  test: "-1003933841573",
  board: "-1003883456849",                                       // BOARD (фінзвіти)
};

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // 08.08.2026 (аудит): fail-closed — відсутній env-секрет більше не відкриває функцію
  const got = req.headers.get("x-hq-cron-secret") || url.searchParams.get("secret");
  if (!CRON) return new Response(JSON.stringify({ ok: false, error: "secret not configured" }), { status: 500 });
  if (got !== CRON) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });

  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* ignore */ } }

  // Видалити повідомлення бота: ?delete=<message_id>&chat=<...>
  const delId = body.delete || url.searchParams.get("delete");
  if (delId) {
    const rawC = String(body.chat || url.searchParams.get("chat") || "smm");
    const cid = ALIASES[rawC.toLowerCase()] || rawC;
    const r = await fetch(`https://api.telegram.org/bot${TG}/deleteMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: cid, message_id: Number(delId) }),
    });
    const j = await r.json();
    return new Response(JSON.stringify({ ok: !!j.ok, deleted: delId, chat_id: cid, err: j.description }),
      { headers: { "content-type": "application/json" } });
  }

  const rawChat = String(body.chat || url.searchParams.get("chat") || "smm");
  const text = String(body.text || url.searchParams.get("text") || "").trim();
  const replyTo = body.reply_to || url.searchParams.get("reply_to");
  const silent = (body.silent ?? url.searchParams.get("silent")) === "1" || body.silent === true;
  if (!text) return new Response(JSON.stringify({ ok: false, error: "text обов'язковий" }), { status: 400 });

  // alias → chat_id; або ім'я користувача → його tg_chat_id
  let chatId = ALIASES[rawChat.toLowerCase()] || rawChat;
  if (!/^-?\d+$/.test(chatId)) {
    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    const { data } = await sb.from("users").select("name, tg_chat_id").not("tg_chat_id", "is", null);
    const hit = (data || []).find((u: any) => String(u.name || "").toLowerCase().includes(rawChat.toLowerCase()));
    if (!hit) return new Response(JSON.stringify({ ok: false, error: `не знайшов чат «${rawChat}»`, hint: Object.keys(ALIASES) }), { status: 404 });
    chatId = String(hit.tg_chat_id);
  }

  const payload: any = { chat_id: chatId, text: text.slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true };
  if (replyTo) payload.reply_to_message_id = Number(replyTo);
  if (silent) payload.disable_notification = true;

  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const j = await r.json();
  return new Response(JSON.stringify({ ok: !!j.ok, chat_id: chatId, message_id: j.result?.message_id, err: j.description }),
    { headers: { "content-type": "application/json" } });
});
