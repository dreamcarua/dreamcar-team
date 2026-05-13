// =====================================================================
// DreamCar HQ — TG Webhook v8
// + /today /queue /late /my /me — швидкі довідки у DM
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
const PLATFORM_NAMES: Record<string, string> = {
  ig: "IG", tg: "TG", tt: "TT", yt: "YT", fb: "FB", th: "TH",
};
const STATUS_EMOJI: Record<string, string> = {
  draft: "📝", in_work: "⚙️", review: "👀",
  approved: "✅", published: "🚀", rework: "↩️",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Чернетка", in_work: "В роботі", review: "На погодженні",
  approved: "Погоджено", published: "Опубліковано", rework: "Доопрацювання",
};

function jwtRole(jwt: string): string {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return "not-jwt";
    const obj = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
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
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function todayBoundsKyiv(): { startIso: string; endIso: string; dateLabel: string } {
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
interface TgUpdate { message?: TgMessage; callback_query?: TgCallbackQuery; }

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
// Перевірка авторизації — знаходимо public.users за tg_chat_id
// =====================================================================
async function findUser(supabase: ReturnType<typeof createClient>, chatId: number) {
  const { data, error } = await supabase
    .from("users").select("id, name, email, role")
    .eq("tg_chat_id", chatId).maybeSingle();
  if (error) { console.error("findUser:", error); return null; }
  return data || null;
}

// =====================================================================
// /today — публікації сьогодні
// =====================================================================
async function handleToday(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /today — тільки у DM.", { silent: true }); return; }
  const { startIso, endIso, dateLabel } = todayBoundsKyiv();
  const { data: pubs } = await supabase
    .from("publications")
    .select("id, title, status, publish_at")
    .gte("publish_at", startIso).lte("publish_at", endIso)
    .is("deleted_at", null)
    .order("publish_at", { ascending: true });

  if (!pubs || pubs.length === 0) {
    await tgSend(chatId, `🌿 <b>Сьогодні ${dateLabel}</b> — нічого не заплановано.`);
    return;
  }

  // Платформи
  const ids = pubs.map(p => p.id);
  const { data: pp } = await supabase
    .from("publication_platforms").select("publication_id, platform").in("publication_id", ids);
  const byPub: Record<string, string[]> = {};
  (pp ?? []).forEach(r => { (byPub[r.publication_id] ||= []).push(r.platform); });

  const lines = [`📅 <b>Сьогодні ${dateLabel}</b> · ${pubs.length} публікацій\n`];
  for (const p of pubs) {
    const plats = (byPub[p.id] || []).map(x => PLATFORM_NAMES[x] || x).join("/") || "—";
    lines.push(`${STATUS_EMOJI[p.status] || "•"} <code>${fmtTime(p.publish_at)}</code> · <a href="${HQ_URL}#publication/${p.id}">${escHtml(p.title)}</a> · ${plats}`);
  }
  await tgSend(chatId, lines.join("\n"));
}

// =====================================================================
// /queue — що чекає МОГО погодження
// =====================================================================
async function handleQueue(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /queue — тільки у DM.", { silent: true }); return; }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку прив'яжи акаунт: /start"); return; }

  // Знайти всі публікації, де я approver і status=review
  const { data: apprList } = await supabase
    .from("publication_approvers")
    .select("publication_id, publications!inner(id, title, status, publish_at, deleted_at)")
    .eq("user_id", me.id);

  const items = (apprList ?? [])
    // @ts-ignore — join shape
    .map(r => r.publications)
    .filter(p => p && p.status === "review" && !p.deleted_at)
    .sort((a, b) => new Date(a.publish_at).getTime() - new Date(b.publish_at).getTime());

  if (items.length === 0) {
    await tgSend(chatId, "🌿 Черга порожня. Все погоджено.");
    return;
  }

  const lines = [`✅ <b>Чекає твого погодження</b> · ${items.length}\n`];
  for (const p of items) {
    const d = new Date(p.publish_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    lines.push(`👀 <code>${dateStr}</code> · <a href="${HQ_URL}#publication/${p.id}">${escHtml(p.title)}</a>`);
  }
  await tgSend(chatId, lines.join("\n"));
}

// =====================================================================
// /late — пропущені дедлайни + горить
// =====================================================================
async function handleLate(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /late — тільки у DM.", { silent: true }); return; }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку прив'яжи акаунт: /start"); return; }

  const nowIso = new Date().toISOString();
  const in48hIso = new Date(Date.now() + 48 * 3600 * 1000).toISOString();

  // Пропущені — час публікації < now і статус не published
  const { data: missed } = await supabase
    .from("publications")
    .select("id, title, status, publish_at")
    .lt("publish_at", nowIso)
    .not("status", "in", "(published)")
    .is("deleted_at", null)
    .order("publish_at", { ascending: false }).limit(10);

  // Горить — публікація через <48h, статус не approved/published
  const { data: urgent } = await supabase
    .from("publications")
    .select("id, title, status, publish_at")
    .gte("publish_at", nowIso).lte("publish_at", in48hIso)
    .not("status", "in", "(approved,published)")
    .is("deleted_at", null)
    .order("publish_at", { ascending: true });

  const lines: string[] = [];
  if (missed && missed.length > 0) {
    lines.push(`⚠️ <b>Пропущені</b> · ${missed.length}\n`);
    for (const p of missed.slice(0, 8)) {
      const d = new Date(p.publish_at);
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      lines.push(`• <code>${dateStr}</code> · <a href="${HQ_URL}#publication/${p.id}">${escHtml(p.title)}</a> · ${STATUS_LABEL[p.status]}`);
    }
    if (missed.length > 8) lines.push(`<i>... ще ${missed.length - 8}</i>`);
    lines.push("");
  }
  if (urgent && urgent.length > 0) {
    lines.push(`🔥 <b>Горить ≤48 год</b> · ${urgent.length}\n`);
    for (const p of urgent.slice(0, 8)) {
      const d = new Date(p.publish_at);
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      lines.push(`• <code>${dateStr}</code> · <a href="${HQ_URL}#publication/${p.id}">${escHtml(p.title)}</a> · ${STATUS_LABEL[p.status]}`);
    }
    if (urgent.length > 8) lines.push(`<i>... ще ${urgent.length - 8}</i>`);
  }
  if (lines.length === 0) {
    await tgSend(chatId, "🌿 Усе під контролем. Ні пропущених, ні горить.");
    return;
  }
  await tgSend(chatId, lines.join("\n"));
}

