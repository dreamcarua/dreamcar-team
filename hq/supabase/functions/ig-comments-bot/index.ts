// ig-comments-bot v5 — граціозна обробка видалених коментарів (status='gone') + гілка av: для апруву чернеток «Автосвіт».
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_CRON_SECRET = Deno.env.get("HQ_CRON_SECRET") ?? "";
const FN_URL = "https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/ig-comments-bot";
const AV_API = "https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/autosvit-api";

let APPROVER = "", WEBHOOK_SECRET = "", FB = "", CHAT = "-5570598391";
async function loadSecrets(sb: any) {
  const { data } = await sb.from("app_secrets").select("key,value").in("key", ["smm_approver_bot_token", "smm_approver_webhook_secret", "fb_access_token"]);
  for (const r of (data ?? [])) { if (r.key === "smm_approver_bot_token") APPROVER = r.value; else if (r.key === "smm_approver_webhook_secret") WEBHOOK_SECRET = r.value; else if (r.key === "fb_access_token") FB = r.value; }
  const { data: cs } = await sb.from("dashboard_settings").select("value").eq("key", "ig_comments_chat").maybeSingle();
  if (cs?.value) CHAT = String(cs.value).replace(/\"/g, "");
}
function esc(s: string) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function json(o: any, code = 200) { return new Response(JSON.stringify(o), { status: code, headers: { "content-type": "application/json" } }); }

const BANNED_SUB = /(шанс|лотере|розігра|вигра|перемож|квиток|білет|джекпот|казино|азарт|ставк|халяв|гарантован|giveaway|raffle|lottery|jackpot)/i;
const BANNED_WORDS = new Set(["гра","грі","гру","гри","грою","грах","ігри","ігор","ігрові","ігровий","приз","призи","призів","призом","призами","програв","програла","програли","програш"]);
function isBanned(s: string): boolean { if (!s) return false; if (BANNED_SUB.test(s)) return true; for (const w of s.toLowerCase().split(/[^\p{L}]+/u)) { if (BANNED_WORDS.has(w)) return true; } return false; }
function isGone(err: any): boolean { if (!err) return false; if (err.code === 100 || err.code === 10 || err.code === 803) return true; return /does not exist|cannot be found|deleted|unsupported|no longer/i.test(String(err.message || "")); }

async function tg(method: string, body: any) { const r = await fetch(`https://api.telegram.org/bot${APPROVER}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return await r.json().catch(() => ({})); }
async function fbPostForm(path: string, params: Record<string,string>) { const body = new URLSearchParams({ ...params, access_token: FB }); const r = await fetch(`https://graph.facebook.com/v21.0/${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }); return { status: r.status, body: await r.json().catch(() => ({})) }; }

function cardText(row: any, extra: string) { return [`💬 <b>Коментар</b>`, `👤 <b>@${esc(row.author)}</b>: «${esc(row.comment_text)}»`, row.permalink ? `🔗 <a href="${row.permalink}">пост</a>` : "", "", extra].filter(Boolean).join("\n"); }
function buttons(cid: string) { return { inline_keyboard: [[{ text: "✅ Запостити", callback_data: `p|${cid}` }, { text: "✏️ Змінити", callback_data: `e|${cid}` }], [{ text: "❌ Пропустити", callback_data: `s|${cid}` }, { text: "🚫 Приховати", callback_data: `h|${cid}` }]] }; }

Deno.serve(async (req: Request) => {
  const u = new URL(req.url);
  const sb = createClient(SB_URL, SRK, { auth: { persistSession: false } });
  await loadSecrets(sb);

  if (u.searchParams.get("setup") === "1") {
    if (HQ_CRON_SECRET && (req.headers.get("x-hq-cron-secret") || u.searchParams.get("secret")) !== HQ_CRON_SECRET) return json({ error: "unauthorized" }, 401);
    const me = await tg("getMe", {});
    const wh = await tg("setWebhook", { url: FN_URL, secret_token: WEBHOOK_SECRET, allowed_updates: ["callback_query", "message"], drop_pending_updates: true });
    return json({ me, wh, chat: CHAT });
  }

  if (req.method === "POST") {
    if (WEBHOOK_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
    let upd: any = {}; try { upd = await req.json(); } catch (_) {}

    if (upd.callback_query) {
      const cq = upd.callback_query;

      // ===== гілка «Автосвіт»: callback_data = av:a|<id> / av:r|<id> / av:k|<id> =====
      if (String(cq.data || "").startsWith("av:")) {
        const [cmd, ideaId] = String(cq.data).slice(3).split("|");
        const actionMap: Record<string, string> = { a: "approve", r: "rework", k: "kill" };
        const action = actionMap[cmd];
        if (!action || !ideaId) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "?" }); return json({ ok: true }); }
        const actor = [cq.from?.first_name, cq.from?.last_name].filter(Boolean).join(" ") || cq.from?.username || "TG";
        let resText = "";
        try {
          const r = await fetch(AV_API, {
            method: "POST", headers: { "content-type": "application/json", "x-hq-cron-secret": HQ_CRON_SECRET },
            body: JSON.stringify({ action, id: ideaId, actor, note: action === "rework" ? "з TG" : undefined }),
          });
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.ok) {
            if (action === "approve") {
              const when = j.publish_at ? new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(j.publish_at)) : "";
              resText = `✅ Затвердив ${esc(actor)}${when ? ` · вихід ${when}` : ""}${j.platforms ? ` · ${j.platforms.join(", ")}` : ""}`;
            } else resText = action === "rework" ? `↩️ На переписування (${esc(actor)})` : `🗑 У стоп (${esc(actor)})`;
          } else resText = "❌ " + esc(String(j.error || ("HTTP " + r.status)).slice(0, 140));
        } catch (e) { resText = "❌ " + esc(String(e).slice(0, 100)); }
        const chatId = cq.message?.chat?.id, msgId = cq.message?.message_id;
        if (chatId && msgId) {
          const orig = String(cq.message.text || "").split("\n").slice(0, 4).join("\n");
          await tg("editMessageText", { chat_id: chatId, message_id: msgId, parse_mode: "HTML", disable_web_page_preview: true, text: `${esc(orig)}\n\n${resText}` });
        }
        await tg("answerCallbackQuery", { callback_query_id: cq.id, text: resText.replace(/<[^>]+>/g, "").slice(0, 190) });
        return json({ ok: true });
      }
      // ===== кінець гілки «Автосвіт» =====

      const [act, cid] = String(cq.data || "").split("|");
      const { data: row } = await sb.from("ig_comment_queue").select("*").eq("comment_id", cid).maybeSingle();
      if (!row) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Не знайдено" }); return json({ ok: true }); }
      if (row.status !== "awaiting") { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: `Вже: ${row.status}` }); await tg("editMessageReplyMarkup", { chat_id: CHAT, message_id: row.tg_message_id, reply_markup: { inline_keyboard: [] } }); return json({ ok: true }); }
      const nowIso = new Date().toISOString();

      if (act === "p") {
        const reply = (row.draft_reply || "").trim();
        if (!reply) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Порожня чернетка — ✏️ Змінити", show_alert: true }); return json({ ok: true }); }
        if (isBanned(reply)) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Заборонене слово — ✏️ Змінити", show_alert: true }); return json({ ok: true }); }
        const res = await fbPostForm(`${cid}/replies`, { message: reply });
        if (res.body?.id) {
          await sb.from("ig_comment_queue").update({ status: "posted", posted_reply_id: res.body.id, decided_via: "tg", decided_at: nowIso, updated_at: nowIso }).eq("comment_id", cid);
          await tg("editMessageText", { chat_id: CHAT, message_id: row.tg_message_id, parse_mode: "HTML", disable_web_page_preview: true, text: cardText(row, `✅ <b>Опубліковано:</b> «${esc(reply)}»`) });
          await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Опубліковано ✅" });
        } else if (isGone(res.body?.error)) {
          await sb.from("ig_comment_queue").update({ status: "gone", error: String(res.body?.error?.message || "").slice(0, 200), decided_via: "tg", decided_at: nowIso, updated_at: nowIso }).eq("comment_id", cid);
          await tg("editMessageText", { chat_id: CHAT, message_id: row.tg_message_id, parse_mode: "HTML", disable_web_page_preview: true, text: cardText(row, "🗑 <b>Коментар уже видалено на IG</b> — відповісти неможливо.") });
          await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Коментар видалено 🗑" });
        } else {
          await sb.from("ig_comment_queue").update({ error: JSON.stringify(res.body).slice(0, 300) }).eq("comment_id", cid);
          await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Помилка IG: " + String(res.body?.error?.message || "").slice(0, 120), show_alert: true });
        }
        return json({ ok: true });
      }
      if (act === "s") { await sb.from("ig_comment_queue").update({ status: "skipped", decided_via: "tg", decided_at: nowIso, updated_at: nowIso }).eq("comment_id", cid); await tg("editMessageText", { chat_id: CHAT, message_id: row.tg_message_id, parse_mode: "HTML", disable_web_page_preview: true, text: cardText(row, "❌ <b>Пропущено</b>") }); await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Пропущено" }); return json({ ok: true }); }
      if (act === "h") { const res = await fbPostForm(`${cid}`, { hide: "true" }); const okh = res.status === 200 && !res.body?.error; const gone = !okh && isGone(res.body?.error); await sb.from("ig_comment_queue").update({ status: okh ? "hidden" : (gone ? "gone" : "failed"), error: okh ? null : String(res.body?.error?.message || "").slice(0, 300), decided_via: "tg", decided_at: nowIso, updated_at: nowIso }).eq("comment_id", cid); await tg("editMessageText", { chat_id: CHAT, message_id: row.tg_message_id, parse_mode: "HTML", disable_web_page_preview: true, text: cardText(row, okh ? "🚫 <b>Приховано</b>" : (gone ? "🗑 <b>Коментар уже видалено</b>" : "❌ Помилка")) }); await tg("answerCallbackQuery", { callback_query_id: cq.id, text: okh ? "Приховано" : (gone ? "Видалено" : "Помилка") }); return json({ ok: true }); }
      if (act === "e") { const pr = await tg("sendMessage", { chat_id: CHAT, parse_mode: "HTML", reply_markup: { force_reply: true, input_field_placeholder: "Новий текст відповіді" }, text: `✏️ Надішли новий текст відповіді для @${esc(row.author)} <i>(reply на це повідомлення)</i>` }); const pid = pr?.result?.message_id; if (pid) await sb.from("ig_comment_queue").update({ edit_prompt_msg_id: pid, updated_at: nowIso }).eq("comment_id", cid); await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Надішли новий текст ↩️" }); return json({ ok: true }); }
      await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "?" }); return json({ ok: true });
    }

    if (upd.message && upd.message.reply_to_message && upd.message.text) {
      const rt = upd.message.reply_to_message.message_id;
      const { data: row } = await sb.from("ig_comment_queue").select("*").eq("edit_prompt_msg_id", rt).eq("status", "awaiting").maybeSingle();
      if (row) {
        const newtext = String(upd.message.text).trim();
        if (isBanned(newtext)) { await tg("sendMessage", { chat_id: CHAT, reply_to_message_id: upd.message.message_id, text: "⛔ Містить заборонене слово. Спробуй інакше." }); return json({ ok: true }); }
        await sb.from("ig_comment_queue").update({ draft_reply: newtext, edit_prompt_msg_id: null, updated_at: new Date().toISOString() }).eq("comment_id", row.comment_id);
        await tg("editMessageText", { chat_id: CHAT, message_id: row.tg_message_id, parse_mode: "HTML", disable_web_page_preview: true, text: cardText(row, `✍️ <b>Чернетка (відредаговано):</b> «${esc(newtext)}»`), reply_markup: buttons(row.comment_id) });
        await tg("sendMessage", { chat_id: CHAT, reply_to_message_id: upd.message.message_id, text: "Оновлено ✅ Тепер тисни ✅ Запостити на картці." }); 
      }
      return json({ ok: true });
    }
    return json({ ok: true });
  }
  return json({ ok: true });
});
