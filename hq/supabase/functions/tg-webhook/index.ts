// =====================================================================
// DreamCar HQ — TG Webhook v26
// + AI Assistant у DM (text without command → tg-ai-router → Claude)
// + Voice messages → Whisper STT → AI response
// + Personal morning digest (окрема Edge Function tg-personal-digest)
// PREV: v12
// + #140 FIX /approve черга: виключаємо публікації де я вже погодив
//   (filter is_approved !== true → не повторюємо завдання поточному approver-у)
// + #123 Structured rework feedback via inline buttons (двокроковий)
// + #124 chain progress у buildChainProgress
// + multi-approver AND logic via register_approval RPC
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
const TG_FILE_MAX_BYTES = 20 * 1024 * 1024;

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

// =====================================================================
// #123: REWORK REASONS (синхронізовано з hq/app-rework-modal.js)
// =====================================================================
interface ReworkReason { id: string; label: string; icon: string; }
const REWORK_REASONS: ReworkReason[] = [
  { id: "bad_text",     label: "Поганий текст",          icon: "📝" },
  { id: "bad_creative", label: "Поганий креатив",        icon: "🖼️" },
  { id: "wrong_time",   label: "Неправильний час",       icon: "🕐" },
  { id: "wrong_tone",   label: "Не той бренд/тон",       icon: "🎯" },
  { id: "missing_info", label: "Не вистачає інфо",       icon: "📋" },
  { id: "legal",        label: "Юридичні питання",       icon: "⚖️" },
  { id: "seo",          label: "SEO/хештеги",            icon: "#️⃣" },
  { id: "technical",    label: "Технічне",               icon: "⚙️" },
  { id: "other",        label: "Інше",                   icon: "❓" },
];

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

async function tgSend(chatId: number | string, text: string, opts: { silent?: boolean; reply_markup?: ReplyMarkup; reply_to_message_id?: number; force_reply?: boolean; reply_placeholder?: string } = {}): Promise<{ message_id: number } | null> {
  if (!TG_BOT_TOKEN) return null;
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML",
    disable_web_page_preview: true,
    disable_notification: opts.silent,
  };
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;
  if (opts.reply_to_message_id) body.reply_to_message_id = opts.reply_to_message_id;
  if (opts.force_reply) {
    body.reply_markup = {
      force_reply: true,
      selective: true,
      input_field_placeholder: opts.reply_placeholder || "Деталі...",
    };
  }
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
interface TgEntity {
  type: string; // "mention" | "text_mention" | "hashtag" | "url" | ...
  offset: number;
  length: number;
  user?: { id: number; first_name?: string; last_name?: string; username?: string };
}
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string; username?: string; first_name?: string; title?: string };
  from?: { id: number; username?: string; first_name?: string; last_name?: string; };
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  document?: TgDocument;
  video?: TgVideo;
  reply_to_message?: TgMessage;
  entities?: TgEntity[];
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

interface ApprovalResult {
  ok: boolean;
  finalStatus: string;
  shortLabel: string;
  longLabel: string;
  error?: string;
}

async function processApprovalDecision(
  supabase: ReturnType<typeof createClient>,
  pubId: string,
  userId: string,
  decision: "y" | "n",
  via: "tg-button" | "tg-queue",
): Promise<ApprovalResult> {
  if (decision === "y") {
    const { data, error } = await supabase.rpc('register_approval', {
      pub_id: pubId, by_user: userId,
    });
    if (error) {
      return { ok: false, finalStatus: "review", shortLabel: "Помилка", longLabel: "", error: error.message };
    }
    // @ts-ignore RPC returns jsonb
    const r = data as { ok: boolean; status: string; all_approved: boolean; approved_count: number; required_count: number; error?: string };
    if (!r?.ok) {
      return { ok: false, finalStatus: "review", shortLabel: "Не пройшло", longLabel: "", error: r?.error || "unknown" };
    }
    if (r.all_approved) {
      return {
        ok: true, finalStatus: "approved",
        shortLabel: "✅ Погоджено!",
        longLabel: `✅ <b>Погоджено усіма</b> (${r.approved_count}/${r.required_count})`,
      };
    } else {
      const remaining = r.required_count - r.approved_count;
      return {
        ok: true, finalStatus: "review",
        shortLabel: `✓ Враховано (${r.approved_count}/${r.required_count})`,
        longLabel: `✅ <b>Голос враховано</b> · ${r.approved_count}/${r.required_count} (чекаємо ще ${remaining})`,
      };
    }
  } else {
    const { error: updErr } = await supabase
      .from("publications")
      .update({ status: "rework", updated_at: new Date().toISOString() })
      .eq("id", pubId);
    if (updErr) {
      return { ok: false, finalStatus: "review", shortLabel: "Помилка", longLabel: "", error: updErr.message };
    }
    await supabase.from("publication_history").insert({
      publication_id: pubId, actor_id: userId,
      action: "reject",
      detail: via === "tg-queue" ? "↩️ через /approve" : "↩️ через TG-кнопку",
    });
    return {
      ok: true, finalStatus: "rework",
      shortLabel: "↩️ Повернуто",
      longLabel: "↩️ <b>Повернуто на доопрацювання</b>",
    };
  }
}

function toggleState(state: string, idx: number): string {
  const set = new Set(state.split(""));
  const k = String(idx);
  if (set.has(k)) set.delete(k); else set.add(k);
  return Array.from(set).sort().join("");
}

function stateToReasonIds(state: string): string[] {
  return state.split("")
    .map(c => REWORK_REASONS[Number(c)]?.id)
    .filter((x): x is string => Boolean(x));
}

function buildReworkText(reasons: string[], comment: string): string {
  const lines: string[] = [];
  if (reasons.length > 0) {
    const labels = reasons.map(rid => {
      const r = REWORK_REASONS.find(x => x.id === rid);
      return r ? `${r.icon} ${r.label}` : rid;
    });
    lines.push("Причини: " + labels.join(" · "));
  }
  if (comment) lines.push("Деталі: " + comment);
  return lines.join("\n\n") || "Без коментаря";
}

function buildReworkKeyboard(pubId: string, state: string, via: "N" | "Q"): ReplyMarkup {
  const prefix = via === "Q" ? "rwkQ" : "rwkN";
  const rows: InlineButton[][] = [];
  for (let i = 0; i < REWORK_REASONS.length; i += 2) {
    const row: InlineButton[] = [];
    for (let j = i; j < Math.min(i + 2, REWORK_REASONS.length); j++) {
      const r = REWORK_REASONS[j];
      const isOn = state.includes(String(j));
      const newState = toggleState(state, j);
      row.push({
        text: (isOn ? "✓ " : "") + r.icon + " " + r.label,
        callback_data: `${prefix}:${pubId}:t:${newState}`,
      });
    }
    rows.push(row);
  }
  const submitLabel = state.length > 0
    ? `↩ Зберегти (${state.length})`
    : `↩ Зберегти без причин`;
  rows.push([
    { text: "✕ Скасувати", callback_data: `${prefix}:${pubId}:x` },
    { text: "💬 + Коментар", callback_data: `${prefix}:${pubId}:sc:${state}` },
  ]);
  rows.push([
    { text: submitLabel, callback_data: `${prefix}:${pubId}:sk:${state}` },
  ]);
  return { inline_keyboard: rows };
}

function buildReworkHeader(pubTitle: string, state: string): string {
  const chosen = state.split("")
    .map(c => REWORK_REASONS[Number(c)])
    .filter(Boolean);
  let header = `↩ <b>Повернути на доопрацювання</b>\n` +
    `📌 «${escHtml(pubTitle)}»\n\n`;
  if (chosen.length > 0) {
    header += `<b>Обрано:</b>\n`;
    chosen.forEach(r => {
      header += `  ${r.icon} ${r.label}\n`;
    });
    header += `\n`;
  }
  header += `<i>Обери що саме треба переробити (можна декілька або жодне)</i>`;
  return header;
}

async function processStructuredRework(
  supabase: ReturnType<typeof createClient>,
  pubId: string,
  userId: string,
  reasons: string[],
  comment: string,
  via: "tg-button-rwk" | "tg-queue-rwk",
): Promise<ApprovalResult> {
  const feedback = { reasons, comment, at: new Date().toISOString() };
  const feedbackJson = JSON.stringify(feedback);
  const feedbackText = buildReworkText(reasons, comment);

  const { error: updErr } = await supabase
    .from("publications")
    .update({ status: "rework", updated_at: new Date().toISOString() })
    .eq("id", pubId);
  if (updErr) {
    return { ok: false, finalStatus: "review", shortLabel: "Помилка", longLabel: "", error: updErr.message };
  }

  const { error: histErr } = await supabase.from("publication_history").insert({
    publication_id: pubId, actor_id: userId,
    action: "reject",
    detail: feedbackJson,
  });
  if (histErr) console.warn("history insert err:", histErr);

  const { error: cErr } = await supabase.from("comments").insert({
    publication_id: pubId, author_id: userId,
    body: feedbackText,
    mentions: [],
  });
  if (cErr) console.warn("comments insert err:", cErr);

  const labels = reasons.map(rid => {
    const r = REWORK_REASONS.find(x => x.id === rid);
    return r ? `${r.icon} ${r.label}` : rid;
  });
  let longLabel = `↩️ <b>Повернуто на доопрацювання</b>`;
  if (labels.length > 0) longLabel += `\n<b>Причини:</b> ${labels.join(" · ")}`;
  if (comment) longLabel += `\n<b>Деталі:</b> <i>${escHtml(comment)}</i>`;

  return { ok: true, finalStatus: "rework", shortLabel: "↩️ Повернуто", longLabel };
}

