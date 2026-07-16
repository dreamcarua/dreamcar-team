// =====================================================================
// DreamCar — Notify TG v10 (06.06.2026)
// Universal: publications / retention_messages / team_tasks
// ВСІ stakeholders: author + approvers + responsibles + assignee + watchers
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN     = Deno.env.get("TG_BOT_TOKEN") ?? "";
const TG_GROUP_CHAT_ID = Deno.env.get("DCSMM_GROUP_CHAT_ID") || "-1003933841573";
// 08.06.2026 Vira feedback: retention notifications → окремий RETENTION groupchat.
// Vira надала chat_id напряму: -1004294474337.
const TG_RETENTION_CHAT_ID = Deno.env.get("DC_RETENTION_GROUP_CHAT_ID") || "-1004294474337";
const HQ_WEBHOOK_SECRET = Deno.env.get("HQ_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("HQ_DB_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";

const HQ_BASE   = "https://dreamcarua.github.io/dreamcar-team/hq/";
const RET_BASE  = "https://dreamcarua.github.io/dreamcar-team/retention/";
const TASKS_BASE= "https://dreamcarua.github.io/dreamcar-team/tasks/";
const MAX_CAPTION = 1024;
const MAX_TEXT_PREVIEW = 800;

const KIND_LABELS: Record<string, string> = {
  script:"✍️ Сценарій", video:"🎬 Відео", design:"🎨 Дизайн",
  copy:"📝 Текст", review:"👀 Перевірка", revise:"↩️ Доопрацювання",
  approve:"✅ Погодження", other:"🔗 Дія",
};

const ALLOWED_ORIGINS = [
  "https://dreamcarua.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

interface UserRow {
  id: string; name: string; email: string|null; role: string;
  tg_chat_id: number|string|null; tg_username: string|null;
}
interface ApproverWithDecision extends UserRow { is_approved: boolean|null; }
interface CreativeRow { id:string; type:string; thumbnail_url:string|null; compressed_url:string|null; poster_url:string|null; name:string; }
interface InlineButton { text:string; callback_data?:string; url?:string; }
interface ReplyMarkup { inline_keyboard: InlineButton[][]; }

// ---------- TG helpers ----------
async function tgSend(chatId: string|number, text: string, opts: { silent?:boolean; reply_markup?:ReplyMarkup } = {}) {
  if (!TG_BOT_TOKEN) return;
  const body: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML",
    disable_web_page_preview: true, disable_notification: opts.silent ?? false,
  };
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) console.error(`TG send fail ${r.status}: ${await r.text()}`);
  } catch (e) { console.error("TG send threw", e); }
}
async function tgSendPhoto(chatId: string|number, photoUrl: string, caption: string, opts: { reply_markup?:ReplyMarkup } = {}) {
  if (!TG_BOT_TOKEN) return false;
  const body: Record<string, unknown> = { chat_id: chatId, photo: photoUrl, caption: caption.slice(0, MAX_CAPTION), parse_mode: "HTML" };
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, {
      method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body),
    });
    return r.ok;
  } catch (e) { console.error("sendPhoto", e); return false; }
}
async function tgSendVideo(chatId: string|number, videoUrl: string, caption: string, opts: { reply_markup?:ReplyMarkup } = {}) {
  if (!TG_BOT_TOKEN) return false;
  const body: Record<string, unknown> = { chat_id: chatId, video: videoUrl, caption: caption.slice(0, MAX_CAPTION), parse_mode: "HTML" };
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendVideo`, {
      method: "POST", headers: { "Content-Type":"application/json" }, body: JSON.stringify(body),
    });
    return r.ok;
  } catch (e) { console.error("sendVideo", e); return false; }
}

// ---------- Format helpers ----------
function escHtml(s: string): string { return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
// #330 (11.06.2026 HARD RULE): ВСЕ форматування дат → Europe/Kyiv.
// Deno default TZ = UTC, тому getHours() повертало UTC замість Київ.
// 17:00 Київ зберігається у БД як 14:00 UTC → notify показував 14:00.
function fmtDt(iso: string|null|undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).format(d).replace(",", "");
  } catch { return iso; }
}
function fmtD(iso: string|null|undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv",
      day: "2-digit", month: "2-digit", year: "numeric"
    }).format(d);
  } catch { return iso; }
}

// ---------- Keyboards ----------
function pubReviewKeyboard(pubId: string): ReplyMarkup {
  return { inline_keyboard: [
    [{ text:"✓ Погодити", callback_data:`appr:${pubId}:y` }, { text:"↩ Повернути", callback_data:`appr:${pubId}:n` }],
    [{ text:"🔗 Відкрити в SMM", url:`${HQ_BASE}#publication/${pubId}` }],
  ]};
}
function retReviewKeyboard(msgId: string): ReplyMarkup {
  return { inline_keyboard: [
    [{ text:"✓ Погодити", callback_data:`rmappr:${msgId}:y` }, { text:"↩ Повернути", callback_data:`rmappr:${msgId}:n` }],
    [{ text:"🔗 Відкрити в РЕТЕНШН", url:`${RET_BASE}#message/${msgId}` }],
  ]};
}
function taskOpenKeyboard(taskId: string): ReplyMarkup {
  return { inline_keyboard: [
    [{ text:"🔗 Відкрити задачу", url:`${TASKS_BASE}#task/${taskId}` }],
  ]};
}

