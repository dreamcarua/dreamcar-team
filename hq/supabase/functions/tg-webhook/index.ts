// =====================================================================
// DreamCar HQ — TG Webhook v6
// + callback_query handler для inline-кнопок (✓ Погодити / ↩ Повернути)
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

interface InlineButton { text: string; callback_data?: string; url?: string; }
interface ReplyMarkup { inline_keyboard: InlineButton[][]; }

async function tgSend(chatId: number | string, text: string, opts: { silent?: boolean; reply_markup?: ReplyMarkup } = {}): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: opts.silent,
  };
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.error("tgSend fail", r.status, await r.text());
  } catch (e) { console.error("tgSend threw", e); }
}

async function tgEditMessage(chatId: number, messageId: number, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/editMessageText`;
  const body: Record<string, unknown> = {
    chat_id: chatId, message_id: messageId, text, parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) console.error("tgEditMessage fail", r.status, await r.text());
  } catch (e) { console.error("tgEditMessage threw", e); }
}

async function tgAnswerCallback(cbId: string, text: string, alert = false): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/answerCallbackQuery`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cbId, text, show_alert: alert }),
    });
  } catch (e) { console.error("tgAnswerCallback threw", e); }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; username?: string; first_name?: string; title?: string };
  from?: { id: number; username?: string; first_name?: string; last_name?: string; };
  text?: string;
}
interface TgCallbackQuery {
  id: string;
  from: { id: number; username?: string; first_name?: string; last_name?: string; };
  message?: TgMessage;
  data?: string;
}
interface TgUpdate {
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

function parseCommand(text: string): { cmd: string; payload: string } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return { cmd: "", payload: "" };
  const spaceIdx = trimmed.indexOf(" ");
  let head = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const payload = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  const atIdx = head.indexOf("@");
  if (atIdx > 0) head = head.slice(0, atIdx);
  return { cmd: head.toLowerCase(), payload };
}

// =====================================================================
// CALLBACK QUERY (inline buttons)
// =====================================================================
async function handleCallback(supabase: ReturnType<typeof createClient>, cb: TgCallbackQuery): Promise<void> {
  const data = (cb.data || "").trim();
  const fromId = cb.from.id;
  const msg = cb.message;
  if (!data || !msg) {
    await tgAnswerCallback(cb.id, "Помилка: відсутні дані");
    return;
  }

  // appr:<pubId>:y|n
  // open:<pubId>
  const parts = data.split(":");
  const action = parts[0];
  const pubId = parts[1];

  if (action === "open") {
    await tgAnswerCallback(cb.id, "Відкриваю...");
    await tgSend(msg.chat.id, `🔗 <a href="${HQ_URL}#publication/${escHtml(pubId)}">Відкрити «${escHtml(pubId.slice(0,8))}…» у HQ</a>`);
    return;
  }

  if (action !== "appr" || !pubId) {
    await tgAnswerCallback(cb.id, "Невідома дія");
    return;
  }

  const decision = parts[2]; // y | n

  // 1. Знайти юзера що клацнув
  const { data: user, error: userErr } = await supabase
    .from("users").select("id, name, role")
    .eq("tg_chat_id", fromId).maybeSingle();
  if (userErr) {
    await tgAnswerCallback(cb.id, `Помилка БД: ${userErr.message}`, true);
    return;
  }
  if (!user) {
    await tgAnswerCallback(cb.id,
      "Спочатку привʼяжи свій акаунт: напиши боту в особисті /start", true);
    return;
  }

  // 2. Перевірити що user — approver для цієї публікації
  const { data: appr } = await supabase
    .from("publication_approvers")
    .select("user_id").eq("publication_id", pubId).eq("user_id", user.id).maybeSingle();
  if (!appr) {
    await tgAnswerCallback(cb.id, "Ти не у списку погоджувачів цієї публікації.", true);
    return;
  }

  // 3. Завантажити публікацію (перевіримо що вона ще на review)
  const { data: pub } = await supabase
    .from("publications").select("id, title, status").eq("id", pubId).maybeSingle();
  if (!pub) {
    await tgAnswerCallback(cb.id, "Публікацію не знайдено", true);
    return;
  }
  if (pub.status !== "review") {
    await tgAnswerCallback(cb.id, `Публікація вже у статусі: ${pub.status}`, true);
    // Прибираємо кнопки що застаріли
    if (msg.text) await tgEditMessage(msg.chat.id, msg.message_id, msg.text + `\n\n<i>⚠️ Статус уже змінено: ${pub.status}</i>`);
    return;
  }

  // 4. Виконати дію
  const newStatus = decision === "y" ? "approved" : "rework";
  const { error: updErr } = await supabase
    .from("publications")
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", pubId);
  if (updErr) {
    await tgAnswerCallback(cb.id, `Помилка: ${updErr.message}`, true);
    return;
  }

  // 5. History
  await supabase.from("publication_history").insert({
    publication_id: pubId,
    actor_id: user.id,
    action: decision === "y" ? "approve" : "reject",
    detail: decision === "y" ? "" : "↩️ Повернуто через TG-кнопку (без коментаря)",
  });

  // 6. Edit оригінальне повідомлення — прибираємо кнопки + додаємо хто/коли
  const decisionLabel = decision === "y" ? "✅ <b>Погоджено</b>" : "↩️ <b>Повернуто</b>";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const newText = (msg.text || "") +
    `\n\n${decisionLabel} · ${escHtml(user.name || "?")} · ${ts}`;
  await tgEditMessage(msg.chat.id, msg.message_id, newText); // без reply_markup → кнопки прибрано

  // 7. Toast
  await tgAnswerCallback(cb.id, decision === "y" ? "✅ Погоджено!" : "↩️ Повернуто на доопрацювання");
}

