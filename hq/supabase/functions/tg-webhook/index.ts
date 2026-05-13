// =====================================================================
// DreamCar HQ — TG Webhook v9
// + /approve flow (черга погоджень з кнопками)
// + File upload (photo/video/document → creative)
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
const STORAGE_BUCKET = "creatives";
const TG_FILE_MAX_BYTES = 20 * 1024 * 1024; // 20 MB — обмеження TG bot API

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

async function tgSend(chatId: number | string, text: string, opts: { silent?: boolean; reply_markup?: ReplyMarkup } = {}): Promise<{ message_id: number } | null> {
  if (!TG_BOT_TOKEN) return null;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: opts.silent,
  };
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { console.error("tgSend fail", r.status, await r.text()); return null; }
    const data = await r.json();
    return data?.result || null;
  } catch (e) { console.error("tgSend threw", e); return null; }
}

async function tgEditMessage(chatId: number, messageId: number, text: string, replyMarkup?: ReplyMarkup): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  const body: Record<string, unknown> = {
    chat_id: chatId, message_id: messageId, text, parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/editMessageText`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) console.error("tgEditMessage fail", r.status, await r.text());
  } catch (e) { console.error("tgEditMessage threw", e); }
}

async function tgAnswerCallback(cbId: string, text: string, alert = false): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: cbId, text, show_alert: alert }),
    });
  } catch (e) { console.error("tgAnswerCallback threw", e); }
}

async function tgGetFilePath(fileId: string): Promise<string | null> {
  if (!TG_BOT_TOKEN) return null;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data?.result?.file_path || null;
  } catch (e) { console.error("tgGetFile threw", e); return null; }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function uuidV4(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
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

interface TgPhotoSize { file_id: string; file_unique_id: string; width: number; height: number; file_size?: number; }
interface TgDocument { file_id: string; file_unique_id: string; file_name?: string; mime_type?: string; file_size?: number; }
interface TgVideo { file_id: string; file_unique_id: string; width: number; height: number; duration: number; file_name?: string; mime_type?: string; file_size?: number; thumbnail?: TgPhotoSize; }
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; username?: string; first_name?: string; title?: string };
  from?: { id: number; username?: string; first_name?: string; last_name?: string; };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: TgDocument;
  video?: TgVideo;
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

async function findUser(supabase: ReturnType<typeof createClient>, chatId: number) {
  const { data, error } = await supabase
    .from("users").select("id, name, email, role")
    .eq("tg_chat_id", chatId).maybeSingle();
  if (error) { console.error("findUser:", error); return null; }
  return data || null;
}

// =====================================================================
// /approve — черга погоджень з кнопками (показуємо по одному)
// =====================================================================
function buildQueueKeyboard(pubId: string): ReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✓ Погодити", callback_data: `qappr:${pubId}:y` },
        { text: "↩ Повернути", callback_data: `qappr:${pubId}:n` },
        { text: "⏭ Пропустити", callback_data: `qappr:${pubId}:s` },
      ],
      [
        { text: "🔗 Відкрити в HQ", url: `${HQ_URL}#publication/${pubId}` },
      ],
    ],
  };
}

async function getQueueForUser(supabase: ReturnType<typeof createClient>, userId: string, skippedIds: string[] = []): Promise<{ id: string; title: string; publish_at: string }[]> {
  const { data: apprList } = await supabase
    .from("publication_approvers")
    .select("publication_id, publications!inner(id, title, status, publish_at, deleted_at)")
    .eq("user_id", userId);
  return (apprList ?? [])
    // @ts-ignore — join shape
    .map(r => r.publications as { id: string; title: string; status: string; publish_at: string; deleted_at?: string | null })
    .filter(p => p && p.status === "review" && !p.deleted_at && !skippedIds.includes(p.id))
    .sort((a, b) => new Date(a.publish_at).getTime() - new Date(b.publish_at).getTime());
}

function formatPubForQueue(p: { id: string; title: string; publish_at: string }, position: number, total: number): string {
  const d = new Date(p.publish_at);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `📋 <b>Черга погоджень</b> · ${position}/${total}\n\n` +
    `«${escHtml(p.title)}»\n` +
    `🕐 ${dateStr}\n\n` +
    `<i>Тисни кнопку щоб погодити / повернути / пропустити</i>`;
}

