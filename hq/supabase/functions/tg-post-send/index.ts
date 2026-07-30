// tg-post-send v16 — #aspect fix (18.07.2026): відео тепер шлеться з width/height/duration
//   + thumbnail (постер-кадр). Без цього TG desktop показував відео сплющеним у квадрат.
//   Розміри: creatives.width_px/height_px, fallback — з розмірів постера (JPG того ж кадру).
// v15 — #SMM utm off (Vadym 02.07.2026): appendUtm не додає utm-мітки до кнопок.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("HQ_DB_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";
const TG_BOT_TOKEN = Deno.env.get("TG_BOT_TOKEN") ?? "";
const CRON_SECRET = Deno.env.get("DC_CRON_SECRET") ?? Deno.env.get("HQ_CRON_SECRET") ?? "";
const DEFAULT_CHANNEL = Deno.env.get("DCSMM_TG_CHANNEL") || "-1003933841573";
const TEST_CHANNEL = "-1003933841573";

const MAX_CAPTION = 1024;
const MAX_URL_BYTES = 20 * 1024 * 1024;
const MAX_MULTIPART_BYTES = 50 * 1024 * 1024;
const MAX_PHOTO_DIM_SUM = 10000;
const RETRY_DELAYS = [30000, 60000, 120000, 300000];

type MediaItem = { type: 'photo' | 'video'; url: string; thumbnail_url?: string; poster_url?: string; width?: number; height?: number; duration?: number; size: number; mode: 'url' | 'multipart'; name: string; dimSum?: number; };