// ---------- Chain progress ----------
function buildChainProgress(approvers: ApproverWithDecision[], policy: string): string {
  if (!approvers.length) return "";
  const approved = approvers.filter(a => a.is_approved === true);
  const pending  = approvers.filter(a => a.is_approved !== true);
  const lines: string[] = [];
  if (approved.length > 0) {
    const names = approved.map(a => `<b>${escHtml(a.name)}</b> ✓`).join(", ");
    lines.push(`👍 Погодили (${approved.length}/${approvers.length}): ${names}`);
  }
  if (pending.length > 0) {
    const names = pending.map(a => `<b>${escHtml(a.name)}</b>`).join(", ");
    if (approved.length === 0) {
      lines.push(`👥 Має погодити${approvers.length > 1 ? ` (${policy === "any" ? "будь-хто з" : "всі"})` : ""}: ${names}`);
    } else lines.push(`⏳ Чекаємо: ${names}`);
  }
  return lines.join("\n");
}

// ---------- Loaders ----------
async function loadPubApprovers(sb: ReturnType<typeof createClient>, pubId: string): Promise<ApproverWithDecision[]> {
  const { data } = await sb.from("publication_approvers")
    .select("user_id, is_approved, users:user_id (id, name, email, role, tg_chat_id, tg_username)")
    .eq("publication_id", pubId);
  return (data ?? []).map((row: any) => {
    const u = row.users as UserRow | null;
    if (!u) return null;
    return { ...u, is_approved: row.is_approved };
  }).filter((x: any): x is ApproverWithDecision => x !== null);
}
async function loadPubResponsibles(sb: ReturnType<typeof createClient>, pubId: string): Promise<UserRow[]> {
  const { data } = await sb.from("publication_responsibles")
    .select("user_id, users:user_id (id, name, email, role, tg_chat_id, tg_username)")
    .eq("publication_id", pubId);
  return (data ?? []).map((row: any) => row.users as UserRow).filter((u: any) => u);
}
async function loadRetApprovers(sb: ReturnType<typeof createClient>, msgId: string): Promise<ApproverWithDecision[]> {
  const { data } = await sb.from("retention_message_approvers")
    .select("user_id, is_approved, users:user_id (id, name, email, role, tg_chat_id, tg_username)")
    .eq("message_id", msgId);
  return (data ?? []).map((row: any) => {
    const u = row.users as UserRow | null;
    if (!u) return null;
    return { ...u, is_approved: row.is_approved };
  }).filter((x: any): x is ApproverWithDecision => x !== null);
}
async function loadRetResponsibles(sb: ReturnType<typeof createClient>, msgId: string): Promise<UserRow[]> {
  const { data } = await sb.from("retention_message_responsibles")
    .select("user_id, users:user_id (id, name, email, role, tg_chat_id, tg_username)")
    .eq("message_id", msgId);
  return (data ?? []).map((row: any) => row.users as UserRow).filter((u: any) => u);
}
async function loadUser(sb: ReturnType<typeof createClient>, userId: string|null|undefined): Promise<UserRow|null> {
  if (!userId) return null;
  const { data } = await sb.from("users").select("*").eq("id", userId).maybeSingle();
  return data as UserRow | null;
}
async function loadUsers(sb: ReturnType<typeof createClient>, userIds: (string|null|undefined)[]): Promise<UserRow[]> {
  const ids = userIds.filter((x): x is string => !!x);
  if (!ids.length) return [];
  const { data } = await sb.from("users").select("*").in("id", ids);
  return (data ?? []) as UserRow[];
}
async function loadFirstCreative(sb: ReturnType<typeof createClient>, pubId: string): Promise<CreativeRow|null> {
  const all = await loadAllCreatives(sb, pubId);
  return all[0] || null;
}
// #315: тягнемо ВСІ creatives (раніше тільки перший — video пропускалось коли photo був перший).
async function loadAllCreatives(sb: ReturnType<typeof createClient>, pubId: string): Promise<CreativeRow[]> {
  const { data } = await sb.from("creative_publications")
    .select("creative_id, sort_order, creatives:creative_id (id, type, thumbnail_url, compressed_url, poster_url, name)")
    .eq("publication_id", pubId).order("sort_order", { ascending: true });
  if (!data) return [];
  return (data as any[]).map(d => d.creatives as CreativeRow).filter(c => !!c && (c.thumbnail_url || c.compressed_url || c.poster_url));
}
// #315: sendMediaGroup для album (>1 media у approval повідомленні).
async function tgSendMediaGroup(chatId: string|number, items: {type:'photo'|'video', media: string}[], caption: string): Promise<boolean> {
  if (!TG_BOT_TOKEN || !items.length) return false;
  const media = items.slice(0, 10).map((m, i) => {
    const obj: any = { type: m.type, media: m.media };
    if (i === 0 && caption) { obj.caption = caption.slice(0, MAX_CAPTION); obj.parse_mode = "HTML"; }
    if (m.type === 'video') obj.supports_streaming = true;
    return obj;
  });
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMediaGroup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, media }),
    });
    const j = await r.json();
    if (!j.ok) console.warn("sendMediaGroup", j.description);
    return !!j.ok;
  } catch (e) { console.error("sendMediaGroup", e); return false; }
}