async function handleApprove(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /approve — тільки у DM.", { silent: true }); return; }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку прив'яжи акаунт: /start"); return; }

  const queue = await getQueueForUser(supabase, me.id);
  if (queue.length === 0) {
    await tgSend(chatId, "🌿 Черга порожня. Все погоджено.");
    return;
  }
  const first = queue[0];
  await tgSend(chatId, formatPubForQueue(first, 1, queue.length), {
    reply_markup: buildQueueKeyboard(first.id),
  });
}

async function handleQueueCallback(supabase: ReturnType<typeof createClient>, cb: TgCallbackQuery, pubId: string, decision: string): Promise<void> {
  const fromId = cb.from.id;
  const msg = cb.message!;

  const me = await findUser(supabase, fromId);
  if (!me) { await tgAnswerCallback(cb.id, "Спочатку /start", true); return; }

  // Skip — просто переходимо на наступну
  if (decision === "s") {
    await tgAnswerCallback(cb.id, "Пропущено");
    const remaining = await getQueueForUser(supabase, me.id, [pubId]);
    if (remaining.length === 0) {
      await tgEditMessage(msg.chat.id, msg.message_id, (msg.text || "") + "\n\n⏭ <i>Пропущено</i>\n\n🌿 Більше нічого у черзі.");
      return;
    }
    const next = remaining[0];
    await tgEditMessage(msg.chat.id, msg.message_id, formatPubForQueue(next, 1, remaining.length), buildQueueKeyboard(next.id));
    return;
  }

  // Approve / Reject — як у звичайному callback'у
  const { data: appr } = await supabase
    .from("publication_approvers")
    .select("user_id").eq("publication_id", pubId).eq("user_id", me.id).maybeSingle();
  if (!appr) { await tgAnswerCallback(cb.id, "Ти не у списку погоджувачів цієї публікації", true); return; }

  const { data: pub } = await supabase
    .from("publications").select("id, title, status").eq("id", pubId).maybeSingle();
  if (!pub) { await tgAnswerCallback(cb.id, "Публікацію не знайдено", true); return; }
  if (pub.status !== "review") { await tgAnswerCallback(cb.id, `Статус: ${pub.status}`, true); return; }

  const newStatus = decision === "y" ? "approved" : "rework";
  const { error: updErr } = await supabase
    .from("publications")
    .update({ status: newStatus, updated_at: new Date().toISOString(), last_action_via: "tg" })
    .eq("id", pubId);
  if (updErr) { await tgAnswerCallback(cb.id, `Помилка: ${updErr.message}`, true); return; }

  await supabase.from("publication_history").insert({
    publication_id: pubId, actor_id: me.id,
    action: decision === "y" ? "approve" : "reject",
    detail: decision === "y" ? "✓ через /approve" : "↩️ через /approve",
  });

  await tgAnswerCallback(cb.id, decision === "y" ? "✅ Погоджено!" : "↩️ Повернуто");

  // Показуємо наступну
  const remaining = await getQueueForUser(supabase, me.id);
  const decisionLabel = decision === "y" ? "✅ Погоджено" : "↩️ Повернуто";
  if (remaining.length === 0) {
    await tgEditMessage(msg.chat.id, msg.message_id, (msg.text || "").replace(/Тисни кнопку.*$/, "") + `\n${decisionLabel}\n\n🎉 <b>Черга оброблена!</b>`);
    return;
  }
  const next = remaining[0];
  // Поточне повідомлення — фіналізуємо
  await tgEditMessage(msg.chat.id, msg.message_id, (msg.text || "").replace(/Тисни кнопку.*$/, "") + `\n${decisionLabel}`);
  // Шлемо наступне
  await tgSend(msg.chat.id, formatPubForQueue(next, 1, remaining.length), { reply_markup: buildQueueKeyboard(next.id) });
}

// =====================================================================
// File upload (photo/video/document) → creative
// =====================================================================

interface DownloadedFile {
  buf: ArrayBuffer;
  filename: string;
  mime: string;
  size: number;
  type: "photo" | "video" | "doc" | "audio";
}

