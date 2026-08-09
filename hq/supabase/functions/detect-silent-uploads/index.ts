// =====================================================================
// Supabase Edge Function: detect-silent-uploads
// =====================================================================
// Моніторить orphan-файли у Storage (файл завантажено але creative INSERT
// не пройшов — як з Davyd 29.05). Шле alert у TG CEO якщо знайде.
//
// POST /functions/v1/detect-silent-uploads
// Body: { hours?: number (default 24), alert_threshold?: number (default 1) }
// Auth: Bearer hq-cron-secret OR service role
// =====================================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

// 08.08.2026 (аудит): був захардкоджений у публічному git → ротовано, тільки env.
const HQ_CRON_SECRET = Deno.env.get("HQ_CRON_SECRET") ?? "";

function cors(): HeadersInit {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
  };
}
function json(body: any, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { "content-type": "application/json", ...cors() } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (token !== HQ_CRON_SECRET && token !== serviceKey) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const hours = Number(body.hours) || 24;
  const threshold = Number(body.alert_threshold) || 1;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Виклик RPC
  const { data: failures, error } = await sb.rpc("detect_silent_upload_failures", { p_max_age_hours: hours });
  if (error) return json({ error: "rpc failed", detail: error.message }, 500);

  const list = (failures || []) as Array<{
    storage_name: string;
    uploader_auth_id: string | null;
    uploader_name: string | null;
    size_kb: number;
    age_hours: number;
    storage_created_at: string;
  }>;

  if (list.length < threshold) {
    return json({ ok: true, found: list.length, alert_sent: false, reason: "below_threshold" });
  }

  // Готую TG alert
  const TG_BOT_TOKEN = Deno.env.get("TG_BOT_TOKEN")!;
  if (!TG_BOT_TOKEN) {
    return json({ ok: true, found: list.length, alert_sent: false, reason: "no_TG_BOT_TOKEN" });
  }

  // CEO chat_id
  const { data: ceo } = await sb
    .from("users")
    .select("tg_chat_id")
    .eq("role", "ceo")
    .not("tg_chat_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (!ceo?.tg_chat_id) {
    return json({ ok: true, found: list.length, alert_sent: false, reason: "no_CEO_tg_chat_id" });
  }

  const totalMb = (list.reduce((s, f) => s + (f.size_kb || 0), 0) / 1024).toFixed(1);
  const byUser = list.reduce<Record<string, number>>((acc, f) => {
    const name = f.uploader_name || "unknown";
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});

  const userLines = Object.entries(byUser)
    .map(([n, c]) => `• ${n}: ${c}`)
    .join("\n");

  const sample = list.slice(0, 3)
    .map(f => `  └ ${f.storage_name} (${(f.size_kb / 1024).toFixed(1)}MB, ${f.age_hours}h ago)`)
    .join("\n");

  const text =
    `🔴 <b>Silent upload failures: ${list.length}</b>\n\n` +
    `Файли є у Storage, але creative INSERT не пройшов (RLS / network / SW cache).\n\n` +
    `<b>Сумарно:</b> ${totalMb} MB · за ${hours}h\n\n` +
    `<b>По юзерах:</b>\n${userLines}\n\n` +
    `<b>Перші 3:</b>\n<code>${sample}</code>\n\n` +
    `Дія: попроси юзерів зробити hard refresh (Cmd+Shift+R) — SW кеш має оновитись на v16.\n` +
    `Cleanup orphan-файлів: <code>POST /functions/v1/cleanup-storage-orphans</code> з <code>{dry_run:false}</code>`;

  const tgResp = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: String(ceo.tg_chat_id),
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  return json({
    ok: true,
    found: list.length,
    alert_sent: tgResp.ok,
    tg_status: tgResp.status,
    sample: list.slice(0, 5),
  });
});
