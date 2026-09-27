// =====================================================================
// media-batch-notify (27.09.2026, v2) — ПОГОДИННИЙ ДАЙДЖЕСТ нових медіа
// у Бібліотеці → TG-група Медіа. ОДНЕ повідомлення на годину, що покриває
// і пачки (drag-drop), і одиничні додавання «+». Економно: 1 легка вибірка
// на годину, максимум одне повідомлення. Stateless (вікно за часом).
// Викликається pg_cron (x-hq-cron-secret) — НЕ з фронта.
// =====================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const TG_BOT_TOKEN     = Deno.env.get("TG_BOT_TOKEN") ?? "";
const MEDIA_CHAT_ID    = Deno.env.get("DCMEDIA_GROUP_CHAT_ID") || "-1003912295530";
const SUPABASE_URL     = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const HQ_CRON_SECRET   = Deno.env.get("HQ_CRON_SECRET") ?? "";
const HQ_BASE          = "https://dreamcarua.github.io/dreamcar-team/hq/";

function cors(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type, x-hq-cron-secret, x-cron-secret",
  };
}
function json(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: { ...cors(), "content-type": "application/json" } });
}
function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function plural(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "новий матеріал";
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return "нові матеріали";
  return "нових матеріалів";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // ---- Auth: лише cron / service (x-hq-cron-secret або Bearer service role) ----
  const got =
    req.headers.get("x-hq-cron-secret") ||
    req.headers.get("x-cron-secret") ||
    (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!HQ_CRON_SECRET && !SERVICE_ROLE_KEY) return json({ error: "not configured" }, 500);
  if (got !== HQ_CRON_SECRET && got !== SERVICE_ROLE_KEY) return json({ error: "unauthorized" }, 401);

  let body: { window_minutes?: number } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const win = Math.min(1440, Math.max(5, parseInt(String(body.window_minutes ?? 60), 10) || 60));

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: "missing config" }, 500);
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const sinceIso = new Date(Date.now() - win * 60000).toISOString();
  const { data: cre, error } = await sb
    .from("creatives")
    .select("name, uploaded_by")
    .is("deleted_at", null)
    .gt("uploaded_at", sinceIso);
  if (error) return json({ error: "query failed", detail: error.message }, 500);

  const list = (cre || []) as Array<{ name: string; uploaded_by: string | null }>;
  const count = list.length;
  if (count === 0) return json({ ok: true, count: 0, sent: false }, 200);

  // імена завантажувачів для розбивки «по людях»
  const ids = [...new Set(list.map((c) => c.uploaded_by).filter(Boolean))] as string[];
  const nameById: Record<string, string> = {};
  if (ids.length) {
    const { data: us } = await sb.from("users").select("id, name").in("id", ids);
    (us || []).forEach((u: { id: string; name: string }) => { nameById[u.id] = u.name; });
  }
  const byUser: Record<string, number> = {};
  for (const c of list) {
    const n = (c.uploaded_by && nameById[c.uploaded_by]) || "—";
    byUser[n] = (byUser[n] || 0) + 1;
  }
  const userLines = Object.entries(byUser)
    .sort((a, b) => b[1] - a[1])
    .map(([n, k]) => `• ${esc(n)}: ${k}`)
    .join("\n");

  if (!TG_BOT_TOKEN) return json({ ok: true, count, sent: false, reason: "no_token" }, 200);

  const text =
    `📥 <b>Медіа: +${count} ${plural(count)}</b> у Бібліотеці за годину` +
    `\n${userLines}` +
    `\n🔗 <a href="${HQ_BASE}#library">Відкрити Бібліотеку</a>`;

  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: MEDIA_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const ok = r.ok;
    return json({ ok, count, sent: ok, tg_status: r.status, tg_error: ok ? undefined : await r.text() }, 200);
  } catch (e) {
    return json({ ok: false, count, sent: false, error: String((e as Error).message || e) }, 200);
  }
});