function inferTypeFromMime(mime: string): "photo" | "video" | "doc" | "audio" {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "doc";
}

async function downloadTgFile(fileId: string, fallbackName: string, fallbackMime: string): Promise<DownloadedFile | null> {
  const path = await tgGetFilePath(fileId);
  if (!path) return null;
  const url = `https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${path}`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const buf = await r.arrayBuffer();
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".")) : "";
  let filename = fallbackName;
  if (!filename || filename === "") {
    filename = `tg_${Date.now()}${ext}`;
  } else if (!filename.includes(".") && ext) {
    filename = filename + ext;
  }
  const mime = fallbackMime || (
    /\.(jpe?g)$/i.test(path) ? "image/jpeg" :
    /\.png$/i.test(path) ? "image/png" :
    /\.(mp4|mov)$/i.test(path) ? "video/mp4" :
    /\.pdf$/i.test(path) ? "application/pdf" :
    "application/octet-stream"
  );
  return { buf, filename, mime, size: buf.byteLength, type: inferTypeFromMime(mime) };
}

async function handleFileMessage(supabase: ReturnType<typeof createClient>, msg: TgMessage, isGroup: boolean): Promise<void> {
  const chatId = msg.chat.id;
  if (isGroup) {
    // У групах не приймаємо файли (флуд)
    return;
  }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку прив'яжи акаунт: /start"); return; }

  // Визначаємо який саме файл
  let fileId: string | null = null;
  let filename = "";
  let mime = "";

  if (msg.document) {
    if ((msg.document.file_size ?? 0) > TG_FILE_MAX_BYTES) {
      await tgSend(chatId, `⚠️ Файл задовгий (>20 MB). TG-бот не приймає такі. Завантаж через HQ-сайт.`);
      return;
    }
    fileId = msg.document.file_id;
    filename = msg.document.file_name || "";
    mime = msg.document.mime_type || "";
  } else if (msg.video) {
    if ((msg.video.file_size ?? 0) > TG_FILE_MAX_BYTES) {
      await tgSend(chatId, `⚠️ Відео задовге (>20 MB). Завантаж через HQ-сайт.`);
      return;
    }
    fileId = msg.video.file_id;
    filename = msg.video.file_name || `video_${Date.now()}.mp4`;
    mime = msg.video.mime_type || "video/mp4";
  } else if (msg.photo && msg.photo.length > 0) {
    // Беремо найбільший варіант
    const best = msg.photo[msg.photo.length - 1];
    if ((best.file_size ?? 0) > TG_FILE_MAX_BYTES) {
      await tgSend(chatId, `⚠️ Фото задовге. Завантаж через HQ-сайт.`);
      return;
    }
    fileId = best.file_id;
    filename = `photo_${Date.now()}.jpg`;
    mime = "image/jpeg";
  }

  if (!fileId) {
    // Не файл — нічого не робимо
    return;
  }

  const progress = await tgSend(chatId, "📥 Завантажую файл...");
  const dl = await downloadTgFile(fileId, filename, mime);
  if (!dl) {
    if (progress) await tgEditMessage(chatId, progress.message_id, "⚠️ Не вдалось завантажити файл з TG.");
    return;
  }

  // Завантажуємо у Supabase Storage
  const ext = dl.filename.includes(".") ? dl.filename.slice(dl.filename.lastIndexOf(".")) : "";
  const storagePath = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
  if (progress) await tgEditMessage(chatId, progress.message_id, `📤 Завантажую у бібліотеку (${(dl.size/1024/1024).toFixed(1)} MB)...`);

  const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, dl.buf, {
    contentType: dl.mime, upsert: false,
  });
  if (upErr) {
    if (progress) await tgEditMessage(chatId, progress.message_id, `⚠️ Storage upload fail: ${escHtml(upErr.message)}`);
    return;
  }
  const { data: pub2 } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
  const url = pub2?.publicUrl || "";

  // Створюємо creative запис
  const creativeId = uuidV4();
  const { error: cErr } = await supabase.from("creatives").insert({
    id: creativeId,
    desk_id: "11111111-1111-1111-1111-111111111111",
    name: dl.filename,
    type: dl.type,
    size_bytes: dl.size,
    drive_file_id: storagePath,
    thumbnail_url: url,
    tags: [],
    uploaded_by: me.id,
  });
  if (cErr) {
    if (progress) await tgEditMessage(chatId, progress.message_id, `⚠️ DB insert fail: ${escHtml(cErr.message)}`);
    return;
  }

  // Знаходимо останні 3 draft публікації де я responsible — щоб запропонувати прикріпити
  const { data: drafts } = await supabase
    .from("publication_responsibles")
    .select("publication_id, publications!inner(id, title, status, deleted_at)")
    .eq("user_id", me.id);
  const draftList = (drafts ?? [])
    // @ts-ignore
    .map(r => r.publications as { id: string; title: string; status: string; deleted_at?: string | null })
    .filter(p => p && !p.deleted_at && ["draft", "in_work", "rework"].includes(p.status))
    .slice(0, 3);

  let kb: ReplyMarkup | undefined;
  if (draftList.length > 0) {
    kb = {
      inline_keyboard: draftList.map(p => ([
        { text: `📎 → «${p.title.slice(0, 30)}»`, callback_data: `attach:${creativeId}:${p.id}` }
      ])).concat([[
        { text: "Пропустити", callback_data: `attach:${creativeId}:skip` }
      ]]),
    };
  }

  const sizeMb = (dl.size / 1024 / 1024).toFixed(1);
  const text = `✅ <b>Креатив додано</b>\n` +
    `📁 ${escHtml(dl.filename)} · ${sizeMb} MB\n\n` +
    (draftList.length > 0 ? `Прикріпити до публікації?` : `<i>У тебе нема активних чернеток — креатив додано до бібліотеки.</i>`) +
    `\n\n🔗 <a href="${url}">Переглянути файл</a>`;
  if (progress) await tgEditMessage(chatId, progress.message_id, text, kb);
}