function buildCommentMarker(pubId: string, state: string, via: "N" | "Q"): string {
  return `#rwk:${via}:${pubId}:${state}`;
}

function parseCommentMarker(text: string): { via: "N" | "Q"; pubId: string; state: string } | null {
  const m = text.match(/#rwk:([NQ]):([0-9a-f-]{36}):([0-8]*)/i);
  if (!m) return null;
  return { via: m[1] as "N" | "Q", pubId: m[2], state: m[3] };
}

async function handleReworkStart(
  supabase: ReturnType<typeof createClient>,
  cb: TgCallbackQuery,
  pubId: string,
  via: "N" | "Q",
): Promise<void> {
  const msg = cb.message!;
  const me = await findUser(supabase, cb.from.id);
  if (!me) { await tgAnswerCallback(cb.id, "Спочатку /start", true); return; }

  const { data: appr } = await supabase
    .from("publication_approvers")
    .select("user_id").eq("publication_id", pubId).eq("user_id", me.id).maybeSingle();
  if (!appr) { await tgAnswerCallback(cb.id, "Ти не у списку погоджувачів", true); return; }

  const { data: pub } = await supabase
    .from("publications").select("id, title, status").eq("id", pubId).maybeSingle();
  if (!pub) { await tgAnswerCallback(cb.id, "Не знайдено", true); return; }
  if (pub.status !== "review") {
    await tgAnswerCallback(cb.id, `Статус: ${pub.status}`, true);
    return;
  }

  await tgAnswerCallback(cb.id, "↩ Оберіть причини");

  const header = buildReworkHeader(pub.title, "");
  const keyboard = buildReworkKeyboard(pubId, "", via);
  await tgEditMessage(msg.chat.id, msg.message_id, header, keyboard);
}

async function handleReworkCallback(
  supabase: ReturnType<typeof createClient>,
  cb: TgCallbackQuery,
  via: "N" | "Q",
  pubId: string,
  sub: string,
  state: string,
): Promise<void> {
  const msg = cb.message!;
  const me = await findUser(supabase, cb.from.id);
  if (!me) { await tgAnswerCallback(cb.id, "Спочатку /start", true); return; }

  const { data: appr } = await supabase
    .from("publication_approvers")
    .select("user_id").eq("publication_id", pubId).eq("user_id", me.id).maybeSingle();
  if (!appr) { await tgAnswerCallback(cb.id, "Не маєш прав", true); return; }

  const { data: pub } = await supabase
    .from("publications").select("id, title, status").eq("id", pubId).maybeSingle();
  if (!pub) { await tgAnswerCallback(cb.id, "Не знайдено", true); return; }

  if (sub === "t") {
    await tgAnswerCallback(cb.id, "");
    const header = buildReworkHeader(pub.title, state);
    const kb = buildReworkKeyboard(pubId, state, via);
    await tgEditMessage(msg.chat.id, msg.message_id, header, kb);
    return;
  }

  if (sub === "x") {
    await tgAnswerCallback(cb.id, "Скасовано");
    await tgEditMessage(msg.chat.id, msg.message_id,
      `↩ <i>Скасовано</i>\n\n📌 «${escHtml(pub.title)}»\n\n` +
      `<a href="${HQ_URL}#publication/${pubId}">Відкрити у HQ</a>`,
      undefined,
    );
    return;
  }

  if (sub === "sk") {
    if (pub.status !== "review") {
      await tgAnswerCallback(cb.id, `Статус: ${pub.status}`, true);
      return;
    }
    const reasons = stateToReasonIds(state);
    const result = await processStructuredRework(
      supabase, pubId, me.id, reasons, "",
      via === "Q" ? "tg-queue-rwk" : "tg-button-rwk",
    );
    if (!result.ok) {
      await tgAnswerCallback(cb.id, result.error || "Помилка", true);
      return;
    }
    await tgAnswerCallback(cb.id, result.shortLabel);

    const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
    await tgEditMessage(msg.chat.id, msg.message_id,
      `${result.longLabel}\n\n` +
      `<i>${escHtml(me.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())}</i>\n\n` +
      `📌 «${escHtml(pub.title)}»`,
      undefined,
    );

    if (via === "Q") {
      const remaining = await getQueueForUser(supabase, me.id);
      if (remaining.length > 0) {
        const next = remaining[0];
        await tgSend(msg.chat.id, formatPubForQueue(next, 1, remaining.length), { reply_markup: buildQueueKeyboard(next.id) });
      } else {
        await tgSend(msg.chat.id, "🎉 <b>Черга оброблена!</b>");
      }
    }
    return;
  }

  if (sub === "sc") {
    if (pub.status !== "review") {
      await tgAnswerCallback(cb.id, `Статус: ${pub.status}`, true);
      return;
    }
    await tgAnswerCallback(cb.id, "Опиши деталі ↓");
    const reasons = stateToReasonIds(state);
    const reasonsLabels = reasons.map(rid => {
      const r = REWORK_REASONS.find(x => x.id === rid);
      return r ? `${r.icon} ${r.label}` : rid;
    });
    let pickerFinal = `↩ <b>Чекаю деталей...</b>\n📌 «${escHtml(pub.title)}»\n\n`;
    if (reasonsLabels.length > 0) {
      pickerFinal += `<b>Причини:</b>\n` + reasonsLabels.map(l => `  ${l}`).join("\n") + `\n\n`;
    }
    pickerFinal += `<i>Дай відповідь на наступне повідомлення з деталями ↓</i>`;
    await tgEditMessage(msg.chat.id, msg.message_id, pickerFinal, undefined);

    const marker = buildCommentMarker(pubId, state, via);
    const promptText =
      `✍️ <b>Деталі повернення</b>\n` +
      `Опиши конкретно: що саме переробити в «${escHtml(pub.title)}»?\n\n` +
      `<i>Напр.: «Фото в студії — треба emotion-фото у дорозі. Текст занадто формальний — додати драйв.»</i>\n\n` +
      `<code>${marker}</code>`;
    await tgSend(msg.chat.id, promptText, {
      force_reply: true,
      reply_placeholder: "Що саме переробити?",
    });
    return;
  }

  await tgAnswerCallback(cb.id, "Невідома дія");
}

async function handleReworkCommentReply(
  supabase: ReturnType<typeof createClient>,
  msg: TgMessage,
): Promise<boolean> {
  const replyTo = msg.reply_to_message;
  if (!replyTo || !replyTo.text) return false;
  const parsed = parseCommentMarker(replyTo.text);
  if (!parsed) return false;

  const userComment = (msg.text || "").trim();
  if (!userComment) {
    await tgSend(msg.chat.id, "⚠️ Порожня відповідь — спробуй ще раз.");
    return true;
  }

  const me = await findUser(supabase, msg.chat.id);
  if (!me) { await tgSend(msg.chat.id, "🚫 Спочатку /start"); return true; }

  const { data: pub } = await supabase
    .from("publications").select("id, title, status").eq("id", parsed.pubId).maybeSingle();
  if (!pub) { await tgSend(msg.chat.id, "⚠️ Пост не знайдено"); return true; }
  if (pub.status !== "review") {
    await tgSend(msg.chat.id, `⚠️ Поточний статус: ${STATUS_LABEL[pub.status] || pub.status}. Ні чого не змінено.`);
    return true;
  }

  const { data: appr } = await supabase
    .from("publication_approvers")
    .select("user_id").eq("publication_id", parsed.pubId).eq("user_id", me.id).maybeSingle();
  if (!appr) { await tgSend(msg.chat.id, "🚫 Не маєш прав на цей пост"); return true; }

  const reasons = stateToReasonIds(parsed.state);
  const result = await processStructuredRework(
    supabase, parsed.pubId, me.id, reasons, userComment,
    parsed.via === "Q" ? "tg-queue-rwk" : "tg-button-rwk",
  );
  if (!result.ok) {
    await tgSend(msg.chat.id, `⚠️ Помилка: ${result.error}`);
    return true;
  }

  await tgSend(msg.chat.id,
    `${result.longLabel}\n\n📌 «${escHtml(pub.title)}»\n\n` +
    `🔗 <a href="${HQ_URL}#publication/${parsed.pubId}">Відкрити у HQ</a>`,
    { reply_to_message_id: msg.message_id },
  );

  if (parsed.via === "Q") {
    const remaining = await getQueueForUser(supabase, me.id);
    if (remaining.length > 0) {
      const next = remaining[0];
      await tgSend(msg.chat.id, formatPubForQueue(next, 1, remaining.length), { reply_markup: buildQueueKeyboard(next.id) });
    } else {
      await tgSend(msg.chat.id, "🎉 <b>Черга оброблена!</b>");
    }
  }
  return true;
}

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
  // #140 FIX: select is_approved + filter rows where current user already voted (is_approved === true).
  const { data: apprList } = await supabase
    .from("publication_approvers")
    .select("publication_id, is_approved, publications!inner(id, title, status, publish_at, deleted_at)")
    .eq("user_id", userId);
  return (apprList ?? [])
    // @ts-ignore
    .filter((row: any) => row.is_approved !== true)  // #140 — виключаємо вже погоджені цим юзером
    // @ts-ignore — join shape
    .map((r: any) => r.publications as { id: string; title: string; status: string; publish_at: string; deleted_at?: string | null })
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

  const { data: appr } = await supabase
    .from("publication_approvers")
    .select("user_id").eq("publication_id", pubId).eq("user_id", me.id).maybeSingle();
  if (!appr) { await tgAnswerCallback(cb.id, "Ти не у списку погоджувачів", true); return; }

  const { data: pub } = await supabase
    .from("publications").select("id, title, status").eq("id", pubId).maybeSingle();
  if (!pub) { await tgAnswerCallback(cb.id, "Не знайдено", true); return; }
  if (pub.status !== "review") { await tgAnswerCallback(cb.id, `Статус: ${pub.status}`, true); return; }

  if (decision === "n") {
    await handleReworkStart(supabase, cb, pubId, "Q");
    return;
  }

  const result = await processApprovalDecision(supabase, pubId, me.id, decision as "y" | "n", "tg-queue");
  if (!result.ok) { await tgAnswerCallback(cb.id, result.error || result.shortLabel, true); return; }

  await tgAnswerCallback(cb.id, result.shortLabel);

  const remaining = await getQueueForUser(supabase, me.id);
  if (remaining.length === 0) {
    await tgEditMessage(msg.chat.id, msg.message_id, (msg.text || "").replace(/Тисни кнопку.*$/, "") + `\n${result.longLabel}\n\n🎉 <b>Черга оброблена!</b>`);
    return;
  }
  const next = remaining[0];
  await tgEditMessage(msg.chat.id, msg.message_id, (msg.text || "").replace(/Тисни кнопку.*$/, "") + `\n${result.longLabel}`);
  await tgSend(msg.chat.id, formatPubForQueue(next, 1, remaining.length), { reply_markup: buildQueueKeyboard(next.id) });
}

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
  if (isGroup) return;
  const me = await findUser(supabase, chatId);
  if (!me) { await tgSend(chatId, "🚫 Спочатку прив'яжи акаунт: /start"); return; }

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
    const best = msg.photo[msg.photo.length - 1];
    if ((best.file_size ?? 0) > TG_FILE_MAX_BYTES) {
      await tgSend(chatId, `⚠️ Фото задовге. Завантаж через HQ-сайт.`);
      return;
    }
    fileId = best.file_id;
    filename = `photo_${Date.now()}.jpg`;
    mime = "image/jpeg";
  }

  if (!fileId) return;

  const progress = await tgSend(chatId, "📥 Завантажую файл...");
  const dl = await downloadTgFile(fileId, filename, mime);
  if (!dl) {
    if (progress) await tgEditMessage(chatId, progress.message_id, "⚠️ Не вдалось завантажити файл з TG.");
    return;
  }

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

  const { data: resp } = await supabase
    .from("publication_responsibles")
    .select("user_id").eq("publication_id", pubIdOrSkip).eq("user_id", me.id).maybeSingle();
  if (!resp) { await tgAnswerCallback(cb.id, "Ти не відповідальний за цю публікацію", true); return; }

  const { data: existing } = await supabase
    .from("creative_publications").select("sort_order")
    .eq("publication_id", pubIdOrSkip).order("sort_order", { ascending: false }).limit(1);
  const nextOrder = (existing && existing[0]?.sort_order != null) ? existing[0].sort_order + 1 : 0;

  const { error: linkErr } = await supabase.from("creative_publications").insert({
    publication_id: pubIdOrSkip, creative_id: creativeId, sort_order: nextOrder,
  });
  if (linkErr) { await tgAnswerCallback(cb.id, `Помилка: ${linkErr.message}`, true); return; }

  await tgAnswerCallback(cb.id, "📎 Прикріплено!");

  const { data: pub } = await supabase
    .from("publications").select("title").eq("id", pubIdOrSkip).maybeSingle();
  if (cb.message) {
    const txt = (cb.message.text || "").replace(/Прикріпити до публікації\?/, "").trim();
    await tgEditMessage(cb.message.chat.id, cb.message.message_id,
      txt + `\n\n📎 <b>Прикріплено</b> до «${escHtml(pub?.title || "?")}»\n` +
      `🔗 <a href="${HQ_URL}#publication/${pubIdOrSkip}">Відкрити в HQ</a>`);
  }
}

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
    .from("publication_approvers").select("publication_id, is_approved, publications!inner(status, deleted_at)").eq("user_id", me.id);
  // @ts-ignore — #140 також тут фільтр
  const queueCount = (apprList ?? []).filter((r: any) => r.is_approved !== true && r.publications?.status === "review" && !r.publications?.deleted_at).length;
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
    `🔧 Diag v12 (#140 queue-filter)\nURL: ${SUPABASE_URL ? "✅" : "❌"} · Key: ${KEY_SOURCE} (role=${jwtRole(SERVICE_ROLE_KEY)})\nchat_id: <code>${chatId}</code>`
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

