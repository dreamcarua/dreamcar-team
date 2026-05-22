// =====================================================================
// DreamCar HQ — autopost-tg-enqueue (Cron 5хв)
// =====================================================================
// Знаходить approved публікації з platform=tg, publish_at у межах ±10хв
// → додає у tg_autopost_queue для обробки GitHub Action worker-ом.
//
// Target chat (тестовий!): -1003933841573 (DreamCar SMM)
// Production канал: -1002496656144 — НЕ використовуємо допоки не
// відпрацюємо нюанси. Перемикати тільки після ручного схвалення Вадима.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  ?? Deno.env.get("HQ_DB_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";
const CRON_SECRET   = Deno.env.get("HQ_CRON_SECRET") ?? "";

// #141/#143: тестовий канал (DreamCar SMM група) — поки не повний production
const TARGET_TG_CHAT_ID = Deno.env.get("DCSMM_TG_CHANNEL") || "-1003933841573";

async function run(supabase: ReturnType<typeof createClient>) {
  const nowIso = new Date().toISOString();
  // Окно: pubs, чий publish_at у межах -2хв ... +10хв від зараз
  // (-2хв) — щоб одразу підхопити «прострочені на пару хв» approved пости
  // (+10хв) — наступний cron-tick через 5хв все одно ловитиме нові
  const fromIso = new Date(Date.now() - 2 * 60000).toISOString();
  const toIso = new Date(Date.now() + 10 * 60000).toISOString();

  // 1) Шукаємо approved pubs з TG-platform у вікні
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

  // 2) Для кожного — пропускаємо ті що вже у queue (active або done)
  let enqueued = 0;
  const skipped: string[] = [];
  for (const p of candidates) {
    // Перевіряємо чи цей pub вже у queue з active-статусом
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

    // Insert у queue
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

    // Mark pub
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

  if (CRON_SECRET) {
    const got = req.headers.get("x-hq-cron-secret");
    const urlSec = new URL(req.url).searchParams.get("secret");
    if (got !== CRON_SECRET && urlSec !== CRON_SECRET) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response("Missing config", { status: 500 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const result = await run(supabase);
    return new Response(JSON.stringify({ ...result, version: "v1-#143" }), {
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
