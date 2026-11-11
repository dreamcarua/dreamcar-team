// Supabase Edge Function: compress-node (DreamCar HQ) · 11.11.2026
//
// Вузький шлюз для зовнішнього вузла стиснення відео (Mac Studio, launchd ua.dreamcar.compress-node).
// На вузлі НЕМАЄ service-ключа бази і ключів R2: лише токен, sha256 якого лежить у
// app_secrets.compress_node_secret_sha256. Шлюз пропускає тільки те, що робить compress-creative-worker.sh:
//
//   POST  /compress-node/rest/v1/rpc/peek_compress_jobs | claim_compress_jobs | complete_compress_job | fail_compress_job
//   PATCH /compress-node/rest/v1/creatives?id=eq.<uuid>        лише колонки з PATCH_COLUMNS
//   GET   /compress-node/rest/v1/creatives?id=eq.<uuid>&select=compressed_status
//   POST  /compress-node/functions/v1/dispatch-workflow        лише {"workflow":"autopost"}
//   POST  /compress-node/r2-sign  {"key","mime"}               presigned PUT у R2, лише video-compressed*/ і video-poster/
//
// Токен передається так само, як воркер передає service-ключ: apikey: <token> і Authorization: Bearer <token>.
// Деплой з --no-verify-jwt (токен не JWT). Fail-closed: немає еталонного хеша → 500, не збігся → 401.
// deno-lint-ignore-file no-explicit-any

const RPCS = new Set(["peek_compress_jobs", "claim_compress_jobs", "complete_compress_job", "fail_compress_job"]);
const PATCH_COLUMNS = new Set([
  "compress_progress", "is_hdr", "poster_url", "width_px", "height_px", "duration_sec",
  "compressed_url_hevc", "compressed_hevc_size_bytes",
]);
const R2_PREFIXES = ["video-compressed/", "video-compressed-hevc/", "video-poster/"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 204/205/304 не можуть мати тіла: complete/fail_compress_job повертають void → PostgREST 204.
const pass = async (r: Response) => {
  const t = await r.text();
  return new Response([204, 205, 304].includes(r.status) ? null : t, { status: r.status, headers: { "content-type": "application/json" } });
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---- R2 presign (SigV4, як у r2-sign-upload) ----
async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
}
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
async function presignPut(objectKey: string, expires: number): Promise<string> {
  const accountId = Deno.env.get("R2_ACCOUNT_ID") || "";
  const accessKey = Deno.env.get("R2_ACCESS_KEY_ID") || "";
  const secretKey = Deno.env.get("R2_SECRET_ACCESS_KEY") || "";
  const bucket = Deno.env.get("R2_BUCKET") || "dreamcar-creatives";
  if (!accountId || !accessKey || !secretKey) throw new Error("R2 env missing");
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amz = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ds = amz.slice(0, 8);
  const scope = `${ds}/auto/s3/aws4_request`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKey}/${scope}`,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": "host",
  });
  const uri = "/" + bucket + "/" + objectKey.split("/").map(encodeURIComponent).join("/");
  const query = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  const canonical = ["PUT", uri, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amz, scope, hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))))].join("\n");
  let k = await hmac(new TextEncoder().encode("AWS4" + secretKey), ds);
  k = await hmac(k, "auto"); k = await hmac(k, "s3"); k = await hmac(k, "aws4_request");
  return `https://${host}${uri}?${query}&X-Amz-Signature=${hex(await hmac(k, toSign))}`;
}

Deno.serve(async (req) => {
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sh = { apikey: key, Authorization: `Bearer ${key}` };

    // ---- auth (fail-closed) ----
    const auth = req.headers.get("authorization") || "";
    const token = (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : req.headers.get("apikey") || "").trim();
    const sr = await fetch(`${url}/rest/v1/app_secrets?select=value&key=eq.compress_node_secret_sha256`, { headers: sh });
    const want = sr.ok ? String((await sr.json())?.[0]?.value || "") : "";
    if (!want) return json(500, { error: "not configured" });
    if (token.length < 32 || !safeEq(await sha256Hex(token), want)) return json(401, { error: "unauthorized" });

    const u = new URL(req.url);
    const path = u.pathname.replace(/^.*?\/compress-node/, "");

    // ---- RPC ----
    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path);
    if (rpc && req.method === "POST") {
      if (!RPCS.has(rpc[1])) return json(403, { error: "rpc not allowed" });
      const body = await req.text();
      const r = await fetch(`${url}/rest/v1/rpc/${rpc[1]}`, {
        method: "POST", headers: { ...sh, "content-type": "application/json" }, body: body || "{}",
      });
      return pass(r);
    }

    // ---- creatives row ----
    if (path === "/rest/v1/creatives") {
      const idf = u.searchParams.get("id") || "";
      const id = idf.startsWith("eq.") ? idf.slice(3) : "";
      if (!UUID.test(id)) return json(400, { error: "id=eq.<uuid> required" });
      if (req.method === "GET") {
        if ((u.searchParams.get("select") || "") !== "compressed_status") return json(403, { error: "select not allowed" });
        const r = await fetch(`${url}/rest/v1/creatives?id=eq.${id}&select=compressed_status`, { headers: sh });
        return pass(r);
      }
      if (req.method === "PATCH") {
        let body: any;
        try { body = await req.json(); } catch { return json(400, { error: "invalid json" }); }
        if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "object required" });
        for (const k of Object.keys(body)) if (!PATCH_COLUMNS.has(k)) return json(403, { error: `column ${k} not allowed` });
        // лише рядок, який зараз у роботі
        const r = await fetch(`${url}/rest/v1/creatives?id=eq.${id}&compressed_status=in.(processing,ready)`, {
          method: "PATCH", headers: { ...sh, "content-type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(body),
        });
        return new Response(null, { status: r.status === 204 ? 204 : r.status });
      }
      return json(405, { error: "method not allowed" });
    }

    // ---- autopost dispatch ----
    if (path === "/functions/v1/dispatch-workflow" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.workflow !== "autopost") return json(403, { error: "only autopost" });
      const r = await fetch(`${url}/functions/v1/dispatch-workflow`, {
        method: "POST", headers: { ...sh, "content-type": "application/json" }, body: JSON.stringify({ workflow: "autopost" }),
      });
      return pass(r);
    }

    // ---- R2 presign ----
    if (path === "/r2-sign" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const objectKey = String(body?.key || "");
      if (!R2_PREFIXES.some((p) => objectKey.startsWith(p)) || !/^[a-z-]+\/[0-9a-f-]{36}\.(mp4|jpg)$/.test(objectKey)) {
        return json(403, { error: "key not allowed" });
      }
      const base = (Deno.env.get("R2_PUBLIC_BASE") || "").replace(/\/$/, "");
      return json(200, { url: await presignPut(objectKey, 1800), public_url: `${base}/${objectKey}` });
    }

    console.warn("[compress-node] no route", req.method, u.pathname);
    return json(404, { error: "not found", path });
  } catch (e: any) {
    console.error("[compress-node]", e?.message || e);
    return json(500, { error: "internal" });
  }
});