// ===================================================================
// 05.06.2026 — TG Task Bot: керування whitelisted чатами
// ===================================================================
async function handleChatId(chatId: number, msg: TgMessage): Promise<void> {
  const title = msg.chat.title ? `\n📛 <b>${escHtml(msg.chat.title)}</b>` : "";
  const type = msg.chat.type;
  await tgSend(chatId,
    `🆔 <b>chat_id:</b> <code>${chatId}</code>\n` +
    `📐 type: ${escHtml(type)}${title}\n\n` +
    `Для CEO/COO: <code>/listen_here</code> щоб увімкнути TG Task Bot у цьому чаті.`
  );
}

async function handleListenHere(
  supabase: ReturnType<typeof createClient>,
  chatId: number,
  tgUser: { id?: number; username?: string; first_name?: string },
  msg: TgMessage,
): Promise<void> {
  // Тільки CEO/COO
  if (!tgUser.id) { await tgSend(chatId, "⚠️ TG user не визначено."); return; }
  // 06.06.2026 FIX: tg_chat_id у БД це bigint — не кастимо у String, інакше PostgREST eq не співпадає
  const { data: u } = await supabase.from("users").select("id, name, role").eq("tg_chat_id", tgUser.id).maybeSingle();
  if (!u) { await tgSend(chatId, "🚫 Не привʼязаний як юзер HQ. Спочатку /start у DM.", { silent: true }); return; }
  if (!["ceo", "coo"].includes(u.role)) {
    await tgSend(chatId, `🚫 Команда тільки для CEO/COO. Твоя роль: <b>${escHtml(u.role)}</b>.`, { silent: true });
    return;
  }
  // Upsert у whitelist
  const chatTitle = msg.chat.title || msg.chat.first_name || "Untitled";
  const { error } = await supabase.from("tg_listening_chats").upsert({
    chat_id: chatId,
    chat_title: chatTitle,
    added_by: u.id,
    reactive: true,
    proactive: true,
    notes: `Додано через /listen_here від ${u.name || u.role}`,
  }, { onConflict: "chat_id" });
  if (error) { await tgSend(chatId, `⚠️ Помилка: ${escHtml(error.message)}`); return; }
  await tgSend(chatId,
    `✅ <b>TG Task Bot активний у цьому чаті</b>\n\n` +
    `📛 Чат: <b>${escHtml(chatTitle)}</b>\n` +
    `🆔 ID: <code>${chatId}</code>\n` +
    `👤 Активовано: <b>${escHtml(u.name || u.role)}</b>\n\n` +
    `<b>Як юзати:</b>\n` +
    `1️⃣ <i>Inline:</i> "Сашо, треба X 📌" одним повідомленням\n` +
    `2️⃣ <i>Reply:</i> Reply з 📌/📋/📝/⚡ на повідомлення\n` +
    `3️⃣ <i>/task</i> у reply\n\n` +
    `Бот витягне задачу і пришле тобі DM з пропозицією + кнопками.\n` +
    `Зупинити: <code>/listen_stop</code>`
  );
}

