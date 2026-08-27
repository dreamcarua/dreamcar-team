// smm-content-watchdog — моніторинг виходу контенту @dreamcar.ua в Instagram.
//
// 27.08.2026: перенесено з GitHub Actions (etl/smm_content_watchdog.py, 279 рядків Python).
// Причина: воркфлоу ходив ~41 раз на добу (1230 ранів/міс) і кожен білився як повна
// хвилина, хоча реальної роботи — два HTTP-запити на 15 секунд. Це класика для Edge.
//
// Алерти в TG-чат SMM (через tg_notify_queue → tg-notify-queue-flush):
//   • немає сторіз > 3 год  → 🟡
//   • немає посту/рілз > 24 год → 🔴
// Тихі години 23:00–07:00 Kyiv — мовчимо. Повтор нагадування раз на годину.
// Стан і дедуп — dashboard_settings.smm_watchdog_state.
//
// Секрети НЕ в env: fb_access_token та ig_user_id читаються з app_secrets (вони там уже є).
// Ручний тест: ?dry=1 — рахує й повертає рішення, нічого не пише.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("DC_CRON_SECRET") ?? Deno.env.get("HQ_CRON_SECRET") ?? "";

const FB_API = Deno.env.get("FB_API_VERSION") || "v21.0";
const SMM_CHAT_ID = Deno.env.get("SMM_CHAT_ID") || "-1003933841573";
const STORY_GAP_H = Number(Deno.env.get("STORY_GAP_HOURS") || 3);
const POST_GAP_H = Number(Deno.env.get("POST_GAP_HOURS") || 24);
const WORK_START = Number(Deno.env.get("WORK_START_HOUR") || 7);   // інклюзивно
const WORK_END = Number(Deno.env.get("WORK_END_HOUR") || 23);      // ексклюзивно
const REMIND_H = Number(Deno.env.get("REMIND_HOURS") || 1);

const STATE_KEY = "smm_watchdog_state";
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// Година у Києві. 🔴 Deno за замовчуванням UTC — без явної зони тихі години
// зсуваються на 3 год і алерти летять серед ночі.
function kyivHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv", hour: "2-digit", hour12: false,
  }).format(d));
}
function kyivStamp(d: Date): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d).replace(",", "");
}

function parseTs(s: string | null | undefined): Date | null {
  if (!s) return null;
  // IG віддає "2026-08-27T10:54:37+0000" — без двокрапки в зсуві, Date це не бере.
  const t = s.trim().replace(/([+-]\d{2})(\d{2})$/, "$1:$2").replace(" ", "T");
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

async function getSecret(key: string): Promise<string> {
  const { data } = await sb.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? "").toString().trim();
}

async function fbGet(token: string, path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, access_token: token });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`https://graph.facebook.com/${FB_API}/${path}?${qs}`);
      if (r.ok) return await r.json();
      const body = await r.text();
      if (/rate limit|usage/i.test(body)) {
        await new Promise(res => setTimeout(res, Math.pow(2, attempt) * 3000));
        continue;
      }
      console.warn(`FB ${r.status}: ${body.slice(0, 200)}`);
      return null;
    } catch (e) {
      console.warn(`net: ${e}`);
      await new Promise(res => setTimeout(res, 2000 * (attempt + 1)));
    }
  }
  return null;
}

async function lastTsFromIg(token: string, igId: string, edge: string, limit: number): Promise<Date | null> {
  const d = await fbGet(token, `${igId}/${edge}`, { fields: "id,timestamp", limit: String(limit) });
  let best: Date | null = null;
  for (const item of (d?.data ?? [])) {
    const t = parseTs(item.timestamp);
    if (t && (!best || t > best)) best = t;
  }
  return best;
}

// Фолбек, якщо IG API не віддав: беремо останній запис із наших таблиць.
async function fallbackLast(table: string, igId: string): Promise<Date | null> {
  const { data } = await sb.from(table).select("published_at")
    .eq("ig_user_id", igId).order("published_at", { ascending: false }).limit(1);
  return parseTs(data?.[0]?.published_at);
}

type St = { last_alert_at: string | null; last_content_ts: string | null };