async function tgFetchJson(method: string, body: any): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(`TG ${method}: ${j.description || JSON.stringify(j)}`);
  return j.result;
}
async function tgFetchForm(method: string, form: FormData): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, { method: 'POST', body: form });
  const j = await r.json();
  if (!j.ok) throw new Error(`TG ${method} (multipart): ${j.description || JSON.stringify(j)}`);
  return j.result;
}
function escHtml(s: string): string { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
// 30.07.2026: .slice() рвав HTML посеред тега → Telegram відхиляв пост ("can't parse entities").
// trimHtml не ріже теги й закриває незакриті.
function trimHtml(s: string, max: number): string {
  if (!s || s.length <= max) return s || '';
  let cut = s.slice(0, max);
  const lo = cut.lastIndexOf('<'), lc = cut.lastIndexOf('>');
  if (lo > lc) cut = cut.slice(0, lo);
  const stack: string[] = [];
  const re = /<(\/?)([a-zA-Z-]+)[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cut)) !== null) {
    const tag = m[2].toLowerCase();
    if (m[1] === '/') { const i = stack.lastIndexOf(tag); if (i >= 0) stack.splice(i, 1); }
    else stack.push(tag);
  }
  while (stack.length) cut += `</${stack.pop()}>`;
  return cut;
}
function renderCountdown(text: string, until: string|null|undefined): string {
  if (!text || !until) return text || '';
  if (!text.includes('{{countdown}}')) return text;
  const ms = new Date(until).getTime() - Date.now();
  if (ms <= 0) return text.replace(/\{\{countdown\}\}/g, '⏰ Час вийшов');
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  let label: string;
  if (h >= 24) { const d = Math.floor(h / 24); label = `${d}д ${h % 24}г`; }
  else if (h > 0) label = `${h}г ${m}хв`;
  else label = `${m}хв`;
  return text.replace(/\{\{countdown\}\}/g, label);
}
function appendUtm(url: string, _pubId: string, _btnIdx: number, _campaign?: string): string {
  // #SMM utm off (Vadym 02.07.2026): усі мітки вносяться вручну — не додаємо utm автоматично.
  return url;
}
function buildInlineKeyboard(buttons: any[], pubId: string, campaign?: string): any | null {
  if (!buttons || !buttons.length) return null;
  const rows: Record<number, any[]> = {};
  buttons.forEach((b: any, idx: number) => {
    const row = b.row ?? idx;
    if (!rows[row]) rows[row] = [];
    const btn: any = { text: (b.text || `Button ${idx+1}`).slice(0, 64) };
    if (b.type === 'web_app' && b.web_app_url) btn.web_app = { url: b.web_app_url };
    else if (b.type === 'callback') btn.callback_data = `p:${pubId}:${idx}`.slice(0, 64);
    else if (b.url) btn.url = appendUtm(b.url, pubId, idx, campaign);
    else return;
    rows[row].push(btn);
  });
  const inline_keyboard = Object.keys(rows).sort((a,b) => +a - +b).map(k => rows[+k]).filter(r => r.length > 0);
  return inline_keyboard.length ? { inline_keyboard } : null;
}
function buildButtonLinks(buttons: any[], pubId: string, campaign?: string): string[] {
  const lines: string[] = [];
  buttons.forEach((b, idx) => {
    const text = escHtml((b.text || `Кнопка ${idx+1}`).slice(0, 64));
    if (b.type === 'url' && b.url) {
      const utmUrl = appendUtm(b.url, pubId, idx, campaign);
      lines.push(`🔗 <a href="${utmUrl}">${text}</a>`);
    } else if (b.type === 'web_app' && b.web_app_url) {
      lines.push(`📱 <a href="${b.web_app_url}">${text}</a>`);
    }
  });
  return lines;
}
function buildCaption(pub: any, buttonsInCaption?: any[]): string {
  const lines: string[] = [];
  if (pub.title) lines.push(`<b>${escHtml(pub.title)}</b>`);
  if (pub.text_body) {
    lines.push('');
    let body = pub.text_body;
    body = renderCountdown(body, pub.tg_countdown_until);
    body = body.replace(/<<<(.+?)>>>/gs, '<tg-spoiler>$1</tg-spoiler>');
    lines.push(body);
  }
  if (pub.hashtags && pub.hashtags.length) { lines.push(''); lines.push(pub.hashtags.map((h: string) => h.startsWith('#') ? h : '#'+h).join(' ')); }
  if (buttonsInCaption && buttonsInCaption.length) {
    const btnLines = buildButtonLinks(buttonsInCaption, pub.id, pub.tg_utm_campaign);
    if (btnLines.length) { lines.push(''); btnLines.forEach(l => lines.push(l)); }
  }
  return lines.join('\n');
}
async function loadCreatives(sb: any, pubId: string): Promise<any[]> {
  const { data } = await sb.from('creative_publications').select('creative_id, sort_order, creatives:creative_id (id, type, thumbnail_url, compressed_url, compressed_url_hevc, poster_url, width_px, height_px, duration_sec, drive_file_id, name)').eq('publication_id', pubId).order('sort_order', { ascending: true });
  if (!data) return [];
  return data.map((row: any) => row.creatives).filter((c: any) => !!c);
}
async function getJpegDimensions(url: string): Promise<{w: number; h: number} | null> {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-131071' } });
    if (!r.ok && r.status !== 206) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marker = buf[i+1];
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        const h = (buf[i+5] << 8) | buf[i+6]; const w = (buf[i+7] << 8) | buf[i+8]; return { w, h };
      }
      if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      const len = (buf[i+2] << 8) | buf[i+3];
      if (len < 2) return null;
      i += 2 + len;
    }
    return null;
  } catch { return null; }
}
// #aspect: width/height відео. Спершу з БД (width_px/height_px), інакше з постера (той самий кадр → той самий aspect).
async function resolveVideoDims(c: any): Promise<{ w?: number; h?: number }> {
  if (c.width_px && c.height_px) return { w: c.width_px, h: c.height_px };
  const src = c.poster_url || c.thumbnail_url;
  if (src) { const d = await getJpegDimensions(src); if (d && d.w && d.h) return { w: d.w, h: d.h }; }
  return {};
}
function storageResize(url: string, maxDim: number = 2000): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('supabase.co')) return null;
    if (!u.pathname.includes('/storage/v1/object/public/')) return null;
    const newPath = u.pathname.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
    const newUrl = new URL(u.origin + newPath);
    newUrl.searchParams.set('width', String(maxDim));
    newUrl.searchParams.set('height', String(maxDim));
    newUrl.searchParams.set('resize', 'contain');
    newUrl.searchParams.set('quality', '85');
    return newUrl.toString();
  } catch { return null; }
}
async function classifyMedia(url: string, type: 'photo'|'video', name: string, thumbnail_url?: string): Promise<MediaItem | { error: string }> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) return { error: `${type} ${name}: HTTP ${r.status} при HEAD` };
    const size = parseInt(r.headers.get('content-length') || '0', 10);
    if (size > MAX_MULTIPART_BYTES) {
      const mb = (size/1024/1024).toFixed(1);
      return { error: `${type} "${name}" завеликий: ${mb}МБ (хард-ліміт TG = 50МБ).` };
    }
    let finalUrl = url; let dimSum: number | undefined;
    if (type === 'photo') {
      const dims = await getJpegDimensions(url);
      if (dims) {
        dimSum = dims.w + dims.h;
        if (dimSum > MAX_PHOTO_DIM_SUM) {
          const resized = storageResize(url, 2000);
          if (resized) { finalUrl = resized; return { type, url: finalUrl, thumbnail_url, name, size: 0, mode: 'url', dimSum }; }
          else return { error: `photo "${name}" ${dims.w}×${dims.h}px (сума ${dimSum} > 10000 TG limit).` };
        }
      }
    }
    return { type, url: finalUrl, thumbnail_url, name, size, mode: size > MAX_URL_BYTES ? 'multipart' : 'url', dimSum };
  } catch (e: any) { return { error: `${type} ${name}: HEAD/dim fail ${e.message}` }; }
}
async function downloadBlob(url: string): Promise<Blob> { const r = await fetch(url); if (!r.ok) throw new Error(`Download fail: HTTP ${r.status}`); return r.blob(); }
function filenameFor(m: MediaItem, idx: number): string { return `${m.type}${idx}.${m.type === 'video' ? 'mp4' : 'jpg'}`; }

