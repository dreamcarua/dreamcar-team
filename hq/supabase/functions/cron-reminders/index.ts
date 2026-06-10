// =====================================================================
// DreamCar HQ — Cron Reminders v3
// + #142 FIX: припинити спам нагадуваннями на approved-постах
//   - G4 (CEO escalation): виключено approved (approved готовий, не критичне)
//   - G6 (T-10хв): виключено approved
//   - G7 (T+10хв): anti-spam 1h → 24h, фокус на не-approved
//   - НОВЕ G4a: approved + минув час → ТІЛЬКИ responsibles (1×/24h, "опубліковуй!")
// + #125 G6/G7 (T-10хв / T+10хв)
// =====================================================================
// pg_cron РЕКОМЕНДОВАНО КОЖНІ 5 ХВ.
//
// Тригери:
//   G2a/G2b. publish_at у наст. 2 дні + текст<50 АБО no creatives → ping responsibles
//   G3.      status='review' AND updated_at<now-24h → ре-пінг approver
//   G4.      publish_at<now AND status NOT IN (published,approved) AND <6h → CEO/COO ескалація
//   G4a.     publish_at<now AND status='approved' → ТІЛЬКИ responsibles "опубліковуй!" (24h anti-spam)
//   G5b.     status='review' AND created_at<now-48h → ескалація іншому founder
//   G6.      publish_at у вікні now+5..+15хв AND status NOT IN (published,approved) → пінг -10хв
//   G7.      publish_at у вікні now-15..-5хв AND status NOT IN (published) → ескалація +10хв (24h anti-spam)
//
// Secrets:
//   TG_BOT_TOKEN, HQ_CRON_SECRET, SUPABASE_URL/HQ_DB_URL,
//   SUPABASE_SERVICE_ROLE_KEY/HQ_DB_SERVICE_KEY
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN  = Deno.env.get("TG_BOT_TOKEN")  ?? "";
const CRON_SECRET   = Deno.env.get("HQ_CRON_SECRET") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  ?? Deno.env.get("HQ_DB_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";

const HQ_URL = "https://dreamcarua.github.io/dreamcar-team/hq/";

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
// #330 (11.06.2026 HARD RULE): всі дати у Europe/Kyiv (GMT+3 літом / GMT+2 зимою)
function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv",
      day: "2-digit", month: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).format(d).replace(",", "");
  } catch { return iso; }
}

async function tgSend(chatId: number | string, text: string, opts: Record<string, unknown> = {}): Promise<void> {
  if (!TG_BOT_TOKEN) return;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...opts,
      }),
    });
    if (!r.ok) console.error("tgSend fail", r.status, await r.text());
  } catch (e) { console.error("tgSend threw", e); }
}

interface UserRow { id: string; name: string | null; role: string | null; tg_chat_id: number | string | null; }
interface Pub {
  id: string; title: string; status: string; publish_at: string; deadline_on: string | null;
  text: string | null; updated_at: string; created_at: string;
}

async function checkReminderSent(supabase: ReturnType<typeof createClient>, pubId: string, kind: string, windowHrs: number): Promise<boolean> {
  const since = new Date(Date.now() - windowHrs * 3600 * 1000).toISOString();
  const { count } = await supabase
    .from("publication_history")
    .select("id", { count: "exact", head: true })
    .eq("publication_id", pubId)
    .eq("action", `reminder:${kind}`)
    .gte("at", since);
  return (count ?? 0) > 0;
}
async function recordReminder(supabase: ReturnType<typeof createClient>, pubId: string, kind: string, detail: string) {
  try {
    await supabase.from("publication_history").insert({
      publication_id: pubId,
      action: `reminder:${kind}`,
      detail: detail,
      author: null,
    });
  } catch (e) { console.warn("recordReminder failed:", e); }
}

