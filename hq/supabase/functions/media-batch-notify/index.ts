// =====================================================================
// media-batch-notify (27.09.2026) — ОДНЕ сповіщення на ПАЧКУ завантажень
// у Бібліотеку Медіа → окрема TG-група Медіа (не спам по кожному файлу).
// Викликається з фронта (app-bulk-upload.js bulkUpload) після завершення
// пачки через supabase.functions.invoke — з JWT користувача.
// Auth: verify_jwt=false на gateway (CI --no-verify-jwt) → валідуємо JWT самі.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TG_BOT_TOKEN     = Deno.env.get("TG_BOT_TOKEN") ?? "";
// chat_id групи Медіа (бот уже в ній). Дефолт можна перекрити env DCMEDIA_GROUP_CHAT_ID.
const MEDIA_CHAT_ID    = Deno.env.get("DCMEDIA_GROUP_CHAT_ID") || "-1003912295530";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_BASE          = "https://dreamcarua.github.io/dreamcar-team/hq/";

const ALLOWED_ORIGINS = [
  "https://dreamcarua.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
];
function cors(origin: string | null): HeadersInit {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
}
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function json(obj: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors(origin), "content-type": "application/json" } });
}
function plural(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "новий матеріал";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "нові матеріали";
  return "нових матеріалів";
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: cors(origin) });

  // ---- Auth: валідний Supabase JWT користувача HQ ----
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "no token" }, 401, origin);
  if (!SUPABASE_URL || !ANON_KEY) return json({ error: "missing config" }, 500, origin);

  let uname = "";
  try {
    const sb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user) return json({ error: "unauthorized" }, 401, origin);
    // імʼя завантажувача (для тексту) — через service role, за auth_id
    if (SERVICE_ROLE_KEY) {
      const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const { data: u } = await svc.from("users").select("name").eq("auth_id", data.user.id).maybeSingle();
      uname = (u as { name?: string } | null)?.name || "";
    }
  } catch (_e) {
    return json({ error: "auth failed" }, 401, origin);
  }

  let body: { count?: number; uploader?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const count = Math.max(0, parseInt(String(body.count ?? 0), 10) || 0);
  const uploader = String(body.uploader || uname || "").slice(0, 60);
  if (count <= 0) return json({ ok: true, skipped: "count=0" }, 200, origin);

  if (!TG_BOT_TOKEN) return json({ error: "no bot token" }, 500, origin);

  const text =
    `📥 <b>Медіа: ${count} ${plural(count)}</b> у Бібліотеці` +
    (uploader ? `\nЗавантажив: <b>${esc(uploader)}</b>` : "") +
    `\n🔗 <a href="${HQ_BASE}#library">Відкрити Бібліотеку</a>`;

  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: MEDIA_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const ok = r.ok;
    const errText = ok ? undefined : await r.text();
    return json({ ok, tg_status: r.status, tg_error: errText }, 200, origin);
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 200, origin);
  }
});
