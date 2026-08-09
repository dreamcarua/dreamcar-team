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
  const now = new Date();
  const p = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit" }).formatToParts(now);
  const g = (t: string) => (p.find(x => x.type === t) || {} as any).value || "";
  // Intl з іншими полями віддає день тижня у знахідному («пʼятницю») — беремо називний вручну.
  const wdIdx = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", weekday: "short" })
    .format(now).replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/, (m) => String(["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(m))));
  const WD = ["неділя", "понеділок", "вівторок", "середа", "четвер", "пʼятниця", "субота"];
  return `${g("day")}.${g("month")} · ${WD[wdIdx] || ""}`;
}
// Спершу прибираємо HTML-теги (заголовки розсилок часто містять <b>…</b>), потім екрануємо —
// інакше в плані видно сирі &lt;b&gt;.
function esc(s: string): string {
  return (s || "").replace(/<[^>]+>/g, "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!)).trim();
}

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

// --- Ретеншн-розсилки на сьогодні (Kyiv) ---
function kyivDayBounds(): { from: string; to: string } {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv" }).format(now); // YYYY-MM-DD
  // межі доби Києва у UTC: беремо з запасом і фільтруємо за київською датою нижче
  return { from: `${ymd}T00:00:00+03:00`, to: `${ymd}T23:59:59+03:00` };
}
function kyivTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  } catch { return "--:--"; }
}
function retIcon(r: any): string {
  if (r.video_note_creative_id) return "⭕";      // відеозамітка
  if (r.media_count > 1) return "🖼";
  if (r.media_count === 1) return "📎";
  return "📝";
}
function retMark(status: string): string {
  if (status === "sent" || status === "published") return " ✅";
  if (status === "approved" || status === "scheduled") return "";
  if (status === "failed") return " ⚠️";
  return " ⏳"; // draft/review/rework
}
async function todayRetention(): Promise<any[]> {
  const { from, to } = kyivDayBounds();
  const { data } = await sb
    .from("retention_messages")
    .select("id, title, status, publish_at, channel, video_note_creative_id")
    .eq("channel", "tg")
    .is("deleted_at", null)
    .gte("publish_at", from)
    .lte("publish_at", to)
    .order("publish_at", { ascending: true });
  const rows = data || [];
  if (!rows.length) return [];
  // підрахунок медіа для іконки
  const ids = rows.map((r: any) => r.id);
  const { data: cr } = await sb.from("creative_retention_messages").select("retention_message_id").in("retention_message_id", ids);
  const counts: Record<string, number> = {};
  (cr || []).forEach((x: any) => { counts[x.retention_message_id] = (counts[x.retention_message_id] || 0) + 1; });
  return rows.map((r: any) => ({ ...r, media_count: counts[r.id] || 0 }));
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
    // 08.08.2026 (аудит): був без auth — будь-хто міг злити внутрішній контент-план
    // або запостити його ботом у чужий чат через ?chat=. Тепер секрет обов'язковий.
    const SEC = Deno.env.get("HQ_CRON_SECRET") ?? "";
    const got = req.headers.get("x-hq-cron-secret") || url.searchParams.get("secret");
    if (!SEC) return new Response(JSON.stringify({ ok: false, error: "secret not configured" }), { status: 500 });
    if (got !== SEC) return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
    const dry = url.searchParams.get("dry") === "1";
    const chat = url.searchParams.get("chat") || SMM_CHAT;

    const { data, error } = await sb.rpc("smm_today_schedule");
    if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    const rows = (data || []) as any[];

    const lines: string[] = [`📅 <b>План на сьогодні · ${kyivDateUA()}</b>`, "", "📣 <b>SMM · публікації</b>"];
    if (!rows.length) {
      lines.push("<i>Виходів не заплановано.</i>");
    } else {
      for (const r of rows) {
        lines.push(`${mediaIcon(r.media)} <b>${r.publish_time}</b> · ${esc(r.title || "(без назви)")}${readyMark(r.status)}`);
      }
      const notReady = rows.filter(r => r.status !== "published" && r.status !== "approved").length;
      lines.push(`Усього: <b>${rows.length}</b> вих.${notReady ? ` · ⏳ ще не готово: <b>${notReady}</b>` : " · всі готові ✅"}`);
    }

    // David 30.07.2026: + план ретеншн-розсилок у бота, щоб бачити ВЕСЬ план соцмереж на день
    const retRows = await todayRetention();
    lines.push("", "🤖 <b>Ретеншн · розсилки в бота</b>");
    if (!retRows.length) {
      lines.push("<i>Розсилок не заплановано.</i>");
    } else {
      for (const r of retRows) {
        lines.push(`${retIcon(r)} <b>${kyivTime(r.publish_at)}</b> · ${esc(r.title || "(без назви)")}${retMark(r.status)}`);
      }
      const notReady = retRows.filter((r: any) => !["approved", "scheduled", "sent", "published"].includes(r.status)).length;
      lines.push(`Усього: <b>${retRows.length}</b> розсил.${notReady ? ` · ⏳ ще не готово: <b>${notReady}</b>` : " · всі готові ✅"}`);
    }

    const text = lines.join("\n");

    if (dry) return new Response(JSON.stringify({ ok: true, dry: true, count: rows.length, preview: text }), { headers: { "content-type": "application/json" } });

    const res = await sendTG(chat, text);
    return new Response(JSON.stringify({ ok: res.ok, sent_to: chat, count: rows.length, tg: res }), { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
