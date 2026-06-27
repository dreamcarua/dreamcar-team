// health-ingest — receiver for Apple Health data.
// Accepts THREE payload shapes:
//   A) Health Auto Export:  { data: { metrics: [ {name, units, data:[{date, qty}]} ] } }
//   B) Shortcuts wrapped:   { measured_at?, source?, samples: {code:value} | [{code,value,measured_at?}] }
//   C) Shortcuts bare dict:  { "resting_hr": 58, "steps": 8423, ... }  (optional measured_at/source keys)
// Auth: header `Authorization: Bearer <token>` or `x-ingest-token: <token>`.
// Writes via PostgREST RPC public.hi_ingest_batch (SECURITY DEFINER) — no direct PG connection,
// so it returns fast and avoids cold-start timeouts. Deployed with --no-verify-jwt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const RESERVED = new Set(["measured_at", "source", "samples", "data", "metrics"]);

// Health Auto Export metric name -> catalog code
const MAP: Record<string, string> = {
  resting_heart_rate: "resting_hr",
  heart_rate_variability: "hrv_ms",
  walking_heart_rate_average: "walking_hr",
  heart_rate: "heart_rate",
  step_count: "steps",
  apple_exercise_time: "exercise_min",
  active_energy: "active_energy_kcal",
  basal_energy_burned: "basal_energy_kcal",
  weight_body_mass: "weight_kg",
  body_mass_index: "bmi",
  body_fat_percentage: "body_fat_pct",
  lean_body_mass: "lean_mass_kg",
  waist_circumference: "waist_cm",
  blood_pressure_systolic: "bp_systolic",
  blood_pressure_diastolic: "bp_diastolic",
  blood_oxygen_saturation: "spo2",
  vo2_max: "vo2max",
  respiratory_rate: "respiratory_rate",
  body_temperature: "body_temp_c",
  blood_glucose: "glucose_fasting",
  sleep_analysis: "sleep_hours",
};

const codeFor = (name: string): string => MAP[name] ?? ("ah_" + name);

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function pickValue(name: string, p: Record<string, unknown>): number | null {
  let v: unknown;
  if (name === "sleep_analysis") v = p.totalSleep ?? p.asleep ?? p.qty;
  else v = p.qty ?? p.Avg ?? p.avg ?? p.value;
  return toNum(v);
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "").trim()
    || (req.headers.get("x-ingest-token") || "").trim();
  if (!token) return json({ error: "missing token" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "service env not set" }, 500);

  let body: any;
  try { body = await req.json(); } catch { body = null; }
  if (!body || typeof body !== "object") return json({ error: "empty body" }, 400);

  // Build a uniform items array: { code, value, measured_at?, meta? }
  const items: Array<Record<string, unknown>> = [];
  let source = "shortcuts";
  const metrics: any[] = body?.data?.metrics ?? body?.metrics ?? [];

  if (Array.isArray(metrics) && metrics.length) {
    source = "apple_health";
    for (const m of metrics) {
      const name: string = m?.name;
      if (!name) continue;
      const code = codeFor(name);
      for (const p of (m?.data ?? [])) {
        const when = p?.date ?? p?.timestamp ?? p?.startDate;
        const val = pickValue(name, p);
        if (val !== null) items.push({ code, value: val, measured_at: when ?? null, meta: p });
      }
    }
  } else {
    source = String(body?.source ?? "shortcuts");
    const defaultWhen = body?.measured_at ?? null;
    const flat = body?.samples;
    const push = (code: string, raw: unknown, when: unknown) => {
      const val = toNum(raw);
      if (val !== null && code) items.push({ code, value: val, measured_at: when ?? defaultWhen, meta: { code, value: val } });
    };
    if (Array.isArray(flat)) {
      for (const e of flat) push(String(e?.code ?? e?.metric ?? ""), e?.value ?? e?.qty, e?.measured_at);
    } else if (flat && typeof flat === "object") {
      for (const [k, v] of Object.entries(flat)) push(k, v, undefined);
    } else {
      for (const [k, v] of Object.entries(body)) if (!RESERVED.has(k)) push(k, v, undefined);
    }
  }

  if (!items.length) return json({ error: "no recognizable samples in body" }, 400);

  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("hi_ingest_batch", { p_token: token, p_source: source, p_items: items });

  if (error) {
    const invalid = (error.code === "28000") || /invalid_token/i.test(error.message || "");
    return json({ error: invalid ? "invalid token" : (error.message || "rpc error") }, invalid ? 401 : 500);
  }

  return json({ ok: true, inserted: data ?? 0, received: items.length });
});
