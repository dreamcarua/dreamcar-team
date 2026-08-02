// =====================================================================
// DreamCar HQ — Notes notify (tech-request #3, 02.08.2026)
//
// Викликається DB-тригерами (public.hq_notes_notify) через pg_net:
//   { note_id, event: 'note_created' | 'vote', actor_id }
//
//  • note_created → DM трьом голосувальникам (ceo/cfo/coo): «є нова ідея»
//  • vote         → DM автору ідеї: хто і як проголосував + поточний рахунок
//
// Авторизація: x-hq-secret (HQ_WEBHOOK_SECRET), як у notify-tg.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN      = Deno.env.get("TG_BOT_TOKEN") ?? "";
const HQ_WEBHOOK_SECRET = Deno.env.get("HQ_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const HQ_NOTES_URL = "https://team.dreamcar.ua/hq/#notes";
const VOTER_ROLES = ["ceo", "cfo", "coo"];

// TG parse_mode=HTML — < > & у тексті валять весь запит (див. cowork-notify граблі)
function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clip(s: string, n: number): string {
  const t = (s || "").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

async function tgSend(chatId: number | string, text: string) {
  if (!TG_BOT_TOKEN) { console.error("TG_BOT_TOKEN missing"); return false; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) { console.error(`TG ${r.status}: ${await r.text()}`); return false; }
    return true;
  } catch (e) { console.error("tgSend threw", e); return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok");

  if (HQ_WEBHOOK_SECRET && req.headers.get("x-hq-secret") !== HQ_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { note_id?: string; event?: string; actor_id?: string };
  try { body = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const { note_id, event, actor_id } = body;
  if (!note_id || !event) return new Response("note_id/event required", { status: 400 });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: note, error: noteErr } = await sb
    .from("hq_notes")
    .select("id,title,details,author_id,status,created_at")
    .eq("id", note_id)
    .maybeSingle();
  if (noteErr || !note) {
    console.error("note not found", note_id, noteErr);
    return new Response(JSON.stringify({ ok: false, reason: "note_not_found" }), { status: 200 });
  }

  const { data: users } = await sb
    .from("users")
    .select("id,name,role,tg_chat_id,is_active");
  const byId = new Map((users || []).map((u) => [u.id, u]));
  const voters = (users || []).filter((u) => VOTER_ROLES.includes(String(u.role)) && u.is_active !== false);

  const title = esc(clip(note.title, 160));
  const authorName = esc(byId.get(note.author_id)?.name || "—");
  let sent = 0;

  if (event === "note_created") {
    // Нова ідея → пінг тим, хто має голосувати (крім самого автора)
    const text =
      `💡 <b>Нова ідея у Нотатках</b>\n\n` +
      `«${title}»\n` +
      (note.details ? `\n${esc(clip(note.details, 400))}\n` : "") +
      `\nАвтор: <b>${authorName}</b>\n` +
      `Потрібне твоє рішення: Апрув або Відхилено.\n\n` +
      `<a href="${HQ_NOTES_URL}">Відкрити Нотатки</a>`;

    for (const v of voters) {
      if (!v.tg_chat_id) continue;
      if (v.id === actor_id) continue;
      if (await tgSend(v.tg_chat_id, text)) sent++;
    }
  } else if (event === "vote") {
    // Голос → DM автору ідеї
    const { data: votes } = await sb
      .from("hq_note_votes")
      .select("voter_id,vote,comment")
      .eq("note_id", note_id);

    const actor = actor_id ? byId.get(actor_id) : null;
    const actorVote = (votes || []).find((v) => v.voter_id === actor_id);
    const mark = actorVote?.vote === "approve" ? "✅ Апрув" : "❌ Відхилено";

    const tally = voters.map((v) => {
      const mine = (votes || []).find((x) => x.voter_id === v.id);
      const ico = !mine ? "⏳" : mine.vote === "approve" ? "✅" : "❌";
      return `${ico} ${esc(v.name)}`;
    }).join("\n");

    const statusLine =
      note.status === "approved" ? "\n\n🎉 <b>Ідея схвалена — усі три голоси «за».</b>"
      : note.status === "rejected" ? "\n\n🚫 <b>Ідею відхилено.</b>"
      : "";

    const comment = actorVote?.comment ? `\n<i>${esc(clip(actorVote.comment, 300))}</i>\n` : "";

    const text =
      `🗳 <b>${esc(actor?.name || "Хтось")}: ${mark}</b>\n\n` +
      `Ідея: «${title}»\n` + comment +
      `\n${tally}` + statusLine + `\n\n` +
      `<a href="${HQ_NOTES_URL}">Відкрити Нотатки</a>`;

    const author = byId.get(note.author_id);
    // автору не пишемо про його ж власний голос
    if (author?.tg_chat_id && author.id !== actor_id) {
      if (await tgSend(author.tg_chat_id, text)) sent++;
    }
  }

  return new Response(JSON.stringify({ ok: true, event, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
