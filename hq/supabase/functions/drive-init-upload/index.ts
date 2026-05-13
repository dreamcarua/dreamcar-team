// =====================================================================
// DreamCar HQ — Drive Init Upload
// =====================================================================
// Створює Google Drive resumable upload session.
// Клієнт викликає цю функцію з { name, mime, size, parent? }, отримує
// `uploadUrl` куди надсилає файл chunk-ами напряму у Drive (8MB chunks).
//
// Авторизація: JWT від Service Account → access token → Drive API.
//
// Конфіг (Edge Functions → Secrets):
//   GDRIVE_SA_JSON      — JSON Service Account (як рядок)
//   GDRIVE_FOLDER_ID    — id папки у Drive куди писати
//   HQ_DB_URL           — Supabase URL
//   HQ_DB_SERVICE_KEY   — service_role JWT (для перевірки auth юзера)
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { create as createJwt, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const SA_JSON   = Deno.env.get("GDRIVE_SA_JSON")   ?? "";
const FOLDER_ID = Deno.env.get("GDRIVE_FOLDER_ID") ?? "";
const SB_URL    = Deno.env.get("SUPABASE_URL")     ?? Deno.env.get("HQ_DB_URL") ?? "";
const SB_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

interface SAJson {
  client_email: string;
  private_key: string;
}

let _accessToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_accessToken && _accessToken.exp > now + 60) return _accessToken.token;

  let sa: SAJson;
  try { sa = JSON.parse(SA_JSON); }
  catch { throw new Error("GDRIVE_SA_JSON parse fail"); }

  // Convert PEM private key → CryptoKey
  const pem = sa.private_key.replace(/\\n/g, "\n");
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = pem.replace(pemHeader, "").replace(pemFooter, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const jwt = await createJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/drive",
      aud: "https://oauth2.googleapis.com/token",
      iat: getNumericDate(0),
      exp: getNumericDate(3600),
    },
    cryptoKey
  );

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`OAuth token fail ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  _accessToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return _accessToken.token;
}

async function checkAuth(req: Request): Promise<{ ok: boolean; userId?: string }> {
  // Перевіряємо, що клієнт залогінений у Supabase
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return { ok: false };
  const jwt = authHeader.slice(7);
  if (!SB_URL || !SB_KEY) return { ok: false };
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) return { ok: false };
  return { ok: true, userId: data.user.id };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  // 1. Auth check
  const auth = await checkAuth(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // 2. Parse input
  let body: { name?: string; mime?: string; size?: number; parent?: string };
  try { body = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400, headers: CORS_HEADERS }); }
  const { name, mime, size, parent } = body || {};
  if (!name || !mime || !size) {
    return new Response(JSON.stringify({ error: "name/mime/size required" }), {
      status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  if (size > 10 * 1024 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: "File too big (>10GB)" }), {
      status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!SA_JSON || !FOLDER_ID) {
    return new Response(JSON.stringify({ error: "Drive not configured (missing GDRIVE_SA_JSON or GDRIVE_FOLDER_ID)" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const accessToken = await getAccessToken();
    // 3. Створюємо resumable upload session
    const initResp = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mime,
          "X-Upload-Content-Length": String(size),
        },
        body: JSON.stringify({
          name,
          parents: [parent || FOLDER_ID],
        }),
      }
    );
    if (!initResp.ok) {
      const t = await initResp.text();
      throw new Error(`Drive init fail ${initResp.status}: ${t}`);
    }
    const uploadUrl = initResp.headers.get("location");
    if (!uploadUrl) throw new Error("No Location header from Drive");

    return new Response(JSON.stringify({
      uploadUrl,        // куди клієнт буде слати PUT-чанки
      maxChunkSize: 8 * 1024 * 1024, // 8 MB
      mime,
      name,
      size,
    }), {
      status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("drive-init error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
