// tg-chat-audit (08.10.2026) — ЛИШЕ ЧИТАННЯ: getChat для кожного чату з tg_listening_chats
// (робочі чати технічного бота) і запис справжньої назви/типу/кількості учасників/живості.
// Нічого в чати не шле. Fail-closed: потрібен x-cron-secret = app_secrets.hq_cron_secret.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL") || "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TG = Deno.env.get("TG_BOT_TOKEN") || "";

Deno.serve(async (req) => {
  if (!SB_URL || !SB_KEY || !TG) return new Response(JSON.stringify({ error: "misconfigured" }), { status: 500 });
  const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "hq_cron_secret").maybeSingle();
  const want = (sec && (sec as any).value) || "";
  const got = req.headers.get("x-cron-secret") || "";
  if (!want || got !== want) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  const { data: chats, error } = await sb.from("tg_listening_chats").select("chat_id");
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const out: any[] = [];
  for (const c of chats || []) {
    const upd: any = { tg_checked_at: new Date().toISOString() };
    try {
      const r = await fetch(`https://api.telegram.org/bot${TG}/getChat?chat_id=${encodeURIComponent(String((c as any).chat_id))}`);
      const j = await r.json();
      if (j.ok) {
        upd.tg_alive = true; upd.tg_type = j.result.type; upd.tg_real_title = j.result.title || j.result.first_name || null; upd.tg_error = null;
        try {
          const m = await fetch(`https://api.telegram.org/bot${TG}/getChatMemberCount?chat_id=${encodeURIComponent(String((c as any).chat_id))}`);
          const mj = await m.json();
          if (mj.ok) upd.tg_members = mj.result;
        } catch (_) { /* ignore */ }
      } else {
        upd.tg_alive = false; upd.tg_error = String(j.description || r.status).slice(0, 200);
      }
    } catch (e) {
      upd.tg_alive = false; upd.tg_error = String((e as Error)?.message || e).slice(0, 200);
    }
    await sb.from("tg_listening_chats").update(upd).eq("chat_id", (c as any).chat_id);
    out.push({ alive: upd.tg_alive, type: upd.tg_type, title: upd.tg_real_title, members: upd.tg_members, err: upd.tg_error });
    await new Promise((r) => setTimeout(r, 60));
  }
  return new Response(JSON.stringify({ ok: true, checked: out.length, chats: out }), { headers: { "Content-Type": "application/json" } });
});
