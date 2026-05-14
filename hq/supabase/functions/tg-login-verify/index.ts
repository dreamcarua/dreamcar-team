// =====================================================================
// DreamCar HQ — Telegram Login Widget Verifier v2
// =====================================================================
// Mapping:
//   1. Шукаємо public.users.tg_chat_id == TG user.id
//   2. Якщо знайшли → set deterministic password для existing auth_id
//      та signin його email — це той самий профіль що Google-login.
//   3. Якщо не знайшли → 403 з підказкою спочатку привʼязати бот у Settings.
//
// Secrets: TG_BOT_TOKEN, TG_LOGIN_SALT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//          SUPABASE_ANON_KEY (або HQ_DB_* alias-и).
//
// BotFather: /setdomain → @<bot> → dreamcarua.github.io
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN  = Deno.env.get("TG_BOT_TOKEN")  ?? "";
const LOGIN_SALT    = Deno.env.get("TG_LOGIN_SALT") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  ?? Deno.env.get("HQ_DB_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("HQ_DB_ANON_KEY") ?? "";

const AUTH_MAX_AGE_SEC = 60 * 60 * 24;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const input = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}
async function hmacSha256(keyBytes: Uint8Array, message: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

async function verifyTelegramAuth(user: TgUser): Promise<boolean> {
  if (!user.hash) return false;
  const { hash, ...rest } = user;
  const keys = Object.keys(rest).filter(k => (rest as Record<string, unknown>)[k] !== undefined).sort();
  const dataCheckString = keys.map(k => `${k}=${(rest as Record<string, unknown>)[k]}`).join("\n");
  const secretKey = await sha256(TG_BOT_TOKEN);
  const calc = await hmacSha256(secretKey, dataCheckString);
  return bytesToHex(calc) === hash;
}

async function derivePassword(tgId: number): Promise<string> {
  const key = new TextEncoder().encode(LOGIN_SALT || "fallback_salt_change_me");
  const sig = await hmacSha256(key, `tg:${tgId}`);
  return bytesToHex(sig).slice(0, 40);
}

function errResp(status: number, error: string, hint?: string) {
  return new Response(JSON.stringify({ ok: false, error, hint }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  if (!TG_BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return errResp(500, "Server misconfigured: missing secrets",
      "Перевір TG_BOT_TOKEN, TG_LOGIN_SALT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY у Edge Function Secrets.");
  }

  let body: TgUser;
  try { body = await req.json(); }
  catch { return errResp(400, "Invalid JSON"); }

  if (!body || !body.id || !body.auth_date || !body.hash) {
    return errResp(400, "Missing fields", "TG widget має повернути id, auth_date, hash");
  }

  // 1. Verify hash
  const valid = await verifyTelegramAuth(body);
  if (!valid) return errResp(403, "Hash mismatch — auth rejected",
    "Перевір TG_BOT_TOKEN відповідає боту що генерує widget; також /setdomain dreamcarua.github.io у @BotFather");

  // 2. Auth_date freshness
  const now = Math.floor(Date.now() / 1000);
  if (now - body.auth_date > AUTH_MAX_AGE_SEC) {
    return errResp(403, "auth_date too old (>1 day) — натисни кнопку ще раз");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const fullName = [body.first_name, body.last_name].filter(Boolean).join(" ") || (body.username || "");
  const password = await derivePassword(body.id);

  // 3. Шукаємо public.users з tg_chat_id == TG user.id
  const { data: existingUser, error: lookupErr } = await admin
    .from("users")
    .select("id, auth_id, email, name")
    .eq("tg_chat_id", body.id)
    .maybeSingle();

  if (lookupErr) {
    return errResp(500, "DB lookup failed: " + lookupErr.message);
  }

  if (existingUser && existingUser.auth_id && existingUser.email) {
    // ✓ Existing user — реактивуємо його auth.user
    // (а) Set deterministic password на існуючому auth_id
    const upd = await admin.auth.admin.updateUserById(existingUser.auth_id, {
      password,
      user_metadata: {
        tg_id: body.id,
        tg_username: body.username || null,
        photo_url: body.photo_url || null,
        last_tg_login: new Date().toISOString(),
      },
    });
    if (upd.error) {
      return errResp(500, "updateUserById failed: " + upd.error.message);
    }
    // (б) signin цим email + password
    const signIn = await userClient.auth.signInWithPassword({
      email: existingUser.email, password,
    });
    if (signIn.error) {
      return errResp(500, "signin failed: " + signIn.error.message);
    }
    // (в) Оновити tg_username (chat_id вже є)
    try {
      await admin.from("users").update({
        tg_username: body.username || null,
      }).eq("id", existingUser.id);
    } catch (e) { console.warn("update tg_username failed:", e); }

    const session = signIn.data.session!;
    return new Response(JSON.stringify({
      ok: true,
      mapped: true,
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      user: { id: existingUser.id, email: existingUser.email, name: existingUser.name, tg_id: body.id },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // 4. Не знайдено — відмова з підказкою
  return errResp(403,
    "TG-акаунт не привʼязаний до жодного юзера HQ",
    "Спочатку зайди через Google login у HQ, потім у Settings → 'Привʼязати через @dreamcar_team_bot'. Після цього TG-login буде працювати.",
  );
});