async function getRecipients(supabase: ReturnType<typeof createClient>, pubId: string, role: "responsibles" | "approvers"): Promise<UserRow[]> {
  const joinTable = role === "responsibles" ? "publication_responsibles" : "publication_approvers";
  const { data } = await supabase.from(joinTable).select("user_id").eq("publication_id", pubId);
  const userIds = (data ?? []).map(r => r.user_id);
  if (userIds.length === 0) return [];
  const { data: vacs } = await supabase
    .from("user_vacations")
    .select("user_id, deputy_id, from_date, to_date")
    .in("user_id", userIds);
  const today = new Date().toISOString().slice(0, 10);
  const replacements: Record<string, string> = {};
  for (const v of vacs ?? []) {
    if (v.deputy_id && v.from_date <= today && today <= v.to_date) {
      replacements[v.user_id] = v.deputy_id;
    }
  }
  const finalIds = Array.from(new Set(userIds.map(id => replacements[id] ?? id)));
  const { data: users } = await supabase
    .from("users")
    .select("id, name, role, tg_chat_id")
    .in("id", finalIds)
    .not("tg_chat_id", "is", null);
  return (users ?? []) as UserRow[];
}

async function getFounders(supabase: ReturnType<typeof createClient>): Promise<UserRow[]> {
  const { data } = await supabase
    .from("users")
    .select("id, name, role, tg_chat_id")
    .in("role", ["ceo", "coo"])
    .not("tg_chat_id", "is", null);
  return (data ?? []) as UserRow[];
}

