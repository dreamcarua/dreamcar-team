// =====================================================================
// DreamCar HQ — Notify TG v6
// + text_body публікації у review messages
// + sendPhoto/sendVideo якщо є creatives (preview як у HQ)
// + Хто має погодити, deadline, requester
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN     = Deno.env.get("TG_BOT_TOKEN")     ?? "";
const TG_GROUP_CHAT_ID = Deno.env.get("TG_GROUP_CHAT_ID") ?? "";
const HQ_WEBHOOK_SECRET = Deno.env.get("HQ_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")     ?? Deno.env.get("HQ_DB_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";

const HQ_BASE_URL = "https://dreamcarua.github.io/dreamcar-team/hq/";
const MAX_CAPTION = 1024;  // TG limit для photo/video caption
const MAX_TEXT_PREVIEW = 800;  // обрізаємо text_body щоб лишилось місце на header

const ALLOWED_ORIGINS = [
  "https://dreamcarua.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string; schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}
interface PubRow {
  id: string; title: string; status: string; publish_at: string;
  deadline_on: string | null; created_by: string | null;
  last_action_via: string | null;
  approver_policy?: string | null;
  text_body?: string | null;
  hashtags?: string[] | null;
}
interface UserRow {
  id: string; name: string; email: string | null; role: string;
  tg_chat_id: number | string | null; tg_username: string | null;
}
interface CreativeRow {
  id: string; type: string; thumbnail_url: string | null; name: string;
}
interface InlineButton { text: string; callback_data?: string; url?: string; }
interface ReplyMarkup { inline_keyboard: InlineButton[][]; }

async function tgSend(chatId: string | number, text: string, opts: { silent?: boolean; reply_markup?: ReplyMarkup } = {}) {
  if (!TG_BOT_TOKEN) return;
  const body: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML",
    disable_web_page_preview: true, disable_notification: opts.silent ?? false,
  };
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) console.error(`TG send fail ${r.status}: ${await r.text()}`);
  } catch (e) { console.error("TG send threw", e); }
}

async function tgSendPhoto(chatId: string | number, photoUrl: string, caption: string, opts: { reply_markup?: ReplyMarkup } = {}) {
  if (!TG_BOT_TOKEN) return false;
  const body: Record<string, unknown> = {
    chat_id: chatId, photo: photoUrl,
    caption: caption.slice(0, MAX_CAPTION),
    parse_mode: "HTML",
  };
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendPhoto`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error(`TG sendPhoto fail ${r.status}: ${await r.text()}`);
      return false;
    }
    return true;
  } catch (e) { console.error("TG sendPhoto threw", e); return false; }
}

async function tgSendVideo(chatId: string | number, videoUrl: string, caption: string, opts: { reply_markup?: ReplyMarkup } = {}) {
  if (!TG_BOT_TOKEN) return false;
  const body: Record<string, unknown> = {
    chat_id: chatId, video: videoUrl,
    caption: caption.slice(0, MAX_CAPTION),
    parse_mode: "HTML",
  };
  if (opts.reply_markup) body.reply_markup = opts.reply_markup;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendVideo`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error(`TG sendVideo fail ${r.status}: ${await r.text()}`);
      return false;
    }
    return true;
  } catch (e) { console.error("TG sendVideo threw", e); return false; }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function fmtDt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function reviewKeyboard(pubId: string): ReplyMarkup {
  return {
    inline_keyboard: [
      [
        { text: "✓ Погодити", callback_data: `appr:${pubId}:y` },
        { text: "↩ Повернути", callback_data: `appr:${pubId}:n` },
      ],
      [{ text: "🔗 Відкрити в HQ", url: `${HQ_BASE_URL}#publication/${pubId}` }],
    ],
  };
}

