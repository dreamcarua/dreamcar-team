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
//   ?confirm=1  (+ x-hq-cron-secret) РЕАЛЬНА масова відправка
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

type Item = { type: "photo" | "video"; url: string; size: number; width?: number; height?: number; duration?: number; poster?: string | null; file_id?: string };

async function headSize(url: string): Promise<number> {
  try { const r = await fetch(url, { method: "HEAD" }); return parseInt(r.headers.get("content-length") || "0", 10) || 0; } catch { return 0; }
}
function pickUrl(c: any): string | null {
  return c.compressed_url || c.compressed_url_hevc || c.poster_url || c.thumbnail_url || null;
}
// Нормалізація кнопок → inline_keyboard. Приймає [[{text,url}]] або [{text,url}].
function toKeyboard(btns: any): any | undefined {
  if (!Array.isArray(btns) || !btns.length) return undefined;
  const rows = Array.isArray(btns[0]) ? btns : btns.map((b: any) => [b]);
  const inline = rows
    .map((r: any[]) => r.map((b: any) => ({ text: b.text || b.label || "↗", url: b.url || b.link })).filter((b: any) => b.url))
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
async function tgUpload(method: string, chatId: string, field: string, url: string, extra: Record<string, string> = {}): Promise<any> {
  const resp = await fetch(url); if (!resp.ok) return { ok: false, description: `download ${resp.status}` };
  const blob = await resp.blob();
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append(field, blob, field === "photo" ? "p.jpg" : field === "video_note" ? "vn.mp4" : "v.mp4");
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
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
async function sendToChat(chatId: string, caption: string, items: Item[], vnote: Item | null, kb: any, cache: Record<string, string>): Promise<{ ok: boolean; err?: string; mid?: number }> {
  // 1) відеозамітка (кружечок) — окремо, без підпису/кнопок
  if (vnote) {
    if (cache.vnote) { await tgCall("sendVideoNote", { chat_id: chatId, video_note: cache.vnote, disable_notification: true }); }
    else if (vnote.size > 0 && vnote.size <= MAX_URL) {
      const j = await tgCall("sendVideoNote", { chat_id: chatId, video_note: vnote.url, disable_notification: true });
      if (j.ok && j.result?.video_note?.file_id) cache.vnote = j.result.video_note.file_id;
    } else if (vnote.size <= MAX_TG) {
      const j = await tgUpload("sendVideoNote", chatId, "video_note", vnote.url, { disable_notification: "true" });
      if (j.ok && j.result?.video_note?.file_id) cache.vnote = j.result.video_note.file_id;
    }
  }

  const cap = caption.slice(0, 1024);
  // 2) без медіа → текст (+кнопки)
  if (items.length === 0) {
    if (!cap && !kb) return { ok: true }; // лише відеозамітка була
    const j = await tgCall("sendMessage", { chat_id: chatId, text: cap || " ", parse_mode: "HTML", disable_web_page_preview: true, ...(kb ? { reply_markup: kb } : {}), disable_notification: true });
    return j.ok ? { ok: true, mid: j.result?.message_id } : { ok: false, err: j.description };
  }
  // 3) одне медіа → sendPhoto/Video з підписом+кнопками
  if (items.length === 1) {
    const it = items[0]; const method = it.type === "video" ? "sendVideo" : "sendPhoto"; const field = it.type;
    const ck = `m0_${it.type}`;
    if (cache[ck]) {
      const body: any = { chat_id: chatId, [field]: cache[ck], caption: cap, parse_mode: "HTML", disable_notification: true, ...(kb ? { reply_markup: kb } : {}) };
      if (it.type === "video") body.supports_streaming = true;
      const j = await tgCall(method, body);
      return j.ok ? { ok: true, mid: j.result?.message_id } : { ok: false, err: j.description };
    }
    let j: any;
    if (it.size > 0 && it.size <= MAX_URL) {
      const body: any = { chat_id: chatId, [field]: it.url, caption: cap, parse_mode: "HTML", disable_notification: true, ...(kb ? { reply_markup: kb } : {}) };
      if (it.type === "video") { body.supports_streaming = true; if (it.width) body.width = it.width; if (it.height) body.height = it.height; if (it.duration) body.duration = it.duration; if (it.poster) body.thumbnail = it.poster; }
      j = await tgCall(method, body);
    } else {
      j = await tgUpload(method, chatId, field, it.url, { caption: cap, parse_mode: "HTML", disable_notification: "true", ...(it.type === "video" ? { supports_streaming: "true" } : {}) });
    }
    if (j.ok) { const fid = (j.result?.photo?.slice(-1)[0]?.file_id) || j.result?.video?.file_id; if (fid) cache[ck] = fid; return { ok: true, mid: j.result?.message_id }; }
    return { ok: false, err: j.description };
  }
  // 4) медіагрупа (album). Кнопки → окремим повідомленням під альбомом.
  const media = items.slice(0, 10).map((m, i) => {
    const o: any = { type: m.type, media: cache[`a${i}`] || m.url };
    if (!kb && i === 0) { o.caption = cap; o.parse_mode = "HTML"; }
    if (m.type === "video") o.supports_streaming = true;
    return o;
  });
  const jg = await tgCall("sendMediaGroup", { chat_id: chatId, media, disable_notification: true });
  if (jg.ok && Array.isArray(jg.result)) {
    jg.result.forEach((r: any, i: number) => { const fid = r.photo?.slice(-1)[0]?.file_id || r.video?.file_id; if (fid && !cache[`a${i}`]) cache[`a${i}`] = fid; });
  }
  if (kb || (jg.ok && cap)) {
    // якщо були кнопки — надсилаємо підпис+кнопки окремим повідомленням під альбомом
    if (kb) await tgCall("sendMessage", { chat_id: chatId, text: cap || " ", parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb, disable_notification: true });
  }
  return jg.ok ? { ok: true, mid: jg.result?.[0]?.message_id } : { ok: false, err: jg.description };
}

async function resolveAudience(msg: any, source: string, limit: number): Promise<{ chat_id: string; sub_id?: string }[]> {
  if (source === "team") {
    let q = sb.from("users").select("id, tg_chat_id").not("tg_chat_id", "is", null);
    const { data } = await q;
    let rows = (data || []).map((u: any) => ({ chat_id: String(u.tg_chat_id) }));
    return limit ? rows.slice(0, limit) : rows;
  }
  // subscribers + сегмент
  let q = sb.from("bot_subscribers").select("id, chat_id").eq("is_active", true);
  const f = msg?.audience_filter || {};
  if (f.tariff) q = q.eq("tariff", f.tariff);
  if (f.user_status) q = q.eq("user_status", f.user_status);
  const { data } = await q.limit(limit || 100000);
  return (data || []).map((s: any) => ({ chat_id: String(s.chat_id), sub_id: s.id }));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const source = url.searchParams.get("source") || "subscribers";
  const test = url.searchParams.get("test");
  const limit = parseInt(url.searchParams.get("limit") || "0", 10) || 0;
  const confirm = url.searchParams.get("confirm") === "1";
  const got = req.headers.get("x-hq-cron-secret") || url.searchParams.get("secret");
  const authed = CRON ? got === CRON : true;

  if (!TG) return new Response(JSON.stringify({ ok: false, error: "Бот-токен не заданий (PUBLIC_BOT_TOKEN/TG_BOT_TOKEN)" }), { status: 400 });
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

  // === TEST: одне повідомлення на конкретний chat_id (потребує секрет) ===
  if (test) {
    if (!authed) return new Response(JSON.stringify({ ok: false, error: "test send потребує x-hq-cron-secret" }), { status: 401 });
    const res = await sendToChat(test, caption, items, vnote, kb, cache);
    return new Response(JSON.stringify({ ok: res.ok, mode: "test", chat_id: test, media: items.length, video_note: !!vnote, buttons: !!kb, err: res.err }, null, 2), { headers: { "content-type": "application/json" } });
  }

  const audience = await resolveAudience(msg, source, limit);

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

  // === РЕАЛЬНА розсилка (confirm + secret) ===
  await sb.from("retention_messages").update({ status: "sending" }).eq("id", msg.id);
  let sent = 0, failed = 0; const mids: number[] = [];
  for (const a of audience) {
    const res = await sendToChat(a.chat_id, caption, items, vnote, kb, cache);
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
  await sb.from("retention_messages").update({
    status: sent > 0 ? "sent" : "failed", sent_at: new Date().toISOString(),
    sent_count: sent, delivered_count: sent, failed_count: failed, tg_message_ids: mids,
    external_error: failed && !sent ? "усі відправки впали" : null,
  }).eq("id", msg.id);

  return new Response(JSON.stringify({ ok: true, mode: "broadcast", audience_source: source, sent, failed, total: audience.length }, null, 2), { headers: { "content-type": "application/json" } });
});
