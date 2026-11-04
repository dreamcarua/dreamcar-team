// =====================================================================
// creative-request (30.10.2026) — «віддалений відділ креативів» DreamCar.
//
// Канал 1 — tg-webhook (x-hq-cron-secret):
//   POST { message } — повідомлення з чату DreamCar Media, де згадано бота,
//                      або reply на повідомлення бота (відповідь на питання / «❌»).
// Канал 2 — воркер на Mac Studio (x-cd-worker: токен; sha256 = app_secrets.cd_worker_secret_sha256):
//   POST { action: "claim", worker }                  → наступна задача (по одній) або null
//   POST { action: "sources", id }                    → вихідні файли задачі (URL медіатеки)
//   POST { action: "ask", id, question }              → питання автору в треді, статус need_info
//   POST { action: "progress", id, text }             → коротке повідомлення про хід роботи
//   POST { action: "complete", id, creative_ids, note }→ результати автору в тред, статус done
//   POST { action: "fail", id, error }                → статус failed, повідомлення автору
//   POST { action: "quote", id, quote }               → платна задача: ціна з кнопками погодження, статус need_price_ok
// Канал 1, кнопки — tg-webhook пересилає callback_query з даними cdq:<id>:y|n (x-hq-cron-secret):
//   POST { callback } → приймається лише від app_secrets.cd_price_approver_tg_ids; y → queued + price_ok, n → cancelled
// Генерація і всі перевірки — на Mac Studio через creative-director; тут лише черга і Telegram.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TG_BOT_TOKEN   = Deno.env.get("TG_BOT_TOKEN") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_CRON_SECRET = Deno.env.get("HQ_CRON_SECRET") ?? "";
const MEDIA_CHAT_ID  = Number(Deno.env.get("DCMEDIA_GROUP_CHAT_ID") || "-1003912295530");
const BOT_MENTION    = "@dreamcar_team_bot";
const CANCEL_RE = /^(❌|✖️|скасувати|скасуй|отмена|отменить|cancel)(?=$|[\s!.,])/u;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function esc(s: string): string { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
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
// 04.11.2026: запит може прийти з будь-якого робочого чату (через owner-dm) — відповідаємо туди, звідки він.
const chatOf = (r: any) => Number(r?.chat_id) || MEDIA_CHAT_ID;
const sayR = (r: any, text: string) => say(r.message_id, text, chatOf(r));
const say = (reply_to: number, text: string, chat: number = MEDIA_CHAT_ID) =>
  tg("sendMessage", { chat_id: chat, reply_to_message_id: reply_to, allow_sending_without_reply: true,
    text, parse_mode: "HTML", disable_web_page_preview: true });

function mentionsBot(m: any): boolean {
  const t = `${m.text || ""} ${m.caption || ""}`.toLowerCase();
  return t.includes(BOT_MENTION);
}
function cleanText(m: any): string {
  return String(m.text || m.caption || "").replace(new RegExp(BOT_MENTION, "ig"), "").trim();
}

// ----------------------------- з Telegram -----------------------------
async function onMessage(sb: any, m: any) {
  if (m.from?.is_bot) return { skipped: true };
  const chat = Number(m?.chat?.id);
  const inMedia = chat === MEDIA_CHAT_ID;
  const replyTo = m.reply_to_message;
  if (!inMedia && !replyTo?.from?.is_bot) return { skipped: "not media chat" };

  // 1) reply на повідомлення бота: відповідь на питання або «❌»
  if (replyTo?.from?.is_bot) {
    const rid = replyTo.message_id;
    const { data: qs } = await sb.from("creative_requests").select("*")
      .eq("chat_id", chat).or(`question_msg_id.eq.${rid},ack_msg_id.eq.${rid},result_msg_ids.cs.{${rid}}`)
      .order("id", { ascending: false }).limit(1);
    const q = qs?.[0];
    if (q) {
      const txt = cleanText(m);
      if (CANCEL_RE.test(txt.toLowerCase())) {
        if (["queued", "need_info", "need_price_ok"].includes(q.status)) {
          await sb.from("creative_requests").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", q.id);
          await say(m.message_id, `↩️ Запит №${q.id} скасовано.`, chat);
        } else if (q.status === "working") {
          await say(m.message_id, `⏳ Запит №${q.id} уже в роботі, скасувати не можу. Результат можна просто не використовувати.`, chat);
        }
        return { cancelled: q.id };
      }
      // reply з текстом на результат (або на «прийнято» вже виконаного запиту) = доопрацювання, без @згадки
      if (txt && q.status === "done" && !mentionsBot(m)) {
        return await enqueue(sb, m, txt, { parent: q, sources: q.result_creative_ids || [] });
      }
      // 04.11.2026: питання під час роботи («довго ще?») — відповісти статусом, а не мовчати
      if (txt && ["queued", "working"].includes(q.status) && !mentionsBot(m)) {
        const mins = q.claimed_at ? Math.max(1, Math.round((Date.now() - new Date(q.claimed_at).getTime()) / 60000)) : 0;
        let ahead = 0;
        if (q.status === "queued") {
          const { count } = await sb.from("creative_requests").select("id", { count: "exact", head: true }).in("status", ["queued", "working"]).lt("id", q.id);
          ahead = count || 0;
        }
        await say(m.message_id, q.status === "working"
          ? `⏳ Запит №${q.id} у роботі вже ${mins} хв: генерація і перевірка критиком. Зазвичай це 5–30 хв, складні обробки довше. Результат надішлю сюди, щойно буде готовий.`
          : `🕐 Запит №${q.id} у черзі${ahead ? `, перед ним: ${ahead}` : ", наступний"}. Візьму, щойно звільниться відділ.`, chat);
        return { status_reply: q.id };
      }
      if (q.status === "need_info" && q.question_msg_id === rid && txt) {
        const answers = [...(q.answers || []), { at: new Date().toISOString(), from: m.from?.id, text: txt.slice(0, 4000), message_id: m.message_id }];
        await sb.from("creative_requests").update({ answers, status: "queued", updated_at: new Date().toISOString() }).eq("id", q.id);
        await say(m.message_id, `👌 Дякую, продовжую запит №${q.id}.`, chat);
        return { answered: q.id };
      }
      return { ignored: "reply" };
    }
  }

  // 2) новий запит: згадка бота (лише в чаті Media; з інших чатів нові запити приходять через owner-dm → enqueue)
  if (!inMedia) return { skipped: "not media chat" };
  if (!mentionsBot(m)) return { skipped: "no mention" };
  const text = cleanText(m);
  // «@бот в медіа» / «збережи» — це збереження файлу (media-intake), не запит на креатив
  if (/^((в|у|до)\s+)?(медіа|медиа|медіатеку|медиатеку|media)(?=$|[\s!.,])|^(збережи|сохрани|save)(?=$|[\s!.,])/u.test(text.toLowerCase())) return { skipped: "save-command" };
  const hasFiles = !!(m.photo || m.video || m.document || m.animation || replyTo?.photo || replyTo?.video || replyTo?.document);
  if (!text) {
    await say(m.message_id, `🎨 Напиши, що зробити, і додай файли (або відповідай на повідомлення з файлами). Наприклад: «${BOT_MENTION} зроби 3 рекламні креативи з цих фото, акцент на старт проєкту».`);
    return { skipped: "empty" };
  }
  // reply-згадка на чуже повідомлення з файлами = НОВИЙ запит на тих самих файлах (30.10.2026: колега
  // відповіла на запит №1 своїм завданням, а бот відписав «це вже запит №1» — так не можна).
  const ctx = String(replyTo?.text || replyTo?.caption || "").replace(new RegExp(BOT_MENTION, "ig"), "").trim();
  const full = ctx && !replyTo?.from?.is_bot ? `${text}\n\nКонтекст (повідомлення, на яке відповідь): ${ctx}` : text;
  return await enqueue(sb, m, full, { hasFiles });
}

async function enqueue(sb: any, m: any, text: string, o: { parent?: any; sources?: string[]; hasFiles?: boolean }) {
  const replyTo = m.reply_to_message;
  const fromName = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || "?";
  const { data: u } = await sb.from("users").select("id").eq("tg_chat_id", m.from?.id ?? 0).maybeSingle();
  const launch = o.parent?.launch_id || (await sb.rpc("library_guess_launch", { p_at: new Date().toISOString() })).data;
  const reqText = o.parent ? `Доопрацювання результату запиту №${o.parent.id} (його фінали додано як вихідні файли): ${text}` : text;

  const { data: row, error } = await sb.from("creative_requests").insert({
    chat_id: Number(m.chat.id), message_id: m.message_id, reply_to_message_id: replyTo?.message_id || null,
    media_group_id: m.media_group_id || (o.parent ? null : replyTo?.media_group_id) || null,
    from_tg_id: m.from?.id || null, from_name: fromName, user_id: u?.id || null,
    request_text: reqText.slice(0, 8000), launch_id: launch || null,
    parent_request_id: o.parent?.id || null, source_creative_ids: o.sources || [],
  }).select("id").single();
  if (error) {
    if (/duplicate/i.test(error.message)) return { skipped: "dup" };
    throw new Error(error.message);
  }
  const { count } = await sb.from("creative_requests").select("id", { count: "exact", head: true })
    .in("status", ["queued", "working"]).lt("id", row.id);
  const ahead = count || 0;
  const hasFiles = o.hasFiles || !!(o.sources && o.sources.length) || !!(m.photo || m.video || m.document);
  const res = await say(m.message_id,
    `🎨 Запит №${row.id} прийнято${o.parent ? ` (доопрацювання №${o.parent.id})` : ""}: зроблю і поверну результат сюди, у тред.` +
    `${hasFiles ? "" : " Файлів не бачу: працюватиму з матеріалами проєкту в медіатеці."}\n` +
    (ahead ? `У черзі перед ним: ${ahead}.` : `Беру першим.`) +
    `\n<i>Скасувати: відповідай на це повідомлення «❌»</i>`, Number(m.chat.id));
  await sb.from("creative_requests").update({ ack_msg_id: res?.result?.message_id ?? null }).eq("id", row.id);
  return { queued: row.id };
}

// ----------------------------- ціна платних задач -----------------------------
async function approvers(sb: any): Promise<number[]> {
  const { data } = await sb.from("app_secrets").select("value").eq("key", "cd_price_approver_tg_ids").maybeSingle();
  return String(data?.value || "").split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
}
function quoteText(r: any, q: any): string {
  const items = Array.isArray(q.items) ? q.items.slice(0, 12).map((i: any) => `• ${esc(String(i)).slice(0, 200)}`).join("\n") : "";
  return `💰 Запит №${r.id} (${esc(r.from_name || "")}): потрібна платна генерація.\n` +
    (q.details ? `${esc(String(q.details)).slice(0, 1200)}\n` : "") + (items ? `${items}\n` : "") +
    `<b>Ціна: ${esc(String(q.price_text || "?")).slice(0, 200)}</b>` + (q.engine ? ` · ${esc(String(q.engine)).slice(0, 80)}` : "") +
    `\n<i>Підтверджує лише власник. Без підтвердження нічого не списується.</i>`;
}
const quoteKb = (id: number) => ({ inline_keyboard: [[
  { text: "✅ Підтвердити", callback_data: `cdq:${id}:y` }, { text: "✖ Відхилити", callback_data: `cdq:${id}:n` }]] });

async function postQuote(sb: any, r: any, q: any) {
  const text = quoteText(r, q);
  const msgs: { chat: number; msg: number }[] = [];
  const t = await tg("sendMessage", { chat_id: chatOf(r), reply_to_message_id: r.message_id, allow_sending_without_reply: true,
    text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: quoteKb(r.id) });
  if (t?.result?.message_id) msgs.push({ chat: chatOf(r), msg: t.result.message_id });
  // власнику ще й у DM: у загальному чаті кнопку легко пропустити
  const req = esc(String(r.request_text || "")).slice(0, 600);
  for (const a of await approvers(sb)) {
    const d = await tg("sendMessage", { chat_id: a, text: `${text}\n\nЗапит: ${req}`, parse_mode: "HTML",
      disable_web_page_preview: true, reply_markup: quoteKb(r.id) });
    if (d?.result?.message_id) msgs.push({ chat: a, msg: d.result.message_id });
  }
  return msgs;
}

async function onCallback(sb: any, cb: any) {
  const answer = (text: string, alert = false) => tg("answerCallbackQuery", { callback_query_id: cb.id, text, show_alert: alert });
  const data = String(cb.data || "").replace(/\uFE0F/g, "").trim();  // traps: U+FE0F у callback_data
  const m = data.match(/^cdq:(\d+):([yn])$/);
  if (!m) { await answer("Невідома кнопка"); return { ignored: "callback" }; }
  const id = Number(m[1]); const yes = m[2] === "y";
  if (!(await approvers(sb)).includes(Number(cb.from?.id))) {
    await answer("Ціну підтверджує лише власник.", true); return { denied: id };
  }
  const { data: r } = await sb.from("creative_requests").select("*").eq("id", id).maybeSingle();
  if (!r) { await answer("Запит не знайдено", true); return { error: "not found" }; }
  if (r.status !== "need_price_ok") { await answer(`Уже вирішено: ${r.status}`, true); return { stale: id }; }
  const who = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(" ") || cb.from?.username || "власник";
  const now = new Date().toISOString();
  // атомарно: лише якщо все ще чекає (дві кнопки, два чати)
  const upd = yes
    ? { status: "queued", price_ok: { by_tg_id: cb.from?.id, by_name: who, at: now, quote: r.quote }, updated_at: now }
    : { status: "cancelled", error: `ціну відхилив ${who}`, finished_at: now, updated_at: now };
  const { data: done } = await sb.from("creative_requests").update(upd).eq("id", id).eq("status", "need_price_ok").select("id");
  if (!done?.length) { await answer("Уже вирішено", true); return { stale: id }; }
  const verdict = yes ? `✅ Ціну підтвердив ${esc(who)}. Запускаю.` : `✖ Ціну відхилив ${esc(who)}. Запит скасовано.`;
  for (const x of (r.quote_msgs || [])) {
    await tg("editMessageText", { chat_id: x.chat, message_id: x.msg, text: `${quoteText(r, r.quote || {})}\n\n${verdict}`,
      parse_mode: "HTML", disable_web_page_preview: true });
  }
  await answer(yes ? "Підтверджено" : "Відхилено");
  return { decided: id, yes };
}

// ----------------------------- воркер -----------------------------
// Факти проєкту для сесії на Mac Studio: щоб не питати в людей те, що є в базі.
async function projectContext(sb: any, r: any) {
  const kyiv = (iso: string | null) => iso ? new Date(iso).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const { data: ls } = await sb.from("launches").select("id,name,code,cycle_no,kind,status,starts_at,stop_at,live_at,packages")
    .eq("is_active", true).order("starts_at", { ascending: false, nullsFirst: false }).limit(12);
  const cur = (ls || []).find((l: any) => l.id === r.launch_id) || null;
  const lastPk = (ls || []).find((l: any) => Array.isArray(l.packages) && l.packages.length);
  const pk = cur && Array.isArray(cur.packages) && cur.packages.length ? cur.packages : (lastPk?.packages || []);
  const view = (l: any) => l && ({ name: l.name, number: l.cycle_no, code: l.code, kind: l.kind,
    start_kyiv: kyiv(l.starts_at), sales_stop_kyiv: kyiv(l.stop_at), live_final_kyiv: kyiv(l.live_at) });
  return {
    current_project: view(cur),
    packages: pk, packages_source: cur && cur.packages?.length ? "current project" : (lastPk ? `previous project #${lastPk.cycle_no} (the current one has none yet)` : null),
    other_active_projects: (ls || []).filter((l: any) => l.id !== r.launch_id && l.kind === "raffle").slice(0, 3).map(view),
  };
}

async function sources(sb: any, r: any) {
  const msgIds = [r.message_id, r.reply_to_message_id].filter(Boolean);
  let q = sb.from("tg_media_intake").select("message_id,media_group_id,kind,status,file_name,mime,creative_id")
    .eq("chat_id", r.chat_id);
  q = r.media_group_id ? q.or(`message_id.in.(${msgIds.join(",")}),media_group_id.eq.${r.media_group_id}`) : q.in("message_id", msgIds);
  const { data: rows } = await q;
  const ids = [...new Set([...(rows || []).map((x: any) => x.creative_id).filter(Boolean), ...(r.source_creative_ids || [])])];
  const { data: cr } = ids.length ? await sb.from("creatives").select("id,name,type,drive_file_id,width_px,height_px").in("id", ids) : { data: [] };
  const files = (cr || []).map((c: any) => ({ ...c, url: `${SUPABASE_URL}/storage/v1/object/public/creatives/${c.drive_file_id}` }));
  const missing = (rows || []).filter((x: any) => x.status !== "saved" && x.status !== "duplicate").map((x: any) => ({ message_id: x.message_id, status: x.status }));
  return { files, missing };
}

async function deliver(sb: any, r: any, creativeIds: string[], note: string): Promise<number[]> {
  const msgIds: number[] = [];
  const { data: cr } = await sb.from("creatives").select("id,name,drive_file_id,size_bytes").in("id", creativeIds);
  const urls = (cr || []).map((c: any) => ({ ...c, url: `${SUPABASE_URL}/storage/v1/object/public/creatives/${c.drive_file_id}` }));
  const head = `✅ Запит №${r.id} готовий, <a href="tg://user?id=${r.from_tg_id}">${esc(r.from_name || "")}</a>.` +
    (note ? `\n${esc(note).slice(0, 3000)}` : "") + `\nФайли також у медіатеці проєкту.`;
  const h = await sayR(r, head);
  if (h?.result?.message_id) msgIds.push(h.result.message_id);
  // документами, щоб Telegram не пережимав; ≤20 МБ по URL, по 10 в альбомі
  const small = urls.filter((u: any) => (u.size_bytes || 0) <= 20 * 1024 * 1024);
  const big = urls.filter((u: any) => (u.size_bytes || 0) > 20 * 1024 * 1024);
  for (let i = 0; i < small.length; i += 10) {
    const chunk = small.slice(i, i + 10);
    const res = chunk.length === 1
      ? await tg("sendDocument", { chat_id: chatOf(r), document: chunk[0].url, reply_to_message_id: r.message_id, allow_sending_without_reply: true })
      : await tg("sendMediaGroup", { chat_id: chatOf(r), reply_to_message_id: r.message_id, allow_sending_without_reply: true,
          media: chunk.map((c: any) => ({ type: "document", media: c.url })) });
    if (!res?.ok) { big.push(...chunk); continue; }
    for (const mm of (Array.isArray(res.result) ? res.result : [res.result])) if (mm?.message_id) msgIds.push(mm.message_id);
  }
  if (big.length) {
    const b = await sayR(r, big.map((c: any) => `📎 <a href="${c.url}">${esc(c.name || "файл")}</a>`).join("\n"));
    if (b?.result?.message_id) msgIds.push(b.result.message_id);
  }
  return msgIds;
}

async function workerAction(sb: any, b: any) {
  const id = Number(b.id || 0);
  const get = async () => (await sb.from("creative_requests").select("*").eq("id", id).maybeSingle()).data;
  switch (b.action) {
    case "claim": {
      const { data, error } = await sb.rpc("creative_request_claim", { p_worker: String(b.worker || "mac-studio").slice(0, 60) });
      if (error) throw new Error(error.message);
      const r = data && data.id ? data : null;
      if (r && r.attempts === 1) await sayR(r, `⚙️ Запит №${r.id} у роботі.`);
      return { request: r, ...(r ? { ...(await sources(sb, r)), project: await projectContext(sb, r) } : {}) };
    }
    case "sources": { const r = await get(); if (!r) return { error: "not found" }; return await sources(sb, r); }
    case "ask": {
      const r = await get(); if (!r) return { error: "not found" };
      const qtext = String(b.question || "").slice(0, 3500);
      if (!qtext) return { error: "question required" };
      const res = await sayR(r, `❓ Запит №${r.id}: ${esc(qtext)}\n<i>Відповідай reply на це повідомлення.</i>`);
      await sb.from("creative_requests").update({ status: "need_info", question: qtext, question_msg_id: res?.result?.message_id ?? null,
        claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", id);
      return { ok: true, question_msg_id: res?.result?.message_id ?? null };
    }
    case "quote": {
      const r = await get(); if (!r) return { error: "not found" };
      const q = b.quote && typeof b.quote === "object" ? b.quote : null;
      if (!q?.price_text) return { error: "quote.price_text required" };
      if (r.price_ok) return { error: "price already approved for this request; a new price needs a new request" };
      const quote = { price_text: String(q.price_text).slice(0, 200), items: Array.isArray(q.items) ? q.items.slice(0, 12) : [],
        total_usd: Number(q.total_usd) || null, credits: q.credits ?? null, engine: q.engine ? String(q.engine).slice(0, 80) : null,
        details: q.details ? String(q.details).slice(0, 1500) : null, at: new Date().toISOString() };
      const msgs = await postQuote(sb, r, quote);
      await sb.from("creative_requests").update({ status: "need_price_ok", quote, quote_msgs: msgs,
        claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() }).eq("id", id);
      return { ok: true, messages: msgs.length };
    }
    case "progress": {
      const r = await get(); if (!r) return { error: "not found" };
      const t = String(b.text || "").slice(0, 1000); if (!t) return { error: "text required" };
      await tg("sendMessage", { chat_id: chatOf(r), reply_to_message_id: r.message_id, allow_sending_without_reply: true,
        text: `⏳ №${r.id}: ${esc(t)}`, parse_mode: "HTML", disable_notification: true });
      return { ok: true };
    }
    case "complete": {
      const r = await get(); if (!r) return { error: "not found" };
      const ids: string[] = Array.isArray(b.creative_ids) ? b.creative_ids.map(String).slice(0, 50) : [];
      if (!ids.length) return { error: "creative_ids required" };
      const msgIds = await deliver(sb, r, ids, String(b.note || ""));
      await sb.from("creative_requests").update({ status: "done", result_creative_ids: ids, result_msg_ids: msgIds, result_note: String(b.note || "").slice(0, 4000),
        finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
      return { ok: true };
    }
    case "answer": {
      const r = await get(); if (!r) return { error: "not found" };
      const t = String(b.text || "").slice(0, 3800); if (!t) return { error: "text required" };
      const res = await sayR(r, esc(t));
      await sb.from("creative_requests").update({ status: "done", result_note: t, result_msg_ids: res?.result?.message_id ? [res.result.message_id] : [],
        finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
      return { ok: true };
    }
    case "fail": {
      const r = await get(); if (!r) return { error: "not found" };
      const err = String(b.error || "невідома помилка").slice(0, 1000);
      await sayR(r, `❗ Запит №${r.id} не вдалося виконати: ${esc(err)}`);
      await sb.from("creative_requests").update({ status: "failed", error: err, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
      return { ok: true };
    }
  }
  return { error: "unknown action" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!TG_BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "not configured" });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  let body: any = {};
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }

  try {
    const cron = req.headers.get("x-hq-cron-secret") ?? "";
    const worker = req.headers.get("x-cd-worker") ?? "";
    if (cron && HQ_CRON_SECRET && await safeEqual(cron, HQ_CRON_SECRET)) {
      if (body.callback) return json(200, { ok: true, ...(await onCallback(sb, body.callback)) });
      // 04.11.2026: запит з іншого робочого чату чи з особистих власника (owner-dm вже перевірив автора і чат)
      if (body.enqueue?.message && body.enqueue?.text) {
        return json(200, { ok: true, ...(await enqueue(sb, body.enqueue.message, String(body.enqueue.text), { hasFiles: !!body.enqueue.has_files })) });
      }
      if (!body.message) return json(400, { error: "message required" });
      return json(200, { ok: true, ...(await onMessage(sb, body.message)) });
    }
    if (worker.length >= 32) {
      const { data } = await sb.from("app_secrets").select("value").eq("key", "cd_worker_secret_sha256").maybeSingle();
      const want = String(data?.value || "");
      if (want && await safeEqual(await sha256Hex(worker), want)) return json(200, await workerAction(sb, body));
    }
    return json(401, { error: "unauthorized" });
  } catch (e) {
    console.error("[creative-request]", String(e));
    return json(500, { error: "internal" });
  }
});
