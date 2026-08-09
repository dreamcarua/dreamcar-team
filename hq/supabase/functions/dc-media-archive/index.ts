// dc-media-archive v4 — #411 + #aspect/#bigvideo fix (20.07.2026)
// Постить опубліковану публікацію у групу 'DreamCar Media' для архіву.
//
// v4 fix: відео 45МБ не долітали. Причина — слали sendVideo ПО URL, а TG по URL
// тягне лише ≤20МБ (мовчазний фейл). Тепер: ≤20МБ — URL (швидко), >20МБ — завантажуємо
// і шлемо multipart (перевірено на 47МБ у tg-post-send). Плюс width/height/duration +
// постер-thumbnail, щоб TG не плющив вертикальні відео у квадрат.
//
// Endpoints:
//   GET ?probe=1            — виявити DC Media chat
//   POST ?action=register   — { chat_id, title? }
//   POST { publication_id } — архівувати публікацію

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_BOT_TOKEN = Deno.env.get("TG_BOT_TOKEN")!;
// 08.08.2026 (аудит): fallback-літерал прибрано (був спалений у git), тільки env.
const CRON_SECRET = Deno.env.get("DC_CRON_SECRET") ?? "";
const MEDIA_CHAT_KEY = 'dc_media_chat_id';
const MAX_URL_BYTES = 20 * 1024 * 1024;   // TG: по URL тягне лише до 20МБ
const MAX_TG_BYTES = 50 * 1024 * 1024;    // хард-ліміт бота

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function getMediaChatId(): Promise<string | null> {
  const { data } = await sb.from('dashboard_settings').select('value').eq('key', MEDIA_CHAT_KEY).maybeSingle();
  if (!data?.value) return null;
  try {
    const v = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    return v?.chat_id ? String(v.chat_id) : null;
  } catch { return String(data.value); }
}
async function setMediaChatId(chatId: string, title?: string): Promise<void> {
  await sb.from('dashboard_settings').upsert({
    key: MEDIA_CHAT_KEY,
    value: JSON.stringify({ chat_id: chatId, title: title || 'DreamCar Media', set_at: new Date().toISOString() })
  }, { onConflict: 'key' });
}
async function tgGetChat(chatId: string): Promise<{ ok: boolean; title?: string; type?: string; error?: string }> {
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getChat?chat_id=${chatId}`);
  const j = await r.json();
  if (!j.ok) return { ok: false, error: j.description };
  return { ok: true, title: j.result.title || j.result.username || `[${j.result.type}]`, type: j.result.type };
}
async function probeKnownChats(): Promise<any> {
  const { data: listening } = await sb.from('tg_listening_chats').select('chat_id, chat_title');
  const seen = new Set<string>(); const all: any[] = [];
  for (const r of (listening || [])) {
    const id = String(r.chat_id);
    if (seen.has(id)) continue; seen.add(id);
    all.push({ chat_id: id, known_title: r.chat_title });
  }
  const results: any[] = []; let mediaChat: any = null;
  for (const c of all) {
    const info = await tgGetChat(c.chat_id);
    results.push({ chat_id: c.chat_id, known_title: c.known_title, live_title: info.title || null, type: info.type || null, error: info.error || null });
    if (info.ok && info.title && /media/i.test(info.title) && (info.type === 'group' || info.type === 'supergroup')) {
      mediaChat = { chat_id: c.chat_id, title: info.title };
    }
  }
  if (mediaChat) await setMediaChatId(mediaChat.chat_id, mediaChat.title);
  return { ok: true, chats: results, registered: mediaChat, current_setting: await getMediaChatId() };
}

function stripHtmlForCaption(s: string): string {
  return (s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n').trim();
}
const esc = (s: string) => (s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!));

type Item = { type: 'photo' | 'video'; url: string; size: number; width?: number; height?: number; duration?: number; poster?: string | null };

async function headSize(url: string): Promise<number> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return parseInt(r.headers.get('content-length') || '0', 10) || 0;
  } catch { return 0; }
}
function pickUrl(c: any): string | null {
  return c.compressed_url || c.compressed_url_hevc || c.poster_url || c.thumbnail_url
    || (c.drive_file_id ? `https://lh3.googleusercontent.com/d/${c.drive_file_id}=s2048` : null);
}