function buildReviewMessage(
  pub: PubRow,
  requester: UserRow | null,
  approvers: UserRow[],
  forCaption: boolean,
): string {
  const lines: string[] = [];
  lines.push(`📝 <b>На погодження</b>`);
  lines.push(`«${escHtml(pub.title)}»`);
  if (requester) lines.push(`Від: ${escHtml(requester.name)}`);

  if (approvers.length > 0) {
    const names = approvers.map(u => escHtml(u.name)).join(", ");
    const policy = pub.approver_policy === "any" ? "будь-хто з" : "потрібен ✓ від ВСІХ";
    if (approvers.length === 1) {
      lines.push(`👤 Має погодити: <b>${names}</b>`);
    } else {
      lines.push(`👥 Має погодити (${policy}): <b>${names}</b>`);
    }
  }

  lines.push(`📅 Публікація: ${fmtDt(pub.publish_at)}`);
  if (pub.deadline_on) lines.push(`⏰ Дедлайн матеріалу: ${pub.deadline_on}`);

  // Додаємо повний text body публікації (з обмеженням)
  if (pub.text_body && pub.text_body.trim()) {
    const textMaxLen = forCaption ? Math.max(0, MAX_CAPTION - lines.join("\n").length - 40) : MAX_TEXT_PREVIEW;
    const body = pub.text_body.trim();
    const truncated = body.length > textMaxLen ? body.slice(0, textMaxLen - 1) + "…" : body;
    lines.push("");
    lines.push(`<i>${escHtml(truncated)}</i>`);
  }

  // Hashtags як bonus
  if (pub.hashtags && pub.hashtags.length > 0 && !forCaption) {
    lines.push("");
    lines.push(pub.hashtags.map(h => h.startsWith("#") ? h : "#" + h).join(" "));
  }

  return lines.join("\n");
}

function buildApprovedMessage(pub: PubRow, approver: UserRow | null): string {
  return [
    `✅ <b>Погоджено</b>`,
    `«${escHtml(pub.title)}»`,
    approver ? `${escHtml(approver.name)} погодив(ла)` : "",
    ``,
    `🔗 <a href="${HQ_BASE_URL}#publication/${pub.id}">Відкрити в HQ</a>`,
  ].filter(Boolean).join("\n");
}
function buildReworkMessage(pub: PubRow, approver: UserRow | null): string {
  return [
    `↩️ <b>Повернуто на доопрацювання</b>`,
    `«${escHtml(pub.title)}»`,
    approver ? `${escHtml(approver.name)} відправив(ла) на доопрацювання` : "",
    ``,
    `🔗 <a href="${HQ_BASE_URL}#publication/${pub.id}">Відкрити в HQ · подивись коментар</a>`,
  ].filter(Boolean).join("\n");
}
function buildCommentMessage(pub: PubRow, comment: string, author: UserRow | null): string {
  const truncated = comment.length > 240 ? comment.slice(0, 237) + "…" : comment;
  return [
    `💬 <b>Новий коментар</b> до «${escHtml(pub.title)}»`,
    author ? `<i>${escHtml(author.name)}:</i>` : "",
    escHtml(truncated),
    ``,
    `🔗 <a href="${HQ_BASE_URL}#publication/${pub.id}">Відкрити в HQ</a>`,
  ].filter(Boolean).join("\n");
}