async function handleListenStop(
  supabase: ReturnType<typeof createClient>,
  chatId: number,
  tgUser: { id?: number },
  msg: TgMessage,
): Promise<void> {
  if (!tgUser.id) { await tgSend(chatId, "⚠️ TG user не визначено."); return; }
  // 06.06.2026 FIX: tg_chat_id як bigint
  const { data: u } = await supabase.from("users").select("id, name, role").eq("tg_chat_id", tgUser.id).maybeSingle();
  if (!u || !["ceo", "coo"].includes(u.role)) {
    await tgSend(chatId, `🚫 Команда тільки для CEO/COO.`, { silent: true });
    return;
  }
  const { error } = await supabase.from("tg_listening_chats")
    .update({ reactive: false, proactive: false })
    .eq("chat_id", chatId);
  if (error) { await tgSend(chatId, `⚠️ ${escHtml(error.message)}`); return; }
  await tgSend(chatId, `🔌 TG Task Bot вимкнено у цьому чаті. Знов увімкнути: <code>/listen_here</code>`);
}

async function handleListenStatus(
  supabase: ReturnType<typeof createClient>,
  chatId: number,
): Promise<void> {
  const { data: c } = await supabase
    .from("tg_listening_chats")
    .select("chat_title, reactive, proactive, added_at, notes")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!c) {
    await tgSend(chatId, `❌ Цей чат <b>не в whitelist</b>. CEO/COO може ввімкнути: <code>/listen_here</code>`);
    return;
  }
  await tgSend(chatId,
    `📋 <b>TG Task Bot статус</b>\n\n` +
    `📛 ${escHtml(c.chat_title || "?")}\n` +
    `⚡ Reactive (📌 / reply / /task): ${c.reactive ? "✅ on" : "🔌 off"}\n` +
    `🤖 Proactive (daily 18:00 scan): ${c.proactive ? "✅ on" : "🔌 off"}\n` +
    `📅 Додано: ${c.added_at}\n` +
    (c.notes ? `📝 ${escHtml(c.notes)}` : "")
  );
}

