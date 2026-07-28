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

async function sendSingle(chatId: string, it: Item, caption: string): Promise<{ ok: boolean; err?: string; mid?: number }> {
  const isVideo = it.type === "video";
  if (it.size > 0 && it.size <= MAX_URL) {
    const body: any = { chat_id: chatId, caption: caption.slice(0, 1024), parse_mode: "HTML", disable_notification: true };
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

async function postOne(msg: any, chatId: string, dry: boolean): Promise<any> {
  const titleLine = msg.title ? (msg.title.startsWith("<") ? msg.title : `<b>${esc(msg.title)}</b>`) : "";
  const bodyText = msg.preview_text || "";
  const caption = [titleLine, bodyText].filter(Boolean).join("\n\n").slice(0, 1024);
  const items = await buildItems(msg.id);

  if (dry) return { id: msg.id, media: items.map(i => `${i.type}:${(i.size / 1048576).toFixed(1)}MB`), preview: caption };

  // атомарний claim
  const { data: claimed } = await sb.from("retention_messages").update({ status: "published" }).eq("id", msg.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return { id: msg.id, skipped: "already-claimed" };

  let res: any;
  if (items.length === 0) {
    const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: caption || "(порожньо)", parse_mode: "HTML", disable_web_page_preview: true }) });
    const j = await r.json(); res = { ok: j.ok, err: j.description, mid: j.result?.message_id };
  } else if (items.length === 1) res = await sendSingle(chatId, items[0], caption);
  else res = await sendAlbum(chatId, items, caption);

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
  const got = req.headers.get("x-hq-cron-secret") || url.searchParams.get("secret");
  if (!dry && CRON && got !== CRON) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  try {
    let q = sb.from("retention_messages").select("id, title, preview_text, status, publish_at").eq("channel", "tg").is("deleted_at", null);
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