async function handleAttachCallback(supabase: ReturnType<typeof createClient>, cb: TgCallbackQuery, creativeId: string, pubIdOrSkip: string): Promise<void> {
  if (pubIdOrSkip === "skip") {
    await tgAnswerCallback(cb.id, "Пропущено");
    if (cb.message) {
      const txt = (cb.message.text || "").replace(/Прикріпити до публікації\?/, "").trim();
      await tgEditMessage(cb.message.chat.id, cb.message.message_id, txt + "\n\n<i>Креатив у бібліотеці.</i>");
    }
    return;
  }
  const me = await findUser(supabase, cb.from.id);
  if (!me) { await tgAnswerCallback(cb.id, "Спочатку /start", true); return; }

  // Перевіряємо, що user — responsible для цієї публікації
  const { data: resp } = await supabase
    .from("publication_responsibles")
    .select("user_id").eq("publication_id", pubIdOrSkip).eq("user_id", me.id).maybeSingle();
  if (!resp) { await tgAnswerCallback(cb.id, "Ти не відповідальний за цю публікацію", true); return; }

  // Знайти max sort_order для creative_publications цього pub
  const { data: existing } = await supabase
    .from("creative_publications").select("sort_order")
    .eq("publication_id", pubIdOrSkip).order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing && existing[0]?.sort_order != null) ? existing[0].sort_order + 1 : 0;

  const { error: linkErr } = await supabase.from("creative_publications").insert({
    publication_id: pubIdOrSkip, creative_id: creativeId, sort_order: nextOrder,
  });
  if (linkErr) { await tgAnswerCallback(cb.id, `Помилка: ${linkErr.message}`, true); return; }

  await tgAnswerCallback(cb.id, "📎 Прикріплено!");

  // Edit повідомлення
  const { data: pub } = await supabase
    .from("publications").select("title").eq("id", pubIdOrSkip).maybeSingle();
  if (cb.message) {
    const txt = (cb.message.text || "").replace(/Прикріпити до публікації\?/, "").trim();
    await tgEditMessage(cb.message.chat.id, cb.message.message_id,
      txt + `\n\n📎 <b>Прикріплено</b> до «${escHtml(pub?.title || "?")}»\n` +
      `🔗 <a href="${HQ_URL}#publication/${pubIdOrSkip}">Відкрити в HQ</a>`);
  }
}

