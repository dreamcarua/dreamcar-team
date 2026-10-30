// =====================================================================
// media-intake (30.10.2026) — файли з чату «DreamCar Media» → медіатека HQ.
//
// Викликає tg-webhook (fire-and-forget) для кожного повідомлення з Media-чату
// і pg_cron раз на хвилину (ack). Лише сервер: x-hq-cron-secret.
//
// POST { message }  — зберегти медіа з повідомлення (фото/відео/документ-зображення/відео)
//                     або обробити «скасувати/❌» у відповідь на підтвердження бота
// POST { ack: true } — надіслати згруповані підтвердження (одне на альбом/повідомлення)
//
// Проєкт: хештег у підписі = launches.code (#range, #bmw330, #content),
// інакше library_guess_launch(now()) — поточний розіграш.
// Ліміт Telegram Bot API на завантаження ботом — 20 МБ: більші файли
// позначаються too_big, у підтвердженні — посилання на Бібліотеку.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TG_BOT_TOKEN   = Deno.env.get("TG_BOT_TOKEN") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_CRON_SECRET = Deno.env.get("HQ_CRON_SECRET") ?? "";
const MEDIA_CHAT_ID  = Number(Deno.env.get("DCMEDIA_GROUP_CHAT_ID") || "-1003912295530");
const DESK           = "11111111-1111-1111-1111-111111111111";
const OWNER          = "aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const BUCKET         = "creatives";
const TG_MAX         = 20 * 1024 * 1024;
const HQ_LIBRARY     = "https://dreamcarua.github.io/dreamcar-team/hq/#library";
const ACK_DELAY_SEC  = 20;   // чекаємо, поки долетить увесь альбом
// \b не працює з кирилицею: межа слова = пробіл/кінець/розділовий знак
const CANCEL_RE = /^(❌|✖️|скасувати|скасуй|отмена|отменить|cancel|видали|видалити)(?=$|[\s!.,])/u;
const SAVE_RE = /^((в|у|до)\s+)?(медіа|медиа|медіатеку|медиатеку|media)(?=$|[\s!.,])|^(збережи|сохрани|save)(?=$|[\s!.,])/u;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let d = 0; for (let i = 0; i < ua.length; i++) d |= ua[i] ^ ub[i];
  return d === 0;
}
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return await r.json().catch(() => ({ ok: false }));
}

type Item = { kind: "photo" | "video" | "doc"; file_id: string; file_unique_id: string; size?: number;
  mime?: string; name?: string; w?: number; h?: number; dur?: number };

// Що з повідомлення кладемо в медіатеку
function extractItems(m: any): Item[] {
  const out: Item[] = [];
  if (Array.isArray(m.photo) && m.photo.length) {
    const p = m.photo[m.photo.length - 1]; // найбільший розмір
    out.push({ kind: "photo", file_id: p.file_id, file_unique_id: p.file_unique_id, size: p.file_size, mime: "image/jpeg", w: p.width, h: p.height });
  }
  if (m.video) {
    const v = m.video;
    out.push({ kind: "video", file_id: v.file_id, file_unique_id: v.file_unique_id, size: v.file_size, mime: v.mime_type || "video/mp4", name: v.file_name, w: v.width, h: v.height, dur: v.duration });
  }
  if (m.animation) {
    const v = m.animation;
    out.push({ kind: "video", file_id: v.file_id, file_unique_id: v.file_unique_id, size: v.file_size, mime: v.mime_type || "video/mp4", name: v.file_name, w: v.width, h: v.height, dur: v.duration });
  }
  if (m.document && !m.animation) {
    const d = m.document; const mime = String(d.mime_type || "").toLowerCase();
    // документом шлють оригінали: беремо лише зображення і відео
    if (mime.startsWith("image/")) out.push({ kind: "photo", file_id: d.file_id, file_unique_id: d.file_unique_id, size: d.file_size, mime, name: d.file_name });
    else if (mime.startsWith("video/")) out.push({ kind: "video", file_id: d.file_id, file_unique_id: d.file_unique_id, size: d.file_size, mime, name: d.file_name });
  }
  return out;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif",
  "image/tiff": "tif", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-matroska": "mkv",
};
function extFor(it: Item, tgPath?: string): string {
  const fromName = (it.name || "").split(".").pop()?.toLowerCase();
  if (fromName && fromName.length <= 5 && fromName !== it.name?.toLowerCase()) return fromName;
  if (it.mime && EXT[it.mime]) return EXT[it.mime];
  const fromPath = (tgPath || "").split(".").pop()?.toLowerCase();
  return fromPath && fromPath.length <= 5 ? fromPath : (it.kind === "video" ? "mp4" : "jpg");
}

