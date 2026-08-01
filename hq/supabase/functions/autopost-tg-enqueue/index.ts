// =====================================================================
// DreamCar HQ — autopost-tg-enqueue (Cron 5хв)
// =====================================================================
// Знаходить approved публікації з platform=tg, publish_at у межах ±10хв
// → додає у tg_autopost_queue для обробки GitHub Action worker-ом.
//
// Target chat (тестовий!): -1003933841573 (DreamCar SMM)
// Production канал: -1002496656144 — НЕ використовуємо допоки не
// відпрацюємо нюанси. Перемикати тільки після ручного схвалення Вадима.
//
// Authentication:
//   ?secret=<HQ_CRON_SECRET> у URL АБО header x-hq-cron-secret.
//   HQ_CRON_SECRET — REQUIRED env-var (handler fail-fast 500 якщо порожній).
//   Edge Function має бути deploy-нута з --no-verify-jwt АБО з вимкненим
//   "Verify JWT with legacy secret" у Settings, інакше anon-auth блок.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  ?? Deno.env.get("HQ_DB_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";
// SECURITY: НЕ використовуємо hardcoded fallback. Edge падає 500 якщо secret порожній.
const CRON_SECRET   = Deno.env.get("HQ_CRON_SECRET") ?? "";

const TARGET_TG_CHAT_ID = Deno.env.get("DCSMM_TG_CHANNEL") || "-1003933841573";

// #direct-post (28.07.2026): постимо ПРЯМО через tg-post-send (Edge→Edge), без GH-worker.
// Причина: GH Actions scheduled cron давав до 80хв затримки у пікові години (09/12/00:00).
// Вікно тепер [now-15хв .. now] — постимо КОЛИ час настав (не +10хв наперед, інакше вихід
// до publish_at). tg-post-send сам робить retry + оновлює autopost_status/tg_message_id.
// 01.08.2026 (Sasha #4): пости не виходили. Причина — вікно було [now-15хв..now]:
// якщо публікацію СХВАЛИЛИ вже ПІСЛЯ publish_at (звична ситуація), вона назавжди
// випадала з вікна і не публікувалась ніколи. Тепер: вікно назад 12 год (пост виходить
// одразу після схвалення), старші за 12 год → 'missed' (не постимо мовчки застаріле).
const LOOKBACK_MS = 12 * 60 * 60 * 1000;
const STUCK_MS = 20 * 60 * 1000;

async function run(supabase: ReturnType<typeof createClient>) {
  const now = Date.now();
  const fromIso = new Date(now - LOOKBACK_MS).toISOString();
  const toIso = new Date(now).toISOString();

  // watchdog: звільняємо claim, що завис у 'processing' довше 20 хв (щоб був retry)
  await supabase
    .from("publications")
    .update({ autopost_status: null })
    .eq("autopost_status", "processing")
    .lt("updated_at", new Date(now - STUCK_MS).toISOString());

  // застарілі (approved, час минув >12 год, ще не публіковані) — позначаємо missed
  await supabase
    .from("publications")
    .update({ autopost_status: "missed", autopost_error: "publish_at прострочено >12 год — автопост пропущено" })
    .eq("status", "approved")
    .lt("publish_at", fromIso)
    .is("autopost_status", null)
    .is("deleted_at", null);

  const { data: candidates, error: e1 } = await supabase
    .from("publications")
    .select(`id, title, status, publish_at, autopost_status, publication_platforms!inner(platform)`)
    .eq("status", "approved")
    .eq("publication_platforms.platform", "tg")
    .gte("publish_at", fromIso)
    .lte("publish_at", toIso)
    .is("deleted_at", null)
    .is("autopost_status", null);

  if (e1) {
    console.error("Query candidates failed:", e1);
    return { ok: false, posted: 0, error: e1.message };
  }
  if (!candidates || candidates.length === 0) {
    return { ok: true, posted: 0, window: { from: fromIso, to: toIso } };
  }

  // Атомарний claim: беремо лише publication що ще null (щоб не задублювати між тіками)
  const toPost: string[] = [];
  for (const p of candidates) {
    const { data: claimed } = await supabase
      .from("publications")
      .update({ autopost_status: "processing", autopost_error: null })
      .eq("id", p.id)
      .is("autopost_status", null)
      .select("id")
      .maybeSingle();
    if (claimed) toPost.push(p.id);
  }

  // Постимо паралельно (максимум 8 за тік, решта — наступного). tg-post-send сам:
  // download+multipart для великих відео, retry (4 рівні), autopost_status='sent'/'failed'.
  const batch = toPost.slice(0, 8);
  await Promise.allSettled(batch.map((pid) =>
    fetch(`${SUPABASE_URL}/functions/v1/tg-post-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hq-cron-secret": CRON_SECRET },
      body: JSON.stringify({ publication_id: pid, force_channel: TARGET_TG_CHAT_ID }),
    }).then((r) => r.json()).catch((e) => ({ error: String(e), pid }))
  ));

  return { ok: true, posted: batch.length, candidates: candidates.length, target_chat: TARGET_TG_CHAT_ID };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST" && req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  // SECURITY: fail-fast якщо secret env-var не виставлено (no fallback).
  if (!CRON_SECRET) {
    console.error("HQ_CRON_SECRET not configured");
    return new Response("Server misconfiguration", { status: 500 });
  }

  // Auth check — header або query string
  const got = req.headers.get("x-hq-cron-secret");
  const urlSec = new URL(req.url).searchParams.get("secret");
  if (got !== CRON_SECRET && urlSec !== CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!SUPABASE_URL || !SERVICE_KEY) return new Response("Missing config", { status: 500 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const result = await run(supabase);
    return new Response(JSON.stringify({ ...result, version: "v1.2-#274-fixed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("autopost-tg-enqueue error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
