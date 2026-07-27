// daily-smm-schedule — ранковий розклад виходів у робочу SMM-групу о 08:00 Kyiv.
// Бере ВСІ заплановані на сьогодні публікації (RPC smm_today_schedule, Kyiv TZ),
// форматує «час · тип · назва» + позначку готовності, шле у DreamCar SMM.
//
// Ручний тест:  ?dry=1 — повертає preview без відправки
//               ?chat=<id> — надіслати в інший чат (напр. тест-чат)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = Deno.env.get("TG_BOT_TOKEN")!;
const SMM_CHAT = Deno.env.get("DCSMM_GROUP_CHAT_ID") || "-1003933841573";

const sb = createClient(SB_URL, SB_KEY);

function kyivDateUA(): string {
  const p = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", weekday: "long" }).formatToParts(new Date());
  const g = (t: string) => (p.find(x => x.type === t) || {} as any).value || "";
  return `${g("day")}.${g("month")} · ${g("weekday")}`;
}
function esc(s: string): string { return (s || "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!)); }

// Емодзі за медіа: відео → 🎬, фото → 📷, кілька → 🖼, без медіа → 📝
function mediaIcon(media: string | null): string {
  if (!media) return "📝";
  if (media.includes("+")) return "🖼";
  if (media.includes("video")) return "🎬";
  if (media.includes("photo")) return "📷";
  return "📎";
}
// Готовність: published/approved — вийде/готово; решта — ще в роботі
function readyMark(status: string): string {
  if (status === "published") return " ✅";
  if (status === "approved") return "";
  return " ⏳"; // in_work/review/draft — ще не готово
}

async function sendTG(chatId: string, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json();
  return { ok: !!j.ok, err: j.description };
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    const dry = url.searchParams.get("dry") === "1";
    const chat = url.searchParams.get("chat") || SMM_CHAT;

    const { data, error } = await sb.rpc("smm_today_schedule");
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    const rows = (data || []) as any[];

    const lines: string[] = [`📅 <b>Розклад на сьогодні · ${kyivDateUA()}</b>`, ""];
    if (!rows.length) {
      lines.push("<i>На сьогодні виходів не заплановано.</i>");
    } else {
      for (const r of rows) {
        lines.push(`${mediaIcon(r.media)} <b>${r.publish_time}</b> · ${esc(r.title || "(без назви)")}${readyMark(r.status)}`);
      }
      const notReady = rows.filter(r => r.status !== "published" && r.status !== "approved").length;
      lines.push("");
      lines.push(`Усього: <b>${rows.length}</b> вих.${notReady ? ` · ⏳ ще не готово: <b>${notReady}</b>` : " · всі готові ✅"}`);
    }
    const text = lines.join("\n");

    if (dry) return new Response(JSON.stringify({ ok: true, dry: true, count: rows.length, preview: text }), { headers: { "content-type": "application/json" } });

    const res = await sendTG(chat, text);
    return new Response(JSON.stringify({ ok: res.ok, sent_to: chat, count: rows.length, tg: res }), { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