// 05.06.2026: /tasks — мої задачі (Inbox/Doing) у TG
async function handleMyTasks(
  supabase: ReturnType<typeof createClient>,
  chatId: number,
  isGroup: boolean,
): Promise<void> {
  if (isGroup) { await tgSend(chatId, "🔒 /tasks — у DM з ботом.", { silent: true }); return; }
  const { data: me } = await supabase.from("users").select("id, name, role").eq("tg_chat_id", chatId).maybeSingle();
  if (!me) { await tgSend(chatId, "🚫 Не привʼязаний. Спочатку /start у DM."); return; }

  const { data: tasks } = await supabase
    .from("team_tasks")
    .select("id, title, status, priority, due_date, project_id")
    .eq("assignee_id", me.id)
    .in("status", ["inbox", "doing"])
    .is("deleted_at", null);

  if (!tasks || tasks.length === 0) {
    await tgSend(chatId, `🎉 <b>${escHtml(me.name || "Ти")}, у тебе немає активних задач!</b>\n\nВсе чисто. Або робота тебе оминає, або ти вже все закрив.`);
    return;
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  // Sort: P1/P2 → overdue → today → інші
  const prioOrd: Record<string, number> = { p1: 1, p2: 2, p3: 3, p4: 4 };
  const scored = (tasks as Array<{ id: string; title: string; status: string; priority: string; due_date: string | null; project_id: string | null }>).map((t) => {
    let score = (prioOrd[t.priority] || 5) * 100;
    if (t.due_date) {
      const due = new Date(t.due_date);
      due.setHours(0, 0, 0, 0);
      if (due < today) score -= 50; // overdue → пріоритет вище
      else if (due.getTime() === today.getTime()) score -= 25; // сьогодні
    }
    return { ...t, _score: score };
  });
  scored.sort((a, b) => a._score - b._score);

  const lines = [
    `📋 <b>Твої активні задачі (${tasks.length}):</b>\n`,
  ];
  const STATUS_LABEL: Record<string, string> = { inbox: "📥", doing: "🔄" };
  const P_LABEL: Record<string, string> = { p1: "🔴", p2: "🟡", p3: "🔵", p4: "⚪" };
  for (const t of scored.slice(0, 15)) {
    const ico = STATUS_LABEL[t.status] || "•";
    const p = P_LABEL[t.priority] || "";
    let dueChip = "";
    if (t.due_date) {
      const due = new Date(t.due_date);
      const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
      if (diff < 0) dueChip = ` ⚠️ -${-diff}д`;
      else if (diff === 0) dueChip = " 📅 сьогодні";
      else if (diff <= 3) dueChip = ` 📅 +${diff}д`;
    }
    const url = `https://team.dreamcar.ua/tasks/#task=${t.id}`;
    lines.push(`${ico} ${p} <a href="${url}">${escHtml(t.title.slice(0, 60))}</a>${dueChip}`);
  }
  if (scored.length > 15) lines.push(`\n…і ще ${scored.length - 15}. Дивись усе у <a href="https://team.dreamcar.ua/tasks/">Tasks ↗</a>`);
  lines.push(`\n🔗 <a href="https://team.dreamcar.ua/tasks/">Відкрити Tasks</a>`);

  await tgSend(chatId, lines.join("\n"));
}

async function handleHelp(chatId: number, isGroup: boolean): Promise<void> {
  if (isGroup) {
    await tgSend(chatId, `🤖 Я шлю сповіщення з кнопками ✓ / ↩. Команди — у DM: <a href="https://t.me/dreamcar_team_bot">@dreamcar_team_bot</a>`, { silent: true });
    return;
  }
  await tgSend(chatId,
    `🤖 <b>DreamCar HQ bot</b> v12\n\n` +
    `<b>Швидкі довідки:</b>\n` +
    `/me — мій зведений дайджест\n` +
    `/today — публікації сьогодні\n` +
    `/queue — на моє погодження\n` +
    `/approve — швидке погодження черги ⚡\n` +
    `/late — пропущені / горить\n` +
    `/my — мої заплановані\n\n` +
    `<b>Файли:</b>\nПросто перешли фото/відео/PDF — я додам у бібліотеку 📎\n\n` +
    `<b>Повернення з причинами:</b>\nКоли тиснеш ↩ — бот покаже 9 категорій причин, можна обрати декілька + додати коментар через ForceReply.\n\n` +
    `<b>Профіль:</b>\n` +
    `/whoami /unbind /diag /help`
  );
}

async function handleCallback(supabase: ReturnType<typeof createClient>, cb: TgCallbackQuery): Promise<void> {
  const data = (cb.data || "").trim();
  const msg = cb.message;
  if (!data || !msg) { await tgAnswerCallback(cb.id, "Помилка"); return; }

  const parts = data.split(":");
  const action = parts[0];

  if (action === "rwkN" || action === "rwkQ") {
    const via = action === "rwkQ" ? "Q" : "N";
    const pubId = parts[1];
    const sub = parts[2];
    const state = parts[3] || "";
    await handleReworkCallback(supabase, cb, via, pubId, sub, state);
    return;
  }

  if (action === "qappr") {
    await handleQueueCallback(supabase, cb, parts[1], parts[2]);
    return;
  }
  if (action === "attach") {
    await handleAttachCallback(supabase, cb, parts[1], parts[2]);
    return;
  }
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

    if (decision === "n") {
      await handleReworkStart(supabase, cb, pubId, "N");
      return;
    }

    const result = await processApprovalDecision(supabase, pubId, me.id, decision as "y" | "n", "tg-button");
    if (!result.ok) { await tgAnswerCallback(cb.id, result.error || result.shortLabel, true); return; }

    await tgAnswerCallback(cb.id, result.shortLabel);

    const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
    await tgEditMessage(msg.chat.id, msg.message_id,
      (msg.text || "") + `\n\n${result.longLabel} · ${escHtml(me.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())}`);
    return;
  }

  if (action === "open") {
    await tgAnswerCallback(cb.id, "Відкрий: " + HQ_URL + "#publication/" + parts[1]);
    return;
  }

  // 06.06.2026 — Verify publication callbacks (vrfy:retry / vrfy:resched)
  if (action === "vrfy") {
    const sub = parts[1]; // retry | resched
    const pubId = parts[2];
    if (!pubId) { await tgAnswerCallback(cb.id, "Bad pub id"); return; }

    const tgUserId = cb.from?.id;
    if (!tgUserId) { await tgAnswerCallback(cb.id, "TG user не визначено"); return; }
    const { data: me } = await supabase.from("users").select("id,name,role").eq("tg_chat_id", tgUserId).maybeSingle();
    if (!me) { await tgAnswerCallback(cb.id, "TG не привʼязано — /start у боті", true); return; }

    if (sub === "confirm") {
      // ✅ Команда підтвердила що опубліковано
      const { data: pubBefore } = await supabase.from("publications")
        .select("title, publish_at, status").eq("id", pubId).maybeSingle();
      if (!pubBefore) { await tgAnswerCallback(cb.id, "Не знайдено", true); return; }
      if (pubBefore.status === "published") {
        await tgAnswerCallback(cb.id, "Вже опубліковано", true);
        return;
      }
      await supabase.from("publications").update({
        status: "published",
        verified_at: new Date().toISOString(),
        verified_status: "ok",
        last_action_via: "manual-tg-confirm",
      }).eq("id", pubId);
      await supabase.from("publication_history").insert({
        publication_id: pubId,
        action: "manual_confirm_published",
        detail: `Підтвердив у TG: ${me.name || "?"}`,
        actor_id: me.id,
      });
      // Notify ВСІМ stakeholders через notify-tg
      try {
        await fetch("https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/notify-tg", {
          method: "POST",
          headers: { "Content-Type":"application/json", "x-hq-secret": "10b4e4588f679775068f0de314851e40157b8146f71f628da2303d7dfccef5dd" },
          body: JSON.stringify({ entity: "publication", id: pubId, event: "UPDATE", status: "published", old_status: pubBefore.status }),
        });
      } catch(e) { console.error("notify-tg invoke", e); }
      await tgAnswerCallback(cb.id, "✅ Підтверджено · status=published");
      const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
      if (msg.text) await tgEditMessage(msg.chat.id, msg.message_id,
        (msg.text || "") + `\n\n✅ <b>Опубліковано</b> · ${escHtml(me.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())}`);
      return;
    }
    if (sub === "miss") {
      // ❌ Збій публікації — алярм
      await supabase.from("publications").update({
        verified_at: new Date().toISOString(),
        verified_status: "missed",
      }).eq("id", pubId);
      await supabase.from("publication_history").insert({
        publication_id: pubId,
        action: "manual_confirm_missed",
        detail: `Збій підтвердив у TG: ${me.name || "?"}`,
        actor_id: me.id,
      });
      // Шлемо алярм усім через прямий tg (бо це не статус-change для notify-tg)
      const { data: pubM } = await supabase.from("publications").select("title").eq("id", pubId).maybeSingle();
      const alertText = [
        `🚨 <b>АЛЯРМ: публікація НЕ ВИЙШЛА</b>`,
        `«${escHtml((pubM as any)?.title || "")}»`,
        ``,
        `${escHtml(me.name || "?")} підтвердив(ла) збій. Терміново розібратись.`,
      ].join("\n");
      // Group chat — silent=false (звукове сповіщення)
      // Stakeholders — DM
      // Простий шлях через прямий fetch — без stakeholders fanout тут, бо це rare event
      const TG_GROUP_CHAT_ID_LOCAL = Deno.env.get("DCSMM_GROUP_CHAT_ID") || "-1003933841573";
      try {
        await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_BOT_TOKEN")}/sendMessage`, {
          method: "POST", headers: { "Content-Type":"application/json" },
          body: JSON.stringify({ chat_id: TG_GROUP_CHAT_ID_LOCAL, text: alertText, parse_mode: "HTML" })
        });
      } catch(e) { console.error("alarm send", e); }
      await tgAnswerCallback(cb.id, "🚨 Алярм надіслано команді");
      const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
      if (msg.text) await tgEditMessage(msg.chat.id, msg.message_id,
        (msg.text || "") + `\n\n❌ <b>Збій</b> · ${escHtml(me.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())}`);
      return;
    }
    if (sub === "retry") {
      // Legacy: скидаємо verified_at щоб verify-publication-ig перевірив ще раз
      await supabase.from("publications").update({
        verified_at: null, verified_status: null, verified_evidence_url: null,
      }).eq("id", pubId);
      // Викликаємо edge fn негайно
      try {
        await fetch("https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/verify-publication-ig", {
          method: "POST",
          headers: { "Content-Type":"application/json", "x-hq-cron-secret": Deno.env.get("HQ_CRON_SECRET") ?? "" },
          body: JSON.stringify({ publication_id: pubId }),
        });
      } catch(e) { console.error("manual verify call", e); }
      await tgAnswerCallback(cb.id, "🔁 Перевіряю Instagram…");
      const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
      if (msg.text) await tgEditMessage(msg.chat.id, msg.message_id,
        (msg.text || "") + `\n\n🔁 ${escHtml(me.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())} запросив повторну перевірку`);
      return;
    }
    if (sub === "resched") {
      const minutes = parseInt(parts[3] || "60", 10);
      const { data: pub } = await supabase.from("publications").select("publish_at, title").eq("id", pubId).maybeSingle();
      if (!pub) { await tgAnswerCallback(cb.id, "Не знайдено", true); return; }
      const newDate = new Date(new Date(pub.publish_at).getTime() + minutes * 60 * 1000);
      await supabase.from("publications").update({
        publish_at: newDate.toISOString(),
        status: "approved",
        verified_at: null, verified_status: null, verified_evidence_url: null,
      }).eq("id", pubId);
      await supabase.from("publication_history").insert({
        publication_id: pubId,
        action: "rescheduled_via_tg",
        detail: `+${minutes} хв (${(me.name || "?")})`,
        actor_id: me.id,
      });
      await tgAnswerCallback(cb.id, `↻ Перенесено на +${minutes} хв`);
      const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
      if (msg.text) await tgEditMessage(msg.chat.id, msg.message_id,
        (msg.text || "") + `\n\n↻ Перенесено +${minutes} хв · ${escHtml(me.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())}`);
      return;
    }
    await tgAnswerCallback(cb.id, "Невідома vrfy дія", true);
    return;
  }

  // 06.06.2026 — Retention message approve callback (rmappr:<msgId>:y|n)
  if (action === "rmappr") {
    const msgId = parts[1]; const decision = parts[2];
    const me = await findUser(supabase, cb.from.id);
    if (!me) { await tgAnswerCallback(cb.id, "Спочатку /start у DM", true); return; }

    const { data: appr } = await supabase
      .from("retention_message_approvers")
      .select("user_id, is_approved")
      .eq("message_id", msgId).eq("user_id", me.id).maybeSingle();
    if (!appr) { await tgAnswerCallback(cb.id, "Ти не у списку погоджувачів", true); return; }

    const { data: rmsg } = await supabase
      .from("retention_messages").select("id, title, status, approver_policy").eq("id", msgId).maybeSingle();
    if (!rmsg) { await tgAnswerCallback(cb.id, "Не знайдено", true); return; }
    if (rmsg.status !== "review") {
      await tgAnswerCallback(cb.id, `Статус: ${rmsg.status}`, true);
      return;
    }

    if (decision === "n") {
      // Rework
      await supabase.from("retention_messages")
        .update({ status: "rework", last_action_via: "tg" })
        .eq("id", msgId);
      await supabase.from("retention_message_history").insert({
        message_id: msgId, action: "rework_via_tg", detail: me.name || "?"
      });
      await tgAnswerCallback(cb.id, "↩ Повернуто на доопрацювання");
      const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
      if (msg.text) await tgEditMessage(msg.chat.id, msg.message_id,
        (msg.text || "") + `\n\n↩ Повернуто · ${escHtml(me.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())}`);
      return;
    }

    // decision === 'y' — mark this approver as approved
    await supabase.from("retention_message_approvers")
      .update({ is_approved: true })
      .eq("message_id", msgId).eq("user_id", me.id);

    // Check policy: 'all' (default) → потрібно всім; 'any' → достатньо одного
    const policy = rmsg.approver_policy || "all";
    const { data: allApprovers } = await supabase
      .from("retention_message_approvers").select("user_id, is_approved").eq("message_id", msgId);
    const total = (allApprovers ?? []).length;
    const approvedCount = (allApprovers ?? []).filter((a: any) => a.is_approved === true).length;
    const allDone = policy === "any" ? approvedCount >= 1 : approvedCount >= total;

    if (allDone) {
      await supabase.from("retention_messages")
        .update({ status: "approved", last_action_via: "tg" })
        .eq("id", msgId);
      await supabase.from("retention_message_history").insert({
        message_id: msgId, action: "approved_via_tg", detail: me.name || "?"
      });
      await tgAnswerCallback(cb.id, "✅ Погоджено повністю");
    } else {
      await supabase.from("retention_message_history").insert({
        message_id: msgId, action: "partial_approval_via_tg", detail: `${me.name}: ${approvedCount}/${total}`
      });
      await tgAnswerCallback(cb.id, `✓ Твій голос. Чекаємо ще ${total - approvedCount}`);
    }
    const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
    if (msg.text) await tgEditMessage(msg.chat.id, msg.message_id,
      (msg.text || "") + `\n\n✓ Погодив · ${escHtml(me.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())}` + (allDone ? " · <b>Усе погоджено</b>" : ""));
    return;
  }

  // 03.06.2026 — TASK callbacks (task:done:<id> / task:doing:<id> / task:open:<id>)
  if (action === "task") {
    const taskAction = parts[1]; // done | doing | open
    const taskId = parts[2];
    if (!taskId) { await tgAnswerCallback(cb.id, "Bad task id"); return; }

    if (taskAction === "open") {
      const tasksUrl = (Deno.env.get("TASKS_URL") || "https://team.dreamcar.ua/tasks") + "/#task=" + taskId;
      await tgAnswerCallback(cb.id, "Відкрий у браузері: " + tasksUrl, true);
      return;
    }

    // Резолвимо public.users по auth_id
    const tgUserId = cb.from?.id;
    if (!tgUserId) { await tgAnswerCallback(cb.id, "TG user не визначено"); return; }
    const { data: meUser } = await supabase.from("users").select("id,name,role").eq("tg_chat_id", tgUserId).maybeSingle();
    if (!meUser) { await tgAnswerCallback(cb.id, "TG не привʼязано — /start у боті", true); return; }

    let newStatus: string | null = null;
    let label = "";
    if (taskAction === "done") { newStatus = "done"; label = "✅ Виконано"; }
    else if (taskAction === "doing") { newStatus = "doing"; label = "▶ В роботі"; }
    else { await tgAnswerCallback(cb.id, "Невідома дія по задачі"); return; }

    const updates: Record<string, unknown> = { status: newStatus, updated_at: new Date().toISOString() };
    if (newStatus === "done") updates.completed_at = new Date().toISOString();
    const upd = await supabase.from("team_tasks").update(updates).eq("id", taskId).select("id,title").maybeSingle();
    if (upd.error) {
      console.error("[task update]", upd.error);
      await tgAnswerCallback(cb.id, "Помилка: " + upd.error.message, true);
      return;
    }
    await tgAnswerCallback(cb.id, label);
    const now = new Date(); const pad = (n: number) => String(n).padStart(2, "0");
    await tgEditMessage(msg.chat.id, msg.message_id,
      (msg.text || "") + `\n\n${label} · ${escHtml(meUser.name || "?")} · ${pad(now.getHours())}:${pad(now.getMinutes())}`);
    return;
  }

  // ===================================================================
  // 05.06.2026 — TG Task Bot: taskprop:* callbacks (Sprint 1)
  // ===================================================================
  if (action === "taskprop") {
    const subAction = parts[1]; // accept | edit | dismiss | set_assignee | set_priority | set_due | confirm
    const propId = parts[2];
    if (!propId) { await tgAnswerCallback(cb.id, "Bad proposal id"); return; }

    const tgUserId = cb.from?.id;
    if (!tgUserId) { await tgAnswerCallback(cb.id, "TG user не визначено"); return; }
    const { data: meUser } = await supabase.from("users").select("id,name,role").eq("tg_chat_id", tgUserId).maybeSingle();
    if (!meUser) { await tgAnswerCallback(cb.id, "TG не привʼязано — /start", true); return; }

    // 06.06.2026 — обмеження: лише CEO/COO можуть створювати/відхиляти proposed tasks (Vadym feedback)
    const isPriv = meUser.role === "ceo" || meUser.role === "coo";
    if (!isPriv) {
      await tgAnswerCallback(cb.id, "🔒 Тільки CEO або COO можуть створювати задачі з проактивних пропозицій", true);
      return;
    }

    const { data: prop } = await supabase
      .from("tg_proposed_tasks")
      .select("*")
      .eq("id", propId)
      .maybeSingle();
    if (!prop) { await tgAnswerCallback(cb.id, "Пропозиція не знайдена", true); return; }
    // У group чатах CEO/COO може діяти на будь-яку. У DM (private) — тільки proposer.
    const isGroupProp = prop.chat_id < 0;
    if (!isGroupProp && prop.proposer_id !== meUser.id) {
      await tgAnswerCallback(cb.id, "Це не твоя пропозиція", true); return;
    }
    if (prop.state !== "proposed" && prop.state !== "editing") { await tgAnswerCallback(cb.id, "Вже оброблена", true); return; }

    if (subAction === "accept") {
      // INSERT у team_tasks (з attachments якщо були)
      const taskInsert: Record<string, unknown> = {
        title: prop.title,
        description: prop.description,
        status: "inbox",
        priority: prop.priority || "p3",
        assignee_id: prop.assignee_id,
        due_date: prop.due_date,
        created_by: meUser.id,
        tags: ["from-tg"],
        attachments: prop.attachments || [],
      };
      const { data: createdTask, error: tErr } = await supabase
        .from("team_tasks")
        .insert(taskInsert)
        .select("id, title")
        .single();
      if (tErr || !createdTask) {
        console.error("[taskprop:accept] create error:", tErr);
        await tgAnswerCallback(cb.id, "Помилка створення: " + (tErr?.message || "?"), true);
        return;
      }
      await supabase.from("tg_proposed_tasks")
        .update({ state: "accepted", created_task_id: createdTask.id, decided_at: new Date().toISOString() })
        .eq("id", propId);
      await tgAnswerCallback(cb.id, "✅ Створено");
      const tasksUrl = (Deno.env.get("TASKS_URL") || "https://team.dreamcar.ua/tasks") + "/#task=" + createdTask.id;
      await tgEditMessage(
        msg.chat.id,
        msg.message_id,
        (msg.text || "") + `\n\n✅ <b>Створено</b> · <a href="${tasksUrl}">Відкрити у Tasks</a>`,
      );
      return;
    }

    if (subAction === "dismiss") {
      await supabase.from("tg_proposed_tasks")
        .update({ state: "dismissed", decided_at: new Date().toISOString() })
        .eq("id", propId);
      await tgAnswerCallback(cb.id, "❌ Скасовано");
      await tgEditMessage(msg.chat.id, msg.message_id, (msg.text || "") + `\n\n❌ <b>Не задача</b>`);
      return;
    }

    if (subAction === "edit") {
      await supabase.from("tg_proposed_tasks")
        .update({ state: "editing" })
        .eq("id", propId);
      await tgAnswerCallback(cb.id, "✏ Що змінити?");
      // Меню вибору поля
      const editKeyboard = [
        [{ text: "👤 Виконавця", callback_data: `taskprop:edit_assignee:${propId}` },
         { text: "📅 Дедлайн", callback_data: `taskprop:edit_due:${propId}` }],
        [{ text: "🔴 Пріоритет", callback_data: `taskprop:edit_priority:${propId}` }],
        [{ text: "✅ Створити", callback_data: `taskprop:accept:${propId}` },
         { text: "↩ Назад", callback_data: `taskprop:back:${propId}` }],
      ];
      await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_BOT_TOKEN")}/editMessageReplyMarkup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          reply_markup: { inline_keyboard: editKeyboard },
        }),
      });
      return;
    }

    if (subAction === "back") {
      await supabase.from("tg_proposed_tasks")
        .update({ state: "proposed" })
        .eq("id", propId);
      await tgAnswerCallback(cb.id, "↩");
      const backKb = [
        [{ text: "✅ Створити", callback_data: `taskprop:accept:${propId}` },
         { text: "✏ Змінити", callback_data: `taskprop:edit:${propId}` }],
        [{ text: "❌ Не задача", callback_data: `taskprop:dismiss:${propId}` }],
      ];
      await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_BOT_TOKEN")}/editMessageReplyMarkup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: backKb } }),
      });
      return;
    }

    if (subAction === "edit_assignee") {
      const { data: members } = await supabase.from("users").select("id, name").eq("is_active", true).order("name");
      const buttons = (members || []).map((u: { id: string; name: string }) => [{ text: u.name, callback_data: `taskprop:set_assignee:${propId}:${u.id}` }]);
      buttons.push([{ text: "↩ Назад", callback_data: `taskprop:edit:${propId}` }]);
      await tgAnswerCallback(cb.id, "Кому?");
      await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_BOT_TOKEN")}/editMessageReplyMarkup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: buttons } }),
      });
      return;
    }

    if (subAction === "set_assignee") {
      const newAssignee = parts[3];
      await supabase.from("tg_proposed_tasks").update({ assignee_id: newAssignee }).eq("id", propId);
      await tgAnswerCallback(cb.id, "👤 Виконавця змінено");
      // повернутись до edit menu
      const editKeyboard = [
        [{ text: "👤 Виконавця", callback_data: `taskprop:edit_assignee:${propId}` },
         { text: "📅 Дедлайн", callback_data: `taskprop:edit_due:${propId}` }],
        [{ text: "🔴 Пріоритет", callback_data: `taskprop:edit_priority:${propId}` }],
        [{ text: "✅ Створити", callback_data: `taskprop:accept:${propId}` },
         { text: "↩ Назад", callback_data: `taskprop:back:${propId}` }],
      ];
      await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_BOT_TOKEN")}/editMessageReplyMarkup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: editKeyboard } }),
      });
      return;
    }

    if (subAction === "edit_priority") {
      const buttons = [
        [{ text: "🔴 P1 (терміново)", callback_data: `taskprop:set_priority:${propId}:p1` }],
        [{ text: "🟡 P2 (важливо)", callback_data: `taskprop:set_priority:${propId}:p2` }],
        [{ text: "🔵 P3 (звичайний)", callback_data: `taskprop:set_priority:${propId}:p3` }],
        [{ text: "↩ Назад", callback_data: `taskprop:edit:${propId}` }],
      ];
      await tgAnswerCallback(cb.id, "Пріоритет?");
      await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_BOT_TOKEN")}/editMessageReplyMarkup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: buttons } }),
      });
      return;
    }

    if (subAction === "set_priority") {
      const newP = parts[3];
      await supabase.from("tg_proposed_tasks").update({ priority: newP }).eq("id", propId);
      await tgAnswerCallback(cb.id, `Пріоритет: ${newP.toUpperCase()}`);
      const editKeyboard = [
        [{ text: "👤 Виконавця", callback_data: `taskprop:edit_assignee:${propId}` },
         { text: "📅 Дедлайн", callback_data: `taskprop:edit_due:${propId}` }],
        [{ text: "🔴 Пріоритет", callback_data: `taskprop:edit_priority:${propId}` }],
        [{ text: "✅ Створити", callback_data: `taskprop:accept:${propId}` },
         { text: "↩ Назад", callback_data: `taskprop:back:${propId}` }],
      ];
      await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_BOT_TOKEN")}/editMessageReplyMarkup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: editKeyboard } }),
      });
      return;
    }

    if (subAction === "edit_due") {
      // швидкі пресети
      const today = new Date();
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      const today_s = fmt(today);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
      const friday = new Date(today); friday.setDate(friday.getDate() + (5 - friday.getDay() + 7) % 7 || 7);
      const next_week = new Date(today); next_week.setDate(next_week.getDate() + 7);
      const buttons = [
        [{ text: `Сьогодні ${today_s.slice(5)}`, callback_data: `taskprop:set_due:${propId}:${today_s}` },
         { text: `Завтра ${fmt(tomorrow).slice(5)}`, callback_data: `taskprop:set_due:${propId}:${fmt(tomorrow)}` }],
        [{ text: `Пʼятниця ${fmt(friday).slice(5)}`, callback_data: `taskprop:set_due:${propId}:${fmt(friday)}` },
         { text: `+7 днів ${fmt(next_week).slice(5)}`, callback_data: `taskprop:set_due:${propId}:${fmt(next_week)}` }],
        [{ text: "Без дедлайну", callback_data: `taskprop:set_due:${propId}:none` }],
        [{ text: "↩ Назад", callback_data: `taskprop:edit:${propId}` }],
      ];
      await tgAnswerCallback(cb.id, "Дедлайн?");
      await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_BOT_TOKEN")}/editMessageReplyMarkup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: buttons } }),
      });
      return;
    }

    if (subAction === "set_due") {
      const newDue = parts[3] === "none" ? null : parts[3];
      await supabase.from("tg_proposed_tasks").update({ due_date: newDue }).eq("id", propId);
      await tgAnswerCallback(cb.id, newDue ? `Дедлайн ${newDue}` : "Без дедлайну");
      const editKeyboard = [
        [{ text: "👤 Виконавця", callback_data: `taskprop:edit_assignee:${propId}` },
         { text: "📅 Дедлайн", callback_data: `taskprop:edit_due:${propId}` }],
        [{ text: "🔴 Пріоритет", callback_data: `taskprop:edit_priority:${propId}` }],
        [{ text: "✅ Створити", callback_data: `taskprop:accept:${propId}` },
         { text: "↩ Назад", callback_data: `taskprop:back:${propId}` }],
      ];
      await fetch(`https://api.telegram.org/bot${Deno.env.get("TG_BOT_TOKEN")}/editMessageReplyMarkup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: msg.chat.id, message_id: msg.message_id, reply_markup: { inline_keyboard: editKeyboard } }),
      });
      return;
    }

    await tgAnswerCallback(cb.id, "Невідома дія taskprop");
    return;
  }

  await tgAnswerCallback(cb.id, "Невідома дія");
}

// =====================================================================
// TG Task Bot: detect task-trigger (Sprint 1, 05.06.2026)
// Updated 05.06.2026 — inline emoji mode (без reply)
// =====================================================================
// Reply-only emoji: треба явно зробити Reply з лише цим emoji
const REPLY_TRIGGER_EMOJIS = ["📌", "📋", "📝", "⚡"];
// Inline trigger emoji: 📌 у кінці звичайного повідомлення → ця сама задача
const INLINE_TRIGGER_EMOJIS = ["📌", "📋", "📝", "⚡"];

interface TaskTrigger {
  sourceText: string;
  sourceMsgId: number;
  mode: "inline" | "reply" | "cmd";
  mentionTgUserId?: number;     // з text_mention entity (direct user.id)
  mentionUsername?: string;      // з mention entity (@username)
}

// Витягти першу mention (text_mention або mention) з повідомлення-джерела
function extractMention(text: string | undefined, entities: TgEntity[] | undefined):
  { tgUserId?: number; username?: string } {
  if (!text || !entities || entities.length === 0) return {};
  for (const e of entities) {
    if (e.type === "text_mention" && e.user?.id) {
      return { tgUserId: e.user.id, username: e.user.username };
    }
    if (e.type === "mention") {
      // @username — витягуємо substring
      const u = text.substring(e.offset, e.offset + e.length).replace(/^@/, "");
      if (u) return { username: u };
    }
  }
  return {};
}

// 05.06.2026: iOS/Mac додає U+FE0F (variation selector) ПІСЛЯ emoji у TG.
// "📌️".endsWith("📌") → false! Тому стрипаємо перед matching.
function stripEmojiVariationSelector(s: string): string {
  return s.replace(/️/g, "");
}

function detectTaskTrigger(msg: TgMessage): TaskTrigger | null {
  // 07.06.2026: підтримка photo/video — у них тексту нема, є caption
  const text = msg.text || (msg as any).caption;
  if (!text) return null;
  const entities = msg.entities || (msg as any).caption_entities;
  const trimmed = stripEmojiVariationSelector(text.trim());
  const reply = msg.reply_to_message;

  // Mode 1: REPLY з єдиним emoji
  if (REPLY_TRIGGER_EMOJIS.includes(trimmed) && reply?.text) {
    const mention = extractMention(reply.text, reply.entities);
    return {
      sourceText: reply.text,
      sourceMsgId: reply.message_id,
      mode: "reply",
      mentionTgUserId: mention.tgUserId,
      mentionUsername: mention.username,
    };
  }

  // Mode 2: /task у reply
  if (trimmed.toLowerCase().startsWith("/task") && reply?.text) {
    const mention = extractMention(reply.text, reply.entities);
    return {
      sourceText: reply.text,
      sourceMsgId: reply.message_id,
      mode: "cmd",
      mentionTgUserId: mention.tgUserId,
      mentionUsername: mention.username,
    };
  }

  // Mode 3: INLINE — emoji у кінці поточного msg (з variation selector tolerance)
  for (const emoji of INLINE_TRIGGER_EMOJIS) {
    if (trimmed.endsWith(emoji)) {
      const stripped = trimmed.slice(0, -emoji.length).trim();
      if (stripped.length >= 10) {
        const mention = extractMention(text, entities);
        return {
          sourceText: stripped,
          sourceMsgId: msg.message_id,
          mode: "inline",
          mentionTgUserId: mention.tgUserId,
          mentionUsername: mention.username,
        };
      }
    }
  }

  return null;
}

async function handleTaskTrigger(
  supabase: ReturnType<typeof createClient>,
  msg: TgMessage,
  trigger: TaskTrigger,
): Promise<boolean> {
  if (!msg.from?.id) return false;

  const chatId = msg.chat.id;

  // Check chat whitelist (silent skip if not whitelisted)
  const { data: chat } = await supabase
    .from("tg_listening_chats")
    .select("chat_id, chat_title, reactive")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!chat || !chat.reactive) return false;

  // Fire-and-forget POST to tg-task-extract з mention info
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/tg-task-extract`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        source: "emoji",
        chat_id: chatId,
        chat_title: chat.chat_title || msg.chat.title,
        message_id: trigger.sourceMsgId,
        proposer_tg_id: msg.from.id,
        text: trigger.sourceText,
        mention_tg_user_id: trigger.mentionTgUserId,
        mention_username: trigger.mentionUsername,
      }),
    });
  } catch (e) {
    console.error("[task-trigger] fetch error:", e);
  }
  return true;
}

