// daily-morning-runner v3 (10.10.2026) — оркестратор ранкових задач (cron 1427, 09:05 Kyiv).
// v2: виправлені slugs (були hq-* але fn називаються daily-*); 16.06.2026 — обхід pg_cron startup timeout.
// v3 (аудит B9/B10): код у git; прибрано захардкоджений FALLBACK_SECRET і приймання ПРЕФІКСА секрету;
//   ?dry=1 більше не обходить авторизацію; вхід — лише точний x-cron-secret / x-hq-cron-secret
//   (env HQ_CRON_SECRET / DC_CRON_SECRET або app_secrets.hq_cron_secret), порівняння в сталий час.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Секрет для ВИХІДНИХ викликів: той самий env, що й у v2 (без захардкодженого fallback).
// Якщо env порожній — береться app_secrets.hq_cron_secret (див. outboundSecret()).
const ENV_CRON_SECRET = Deno.env.get("DC_CRON_SECRET") || Deno.env.get("CRON_SECRET") || Deno.env.get("HQ_CRON_SECRET") || "";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

function kyivDate(): string { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Kyiv' }); }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function outboundSecret(): Promise<string> {
  if (ENV_CRON_SECRET) return ENV_CRON_SECRET;
  const { data } = await sb.from('app_secrets').select('value').eq('key', 'hq_cron_secret').maybeSingle();
  return String(data?.value || '');
}

// Слуги відповідають реальним назвам Edge Functions.
function pipeline(secret: string): Array<{ slug: string; headers?: Record<string, string> }> {
  return [
    { slug: 'tg-personal-digest', headers: {} },
    { slug: 'tg-daily-task-scan', headers: { 'x-cron-secret': secret } },
    { slug: 'daily-personal-digest', headers: { 'x-cron-secret': secret, 'x-hq-cron-secret': secret } },
    { slug: 'daily-digest', headers: { 'x-cron-secret': secret, 'x-hq-cron-secret': secret } },
    { slug: 'daily-ai-analyst', headers: { 'x-cron-secret': secret } },
    { slug: 'daily-health-audit', headers: { 'x-cron-secret': secret } },
  ];
}

async function alreadyRanToday(slug: string, day: string): Promise<boolean> {
  const key = `morning_runner_${day}_${slug}`;
  const { data } = await sb.from('dashboard_settings').select('value').eq('key', key).maybeSingle();
  return !!data?.value;
}
async function markRanToday(slug: string, day: string, result: any): Promise<void> {
  const key = `morning_runner_${day}_${slug}`;
  await sb.from('dashboard_settings').upsert({ key, value: JSON.stringify({ ran_at: new Date().toISOString(), result }) }, { onConflict: 'key' });
}

async function callFn(slug: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: string }> {
  const url = `${SB_URL}/functions/v1/${slug}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SB_KEY}`, ...headers },
      body: JSON.stringify({ trigger: 'daily-morning-runner' }),
      signal: AbortSignal.timeout(150000),
    });
    const body = (await r.text()).slice(0, 400);
    return { ok: r.ok, status: r.status, body };
  } catch (e: any) {
    return { ok: false, status: 0, body: (e?.message || String(e)).slice(0, 400) };
  }
}

// ---- 10.10.2026 аудит B9: fail-closed авторизація серверних викликів ----
// Пропускає лише запит із заголовком x-cron-secret / x-hq-cron-secret, що ТОЧНО збігається
// з env HQ_CRON_SECRET / DC_CRON_SECRET або з public.app_secrets.hq_cron_secret.
// Немає жодного еталону — 500; немає збігу — 401. Порівняння в сталий час.
async function safeEqual(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < ua.length; i++) d |= ua[i] ^ ub[i];
  return d === 0;
}

// Усі варіанти service-ключа цього проєкту, які різні функції читають з env.
function authServiceKeys(): string[] {
  const out: string[] = [];
  for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "SB_SERVICE_ROLE_KEY", "HQ_DB_SERVICE_KEY", "SERVICE_ROLE_KEY"]) {
    const v = Deno.env.get(k) || "";
    if (v.length >= 32 && !out.includes(v)) out.push(v);
  }
  return out;
}