// =====================================================================
// /start /help /whoami /unbind /diag
// =====================================================================
async function handleStart(supabase: ReturnType<typeof createClient>, chatId: number, tgUser: { username?: string; first_name?: string; last_name?: string }, payload: string, isGroup: boolean): Promise<void> {
  const m = payload.match(/^hq_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!m) {
    if (isGroup) {
      await tgSend(chatId,
        `👋 Я бот DreamCar HQ. Шлю сповіщення про публікації.\n\nПрив'язка акаунту — у особистих: <a href="https://t.me/dreamcar_team_bot">@dreamcar_team_bot</a>`,
        { silent: true }
      );
      return;
    }
    await tgSend(chatId,
      `👋 Привіт${tgUser.first_name ? ", " + escHtml(tgUser.first_name) : ""}!\n\n` +
      `🆔 chat_id: <code>${chatId}</code>\n` +
      (tgUser.username ? `📛 @${escHtml(tgUser.username)}\n\n` : "\n") +
      `Команди: /whoami /unbind /help`
    );
    return;
  }
  if (isGroup) {
    await tgSend(chatId,
      `🔒 Привʼязка тільки приватно. Напиши <a href="https://t.me/dreamcar_team_bot?start=hq_${m[1]}">боту в особисті</a>.`,
      { silent: true }
    );
    return;
  }
  const userId = m[1].toLowerCase();
  const { data: user, error } = await supabase
    .from("users").select("id, name, email, tg_chat_id")
    .eq("id", userId).maybeSingle();
  if (error) { await tgSend(chatId, `⚠️ ${escHtml(error.message)}`); return; }
  if (!user) { await tgSend(chatId, `⚠️ User <code>${escHtml(userId)}</code> not found.`); return; }
  if (user.tg_chat_id && user.tg_chat_id !== chatId) {
    await tgSend(chatId, `⚠️ Уже привʼязаний (chat_id ${user.tg_chat_id}). Спочатку /unbind у старому чаті.`);
    return;
  }
  const { error: upErr } = await supabase
    .from("users").update({ tg_chat_id: chatId, tg_username: tgUser.username ?? null })
    .eq("id", userId);
  if (upErr) { await tgSend(chatId, `⚠️ ${escHtml(upErr.message)}`); return; }
  await tgSend(chatId,
    `✅ <b>Привʼязано!</b>\nАкаунт: <b>${escHtml(user.name || user.email || "")}</b>\nchat_id: <code>${chatId}</code>\n\n🔗 <a href="${HQ_URL}">HQ</a>`
  );
}