async function sendSingleMultipart(m: MediaItem, channelId: string, caption: string, replyMarkup: any, silent: boolean): Promise<any> {
  const form = new FormData();
  form.append('chat_id', channelId);
  if (caption) { form.append('caption', trimHtml(caption, MAX_CAPTION)); form.append('parse_mode', 'HTML'); }
  if (silent) form.append('disable_notification', 'true');
  if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
  const blob = await downloadBlob(m.url);
  const fname = filenameFor(m, 0);
  if (m.type === 'video') {
    form.append('video', blob, fname);
    form.append('supports_streaming', 'true');
    // #aspect: без width/height TG desktop показує квадрат
    if (m.width) form.append('width', String(m.width));
    if (m.height) form.append('height', String(m.height));
    if (m.duration) form.append('duration', String(m.duration));
    if (m.poster_url) { try { const tb = await downloadBlob(m.poster_url); form.append('thumbnail', tb, 'thumb.jpg'); } catch { /* thumb optional */ } }
    return await tgFetchForm('sendVideo', form);
  }
  else { form.append('photo', blob, fname); return await tgFetchForm('sendPhoto', form); }
}
async function sendAlbumMultipart(items: MediaItem[], channelId: string, caption: string, silent: boolean): Promise<any> {
  const form = new FormData();
  form.append('chat_id', channelId);
  if (silent) form.append('disable_notification', 'true');
  const mediaJson: any[] = [];
  const blobs = await Promise.all(items.slice(0, 10).map(m => downloadBlob(m.url)));
  items.slice(0, 10).forEach((m, i) => {
    const attach = `m${i}`;
    const item: any = { type: m.type, media: `attach://${attach}` };
    if (i === 0 && caption) { item.caption = trimHtml(caption, MAX_CAPTION); item.parse_mode = 'HTML'; }
    if (m.type === 'video') { item.supports_streaming = true; if (m.width) item.width = m.width; if (m.height) item.height = m.height; if (m.duration) item.duration = m.duration; }
    mediaJson.push(item);
    form.append(attach, blobs[i], filenameFor(m, i));
  });
  form.append('media', JSON.stringify(mediaJson));
  const result = await tgFetchForm('sendMediaGroup', form);
  return Array.isArray(result) ? result[0] : result;
}
async function sendAlbumUrl(items: MediaItem[], channelId: string, caption: string, silent: boolean): Promise<any> {
  const media = items.slice(0, 10).map((m, i) => {
    const item: any = { type: m.type, media: m.url };
    if (i === 0 && caption) { item.caption = trimHtml(caption, MAX_CAPTION); item.parse_mode = 'HTML'; }
    if (m.type === 'video') { item.supports_streaming = true; if (m.width) item.width = m.width; if (m.height) item.height = m.height; if (m.duration) item.duration = m.duration; }
    return item;
  });
  const result = await tgFetchJson('sendMediaGroup', { chat_id: channelId, disable_notification: silent, media });
  return Array.isArray(result) ? result[0] : result;
}