// =====================================================================
// /today /queue /late /my /me — швидкі довідки
// =====================================================================
async function handleToday(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /today — тільки у DM.", { silent: true }); return; }
  const { startIso, endIso, dateLabel } = todayBoundsKyiv();
  const { data: pubs } = await supabase
    .from("publications").select("id, title, status, publish_at")
    .gte("publish_at", startIso).lte("publish_at", endIso)
    .is("deleted_at", null).order("publish_at", { ascending: true });
  if (!pubs || pubs.length === 0) {
    await tgSend(chatId, `🌿 <b>Сьогодні ${dateLabel}</b> — нічого не заплановано.`);
    return;
  }
  const ids = pubs.map(p => p.id);
  const { data: pp } = await supabase
    .from("publication_platforms").select("publication_id, platform").in("publication_id", ids);
  const byPub: Record<string, string[]> = {};
  (pp ?? []).forEach(r => { (byPub[r.publication_id] ||= []).push(r.platform); });

  const lines = [`📅 <b>Сьогодні ${dateLabel}</b> · ${pubs.length} публікацій\n`];
  for (const p of pubs) {
    const d = new Date(p.publish_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const plats = (byPub[p.id] || []).map(x => PLATFORM_NAMES[x] || x).join("/") || "—";
    lines.push(`${STATUS_EMOJI[p.status] || "•"} <code>${pad(d.getHours())}:${pad(d.getMinutes())}</code> · <a href="${HQ_URL}#publication/${p.id}">${escHtml(p.title)}</a> · ${plats}`);
  }
  await tgSend(chatId, lines.join("\n"));
}

async function handleQueue(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /queue — тільки у DM.", { silent: true }); return; }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку /start"); return; }
  const queue = await getQueueForUser(supabase, me.id);
  if (queue.length === 0) { await tgSend(chatId, "🌿 Черга порожня."); return; }
  const lines = [`✅ <b>Чекає твого погодження</b> · ${queue.length}\n`];
  for (const p of queue) {
    const d = new Date(p.publish_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    lines.push(`👀 <code>${dateStr}</code> · <a href="${HQ_URL}#publication/${p.id}">${escHtml(p.title)}</a>`);
  }
  lines.push(`\n<i>Для швидкого погодження — /approve</i>`);
  await tgSend(chatId, lines.join("\n"));
}

async function handleLate(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /late — тільки у DM.", { silent: true }); return; }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку /start"); return; }
  const nowIso = new Date().toISOString();
  const in48hIso = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
  const { data: missed } = await supabase.from("publications")
    .select("id, title, status, publish_at")
    .lt("publish_at", nowIso).not("status", "in", "(published)").is("deleted_at", null)
    .order("publish_at", { ascending: false }).limit(10);
  const { data: urgent } = await supabase.from("publications")
    .select("id, title, status, publish_at")
    .gte("publish_at", nowIso).lte("publish_at", in48hIso)
    .not("status", "in", "(approved,published)").is("deleted_at", null)
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
  }
  if (lines.length === 0) { await tgSend(chatId, "🌿 Усе під контролем."); return; }
  await tgSend(chatId, lines.join("\n"));
}

async function handleMy(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /my — тільки у DM.", { silent: true }); return; }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку /start"); return; }
  const { data: respList } = await supabase
    .from("publication_responsibles")
    .select("publication_id, publications!inner(id, title, status, publish_at, deleted_at)")
    .eq("user_id", me.id);
  const items = (respList ?? [])
    // @ts-ignore
    .map(r => r.publications)
    .filter(p => p && !p.deleted_at && p.status !== "published")
    .sort((a, b) => new Date(a.publish_at).getTime() - new Date(b.publish_at).getTime())
    .slice(0, 15);
  if (items.length === 0) { await tgSend(chatId, "🌿 У тебе нема активних публікацій."); return; }
  const lines = [`📋 <b>Мої публікації</b> · ${items.length}\n`];
  for (const p of items) {
    const d = new Date(p.publish_at);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    lines.push(`${STATUS_EMOJI[p.status] || "•"} <code>${dateStr}</code> · <a href="${HQ_URL}#publication/${p.id}">${escHtml(p.title)}</a> · ${STATUS_LABEL[p.status]}`);
  }
  await tgSend(chatId, lines.join("\n"));
}