// =====================================================================
// /my — мої заплановані пости (responsible)
// =====================================================================
async function handleMy(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /my — тільки у DM.", { silent: true }); return; }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку прив'яжи акаунт: /start"); return; }

  const { data: respList } = await supabase
    .from("publication_responsibles")
    .select("publication_id, publications!inner(id, title, status, publish_at, deleted_at)")
    .eq("user_id", me.id);

  const items = (respList ?? [])
    // @ts-ignore — join shape
    .map(r => r.publications)
    .filter(p => p && !p.deleted_at && p.status !== "published")
    .sort((a, b) => new Date(a.publish_at).getTime() - new Date(b.publish_at).getTime())
    .slice(0, 15);

  if (items.length === 0) {
    await tgSend(chatId, "🌿 У тебе нема активних публікацій.");
    return;
  }

  const lines = [`📋 <b>Мої публікації</b> · ${items.length}\n`];
  for (const p of items) {
    const d = new Date(p.publish_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    lines.push(`${STATUS_EMOJI[p.status] || "•"} <code>${dateStr}</code> · <a href="${HQ_URL}#publication/${p.id}">${escHtml(p.title)}</a> · ${STATUS_LABEL[p.status]}`);
  }
  await tgSend(chatId, lines.join("\n"));
}

// =====================================================================
// /me — особистий зведений дайджест (today + queue + late + my)
// =====================================================================
async function handleMe(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /me — тільки у DM.", { silent: true }); return; }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку прив'яжи акаунт: /start"); return; }

  const nowIso = new Date().toISOString();
  const { startIso, endIso, dateLabel } = todayBoundsKyiv();

  // Сьогодні всього
  const { count: todayCount } = await supabase
    .from("publications").select("id", { count: "exact", head: true })
    .gte("publish_at", startIso).lte("publish_at", endIso).is("deleted_at", null);

  // Черга на моє погодження
  const { data: apprList } = await supabase
    .from("publication_approvers")
    .select("publication_id, publications!inner(status, deleted_at)")
    .eq("user_id", me.id);
  // @ts-ignore
  const queueCount = (apprList ?? []).filter(r => r.publications?.status === "review" && !r.publications?.deleted_at).length;

  // Мої активні (responsible, не published)
  const { data: respList } = await supabase
    .from("publication_responsibles")
    .select("publication_id, publications!inner(status, deleted_at)")
    .eq("user_id", me.id);
  // @ts-ignore
  const myCount = (respList ?? []).filter(r => r.publications && !r.publications.deleted_at && r.publications.status !== "published").length;

  // Пропущені
  const { count: missedCount } = await supabase
    .from("publications").select("id", { count: "exact", head: true })
    .lt("publish_at", nowIso).not("status", "in", "(published)").is("deleted_at", null);

  const lines: string[] = [];
  lines.push(`👤 <b>${escHtml(me.name || "")}</b> · ${escHtml(me.role || "")}\n`);
  lines.push(`📅 Сьогодні (${dateLabel}): <b>${todayCount ?? 0}</b> публікацій → /today`);
  lines.push(`✅ Чекає погодження від тебе: <b>${queueCount}</b> → /queue`);
  lines.push(`📋 Твої активні: <b>${myCount}</b> → /my`);
  lines.push(`⚠️ Пропущених загалом: <b>${missedCount ?? 0}</b> → /late`);
  lines.push(``);
  lines.push(`🔗 <a href="${HQ_URL}">Відкрити HQ</a>`);
  await tgSend(chatId, lines.join("\n"));
}