async function sendPublication(sb: any, pub: any, opts: { test?: boolean; force_channel?: string }) {
  console.log('[sendPub v16] start', { pubId: pub.id, test: opts.test, force_channel: opts.force_channel });
  const channelId = opts.force_channel || (opts.test ? TEST_CHANNEL : (pub.tg_channel_id || DEFAULT_CHANNEL));
  const buttons = Array.isArray(pub.tg_buttons) ? pub.tg_buttons : [];
  const silent = !!pub.tg_silent;
  const creatives = await loadCreatives(sb, pub.id);

  const mediaItems: MediaItem[] = [];
  const errors: string[] = [];
  const dims: string[] = [];
  for (const c of creatives) {
    if (c.type === 'video') {
      const vid = c.compressed_url || c.compressed_url_hevc;
      if (!vid) { errors.push(`video "${c.name}": немає URL`); continue; }
      const cls = await classifyMedia(vid, 'video', c.name || 'video', c.thumbnail_url);
      if ('error' in cls) { errors.push(cls.error); continue; }
      // #aspect: додаємо розміри + постер-thumbnail, щоб TG не плющив у квадрат
      const vd = await resolveVideoDims(c);
      cls.width = vd.w; cls.height = vd.h;
      cls.duration = c.duration_sec || undefined;
      cls.poster_url = c.poster_url || c.thumbnail_url || undefined;
      mediaItems.push(cls);
    } else {
      const img = c.thumbnail_url || c.compressed_url;
      if (!img) { errors.push(`photo "${c.name}": немає URL`); continue; }
      const cls = await classifyMedia(img, 'photo', c.name || 'photo');
      if ('error' in cls) { errors.push(cls.error); continue; }
      mediaItems.push(cls);
      if (cls.dimSum) dims.push(`${c.name}:${cls.dimSum}`);
    }
  }
  mediaItems.sort((a, b) => (a.type === 'photo' ? 0 : 1) - (b.type === 'photo' ? 0 : 1));

  if (mediaItems.length === 0 && errors.length > 0 && !pub.text_body && !pub.title) {
    throw new Error('Жодного media не можна відправити: ' + errors.join('; '));
  }

  const isAlbum = mediaItems.length >= 2;
  const captionWithButtons = isAlbum ? buildCaption(pub, buttons.length > 0 ? buttons : undefined) : buildCaption(pub);
  const captionPlain = buildCaption(pub);
  const reply_markup = isAlbum ? null : buildInlineKeyboard(buttons, pub.id, pub.tg_utm_campaign);
  const hasMultipart = mediaItems.some(m => m.mode === 'multipart');
  let result: any;

  if (mediaItems.length === 0) {
    const text = captionWithButtons || (pub.title ? `<b>${escHtml(pub.title)}</b>` : '(порожній пост)');
    const body: any = { chat_id: channelId, text, parse_mode: 'HTML', disable_notification: silent, disable_web_page_preview: !!pub.tg_disable_preview };
    const rm = buildInlineKeyboard(buttons, pub.id, pub.tg_utm_campaign);
    if (rm) body.reply_markup = rm;
    result = await tgFetchJson('sendMessage', body);
  } else if (mediaItems.length === 1) {
    const m = mediaItems[0];
    if (m.mode === 'multipart') result = await sendSingleMultipart(m, channelId, captionPlain, reply_markup, silent);
    else {
      const body: any = { chat_id: channelId, caption: captionPlain.slice(0, MAX_CAPTION), parse_mode: 'HTML', disable_notification: silent };
      if (reply_markup) body.reply_markup = reply_markup;
      if (m.type === 'video') {
        body.video = m.url; body.supports_streaming = true;
        // #aspect: розміри й у URL-режимі
        if (m.width) body.width = m.width;
        if (m.height) body.height = m.height;
        if (m.duration) body.duration = m.duration;
        if (m.poster_url) body.thumbnail = m.poster_url;
        result = await tgFetchJson('sendVideo', body);
      }
      else { body.photo = m.url; result = await tgFetchJson('sendPhoto', body); }
    }
  } else {
    result = hasMultipart
      ? await sendAlbumMultipart(mediaItems, channelId, captionWithButtons, silent)
      : await sendAlbumUrl(mediaItems, channelId, captionWithButtons, silent);
  }

  const messageId = result?.message_id;
  console.log('[sendPub v16] sent', { messageId, channelId });
  if (pub.tg_pin && messageId && !opts.test) {
    try { await tgFetchJson('pinChatMessage', { chat_id: channelId, message_id: messageId, disable_notification: silent }); }
    catch (e: any) { console.warn('[pin]', pub.id, e.message); }
  }
  return { channelId, messageId, mediaCount: mediaItems.length, mediaModes: mediaItems.map(m => `${m.type}:${m.mode}${m.width&&m.height?`(${m.width}x${m.height})`:''}`), buttonsCount: buttons.length, buttonsMode: isAlbum && buttons.length > 0 ? 'caption_links' : (buttons.length > 0 ? 'inline_keyboard' : 'none'), sendMode: mediaItems.length === 0 ? 'text' : mediaItems.length === 1 ? 'single' : 'album', skipped: errors.length > 0 ? errors : undefined, dims: dims.length > 0 ? dims : undefined };
}

