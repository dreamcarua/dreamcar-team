// retention-bot-broadcast — нативна DM-розсилка підписникам бота (Vira 29.07.2026).
// DM-ONLY: dm_broadcast завжди шле лише індивідуальним chat_id. Групи/канали — НІКОЛИ.
//
// Токен: PUBLIC_BOT_TOKEN (прод, бот учасників) → fallback TG_BOT_TOKEN/BOT_TOKEN (тест, командний бот).
// Аудиторія: bot_subscribers (прод) або users.tg_chat_id (?source=team — тест на команді).
//
// Params:
//   ?id=<retention_message_id>       контент (обов'язково крім чистого dry-list)
//   ?source=team|subscribers         аудиторія (default subscribers)
//   ?dry=1                           план БЕЗ відправки (DEFAULT якщо нема ?confirm=1)
//   ?test=<chat_id>                  надіслати ОДНЕ повідомлення на конкретний chat_id
//   ?limit=<n>                       обмежити аудиторію (тест)
//   ?source=chats&chats=<id>,<id>    внутрішній тест: реальна відправка на явний список (≤5 chat_id)
//                                    із записом sent_at/sent_count/failed_count у картку
//   ?confirm=1  (+ x-hq-cron-secret) РЕАЛЬНА масова відправка
//   ?action=edit|delete&id=..        11.11.2026: змінити / видалити ВЖЕ надіслане (за журналом retention_deliveries).
//                                    edit — текст, підпис і кнопки за поточною карткою (медіа не міняється);
//                                    delete — прибрати повідомлення в отримувачів (Telegram: лише до 48 год після відправки).
//                                    Без ?confirm=1 — план (скільки отримувачів, скільки старші за 48 год).
//                                    Порціями: &batch=3000 (default), відповідь має next_after → наступний виклик з &after=.
//
// Реальна масова відправка можлива ЛИШЕ з ?confirm=1 + секретом. Інакше — dry-run.
// file_id-кеш: медіа завантажується 1 раз, далі reuse file_id (швидка розсилка на 10k+).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = Deno.env.get("PUBLIC_BOT_TOKEN") || Deno.env.get("TG_BOT_TOKEN") || Deno.env.get("BOT_TOKEN") || "";
const CRON = Deno.env.get("DC_CRON_SECRET") ?? Deno.env.get("HQ_CRON_SECRET") ?? "";
const MAX_URL = 20 * 1024 * 1024, MAX_TG = 50 * 1024 * 1024;
const RATE_MS = 45; // ~22 msg/s (нижче TG-ліміту 30/s)

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const esc = (s: string) => (s || "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Part = { id: number; role: "text" | "caption" | "album" | "kb" | "vnote" };
type Item = { type: "photo" | "video"; url: string; size: number; width?: number; height?: number; duration?: number; poster?: string | null; file_id?: string };

async function headSize(url: string): Promise<number> {
  try { const r = await fetch(url, { method: "HEAD" }); return parseInt(r.headers.get("content-length") || "0", 10) || 0; } catch { return 0; }
}
function pickUrl(c: any): string | null {
  return c.compressed_url || c.compressed_url_hevc || c.poster_url || c.thumbnail_url || null;
}
// Обрізати HTML безпечно: не рвати тег посередині + закрити відкриті теги.
// Інакше Telegram відхиляє повідомлення ("can't parse entities").
function trimHtml(s: string, max: number): string {
  if (!s || s.length <= max) return s || "";
  let cut = s.slice(0, max);
  const lastOpen = cut.lastIndexOf("<"), lastClose = cut.lastIndexOf(">");
  if (lastOpen > lastClose) cut = cut.slice(0, lastOpen);
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z-]+)[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cut)) !== null) {
    const tag = m[2].toLowerCase();
    if (m[1] === "/") { const i = stack.lastIndexOf(tag); if (i >= 0) stack.splice(i, 1); }
    else stack.push(tag);
  }
  while (stack.length) cut += `</${stack.pop()}>`;
  return cut;
}
// Довжина видимого тексту (без тегів) — Telegram рахує саме її
const plainLen = (s: string) => (s || "").replace(/<[^>]+>/g, "").length;

// Нормалізація кнопок → inline_keyboard. Приймає [[{text,url}]] або [{text,url}].
function toKeyboard(btns: any): any | undefined {
  if (!Array.isArray(btns) || !btns.length) return undefined;
  const rows = Array.isArray(btns[0]) ? btns : btns.map((b: any) => [b]);
  // Bot API 9.4: style = primary | success | danger (колір кнопки). Без style — нейтральна.
  const OK_STYLES = new Set(["primary", "success", "danger"]);
  const inline = rows
    .map((r: any[]) => r.map((b: any) => {
      const btn: any = { text: b.text || b.label || "↗", url: b.url || b.link };
      if (b.style && OK_STYLES.has(String(b.style))) btn.style = String(b.style);
      return btn;
    }).filter((b: any) => b.url))
    .filter((r: any[]) => r.length);
  return inline.length ? { inline_keyboard: inline } : undefined;
}