// =====================================================================
// /start /help /whoami /unbind /diag
// =====================================================================
async function handleStart(supabase: ReturnType<typeof createClient>, chatId: number, tgUser: { username?: string; first_name?: string; last_name?: string }, payload: string, isGroup: boolean): Promise<void> {
  const m = payload.match(/^hq_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!m) {
    if (isGroup) {
      await tgSend(chatId,
        `👋 Я бот DreamCar HQ. Шлю сповіщення про публікації.\n\nКоманди у DM: <a href="https://t.me/dreamcar_team_bot">@dreamcar_team_bot</a>`,
        { silent: true }
      );
      return;
    }
    await tgSend(chatId,
      `👋 Привіт${tgUser.first_name ? ", " + escHtml(tgUser.first_name) : ""}!\n\n` +
      `🆔 chat_id: <code>${chatId}</code>\n` +
      (tgUser.username ? `📛 @${escHtml(tgUser.username)}\n\n` : "\n") +
      `Команди: /me /today /queue /late /my /whoami /help`
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
    `✅ <b>Привʼязано!</b>\nАкаунт: <b>${escHtml(user.name || user.email || "")}</b>\nchat_id: <code>${chatId}</code>\n\nКоманди: /me /today /queue /late /my\n\n🔗 <a href="${HQ_URL}">HQ</a>`
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
      `🤖 У цій групі я шлю сповіщення з кнопками «✓ Погодити / ↩ Повернути».\n\nКоманди у DM: <a href="https://t.me/dreamcar_team_bot">@dreamcar_team_bot</a>`,
      { silent: true }
    );
    return;
  }
  await tgSend(chatId,
    `🤖 <b>DreamCar HQ bot</b>\n\n` +
    `<b>Швидкі довідки:</b>\n` +
    `/me — мій зведений дайджест\n` +
    `/today — публікації сьогодні\n` +
    `/queue — на моє погодження\n` +
    `/late — пропущені / горить ≤48 год\n` +
    `/my — мої заплановані\n\n` +
    `<b>Профіль:</b>\n` +
    `/start hq_&lt;id&gt; — привʼязати акаунт\n` +
    `/whoami — глянути привʼязку\n` +
    `/unbind — видалити\n` +
    `/diag — діагностика\n` +
    `/help — ця довідка`
  );
}