async function handleMe(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /me — тільки у DM.", { silent: true }); return; }
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку /start"); return; }
  const nowIso = new Date().toISOString();
  const { startIso, endIso, dateLabel } = todayBoundsKyiv();
  const { count: todayCount } = await supabase
    .from("publications").select("id", { count: "exact", head: true })
    .gte("publish_at", startIso).lte("publish_at", endIso).is("deleted_at", null);
  const { data: apprList } = await supabase
    .from("publication_approvers").select("publication_id, publications!inner(status, deleted_at)").eq("user_id", me.id);
  // @ts-ignore
  const queueCount = (apprList ?? []).filter(r => r.publications?.status === "review" && !r.publications?.deleted_at).length;
  const { data: respList } = await supabase
    .from("publication_responsibles").select("publication_id, publications!inner(status, deleted_at)").eq("user_id", me.id);
  // @ts-ignore
  const myCount = (respList ?? []).filter(r => r.publications && !r.publications.deleted_at && r.publications.status !== "published").length;
  const { count: missedCount } = await supabase
    .from("publications").select("id", { count: "exact", head: true })
    .lt("publish_at", nowIso).not("status", "in", "(published)").is("deleted_at", null);
  const lines = [
    `👤 <b>${escHtml(me.name || "")}</b> · ${escHtml(me.role || "")}\n`,
    `📅 Сьогодні (${dateLabel}): <b>${todayCount ?? 0}</b> → /today`,
    `✅ Чекає погодження: <b>${queueCount}</b> → /queue${queueCount > 0 ? " або /approve" : ""}`,
    `📋 Твої активні: <b>${myCount}</b> → /my`,
    `⚠️ Пропущених загалом: <b>${missedCount ?? 0}</b> → /late`,
    ``,
    `🔗 <a href="${HQ_URL}">Відкрити HQ</a>`,
  ];
  await tgSend(chatId, lines.join("\n"));
}

// =====================================================================
// /start /help /whoami /unbind /diag
// =====================================================================
async function handleStart(supabase: ReturnType<typeof createClient>, chatId: number, tgUser: { username?: string; first_name?: string; last_name?: string }, payload: string, isGroup: boolean): Promise<void> {
  const m = payload.match(/^hq_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  if (!m) {
    if (isGroup) {
      await tgSend(chatId, `👋 Я бот DreamCar HQ. Шлю сповіщення.\n\nКоманди у DM: <a href="https://t.me/dreamcar_team_bot">@dreamcar_team_bot</a>`, { silent: true });
      return;
    }
    await tgSend(chatId,
      `👋 Привіт${tgUser.first_name ? ", " + escHtml(tgUser.first_name) : ""}!\n\n` +
      `🆔 chat_id: <code>${chatId}</code>\n` +
      (tgUser.username ? `📛 @${escHtml(tgUser.username)}\n\n` : "\n") +
      `Команди: /me /today /queue /approve /late /my /help`
    );
    return;
  }
  if (isGroup) {
    await tgSend(chatId, `🔒 Привʼязка тільки приватно. <a href="https://t.me/dreamcar_team_bot?start=hq_${m[1]}">Напиши боту</a>.`, { silent: true });
    return;
  }
  const userId = m[1].toLowerCase();
  const { data: user, error } = await supabase
    .from("users").select("id, name, email, tg_chat_id").eq("id", userId).maybeSingle();
  if (error) { await tgSend(chatId, `⚠️ ${escHtml(error.message)}`); return; }
  if (!user) { await tgSend(chatId, `⚠️ User not found.`); return; }
  if (user.tg_chat_id && user.tg_chat_id !== chatId) {
    await tgSend(chatId, `⚠️ Уже прив'язаний (chat_id ${user.tg_chat_id}). /unbind у старому чаті.`);
    return;
  }
  const { error: upErr } = await supabase
    .from("users").update({ tg_chat_id: chatId, tg_username: tgUser.username ?? null }).eq("id", userId);
  if (upErr) { await tgSend(chatId, `⚠️ ${escHtml(upErr.message)}`); return; }
  await tgSend(chatId,
    `✅ <b>Привʼязано!</b>\nАкаунт: <b>${escHtml(user.name || user.email || "")}</b>\n\n` +
    `Команди: /me /today /queue /approve /late /my\n\n` +
    `🔗 <a href="${HQ_URL}">HQ</a>`
  );
}

async function handleDiag(chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, `🔒 /diag — у DM.`, { silent: true }); return; }
  await tgSend(chatId,
    `🔧 Diag\nURL: ${SUPABASE_URL ? "✅" : "❌"} · Key: ${KEY_SOURCE} (role=${jwtRole(SERVICE_ROLE_KEY)})\nchat_id: <code>${chatId}</code>`
  );
}

