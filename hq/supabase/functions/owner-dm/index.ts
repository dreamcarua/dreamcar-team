// =====================================================================
// owner-dm (04.11.2026) — особисті повідомлення власника боту → Claude Code (Opus) на Mac Studio.
//
// Канал 1 — tg-webhook (x-hq-cron-secret):
//   POST { message }   — повідомлення власника в особистому чаті з ботом (текст, голос, файли з підписом, reply)
//   POST { callback }  — кнопки ✅/❌ (дані od:<id>:y|n), приймаються лише від власника
// Канал 2 — воркер на Mac Studio (x-cd-worker: токен; sha256 = app_secrets.cd_worker_secret_sha256):
//   { action: "claim", worker, version }   → наступна задача + контекст (сесія батьківської задачі) або null
//   { action: "file", file_id }            → байти файлу з Telegram (токен бота на Mac Studio не потрібен)
//   { action: "session", id, session_id }  → зберегти id сесії Claude Code
//   { action: "progress", id, text }       → короткий статус у повідомленні «⏳»
//   { action: "confirm", id, text }        → план дії з кнопками ✅/❌, статус need_ok
//   { action: "reply", id, text, final }   → відповідь власнику (HTML), final → статус done
//   { action: "send_file", id, name, b64, caption } → файл власнику
//   { action: "fail", id, error }          → статус failed + повідомлення
//   { action: "state", id }                → { status, approval, cancel_requested }
//   { action: "team_find", id, kind, search }          → читання для колег (RPC team_bot_find)
//   { action: "team_update", id, kind, row_id, fields } → дрібна правка від імені автора (RPC team_bot_update)
//   { action: "creative", id, brief }                → задача у відділ креативів (creative_requests); файли запиту
//                                                        → медіатека (media-intake force), результат прийде файлами в цей же чат
// Власник: app_secrets.owner_dm_tg_ids (через кому).
// Робочі чати (04.11.2026): tg_listening_chats (крім чату Media), автор — користувач HQ, бота тегнули або відповіли
// на повідомлення цієї системи → задача mode=team. Для колег на ✅ іде план власнику в особисті.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TG_BOT_TOKEN   = Deno.env.get("TG_BOT_TOKEN") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_CRON_SECRET = Deno.env.get("HQ_CRON_SECRET") ?? "";
const CONTINUE_MS    = 60 * 60 * 1000;   // нове повідомлення без reply продовжує сесію, якщо остання задача була < 60 хв тому
const CANCEL_RE      = /^(❌|✖️|стоп|stop|скасуй|скасувати|отмена|отменить|cancel)(?=$|[\s!.,])/iu;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let d = 0; for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return await r.json().catch(() => ({ ok: false }));
}
const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function ownerIds(sb: any): Promise<Set<number>> {
  const { data } = await sb.from("app_secrets").select("value").eq("key", "owner_dm_tg_ids").maybeSingle();
  return new Set(String(data?.value || "").split(",").map((s) => Number(s.trim())).filter((n) => n));
}

// Надіслати текст (HTML) частинами ≤ 4000 символів; повертає message_id усіх частин.
async function sendLong(chatId: number, html: string, replyTo?: number, extra: Record<string, unknown> = {}): Promise<number[]> {
  const ids: number[] = [];
  const parts: string[] = [];
  let rest = html || "—";
  while (rest.length > 4000) {
    let cut = rest.lastIndexOf("\n", 4000);
    if (cut < 2000) cut = 4000;
    parts.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  parts.push(rest);
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    const body: Record<string, unknown> = { chat_id: chatId, text: parts[i], parse_mode: "HTML", disable_web_page_preview: true, ...(last ? extra : {}) };
    if (i === 0 && replyTo) body.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
    let r = await tg("sendMessage", body);
    if (!r.ok && /parse/i.test(String(r.description || ""))) {   // зламаний HTML → шлемо як звичайний текст
      delete body.parse_mode; body.text = parts[i].replace(/<[^>]+>/g, "");
      r = await tg("sendMessage", body);
    }
    if (r.ok) ids.push(r.result.message_id);
  }
  return ids;
}

