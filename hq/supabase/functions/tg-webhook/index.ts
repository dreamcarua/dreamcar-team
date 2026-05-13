// =====================================================================
// DreamCar HQ — TG Webhook v5
// + normalize @botname suffix (для груп)
// + private-only sensitive commands
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN      = Deno.env.get("TG_BOT_TOKEN")      ?? "";
const TG_WEBHOOK_SECRET = Deno.env.get("TG_WEBHOOK_SECRET")  ?? "";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")      ?? Deno.env.get("HQ_DB_URL") ?? "";
const SUP_KEY_RAW       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_KEY_RAW        = Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";
const SERVICE_ROLE_KEY  = HQ_KEY_RAW || SUP_KEY_RAW;
const KEY_SOURCE        = HQ_KEY_RAW ? "HQ_DB_SERVICE_KEY" : (SUP_KEY_RAW ? "SUPABASE_SERVICE_ROLE_KEY" : "MISSING");

const HQ_URL = "https://dreamcarua.github.io/dreamcar-team/hq/";

function jwtRole(jwt: string): string {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return "not-jwt";
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const obj = JSON.parse(json);
    return String(obj.role || "no-role-field");
  } catch (_e) { return "decode-err"; }
}

async function tgSend(chatId: number | string, text: string, opts: { silent?: boolean } = {}): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: "HTML",
        disable_web_page_preview: true,
        disable_notification: opts.silent,
      }),
    });
    if (!r.ok) console.error("tgSend fail", r.status, await r.text());
  } catch (e) { console.error("tgSend threw", e); }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface TgUpdate {
  message?: {
    message_id: number;
    chat: { id: number; type: string; username?: string; first_name?: string; title?: string };
    from?: { id: number; username?: string; first_name?: string; last_name?: string; };
    text?: string;
    entities?: Array<{ type: string; offset: number; length: number }>;
  };
}

/**
 * Нормалізує команду:
 *   "/help@dreamcar_team_bot" → "/help"
 *   "/start hq_xxx@bot" → "/start hq_xxx"
 *   "/start@bot hq_xxx" → "/start hq_xxx"
 * Повертає { cmd, payload }
 */
function parseCommand(text: string): { cmd: string; payload: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { cmd: "", payload: "" };
  // Перше слово — команда (опційно з @botname)
  const spaceIdx = trimmed.indexOf(" ");
  let head = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const payload = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  // Прибрати @botname суфікс
  const atIdx = head.indexOf("@");
  if (atIdx > 0) head = head.slice(0, atIdx);
  return { cmd: head.toLowerCase(), payload };
}

async function handleStart(supabase: ReturnType<typeof createClient>, chatId: number, tgUser: { username?: string; first_name?: string; last_name?: string }, payload: string, isGroup: boolean): Promise<void> {
  const m = payload.match(/^hq_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!m) {
    // Без payload — привітання
    if (isGroup) {
      await tgSend(chatId,
        `👋 Я бот DreamCar HQ. Шлю сповіщення про публікації.\n\n` +
        `Щоб привʼязати свій акаунт — напиши мені <b>у особисті</b>: ` +
        `<a href="https://t.me/dreamcar_team_bot">@dreamcar_team_bot</a>`,
        { silent: true }
      );
      return;
    }
    await tgSend(chatId,
      `👋 Привіт${tgUser.first_name ? ", " + escHtml(tgUser.first_name) : ""}!\n\n` +
      `🆔 <b>Твій chat_id:</b> <code>${chatId}</code>\n` +
      (tgUser.username ? `📛 <b>TG username:</b> @${escHtml(tgUser.username)}\n\n` : "\n") +
      `Щоб привʼязати акаунт — у HQ Налаштування → «Прив'язати через бот»\n\n` +
      `Команди: /whoami /unbind /help`
    );
    return;
  }

  // /start hq_<id> — sensitive, тільки приватно
  if (isGroup) {
    await tgSend(chatId,
      `🔒 Привʼязка акаунту доступна тільки <b>у приватному чаті</b> з ботом ` +
      `(щоб ніхто інший не бачив твій user.id).\n\n` +
      `Напиши <a href="https://t.me/dreamcar_team_bot?start=hq_${m[1]}">боту в особисті</a>.`,
      { silent: true }
    );
    return;
  }

  const userId = m[1].toLowerCase();
  const role = jwtRole(SERVICE_ROLE_KEY);

  const { data: user, error } = await supabase
    .from("users").select("id, name, email, tg_chat_id")
    .eq("id", userId).maybeSingle();

  if (error) {
    await tgSend(chatId,
      `⚠️ <b>Помилка БД</b>\n` +
      `<code>${escHtml(error.message || JSON.stringify(error))}</code>\n\n` +
      `🔑 Key: <b>${KEY_SOURCE}</b> (role=${role})`
    );
    return;
  }
  if (!user) {
    await tgSend(chatId, `⚠️ User <code>${escHtml(userId)}</code> not found.`);
    return;
  }

  if (user.tg_chat_id && user.tg_chat_id !== chatId) {
    await tgSend(chatId, `⚠️ Уже привʼязаний до іншого chat_id (${user.tg_chat_id}). Спочатку /unbind у старому чаті.`);
    return;
  }

  const { error: upErr } = await supabase
    .from("users").update({ tg_chat_id: chatId, tg_username: tgUser.username ?? null })
    .eq("id", userId);
  if (upErr) {
    await tgSend(chatId, `⚠️ Не вдалось привʼязати: <code>${escHtml(upErr.message)}</code>`);
    return;
  }

  await tgSend(chatId,
    `✅ <b>Привʼязано!</b>\n` +
    `Акаунт: <b>${escHtml(user.name || user.email || userId.slice(0, 8))}</b>\n` +
    `chat_id: <code>${chatId}</code>\n\n` +
    `🔗 <a href="${HQ_URL}">Відкрити HQ</a>`
  );
}