async function recordAnalytics(sb: any, pubId: string, channelId: string, messageId: number) {
  if (!messageId) return;
  await sb.from('tg_post_analytics').upsert({ publication_id: pubId, channel_id: channelId, message_id: messageId, first_published_at: new Date().toISOString(), last_synced_at: new Date().toISOString() }, { onConflict: 'channel_id,message_id' });
}
async function processOnce(sb: any, pub: any, opts: any) {
  const r = await sendPublication(sb, pub, opts);
  if (opts.test) {
    const existing = Array.isArray(pub.tg_test_log) ? pub.tg_test_log : [];
    existing.push({ channel_id: r.channelId, sent_at: new Date().toISOString(), message_id: r.messageId, ok: true, media_modes: r.mediaModes, buttons_mode: r.buttonsMode, send_mode: r.sendMode, skipped: r.skipped, dims: r.dims });
    await sb.from('publications').update({ tg_test_log: existing.slice(-50) }).eq('id', pub.id);
  }
  return { ok: true, attempts: 1, ...r };
}
async function processWithRetry(sb: any, pub: any, opts: any, jobId?: string) {
  if (!opts.test && pub.tg_message_id) {
    const existingMap = typeof pub.tg_message_id === 'object' ? pub.tg_message_id : null;
    const channel = opts.force_channel || pub.tg_channel_id || DEFAULT_CHANNEL;
    if (existingMap && existingMap[channel]) return { ok: true, alreadySent: true, channelId: channel, messageId: existingMap[channel] };
  }
  let lastErr: any = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const r = await sendPublication(sb, pub, opts);
      if (r.messageId) {
        const newMap = (typeof pub.tg_message_id === 'object' && pub.tg_message_id) ? { ...pub.tg_message_id } : {};
        newMap[r.channelId] = r.messageId;
        await sb.from('publications').update({ tg_message_id: newMap, tg_published_channel_id: r.channelId, autopost_status: 'sent' }).eq('id', pub.id);
        await recordAnalytics(sb, pub.id, r.channelId, r.messageId);
      }
      if (jobId) await sb.rpc('complete_autopost_job', { job_id: jobId, pub_id: pub.id }).catch(() => {});
      return { ok: true, attempts: attempt + 1, ...r };
    } catch (e: any) {
      lastErr = e;
      console.warn(`[attempt ${attempt+1}] pub=${pub.id}`, e.message);
      if (attempt < RETRY_DELAYS.length) await new Promise(res => setTimeout(res, RETRY_DELAYS[attempt]));
    }
  }
  await sb.from('publications').update({ autopost_status: 'failed', autopost_error: (lastErr?.message || String(lastErr)).slice(0, 500) }).eq('id', pub.id);
  if (jobId) await sb.rpc('fail_autopost_job', { job_id: jobId, pub_id: pub.id, err_msg: (lastErr?.message || String(lastErr)).slice(0, 500) }).catch(() => {});
  throw lastErr || new Error('All retries failed');
}
async function checkJwtAuth(req: Request, sb: any): Promise<{ ok: boolean; userId?: string; reason?: string; role?: string }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return { ok: false, reason: 'no_auth_header' };
  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error) {
      const msg = String(error.message || error).toLowerCase();
      if (msg.includes('expired') || msg.includes('jwt')) return { ok: false, reason: 'token_expired' };
      return { ok: false, reason: 'getuser_error:' + msg.slice(0, 60) };
    }
    if (!user) return { ok: false, reason: 'no_user_in_token' };
    const { data: rows, error: rpcErr } = await sb.rpc('resolve_user_by_auth', { p_auth_id: user.id });
    if (rpcErr) return { ok: false, reason: 'rpc_error:' + String(rpcErr.message || '').slice(0, 60) };
    const u = Array.isArray(rows) ? rows[0] : rows;
    if (!u) return { ok: false, reason: 'no_user_row_for_auth_id:' + user.id.slice(0, 8) };
    if (!['ceo', 'coo', 'lead'].includes(u.role)) return { ok: false, reason: 'role_blocked:' + u.role, role: u.role };
    return { ok: true, userId: u.id, role: u.role };
  } catch (e: any) { return { ok: false, reason: 'catch:' + String(e?.message || e).slice(0, 60) }; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-cron-secret, x-hq-cron-secret, content-type', 'Access-Control-Allow-Methods': 'POST' } });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const cors: Record<string,string> = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (!CRON_SECRET) return new Response(JSON.stringify({ error: 'CRON_SECRET missing' }), { status: 500, headers: cors });
  if (!SUPABASE_URL || !SERVICE_KEY || !TG_BOT_TOKEN) return new Response(JSON.stringify({ error: 'missing env' }), { status: 500, headers: cors });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let body: any = {};
  try { body = await req.json(); } catch {}
  const pubId = body.publication_id;
  const test = body.test === true;
  const forceChannel = body.force_channel || undefined;
  const jobId = body.job_id || undefined;
  const cronHeader = req.headers.get('x-cron-secret') || req.headers.get('x-hq-cron-secret');
  let authOk = (cronHeader === CRON_SECRET);
  let jwtReason: string | undefined;
  let jwtRole: string | undefined;
  if (!authOk && test) { const jwt = await checkJwtAuth(req, sb); authOk = jwt.ok; jwtReason = jwt.reason; jwtRole = jwt.role; }
  if (!authOk) {
    console.warn('[tg-post-send v16] 401', { jwtReason, jwtRole, hasCron: !!cronHeader });
    return new Response(JSON.stringify({ error: 'unauthorized', reason: jwtReason || (cronHeader ? 'cron_mismatch' : 'no_auth'), role: jwtRole }), { status: 401, headers: cors });
  }
  if (!pubId) return new Response(JSON.stringify({ error: 'publication_id required' }), { status: 400, headers: cors });
  try {
    const { data: pub, error } = await sb.from('publications').select('*').eq('id', pubId).maybeSingle();
    if (error) throw error;
    if (!pub) return new Response(JSON.stringify({ error: 'publication not found' }), { status: 404, headers: cors });
    const result = test ? await processOnce(sb, pub, { test, force_channel: forceChannel }) : await processWithRetry(sb, pub, { test, force_channel: forceChannel }, jobId);
    return new Response(JSON.stringify({ ok: true, version: 'v16-aspect-fix', ...result }), { status: 200, headers: cors });
  } catch (e: any) {
    const msg = String(e?.message || e);
    const stack = String(e?.stack || '').slice(0, 1000);
    console.error('[tg-post-send v16 ERR] pub=' + (body?.publication_id || 'unknown'), msg, '\n', stack);
    return new Response(JSON.stringify({ error: msg.slice(0, 500), stack: stack.slice(0, 500) }), { status: 500, headers: cors });
  }
});
