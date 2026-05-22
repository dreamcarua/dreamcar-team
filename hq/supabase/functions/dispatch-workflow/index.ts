// =====================================================================
// Supabase Edge Function: dispatch-workflow
// =====================================================================
// Викликає GitHub Actions workflow_dispatch миттєво замість чекати cron.
//
// POST /functions/v1/dispatch-workflow
// Body: { workflow: 'compress' | 'autopost', inputs?: object }
// Auth: Bearer <Supabase JWT (anon or service)>
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

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResp({ error: "POST only" }, 405, origin);
  }

  // Soft auth: будь-який Bearer допустимий (рівень захисту = service key для DB calls)
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResp({ error: "missing bearer token" }, 401, origin);
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