// ---------- Build messages ----------
function buildPubReviewMsg(pub: any, requester: UserRow|null, approvers: ApproverWithDecision[], responsibles: UserRow[], forCaption: boolean): string {
  const lines: string[] = [];
  lines.push(`📝 <b>SMM · На погодження</b>`);
  lines.push(`«${escHtml(pub.title ?? "")}»`);
  if (requester) lines.push(`Від: ${escHtml(requester.name)}`);
  const chain = buildChainProgress(approvers, pub.approver_policy || "all");
  if (chain) lines.push(chain);
  if (responsibles.length > 0) {
    const r = responsibles.map(u => `<b>${escHtml(u.name)}</b>`).join(", ");
    lines.push(`🛠 Відповідальні: ${r}`);
  }
  if (pub.publish_at) lines.push(`📅 Публікація: ${fmtDt(pub.publish_at)}`);
  if (pub.deadline_on) lines.push(`⏰ Дедлайн: ${pub.deadline_on}`);
  if (pub.text_body && pub.text_body.trim()) {
    const textMaxLen = forCaption ? Math.max(0, MAX_CAPTION - lines.join("\n").length - 40) : MAX_TEXT_PREVIEW;
    const body = pub.text_body.trim();
    lines.push(""); lines.push(`<i>${escHtml(body.length > textMaxLen ? body.slice(0, textMaxLen - 1) + "…" : body)}</i>`);
  }
  if (pub.hashtags && pub.hashtags.length > 0 && !forCaption) {
    lines.push(""); lines.push(pub.hashtags.map((h: string) => h.startsWith("#") ? h : "#"+h).join(" "));
  }
  return lines.join("\n");
}
function buildRetReviewMsg(msg: any, requester: UserRow|null, approvers: ApproverWithDecision[], responsibles: UserRow[]): string {
  const lines: string[] = [];
  const chanLabels: Record<string, string> = { email:"📧 Email", tg:"✈️ Telegram", push:"🔔 Push", sms:"💬 SMS", viber:"💜 Viber", other:"🔗 Інше" };
  const chan = chanLabels[msg.channel] || msg.channel;
  lines.push(`✉️ <b>РЕТЕНШН · На погодження</b> (${chan})`);
  lines.push(`«${escHtml(msg.title ?? "")}»`);
  if (requester) lines.push(`Від: ${escHtml(requester.name)}`);
  const chain = buildChainProgress(approvers, msg.approver_policy || "all");
  if (chain) lines.push(chain);
  if (responsibles.length > 0) {
    const r = responsibles.map(u => `<b>${escHtml(u.name)}</b>`).join(", ");
    lines.push(`🛠 Відповідальні: ${r}`);
  }
  if (msg.publish_at) lines.push(`📅 Розсилка: ${fmtDt(msg.publish_at)}`);
  if (msg.audience_count != null) lines.push(`👥 Аудиторія: ${msg.audience_count.toLocaleString("uk-UA")}`);
  if (msg.deadline_on) lines.push(`⏰ Дедлайн: ${msg.deadline_on}`);
  if (msg.preview_text && msg.preview_text.trim()) {
    const t = msg.preview_text.trim();
    lines.push(""); lines.push(`<i>${escHtml(t.length > MAX_TEXT_PREVIEW ? t.slice(0, MAX_TEXT_PREVIEW-1)+"…" : t)}</i>`);
  }
  return lines.join("\n");
}
function buildTaskMsg(task: any, requester: UserRow|null, assignee: UserRow|null, watchers: UserRow[], event: "INSERT"|"UPDATE"|"REASSIGN"|"STATUS"|"DELETE"): string {
  const lines: string[] = [];
  const priorityE: Record<string, string> = { p0:"🔴 P0", p1:"🟠 P1", p2:"🟡 P2", p3:"🟢 P3" };
  const statusE: Record<string, string> = { inbox:"📥 Inbox", doing:"⏳ Doing", done:"✅ Done", blocked:"🚧 Blocked" };
  if (event === "INSERT") lines.push(`📋 <b>Tasks · Нова задача</b>`);
  else if (event === "REASSIGN") lines.push(`🔄 <b>Tasks · Перепризначено</b>`);
  else if (event === "STATUS") lines.push(`📝 <b>Tasks · Зміна статусу</b>`);
  else if (event === "DELETE") lines.push(`🗑 <b>Tasks · Видалено</b>`);
  else lines.push(`📋 <b>Tasks · Оновлено</b>`);
  lines.push(`«${escHtml(task.title ?? "")}»`);
  if (requester) lines.push(`Від: ${escHtml(requester.name)}`);
  if (assignee) lines.push(`👤 Виконавець: <b>${escHtml(assignee.name)}</b>`);
  if (watchers.length > 0) {
    const w = watchers.map(u => escHtml(u.name)).join(", ");
    lines.push(`👀 Спостерігачі: ${w}`);
  }
  if (task.priority) lines.push(`Пріоритет: ${priorityE[task.priority] || task.priority}`);
  if (task.status) lines.push(`Статус: ${statusE[task.status] || task.status}`);
  if (task.due_date) lines.push(`⏰ Дедлайн: ${fmtD(task.due_date)}`);
  if (task.description && task.description.trim()) {
    const t = task.description.trim();
    lines.push(""); lines.push(`<i>${escHtml(t.length > 400 ? t.slice(0,399)+"…" : t)}</i>`);
  }
  return lines.join("\n");
}