async function handleUnbind(supabase: ReturnType<typeof createClient>, chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, `🔒 /unbind — у DM.`, { silent: true }); return; }
  const { data: user } = await supabase.from("users").select("id, name, email").eq("tg_chat_id", chatId).maybeSingle();
  if (!user) { await tgSend(chatId, "ℹ️ Немає прив'язки."); return; }
  await supabase.from("users").update({ tg_chat_id: null, tg_username: null }).eq("id", user.id);
  await tgSend(chatId, `🔌 Прив'язку видалено для <b>${escHtml(user.name || user.email || "")}</b>.`);
}

async function handleWhoami(supabase: ReturnType<typeof createClient>, chatId: number, tgUser: { username?: string }, isGroup: boolean): Promise<void> {
  if (isGroup) { await tgSend(chatId, `🔒 /whoami — у DM.`, { silent: true }); return; }
  const { data: user } = await supabase.from("users").select("id, name, email, role").eq("tg_chat_id", chatId).maybeSingle();
  if (!user) {
    await tgSend(chatId, `🚫 Не привʼязаний.\n🆔 <code>${chatId}</code>${tgUser.username ? "\n📛 @" + escHtml(tgUser.username) : ""}`);
    return;
  }
  await tgSend(chatId, `🪪 <b>${escHtml(user.name || "—")}</b>\nEmail: ${escHtml(user.email || "—")}\nРоль: ${escHtml(user.role || "—")}`);
}

async function handleHelp(chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) {
    await tgSend(chatId, `🤖 Я шлю сповіщення з кнопками ✓ / ↩. Команди — у DM: <a href="https://t.me/dreamcar_team_bot">@dreamcar_team_bot</a>`, { silent: true });
    return;
  }
  await tgSend(chatId,
    `🤖 <b>DreamCar HQ bot</b>\n\n` +
    `<b>Швидкі довідки:</b>\n` +
    `/me — мій зведений дайджест\n` +
    `/today — публікації сьогодні\n` +
    `/queue — на моє погодження\n` +
    `/approve — швидке погодження черги ⚡\n` +
    `/late — пропущені / горить\n` +
    `/my — мої заплановані\n\n` +
    `<b>Файли:</b>\nПросто перешли фото/відео/PDF — я додам у бібліотеку 📎\n\n` +
    `<b>Профіль:</b>\n` +
    `/whoami /unbind /diag /help`
  );
}