async function tgCall(method: string, body: any): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.ok) return j;
    if (j.error_code === 429) { const wait = (j.parameters?.retry_after || 2) * 1000; await sleep(wait + 200); continue; }
    return j; // інша помилка — повертаємо як є
  }
  return { ok: false, description: "429 retries exhausted" };
}

// Завантажити media multipart (коли >20МБ або немає file_id) — 1 раз, повертає file_id.
// thumbUrl: постер відео; Telegram приймає thumbnail у multipart лише як окремий файл (attach://), JPEG ≤200 КБ.
async function tgUpload(method: string, chatId: string, field: string, url: string, extra: Record<string, string> = {}, thumbUrl?: string | null): Promise<any> {
  const resp = await fetch(url); if (!resp.ok) return { ok: false, description: `download ${resp.status}` };
  const blob = await resp.blob();
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append(field, blob, field === "photo" ? "p.jpg" : field === "video_note" ? "vn.mp4" : "v.mp4");
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  if (thumbUrl) {
    try {
      const tr = await fetch(thumbUrl);
      if (tr.ok) { const tb = await tr.blob(); if (tb.size > 0 && tb.size <= 200 * 1024) { form.append("thumb", tb, "thumb.jpg"); form.append("thumbnail", "attach://thumb"); } }
    } catch (_) { /* без постера — не критично */ }
  }
  const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: "POST", body: form });
  return await r.json();
}