// =====================================================================
// CALLBACK QUERY (inline buttons)
// =====================================================================
async function handleCallback(supabase: ReturnType<typeof createClient>, cb: TgCallbackQuery): Promise<void> {
  const data = (cb.data || "").trim();
  const fromId = cb.from.id;
  const msg = cb.message;
  if (!data || !msg) { await tgAnswerCallback(cb.id, "Помилка: відсутні дані"); return; }

  const parts = data.split(":");
  const action = parts[0];
  const pubId = parts[1];

  if (action === "open") {
    // Legacy fallback — old messages з callback "open:" (нові вже url-кнопки)
    await tgAnswerCallback(cb.id, "Відкрий: " + HQ_URL + "#publication/" + pubId);
    return;
  }
  if (action !== "appr" || !pubId) { await tgAnswerCallback(cb.id, "Невідома дія"); return; }

  const decision = parts[2];

  const { data: user, error: userErr } = await supabase
    .from("users").select("id, name, role").eq("tg_chat_id", fromId).maybeSingle();
  if (userErr) { await tgAnswerCallback(cb.id, `Помилка БД: ${userErr.message}`, true); return; }
  if (!user) {
    await tgAnswerCallback(cb.id, "Спочатку прив'яжи свій акаунт: напиши боту у DM /start", true);
    return;
  }

  const { data: appr } = await supabase
    .from("publication_approvers")
    .select("user_id").eq("publication_id", pubId).eq("user_id", user.id).maybeSingle();
  if (!appr) {
    await tgAnswerCallback(cb.id, "Ти не у списку погоджувачів цієї публікації.", true);
    return;
  }

  const { data: pub } = await supabase
    .from("publications").select("id, title, status").eq("id", pubId).maybeSingle();
  if (!pub) { await tgAnswerCallback(cb.id, "Публікацію не знайдено", true); return; }
  if (pub.status !== "review") {
    await tgAnswerCallback(cb.id, `Публікація вже у статусі: ${pub.status}`, true);
    if (msg.text) await tgEditMessage(msg.chat.id, msg.message_id, msg.text + `\n\n<i>⚠️ Статус уже змінено: ${pub.status}</i>`);
    return;
  }

  const newStatus = decision === "y" ? "approved" : "rework";
  const { error: updErr } = await supabase
    .from("publications")
    .update({ status: newStatus, updated_at: new Date().toISOString(), last_action_via: "tg" })
    .eq("id", pubId);
  if (updErr) {
    await tgAnswerCallback(cb.id, `Помилка: ${updErr.message}`, true);
    return;
  }

  await supabase.from("publication_history").insert({
    publication_id: pubId,
    actor_id: user.id,
    action: decision === "y" ? "approve" : "reject",
    detail: decision === "y" ? "✓ через TG-кнопку" : "↩️ Повернуто через TG-кнопку (без коментаря)",
  });

  const decisionLabel = decision === "y" ? "✅ <b>Погоджено</b>" : "↩️ <b>Повернуто</b>";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const newText = (msg.text || "") + `\n\n${decisionLabel} · ${escHtml(user.name || "?")} · ${ts}`;
  await tgEditMessage(msg.chat.id, msg.message_id, newText);

  await tgAnswerCallback(cb.id, decision === "y" ? "✅ Погоджено!" : "↩️ Повернуто на доопрацювання");
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
    if (update.callback_query) {
      await handleCallback(supabase, update.callback_query);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

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

    // ---- Профіль / системні
    if (cmd === "/diag") await handleDiag(chatId, isGroup);
    else if (cmd === "/start") await handleStart(supabase, chatId, tgUser, payload, isGroup);
    else if (cmd === "/unbind") await handleUnbind(supabase, chatId, isGroup);
    else if (cmd === "/whoami") await handleWhoami(supabase, chatId, tgUser, isGroup);
    else if (cmd === "/help") await handleHelp(chatId, isGroup);
    // ---- Швидкі довідки
    else if (cmd === "/me") await handleMe(supabase, chatId, isGroup);
    else if (cmd === "/today") await handleToday(supabase, chatId, isGroup);
    else if (cmd === "/queue") await handleQueue(supabase, chatId, isGroup);
    else if (cmd === "/late") await handleLate(supabase, chatId, isGroup);
    else if (cmd === "/my") await handleMy(supabase, chatId, isGroup);
    else if (cmd && !isGroup) await tgSend(chatId, "ℹ️ Не зрозумів. Спробуй /help");

  } catch (e) {
    console.error("handler error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
