// detect-unmapped-projects — ловить угоди з project, якого немає в реєстрі dashboard_projects.
// Причина появи (31.07.2026): BMW X6M стартував 08.07, але його забули завести в реєстр —
// 15 342 угоди й 6.25 млн ₴ місяць не потрапляли на дашборд. Щоб не повторювалось.
//
// Логіка: беремо угоди за останні N днів, групуємо по project, віднімаємо всі
// deal_project_values з реєстру → те, що лишилось і має ≥ MIN_DEALS, — «новий проект».
// Алерт шлеться ОДИН раз на кожне значення (anti-spam через unmapped_project_alerts).
//
// Params: ?dry=1 (preview) · ?days=30 · ?min=50 · ?reset=1 (очистити лог)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = Deno.env.get("TG_BOT_TOKEN")!;
const CHAT = Deno.env.get("DC_VADYM_CHAT_ID") || "1138351072"; // DM Вадиму

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
const esc = (s: string) => (s || "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
const fmt = (v: number) => new Intl.NumberFormat("uk-UA").format(Math.round(v));

async function sendTG(text: string) {
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json();
  return { ok: !!j.ok, err: j.description };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    // 08.08.2026 (аудит): додано auth (був відкритий ?reset=1 + видимість виручки у відповіді)
    const SEC = Deno.env.get("HQ_CRON_SECRET") ?? "";
    const got = req.headers.get("x-hq-cron-secret") || url.searchParams.get("secret");
    if (!SEC) return new Response(JSON.stringify({ ok: false, error: "secret not configured" }), { status: 500 });
    if (got !== SEC) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    const dry = url.searchParams.get("dry") === "1";
    const days = parseInt(url.searchParams.get("days") || "30", 10);
    const minDeals = parseInt(url.searchParams.get("min") || "50", 10);
    if (url.searchParams.get("reset") === "1") await sb.from("unmapped_project_alerts").delete().neq("project_value", "");

    const { data: found, error } = await sb.rpc("find_unmapped_projects", { p_days: days, p_min_deals: minDeals });
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    const rows = (found || []) as any[];

    // 14.08.2026: раніше алерт слався ОДИН раз назавжди — його легко пропустити в DM,
    // і проєкт «3 IPHONE» півдня висів незмаплений (дашборд показував 0 оплат при 923 лідах).
    // Тепер нагадуємо кожні 3 години, ПОКИ проєкт не змаплено (аліас додано → зникає зі списку).
    const REMIND_HOURS = 3;
    const { data: alerted } = await sb.from("unmapped_project_alerts").select("project_value, alerted_at");
    const lastAt = new Map((alerted || []).map((r: any) => [r.project_value, r.alerted_at]));
    const fresh = rows.filter(r => {
      const prev = lastAt.get(r.project_value);
      if (!prev) return true;
      return (Date.now() - new Date(prev).getTime()) > REMIND_HOURS * 3600 * 1000;
    });

    if (dry) {
      return new Response(JSON.stringify({ ok: true, dry: true, all: rows, new_since_last_alert: fresh }, null, 2),
        { headers: { "content-type": "application/json" } });
    }
    if (!fresh.length) {
      return new Response(JSON.stringify({ ok: true, sent: false, note: "нових немапнутих проектів немає", checked: rows.length }),
        { headers: { "content-type": "application/json" } });
    }

    const lines = fresh.map(r =>
      `🆕 <b>${esc(r.project_value)}</b>\n` +
      `   ${fmt(r.deals)} угод · ${fmt(r.revenue || 0)} ₴ · з ${r.first_deal} по ${r.last_deal}`
    );
    const text =
      `⚠️ <b>Проект поза дашбордом</b>\n\n` +
      `В угодах є значення, якого немає в реєстрі проектів — виручка по ньому <b>не рахується</b> на дашборді:\n\n` +
      lines.join("\n\n") +
      `\n\nДодати в реєстр: <a href="https://dashboard.dreamcar.ua/#projects">/#projects</a> (або скажи мені — заведу).`;

    const res = await sendTG(text);
    if (res.ok) {
      // upsert, не insert: повторне нагадування оновлює alerted_at (PK = project_value)
      await sb.from("unmapped_project_alerts").upsert(
        fresh.map(r => ({ project_value: r.project_value, deals_at_alert: r.deals, revenue_at_alert: r.revenue, alerted_at: new Date().toISOString() })),
        { onConflict: "project_value" }
      );
    }
    return new Response(JSON.stringify({ ok: true, sent: res.ok, tg: res, alerted: fresh.map(r => r.project_value) }),
      { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