// ---------- Send to chat (with creative) ----------
async function sendPubReviewToChat(chatId: string|number, pub: any, creatives: CreativeRow[], requester: UserRow|null, approvers: ApproverWithDecision[], responsibles: UserRow[]) {
  const kb = pubReviewKeyboard(pub.id);
  // #315: фільтр валідних media. Video → compressed_url (sendVideo expects video URL не thumbnail).
  // Video: TG URL-mode НЕ завантажує відео >20МБ (compressed ~48МБ) → раніше tgSendVideo
  // завжди падав і апрув приходив лише текстом. Тепер шлемо POSTER-кадр (JPG на R2) як
  // фото-прев'ю, а повне відео даємо клікабельним лінком у підписі.
  const isVid = (u: string|null) => !!u && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u);
  const videoLinks: string[] = [];
  const items: {type:'photo'|'video', media: string}[] = creatives
    .map(c => {
      if (c.type === 'video') {
        if (c.compressed_url) videoLinks.push(c.compressed_url);
        const poster = c.poster_url;
        if (!poster || isVid(poster)) return null;   // без постера — не шлемо важке відео
        return { type: 'photo' as const, media: poster };
      }
      const p = c.thumbnail_url || c.compressed_url;
      if (!p || isVid(p)) return null;
      return { type: 'photo' as const, media: p };
    })
    .filter((x): x is {type:'photo'|'video', media: string} => !!x);
  const vLink = videoLinks.length
    ? `\n\n▶️ Відео: ${videoLinks.map((u,i)=>`<a href="${u}">кліп ${videoLinks.length>1?i+1:''}</a>`).join(" · ")}`
    : "";

  if (items.length === 0) {
    await tgSend(chatId, buildPubReviewMsg(pub, requester, approvers, responsibles, false) + vLink, { reply_markup: kb });
    return;
  }

  // 1 media — як було (sendPhoto/sendVideo з reply_markup у тому ж message)
  if (items.length === 1) {
    const it = items[0];
    const caption = buildPubReviewMsg(pub, requester, approvers, responsibles, true) + vLink;
    const ok = it.type === "video"
      ? await tgSendVideo(chatId, it.media, caption, { reply_markup: kb })
      : await tgSendPhoto(chatId, it.media, caption, { reply_markup: kb });
    if (ok) return;
    // fallback на текст
    await tgSend(chatId, buildPubReviewMsg(pub, requester, approvers, responsibles, false) + vLink, { reply_markup: kb });
    return;
  }

  // 2+ media — sendMediaGroup album + окремий msg з кнопками (TG album не підтримує inline_keyboard).
  const caption = buildPubReviewMsg(pub, requester, approvers, responsibles, true) + vLink;
  const sent = await tgSendMediaGroup(chatId, items.map(i => ({ type: i.type, media: i.media })), caption);
  if (sent) {
    // Окремий короткий msg з кнопками (TG album не приймає reply_markup).
    await tgSend(chatId, "⬇ Дії з публікацією:", { reply_markup: kb });
    return;
  }
  // fallback на 1-й media або текст
  const first = items[0];
  const captionFb = buildPubReviewMsg(pub, requester, approvers, responsibles, true) + vLink;
  const okFb = first.type === "video"
    ? await tgSendVideo(chatId, first.media, captionFb, { reply_markup: kb })
    : await tgSendPhoto(chatId, first.media, captionFb, { reply_markup: kb });
  if (!okFb) {
    await tgSend(chatId, buildPubReviewMsg(pub, requester, approvers, responsibles, false) + vLink, { reply_markup: kb });
  }
}