// Auto-discovery: коли бачимо юзера у whitelisted chat — заповнюємо tg_username
// якщо у БД він порожній. Це робить @mention резолв все ефективнішим з часом.
async function tryAutoDiscoverUsername(
  supabase: ReturnType<typeof createClient>,
  msg: TgMessage,
): Promise<void> {
  if (!msg.from?.id || !msg.from.username) return;
  try {
    // Тільки для whitelisted чатів
    const { data: chat } = await supabase
      .from("tg_listening_chats").select("chat_id").eq("chat_id", msg.chat.id).maybeSingle();
    if (!chat) return;
    // Знайти юзера за tg_chat_id
    const { data: u } = await supabase
      .from("users")
      .select("id, tg_username")
      .eq("tg_chat_id", msg.from.id)
      .maybeSingle();
    if (!u) return;
    if (!u.tg_username) {
      await supabase.from("users").update({ tg_username: msg.from.username }).eq("id", u.id);
      console.log("[tg-discover] filled tg_username:", msg.from.username, "for user", u.id);
    }
  } catch (e) {
    console.warn("[tg-discover] error:", e);
  }
}

// =====================================================================
// 07.06.2026 — TG file attachments → Supabase Storage
// =====================================================================
// Завантажує photo/document/video з Telegram у Supabase Storage bucket tg-attachments.
// Повертає масив {type, url, file_id, mime, size, file_name?}
async function downloadTgAttachments(
  supabase: ReturnType<typeof createClient>,
  msg: any,
): Promise<Array<{type:string;url:string;file_id:string;mime?:string;size?:number;file_name?:string;width?:number;height?:number}>> {
  const items: any[] = [];
  // Photo: array, беремо найбільше (last)
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const largest = msg.photo[msg.photo.length - 1];
    items.push({ type: "photo", file_id: largest.file_id, size: largest.file_size, width: largest.width, height: largest.height });
  }
  if (msg.document) {
    items.push({ type: "document", file_id: msg.document.file_id, mime: msg.document.mime_type, size: msg.document.file_size, file_name: msg.document.file_name });
  }
  if (msg.video) {
    items.push({ type: "video", file_id: msg.video.file_id, mime: msg.video.mime_type, size: msg.video.file_size, width: msg.video.width, height: msg.video.height });
  }
  if (msg.video_note) {
    items.push({ type: "video", file_id: msg.video_note.file_id, mime: "video/mp4", size: msg.video_note.file_size });
  }
  if (msg.audio) {
    items.push({ type: "audio", file_id: msg.audio.file_id, mime: msg.audio.mime_type, size: msg.audio.file_size, file_name: msg.audio.file_name });
  }
  if (msg.voice) {
    items.push({ type: "voice", file_id: msg.voice.file_id, mime: msg.voice.mime_type || "audio/ogg", size: msg.voice.file_size });
  }
  if (items.length === 0) return [];

  const TG_BOT_TOKEN_LOCAL = Deno.env.get("TG_BOT_TOKEN") ?? "";
  if (!TG_BOT_TOKEN_LOCAL) {
    console.warn("[tg-attach] TG_BOT_TOKEN missing");
    return [];
  }
  const results: any[] = [];
  for (const item of items) {
    try {
      // 1. getFile → отримуємо file_path
      const gfResp = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN_LOCAL}/getFile?file_id=${item.file_id}`);
      const gfJson = await gfResp.json();
      if (!gfJson.ok || !gfJson.result?.file_path) {
        console.warn("[tg-attach] getFile failed:", item.file_id, gfJson);
        continue;
      }
      const filePath = gfJson.result.file_path;
      // TG ліміт getFile: 20MB
      if (gfJson.result.file_size && gfJson.result.file_size > 20 * 1024 * 1024) {
        console.warn("[tg-attach] file too large:", item.file_id);
        continue;
      }
      // 2. Download file content
      const fileResp = await fetch(`https://api.telegram.org/file/bot${TG_BOT_TOKEN_LOCAL}/${filePath}`);
      if (!fileResp.ok) {
        console.warn("[tg-attach] download failed:", item.file_id);
        continue;
      }
      const blob = await fileResp.blob();
      // 3. Upload у Supabase Storage
      const ext = filePath.split(".").pop() || "bin";
      const objectKey = `${msg.chat.id}/${msg.message_id}_${item.file_id.slice(0, 16)}.${ext}`;
      const uploadResp = await supabase.storage
        .from("tg-attachments")
        .upload(objectKey, blob, { contentType: item.mime || blob.type || "application/octet-stream", upsert: true });
      if (uploadResp.error) {
        console.warn("[tg-attach] upload error:", uploadResp.error);
        continue;
      }
      // 4. Get public URL
      const { data: urlData } = supabase.storage.from("tg-attachments").getPublicUrl(objectKey);
      results.push({
        type: item.type,
        url: urlData.publicUrl,
        file_id: item.file_id,
        mime: item.mime,
        size: item.size,
        file_name: item.file_name,
        width: item.width,
        height: item.height,
      });
    } catch (e) {
      console.error("[tg-attach] item error:", item.file_id, e);
    }
  }
  return results;
}

