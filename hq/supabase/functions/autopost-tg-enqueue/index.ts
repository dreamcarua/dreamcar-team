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

async function run(supabase: ReturnType<typeof createClient>) {
  const nowIso = new Date().toISOString();
  const fromIso = new Date(Date.now() - 2 * 60000).toISOString();
  const toIso = new Date(Date.now() + 10 * 60000).toISOString();

  const { data: candidates, error: e1 } = await supabase
    .from("publications")
    .select(`
      id, title, status, publish_at, autopost_status,
      publication_platforms!inner(platform)
    `)
    .eq("status", "approved")
    .eq("publication_platforms.platform", "tg")
    .gte("publish_at", fromIso)
    .lte("publish_at", toIso)
    .is("deleted_at", null);

  if (e1) {
    console.error("Query candidates failed:", e1);
    return { ok: false, enqueued: 0, error: e1.message };
  }

  if (!candidates || candidates.length === 0) {
    return { ok: true, enqueued: 0, window: { from: fromIso, to: toIso } };
  }

  let enqueued = 0;
  const skipped: string[] = [];
  for (const p of candidates) {
    const { data: existing } = await supabase
      .from("tg_autopost_queue")
      .select("id, status")
      .eq("publication_id", p.id)
      .in("status", ["pending", "processing", "done"])
      .maybeSingle();

    if (existing) {
      skipped.push(`${p.id}:${existing.status}`);
      continue;
    }

    const { error: insErr } = await supabase
      .from("tg_autopost_queue")
      .insert({
        publication_id: p.id,
        status: "pending",
        target_chat_id: TARGET_TG_CHAT_ID,
      });

    if (insErr) {
      console.warn(`Insert failed for ${p.id}:`, insErr);
      skipped.push(`${p.id}:err:${insErr.message}`);
      continue;
    }

    await supabase
      .from("publications")
      .update({ autopost_status: "pending", autopost_error: null })
      .eq("id", p.id);

    enqueued++;
  }

  return {
    ok: true,
    enqueued,
    skipped,
    candidates: candidates.length,
    target_chat: TARGET_TG_CHAT_ID,
    window: { from: fromIso, to: toIso, now: nowIso },
  };
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