// ---------- Stakeholder collector (deduped) ----------
function collectStakeholders(...lists: (UserRow|null|undefined)[][]): UserRow[] {
  const seen = new Set<string>();
  const out: UserRow[] = [];
  for (const list of lists) {
    for (const u of list) {
      if (!u || !u.id || seen.has(u.id)) continue;
      seen.add(u.id);
      out.push(u);
    }
  }
  return out;
}

// ---------- HANDLERS ----------

async function handlePublicationEvent(sb: ReturnType<typeof createClient>, pubId: string, event: string, newStatus: string|null, oldStatus: string|null) {
  const { data: pub } = await sb.from("publications").select("*").eq("id", pubId).maybeSingle();
  if (!pub) { console.warn(`Pub ${pubId} not found`); return; }
  const statusChanged = oldStatus !== newStatus;
  if (event === "UPDATE" && !statusChanged) return;
  // skip back-bounce if action came from TG itself
  if ((pub.status === "approved" || pub.status === "rework") && pub.last_action_via === "tg") return;

  const approvers = await loadPubApprovers(sb, pub.id);
  const responsibles = await loadPubResponsibles(sb, pub.id);
  const author = await loadUser(sb, pub.created_by);
  const creatives = await loadAllCreatives(sb, pub.id);  // #315: тягнемо ВСІ

  if (pub.status === "review") {
    // 1. У груповий чат
    if (TG_GROUP_CHAT_ID) await sendPubReviewToChat(TG_GROUP_CHAT_ID, pub, creatives, author, approvers, responsibles);
    // 2. У DM КОЖНОМУ stakeholder (approvers + responsibles + author), deduped
    const allUsers = collectStakeholders(approvers, responsibles, [author]);
    for (const u of allUsers) {
      if (u.tg_chat_id) await sendPubReviewToChat(u.tg_chat_id, pub, creatives, author, approvers, responsibles);
    }
  } else if (pub.status === "approved" || pub.status === "rework") {
    const text = pub.status === "approved"
      ? [`✅ <b>SMM · Погоджено</b>`, `«${escHtml(pub.title)}»`, ``, `🔗 <a href="${HQ_BASE}#publication/${pub.id}">Відкрити</a>`].join("\n")
      : [`↩️ <b>SMM · На доопрацювання</b>`, `«${escHtml(pub.title)}»`, ``, `🔗 <a href="${HQ_BASE}#publication/${pub.id}">Відкрити</a>`].join("\n");
    if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text);
    const allUsers = collectStakeholders(approvers, responsibles, [author]);
    for (const u of allUsers) {
      if (u.tg_chat_id) await tgSend(u.tg_chat_id, text);
    }
  }
}

