// tg-notify-queue-flush v4 (10.10.2026) — розсилка черги public.tg_notify_queue у Telegram (cron 1417, */2 хв).
// v3 (16.06.2026): multi-env + захардкоджений fallback.
// v4 (аудит B9/B10): код у git; прибрано FALLBACK_SECRET і приймання ПРЕФІКСА секрету (≥16 символів);
//   ?dry=1 більше не віддає превʼю черги без авторизації. Вхід — лише точний x-cron-secret /
//   x-hq-cron-secret (env HQ_CRON_SECRET / DC_CRON_SECRET або app_secrets.hq_cron_secret), сталий час.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG_BOT_TOKEN = Deno.env.get("TG_BOT_TOKEN")!;

const MAX_BATCH = 50;
const MAX_ATTEMPTS = 3;

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function sendTg(row: any): Promise<{ ok: boolean; err?: string }> {
  const body: any = {
    chat_id: row.chat_id,
    text: row.text,
    parse_mode: row.parse_mode || 'HTML',
    disable_web_page_preview: row.disable_web_page_preview ?? true,
  };
  if (row.reply_markup) body.reply_markup = row.reply_markup;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return { ok: true };
    const txt = await r.text();
    return { ok: false, err: `${r.status}: ${txt.slice(0, 300)}` };
  } catch (e: any) {
    return { ok: false, err: (e?.message || String(e)).slice(0, 300) };
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

  try {
    const { data: rows, error } = await sb
      .from('tg_notify_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(MAX_BATCH);
    if (error) throw error;
    const list = rows || [];

    if (dry) {
      return new Response(JSON.stringify({
        ok: true,
        dry: true,
        version: 'v4',
        pending_count: list.length,
        preview: list.slice(0, 5).map((r: any) => ({ id: r.id, chat: r.chat_id, src: r.source, sched: r.scheduled_at, attempts: r.attempts })),
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    let sent = 0, failed = 0, skipped = 0;
    for (const row of list) {
      const res = await sendTg(row);
      if (res.ok) {
        await sb.from('tg_notify_queue').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', row.id);
        sent++;
      } else {
        const newAttempts = (row.attempts || 0) + 1;
        const newStatus = newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
        await sb.from('tg_notify_queue').update({ status: newStatus, attempts: newAttempts, last_error: res.err }).eq('id', row.id);
        if (newStatus === 'failed') failed++; else skipped++;
      }
      await new Promise(r => setTimeout(r, 50));
    }

    return new Response(JSON.stringify({ ok: true, version: 'v4', processed: list.length, sent, failed, skipped_retry: skipped }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[tg-queue-flush v4]', e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
});