// =====================================================================
// CALLBACK QUERY (диспетчер)
// =====================================================================
async function handleCallback(supabase: ReturnType<typeof createClient>, cb: TgCallbackQuery): Promise<void> {
  const data = (cb.data || "").trim();
  const msg = cb.message;
  if (!data || !msg) { await tgAnswerCallback(cb.id, "Помилка"); return; }

  const parts = data.split(":");
  const action = parts[0];

  // qappr:<pubId>:y|n|s — /approve flow
  if (action === "qappr") {
    await handleQueueCallback(supabase, cb, parts[1], parts[2]);
    return;
  }
  // attach:<creativeId>:<pubId|skip>
  if (action === "attach") {
    await handleAttachCallback(supabase, cb, parts[1], parts[2]);
    return;
  }
  // appr:<pubId>:y|n — звичайна нотифікація
  if (action === "appr") {
    const pubId = parts[1]; const decision = parts[2];
    const me = await findUser(supabase, cb.from.id);
    if (!me) { await tgAnswerCallback(cb.id, "Спочатку /start у DM", true); return; }
    const { data: appr } = await supabase
      .from("publication_approvers").select("user_id").eq("publication_id", pubId).eq("user_id", me.id).maybeSingle();
    if (!appr) { await tgAnswerCallback(cb.id, "Ти не у списку погоджувачів", true); return; }
    const { data: pub } = await supabase
      .from("publications").select("id, title, status").eq("id", pubId).maybeSingle();
    if (!pub) { await tgAnswerCallback(cb.id, "Не знайдено", true); return; }
    if (pub.status !== "review") {
      await tgAnswerCallback(cb.id, `Статус: ${pub.status}`, true);
      if (msg.text) await tgEditMessage(msg.chat.id, msg.message_id, msg.text + `\n\n<i>⚠️ Статус: ${pub.status}</i>`);
      return;
    }
    const newStatus = decision === "y" ? "approved" : "rework";
    const { error: updErr } = await supabase
      .from("publications").update({ status: newStatus, updated_at: new Date().toISOString(), last_action_via: "tg" }).eq("id", pubId);
    if (updErr) { await tgAnswerCallback(cb.id, `Помилка: ${updErr.message}`, true); return; }
    await supabase.from("publication_history").insert({
      publication_id: pubId, actor_id: me.id,
      action: decision === "y" ? "approve" : "reject",
      detail: decision === "y" ? "✓ через TG-кнопку" : "↩️ через TG-кнопку",
    });
    const decisionLabel = decision === "y" ? "✅ <b>Погоджено</b>" : "↩️ <b>Повернуто</b>";
    const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
    await tgEditMessage(msg.chat.id, msg.message_id,
      (msg.text || "") + `\n\n${decisionLabel} · ${escHtml(me.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())}`);
    await tgAnswerCallback(cb.id, decision === "y" ? "✅ Погоджено!" : "↩️ Повернуто");
    return;
  }

  // open — legacy
  if (action === "open") {
    await tgAnswerCallback(cb.id, "Відкрий: " + HQ_URL + "#publication/" + parts[1]);
    return;
  }

  await tgAnswerCallback(cb.id, "Невідома дія");
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
    if (!msg) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const chatId = msg.chat.id;
    const chatType = msg.chat.type || "private";
    const isGroup = chatType !== "private";
    const tgUser = msg.from || {};

    // Файл? (photo/video/document)
    if (!isGroup && (msg.photo || msg.video || msg.document)) {
      await handleFileMessage(supabase, msg, isGroup);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // Текст?
    if (!msg.text) return new Response(JSON.stringify({ ok: true, ignored: "non-text" }), { status: 200, headers: { "Content-Type": "application/json" } });

    const { cmd, payload } = parseCommand(msg.text);
    if (isGroup && !cmd) {
      return new Response(JSON.stringify({ ok: true, ignored: "non-command-in-group" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (cmd === "/diag") await handleDiag(chatId, isGroup);
    else if (cmd === "/start") await handleStart(supabase, chatId, tgUser, payload, isGroup);
    else if (cmd === "/unbind") await handleUnbind(supabase, chatId, isGroup);
    else if (cmd === "/whoami") await handleWhoami(supabase, chatId, tgUser, isGroup);
    else if (cmd === "/help") await handleHelp(chatId, isGroup);
    else if (cmd === "/me") await handleMe(supabase, chatId, isGroup);
    else if (cmd === "/today") await handleToday(supabase, chatId, isGroup);
    else if (cmd === "/queue") await handleQueue(supabase, chatId, isGroup);
    else if (cmd === "/late") await handleLate(supabase, chatId, isGroup);
    else if (cmd === "/my") await handleMy(supabase, chatId, isGroup);
    else if (cmd === "/approve") await handleApprove(supabase, chatId, isGroup);
    else if (cmd && !isGroup) await tgSend(chatId, "ℹ️ Не зрозумів. /help");

  } catch (e) {
    console.error("handler error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});