async function handleRetentionMessageEvent(sb: ReturnType<typeof createClient>, msgId: string, event: string, newStatus: string|null, oldStatus: string|null) {
  const { data: msg } = await sb.from("retention_messages").select("*").eq("id", msgId).maybeSingle();
  if (!msg) { console.warn(`RetMsg ${msgId} not found`); return; }
  const statusChanged = oldStatus !== newStatus;
  if (event === "UPDATE" && !statusChanged) return;
  if ((msg.status === "approved" || msg.status === "rework") && msg.last_action_via === "tg") return;

  const approvers = await loadRetApprovers(sb, msg.id);
  const responsibles = await loadRetResponsibles(sb, msg.id);
  const author = await loadUser(sb, msg.created_by);

  // 08.06.2026 Vira: routing retention notifications у RETENTION groupchat (не SMM).
  const retChatId = TG_RETENTION_CHAT_ID;
  if (msg.status === "review") {
    const kb = retReviewKeyboard(msg.id);
    const text = buildRetReviewMsg(msg, author, approvers, responsibles);
    if (retChatId) await tgSend(retChatId, text, { reply_markup: kb });
    const allUsers = collectStakeholders(approvers, responsibles, [author]);
    for (const u of allUsers) {
      if (u.tg_chat_id) await tgSend(u.tg_chat_id, text, { reply_markup: kb });
    }
  } else if (msg.status === "approved" || msg.status === "rework") {
    const text = msg.status === "approved"
      ? [`✅ <b>РЕТЕНШН · Погоджено</b>`, `«${escHtml(msg.title)}»`, ``, `🔗 <a href="${RET_BASE}#message/${msg.id}">Відкрити</a>`].join("\n")
      : [`↩️ <b>РЕТЕНШН · На доопрацювання</b>`, `«${escHtml(msg.title)}»`, ``, `🔗 <a href="${RET_BASE}#message/${msg.id}">Відкрити</a>`].join("\n");
    if (retChatId) await tgSend(retChatId, text);
    const allUsers = collectStakeholders(approvers, responsibles, [author]);
    for (const u of allUsers) {
      if (u.tg_chat_id) await tgSend(u.tg_chat_id, text);
    }
  }
}

