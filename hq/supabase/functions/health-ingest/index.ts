// health-ingest — receiver for Apple Health data.
// Accepts TWO payload shapes:
//   A) Health Auto Export:  { data: { metrics: [ {name, units, data:[{date, qty}]} ] } }
//   B) Apple Shortcuts flat: { measured_at?: ISO, source?: str,
//                              samples: { "<code>": <number>, ... }  OR
//                              samples: [ {code|metric, value, measured_at?}, ... ] }
// Auth: header `Authorization: Bearer <token>` or `x-ingest-token: <token>`
//       matched against health.ingest_tokens. Writes into health.measurements.
// Deployed with --no-verify-jwt (own token auth).

import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

// Health Auto Export metric name -> [catalog code, category]
const MAP: Record<string, [string, string]> = {
  resting_heart_rate: ["resting_hr", "cardio"],
  heart_rate_variability: ["hrv_ms", "cardio"],
  walking_heart_rate_average: ["walking_hr", "cardio"],
  step_count: ["steps", "activity"],
  apple_exercise_time: ["exercise_min", "activity"],
  active_energy: ["active_energy_kcal", "activity"],
  basal_energy_burned: ["basal_energy_kcal", "activity"],
  weight_body_mass: ["weight_kg", "body"],
  body_mass_index: ["bmi", "body"],
  body_fat_percentage: ["body_fat_pct", "body"],
  lean_body_mass: ["lean_mass_kg", "body"],
  waist_circumference: ["waist_cm", "body"],
  blood_pressure_systolic: ["bp_systolic", "cardio"],
  blood_pressure_diastolic: ["bp_diastolic", "cardio"],
  blood_oxygen_saturation: ["spo2", "cardio"],
  vo2_max: ["vo2max", "cardio"],
  respiratory_rate: ["respiratory_rate", "vitals"],
  body_temperature: ["body_temp_c", "vitals"],
  blood_glucose: ["glucose_fasting", "metabolic"],
};

function codeFor(name: string): [string, string] {
  if (MAP[name]) return MAP[name];
  return ["ah_" + name, "apple_health"];
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function pickValue(name: string, p: Record<string, unknown>): number | null {
  let v: unknown;
  if (name === "sleep_analysis") v = p.totalSleep ?? p.asleep ?? p.qty;
  else if (name === "blood_pressure") v = p.qty;
  else v = p.qty ?? p.Avg ?? p.avg ?? p.value;
  return toNum(v);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "content-type": "application/json" } });
  }

  const auth = req.headers.get("authorization") || "";
  const token = (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "").trim()
    || (req.headers.get("x-ingest-token") || "").trim();
  if (!token) {
    return new Response(JSON.stringify({ error: "missing token" }), { status: 401, headers: { "content-type": "application/json" } });
  }

  const dbUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!dbUrl) {
    return new Response(JSON.stringify({ error: "SUPABASE_DB_URL not set" }), { status: 500, headers: { "content-type": "application/json" } });
  }

  let body: any;
  try { body = await req.json(); } catch { body = null; }

  const client = new Client(dbUrl);
  try {
    await client.connect();

    const tok = await client.queryObject<{ token: string }>`
      select token from health.ingest_tokens where token = ${token} and active limit 1`;
    if (tok.rows.length === 0) {
      return new Response(JSON.stringify({ error: "invalid token" }), { status: 401, headers: { "content-type": "application/json" } });
    }

    const seenCodes = new Set<string>();
    let inserted = 0;
    const ensureCode = async (code: string, name: string, category: string, unit: string | null) => {
      if (seenCodes.has(code)) return;
      await client.queryArray`
        insert into health.metric_catalog (code, name_uk, category, unit)
        values (${code}, ${name}, ${category}, ${unit})
        on conflict (code) do nothing`;
      seenCodes.add(code);
    };
    const insertMeas = async (code: string, when: string, val: number, source: string, meta: unknown) => {
      const res = await client.queryArray`
        insert into health.measurements (metric_code, measured_at, value, unit, source, meta)
        values (${code}, ${when}::timestamptz, ${val},
                (select unit from health.metric_catalog where code = ${code}),
                ${source}, ${JSON.stringify(meta ?? {})}::jsonb)
        on conflict (metric_code, measured_at, source) do nothing`;
      inserted += res.rowCount ?? 0;
    };

    const metrics: any[] = body?.data?.metrics ?? body?.metrics ?? [];
    const flat = body?.samples;

    if (Array.isArray(metrics) && metrics.length) {
      // --- Shape A: Health Auto Export ---
      for (const m of metrics) {
        const name: string = m?.name;
        if (!name) continue;
        const [code, category] = codeFor(name);
        const unit: string | null = m?.units ?? null;
        await ensureCode(code, name, category, unit);
        for (const p of (m?.data ?? [])) {
          const when = p?.date ?? p?.timestamp ?? p?.startDate;
          const val = pickValue(name, p);
          if (when && val !== null) await insertMeas(code, when, val, "apple_health", p);
        }
      }
    } else if (flat) {
      // --- Shape B: Shortcuts flat ---
      const source = String(body?.source ?? "shortcuts");
      const defaultWhen = String(body?.measured_at ?? new Date().toISOString());
      const entries: Array<[string, unknown, string]> = [];
      if (Array.isArray(flat)) {
        for (const e of flat) {
          const code = e?.code ?? e?.metric;
          if (code) entries.push([String(code), e?.value ?? e?.qty, String(e?.measured_at ?? defaultWhen)]);
        }
      } else if (typeof flat === "object") {
        for (const [k, v] of Object.entries(flat)) entries.push([k, v, defaultWhen]);
      }
      for (const [code, raw, when] of entries) {
        const val = toNum(raw);
        if (val === null) continue;
        await ensureCode(code, code, "apple_health", null);
        await insertMeas(code, when, val, source, { code, value: val });
      }
    } else {
      return new Response(JSON.stringify({ error: "no metrics or samples in body" }), { status: 400, headers: { "content-type": "application/json" } });
    }

    await client.queryArray`update health.ingest_tokens set last_used = now() where token = ${token}`;

    return new Response(JSON.stringify({ ok: true, inserted }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  } finally {
    try { await client.end(); } catch { /* noop */ }
  }
});
