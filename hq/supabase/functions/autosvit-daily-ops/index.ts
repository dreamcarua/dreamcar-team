// «Автосвіт» :: daily-ops — метрики через 72 год, гігієна лідів, watchdog, понеділкові кандидати на буст
// POST  header: x-hq-cron-secret   { dry_run? }

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("HQ_CRON_SECRET") ?? "";
const SMM_CHAT = Deno.env.get("SMM_CHAT_ID") ?? "-1003933841573";
const JH = { "Content-Type": "application/json" };
const esc = (s: string) => (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const kyiv = () => new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date());
const kyivDow = () => ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", weekday: "short" }).format(new Date())];

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`sb ${path.split("?")[0]} ${r.status}`);
  return t ? JSON.parse(t) : null;
}
const normUrl = (u: string) => (u || "").split("?")[0].replace(/\/+$/, "");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!CRON_SECRET) return new Response(JSON.stringify({ error: "HQ_CRON_SECRET missing" }), { status: 500, headers: JH });
  if (req.headers.get("x-hq-cron-secret") !== CRON_SECRET) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JH });
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const dryRun = body.dry_run === true;
  const report: any = {};
  const alerts: string[] = [];

  try {
    const nowMs = Date.now();

    // 1. МЕТРИКИ: ідеї з публікацією, без метрик, 72+ год після виходу
    const pending = await sb("autosvit_ideas?publication_id=not.is.null&metrics=is.null&status=in.(approved,published)&select=id,publication_id,rubric_slug,title&limit=25");
    let filled = 0, unmatched = 0;
    for (const idea of pending || []) {
      try {
        const pub = (await sb(`publications?id=eq.${idea.publication_id}&select=id,status,publish_at,published_at,verified_at,verified_evidence_url`))?.[0];
        if (!pub) continue;
        const liveAt = pub.published_at || pub.verified_at || (pub.status === "published" ? pub.publish_at : null);
        if (!liveAt || nowMs - new Date(liveAt).getTime() < 72 * 3600e3) continue;
        const metrics: any = {};
        if (pub.verified_evidence_url) {
          const base = normUrl(pub.verified_evidence_url);
          const media = (await sb(`dashboard_ig_media?or=(permalink.eq.${encodeURIComponent(base)},permalink.eq.${encodeURIComponent(base + "/")})&select=reach,like_count,comments_count,saved,shares,views,engagement_rate&limit=1`))?.[0];
          if (media) metrics.ig = media;
        }
        const tg = (await sb(`tg_post_analytics?publication_id=eq.${pub.id}&select=views,forwards,reactions_total&limit=1`))?.[0];
        if (tg) metrics.tg = tg;
        if (Object.keys(metrics).length) {
          metrics.filled_at = new Date().toISOString();
          if (!dryRun) await sb(`autosvit_ideas?id=eq.${idea.id}`, { method: "PATCH", body: JSON.stringify({ metrics, published_at: liveAt, status: "published" }) });
          filled++;
        } else if (nowMs - new Date(liveAt).getTime() > 10 * 864e5) {
          if (!dryRun) await sb(`autosvit_ideas?id=eq.${idea.id}`, { method: "PATCH", body: JSON.stringify({ metrics: { unmatched: true, checked_at: new Date().toISOString() } }) });
          unmatched++;
        }
      } catch (e) { console.error("metrics idea", idea.id, e); }
    }
    report.metrics = { checked: (pending || []).length, filled, unmatched };

    // 2. ГІГІЄНА: прострочені ліди (21 день) → rejected
    if (!dryRun) {
      const expired = await sb(`autosvit_leads?status=eq.new&created_at=lt.${encodeURIComponent(new Date(nowMs - 21 * 864e5).toISOString())}`, { method: "PATCH", body: JSON.stringify({ status: "rejected", updated_at: new Date().toISOString() }) });
      report.expired_leads = Array.isArray(expired) ? expired.length : 0;
    }

    // 3. САМОЗЦІЛЕННЯ: approved без публікації понад 30 хв (обірваний approve) → назад у draft
    const stuck = await sb(`autosvit_ideas?status=eq.approved&publication_id=is.null&decided_at=lt.${encodeURIComponent(new Date(nowMs - 30 * 60e3).toISOString())}&select=id,title`);
    if (stuck?.length) {
      if (!dryRun) for (const s of stuck) await sb(`autosvit_ideas?id=eq.${s.id}`, { method: "PATCH", body: JSON.stringify({ status: "draft", decided_by: null, decided_at: null }) });
      alerts.push(`♻️ Повернув у чернетки ${stuck.length} обірваних апрувів`);
    }

    // 4. WATCHDOG
    const lastLead = (await sb("autosvit_leads?select=created_at&order=created_at.desc&limit=1"))?.[0];
    if (lastLead && nowMs - new Date(lastLead.created_at).getTime() > 36 * 3600e3) alerts.push("⚠️ Понад 36 год жодного нового інфоприводу — перевір автозбір");
    const errSrc = await sb("autosvit_sources?active=eq.true&fetch_url=not.is.null&last_fetch_note=like.err*&select=slug");
    if ((errSrc || []).length >= 4) alerts.push(`⚠️ Джерел з помилками: ${errSrc.length} (${errSrc.slice(0, 5).map((s: any) => s.slug).join(", ")})`);
    const stale = await sb(`autosvit_ideas?status=in.(draft,sent)&created_at=lt.${encodeURIComponent(new Date(nowMs - 5 * 864e5).toISOString())}&select=id`);
    if ((stale || []).length) alerts.push(`⏳ Чернеток без рішення понад 5 днів: ${stale.length} — team.dreamcar.ua/autosvit/`);
    report.watchdog = { err_sources: (errSrc || []).length, stale_drafts: (stale || []).length };

    // 5. ПОНЕДІЛОК: кандидати на буст (правило sends/reach) + скорборд рубрик
    const lines: string[] = [];
    if (kyivDow() === 1) {
      const recent = await sb(`autosvit_ideas?metrics=not.is.null&published_at=gte.${encodeURIComponent(new Date(nowMs - 7 * 864e5).toISOString())}&select=title,rubric_slug,metrics`);
      const cands = (recent || [])
        .filter((i: any) => i.metrics?.ig?.reach > 300)
        .map((i: any) => ({ t: i.title, r: i.rubric_slug, ratio: (i.metrics.ig.shares || 0) / Math.max(i.metrics.ig.reach, 1), reach: i.metrics.ig.reach }))
        .sort((a: any, b: any) => b.ratio - a.ratio).slice(0, 3);
      if (cands.length) {
        lines.push(`<b>🚀 Кандидати на буст</b> (пересилання/охоплення за тиждень):`);
        cands.forEach((c: any, i: number) => lines.push(`${i + 1}. ${esc(c.t)} — ${(c.ratio * 100).toFixed(1)}% при охопленні ${c.reach}`));
        lines.push(`Готовий підготувати структури бусту (PAUSED) — напиши «буст N».`);
      }
    }

    if (!dryRun && (alerts.length || lines.length)) {
      const text = [`<b>Автосвіт · щоденна перевірка</b> · ${esc(kyiv())}`, ...alerts, ...(lines.length ? ["", ...lines] : [])].join("\n");
      await sb("tg_notify_queue", { method: "POST", body: JSON.stringify({ chat_id: SMM_CHAT, text, parse_mode: "HTML", source: "autosvit-daily-ops" }) }).catch(() => {});
    }

    return new Response(JSON.stringify({ ok: true, report, alerts }), { status: 200, headers: JH });
  } catch (e) {
    console.error("autosvit-daily-ops:", e);
    return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: JH });
  }
});