async function handleTaskEvent(sb: ReturnType<typeof createClient>, taskId: string, event: string, oldRecord: any|null, newRecord: any|null) {
  const { data: task } = await sb.from("team_tasks").select("*").eq("id", taskId).maybeSingle();
  if (!task) { console.warn(`Task ${taskId} not found`); return; }
  if (task.deleted_at) return; // skip soft-deleted
  const assignee = await loadUser(sb, task.assignee_id);
  const author = await loadUser(sb, task.created_by);
  const watcherIds: string[] = Array.isArray(task.watchers) ? task.watchers.filter((x: any) => typeof x === "string") : [];
  const watchers = await loadUsers(sb, watcherIds);

  let eventType: "INSERT"|"REASSIGN"|"STATUS"|"UPDATE"|"DELETE" = "UPDATE";
  if (event === "INSERT") eventType = "INSERT";
  else if (oldRecord && newRecord && oldRecord.assignee_id !== newRecord.assignee_id) eventType = "REASSIGN";
  else if (oldRecord && newRecord && oldRecord.status !== newRecord.status) eventType = "STATUS";

  // тільки на INSERT, REASSIGN, STATUS change — не на кожен update
  if (eventType === "UPDATE") return;
  // не нотіф ‹done› переходи (вже й так багато спаму)
  if (eventType === "STATUS" && newRecord && newRecord.status === "done") return;

  const text = buildTaskMsg(task, author, assignee, watchers, eventType);
  const kb = taskOpenKeyboard(task.id);

  // ВСІ stakeholders: assignee + author + watchers
  const allUsers = collectStakeholders([assignee], [author], watchers);
  for (const u of allUsers) {
    if (u.tg_chat_id) await tgSend(u.tg_chat_id, text, { reply_markup: kb });
  }
}

// ---------- Legacy handlers (back-compat для існуючих integrations) ----------

async function handleNextActionChange(sb: ReturnType<typeof createClient>, payload: any) {
  const rec = payload.record;
  if (!rec || !rec.next_action_user_id) return;
  const target = await loadUser(sb, rec.next_action_user_id);
  const assignedBy = await loadUser(sb, rec.next_action_set_by);
  const kindLabel = rec.next_action_kind ? (KIND_LABELS[rec.next_action_kind] || rec.next_action_kind) : "дія";
  const lines: string[] = [];
  lines.push(`⏳ <b>Очікують від тебе</b> ${kindLabel}`);
  lines.push(`«${escHtml(rec.title)}»`);
  if (assignedBy) lines.push(`Передав: ${escHtml(assignedBy.name)}`);
  if (rec.publish_at) lines.push(`📅 Публікація: ${fmtDt(rec.publish_at)}`);
  if (rec.deadline_on) lines.push(`⏰ Дедлайн матеріалу: ${rec.deadline_on}`);
  if (rec.next_action_note) { lines.push(""); lines.push(`📝 <i>${escHtml(rec.next_action_note)}</i>`); }
  const text = lines.join("\n");
  const kb: ReplyMarkup = { inline_keyboard: [[{ text:"✓ Готово · передати далі", url:`${HQ_BASE}#publication/${rec.id}` }]] };
  if (target && target.tg_chat_id) await tgSend(target.tg_chat_id, text, { reply_markup: kb });
  if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text, { silent: true });
}