async function run(supabase: ReturnType<typeof createClient>) {
  const nowIso = new Date().toISOString();
  const in1dIso = new Date(Date.now() + 1 * 86400000).toISOString();
  const in2dIso = new Date(Date.now() + 2 * 86400000).toISOString();
  const ago24hIso = new Date(Date.now() - 24 * 3600000).toISOString();
  const ago48hIso = new Date(Date.now() - 48 * 3600000).toISOString();
  const tMinus15 = new Date(Date.now() + 5 * 60000).toISOString();
  const tMinus5 = new Date(Date.now() + 15 * 60000).toISOString();
  const tPlus5 = new Date(Date.now() - 5 * 60000).toISOString();
  const tPlus15 = new Date(Date.now() - 15 * 60000).toISOString();

  let pinged = 0;

  // ====================================================================
  // G2: 2 дні до публікації — перевірка контенту
  // ====================================================================
  {
    const { data: pubs } = await supabase
      .from("publications")
      .select("id, title, status, publish_at, text, updated_at, created_at")
      .gte("publish_at", in1dIso)
      .lte("publish_at", in2dIso)
      .not("status", "in", "(approved,published)")
      .is("deleted_at", null);

    for (const p of (pubs ?? []) as Pub[]) {
      const textShort = (p.text || "").trim().length < 50;
      const { count: creCnt } = await supabase
        .from("creative_publications")
        .select("creative_id", { count: "exact", head: true })
        .eq("publication_id", p.id);
      const noCreative = (creCnt ?? 0) === 0;

      if (textShort) {
        if (!(await checkReminderSent(supabase, p.id, "text2d", 24))) {
          const recipients = await getRecipients(supabase, p.id, "responsibles");
          for (const u of recipients) {
            await tgSend(u.tg_chat_id!,
              `⏰ <b>За 2 дні до публікації</b> «${escHtml(p.title)}» — текст ще не заповнений (${(p.text || "").trim().length} симв).\n` +
              `Час: ${fmtDateTime(p.publish_at)}\n` +
              `🔗 <a href="${HQ_URL}#publication/${p.id}">Відкрити в HQ</a>`);
            pinged++;
          }
          await recordReminder(supabase, p.id, "text2d", `${recipients.length} responsibles pinged`);
        }
      }

      if (noCreative) {
        if (!(await checkReminderSent(supabase, p.id, "crea2d", 24))) {
          const recipients = await getRecipients(supabase, p.id, "responsibles");
          for (const u of recipients) {
            await tgSend(u.tg_chat_id!,
              `🎨 <b>За 2 дні до публікації</b> «${escHtml(p.title)}» — креатив ще не завантажений.\n` +
              `Час: ${fmtDateTime(p.publish_at)}\n` +
              `🔗 <a href="${HQ_URL}#publication/${p.id}">Відкрити в HQ</a>`);
            pinged++;
          }
          await recordReminder(supabase, p.id, "crea2d", `${recipients.length} responsibles pinged`);
        }
      }
    }
  }

  // ====================================================================
  // G3: review > 24 годин — re-ping approver
  // ====================================================================
  {
    const { data: pubs } = await supabase
      .from("publications")
      .select("id, title, status, publish_at, updated_at, created_at")
      .eq("status", "review")
      .lt("updated_at", ago24hIso)
      .is("deleted_at", null);
    for (const p of (pubs ?? []) as Pub[]) {
      if (await checkReminderSent(supabase, p.id, "rev24h", 24)) continue;
      const recipients = await getRecipients(supabase, p.id, "approvers");
      for (const u of recipients) {
        await tgSend(u.tg_chat_id!,
          `⏳ <b>Чекає твого погодження >24 год</b>: «${escHtml(p.title)}»\n` +
          `Публікація: ${fmtDateTime(p.publish_at)}\n` +
          `🔗 <a href="${HQ_URL}#publication/${p.id}">Відкрити в HQ</a>`);
        pinged++;
      }
      await recordReminder(supabase, p.id, "rev24h", `${recipients.length} approvers pinged`);
    }
  }

  // ====================================================================
  // G4: дата минула + draft/in_work/review/rework → CEO/COO ескалація
  // #142: ВИКЛЮЧЕНО approved — для approved використовуй G4a
  // ====================================================================
  {
    const { data: pubs } = await supabase
      .from("publications")
      .select("id, title, status, publish_at, updated_at, created_at")
      .lt("publish_at", nowIso)
      .gt("publish_at", new Date(Date.now() - 6 * 3600000).toISOString())
      .not("status", "in", "(published,approved)")
      .is("deleted_at", null);
    for (const p of (pubs ?? []) as Pub[]) {
      if (await checkReminderSent(supabase, p.id, "missed", 6)) continue;
      const founders = await getFounders(supabase);
      for (const u of founders) {
        await tgSend(u.tg_chat_id!,
          `⚠️ <b>УВАГА: пропущена публікація</b>\n` +
          `«${escHtml(p.title)}» (${p.status}) мала вийти ${fmtDateTime(p.publish_at)}\n` +
          `🔗 <a href="${HQ_URL}#publication/${p.id}">Відкрити в HQ</a>`);
        pinged++;
      }
      await recordReminder(supabase, p.id, "missed", `${founders.length} founders pinged`);
    }
  }

  // ====================================================================
  // #142 G4a: approved + час публікації минув → м'яке нагадування RESPONSIBLES
  // Anti-spam 24h (1×/добу максимум, не спамити CEO)
  // ====================================================================
  {
    const { data: pubs } = await supabase
      .from("publications")
      .select("id, title, status, publish_at, updated_at, created_at")
      .lt("publish_at", nowIso)
      .gt("publish_at", new Date(Date.now() - 48 * 3600000).toISOString())
      .eq("status", "approved")
      .is("deleted_at", null);
    for (const p of (pubs ?? []) as Pub[]) {
      if (await checkReminderSent(supabase, p.id, "approved-missed", 24)) continue;
      const recipients = await getRecipients(supabase, p.id, "responsibles");
      for (const u of recipients) {
        await tgSend(u.tg_chat_id!,
          `📤 <b>Готовий пост — час публікувати!</b>\n` +
          `«${escHtml(p.title)}» — approved, мала вийти ${fmtDateTime(p.publish_at)}.\n` +
          `Опублікуй у соцмережі та постав статус «Опубліковано» у HQ.\n\n` +
          `🔗 <a href="${HQ_URL}#publication/${p.id}">Відкрити в HQ</a>`);
        pinged++;
      }
      await recordReminder(supabase, p.id, "approved-missed", `${recipients.length} responsibles pinged (G4a)`);
    }
  }

  // ====================================================================
  // G5b: review > 48 годин → ескалація іншому founder
  // ====================================================================
  {
    const { data: pubs } = await supabase
      .from("publications")
      .select("id, title, status, publish_at, updated_at, created_at")
      .eq("status", "review")
      .lt("created_at", ago48hIso)
      .is("deleted_at", null);
    for (const p of (pubs ?? []) as Pub[]) {
      if (await checkReminderSent(supabase, p.id, "esc48h", 48)) continue;
      const founders = await getFounders(supabase);
      const { data: approvers } = await supabase.from("publication_approvers").select("user_id").eq("publication_id", p.id);
      const approverIds = new Set((approvers ?? []).map(r => r.user_id));
      const escalateTo = founders.filter(u => !approverIds.has(u.id));
      for (const u of escalateTo) {
        await tgSend(u.tg_chat_id!,
          `🔥 <b>Ескалація 48+ год</b>: «${escHtml(p.title)}» висить на погодженні.\n` +
          `Публікація: ${fmtDateTime(p.publish_at)}\n` +
          `🔗 <a href="${HQ_URL}#publication/${p.id}">Відкрити в HQ</a>`);
        pinged++;
      }
      await recordReminder(supabase, p.id, "esc48h", `${escalateTo.length} co-founders pinged`);
    }
  }

  // ====================================================================
  // #125 G6: T-10хв — за 10 хв до публікації
  // #142: виключено approved (approved уже готовий, не треба нагадувати)
  // ====================================================================
  {
    const { data: pubs } = await supabase
      .from("publications")
      .select("id, title, status, publish_at, updated_at, created_at")
      .gte("publish_at", tMinus15)
      .lte("publish_at", tMinus5)
      .not("status", "in", "(published,approved)")
      .is("deleted_at", null);
    for (const p of (pubs ?? []) as Pub[]) {
      if (await checkReminderSent(supabase, p.id, "t-10", 1)) continue;
      const recipients = await getRecipients(supabase, p.id, "responsibles");
      const finalList = recipients.length > 0 ? recipients : await getFounders(supabase);
      for (const u of finalList) {
        await tgSend(u.tg_chat_id!,
          `🟡 <b>Через 10 хв публікація</b> — «${escHtml(p.title)}»\n` +
          `📅 ${fmtDateTime(p.publish_at)}\n` +
          `📊 Поточний статус: <b>${p.status}</b>\n` +
          `⚠️ Ще не approved!\n\n` +
          `🔗 <a href="${HQ_URL}#publication/${p.id}">Відкрити в HQ</a>`);
        pinged++;
      }
      await recordReminder(supabase, p.id, "t-10", `${finalList.length} pinged at T-10`);
    }
  }

  // ====================================================================
  // #125 G7: T+10хв — після часу публікації, якщо ще не published
  // #142: anti-spam 1h → 24h (не спамити кожну годину)
  // ====================================================================
  {
    const { data: pubs } = await supabase
      .from("publications")
      .select("id, title, status, publish_at, updated_at, created_at")
      .gte("publish_at", tPlus15)
      .lte("publish_at", tPlus5)
      .not("status", "in", "(published)")
      .is("deleted_at", null);
    for (const p of (pubs ?? []) as Pub[]) {
      if (await checkReminderSent(supabase, p.id, "t+10", 24)) continue;  // #142: 1→24h
      const recipients = await getRecipients(supabase, p.id, "responsibles");
      const founders = await getFounders(supabase);
      const seen = new Set<string>();
      const allRecipients = [...recipients, ...founders].filter(u => {
        if (seen.has(u.id)) return false;
        seen.add(u.id);
        return true;
      });
      for (const u of allRecipients) {
        await tgSend(u.tg_chat_id!,
          `🔴 <b>+10 хв ПОСЛЕ ЧАСУ — НЕ ОПУБЛІКОВАНО!</b>\n` +
          `«${escHtml(p.title)}»\n` +
          `📅 Мало вийти: ${fmtDateTime(p.publish_at)}\n` +
          `📊 Поточний статус: <b>${p.status}</b>\n\n` +
          `🚨 Терміново перевір і опублікуй або переплануй!\n` +
          `🔗 <a href="${HQ_URL}#publication/${p.id}">Відкрити в HQ</a>`);
        pinged++;
      }
      await recordReminder(supabase, p.id, "t+10", `${allRecipients.length} escalated at T+10`);
    }
  }

  return pinged;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST" && req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  if (CRON_SECRET) {
    const got = req.headers.get("x-hq-cron-secret");
    const urlSec = new URL(req.url).searchParams.get("secret");
    if (got !== CRON_SECRET && urlSec !== CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response("Missing config", { status: 500 });
  if (!TG_BOT_TOKEN) return new Response("TG_BOT_TOKEN missing", { status: 500 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const pinged = await run(supabase);
    return new Response(JSON.stringify({ ok: true, pinged, version: "v3-#142" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("cron-reminders error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
