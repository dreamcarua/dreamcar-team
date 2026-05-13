// =====================================================================
// DreamCar HQ — Telegram Login Widget Verifier
// =====================================================================
// Тікет #27 з ТЗ.
//
// Telegram Login Widget на фронті отримує об'єкт юзера з hash, який
// підписаний ботом. Тут ми:
//   1. Валідовуємо hash через HMAC-SHA256(SHA256(BOT_TOKEN), data_check_string)
//   2. Перевіряємо що auth_date свіжий (< 1 день)
//   3. Знаходимо/створюємо auth.user по email `tg_<id>@dreamcar.team`
//      з детермінованим паролем = HMAC(TG_LOGIN_SALT, tg_id)
//   4. Логінимо й повертаємо access_token + refresh_token для фронта.
//
// Secrets (Settings → Edge Functions → Manage):
//   TG_BOT_TOKEN              (той самий, що для notify-tg)
//   TG_LOGIN_SALT             (випадковий 32+ char секрет, для пароля)
//   HQ_DB_URL / SUPABASE_URL
//   HQ_DB_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_ANON_KEY         (для signInWithPassword)
//
// Settings (на функції):
//   Verify JWT з legacy secret = OFF
//
// BotFather config (одноразово):
//   /setdomain → @dreamcar_team_bot → dreamcarua.github.io
//
// Frontend config.js:
//   TG_LOGIN_BOT: 'dreamcar_team_bot'
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const TG_BOT_TOKEN  = Deno.env.get("TG_BOT_TOKEN")  ?? "";
const LOGIN_SALT    = Deno.env.get("TG_LOGIN_SALT") ?? "";
const SUPABASE_URL  = Deno.env.get("SUPABASE_URL")  ?? Deno.env.get("HQ_DB_URL") ?? "";
const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("HQ_DB_SERVICE_KEY") ?? "";
const ANON_KEY      = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("HQ_DB_ANON_KEY") ?? "";

const AUTH_MAX_AGE_SEC = 60 * 60 * 24;  // 1 day

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
    "raw", keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

/**
 * Telegram Login Widget verification.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
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
  // detеrministic, але непередбачувано без LOGIN_SALT
  const key = new TextEncoder().encode(LOGIN_SALT || "fallback_salt_change_me");
  const sig = await hmacSha256(key, `tg:${tgId}`);
  // 40-char hex is plenty for password strength
  return bytesToHex(sig).slice(0, 40);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  if (!TG_BOT_TOKEN || !SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured: missing secrets" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: TgUser;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400, headers: corsHeaders });
  }
  if (!body || !body.id || !body.auth_date || !body.hash) {
    return new Response("Missing fields", { status: 400, headers: corsHeaders });
  }

  // 1. Verify hash
  const valid = await verifyTelegramAuth(body);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Hash mismatch — auth rejected" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Verify auth_date freshness
  const now = Math.floor(Date.now() / 1000);
  if (now - body.auth_date > AUTH_MAX_AGE_SEC) {
    return new Response(JSON.stringify({ error: "auth_date too old (>1 day)" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Find or create auth.user
  const email = `tg_${body.id}@dreamcar.team`;
  const password = await derivePassword(body.id);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // Try sign-in first (existing user with same password)
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const fullName = [body.first_name, body.last_name].filter(Boolean).join(" ") || (body.username || "");
  const userMetadata = {
    tg_id: body.id,
    tg_username: body.username || null,
    photo_url: body.photo_url || null,
    first_name: body.first_name || null,
    last_name: body.last_name || null,
    full_name: fullName,
    source: "tg_login",
  };

  let signIn = await userClient.auth.signInWithPassword({ email, password });

  if (signIn.error) {
    // Likely user doesn't exist — create
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (created.error) {
      return new Response(JSON.stringify({ error: "createUser failed: " + created.error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Try sign-in again
    signIn = await userClient.auth.signInWithPassword({ email, password });
    if (signIn.error) {
      return new Response(JSON.stringify({ error: "post-create signIn failed: " + signIn.error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else {
    // Existing user — refresh metadata silently
    try {
      const authUserId = signIn.data.user?.id;
      if (authUserId) {
        await admin.auth.admin.updateUserById(authUserId, { user_metadata: userMetadata });
      }
    } catch (e) { console.warn("update metadata failed:", e); }
  }

  // 4. Update public.users (best-effort, тригер handle_new_user уже міг створити)
  try {
    const authUserId = signIn.data.user!.id;
    await admin.from("users").upsert({
      auth_id: authUserId,
      name: fullName,
      email: email,
      tg_chat_id: body.id,
      tg_username: body.username || null,
    }, { onConflict: "auth_id" });
  } catch (e) {
    console.warn("public.users upsert failed (non-fatal):", e);
  }

  const session = signIn.data.session;
  if (!session) {
    return new Response(JSON.stringify({ error: "no session after sign-in" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    user: { email, tg_id: body.id, full_name: fullName },
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