// 05.06.2026 Sprint 2: пушити кожне msg у whitelisted chat у buffer для 18:00 scan
// 07.06.2026: підтримка photo/document/video → attachments
async function pushToBuffer(
  supabase: ReturnType<typeof createClient>,
  msg: TgMessage,
): Promise<void> {
  // Skip commands
  if (msg.text?.startsWith("/")) return;
  if (!msg.from?.id) return;
  // Зберігаємо якщо є text АБО caption АБО будь-який медіа-payload
  const hasMedia = !!(msg.photo || msg.document || msg.video || msg.video_note || msg.audio || msg.voice);
  const text = msg.text || (msg as any).caption || "";
  if (!text && !hasMedia) return; // зовсім порожнє

  try {
    // тільки whitelisted з proactive=true
    const { data: chat } = await supabase
      .from("tg_listening_chats")
      .select("chat_id, proactive")
      .eq("chat_id", msg.chat.id)
      .maybeSingle();
    if (!chat || !chat.proactive) return;

    // Завантажуємо attachments (якщо є)
    const attachments = hasMedia ? await downloadTgAttachments(supabase, msg) : [];

    const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || msg.from.username || "?";
    await supabase.from("tg_chat_buffer").upsert({
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      user_tg_id: msg.from.id,
      user_name: fullName,
      text: text,
      caption: (msg as any).caption || null,
      attachments: attachments,
      reply_to: msg.reply_to_message?.message_id || null,
      ts: new Date().toISOString(),
    }, { onConflict: "chat_id,message_id" });
  } catch (e) {
    console.warn("[tg-buffer] push error:", e);
  }
}