async function resolveLaunch(sb: any, caption: string): Promise<string | null> {
  const tags = [...caption.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((x) => x[1].toLowerCase());
  if (tags.length) {
    const { data } = await sb.from("launches").select("id,code").eq("is_active", true);
    for (const t of tags) {
      const hit = (data || []).find((l: any) => String(l.code || "").toLowerCase() === t);
      if (hit) return hit.id;
    }
  }
  const { data: g } = await sb.rpc("library_guess_launch", { p_at: new Date().toISOString() });
  return (g as string) || null;
}

async function handleMessage(sb: any, m: any) {
  if (Number(m?.chat?.id) !== MEDIA_CHAT_ID) return { skipped: "not media chat" };
  if (m.from?.is_bot) return { skipped: "bot" };

  // Скасування: reply «❌»/«скасувати»/«отмена» на підтвердження бота
  const txt = String(m.text || "").trim().toLowerCase();
  if (m.reply_to_message?.from?.is_bot && CANCEL_RE.test(txt)) {
    const ackId = m.reply_to_message.message_id;
    const { data: rows } = await sb.from("tg_media_intake").select("id,creative_id,from_tg_id")
      .eq("chat_id", MEDIA_CHAT_ID).eq("ack_msg_id", ackId).eq("status", "saved");
    if (!rows?.length) return { cancel: 0 };
    const ids = rows.map((r: any) => r.creative_id).filter(Boolean);
    if (ids.length) await sb.from("creatives").update({ deleted_at: new Date().toISOString() }).in("id", ids);
    await sb.from("tg_media_intake").update({ status: "cancelled" }).in("id", rows.map((r: any) => r.id));
    await tg("sendMessage", { chat_id: MEDIA_CHAT_ID, reply_to_message_id: m.message_id, allow_sending_without_reply: true,
      text: `↩️ Прибрав з медіатеки: ${rows.length}`, disable_notification: true });
    return { cancel: rows.length };
  }

  // 30.10.2026 (Вадим): зберігаємо лише повідомлення, де бота тегнули (запит до відділу креативів або «в медіа»)
  const tagged = `${m.text || ""} ${m.caption || ""}`.toLowerCase().includes("@dreamcar_team_bot");
  // reply боту з файлом (доопрацювання результату) теж рахується: файл потрібен як вихідник
  if (!tagged && !m.reply_to_message?.from?.is_bot) return { skipped: "not tagged" };
  // reply «@dreamcar_team_bot в медіа» (або «збережи») на старе повідомлення з файлом → зберегти той файл
  let src = m;
  let items = extractItems(m);
  if (!items.length && m.reply_to_message && SAVE_RE.test(txt.replace(/@dreamcar_team_bot/g, "").trim())) {
    src = m.reply_to_message;
    items = extractItems(src);
  }
  if (!items.length) return { skipped: "no media" };
  m = { ...src, chat: m.chat, from: src.from?.is_bot ? m.from : (src.from || m.from) };

  const caption = String(m.caption || "");
  const fromName = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || m.from?.username || "?";
  const launch = await resolveLaunch(sb, caption);
  const { data: u } = await sb.from("users").select("id").eq("tg_chat_id", m.from?.id ?? 0).maybeSingle();
  const uploader = u?.id || OWNER;

  const results: any[] = [];
  for (const it of items) {
    const base = {
      chat_id: MEDIA_CHAT_ID, message_id: m.message_id, media_group_id: m.media_group_id || null,
      file_unique_id: it.file_unique_id, file_id: it.file_id, kind: it.kind, mime: it.mime || null,
      file_name: it.name || null, size_bytes: it.size || null, from_tg_id: m.from?.id || null,
      from_name: fromName, caption: caption || null, launch_id: launch,
    };
    // дубль: той самий файл уже лежить у медіатеці
    const { data: dup } = await sb.from("tg_media_intake").select("id,creative_id").eq("file_unique_id", it.file_unique_id).eq("status", "saved").maybeSingle();
    if (dup) { await sb.from("tg_media_intake").upsert({ ...base, status: "duplicate", creative_id: dup.creative_id },  { onConflict: "chat_id,message_id,file_unique_id", ignoreDuplicates: true }); results.push("duplicate"); continue; }
    if ((it.size || 0) > TG_MAX) { await sb.from("tg_media_intake").upsert({ ...base, status: "too_big" }, { onConflict: "chat_id,message_id,file_unique_id", ignoreDuplicates: true }); results.push("too_big"); continue; }

    try {
      const gf = await tg("getFile", { file_id: it.file_id });
      if (!gf.ok) {
        const big = /too big/i.test(String(gf.description || ""));
        await sb.from("tg_media_intake").upsert({ ...base, status: big ? "too_big" : "error", error: String(gf.description || "getFile failed").slice(0, 300) }, { onConflict: "chat_id,message_id,file_unique_id", ignoreDuplicates: true });
        results.push(big ? "too_big" : "error"); continue;
      }
      const tgPath: string = gf.result.file_path;
      const fr = await fetch(`https://api.telegram.org/file/bot${TG_BOT_TOKEN}/${tgPath}`);
      if (!fr.ok) throw new Error(`download ${fr.status}`);
      const bytes = new Uint8Array(await fr.arrayBuffer());
      const ext = extFor(it, tgPath);
      const mime = it.mime || (it.kind === "video" ? "video/mp4" : "image/jpeg");
      const obj = `tg/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${obj}`, {
        method: "POST", headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "content-type": mime, "x-upsert": "false" }, body: bytes,
      });
      if (!up.ok) throw new Error(`storage ${up.status} ${(await up.text()).slice(0, 150)}`);
      const pub = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${obj}`;

      const name = (it.name || caption.split("\n")[0] || `tg_${m.message_id}`).slice(0, 200);
      const row: Record<string, unknown> = {
        desk_id: DESK, uploaded_by: uploader, name, type: it.kind, drive_file_id: obj, size_bytes: bytes.length,
        width_px: it.w || null, height_px: it.h || null, duration_sec: it.dur || null,
        tags: ["tg-media"], launch_id: launch, folder_source: "tg_media",
      };
      if (it.kind === "photo") { row.thumbnail_url = pub; row.compressed_url = pub; row.compressed_status = "ready"; }
      const { data: cr, error } = await sb.from("creatives").insert(row).select("id").single();
      if (error) throw new Error(`creatives insert: ${error.message}`);
      await sb.from("tg_media_intake").upsert({ ...base, size_bytes: bytes.length, creative_id: cr.id, status: "saved" }, { onConflict: "chat_id,message_id,file_unique_id" });
      results.push("saved");
    } catch (e) {
      console.error("[media-intake]", it.file_unique_id, String(e));
      await sb.from("tg_media_intake").upsert({ ...base, status: "error", error: String(e).slice(0, 300) }, { onConflict: "chat_id,message_id,file_unique_id", ignoreDuplicates: true });
      results.push("error");
    }
  }
  return { items: results };
}

// Одне підтвердження на альбом / повідомлення
async function sendAcks(sb: any) {
  const cutoff = new Date(Date.now() - ACK_DELAY_SEC * 1000).toISOString();
  const { data: rows } = await sb.from("tg_media_intake")
    .select("id,message_id,media_group_id,status,launch_id,created_at")
    .eq("chat_id", MEDIA_CHAT_ID).is("acked_at", null)
    .gt("created_at", new Date(Date.now() - 6 * 3600e3).toISOString())
    .order("message_id").limit(500);
  if (!rows?.length) return { groups: 0 };

  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const k = r.media_group_id ? `g:${r.media_group_id}` : `m:${r.message_id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const { data: launches } = await sb.from("launches").select("id,name,cycle_no");
  const lname = (id: string | null) => {
    const l = (launches || []).find((x: any) => x.id === id);
    return l ? (l.cycle_no ? `#${l.cycle_no} ${l.name}` : l.name) : "без проєкту";
  };

  // файли, надіслані разом із запитом до відділу креативів, підтверджує creative-request
  const { data: reqs } = await sb.from("creative_requests").select("message_id,media_group_id")
    .eq("chat_id", MEDIA_CHAT_ID).gt("created_at", new Date(Date.now() - 6 * 3600e3).toISOString());
  const reqMsg = new Set((reqs || []).map((x: any) => x.message_id));
  const reqGrp = new Set((reqs || []).map((x: any) => x.media_group_id).filter(Boolean));

  let sent = 0;
  for (const [, g] of groups) {
    // альбом ще «доїжджає» — не підтверджуємо, поки останній файл молодший за ACK_DELAY_SEC
    if (g.some((r) => r.created_at > cutoff)) continue;
    if (g.some((r) => reqMsg.has(r.message_id) || (r.media_group_id && reqGrp.has(r.media_group_id)))) {
      await sb.from("tg_media_intake").update({ acked_at: new Date().toISOString() }).in("id", g.map((r) => r.id));
      continue;
    }
    // 30.10.2026 (Вадим): без підтвердження на кожен файл — суму раз на годину шле media-batch-notify.
    // У тред пишемо лише про те, що НЕ збереглося.
    const big = g.filter((r) => r.status === "too_big").length;
    const err = g.filter((r) => r.status === "error").length;
    if (!big && !err) {
      await sb.from("tg_media_intake").update({ acked_at: new Date().toISOString() }).in("id", g.map((r) => r.id));
      continue;
    }
    const parts: string[] = [];
    if (big) parts.push(`⚠️ ${big} більше 20 МБ: Telegram не віддає боту такі файли, завантаж у <a href="${HQ_LIBRARY}">Бібліотеку</a>`);
    if (err) parts.push(`❗ ${err} не вдалося зберегти`);
    const text = parts.join("\n");
    const anchor = Math.min(...g.map((r) => r.message_id));
    const res = await tg("sendMessage", { chat_id: MEDIA_CHAT_ID, reply_to_message_id: anchor, allow_sending_without_reply: true,
      text, parse_mode: "HTML", disable_web_page_preview: true, disable_notification: true });
    await sb.from("tg_media_intake").update({ acked_at: new Date().toISOString(), ack_msg_id: res?.result?.message_id ?? null })
      .in("id", g.map((r) => r.id));
    sent++;
  }
  return { groups: sent };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!HQ_CRON_SECRET || !TG_BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "not configured" });
  if (!(await safeEqual(req.headers.get("x-hq-cron-secret") ?? "", HQ_CRON_SECRET))) return json(401, { error: "unauthorized" });

  let body: any = {};
  try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    if (body.ack) return json(200, { ok: true, ...(await sendAcks(sb)) });
    if (body.message) return json(200, { ok: true, ...(await handleMessage(sb, body.message)) });
    return json(400, { error: "message or ack required" });
  } catch (e) {
    console.error("[media-intake] fatal", String(e));
    return json(500, { error: "internal" });
  }
});