async function handleDiag(chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) {
    await tgSend(chatId, `🔒 /diag — тільки у приватному чаті з ботом.`, { silent: true });
    return;
  }
  const role = jwtRole(SERVICE_ROLE_KEY);
  await tgSend(chatId,
    `🔧 <b>Diag</b>\n` +
    `URL set: ${SUPABASE_URL ? "✅" : "❌"}\n` +
    `Key source: <b>${KEY_SOURCE}</b>\n` +
    `JWT role: <b>${role}</b> ${role === "service_role" ? "✅" : "❌"}\n` +
    `Key length: ${SERVICE_ROLE_KEY.length}\n` +
    `Bot token set: ${TG_BOT_TOKEN ? "✅" : "❌"}\n` +
    `Webhook secret set: ${TG_WEBHOOK_SECRET ? "✅" : "❌"}\n` +
    `chat_id: <code>${chatId}</code>`
  );
}

async function handleUnbind(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) {
    await tgSend(chatId, `🔒 /unbind — тільки у приватному чаті з ботом.`, { silent: true });
    return;
  }
  const { data: user, error } = await supabase
    .from("users").select("id, name, email").eq("tg_chat_id", chatId).maybeSingle();
  if (error) { await tgSend(chatId, `⚠️ ${escHtml(error.message)}`); return; }
  if (!user) { await tgSend(chatId, "ℹ️ Немає прив'язки."); return; }
  await supabase.from("users").update({ tg_chat_id: null, tg_username: null }).eq("id", user.id);
  await tgSend(chatId, `🔌 Привʼязку видалено для <b>${escHtml(user.name || user.email || "")}</b>.`);
}

async function handleWhoami(supabase: ReturnType<typeof createClient>, chatId: number, tgUser: { username?: string }, isGroup: boolean): Promise<void> {
  if (isGroup) {
    await tgSend(chatId, `🔒 /whoami — тільки у приватному чаті з ботом (приватні дані).`, { silent: true });
    return;
  }
  const { data: user, error } = await supabase
    .from("users").select("id, name, email, role")
    .eq("tg_chat_id", chatId).maybeSingle();
  if (error) { await tgSend(chatId, `⚠️ ${escHtml(error.message)}`); return; }
  if (!user) {
    await tgSend(chatId, `🚫 Не привʼязаний.\n\n🆔 chat_id: <code>${chatId}</code>${tgUser.username ? "\n📛 @" + escHtml(tgUser.username) : ""}`);
    return;
  }
  await tgSend(chatId,
    `🪪 <b>Привʼязка</b>\n` +
    `Імʼя: <b>${escHtml(user.name || "—")}</b>\n` +
    `Email: ${escHtml(user.email || "—")}\n` +
    `Роль: ${escHtml(user.role || "—")}\n` +
    `chat_id: <code>${chatId}</code>`
  );
}

async function handleHelp(chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) {
    await tgSend(chatId,
      `🤖 <b>DreamCar HQ bot</b>\n\n` +
      `У цій групі я шлю сповіщення про публікації.\n\n` +
      `Особисті команди (привʼязка, профіль) — напиши мені в особисті:\n` +
      `<a href="https://t.me/dreamcar_team_bot">@dreamcar_team_bot</a>`,
      { silent: true }
    );
    return;
  }
  await tgSend(chatId,
    `🤖 <b>DreamCar HQ bot</b>\n\n` +
    `/start — старт + інструкція\n` +
    `/whoami — глянути привʼязку\n` +
    `/unbind — видалити привʼязку\n` +
    `/diag — діагностика конфігурації\n` +
    `/help — ця довідка\n\n` +
    `🔗 <a href="${HQ_URL}">Відкрити HQ</a>`
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  if (TG_WEBHOOK_SECRET) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== TG_WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });
  }

  let update: TgUpdate;
  try { update = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400 }); }

  const msg = update.message;
  if (!msg || !msg.text) {
    return new Response(JSON.stringify({ ok: true, ignored: "non-text" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response("Missing config", { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const chatId = msg.chat.id;
  const chatType = msg.chat.type || "private";
  const isGroup = chatType !== "private";
  const tgUser = msg.from || {};
  const { cmd, payload } = parseCommand(msg.text);

  try {
    // У групах — ігноруємо все що не команда (щоб не флудити)
    if (isGroup && !cmd) {
      return new Response(JSON.stringify({ ok: true, ignored: "non-command-in-group" }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    if (cmd === "/diag") {
      await handleDiag(chatId, isGroup);
    } else if (cmd === "/start") {
      await handleStart(supabase, chatId, tgUser, payload, isGroup);
    } else if (cmd === "/unbind") {
      await handleUnbind(supabase, chatId, isGroup);
    } else if (cmd === "/whoami") {
      await handleWhoami(supabase, chatId, tgUser, isGroup);
    } else if (cmd === "/help") {
      await handleHelp(chatId, isGroup);
    } else if (cmd) {
      // Невідома команда
      if (!isGroup) {
        await tgSend(chatId, "ℹ️ Не зрозумів. Спробуй /help");
      }
      // У групах не відповідаємо — щоб не шумити
    } else {
      // Приватний чат, не-команда — м'яка підказка
      if (!isGroup) {
        await tgSend(chatId, "ℹ️ Не зрозумів. Спробуй /help");
      }
    }
  } catch (e) {
    console.error("handler error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