async function expectedCronSecrets(): Promise<string[]> {
  const out: string[] = [];
  for (const k of ["HQ_CRON_SECRET", "DC_CRON_SECRET"]) {
    const v = Deno.env.get(k) || "";
    if (v.length >= 32 && !out.includes(v)) out.push(v);
  }
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
  const key = authServiceKeys()[0] || "";
  if (url && key) {
    try {
      const r = await fetch(`${url}/rest/v1/app_secrets?key=eq.hq_cron_secret&select=value`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (r.ok) {
        const rows = await r.json();
        const v = String(rows?.[0]?.value || "");
        if (v.length >= 32 && !out.includes(v)) out.push(v);
      }
    } catch (e) { console.error("[auth] app_secrets lookup failed", (e as Error)?.message); }
  }
  return out;
}

// Повертає null, якщо дозволено, інакше готову відповідь 401/500.
// allowServiceBearer: також пускати Authorization: Bearer <service_role_key> (серверні виклики з інших edge).
// allowQuerySecret: також приймати ?secret= (сумісність зі старими ручними викликами).
async function requireCronAuth(
  req: Request,
  opts: { allowServiceBearer?: boolean; allowQuerySecret?: boolean; headers?: Record<string, string> } = {},
): Promise<Response | null> {
  const h = { ...(opts.headers || {}), "Content-Type": "application/json" };
  const deny = (error: string, status: number) => new Response(JSON.stringify({ ok: false, error }), { status, headers: h });
  const got: string[] = [];
  for (const n of ["x-cron-secret", "x-hq-cron-secret"]) { const v = req.headers.get(n); if (v) got.push(v); }
  if (opts.allowQuerySecret) { const q = new URL(req.url).searchParams.get("secret"); if (q) got.push(q); }
  const wants = await expectedCronSecrets();
  const svc = opts.allowServiceBearer ? authServiceKeys() : [];
  if (!wants.length && !svc.length) return deny("misconfigured: no cron secret", 500);
  let ok = false;
  for (const g of got) for (const w of wants) if (await safeEqual(g, w)) ok = true;
  if (!ok && svc.length) {
    const auth = req.headers.get("authorization") || "";
    const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
    for (const k of svc) if (await safeEqual(bearer, k)) ok = true;
  }
  return ok ? null : deny("unauthorized", 401);
}
// ---- /auth ----

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  const denied = await requireCronAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const dry = url.searchParams.get('dry') === '1';
  const force = url.searchParams.get('force') === '1';
  const onlyParam = url.searchParams.get('only');
  const only = onlyParam ? new Set(onlyParam.split(',').map(s => s.trim())) : null;

  const day = kyivDate();
  const results: Array<{ slug: string; skipped?: string; status?: number; ok?: boolean; body?: string }> = [];
  const PIPELINE = pipeline(await outboundSecret());

  for (const step of PIPELINE) {
    if (only && !only.has(step.slug)) continue;

    if (!force && await alreadyRanToday(step.slug, day)) {
      results.push({ slug: step.slug, skipped: 'already_ran_today' });
      continue;
    }

    if (dry) {
      results.push({ slug: step.slug, skipped: 'dry_mode' });
      continue;
    }

    const res = await callFn(step.slug, step.headers || {});
    results.push({ slug: step.slug, status: res.status, ok: res.ok, body: res.body });

    if (res.ok) {
      await markRanToday(step.slug, day, { status: res.status, body: res.body.slice(0, 200) });
    }

    await sleep(5000);
  }

  return new Response(JSON.stringify({
    ok: true, version: 'v3', day, dry, force, only: only ? [...only] : null,
    summary: {
      ran: results.filter(r => r.ok).length,
      skipped: results.filter(r => r.skipped).length,
      failed: results.filter(r => r.skipped == null && !r.ok).length,
    },
    results,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