function filesOf(m: any): any[] {
  const out: any[] = [];
  if (m.photo?.length) { const p = m.photo[m.photo.length - 1]; out.push({ file_id: p.file_id, kind: "photo", name: `photo_${m.message_id}.jpg`, mime: "image/jpeg", size: p.file_size }); }
  if (m.document) out.push({ file_id: m.document.file_id, kind: "document", name: m.document.file_name || `file_${m.message_id}`, mime: m.document.mime_type, size: m.document.file_size });
  if (m.video) out.push({ file_id: m.video.file_id, kind: "video", name: m.video.file_name || `video_${m.message_id}.mp4`, mime: m.video.mime_type, size: m.video.file_size });
  if (m.voice) out.push({ file_id: m.voice.file_id, kind: "voice", name: `voice_${m.message_id}.ogg`, mime: m.voice.mime_type || "audio/ogg", size: m.voice.file_size });
  if (m.audio) out.push({ file_id: m.audio.file_id, kind: "audio", name: m.audio.file_name || `audio_${m.message_id}`, mime: m.audio.mime_type, size: m.audio.file_size });
  if (m.video_note) out.push({ file_id: m.video_note.file_id, kind: "video_note", name: `circle_${m.message_id}.mp4`, mime: "video/mp4", size: m.video_note.file_size });
  return out;
}

async function workerAlive(sb: any): Promise<boolean> {
  const { data } = await sb.from("owner_dm_worker").select("seen_at").order("seen_at", { ascending: false }).limit(1);
  const t = data?.[0]?.seen_at ? new Date(data[0].seen_at).getTime() : 0;
  return Date.now() - t < 3 * 60 * 1000;
}

// ---------- Канал 1: робочі чати (колеги) ----------
const BOT_MENTION = "@dreamcar_team_bot";
async function onGroupMessage(sb: any, m: any) {
  const chatId = Number(m.chat.id);
  const { data: ex } = await sb.from("app_secrets").select("value").eq("key", "team_bot_excluded_chats").maybeSingle();
  if (String(ex?.value || "").split(",").map((x: string) => Number(x.trim())).includes(chatId)) return { ignored: "excluded chat" };
  const { data: lc } = await sb.from("tg_listening_chats").select("chat_id,chat_title").eq("chat_id", chatId).maybeSingle();
  if (!lc) return { ignored: "not a work chat" };
  const text = String(m.text || m.caption || "").trim();
  const rt = m.reply_to_message;
  let parent: any = null;
  if (rt?.message_id && rt?.from?.is_bot) {
    const rid = rt.message_id;
    const { data } = await sb.from("owner_dm_jobs").select("*").eq("chat_id", chatId)
      .or(`ack_msg_id.eq.${rid},bot_msg_ids.cs.{${rid}}`).order("id", { ascending: false }).limit(1);
    parent = data?.[0] || null;
  }
  const mentioned = text.toLowerCase().includes(BOT_MENTION);
  if (!mentioned && !parent) return { ignored: "not addressed" };
  const { data: u } = await sb.from("users").select("id,name").eq("tg_chat_id", Number(m.from?.id)).maybeSingle();
  if (!u) return { ignored: "author is not an HQ user" };

  // контекст: останні повідомлення чату з буфера
  const { data: buf } = await sb.from("tg_chat_buffer").select("message_id,user_name,text,caption,ts")
    .eq("chat_id", chatId).lt("message_id", m.message_id).order("message_id", { ascending: false }).limit(15);
  const recent = (buf || []).reverse().map((x: any) => `${x.user_name || "?"}: ${String(x.text || x.caption || "").slice(0, 400)}`).join("\n");
  const quoted = rt ? `${rt.from?.first_name || "?"}: ${String(rt.text || rt.caption || "").slice(0, 3000)}` : "";
  const ctx = [quoted && `Процитоване повідомлення:\n${quoted}`, recent && `Останні повідомлення чату:\n${recent}`].filter(Boolean).join("\n\n");

  const files = filesOf(m);
  if (rt) for (const f of filesOf(rt)) files.push({ ...f, from_reply: true });
  const { data: job, error } = await sb.from("owner_dm_jobs").insert({
    chat_id: chatId, message_id: m.message_id, text: text.replace(new RegExp(BOT_MENTION, "ig"), "").trim() || null,
    reply_to_msg_id: rt?.message_id ?? null, reply_context: ctx.slice(0, 8000) || null, files,
    parent_job_id: parent?.id ?? null, mode: "team", from_tg_id: Number(m.from.id), from_name: u.name, chat_title: lc.chat_title,
    raw_message: m,
  }).select("*").single();
  if (error) { if (String(error.code) === "23505") return { duplicate: true }; throw error; }
  const ids = await sendLong(chatId, "⏳ Дивлюсь…", m.message_id);
  if (ids[0]) await sb.from("owner_dm_jobs").update({ ack_msg_id: ids[0] }).eq("id", job.id);
  return { queued_team: job.id };
}