// =====================================================================
// v26: AI Assistant + Voice forwarding to tg-ai-router
// =====================================================================
async function forwardToAI(
  supabase: ReturnType<typeof createClient>,
  chatId: number,
  tgUser: any,
  text: string | undefined,
  voiceFileId: string | undefined,
  messageId: number
): Promise<void> {
  // Find user_db_id by tg_chat_id
  const { data: u } = await supabase
    .from("users")
    .select("id, name, role")
    .eq("tg_chat_id", chatId)
    .maybeSingle();

  const payload = {
    chat_id: chatId,
    user_db_id: u?.id || null,
    user_name: u?.name || tgUser?.first_name || "друг",
    user_role: u?.role || "member",
    text,
    voice_file_id: voiceFileId,
    message_id: messageId,
  };

  try {
    await fetch(`${SUPABASE_URL}/functions/v1/tg-ai-router`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("forwardToAI error:", e);
  }
}

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

    // ===== 05.06.2026: TG Task Bot — inline 📌 / reply 📌 / /task → extract task =====
    // Async fire-and-forget auto-discovery tg_username
    tryAutoDiscoverUsername(supabase, msg).catch((e) => console.warn("[tg-discover]", e));
    pushToBuffer(supabase, msg).catch((e) => console.warn("[tg-buffer]", e));

    // 07.06.2026: підтримка caption у photo/video — раніше тут пропускали
    if (msg.text || (msg as any).caption) {
      const trigger = detectTaskTrigger(msg);
      if (trigger) {
        const handled = await handleTaskTrigger(supabase, msg, trigger);
        if (handled) {
          return new Response(JSON.stringify({ ok: true, kind: "task-trigger", mode: trigger.mode }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
      }
    }

    if (!isGroup && msg.text && msg.reply_to_message) {
      const handled = await handleReworkCommentReply(supabase, msg);
      if (handled) {
        return new Response(JSON.stringify({ ok: true, kind: "rework-comment" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }

    if (!isGroup && (msg.photo || msg.video || msg.document)) {
      await handleFileMessage(supabase, msg, isGroup);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

        if (!isGroup && msg.voice) {
      await forwardToAI(supabase, chatId, tgUser, undefined, msg.voice.file_id, msg.message_id);
      return new Response(JSON.stringify({ ok: true, kind: "voice-ai" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

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
    else if (cmd === "/chatid") await handleChatId(chatId, msg);
    else if (cmd === "/listen_here") await handleListenHere(supabase, chatId, tgUser, msg);
    else if (cmd === "/listen_stop") await handleListenStop(supabase, chatId, tgUser, msg);
    else if (cmd === "/listen_status") await handleListenStatus(supabase, chatId);
    else if (cmd === "/tasks" || cmd === "/mytasks") await handleMyTasks(supabase, chatId, isGroup);
    else if (cmd && !isGroup) await tgSend(chatId, "ℹ️ Не зрозумів. /help");
    else if (!cmd && !isGroup && msg.text) {
      // Текст БЕЗ команди у DM → AI асистент
      await forwardToAI(supabase, chatId, tgUser, msg.text, undefined, msg.message_id);
      return new Response(JSON.stringify({ ok: true, kind: "text-ai" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

  } catch (e) {
    console.error("handler error", e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});