async function buildItems(msgId: string): Promise<Item[]> {
  const { data: cr } = await sb.from("creative_retention_messages").select("creative_id, sort_order").eq("retention_message_id", msgId).order("sort_order", { ascending: true });
  const ids = (cr || []).map((r: any) => r.creative_id);
  if (!ids.length) return [];
  const { data } = await sb.from("creatives").select("id, type, compressed_url, compressed_url_hevc, poster_url, thumbnail_url, width_px, height_px, duration_sec, compressed_size_bytes").in("id", ids);
  const order = new Map(ids.map((id: string, i: number) => [id, i]));
  const sorted = (data || []).slice().sort((a: any, b: any) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const items: Item[] = [];
  for (const c of sorted) {
    const url = pickUrl(c); if (!url) continue;
    const isVideo = String(c.type || "").toLowerCase() === "video";
    const size = c.compressed_size_bytes || await headSize(url);
    items.push({ type: isVideo ? "video" : "photo", url, size, width: c.width_px || undefined, height: c.height_px || undefined, duration: c.duration_sec || undefined, poster: isVideo ? (c.poster_url || null) : null });
  }
  return items;
}
async function getVideoNote(creativeId: string | null): Promise<Item | null> {
  if (!creativeId) return null;
  const { data } = await sb.from("creatives").select("id, compressed_url, compressed_url_hevc, poster_url, thumbnail_url, compressed_size_bytes").eq("id", creativeId).maybeSingle();
  if (!data) return null;
  const url = pickUrl(data); if (!url) return null;
  return { type: "video", url, size: data.compressed_size_bytes || await headSize(url) };
}

// Відправка ОДНОМУ chat_id. cache — спільний file_id-кеш для всієї розсилки.
async function sendToChat(chatId: string, caption: string, items: Item[], vnote: Item | null, kb: any, cache: Record<string, string>): Promise<{ ok: boolean; err?: string; mid?: number; parts: Part[] }> {
  const parts: Part[] = [];
  // 1) відеозамітка (кружечок) — окремо, без підпису/кнопок
  if (vnote) {
    let jv: any = null;
    if (cache.vnote) { jv = await tgCall("sendVideoNote", { chat_id: chatId, video_note: cache.vnote, disable_notification: true }); }
    else if (vnote.size > 0 && vnote.size <= MAX_URL) {
      jv = await tgCall("sendVideoNote", { chat_id: chatId, video_note: vnote.url, disable_notification: true });
      if (jv.ok && jv.result?.video_note?.file_id) cache.vnote = jv.result.video_note.file_id;
    } else if (vnote.size <= MAX_TG) {
      jv = await tgUpload("sendVideoNote", chatId, "video_note", vnote.url, { disable_notification: "true" });
      if (jv.ok && jv.result?.video_note?.file_id) cache.vnote = jv.result.video_note.file_id;
    }
    if (jv?.ok && jv.result?.message_id) parts.push({ id: jv.result.message_id, role: "vnote" });
  }

  // Якщо текст не влазить у caption (1024 видимих) — медіа без підпису,
  // а повний текст (до 4096) окремим повідомленням: нічого не губиться.
  // Vira 30.07: ЗАВЖДИ одне повідомлення — текст іде описом до медіа, ніколи не ділиться.
  // Якщо текст не влазить у підпис (1024) і медіа одне ФОТО — шлемо як текст (до 4096)
  // з великим прев'ю картинки зверху: візуально те саме, один меседж, текст не втрачається.
  const longText = items.length > 0 && plainLen(caption) > 1024;
  const singlePhoto = items.length === 1 && items[0].type === "photo";
  const useLinkPreview = longText && singlePhoto;
  const cap = trimHtml(caption, 1024);
  // 2) без медіа → текст (+кнопки). Ліміт тексту 4096.
  if (items.length === 0) {
    const txt = trimHtml(caption, 4096);
    if (!txt && !kb) return { ok: true, parts }; // лише відеозамітка була
    const j = await tgCall("sendMessage", { chat_id: chatId, text: txt || " ", parse_mode: "HTML", disable_web_page_preview: true, ...(kb ? { reply_markup: kb } : {}), disable_notification: true });
    if (j.ok) parts.push({ id: j.result?.message_id, role: "text" });
    return j.ok ? { ok: true, mid: j.result?.message_id, parts } : { ok: false, err: j.description, parts };
  }
  // 3) одне медіа → sendPhoto/Video з підписом+кнопками (ОДНЕ повідомлення)
  if (items.length === 1) {
    const it = items[0];
    // довгий текст + фото → текст із великим прев'ю картинки зверху (один меседж, до 4096)
    if (useLinkPreview) {
      const j = await tgCall("sendMessage", {
        chat_id: chatId, text: trimHtml(caption, 4096), parse_mode: "HTML", disable_notification: true,
        link_preview_options: { url: it.url, prefer_large_media: true, show_above_text: true },
        ...(kb ? { reply_markup: kb } : {}),
      });
      if (j.ok) { parts.push({ id: j.result?.message_id, role: "text" }); return { ok: true, mid: j.result?.message_id, parts }; }
      // якщо прев'ю не спрацювало — звичайний шлях із підписом
    }
    const method = it.type === "video" ? "sendVideo" : "sendPhoto"; const field = it.type;
    const ck = `m0_${it.type}`;
    let j: any;
    if (cache[ck]) {
      const body: any = { chat_id: chatId, [field]: cache[ck], caption: cap, parse_mode: "HTML", disable_notification: true, ...(kb ? { reply_markup: kb } : {}) };
      if (it.type === "video") body.supports_streaming = true;
      j = await tgCall(method, body);
    } else if (it.size > 0 && it.size <= (it.type === "photo" ? 5 * 1024 * 1024 : MAX_URL)) {
      const body: any = { chat_id: chatId, [field]: it.url, caption: cap, parse_mode: "HTML", disable_notification: true, ...(kb ? { reply_markup: kb } : {}) };
      if (it.type === "video") { body.supports_streaming = true; if (it.width) body.width = it.width; if (it.height) body.height = it.height; if (it.duration) body.duration = it.duration; if (it.poster) body.thumbnail = it.poster; }
      j = await tgCall(method, body);
    } else {
      const vx: Record<string, string> = {};
      if (it.type === "video") { vx.supports_streaming = "true"; if (it.width) vx.width = String(it.width); if (it.height) vx.height = String(it.height); if (it.duration) vx.duration = String(Math.round(it.duration)); }
      j = await tgUpload(method, chatId, field, it.url, { caption: cap, parse_mode: "HTML", disable_notification: "true", ...vx, ...(kb ? { reply_markup: JSON.stringify(kb) } : {}) }, it.type === "video" ? it.poster : null);
    }
    if (j.ok) {
      const fid = (j.result?.photo?.slice(-1)[0]?.file_id) || j.result?.video?.file_id;
      if (fid && !cache[ck]) cache[ck] = fid;
      parts.push({ id: j.result?.message_id, role: "caption" });
      return { ok: true, mid: j.result?.message_id, parts };
    }
    return { ok: false, err: j.description, parts };
  }
  // 4) медіагрупа (album) — підпис ЗАВЖДИ на першому елементі (текст як опис до альбому).
  // Telegram API не дозволяє reply_markup в медіагрупі: якщо є кнопки, вони йдуть
  // окремим коротким повідомленням (обмеження платформи, не наш вибір).
  const media = items.slice(0, 10).map((m, i) => {
    const o: any = { type: m.type, media: cache[`a${i}`] || m.url };
    if (i === 0) { o.caption = cap; o.parse_mode = "HTML"; }
    if (m.type === "video") { o.supports_streaming = true; if (m.width) o.width = m.width; if (m.height) o.height = m.height; if (m.duration) o.duration = m.duration; }
    return o;
  });
  const jg = await tgCall("sendMediaGroup", { chat_id: chatId, media, disable_notification: true });
  if (jg.ok && Array.isArray(jg.result)) {
    jg.result.forEach((r: any, i: number) => {
      const fid = r.photo?.slice(-1)[0]?.file_id || r.video?.file_id; if (fid && !cache[`a${i}`]) cache[`a${i}`] = fid;
      if (r.message_id) parts.push({ id: r.message_id, role: i === 0 ? "caption" : "album" });
    });
  }
  if (jg.ok && kb) {
    const jk = await tgCall("sendMessage", { chat_id: chatId, text: "👇", parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb, disable_notification: true });
    if (jk.ok && jk.result?.message_id) parts.push({ id: jk.result.message_id, role: "kb" });
  }
  return jg.ok ? { ok: true, mid: jg.result?.[0]?.message_id, parts } : { ok: false, err: jg.description, parts };
}

async function resolveAudience(msg: any, source: string, limit: number, chats: string[] = []): Promise<{ chat_id: string; sub_id?: string }[]> {
  if (source === "chats") return chats.map(c => ({ chat_id: c }));
  if (source === "team") {
    const { data } = await sb.from("users").select("id, tg_chat_id").not("tg_chat_id", "is", null);
    const rows = (data || []).map((u: any) => ({ chat_id: String(u.tg_chat_id) }));
    return limit ? rows.slice(0, limit) : rows;
  }
  // subscribers + сегмент. PostgREST ріже на 1000 рядків → пагінуємо через .range().
  const f = msg?.audience_filter || {};
  const out: { chat_id: string; sub_id?: string }[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = sb.from("bot_subscribers").select("id, chat_id").eq("is_active", true).order("id", { ascending: true }).range(from, from + page - 1);
    if (f.tariff) q = q.eq("tariff", f.tariff);
    if (f.user_status) q = q.eq("user_status", f.user_status);
    const { data, error } = await q;
    if (error || !data?.length) break;
    for (const s of data) out.push({ chat_id: String(s.chat_id), sub_id: s.id });
    if (limit && out.length >= limit) return out.slice(0, limit);
    if (data.length < page) break;
  }
  return out;
}

// ======================================================================
// 11.11.2026 · Правка / видалення ВЖЕ надісланого (запит Віри). Факти Bot API (core.telegram.org/bots/api):
//  • deleteMessage(s): лише повідомлення, молодші за 48 год; бот може видаляти свої у приватних чатах;
//    deleteMessages — до 100 id за раз, відсутні пропускає.
//  • editMessageText/Caption/ReplyMarkup/Media: для власних повідомлень бота обмеження часу немає
//    (48 год — лише для business-повідомлень). editMessageMedia може замінити текст на медіа;
//    у альбомі фото/відео міняються лише на фото/відео.
//  • URL-файли: фото ≤5 МБ, інше ≤20 МБ; multipart — фото ≤10 МБ, інше ≤50 МБ. Ліміт розсилки ~30 повідомлень/с.
// Операції — у retention_sent_ops (черга з прогресом, оренда heartbeat, самопродовження, pg_cron-страховка).
// ======================================================================
const notModified = (j: any) => /not modified/i.test(String(j?.description || ""));
const H48 = 48 * 3600 * 1000;
const BUDGET_MS = 100_000;           // один виклик працює ~100 с, далі передає естафету собі ж
const PAGE = 300;
const urlLimit = (it: Item) => it.type === "photo" ? 5 * 1024 * 1024 : MAX_URL;
const EMPTY_KB = { inline_keyboard: [] };
const blobCache = new Map<string, Blob>();

// Медіа для editMessageMedia: file_id з кешу → URL (у межах лімітів) → multipart attach://f
async function inputMedia(it: Item, idx: number, cache: Record<string, string>, extra: any): Promise<{ media: any; file?: Blob }> {
  const base: any = { type: it.type, ...extra };
  if (it.type === "video") { base.supports_streaming = true; if (it.width) base.width = it.width; if (it.height) base.height = it.height; if (it.duration) base.duration = it.duration; }
  const fid = cache[`em${idx}`];
  if (fid) return { media: { ...base, media: fid } };
  if (it.size > 0 && it.size <= urlLimit(it)) return { media: { ...base, media: it.url } };
  let blob = blobCache.get(it.url);
  if (!blob) { const r = await fetch(it.url); if (!r.ok) throw new Error(`download ${r.status}`); blob = await r.blob(); blobCache.set(it.url, blob); }
  return { media: { ...base, media: "attach://f" }, file: blob };
}
async function editMedia(chatId: string, messageId: number, it: Item, idx: number, cache: Record<string, string>, extra: any, replyMarkup?: any): Promise<any> {
  const { media, file } = await inputMedia(it, idx, cache, extra);
  let j: any;
  if (file) {
    const form = new FormData();
    form.append("chat_id", chatId); form.append("message_id", String(messageId));
    form.append("media", JSON.stringify(media));
    form.append("f", file, it.type === "photo" ? "p.jpg" : "v.mp4");
    if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
    for (let a = 0; a < 3; a++) {
      j = await (await fetch(`https://api.telegram.org/bot${TG}/editMessageMedia`, { method: "POST", body: form })).json();
      if (j.error_code === 429) { await sleep(((j.parameters?.retry_after || 2) * 1000) + 200); continue; }
      break;
    }
  } else {
    j = await tgCall("editMessageMedia", { chat_id: chatId, message_id: messageId, media, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  }
  if (j?.ok) {
    const fid = j.result?.photo?.slice(-1)[0]?.file_id || j.result?.video?.file_id;
    if (fid) cache[`em${idx}`] = fid;
  }
  return j;
}

type Ctx = { caption: string; items: Item[]; kb: any; mediaChanged: boolean; cache: Record<string, string>; warn: Set<string> };

// Одна доставка → правка. Повертає "" або текст помилки.
async function editDelivery(chatId: string, parts: Part[], c: Ctx): Promise<string> {
  const cap = trimHtml(c.caption, 1024);
  const longText = c.items.length > 0 && plainLen(c.caption) > 1024;
  const singlePhoto = c.items.length === 1 && c.items[0].type === "photo";
  const album = parts.filter((p) => p.role === "caption" || p.role === "album");
  const isAlbum = parts.some((p) => p.role === "album");
  const rm = c.kb || EMPTY_KB;
  const calls: (() => Promise<any>)[] = [];

  for (const p of parts) {
    if (p.role === "text") {
      if (c.items.length === 1 && !(longText && singlePhoto)) {
        // було текстом, тепер є одне медіа → editMessageMedia замінює текст на медіа
        calls.push(() => editMedia(chatId, p.id, c.items[0], 0, c.cache, { caption: cap, parse_mode: "HTML" }, rm));
      } else {
        if (c.items.length > 1) c.warn.add("Надіслано текстом — альбом додати неможливо, оновлено лише текст і кнопки");
        calls.push(() => tgCall("editMessageText", {
          chat_id: chatId, message_id: p.id, text: trimHtml(c.caption, 4096) || " ", parse_mode: "HTML",
          link_preview_options: longText && singlePhoto ? { url: c.items[0].url, prefer_large_media: true, show_above_text: true } : { is_disabled: true },
          reply_markup: rm,
        }));
      }
    } else if (p.role === "caption" && !isAlbum) {
      if (c.mediaChanged && c.items.length === 1) {
        calls.push(() => editMedia(chatId, p.id, c.items[0], 0, c.cache, { caption: cap, parse_mode: "HTML" }, rm));
      } else {
        if (c.mediaChanged) c.warn.add("Кількість медіа змінилась — Telegram не дозволяє, оновлено лише підпис і кнопки");
        calls.push(() => tgCall("editMessageCaption", { chat_id: chatId, message_id: p.id, caption: cap, parse_mode: "HTML", reply_markup: rm }));
      }
    } else if (p.role === "kb") {
      calls.push(() => tgCall("editMessageReplyMarkup", { chat_id: chatId, message_id: p.id, reply_markup: rm }));
    }
  }
  if (isAlbum) {
    const sameCount = c.items.length === album.length && c.items.every((i) => i.type === "photo" || i.type === "video");
    if (c.mediaChanged && sameCount) {
      album.forEach((p, i) => calls.push(() => editMedia(chatId, p.id, c.items[i], i, c.cache, i === 0 ? { caption: cap, parse_mode: "HTML" } : {})));
    } else {
      if (c.mediaChanged) c.warn.add("Кількість медіа в альбомі змінилась — Telegram не дозволяє, оновлено лише підпис і кнопки");
      const first = album.find((p) => p.role === "caption");
      if (first) calls.push(() => tgCall("editMessageCaption", { chat_id: chatId, message_id: first.id, caption: cap, parse_mode: "HTML" }));
    }
    if (c.kb && !parts.some((p) => p.role === "kb")) c.warn.add("Кнопки додано після відправки альбому — Telegram не дозволяє кнопки в альбомі без окремого повідомлення");
  }
  let err = "";
  for (const call of calls) {
    const j = await call();
    if (!j?.ok && !notModified(j)) err = String(j?.description || "edit failed");
    await sleep(RATE_MS);
  }
  return err;
}

async function loadContent(msg: any) {
  const caption = [msg.title ? (String(msg.title).startsWith("<") ? msg.title : `<b>${esc(msg.title)}</b>`) : "", msg.preview_text || msg.body || ""].filter(Boolean).join("\n\n");
  const items = await buildItems(msg.id);
  const vnote = await getVideoNote(msg.video_note_creative_id);
  const kb = toKeyboard(msg.tg_buttons);
  return { caption, items, vnote, kb };
}
const mediaSig = (items: Item[]) => items.map((i) => ({ type: i.type, url: i.url }));

async function opUpdate(id: number, patch: any) {
  await sb.from("retention_sent_ops").update(patch).eq("id", id);
}
function kickSelf(opId: number) {
  const p = fetch(`${SB_URL}/functions/v1/retention-bot-broadcast?op=${opId}`, {
    method: "POST", headers: { "content-type": "application/json", "x-hq-cron-secret": CRON }, body: "{}",
  }).catch(() => {});
  // @ts-ignore EdgeRuntime є в Supabase Edge
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
}

async function handleOp(opId: number): Promise<Response> {
  const J = (b: any, status = 200) => new Response(JSON.stringify(b, null, 2), { status, headers: { "content-type": "application/json" } });
  const { data: leased } = await sb.rpc("retention_sent_op_lease", { p_op_id: opId });
  if (!leased) return J({ ok: true, skipped: "not leased (busy, done or cancelled)" });
  const { data: op } = await sb.from("retention_sent_ops").select("*").eq("id", opId).maybeSingle();
  if (!op) return J({ ok: false, error: "op not found" }, 404);
  const { data: msg } = await sb.from("retention_messages").select("*").eq("id", op.retention_message_id).maybeSingle();
  if (!msg) { await opUpdate(opId, { status: "failed", finished_at: new Date().toISOString(), note: "картку не знайдено" }); return J({ ok: false }); }
  const t0 = Date.now();
  const { caption, items, vnote, kb } = await loadContent(msg);
  const errors: Record<string, number> = { ...(op.errors || {}) };
  const bump = (e: string) => { const k = e.slice(0, 90); errors[k] = (errors[k] || 0) + 1; };
  const history = (action: string, detail: string) =>
    sb.from("retention_message_history").insert({ message_id: msg.id, action, detail, actor_id: op.requested_by });

  // --- тест на собі: поточна версія картки → у свій чат, нічого не записуємо в доставки ---
  if (op.action === "preview") {
    const { data: u } = await sb.from("users").select("tg_chat_id").eq("id", op.requested_by).maybeSingle();
    const chat = u?.tg_chat_id ? String(u.tg_chat_id) : "";
    const res = chat ? await sendToChat(chat, caption, items, vnote, kb, {}) : { ok: false, err: "немає tg_chat_id", parts: [] };
    await opUpdate(opId, { status: res.ok ? "done" : "failed", finished_at: new Date().toISOString(), done_ok: res.ok ? 1 : 0, failed: res.ok ? 0 : 1,
      note: res.ok ? null : String(res.err || "").slice(0, 200) });
    await history(res.ok ? "tg_preview_sent" : "tg_preview_failed", res.ok ? "поточна версія — у Telegram автора запиту" : String(res.err || ""));
    return J({ ok: res.ok });
  }

  const sentSig = Array.isArray(msg.sent_media) ? JSON.stringify(msg.sent_media) : null;
  const ctx: Ctx = { caption, items, kb, cache: {}, warn: new Set(),
    mediaChanged: sentSig !== null && sentSig !== JSON.stringify(mediaSig(items)) };
  let cursor = op.cursor || "";
  let ok = op.done_ok || 0, failed = op.failed || 0, tooOld = op.too_old || 0;
  let finished = false;

  while (Date.now() - t0 < BUDGET_MS) {
    const { data: st } = await sb.from("retention_sent_ops").select("status").eq("id", opId).maybeSingle();
    if (st?.status === "cancelled") return J({ ok: true, cancelled: true });
    let q = sb.from("retention_deliveries").select("chat_id, parts, sent_at")
      .eq("retention_message_id", msg.id).is("deleted_at", null).order("chat_id", { ascending: true }).limit(PAGE);
    if (cursor) q = q.gt("chat_id", cursor);
    const { data: rows, error } = await q;
    if (error) { bump(error.message); break; }
    if (!rows?.length) { finished = true; break; }
    for (const r of rows) {
      const parts: Part[] = Array.isArray(r.parts) ? r.parts : [];
      const now = new Date().toISOString();
      if (op.action === "delete") {
        if (Date.now() - new Date(r.sent_at).getTime() > H48) { tooOld++; cursor = r.chat_id; continue; }
        const ids = parts.map((p) => p.id).filter(Boolean);
        const j = ids.length ? await tgCall("deleteMessages", { chat_id: r.chat_id, message_ids: ids.slice(0, 100) }) : { ok: true };
        if (j.ok) { ok++; await sb.from("retention_deliveries").update({ deleted_at: now, last_error: null }).eq("retention_message_id", msg.id).eq("chat_id", r.chat_id); }
        else { failed++; bump(String(j.description || "delete failed")); await sb.from("retention_deliveries").update({ last_error: `delete: ${j.description}`.slice(0, 300) }).eq("retention_message_id", msg.id).eq("chat_id", r.chat_id); }
        await sleep(RATE_MS);
      } else {
        let e = "";
        try { e = await editDelivery(r.chat_id, parts, ctx); } catch (x) { e = String((x as Error)?.message || x); }
        if (!e) { ok++; await sb.from("retention_deliveries").update({ edited_at: now, last_error: null }).eq("retention_message_id", msg.id).eq("chat_id", r.chat_id); }
        else { failed++; bump(e); await sb.from("retention_deliveries").update({ last_error: `edit: ${e}`.slice(0, 300) }).eq("retention_message_id", msg.id).eq("chat_id", r.chat_id); }
      }
      cursor = r.chat_id;
      if (Date.now() - t0 >= BUDGET_MS) break;
    }
    await opUpdate(opId, { cursor, done_ok: ok, failed, too_old: tooOld, errors, heartbeat_at: new Date().toISOString(),
      note: ctx.warn.size ? [...ctx.warn].join(" · ") : op.note });
    if (rows.length < PAGE && cursor === rows[rows.length - 1].chat_id && Date.now() - t0 < BUDGET_MS) { finished = true; break; }
  }

  const note = ctx.warn.size ? [...ctx.warn].join(" · ") : null;
  if (!finished) {
    await opUpdate(opId, { cursor, done_ok: ok, failed, too_old: tooOld, errors, heartbeat_at: null, note });
    kickSelf(opId);
    return J({ ok: true, continued: true, done_ok: ok, failed });
  }
  const fin = new Date().toISOString();
  await opUpdate(opId, { status: "done", finished_at: fin, cursor, done_ok: ok, failed, too_old: tooOld, errors, note });
  if (op.action === "delete") await sb.from("retention_messages").update({ sent_deleted_at: fin }).eq("id", msg.id);
  else await sb.from("retention_messages").update({ sent_edited_at: fin, ...(ctx.mediaChanged && !note ? { sent_media: mediaSig(items) } : {}) }).eq("id", msg.id);
  await history(op.action === "delete" ? "tg_deleted" : "tg_edited",
    `успішно ${ok}, помилок ${failed}${tooOld ? `, старші за 48 год ${tooOld}` : ""}${note ? ` · ${note}` : ""}`);
  return J({ ok: true, done: true, done_ok: ok, failed, too_old: tooOld });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const source = url.searchParams.get("source") || "subscribers";
  const test = url.searchParams.get("test");
  const limit = parseInt(url.searchParams.get("limit") || "0", 10) || 0;
  const confirm = url.searchParams.get("confirm") === "1";
  // Внутрішній тест (Vadym 11.11.2026): явний короткий список chat_id, не більше 5.
  const chats = (url.searchParams.get("chats") || "").split(",").map(s => s.trim()).filter(s => /^-?\d+$/.test(s));
  // 08.08.2026 (аудит): fail-closed + dry-run теж під секретом (витікали audience_count,
  // реальні chat_id підписників і текст неопублікованих розсилок)
  const got = req.headers.get("x-hq-cron-secret") || url.searchParams.get("secret");
  const authed = !!CRON && got === CRON;
  if (!authed) return new Response(JSON.stringify({ ok: false, error: CRON ? "unauthorized" : "secret not configured" }), { status: CRON ? 401 : 500 });

  if (!TG) return new Response(JSON.stringify({ ok: false, error: "Бот-токен не заданий (PUBLIC_BOT_TOKEN/TG_BOT_TOKEN)" }), { status: 400 });
  // 11.11.2026: виконавець черги правки/видалення надісланого
  const opId = parseInt(url.searchParams.get("op") || "0", 10);
  if (opId > 0) {
    try { return await handleOp(opId); }
    catch (e) {
      console.error("[op]", opId, (e as Error)?.message);
      await sb.from("retention_sent_ops").update({ heartbeat_at: null, note: `збій виконавця: ${(e as Error)?.message}`.slice(0, 300) }).eq("id", opId);
      return new Response(JSON.stringify({ ok: false, error: "op failed, will resume" }), { status: 500 });
    }
  }
  if (!id) return new Response(JSON.stringify({ ok: false, error: "?id=<retention_message_id> обов'язковий" }), { status: 400 });

  const { data: msg, error } = await sb.from("retention_messages").select("*").eq("id", id).maybeSingle();
  if (error || !msg) return new Response(JSON.stringify({ ok: false, error: "message not found" }), { status: 404 });

  // Safety guard: dm_broadcast + dm_only — тільки DM. single_chat дозволений лише явним test.
  if (msg.send_mode === "single_chat" && !test) {
    return new Response(JSON.stringify({ ok: false, error: "send_mode=single_chat: вкажіть ?test=<chat_id> явно" }), { status: 400 });
  }

  const caption = [msg.title ? (String(msg.title).startsWith("<") ? msg.title : `<b>${esc(msg.title)}</b>`) : "", msg.preview_text || msg.body || ""].filter(Boolean).join("\n\n");
  const items = await buildItems(msg.id);
  const vnote = await getVideoNote(msg.video_note_creative_id);
  const kb = toKeyboard(msg.tg_buttons);
  const cache: Record<string, string> = {};

  // === 11.11.2026: змінити / видалити вже надіслане ===
  const action = url.searchParams.get("action");
  if (action === "edit" || action === "delete" || action === "preview") {
    return new Response(JSON.stringify({ ok: false, error: "Правка/видалення надісланого — через картку HQ (rpc retention_sent_op_request) або ?op=<id>" }), { status: 400 });
  }

  if (source === "chats" && test) {
    return new Response(JSON.stringify({ ok: false, error: "source=chats не поєднується з ?test=" }), { status: 400 });
  }
  // === TEST: одне повідомлення на конкретний chat_id (потребує секрет) ===
  if (test) {
    if (!authed) return new Response(JSON.stringify({ ok: false, error: "test send потребує x-hq-cron-secret" }), { status: 401 });
    const res = await sendToChat(test, caption, items, vnote, kb, cache);
    return new Response(JSON.stringify({ ok: res.ok, mode: "test", chat_id: test, media: items.length, video_note: !!vnote, buttons: !!kb, err: res.err }, null, 2), { headers: { "content-type": "application/json" } });
  }

  if (source === "chats" && (chats.length === 0 || chats.length > 5)) {
    return new Response(JSON.stringify({ ok: false, error: "source=chats: потрібно 1..5 chat_id у ?chats=" }), { status: 400 });
  }
  const audience = await resolveAudience(msg, source, limit, chats);

  // === DRY-RUN (default якщо нема confirm+secret) ===
  if (!confirm || !authed) {
    return new Response(JSON.stringify({
      ok: true, mode: "dry-run", reason: !confirm ? "no ?confirm=1" : "bad secret",
      message: { id: msg.id, title: msg.title, send_mode: msg.send_mode, dm_only: msg.dm_only },
      audience_source: source, audience_count: audience.length,
      preview: { caption: caption.slice(0, 400), media: items.map(i => `${i.type}:${(i.size / 1048576).toFixed(1)}MB`), video_note: !!vnote, buttons: kb?.inline_keyboard?.flat().map((b: any) => b.text) || [] },
      sample_chats: audience.slice(0, 3).map(a => a.chat_id),
    }, null, 2), { headers: { "content-type": "application/json" } });
  }

  // 🔒 Vadym 30.07: прод-розсилка на АУДИТОРІЮ БОТА заблокована до відмашки.
  // Дозволено лише source=team (команда). Увімкнути прод: PROD_BROADCAST_ENABLED=1 у Edge env.
  const PROD_OK = Deno.env.get("PROD_BROADCAST_ENABLED") === "1";
  if (source !== "team" && source !== "chats" && !PROD_OK) {
    return new Response(JSON.stringify({
      ok: false, blocked: true,
      error: "Прод-розсилка на аудиторію бота ЗАБЛОКОВАНА до відмашки Вадима. Дозволено лише source=team. Щоб увімкнути — виставити PROD_BROADCAST_ENABLED=1 у Edge env.",
    }), { status: 403, headers: { "content-type": "application/json" } });
  }

  // === РЕАЛЬНА розсилка (confirm + secret) ===
  await sb.from("retention_messages").update({ status: "sending", sent_media: mediaSig(items) }).eq("id", msg.id);
  let sent = 0, failed = 0; const mids: number[] = [];
  // 11.11.2026: журнал доставок — без нього надіслане неможливо ні виправити, ні видалити.
  let log: any[] = [];
  const flush = async () => {
    if (!log.length) return;
    const rows = log; log = [];
    const { error: le } = await sb.from("retention_deliveries").upsert(rows, { onConflict: "retention_message_id,chat_id" });
    if (le) console.error("[deliveries] upsert", le.message);
  };
  for (const a of audience) {
    const res = await sendToChat(a.chat_id, caption, items, vnote, kb, cache);
    if (res.parts?.length) log.push({ retention_message_id: msg.id, chat_id: a.chat_id, parts: res.parts, sent_at: new Date().toISOString() });
    if (log.length >= 200) await flush();
    if (res.ok) { sent++; if (res.mid && mids.length < 20) mids.push(res.mid); }
    else {
      failed++;
      const e = String(res.err || "");
      if (a.sub_id && (/blocked|deactivated|not found|chat not found|kicked/i.test(e))) {
        await sb.from("bot_subscribers").update({ is_active: false, unsubscribed_at: new Date().toISOString() }).eq("id", a.sub_id);
      }
    }
    await sleep(RATE_MS);
  }
  await flush();
  await sb.from("retention_messages").update({
    status: sent > 0 ? "sent" : "failed", sent_at: new Date().toISOString(),
    sent_count: sent, delivered_count: sent, failed_count: failed, tg_message_ids: mids,
    external_error: failed && !sent ? "усі відправки впали" : null,
  }).eq("id", msg.id);

  return new Response(JSON.stringify({ ok: true, mode: "broadcast", audience_source: source, sent, failed, total: audience.length }, null, 2), { headers: { "content-type": "application/json" } });
});