async function sendSingle(chatId: string, it: Item, caption: string): Promise<{ ok: boolean; err?: string }> {
  const isVideo = it.type === 'video';
  // ≤20МБ — по URL (швидко, без завантаження в пам'ять)
  if (it.size > 0 && it.size <= MAX_URL_BYTES) {
    const body: any = { chat_id: chatId, caption: caption.slice(0, 1024), parse_mode: 'HTML', disable_notification: true };
    body[it.type] = it.url;
    if (isVideo) {
      body.supports_streaming = true;
      if (it.width) body.width = it.width;
      if (it.height) body.height = it.height;
      if (it.duration) body.duration = it.duration;
      if (it.poster) body.thumbnail = it.poster;
    }
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${isVideo ? 'sendVideo' : 'sendPhoto'}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const j = await r.json();
    if (j.ok) return { ok: true };
    // не вийшло по URL — пробуємо завантаженням
  }
  if (it.size > MAX_TG_BYTES) return { ok: false, err: `${(it.size / 1048576).toFixed(1)}МБ > 50МБ ліміт TG` };

  // >20МБ (або URL не спрацював) — завантажуємо і шлемо multipart
  const resp = await fetch(it.url);
  if (!resp.ok) return { ok: false, err: `download ${resp.status}` };
  const blob = await resp.blob();
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('caption', caption.slice(0, 1024));
  form.append('parse_mode', 'HTML');
  form.append('disable_notification', 'true');
  if (isVideo) {
    form.append('video', blob, 'video.mp4');
    form.append('supports_streaming', 'true');
    if (it.width) form.append('width', String(it.width));
    if (it.height) form.append('height', String(it.height));
    if (it.duration) form.append('duration', String(it.duration));
    if (it.poster) {
      try { const tb = await (await fetch(it.poster)).blob(); form.append('thumbnail', tb, 'thumb.jpg'); } catch { /* optional */ }
    }
  } else {
    form.append('photo', blob, 'photo.jpg');
  }
  const r2 = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${isVideo ? 'sendVideo' : 'sendPhoto'}`, { method: 'POST', body: form });
  const j2 = await r2.json();
  return j2.ok ? { ok: true } : { ok: false, err: j2.description };
}

async function sendAlbum(chatId: string, items: Item[], caption: string): Promise<{ ok: boolean; err?: string }> {
  const hasBig = items.some(i => i.size > MAX_URL_BYTES);
  if (!hasBig) {
    const media = items.slice(0, 10).map((m, i) => {
      const o: any = { type: m.type, media: m.url };
      if (i === 0) { o.caption = caption.slice(0, 1024); o.parse_mode = 'HTML'; }
      if (m.type === 'video') { o.supports_streaming = true; if (m.width) o.width = m.width; if (m.height) o.height = m.height; if (m.duration) o.duration = m.duration; }
      return o;
    });
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMediaGroup`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, media, disable_notification: true })
    });
    const j = await r.json();
    if (j.ok) return { ok: true };
  }
  // є важкі файли — альбом через завантаження (attach://)
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('disable_notification', 'true');
  const desc: any[] = [];
  for (let i = 0; i < Math.min(items.length, 10); i++) {
    const m = items[i];
    if (m.size > MAX_TG_BYTES) continue;
    const blob = await (await fetch(m.url)).blob();
    const key = `m${i}`;
    form.append(key, blob, m.type === 'video' ? `v${i}.mp4` : `p${i}.jpg`);
    const o: any = { type: m.type, media: `attach://${key}` };
    if (desc.length === 0) { o.caption = caption.slice(0, 1024); o.parse_mode = 'HTML'; }
    if (m.type === 'video') { o.supports_streaming = true; if (m.width) o.width = m.width; if (m.height) o.height = m.height; if (m.duration) o.duration = m.duration; }
    desc.push(o);
  }
  if (!desc.length) return { ok: false, err: 'усі файли завеликі' };
  form.append('media', JSON.stringify(desc));
  const r2 = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMediaGroup`, { method: 'POST', body: form });
  const j2 = await r2.json();
  return j2.ok ? { ok: true } : { ok: false, err: j2.description };
}

async function archivePublication(publicationId: string): Promise<any> {
  const chatId = await getMediaChatId();
  if (!chatId) return { ok: false, error: 'DC Media chat_id не реєстрований — probe' };

  const { data: pub } = await sb.from('publications').select('id, title, text_body, publish_at, published_at, status').eq('id', publicationId).maybeSingle();
  if (!pub) return { ok: false, error: 'publication not found' };
  if (pub.status !== 'published') return { ok: false, error: `status=${pub.status}, skip` };

  const { data: cp } = await sb.from('creative_publications').select('creative_id, sort_order').eq('publication_id', publicationId).order('sort_order', { ascending: true });
  const ids = (cp || []).map((r: any) => r.creative_id);
  let creatives: any[] = [];
  if (ids.length) {
    const { data } = await sb.from('creatives')
      .select('id, type, name, compressed_url, compressed_url_hevc, poster_url, thumbnail_url, drive_file_id, width_px, height_px, duration_sec, compressed_size_bytes')
      .in('id', ids);
    const order = new Map(ids.map((id: string, i: number) => [id, i]));
    creatives = (data || []).slice().sort((a: any, b: any) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  }

  const cleanText = stripHtmlForCaption(pub.text_body || '');
  const titleLine = pub.title ? `<b>📅 ${esc(pub.title)}</b>\n\n` : '';
  const ts = pub.published_at || pub.publish_at;
  const dateLine = ts ? `\n\n<i>— ${new Date(ts).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' })} Київ</i>` : '';
  const caption = (titleLine + cleanText + dateLine).slice(0, 1024);

  if (!creatives.length) {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: titleLine + cleanText + '\n\n<i>(без прикріплених медіа)</i>' + dateLine, parse_mode: 'HTML', disable_web_page_preview: true, disable_notification: true })
    });
    if (!r.ok) return { ok: false, error: `sendMessage: ${(await r.text()).slice(0, 200)}` };
    return { ok: true, mode: 'text-no-media', chat_id: chatId };
  }

  const items: Item[] = [];
  for (const c of creatives) {
    const url = pickUrl(c);
    if (!url) continue;
    const isVideo = String(c.type || '').toLowerCase() === 'video';
    const size = c.compressed_size_bytes || await headSize(url);
    items.push({
      type: isVideo ? 'video' : 'photo', url, size,
      width: c.width_px || undefined, height: c.height_px || undefined,
      duration: c.duration_sec || undefined,
      poster: isVideo ? (c.poster_url || null) : null,
    });
  }
  if (!items.length) return { ok: false, error: 'no valid media URLs', creatives_count: creatives.length };

  const res = items.length === 1
    ? await sendSingle(chatId, items[0], caption)
    : await sendAlbum(chatId, items, caption);

  return {
    ok: res.ok, error: res.err, chat_id: chatId,
    media: items.map(i => `${i.type}:${(i.size / 1048576).toFixed(1)}MB${i.width ? `(${i.width}x${i.height})` : ''}${i.size > MAX_URL_BYTES ? ':multipart' : ':url'}`),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  const url = new URL(req.url);
  const probe = url.searchParams.get('probe') === '1';
  const action = url.searchParams.get('action');
  // 08.08.2026 (аудит): probe/register БУЛИ без auth — канал ексфільтрації (будь-хто міг
  // зареєструвати свій chat_id і отримувати ВЕСЬ архів медіа). Тепер секрет обов'язковий для всього.
  const headerSecret = req.headers.get('x-cron-secret') ?? req.headers.get('x-hq-cron-secret');
  if (!CRON_SECRET) return new Response(JSON.stringify({ error: 'secret not configured' }), { status: 500 });
  if (headerSecret !== CRON_SECRET) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });

  try {
    if (probe) return new Response(JSON.stringify(await probeKnownChats()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (action === 'register') {
      const body = await req.json().catch(() => ({}));
      const chatId = body.chat_id ? String(body.chat_id) : null;
      if (!chatId) return new Response(JSON.stringify({ error: 'chat_id required' }), { status: 400 });
      const info = await tgGetChat(chatId);
      await setMediaChatId(chatId, info.title || body.title);
      return new Response(JSON.stringify({ ok: true, chat_id: chatId, title: info.title, type: info.type }), { status: 200 });
    }
    const body = await req.json().catch(() => ({}));
    const publicationId = body.publication_id || url.searchParams.get('publication_id');
    if (!publicationId) return new Response(JSON.stringify({ error: 'publication_id required' }), { status: 400 });
    const result = await archivePublication(publicationId);
    return new Response(JSON.stringify(result), { status: result.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[dc-media-archive]', e);
    return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 500 });
  }
});
