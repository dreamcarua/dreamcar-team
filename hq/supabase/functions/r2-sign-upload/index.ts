// Supabase Edge Function: r2-sign-upload
// Endpoint: POST /functions/v1/r2-sign-upload
// Body: { name: string, size: number, mime: string, type: 'photo'|'video'|'doc'|'audio' }
// Auth: Bearer <JWT> (any valid Supabase token — anon or user)
// Returns: { uploadUrl, publicUrl, objectKey, expiresIn }

// deno-lint-ignore-file no-explicit-any

async function hmacRaw(keyBytes: Uint8Array, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}
async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function toHex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
function dateStamp(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${da}`;
}
function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

async function signR2PutUrl(opts: {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  objectKey: string;
  contentType: string;
  expiresInSec: number;
}): Promise<string> {
  const host = `${opts.accountId}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";
  const now = new Date();
  const amz = amzDate(now);
  const ds = dateStamp(now);
  const credentialScope = `${ds}/${region}/${service}/aws4_request`;
  const credential = `${opts.accessKeyId}/${credentialScope}`;

  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amz,
    "X-Amz-Expires": String(opts.expiresInSec),
    "X-Amz-SignedHeaders": "host",
  });

  const canonicalUri = "/" + opts.bucket + "/" + opts.objectKey.split("/").map(encodeURIComponent).join("/");
  const canonicalQuery = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmacRaw(new TextEncoder().encode("AWS4" + opts.secretAccessKey), ds);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  const kSigning = await hmacRaw(kService, "aws4_request");
  const signature = toHex(await hmacRaw(kSigning, stringToSign));

  const finalQuery = canonicalQuery + "&X-Amz-Signature=" + signature;
  return `https://${host}${canonicalUri}?${finalQuery}`;
}

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = [
    "https://dreamcarua.github.io",
    "https://dreamcar.ua",
    "http://localhost:8000",
    "http://localhost:3000",
    "http://localhost:5173",
  ];
  const ok = origin && allowed.includes(origin) ? origin : "*";
  return {
    "access-control-allow-origin": ok,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function uuidV4(): string {
  return crypto.randomUUID();
}

function safeExt(name: string): string {
  const m = /\.([a-zA-Z0-9]{1,8})$/.exec(name);
  return m ? m[1].toLowerCase() : "bin";
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405, headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  }
  // #audit Phase 4: top-level try/catch — раніше signR2PutUrl() throw → unhandled crash
  try {

  // Soft auth: just require Authorization header presence.
  // Real signature verification is delegated to Supabase Gateway (Verify JWT toggle).
  // Prototype phase — R2 quota is 10GB Free, object keys are random UUIDs.
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "missing bearer" }), {
      status: 401, headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "invalid json" }), {
    status: 400, headers: { "content-type": "application/json", ...corsHeaders(origin) },
  }); }

  const name = String(body.name || "");
  const size = Number(body.size || 0);
  const mime = String(body.mime || "application/octet-stream");
  const type = String(body.type || "doc");

  if (!name || size <= 0) {
    return new Response(JSON.stringify({ error: "name and size required" }), {
      status: 400, headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  }
  const MAX = 5 * 1024 * 1024 * 1024;
  if (size > MAX) {
    return new Response(JSON.stringify({ error: `size > ${MAX}` }), {
      status: 400, headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  }

  const accountId = Deno.env.get("R2_ACCOUNT_ID")!;
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID")!;
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
  const bucket = Deno.env.get("R2_BUCKET") || "dreamcar-creatives";
  const publicBase = Deno.env.get("R2_PUBLIC_BASE")!;

  if (!accountId || !accessKeyId || !secretAccessKey || !publicBase) {
    return new Response(JSON.stringify({ error: "R2 env not configured" }), {
      status: 500, headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  }

  const ext = safeExt(name);
  const objectKey = `${type}/${Date.now()}_${uuidV4()}.${ext}`;
  const expiresInSec = 60 * 30;

  const uploadUrl = await signR2PutUrl({
    accountId, accessKeyId, secretAccessKey,
    bucket, objectKey, contentType: mime, expiresInSec,
  });

  const publicUrl = `${publicBase.replace(/\/$/, "")}/${objectKey}`;

  return new Response(JSON.stringify({
    uploadUrl,
    publicUrl,
    objectKey,
    expiresIn: expiresInSec,
    bucket,
  }), {
    status: 200,
    headers: { "content-type": "application/json", ...corsHeaders(origin) },
  });
  } catch (e: any) {
    // #audit Phase 4: catch для signR2PutUrl() / unexpected errors
    console.error("[r2-sign-upload ERR]", e?.message || e);
    return new Response(JSON.stringify({ error: "internal", detail: String(e?.message || e).slice(0, 200) }), {
      status: 500, headers: { "content-type": "application/json", ...corsHeaders(origin) },
    });
  }
});