async function handleCommentInsert(sb: ReturnType<typeof createClient>, payload: any) {
  const rec = payload.record;
  if (!rec) return;
  const { data: pub } = await sb.from("publications").select("id, title").eq("id", rec.publication_id).maybeSingle();
  if (!pub) return;
  const author = await loadUser(sb, rec.author_id);
  const t = (rec.body || "").length > 240 ? (rec.body || "").slice(0,237)+"…" : (rec.body || "");
  const text = [
    `💬 <b>Коментар</b> до «${escHtml((pub as any).title)}»`,
    author ? `<i>${escHtml(author.name)}:</i>` : "",
    escHtml(t),
    ``,
    `🔗 <a href="${HQ_BASE}#publication/${(pub as any).id}">Відкрити</a>`,
  ].filter(Boolean).join("\n");
  if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text, { silent: true });
}

// ---------- CORS ----------
function corsHeaders(origin: string|null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-hq-secret, x-event, content-type",
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders(origin) });

  if (HQ_WEBHOOK_SECRET) {
    const got = req.headers.get("x-hq-secret");
    if (got !== HQ_WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401, headers: corsHeaders(origin) });
  }

  let payload: any;
  try { payload = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400, headers: corsHeaders(origin) }); }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return new Response("Missing config", { status: 500, headers: corsHeaders(origin) });
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const event = req.headers.get("x-event");
  try {
    // ---------- v10 universal triggered payload ----------
    if (payload && payload.entity && payload.id) {
      const ent = payload.entity as string;
      const id = payload.id as string;
      const evt = (payload.event as string) || "UPDATE";
      const newStatus = payload.status as string|null;
      const oldStatus = payload.old_status as string|null;

      if (ent === "publication") {
        await handlePublicationEvent(sb, id, evt, newStatus, oldStatus);
      } else if (ent === "retention_message") {
        await handleRetentionMessageEvent(sb, id, evt, newStatus, oldStatus);
      } else if (ent === "team_task") {
        await handleTaskEvent(sb, id, evt, payload.old_record ?? null, payload.new_record ?? null);
      } else {
        console.warn("Unknown entity", ent);
      }
    }
    // ---------- Legacy: Database Webhook format ----------
    else if (event === "next-action" && payload?.table === "publications") {
      await handleNextActionChange(sb, payload);
    } else if (payload?.table === "publications" && (payload.type === "UPDATE" || payload.type === "INSERT")) {
      const id = (payload.record || {}).id;
      const newStatus = (payload.record || {}).status;
      const oldStatus = (payload.old_record || {}).status;
      if (id) await handlePublicationEvent(sb, id, payload.type, newStatus, oldStatus);
    } else if (payload?.table === "retention_messages" && (payload.type === "UPDATE" || payload.type === "INSERT")) {
      const id = (payload.record || {}).id;
      const newStatus = (payload.record || {}).status;
      const oldStatus = (payload.old_record || {}).status;
      if (id) await handleRetentionMessageEvent(sb, id, payload.type, newStatus, oldStatus);
    } else if (payload?.table === "team_tasks" && (payload.type === "UPDATE" || payload.type === "INSERT")) {
      const id = (payload.record || {}).id;
      if (id) await handleTaskEvent(sb, id, payload.type, payload.old_record, payload.record);
    } else if (payload?.table === "comments" && payload.type === "INSERT") {
      await handleCommentInsert(sb, payload);
    }
  } catch (e) {
    console.error("Handler threw", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders(origin), "Content-Type":"application/json" }});
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...corsHeaders(origin), "Content-Type":"application/json" }});
});
