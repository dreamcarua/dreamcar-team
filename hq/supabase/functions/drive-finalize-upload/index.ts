// =====================================================================
// DreamCar HQ — Drive Finalize Upload
// =====================================================================
// Викликається ПІСЛЯ того, як клієнт завершив upload у resumable session.
// Що робить:
//   1. Робить файл публічним (permissions: role=reader, type=anyone)
//   2. Створює запис у public.creatives
//   3. Повертає frontend-у { creative: {id, url, ...} }
//
// Вхід: { driveFileId, name, mime, size, type? }
// Auth: Authorization: Bearer <user_jwt>
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { create as createJwt, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const SA_JSON   = Deno.env.get("GDRIVE_SA_JSON")   ?? "";
const SB_URL    = Deno.env.get("SUPABASE_URL")     ?? Deno.env.get("HQ_DB_URL") ?? "";
const SB_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

interface SAJson { client_email: string; private_key: string; }

let _accessToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_accessToken && _accessToken.exp > now + 60) return _accessToken.token;

  let sa: SAJson;
  try { sa = JSON.parse(SA_JSON); }
  catch { throw new Error("GDRIVE_SA_JSON parse fail"); }

  const pem = sa.private_key.replace(/\\n/g, "\n");
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
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
  if (!resp.ok) throw new Error(`OAuth fail ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  _accessToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return _accessToken.token;
}

async function getAuthUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const jwt = authHeader.slice(7);
  if (!SB_URL || !SB_KEY) return null;
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user.id;
}

function inferType(mime: string): string {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "doc";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });

  const authUid = await getAuthUserId(req);
  if (!authUid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body: { driveFileId?: string; name?: string; mime?: string; size?: number; type?: string };
  try { body = await req.json(); }
  catch { return new Response("Bad JSON", { status: 400, headers: CORS_HEADERS }); }
  const { driveFileId, name, mime, size, type } = body || {};
  if (!driveFileId || !name || !mime || !size) {
    return new Response(JSON.stringify({ error: "driveFileId/name/mime/size required" }), {
      status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!SA_JSON) {
    return new Response(JSON.stringify({ error: "GDRIVE_SA_JSON missing" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  if (!SB_URL || !SB_KEY) {
    return new Response(JSON.stringify({ error: "DB config missing" }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  try {
    const accessToken = await getAccessToken();

    // 1. Зробити файл публічним (читання — будь-кому з посиланням)
    const permResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "reader", type: "anyone" }),
      }
    );
    if (!permResp.ok) {
      console.warn("perm set fail", permResp.status, await permResp.text());
      // не критично — продовжуємо
    }

    // 2. Підтягнути thumbnailLink і webContentLink для прев'ю
    const metaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${driveFileId}?fields=id,name,mimeType,size,thumbnailLink,webContentLink,webViewLink&supportsAllDrives=true`,
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );
    const meta = metaResp.ok ? await metaResp.json() : {};

    // Direct download link (для <img>/<video>): https://drive.google.com/uc?export=view&id=<FILE_ID>
    // Це працює для публічних файлів.
    const directUrl = `https://drive.google.com/uc?export=view&id=${driveFileId}`;
    const thumbUrl = meta.thumbnailLink || directUrl;

    // 3. Створити запис у creatives
    const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
    // Знайти user у public.users за auth_id (бо creatives.uploaded_by → users.id)
    const { data: dbUser } = await sb.from("users").select("id").eq("auth_id", authUid).maybeSingle();
    const uploadedBy = dbUser?.id ?? null;

    const creativeType = type || inferType(mime);
    const insertPayload: Record<string, unknown> = {
      desk_id: "11111111-1111-1111-1111-111111111111",
      name,
      type: creativeType,
      size_bytes: size,
      drive_file_id: driveFileId,
      thumbnail_url: thumbUrl,
      tags: [],
      uploaded_by: uploadedBy,
    };
    const { data: creative, error: insErr } = await sb
      .from("creatives").insert(insertPayload).select().single();

    if (insErr) {
      console.error("creative insert fail", insErr);
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      creative: {
        id: creative.id,
        name: creative.name,
        type: creative.type,
        size_bytes: creative.size_bytes,
        url: directUrl,
        thumbnail_url: thumbUrl,
        drive_file_id: driveFileId,
        webViewLink: meta.webViewLink,
      },
    }), { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("drive-finalize error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