async function handleDiag(chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, `🔒 /diag — тільки приватно.`, { silent: true }); return; }
  const role = jwtRole(SERVICE_ROLE_KEY);
  await tgSend(chatId,
    `🔧 <b>Diag</b>\n` +
    `URL: ${SUPABASE_URL ? "✅" : "❌"} · Key: <b>${KEY_SOURCE}</b> (role=${role})\n` +
    `chat_id: <code>${chatId}</code>`
  );
}

async function handleUnbind(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, `🔒 /unbind — тільки приватно.`, { silent: true }); return; }
  const { data: user } = await supabase
    .from("users").select("id, name, email").eq("tg_chat_id", chatId).maybeSingle();
  if (!user) { await tgSend(chatId, "ℹ️ Немає прив'язки."); return; }
  await supabase.from("users").update({ tg_chat_id: null, tg_username: null }).eq("id", user.id);
  await tgSend(chatId, `🔌 Привʼязку видалено для <b>${escHtml(user.name || user.email || "")}</b>.`);
}

async function handleWhoami(supabase: ReturnType<typeof createClient>, chatId: number, tgUser: { username?: string }, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, `🔒 /whoami — тільки приватно.`, { silent: true }); return; }
  const { data: user } = await supabase
    .from("users").select("id, name, email, role").eq("tg_chat_id", chatId).maybeSingle();
  if (!user) {
    await tgSend(chatId, `🚫 Не привʼязаний.\n\n🆔 chat_id: <code>${chatId}</code>${tgUser.username ? "\n📛 @" + escHtml(tgUser.username) : ""}`);
    return;
  }
  await tgSend(chatId,
    `🪪 <b>${escHtml(user.name || "—")}</b>\n` +
    `Email: ${escHtml(user.email || "—")}\n` +
    `Роль: ${escHtml(user.role || "—")}\n` +
    `chat_id: <code>${chatId}</code>`
  );
}

async function handleHelp(chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) {
    await tgSend(chatId,
      `🤖 У цій групі я шлю сповіщення про публікації + кнопки «✓ Погодити / ↩ Повернути».\n\nОсобисті команди — у DM: <a href="https://t.me/dreamcar_team_bot">@dreamcar_team_bot</a>`,
      { silent: true }
    );
    return;
  }
  await tgSend(chatId,
    `🤖 <b>DreamCar HQ bot</b>\n\n` +
    `/start — старт + інструкція\n` +
    `/whoami — глянути привʼязку\n` +
    `/unbind — видалити привʼязку\n` +
    `/diag — діагностика\n` +
    `/help — ця довідка`
  );
}

// =====================================================================
// HTTP entry
// =====================================================================
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

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response("Missing config", { status: 500 });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    // ---- callback_query ----
    if (update.callback_query) {
      await handleCallback(supabase, update.callback_query);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ---- message ----
    const msg = update.message;
    if (!msg || !msg.text) {
      return new Response(JSON.stringify({ ok: true, ignored: "non-text" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const chatId = msg.chat.id;
    const chatType = msg.chat.type || "private";
    const isGroup = chatType !== "private";
    const tgUser = msg.from || {};
    const { cmd, payload } = parseCommand(msg.text);

    if (isGroup && !cmd) {
      return new Response(JSON.stringify({ ok: true, ignored: "non-command-in-group" }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    if (cmd === "/diag") await handleDiag(chatId, isGroup);
    else if (cmd === "/start") await handleStart(supabase, chatId, tgUser, payload, isGroup);
    else if (cmd === "/unbind") await handleUnbind(supabase, chatId, isGroup);
    else if (cmd === "/whoami") await handleWhoami(supabase, chatId, tgUser, isGroup);
    else if (cmd === "/help") await handleHelp(chatId, isGroup);
    else if (cmd && !isGroup) await tgSend(chatId, "ℹ️ Не зрозумів. Спробуй /help");
    // інакше: тиша

  } catch (e) {
    console.error("handler error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
