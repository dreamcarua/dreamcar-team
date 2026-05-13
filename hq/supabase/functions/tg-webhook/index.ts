// =====================================================================
// DreamCar HQ — TG Webhook (inbound bot)
// =====================================================================
// Приймає updates від Telegram коли юзер пише боту.
// Обробляє команди:
//   /start hq_<user_id>  — прив'язати chat_id до user.id у public.users
//   /start               — підказка з посиланням на HQ
//   /unbind              — видалити прив'язку
//   /whoami              — показати поточну прив'язку
//   /help                — список команд
//
// БЕЗПЕКА:
// Telegram дає опційний secret_token при setWebhook — він приходить
// у заголовку `X-Telegram-Bot-Api-Secret-Token`. Ми порівнюємо з
// нашим TG_WEBHOOK_SECRET. Це native-механізм Telegram, без custom auth.
//
// Конфіг (Edge Functions → Manage secrets):
//   TG_BOT_TOKEN       — токен бота
//   TG_WEBHOOK_SECRET  — секрет для setWebhook (рандомний рядок)
//   SUPABASE_URL              (auto)
//   SUPABASE_SERVICE_ROLE_KEY (auto)
//
// SETUP (один раз, після deploy):
//   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
//     -H "Content-Type: application/json" \
//     -d '{"url":"https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/tg-webhook","secret_token":"<TG_WEBHOOK_SECRET>"}'
//
// Або через SQL Editor:
//   select net.http_post(
//     url := 'https://api.telegram.org/bot<TOKEN>/setWebhook',
//     headers := jsonb_build_object('Content-Type','application/json'),
//     body := jsonb_build_object(
//       'url','https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/tg-webhook',
//       'secret_token','<TG_WEBHOOK_SECRET>'
//     )
//   );
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN      = Deno.env.get("TG_BOT_TOKEN")      ?? "";
const TG_WEBHOOK_SECRET = Deno.env.get("TG_WEBHOOK_SECRET")  ?? "";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")      ?? "";
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const HQ_URL = "https://dreamcarua.github.io/dreamcar-team/hq/";

