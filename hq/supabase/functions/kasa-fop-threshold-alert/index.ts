// kasa-fop-threshold-alert — пороговий алерт ФОП-ліміту 2 групи у BOARD.
// Пороги: 10..90 (кроком 10), далі 95,96,97,98,99. Кожен поріг шлеться ОДИН раз
// (anti-spam через kasa_fop_alert_log: fop_name+year+threshold_code).
// Канал — та сама група, куди daily-finance-board-report (BOARD).
//
// Ручний тест:
//   ?dry=1   — не шле і не логує, повертає preview
//   ?reset=1 — очищає лог порогів (щоб прогнати тест повторно)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_TOKEN = Deno.env.get("TG_BOT_TOKEN")!;
const BOARD_CHAT_ID = -1003883456849;

const THRESHOLDS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 96, 97, 98, 99];
const YEAR = 2026;

const sb = createClient(SB_URL, SB_KEY);

const fmtUAH = (v: number) => new Intl.NumberFormat("uk-UA").format(Math.round(v)) + " ₴";
const emoji = (pct: number) => (pct >= 95 ? "🔴" : pct >= 80 ? "🟠" : pct >= 50 ? "🟡" : "🟢");

async function sendTG(text: string) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: BOARD_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json();
  return { ok: !!j.ok, err: j.description };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    const reset = url.searchParams.get("reset") === "1";

    if (reset) await sb.from("kasa_fop_alert_log").delete().eq("year", YEAR);

    const { data: fl, error } = await sb.rpc("dashboard_kasa_fop_limit", { p_year: YEAR });
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    const fops = (fl?.fops || []).filter((f: any) => f.name);

    const { data: sent } = await sb.from("kasa_fop_alert_log").select("fop_name, threshold_code").eq("year", YEAR);
    const sentSet = new Set((sent || []).map((r: any) => `${r.fop_name}:${r.threshold_code}`));

    const lines: string[] = [];
    const toInsert: any[] = [];

    for (const f of fops) {
      const pct = Number(f.pct_used || 0);
      const crossed = THRESHOLDS.filter((t) => pct >= t && !sentSet.has(`${f.name}:${t}`));
      if (!crossed.length) continue;
      const highest = Math.max(...crossed);
      for (const t of crossed) {
        toInsert.push({
          fop_name: f.name, year: YEAR, threshold_code: String(t),
          net_income_at_alert: f.net_income, remaining_at_alert: f.remaining,
        });
      }
      const over = f.over_limit ? " · 🚨 ПЕРЕВИЩЕНО" : "";
      lines.push(
        `${emoji(pct)} <b>${f.name}</b> — досяг <b>${highest}%</b> ліміту${over}\n` +
        `   ${fmtUAH(f.net_income)} / ${fmtUAH(f.limit_uah)} · лишилось <b>${fmtUAH(f.remaining)}</b>`
      );
    }

    if (!lines.length) {
      return new Response(JSON.stringify({ ok: true, sent: false, note: "no new thresholds" }),
        { headers: { "content-type": "application/json" } });
    }

    const text =
      `⚠️ <b>ФОП-ліміт 2 групи · ${YEAR}</b>\n` +
      `Ліміт ${fmtUAH(Number(fops[0]?.limit_uah || 7211598))} на кожен ФОП\n\n` +
      lines.join("\n\n") +
      `\n\n<a href="https://dashboard.dreamcar.ua/kasa/">/kasa/</a>`;

    if (dry) {
      return new Response(JSON.stringify({ ok: true, dry: true, would_log: toInsert.length, preview: text }),
        { headers: { "content-type": "application/json" } });
    }

    const res = await sendTG(text);
    if (res.ok && toInsert.length) await sb.from("kasa_fop_alert_log").insert(toInsert);

    return new Response(JSON.stringify({ ok: true, sent: res.ok, tg: res, thresholds_logged: toInsert.length }),
      { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