async function loadFirstCreative(supabase: ReturnType<typeof createClient>, pubId: string): Promise<CreativeRow | null> {
  const { data, error } = await supabase
    .from("creative_publications")
    .select("creative_id, sort_order, creatives:creative_id (id, type, thumbnail_url, name)")
    .eq("publication_id", pubId)
    .order("sort_order", { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  // @ts-ignore join shape
  const c = data[0].creatives as CreativeRow;
  if (!c || !c.thumbnail_url) return null;
  return c;
}

async function sendReviewToChat(
  chatId: string | number,
  pub: PubRow,
  creative: CreativeRow | null,
  requester: UserRow | null,
  approvers: UserRow[],
) {
  const kb = reviewKeyboard(pub.id);
  if (creative && creative.thumbnail_url) {
    const caption = buildReviewMessage(pub, requester, approvers, true);
    const isVideo = creative.type === "video";
    const ok = isVideo
      ? await tgSendVideo(chatId, creative.thumbnail_url, caption, { reply_markup: kb })
      : await tgSendPhoto(chatId, creative.thumbnail_url, caption, { reply_markup: kb });
    if (ok) return;
    // Fallback на text якщо media не послалась
  }
  const text = buildReviewMessage(pub, requester, approvers, false);
  await tgSend(chatId, text, { reply_markup: kb });
}

async function handlePubChange(supabase: ReturnType<typeof createClient>, payload: WebhookPayload) {
  const rec = payload.record as PubRow | null;
  const old = payload.old_record as PubRow | null;
  if (!rec) return;

  const statusChanged = !old || old.status !== rec.status;
  if (!statusChanged) return;

  if ((rec.status === "approved" || rec.status === "rework") && rec.last_action_via === "tg") {
    console.log("Skip push — last_action_via=tg");
    return;
  }

  if (rec.status === "review") {
    const { data: approversData } = await supabase
      .from("publication_approvers")
      .select("user_id, users:user_id (id, name, email, role, tg_chat_id, tg_username)")
      .eq("publication_id", rec.id);
    const approverUsers: UserRow[] = (approversData ?? [])
      // @ts-ignore join shape
      .map(row => row.users as UserRow)
      .filter(Boolean);

    const requester = rec.created_by
      ? await supabase.from("users").select("*").eq("id", rec.created_by).maybeSingle().then(({ data }) => data)
      : null;

    const creative = await loadFirstCreative(supabase, rec.id);

    if (TG_GROUP_CHAT_ID) {
      await sendReviewToChat(TG_GROUP_CHAT_ID, rec, creative, requester as UserRow | null, approverUsers);
    }
    for (const u of approverUsers) {
      if (u?.tg_chat_id) {
        await sendReviewToChat(u.tg_chat_id, rec, creative, requester as UserRow | null, approverUsers);
      }
    }
  } else if (rec.status === "approved" || rec.status === "rework") {
    const approverData = rec.created_by
      ? await supabase.from("users").select("*").eq("id", rec.created_by).maybeSingle().then(({ data }) => data)
      : null;
    const { data: resps } = await supabase
      .from("publication_responsibles")
      .select("user_id, users:user_id (id, name, email, role, tg_chat_id, tg_username)")
      .eq("publication_id", rec.id);

    const text = rec.status === "approved"
      ? buildApprovedMessage(rec, approverData as UserRow | null)
      : buildReworkMessage(rec, approverData as UserRow | null);

    if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text);
    for (const row of resps ?? []) {
      // @ts-ignore join shape
      const u: UserRow | undefined = row.users;
      if (u?.tg_chat_id) await tgSend(u.tg_chat_id, text);
    }
  }
}

async function handleCommentInsert(supabase: ReturnType<typeof createClient>, payload: WebhookPayload) {
  const rec = payload.record as { publication_id: string; author_id: string; body: string } | null;
  if (!rec) return;
  const { data: pub } = await supabase
    .from("publications").select("id, title, status, publish_at, deadline_on, created_by, last_action_via")
    .eq("id", rec.publication_id).maybeSingle();
  if (!pub) return;
  const { data: author } = await supabase
    .from("users").select("*").eq("id", rec.author_id).maybeSingle();
  const text = buildCommentMessage(pub as PubRow, rec.body || "", author as UserRow | null);
  if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text, { silent: true });
}

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-hq-secret, content-type",
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

  let payload: WebhookPayload;
  try { payload = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400, headers: corsHeaders(origin) }); }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response("Missing service config", { status: 500, headers: corsHeaders(origin) });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    if (payload.table === "publications" && (payload.type === "UPDATE" || payload.type === "INSERT")) {
      await handlePubChange(supabase, payload);
    } else if (payload.table === "comments" && payload.type === "INSERT") {
      await handleCommentInsert(supabase, payload);
    }
  } catch (e) {
    console.error("Handler threw", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
});