async function tgSend(chatId: number | string, text: string): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.error("tgSend fail", r.status, await r.text());
  } catch (e) {
    console.error("tgSend threw", e);
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface TgUpdate {
  message?: {
    message_id: number;
    chat: { id: number; type: string; username?: string; first_name?: string; };
    from?: { id: number; username?: string; first_name?: string; last_name?: string; };
    text?: string;
  };
  callback_query?: unknown;
}

async function handleStart(supabase: ReturnType<typeof createClient>, chatId: number, tgUser: { username?: string; first_name?: string; last_name?: string }, payload: string): Promise<void> {
  // Очікуємо payload виду "hq_<uuid>"
  const m = payload.match(/^hq_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!m) {
    await tgSend(chatId,
      `👋 Привіт${tgUser.first_name ? ", " + escHtml(tgUser.first_name) : ""}!\n\n` +
      `Це бот <b>DreamCar HQ</b>. Я надсилатиму тобі персональні нотифікації про твої публікації.\n\n` +
      `Щоб прив'язати свій акаунт:\n` +
      `1. Відкрий HQ: <a href="${HQ_URL}">${HQ_URL}</a>\n` +
      `2. Залогінься (Google)\n` +
      `3. Перейди у <b>Налаштування → Telegram</b>\n` +
      `4. Натисни <i>«Прив'язати через бот»</i> — буде deep-link сюди\n\n` +
      `Команди:\n` +
      `/whoami — глянути прив'язку\n` +
      `/unbind — видалити прив'язку\n` +
      `/help — довідка`
    );
    return;
  }
  const userId = m[1];
  // Перевіряємо, що такий user існує
  const { data: user, error } = await supabase
    .from("users").select("id, name, email, tg_chat_id")
    .eq("id", userId).maybeSingle();
  if (error || !user) {
    await tgSend(chatId, "⚠️ Користувача з таким ID не знайдено. Перевір, що ти зайшов у HQ й натиснув правильне посилання.");
    return;
  }
  // Якщо вже прив'язано до іншого chat_id — попередимо
  if (user.tg_chat_id && user.tg_chat_id !== chatId) {
    await tgSend(chatId,
      `⚠️ Цей акаунт уже прив'язаний до іншого TG-чату (${user.tg_chat_id}).\n` +
      `Якщо хочеш перепривʼязати — спочатку у старому чаті виконай /unbind, потім натисни кнопку «Прив'язати через бот» у HQ знову.`
    );
    return;
  }
  // Записуємо
  const { error: upErr } = await supabase
    .from("users").update({ tg_chat_id: chatId, tg_username: tgUser.username ?? null })
    .eq("id", userId);
  if (upErr) {
    console.error("bind fail", upErr);
    await tgSend(chatId, "⚠️ Не вдалося прив'язати. Спробуй ще раз через 1 хв або звернись до Вадима.");
    return;
  }
  await tgSend(chatId,
    `✅ <b>Прив'язано!</b>\n` +
    `Акаунт: <b>${escHtml(user.name || user.email || userId.slice(0, 8))}</b>\n\n` +
    `Тепер я надсилатиму тобі сповіщення про:\n` +
    `• Публікації, що чекають твого погодження\n` +
    `• Повернення на доопрацювання (з коментарем)\n` +
    `• Інші події що тебе стосуються\n\n` +
    `🔗 <a href="${HQ_URL}">Відкрити HQ</a>`
  );
}

async function handleUnbind(supabase: ReturnType<typeof createClient>, chatId: number): Promise<void> {
  const { data: user } = await supabase
    .from("users").select("id, name, email").eq("tg_chat_id", chatId).maybeSingle();
  if (!user) {
    await tgSend(chatId, "ℹ️ У цьому чаті немає прив'язки.");
    return;
  }
  await supabase.from("users").update({ tg_chat_id: null, tg_username: null }).eq("id", user.id);
  await tgSend(chatId, `🔌 Прив'язку видалено для <b>${escHtml(user.name || user.email || "")}</b>.\n\nЩоб прив'язати знову — у HQ Налаштування → «Прив'язати через бот».`);
}

async function handleWhoami(supabase: ReturnType<typeof createClient>, chatId: number, tgUser: { username?: string }): Promise<void> {
  const { data: user } = await supabase
    .from("users").select("id, name, email, role")
    .eq("tg_chat_id", chatId).maybeSingle();
  if (!user) {
    await tgSend(chatId, `🚫 Цей чат не привʼязаний.\n\nЩоб привʼязати — зайди у HQ → Налаштування → «Прив'язати через бот».${tgUser.username ? "\n(Твій TG: @" + tgUser.username + ")" : ""}`);
    return;
  }
  await tgSend(chatId,
    `🪪 <b>Привʼязка</b>\n` +
    `Імʼя: <b>${escHtml(user.name || "—")}</b>\n` +
    `Email: ${escHtml(user.email || "—")}\n` +
    `Роль: ${escHtml(user.role || "—")}\n` +
    `ID: <code>${escHtml(user.id || "")}</code>`
  );
}

async function handleHelp(chatId: number): Promise<void> {
  await tgSend(chatId,
    `🤖 <b>DreamCar HQ bot</b>\n\n` +
    `Команди:\n` +
    `/start — старт + інструкція\n` +
    `/whoami — глянути привʼязку\n` +
    `/unbind — видалити привʼязку\n` +
    `/help — ця довідка\n\n` +
    `🔗 <a href="${HQ_URL}">Відкрити HQ</a>`
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Telegram-native захист: secret_token у заголовку
  if (TG_WEBHOOK_SECRET) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== TG_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  let update: TgUpdate;
  try { update = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400 }); }

  const msg = update.message;
  if (!msg || !msg.text) {
    return new Response(JSON.stringify({ ok: true, ignored: "non-text" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response("Missing service config", { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const chatId = msg.chat.id;
  const tgUser = msg.from || {};
  const text = msg.text.trim();

  try {
    if (text.startsWith("/start")) {
      const payload = text.slice(6).trim();
      await handleStart(supabase, chatId, tgUser, payload);
    } else if (text === "/unbind") {
      await handleUnbind(supabase, chatId);
    } else if (text === "/whoami") {
      await handleWhoami(supabase, chatId, tgUser);
    } else if (text === "/help") {
      await handleHelp(chatId);
    } else {
      // Будь-який інший текст — м'яка підказка
      await tgSend(chatId, "ℹ️ Не зрозумів. Спробуй /help");
    }
  } catch (e) {
    console.error("handler error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
