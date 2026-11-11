// =====================================================================
// tg-channel-scrape (11.11.2026) — статистика TG-каналу DreamCar з публічної сторінки t.me/s/<канал>.
// Bot API не віддає переглядів постів каналу, платні сервіси (TGStat API) Вадим не хоче (11.11.2026).
// Щогодини (pg_cron) проходить останні сторінки каналу і пише:
//   tg_channel_posts          — останні перегляди/реакції кожного поста
//   tg_channel_post_snapshots — погодинна динаміка для постів молодших за 72 год
//   tg_channel_daily          — підписники (точне число з t.me/<канал>)
//   tg_post_analytics         — views/reactions_total для постів, що вийшли через HQ
// Обмеження t.me: перегляди від 1000 округлені («1.4K»), пересилання й кліки не видно.
// Авторизація: x-hq-cron-secret. POST {pages?: 1..10}
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_CRON_SECRET = Deno.env.get("HQ_CRON_SECRET") ?? "";
const CHANNEL        = Deno.env.get("DC_TG_CHANNEL_USERNAME") || "DreamCar_CLUB";
const CHANNEL_ID     = Deno.env.get("DC_PROD_TG_CHANNEL") || "-1002496656144";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

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
function num(s: string | undefined | null): number | null {
  if (!s) return null;
  const m = String(s).trim().replace(/\s|&nbsp;/g, "").match(/^([\d.,]+)([KM]?)$/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  const k = m[2].toUpperCase() === "K" ? 1e3 : m[2].toUpperCase() === "M" ? 1e6 : 1;
  return Math.round(n * k);
}
function strip(html: string): string {
  return html.replace(/<br\s*\/?>/g, " ").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\s+/g, " ").trim();
}
async function page(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "uk,en" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return await r.text();
}
type Post = { msg_id: number; posted_at: string | null; kind: string; text_start: string; views: number | null; reactions: number };
function parse(html: string): Post[] {
  const out: Post[] = [];
  for (const b of html.split('class="tgme_widget_message_wrap').slice(1)) {
    const id = b.match(new RegExp(`data-post="${CHANNEL}/(\\d+)"`, "i"))?.[1];
    if (!id) continue;
    const reactions = [...b.matchAll(/class="tgme_reaction[^"]*">[\s\S]*?<\/i>([\d.,]+[KM]?)<\/span>/g)].reduce((a, m) => a + (num(m[1]) ?? 0), 0);
    const kind = /tgme_widget_message_video|message_video_player/.test(b) ? "video"
      : /tgme_widget_message_grouped/.test(b) ? "album"
      : /tgme_widget_message_photo/.test(b) ? "photo" : "text";
    out.push({
      msg_id: Number(id),
      posted_at: b.match(/<time[^>]*datetime="([^"]+)"/)?.[1] ?? null,
      kind,
      // по символах, не по UTF-16: .slice() розрізав емодзі навпіл → «invalid input syntax for type json»
      text_start: Array.from(strip(b.match(/js-message_text[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? "")).slice(0, 300).join("").replace(/[\uD800-\uDFFF]/g, ""),
      views: num(b.match(/tgme_widget_message_views">([^<]*)</)?.[1]),
      reactions,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!SUPABASE_URL || !SERVICE_KEY || !HQ_CRON_SECRET) return json(500, { error: "not configured" });
  if (!(await safeEqual(req.headers.get("x-hq-cron-secret") ?? "", HQ_CRON_SECRET))) return json(401, { error: "unauthorized" });
  let body: any = {}; try { body = await req.json(); } catch { /* empty */ }
  const pages = Math.min(10, Math.max(1, Number(body.pages) || 3));
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const now = new Date();
  try {
    // 1) пости: сторінка + попередні (?before=)
    const all = new Map<number, Post>();
    let before: number | null = null;
    for (let i = 0; i < pages; i++) {
      const html = await page(`https://t.me/s/${CHANNEL}${before ? `?before=${before}` : ""}`);
      const ps = parse(html);
      if (!ps.length) break;
      ps.forEach((p) => all.set(p.msg_id, p));
      before = Math.min(...ps.map((p) => p.msg_id));
    }
    const posts = [...all.values()];
    if (posts.length) {
      const rows = posts.map((p) => ({ channel: CHANNEL, ...p, updated_at: now.toISOString() }));
      const { error } = await sb.from("tg_channel_posts").upsert(rows, { onConflict: "channel,msg_id" });
      if (error) throw new Error("posts: " + error.message);
      const fresh = posts.filter((p) => p.posted_at && now.getTime() - Date.parse(p.posted_at) < 72 * 3600e3);
      if (fresh.length) {
        const snaps = fresh.map((p) => ({ channel: CHANNEL, msg_id: p.msg_id, captured_at: now.toISOString(),
          age_hours: Math.round((now.getTime() - Date.parse(p.posted_at!)) / 360e3) / 10, views: p.views, reactions: p.reactions }));
        const { error: e2 } = await sb.from("tg_channel_post_snapshots").insert(snaps);
        if (e2) throw new Error("snapshots: " + e2.message);
      }
      // 2) картки HQ, що вийшли в цей канал
      const { data: an } = await sb.from("tg_post_analytics").select("id,message_id").eq("channel_id", CHANNEL_ID)
        .in("message_id", posts.map((p) => p.msg_id));
      for (const a of an || []) {
        const p = all.get(Number(a.message_id));
        if (p) await sb.from("tg_post_analytics").update({ views: p.views, reactions_total: p.reactions, last_synced_at: now.toISOString() }).eq("id", a.id);
      }
    }
    // 3) підписники (точне число)
    let subscribers: number | null = null;
    const head = await page(`https://t.me/${CHANNEL}`);
    const m = head.match(/tgme_page_extra">([\d\s ]+)\s*(subscribers|підписник|подписчик)/i);
    if (m) subscribers = Number(m[1].replace(/\D/g, ""));
    if (subscribers) {
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(now);
      await sb.from("tg_channel_daily").upsert({ channel: CHANNEL, date, subscribers, updated_at: now.toISOString() }, { onConflict: "channel,date" });
    }
    return json(200, { ok: true, posts: posts.length, subscribers });
  } catch (e) {
    console.error("[tg-channel-scrape]", String(e));
    return json(500, { error: String(e).slice(0, 300) });
  }
});