// ---------- Канал 1: повідомлення власника ----------
async function onMessage(sb: any, m: any) {
  if (m?.chat?.type === "group" || m?.chat?.type === "supergroup") return await onGroupMessage(sb, m);
  const owners = await ownerIds(sb);
  if (m?.chat?.type !== "private" || !owners.has(Number(m?.from?.id))) return { ignored: "not owner" };
  const chatId = Number(m.chat.id);
  const text = String(m.text || m.caption || "").trim();
  const rt = m.reply_to_message;

  // Пошук задачі, до якої належить повідомлення бота, на яке відповіли
  let parent: any = null;
  if (rt?.message_id) {
    const rid = rt.message_id;
    const { data } = await sb.from("owner_dm_jobs").select("*").eq("chat_id", chatId)
      .or(`ack_msg_id.eq.${rid},confirm_msg_id.eq.${rid},message_id.eq.${rid},bot_msg_ids.cs.{${rid}}`)
      .order("id", { ascending: false }).limit(1);
    parent = data?.[0] || null;
  }

  // «❌ / стоп» — скасувати поточну задачу
  if (CANCEL_RE.test(text)) {
    const q = parent ? sb.from("owner_dm_jobs").select("*").eq("id", parent.id)
                     : sb.from("owner_dm_jobs").select("*").eq("chat_id", chatId).in("status", ["queued", "working", "need_ok"]).order("id", { ascending: false }).limit(1);
    const { data } = await q;
    const j = data?.[0];
    if (j && ["queued", "working", "need_ok"].includes(j.status)) {
      await sb.from("owner_dm_jobs").update({ cancel_requested: true, status: j.status === "working" ? "working" : "cancelled", updated_at: new Date().toISOString(), finished_at: j.status === "working" ? null : new Date().toISOString() }).eq("id", j.id);
      await sendLong(chatId, "🛑 Зупиняю.", m.message_id);
      return { cancelled: j.id };
    }
  }

  // Без reply на задачу: продовжуємо останню сесію, якщо вона була нещодавно
  if (!parent && !rt) {
    const { data } = await sb.from("owner_dm_jobs").select("*").eq("chat_id", chatId).not("session_id", "is", null)
      .order("id", { ascending: false }).limit(1);
    const last = data?.[0];
    if (last && Date.now() - new Date(last.finished_at || last.updated_at).getTime() < CONTINUE_MS) parent = last;
  }

  const replyContext = rt && !parent ? String(rt.text || rt.caption || "").slice(0, 6000) : (rt ? String(rt.text || rt.caption || "").slice(0, 3000) : null);
  const files = filesOf(m);
  if (rt && !parent) for (const f of filesOf(rt)) files.push({ ...f, from_reply: true });

  const { data: job, error } = await sb.from("owner_dm_jobs").insert({
    chat_id: chatId, message_id: m.message_id, text: text || null,
    reply_to_msg_id: rt?.message_id ?? null, reply_context: replyContext,
    files, parent_job_id: parent?.id ?? null, raw_message: m,
  }).select("*").single();
  if (error) {
    if (String(error.code) === "23505") return { duplicate: true };
    throw error;
  }

  const alive = await workerAlive(sb);
  const { count } = await sb.from("owner_dm_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "working"]).lt("id", job.id);
  let ack = "⏳ Прийняв, працюю.";
  if ((count || 0) > 0) ack += ` У черзі переді мною: ${count}.`;
  if (!alive) ack += "\n⚠️ Mac Studio зараз не відповідає. Задача в черзі, виконаю, щойно він повернеться.";
  const ids = await sendLong(chatId, ack, m.message_id);
  if (ids[0]) await sb.from("owner_dm_jobs").update({ ack_msg_id: ids[0] }).eq("id", job.id);
  return { queued: job.id };
}

async function onCallback(sb: any, cb: any) {
  const owners = await ownerIds(sb);
  const [_, idS, yn] = String(cb?.data || "").split(":");
  const answer = (text: string) => tg("answerCallbackQuery", { callback_query_id: cb.id, text });
  if (!owners.has(Number(cb?.from?.id))) { await answer("Лише власник"); return { denied: true }; }
  const id = Number(idS);
  const { data: j } = await sb.from("owner_dm_jobs").select("*").eq("id", id).maybeSingle();
  if (!j) { await answer("Задачу не знайдено"); return { missing: id }; }
  if (j.status !== "need_ok") { await answer(`Уже: ${j.status}`); return { stale: id }; }
  const now = new Date().toISOString();
  const yes = yn === "y";
  await sb.from("owner_dm_jobs").update(yes
    ? { status: "queued", approval: "approved", approved_at: now, updated_at: now }
    : { status: "cancelled", approval: "declined", finished_at: now, updated_at: now }).eq("id", id).eq("status", "need_ok");
  const dm = Number(cb.from.id);   // особистий чат власника = його tg id
  const confirmChat = j.mode === "team" ? dm : j.chat_id;
  if (j.confirm_msg_id) {
    await tg("editMessageReplyMarkup", { chat_id: confirmChat, message_id: j.confirm_msg_id, reply_markup: { inline_keyboard: [] } });
  }
  await sendLong(confirmChat, yes ? "✅ Погоджено, виконую." : "❌ Скасовано, нічого не змінюю.", j.confirm_msg_id || j.message_id);
  if (j.mode === "team") {
    await sendLong(j.chat_id, yes ? "✅ Вадим погодив, виконую." : "❌ Вадим не погодив, нічого не змінюю.", j.message_id);
  }
  await answer(yes ? "Виконую" : "Скасовано");
  return { id, approved: yes };
}

// ---------- Канал 2: воркер ----------
async function workerAction(sb: any, b: any): Promise<Response> {
  const act = String(b.action || "");
  const now = new Date().toISOString();

  if (act === "claim") {
    const worker = String(b.worker || "mac-studio").slice(0, 60);
    await sb.from("owner_dm_worker").upsert({ worker, seen_at: now, version: String(b.version || "").slice(0, 40) });
    const { data, error } = await sb.rpc("owner_dm_claim", { p_worker: worker });
    if (error) return json(500, { error: error.message });
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return json(200, { job: null });
    let parent: any = null;
    if (job.parent_job_id) {
      const { data: p } = await sb.from("owner_dm_jobs").select("id,session_id,text,result,confirm_text,status,approval,error,from_name,reply_context").eq("id", job.parent_job_id).maybeSingle();
      parent = p;
    }
    return json(200, { job, parent });
  }

  if (act === "file") {
    const fid = String(b.file_id || "");
    const info = await tg("getFile", { file_id: fid });
    if (!info.ok) return json(400, { error: info.description || "getFile failed" });
    const r = await fetch(`https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${info.result.file_path}`);
    if (!r.ok) return json(502, { error: `download ${r.status}` });
    return new Response(r.body, { status: 200, headers: { "content-type": "application/octet-stream" } });
  }

  const id = Number(b.id);
  const { data: j } = await sb.from("owner_dm_jobs").select("*").eq("id", id).maybeSingle();
  if (!j) return json(404, { error: "job not found" });

  if (act === "state") return json(200, { status: j.status, approval: j.approval, cancel_requested: j.cancel_requested });

  if (act === "session") {
    await sb.from("owner_dm_jobs").update({ session_id: String(b.session_id || "").slice(0, 80), updated_at: now }).eq("id", id);
    return json(200, { ok: true });
  }

  if (act === "progress") {
    const t = `⏳ ${esc(String(b.text || "").slice(0, 600))}`;
    if (j.ack_msg_id) await tg("editMessageText", { chat_id: j.chat_id, message_id: j.ack_msg_id, text: t, parse_mode: "HTML", disable_web_page_preview: true });
    else { const ids = await sendLong(j.chat_id, t, j.message_id); if (ids[0]) await sb.from("owner_dm_jobs").update({ ack_msg_id: ids[0] }).eq("id", id); }
    await sb.from("owner_dm_jobs").update({ updated_at: now }).eq("id", id);
    return json(200, { ok: true });
  }

  if (act === "confirm") {
    const text = String(b.text || "").slice(0, 3500);
    const kb = { reply_markup: { inline_keyboard: [[{ text: "✅ Виконати", callback_data: `od:${id}:y` }, { text: "❌ Скасувати", callback_data: `od:${id}:n` }]] } };
    let ids: number[] = [], groupIds: number[] = [];
    if (j.mode === "team") {
      const owner = [...(await ownerIds(sb))][0];
      if (!owner) return json(500, { error: "owner_dm_tg_ids not set" });
      const head = `🟡 <b>Запит від ${esc(j.from_name || "колеги")}</b> у «${esc(j.chat_title || "чат")}»:\n<i>${esc((j.text || "").slice(0, 600))}</i>\n\n<b>План:</b>\n`;
      ids = await sendLong(owner, head + esc(text), undefined, kb);
      groupIds = await sendLong(j.chat_id, "🟡 Це потребує погодження Вадима. Передав йому план, напишу тут, щойно він вирішить.", j.message_id);
    } else {
      ids = await sendLong(j.chat_id, `🟡 <b>Потрібне твоє ✅</b>\n\n${b.html ? text : esc(text)}`, j.message_id, kb);
    }
    const mid = ids[ids.length - 1] ?? null;
    await sb.from("owner_dm_jobs").update({
      status: "need_ok", confirm_text: text, confirm_msg_id: mid, approval: null, approved_at: null,
      bot_msg_ids: [...(j.bot_msg_ids || []), ...(j.mode === "team" ? groupIds : ids)], updated_at: now,
    }).eq("id", id);
    if (j.ack_msg_id) await tg("deleteMessage", { chat_id: j.chat_id, message_id: j.ack_msg_id });
    return json(200, { ok: true, confirm_msg_id: mid });
  }

  if (act === "creative") {
    const brief = String(b.brief || "").trim().slice(0, 6000);
    if (!brief) return json(400, { error: "brief required" });
    if (j.creative_request_id) return json(200, { ok: true, already: j.creative_request_id });
    const raw = j.raw_message;
    if (!raw?.chat?.id) return json(400, { error: "no source message stored for this job" });
    const hdr = { "content-type": "application/json", "x-hq-cron-secret": HQ_CRON_SECRET };
    const hasFiles = !!(raw.photo || raw.video || raw.document || raw.animation || raw.reply_to_message?.photo || raw.reply_to_message?.video || raw.reply_to_message?.document);
    // 1) файли запиту (і повідомлення, на яке відповіли) → медіатека, щоб воркер креативів їх бачив
    for (const msg of [raw, raw.reply_to_message].filter((x: any) => x && (x.photo || x.video || x.document || x.animation))) {
      const mm = { ...msg, chat: msg.chat || raw.chat };
      await fetch(`${SUPABASE_URL}/functions/v1/media-intake`, { method: "POST", headers: hdr, body: JSON.stringify({ message: mm, force: true }) })
        .then((r) => r.text()).catch((e) => console.error("[creative intake]", e));
    }
    // 2) запит у чергу відділу креативів; відповіді й результати — у цей же чат, reply на повідомлення автора
    const r = await fetch(`${SUPABASE_URL}/functions/v1/creative-request`, {
      method: "POST", headers: hdr, body: JSON.stringify({ enqueue: { message: raw, text: brief, has_files: hasFiles } }),
    });
    const res = await r.json().catch(() => ({}));
    if (!r.ok || !res.queued) return json(502, { error: `creative-request: ${JSON.stringify(res).slice(0, 300)}` });
    await sb.from("owner_dm_jobs").update({ creative_request_id: res.queued, updated_at: now }).eq("id", id);
    return json(200, { ok: true, creative_request_id: res.queued });
  }

  if (act === "team_find") {
    const { data, error } = await sb.rpc("team_bot_find", { p_kind: String(b.kind || ""), p_search: b.search ?? null, p_limit: Number(b.limit || 20) });
    if (error) return json(400, { error: error.message });
    return json(200, data);
  }

  if (act === "team_update") {
    if (!j.from_tg_id && j.mode === "team") return json(400, { error: "no author" });
    const actor = j.mode === "team" ? j.from_tg_id : [...(await ownerIds(sb))][0];
    const { data, error } = await sb.rpc("team_bot_update", { p_kind: String(b.kind || ""), p_id: String(b.row_id || ""), p_fields: b.fields || {}, p_actor_tg: actor });
    if (error) return json(400, { error: error.message });
    return json(200, data);
  }

  if (act === "reply") {
    const ids = await sendLong(j.chat_id, String(b.text || "—"), j.message_id);
    const upd: Record<string, unknown> = { bot_msg_ids: [...(j.bot_msg_ids || []), ...ids], updated_at: now };
    if (b.final) {
      upd.result = String(b.text || "").slice(0, 20000);
      if (j.status === "working") { upd.status = "done"; upd.finished_at = now; }
    }
    await sb.from("owner_dm_jobs").update(upd).eq("id", id);
    if (b.final && j.ack_msg_id) await tg("deleteMessage", { chat_id: j.chat_id, message_id: j.ack_msg_id });
    return json(200, { ok: true, message_ids: ids });
  }

  if (act === "send_file") {
    const bytes = Uint8Array.from(atob(String(b.b64 || "")), (c) => c.charCodeAt(0));
    const name = String(b.name || "file").slice(0, 120);
    const isImg = /\.(png|jpe?g|webp)$/i.test(name) && bytes.length < 10 * 1024 * 1024;
    const form = new FormData();
    form.append("chat_id", String(j.chat_id));
    form.append(isImg ? "photo" : "document", new Blob([bytes]), name);
    if (b.caption) { form.append("caption", String(b.caption).slice(0, 1000)); form.append("parse_mode", "HTML"); }
    form.append("reply_parameters", JSON.stringify({ message_id: j.message_id, allow_sending_without_reply: true }));
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${isImg ? "sendPhoto" : "sendDocument"}`, { method: "POST", body: form });
    const res = await r.json().catch(() => ({}));
    if (!res.ok) return json(502, { error: res.description || "send failed" });
    await sb.from("owner_dm_jobs").update({ bot_msg_ids: [...(j.bot_msg_ids || []), res.result.message_id], updated_at: now }).eq("id", id);
    return json(200, { ok: true });
  }

  if (act === "fail") {
    const err = String(b.error || "невідома помилка").slice(0, 1500);
    const cancelled = j.cancel_requested;
    await sb.from("owner_dm_jobs").update({ status: cancelled ? "cancelled" : "failed", error: err, finished_at: now, updated_at: now }).eq("id", id);
    const ids = await sendLong(j.chat_id, cancelled ? "🛑 Зупинив." : `⚠️ Не вийшло: ${esc(err)}`, j.message_id);
    await sb.from("owner_dm_jobs").update({ bot_msg_ids: [...(j.bot_msg_ids || []), ...ids] }).eq("id", id);
    if (j.ack_msg_id) await tg("deleteMessage", { chat_id: j.chat_id, message_id: j.ack_msg_id });
    return json(200, { ok: true });
  }

  return json(400, { error: `unknown action ${act}` });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!TG_BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY || !HQ_CRON_SECRET) return json(500, { error: "misconfigured" });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const cron = req.headers.get("x-hq-cron-secret") ?? "";
    const worker = req.headers.get("x-cd-worker") ?? "";
    if (cron && await safeEqual(cron, HQ_CRON_SECRET)) {
      const body = await req.json().catch(() => ({}));
      if (body.callback) return json(200, { ok: true, ...(await onCallback(sb, body.callback)) });
      if (body.message) return json(200, { ok: true, ...(await onMessage(sb, body.message)) });
      return json(400, { error: "message or callback required" });
    }
    if (worker) {
      const { data } = await sb.from("app_secrets").select("value").eq("key", "cd_worker_secret_sha256").maybeSingle();
      const want = String(data?.value || "");
      if (want && await safeEqual(await sha256Hex(worker), want)) {
        const body = await req.json().catch(() => ({}));
        return await workerAction(sb, body);
      }
    }
    return json(401, { error: "unauthorized" });
  } catch (e) {
    console.error("[owner-dm]", e);
    return json(500, { error: String((e as any)?.message || e).slice(0, 300) });
  }
});
