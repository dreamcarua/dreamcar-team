// =====================================================================
// DreamCar HQ — Notify TG Edge Function
// =====================================================================
// Викликається Supabase Database Webhook коли:
//   1. publication.status → 'review' (потрібне погодження)
//   2. publication.status → 'approved' / 'rework' (фідбек відповідальному)
//   3. comments INSERT (новий коментар у публікації)
//
// Шле повідомлення:
//   - У спільний чат команди (HQ_CONFIG.TG_GROUP_CHAT_ID)
//   - + персональні DM кожному, кого це стосується, ЯКЩО у public.users
//     є tg_chat_id (зареєстрований через TG Login Widget)
//
// Конфіг (Supabase Project Settings → Edge Functions → Secrets):
//   TG_BOT_TOKEN       — токен бота
//   TG_GROUP_CHAT_ID   — chat_id команди (числовий, з мінусом для груп)
//   HQ_WEBHOOK_SECRET  — спільний секрет, перевіряється у заголовку
//   SUPABASE_URL       — авто
//   SUPABASE_SERVICE_ROLE_KEY — авто (потрібен щоб обходити RLS і читати юзерів)
//
// Тест:
//   curl -X POST <function-url> \
//     -H "Authorization: Bearer <anon-key>" \
//     -H "x-hq-secret: <secret>" \
//     -H "content-type: application/json" \
//     -d '{"type":"INSERT","table":"publications","record":{...},"old_record":{...}}'
// =====================================================================

// Deno runtime — глобальні Deno/fetch/console доступні

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN     = Deno.env.get("TG_BOT_TOKEN")     ?? "";
const TG_GROUP_CHAT_ID = Deno.env.get("TG_GROUP_CHAT_ID") ?? "";
const HQ_WEBHOOK_SECRET = Deno.env.get("HQ_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL")     ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ALLOWED_ORIGINS = [
  "https://dreamcarua.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

interface PubRow {
  id: string;
  title: string;
  status: string;
  publish_at: string;
  deadline_on: string | null;
  created_by: string | null;
}

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  role: string;
  tg_chat_id: number | string | null;
  tg_username: string | null;
}