function shouldAlert(now: Date, lastTs: Date | null, gapH: number, st: Partial<St>): [boolean, St] {
  const prevAlert = parseTs(st?.last_alert_at);
  const lastIso = lastTs ? lastTs.toISOString() : null;

  if (lastTs) {
    const gap = (now.getTime() - lastTs.getTime()) / 3_600_000;
    if (gap <= gapH) return [false, { last_alert_at: null, last_content_ts: lastIso }];
  }
  const send = !prevAlert
    || (now.getTime() - prevAlert.getTime()) / 3_600_000 >= (REMIND_H - 1 / 60);
  return [send, {
    last_alert_at: send ? now.toISOString() : (prevAlert ? prevAlert.toISOString() : null),
    last_content_ts: lastIso,
  }];
}

function fmtGap(now: Date, lastTs: Date | null): string {
  if (!lastTs) return "невідомо коли (немає даних за 24 год)";
  const hrs = (now.getTime() - lastTs.getTime()) / 3_600_000;
  const when = kyivStamp(lastTs);
  return hrs < 24 ? `${hrs.toFixed(1)} год тому (остання: ${when})`
                  : `${(hrs / 24).toFixed(1)} дн тому (остання: ${when})`;
}

function buildMsg(kind: string, now: Date, lastTs: Date | null): string {
  const gap = fmtGap(now, lastTs);
  return kind === "stories"
    ? `🟡 <b>SMM: немає сторіз</b>\n@dreamcar.ua — сторіз не виходила вже ${gap}.\nПоріг: ${STORY_GAP_H} год. Час запостити 📲`
    : `🔴 <b>SMM: немає посту/рілз</b>\n@dreamcar.ua — пост/рілз не виходив уже ${gap}.\nПоріг: ${POST_GAP_H} год. Потрібна публікація 🎬`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";

  // fail-closed: секрет із env, не літерал; без нього — 500, з чужим — 401
  const got = req.headers.get("x-hq-cron-secret") || url.searchParams.get("secret");
  if (!CRON) return json({ error: "secret not configured" }, 500);
  if (got !== CRON) return json({ error: "unauthorized" }, 401);

  try {
    const now = new Date();
    const h = kyivHour(now);
    if (!(h >= WORK_START && h < WORK_END)) {
      return json({ ok: true, skipped: `тихі години (${h}:xx Kyiv)` });
    }

    const token = await getSecret("fb_access_token");
    const igId = (await getSecret("ig_user_id")) || "17841403783002317";
    if (!token) return json({ ok: false, error: "app_secrets.fb_access_token порожній" }, 500);

    const [liveStory, livePost] = await Promise.all([
      lastTsFromIg(token, igId, "stories", 50),
      lastTsFromIg(token, igId, "media", 25),
    ]);

    // Якщо API не віддав НІЧОГО — це майже завжди протухлий токен чи скоуп.
    // Мовчимо, щоб не спамити хибними алертами (та сама логіка, що в Python-версії).
    if (!liveStory && !livePost) {
      return json({ ok: false, error: "IG API не віддав ні сторіз, ні постів — ймовірно токен/скоуп" }, 502);
    }

    const lastStory = liveStory ?? await fallbackLast("dashboard_ig_stories", igId);
    const lastPost = livePost ?? await fallbackLast("dashboard_ig_media", igId);

    const { data: stRow } = await sb.from("dashboard_settings")
      .select("value").eq("key", STATE_KEY).maybeSingle();
    const state = (stRow?.value && typeof stRow.value === "object") ? stRow.value as Record<string, St> : {};

    const newState: Record<string, St> = { ...state };
    const results: any[] = [];

    for (const [kind, lastTs, thr] of [
      ["stories", lastStory, STORY_GAP_H],
      ["posts", lastPost, POST_GAP_H],
    ] as [string, Date | null, number][]) {
      const [send, stNew] = shouldAlert(now, lastTs, thr, state[kind] ?? {});
      newState[kind] = stNew;
      if (send && !dry) {
        await sb.from("tg_notify_queue").insert({
          chat_id: String(SMM_CHAT_ID), text: buildMsg(kind, now, lastTs),
          parse_mode: "HTML", source: "smm-content-watchdog", disable_web_page_preview: true,
        });
      }
      results.push({ kind, alert: send, last: lastTs?.toISOString() ?? null });
    }

    if (!dry) {
      await sb.from("dashboard_settings")
        .upsert({ key: STATE_KEY, value: newState, updated_at: now.toISOString() }, { onConflict: "key" });
    }

    return json({ ok: true, dry, kyiv_hour: h, results });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { "content-type": "application/json" },
  });
}
