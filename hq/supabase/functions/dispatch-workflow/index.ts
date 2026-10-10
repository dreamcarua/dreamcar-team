// =====================================================================
// Supabase Edge Function: dispatch-workflow
// =====================================================================
// Викликає GitHub Actions workflow_dispatch миттєво замість чекати cron.
//
// POST /functions/v1/dispatch-workflow
// Body: { workflow: 'compress' | 'autopost', inputs?: object }
// Auth (з 10.10.2026): JWT активного користувача HQ, Bearer service_role або x-hq-cron-secret; anon не приймається
// Returns: { ok: true, workflow, dispatched_at }
//
// Secrets needed (Supabase Dashboard → Edge Functions → Secrets):
//   GH_DISPATCH_TOKEN  — GitHub Personal Access Token з repo + workflow scope
//   GH_OWNER           — 'dreamcarua' (default)
//   GH_REPO            — 'dreamcar-team' (default)
//
// Як отримати GH_DISPATCH_TOKEN:
//   1. https://github.com/settings/tokens/new
//   2. Note: "DreamCar HQ workflow dispatch"
//   3. Expiration: No expiration (або 1 year)
//   4. Scopes: ✅ repo + ✅ workflow
//   5. Generate → копіюй ghp_XXXX
//   6. Supabase → Edge Functions → Secrets → New secret: GH_DISPATCH_TOKEN=ghp_XXXX
// =====================================================================

// deno-lint-ignore-file no-explicit-any
const WORKFLOW_FILES: Record<string, string> = {
  compress: "compress-creative.yml",
  autopost: "tg-autopost.yml",
};

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = [
    "https://dreamcarua.github.io",
    "https://dreamcar.ua",
    "http://localhost:8000",
    "http://localhost:3000",
    "http://localhost:5173",
  ];
  const ok = origin && allowed.includes(origin) ? origin : "https://dreamcarua.github.io";
  return {
    "access-control-allow-origin": ok,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function jsonResp(body: any, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
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
// Перевірка JWT користувача HQ: токен валідний у Supabase Auth (GET /auth/v1/user)
// і користувач активний у public.users (auth_id, user_auth_aliases через resolve_user_by_auth,
// а також users.auth_id_aliases). anon-ключ і прострочені токени не проходять.
async function isActiveHqUser(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization") || "";
  const jwt = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const url = Deno.env.get("SUPABASE_URL") || Deno.env.get("SB_URL") || "";
  const key = authServiceKeys()[0] || "";
  if (!jwt || !url || !key) return false;
  try {
    const ur = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${jwt}` } });
    if (!ur.ok) return false;
    const uid = String((await ur.json())?.id || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid)) return false;
    const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
    const rr = await fetch(`${url}/rest/v1/rpc/resolve_user_by_auth`, { method: "POST", headers: h, body: JSON.stringify({ p_auth_id: uid }) });
    if (rr.ok) {
      const rows = await rr.json();
      if (Array.isArray(rows) && rows.some((r: any) => r?.is_active === true)) return true;
    }
    const ar = await fetch(`${url}/rest/v1/users?select=id&is_active=eq.true&auth_id_aliases=cs.%7B${uid}%7D&limit=1`, { headers: h });
    if (ar.ok) {
      const rows = await ar.json();
      if (Array.isArray(rows) && rows.length > 0) return true;
    }
  } catch (e) { console.error("[auth] user check failed", (e as Error)?.message); }
  return false;
}

// ---- /auth ----

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "POST only" }, 405, origin);
  }

  // 10.10.2026 аудит B9: раніше пропускав будь-який "Bearer x". Тепер дозволено:
  //  1) JWT активного користувача HQ (фронт app-dispatch-hooks.js);
  //  2) Bearer service_role (compress-creative-worker.sh, HQ_DB_SERVICE_KEY);
  //  3) x-hq-cron-secret / x-cron-secret (тригер trg_dispatch_compress_on_video після міграції 058).
  const cronDenied = await requireCronAuth(req, { allowServiceBearer: true });
  if (cronDenied && !(await isActiveHqUser(req))) {
    return jsonResp({ ok: false, error: "unauthorized" }, 401, origin);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResp({ error: "invalid json" }, 400, origin);
  }

  const wf = String(body.workflow || "");
  const inputs = body.inputs || {};

  if (!wf || !(wf in WORKFLOW_FILES)) {
    return jsonResp({
      error: `workflow must be one of: ${Object.keys(WORKFLOW_FILES).join(", ")}`,
    }, 400, origin);
  }

  const ghToken = Deno.env.get("GH_DISPATCH_TOKEN");
  const ghOwner = Deno.env.get("GH_OWNER") || "dreamcarua";
  const ghRepo = Deno.env.get("GH_REPO") || "dreamcar-team";

  if (!ghToken) {
    return jsonResp({ error: "GH_DISPATCH_TOKEN secret not configured" }, 500, origin);
  }

  const file = WORKFLOW_FILES[wf];
  const url = `https://api.github.com/repos/${ghOwner}/${ghRepo}/actions/workflows/${file}/dispatches`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ghToken}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main", inputs }),
  });

  if (!r.ok) {
    const errBody = await r.text();
    return jsonResp({
      error: `GitHub API ${r.status}`,
      detail: errBody.slice(0, 500),
    }, 502, origin);
  }

  return jsonResp({
    ok: true,
    workflow: wf,
    file,
    dispatched_at: new Date().toISOString(),
  }, 200, origin);
});