// ---------- TG helpers ----------
async function tgSend(chatId: string | number, text: string, opts: { silent?: boolean; markdown?: boolean } = {}) {
  if (!TG_BOT_TOKEN) {
    console.warn("TG_BOT_TOKEN missing — skipping send");
    return;
  }
  const url = `https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: opts.markdown ? "MarkdownV2" : "HTML",
    disable_web_page_preview: true,
    disable_notification: opts.silent ?? false,
  };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.text();
      console.error(`TG send fail ${r.status}: ${err}`);
    }
  } catch (e) {
    console.error("TG send threw", e);
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtDt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Build notification text ----------
function buildReviewMessage(pub: PubRow, requester: UserRow | null): string {
  const lines: string[] = [];
  lines.push(`📝 <b>На погодження</b>`);
  lines.push(`«${escHtml(pub.title)}»`);
  if (requester) lines.push(`Від: ${escHtml(requester.name)}`);
  lines.push(`Публікація: ${fmtDt(pub.publish_at)}`);
  if (pub.deadline_on) lines.push(`Дедлайн матеріалу: ${pub.deadline_on}`);
  lines.push(``);
  lines.push(`🔗 <a href="https://dreamcarua.github.io/dreamcar-team/hq/#publication/${pub.id}">Відкрити в HQ</a>`);
  return lines.join("\n");
}

function buildApprovedMessage(pub: PubRow, approver: UserRow | null): string {
  return [
    `✅ <b>Погоджено</b>`,
    `«${escHtml(pub.title)}»`,
    approver ? `${escHtml(approver.name)} погодив(ла)` : "",
    ``,
    `🔗 <a href="https://dreamcarua.github.io/dreamcar-team/hq/#publication/${pub.id}">Відкрити в HQ</a>`,
  ].filter(Boolean).join("\n");
}

function buildReworkMessage(pub: PubRow, approver: UserRow | null): string {
  return [
    `↩️ <b>Повернуто на доопрацювання</b>`,
    `«${escHtml(pub.title)}»`,
    approver ? `${escHtml(approver.name)} відправив(ла) на доопрацювання` : "",
    ``,
    `🔗 <a href="https://dreamcarua.github.io/dreamcar-team/hq/#publication/${pub.id}">Відкрити в HQ · подивись коментар</a>`,
  ].filter(Boolean).join("\n");
}

function buildCommentMessage(pub: PubRow, comment: string, author: UserRow | null): string {
  const truncated = comment.length > 240 ? comment.slice(0, 237) + "…" : comment;
  return [
    `💬 <b>Новий коментар</b> до «${escHtml(pub.title)}»`,
    author ? `<i>${escHtml(author.name)}:</i>` : "",
    escHtml(truncated),
    ``,
    `🔗 <a href="https://dreamcarua.github.io/dreamcar-team/hq/#publication/${pub.id}">Відкрити в HQ</a>`,
  ].filter(Boolean).join("\n");
}

// ---------- Webhook handlers ----------
async function handlePubChange(supabase: ReturnType<typeof createClient>, payload: WebhookPayload) {
  const rec = payload.record as PubRow | null;
  const old = payload.old_record as PubRow | null;
  if (!rec) return;

  // Status changed?
  const statusChanged = !old || old.status !== rec.status;
  if (!statusChanged) return;

  if (rec.status === "review") {
    // Notify approvers
    const { data: approvers } = await supabase
      .from("publication_approvers")
      .select("user_id, users:user_id (id, name, email, role, tg_chat_id, tg_username)")
      .eq("publication_id", rec.id);
    const requester = rec.created_by
      ? await supabase.from("users").select("*").eq("id", rec.created_by).maybeSingle().then(({ data }) => data)
      : null;
    const text = buildReviewMessage(rec, requester as UserRow | null);

    // Group chat
    if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text);

    // Personal DMs
    for (const row of approvers ?? []) {
      // @ts-ignore — join shape
      const u: UserRow | undefined = row.users;
      if (u?.tg_chat_id) await tgSend(u.tg_chat_id, text);
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
      // @ts-ignore — join shape
      const u: UserRow | undefined = row.users;
      if (u?.tg_chat_id) await tgSend(u.tg_chat_id, text);
    }
  }
}

async function handleCommentInsert(supabase: ReturnType<typeof createClient>, payload: WebhookPayload) {
  const rec = payload.record as { publication_id: string; author_id: string; body: string } | null;
  if (!rec) return;

  const { data: pub } = await supabase
    .from("publications")
    .select("id, title, status, publish_at, deadline_on, created_by")
    .eq("id", rec.publication_id)
    .maybeSingle();
  if (!pub) return;

  const { data: author } = await supabase
    .from("users")
    .select("*")
    .eq("id", rec.author_id)
    .maybeSingle();

  const text = buildCommentMessage(pub as PubRow, rec.body || "", author as UserRow | null);

  // Group chat only (DM на коменти = шум; додамо опційно пізніше)
  if (TG_GROUP_CHAT_ID) await tgSend(TG_GROUP_CHAT_ID, text, { silent: true });
}

// ---------- HTTP entry ----------
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

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders(origin) });
  }

  // Secret check
  if (HQ_WEBHOOK_SECRET) {
    const got = req.headers.get("x-hq-secret");
    if (got !== HQ_WEBHOOK_SECRET) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders(origin) });
    }
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad JSON", { status: 400, headers: corsHeaders(origin) });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response("Missing service config", { status: 500, headers: corsHeaders(origin) });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    if (payload.table === "publications" && (payload.type === "UPDATE" || payload.type === "INSERT")) {
      await handlePubChange(supabase, payload);
    } else if (payload.table === "comments" && payload.type === "INSERT") {
      await handleCommentInsert(supabase, payload);
    } else {
      console.log(`Ignoring ${payload.type} on ${payload.table}`);
    }
  } catch (e) {
    console.error("Handler threw", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
});
