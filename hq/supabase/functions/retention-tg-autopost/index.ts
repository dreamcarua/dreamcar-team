// retention-tg-autopost — публікація ретеншн-повідомлень (channel=tg) у канал/групу
// через бота, коли настав час (як SMM-автопост). Прямий Edge-шлях, pg_cron кожні 2хв.
//
// Бере approved retention_messages з channel=tg, publish_at у [now-15хв..now], ще не sent.
// Текст = title + preview_text; медіа = creative_retention_messages (фото/відео).
// Великі відео (>20МБ) — multipart; width/height/постер — щоб не плющило.
// Оновлює sent_at, status='published', tg_message_ids.
//
// Ручний тест: ?dry=1 (preview) · ?chat=<id> (override) · ?id=<msg_id> (конкретне).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = Deno.env.get("TG_BOT_TOKEN")!;
const CRON = Deno.env.get("DC_CRON_SECRET") ?? Deno.env.get("HQ_CRON_SECRET") ?? "";
const CHAT = Deno.env.get("RETENTION_TG_CHANNEL") || "-1003933841573";
const MAX_URL = 20 * 1024 * 1024;
const MAX_TG = 50 * 1024 * 1024;

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const esc = (s: string) => (s || "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));

type Item = { type: "photo" | "video"; url: string; size: number; width?: number; height?: number; duration?: number; poster?: string | null };

async function headSize(url: string): Promise<number> {
  try { const r = await fetch(url, { method: "HEAD" }); return parseInt(r.headers.get("content-length") || "0", 10) || 0; } catch { return 0; }
}
function pickUrl(c: any): string | null {
  return c.compressed_url || c.compressed_url_hevc || c.poster_url || c.thumbnail_url || null;
}

// 14.08.2026: кнопки з композера (tg_buttons) — раніше просто ігнорувались у каналі.
function toKeyboard(btns: any): any | undefined {
  if (!Array.isArray(btns) || !btns.length) return undefined;
  const rows = Array.isArray(btns[0]) ? btns : btns.map((b: any) => [b]);
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

// Відеозамітка (кружечок) — окреме повідомлення перед основним, без підпису й кнопок.
async function getVideoNote(creativeId: string | null): Promise<Item | null> {
  if (!creativeId) return null;
  const { data } = await sb.from("creatives").select("id, compressed_url, compressed_url_hevc, poster_url, thumbnail_url, compressed_size_bytes, compressed_at").eq("id", creativeId).maybeSingle();
  if (!data) return null;
  if (!data.compressed_at) return null; // HARD RULE: не шлемо нестиснене відео
  const url = pickUrl(data); if (!url) return null;
  return { type: "video", url, size: data.compressed_size_bytes || await headSize(url) };
}

async function sendVideoNote(chatId: string, vn: Item): Promise<void> {
  if (vn.size > 0 && vn.size <= MAX_URL) {
    const r = await fetch(`https://api.telegram.org/bot${TG}/sendVideoNote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, video_note: vn.url, disable_notification: true }) });
    if ((await r.json()).ok) return;
  }
  if (vn.size > MAX_TG) return;
  try {
    const blob = await (await fetch(vn.url)).blob();
    const form = new FormData();
    form.append("chat_id", chatId); form.append("video_note", blob, "note.mp4"); form.append("disable_notification", "true");
    await fetch(`https://api.telegram.org/bot${TG}/sendVideoNote`, { method: "POST", body: form });
  } catch { /* відеозамітка не критична — основний пост усе одно йде */ }
}

async function sendSingle(chatId: string, it: Item, caption: string, kb?: any): Promise<{ ok: boolean; err?: string; mid?: number }> {
  const isVideo = it.type === "video";
  if (it.size > 0 && it.size <= MAX_URL) {
    const body: any = { chat_id: chatId, caption: caption.slice(0, 1024), parse_mode: "HTML", disable_notification: true, ...(kb ? { reply_markup: kb } : {}) };
    body[it.type] = it.url;
    if (isVideo) { body.supports_streaming = true; if (it.width) body.width = it.width; if (it.height) body.height = it.height; if (it.duration) body.duration = it.duration; if (it.poster) body.thumbnail = it.poster; }
    const r = await fetch(`https://api.telegram.org/bot${TG}/${isVideo ? "sendVideo" : "sendPhoto"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.ok) return { ok: true, mid: j.result?.message_id };
  }
  if (it.size > MAX_TG) return { ok: false, err: `${(it.size / 1048576).toFixed(1)}МБ > 50МБ` };
  const resp = await fetch(it.url); if (!resp.ok) return { ok: false, err: `download ${resp.status}` };
  const blob = await resp.blob();
  const form = new FormData();
  form.append("chat_id", chatId); form.append("caption", caption.slice(0, 1024)); form.append("parse_mode", "HTML"); form.append("disable_notification", "true");
  if (kb) form.append("reply_markup", JSON.stringify(kb));
  if (isVideo) {
    form.append("video", blob, "video.mp4"); form.append("supports_streaming", "true");
    if (it.width) form.append("width", String(it.width)); if (it.height) form.append("height", String(it.height)); if (it.duration) form.append("duration", String(it.duration));
    if (it.poster) { try { const tb = await (await fetch(it.poster)).blob(); form.append("thumbnail", tb, "thumb.jpg"); } catch { /* optional */ } }
  } else form.append("photo", blob, "photo.jpg");
  const r2 = await fetch(`https://api.telegram.org/bot${TG}/${isVideo ? "sendVideo" : "sendPhoto"}`, { method: "POST", body: form });
  const j2 = await r2.json();
  return j2.ok ? { ok: true, mid: j2.result?.message_id } : { ok: false, err: j2.description };
}

async function sendAlbum(chatId: string, items: Item[], caption: string): Promise<{ ok: boolean; err?: string; mid?: number }> {
  const hasBig = items.some(i => i.size > MAX_URL);
  if (!hasBig) {
    const media = items.slice(0, 10).map((m, i) => {
      const o: any = { type: m.type, media: m.url };
      if (i === 0) { o.caption = caption.slice(0, 1024); o.parse_mode = "HTML"; }
      if (m.type === "video") { o.supports_streaming = true; if (m.width) o.width = m.width; if (m.height) o.height = m.height; if (m.duration) o.duration = m.duration; }
      return o;
    });
    const r = await fetch(`https://api.telegram.org/bot${TG}/sendMediaGroup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, media, disable_notification: true }) });
    const j = await r.json();
    if (j.ok) return { ok: true, mid: j.result?.[0]?.message_id };
  }
  const form = new FormData(); form.append("chat_id", chatId); form.append("disable_notification", "true");
  const desc: any[] = [];
  for (let i = 0; i < Math.min(items.length, 10); i++) {
    const m = items[i]; if (m.size > MAX_TG) continue;
    const blob = await (await fetch(m.url)).blob(); const key = `m${i}`;
    form.append(key, blob, m.type === "video" ? `v${i}.mp4` : `p${i}.jpg`);
    const o: any = { type: m.type, media: `attach://${key}` };
    if (desc.length === 0) { o.caption = caption.slice(0, 1024); o.parse_mode = "HTML"; }
    if (m.type === "video") { o.supports_streaming = true; if (m.width) o.width = m.width; if (m.height) o.height = m.height; if (m.duration) o.duration = m.duration; }
    desc.push(o);
  }
  if (!desc.length) return { ok: false, err: "усі файли завеликі" };
  form.append("media", JSON.stringify(desc));
  const r2 = await fetch(`https://api.telegram.org/bot${TG}/sendMediaGroup`, { method: "POST", body: form });
  const j2 = await r2.json();
  return j2.ok ? { ok: true, mid: j2.result?.[0]?.message_id } : { ok: false, err: j2.description };
}

// pendingVideo=true — серед креативів є відео, яке ще НЕ стиснуте.
// HARD RULE: відеосендер орієнтується на compressed_at, а не на compressed_status
// (фронт ставить 'ready' одразу при аплоаді, до реальної компресії).
async function buildItems(msgId: string): Promise<{ items: Item[]; pendingVideo: boolean }> {
  const { data: cr } = await sb.from("creative_retention_messages").select("creative_id, sort_order").eq("retention_message_id", msgId).order("sort_order", { ascending: true });
  const ids = (cr || []).map((r: any) => r.creative_id);
  if (!ids.length) return { items: [], pendingVideo: false };
  const { data } = await sb.from("creatives").select("id, type, compressed_url, compressed_url_hevc, poster_url, thumbnail_url, width_px, height_px, duration_sec, compressed_size_bytes, compressed_at, compressed_status").in("id", ids);
  const order = new Map(ids.map((id: string, i: number) => [id, i]));
  const sorted = (data || []).slice().sort((a: any, b: any) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  const items: Item[] = [];
  let pendingVideo = false;
  for (const c of sorted) {
    const isVideo = String(c.type || "").toLowerCase() === "video";
    // 'failed'/'n/a' не чекаємо — інакше повідомлення зависне назавжди.
    if (isVideo && !c.compressed_at && ["pending", "processing", "ready"].includes(String(c.compressed_status || ""))) { pendingVideo = true; continue; }
    const url = pickUrl(c); if (!url) continue;
    const size = c.compressed_size_bytes || await headSize(url);
    items.push({ type: isVideo ? "video" : "photo", url, size, width: c.width_px || undefined, height: c.height_px || undefined, duration: c.duration_sec || undefined, poster: isVideo ? (c.poster_url || null) : null });
  }
  return { items, pendingVideo };
}

async function postOne(msg: any, chatId: string, dry: boolean): Promise<any> {
  const titleLine = msg.title ? (msg.title.startsWith("<") ? msg.title : `<b>${esc(msg.title)}</b>`) : "";
  // 14.08.2026: композер зберігає текст у body; preview_text для TG-каналу приховано у формі.
  const bodyText = msg.body || msg.preview_text || "";
  const caption = [titleLine, bodyText].filter(Boolean).join("\n\n").slice(0, 1024);
  const { items, pendingVideo } = await buildItems(msg.id);
  const kb = toKeyboard(msg.tg_buttons);

  if (dry) return { id: msg.id, media: items.map(i => `${i.type}:${(i.size / 1048576).toFixed(1)}MB`), pending_video: pendingVideo, buttons: !!kb, video_note: !!msg.video_note_creative_id, preview: caption };

  // Відео ще стискається — відкладаємо на +3хв замість посту без відео / з HDR-оригіналом.
  if (pendingVideo) {
    await sb.from("retention_messages").update({ publish_at: new Date(Date.now() + 3 * 60000).toISOString() }).eq("id", msg.id);
    return { id: msg.id, deferred: "video compressing, +3min" };
  }

  // атомарний claim
  const { data: claimed } = await sb.from("retention_messages").update({ status: "published" }).eq("id", msg.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return { id: msg.id, skipped: "already-claimed" };

  // відеозамітка (кружечок) — окремим повідомленням перед основним
  const vnote = await getVideoNote(msg.video_note_creative_id || null);
  if (vnote) await sendVideoNote(chatId, vnote);

  let res: any;
  if (items.length === 0) {
    const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: caption || "(порожньо)", parse_mode: "HTML", disable_web_page_preview: true, ...(kb ? { reply_markup: kb } : {}) }) });
    const j = await r.json(); res = { ok: j.ok, err: j.description, mid: j.result?.message_id };
  } else if (items.length === 1) res = await sendSingle(chatId, items[0], caption, kb);
  else {
    res = await sendAlbum(chatId, items, caption);
    // TG не дозволяє reply_markup у медіагрупі — кнопки окремим повідомленням.
    if (res.ok && kb) {
      await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: "&#8203;", parse_mode: "HTML", disable_notification: true, reply_markup: kb }) });
    }
  }

  if (res.ok) {
    await sb.from("retention_messages").update({ sent_at: new Date().toISOString(), sent_count: 1, tg_message_ids: res.mid ? [res.mid] : [] }).eq("id", msg.id);
    return { id: msg.id, ok: true, mid: res.mid, media_count: items.length };
  } else {
    await sb.from("retention_messages").update({ status: "failed" }).eq("id", msg.id);
    return { id: msg.id, ok: false, err: res.err };
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const chat = url.searchParams.get("chat") || CHAT;
  const oneId = url.searchParams.get("id");
  // 08.08.2026 (аудит): dry більше не обходить auth (витікали прев'ю неопублікованого контенту)
  const got = req.headers.get("x-hq-cron-secret") || url.searchParams.get("secret");
  if (!CRON) return new Response(JSON.stringify({ error: "secret not configured" }), { status: 500 });
  if (got !== CRON) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  try {
    // 14.08.2026 (аудит «загублених полів»): select не тягнув body/tg_buttons/dm_only/send_mode.
    // Наслідки: (1) композер пише текст у body, а тут читався лише preview_text (у TG-каналі він
    // прихований) → пости виходили самим заголовком; (2) без dm_only/send_mode крон міг
    // опублікувати в ПУБЛІЧНИЙ канал повідомлення, призначене для DM-розсилки в бота.
    let q = sb.from("retention_messages")
      .select("id, title, preview_text, body, status, publish_at, tg_buttons, video_note_creative_id, dm_only, send_mode")
      .eq("channel", "tg").is("deleted_at", null)
      // DM-розсилки веде retention-bot-broadcast — сюди вони потрапляти НЕ мають
      .or("dm_only.is.null,dm_only.eq.false")
      .or("send_mode.is.null,send_mode.neq.dm_broadcast");
    if (oneId) q = q.eq("id", oneId);
    else {
      const now = Date.now();
      q = q.eq("status", "approved").gte("publish_at", new Date(now - 15 * 60000).toISOString()).lte("publish_at", new Date(now).toISOString());
    }
    const { data: msgs, error } = await q.limit(8);
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    if (!msgs?.length) return new Response(JSON.stringify({ ok: true, posted: 0 }), { headers: { "content-type": "application/json" } });

    const results = [];
    for (const m of msgs) results.push(await postOne(m, chat, dry));
    return new Response(JSON.stringify({ ok: true, count: msgs.length, results }), { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
