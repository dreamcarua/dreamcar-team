// sendpulse-subscribers-sync — тягне підписників TG-бота з SendPulse (READ) у bot_subscribers.
// Vira 29.07.2026. SendPulse READ-ONLY: тільки GET (oauth + bots + chats). Жодних записів у SP.
//
// Params:
//   ?probe=1   — діагностика: список ботів + перша сторінка чатів (сирі поля, щоб бачити де chat_id). Відкрито.
//   ?bot_id=X  — обмежити конкретним ботом
//   ?limit=N   — обмежити (тест)
//   (sync)     — upsert у bot_subscribers. Потребує x-hq-cron-secret.
//
// Auth SendPulse: SENDPULSE_API_ID / SENDPULSE_API_SECRET (Edge env).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SP_ID = Deno.env.get("SENDPULSE_API_ID") || "";
const SP_SECRET = Deno.env.get("SENDPULSE_API_SECRET") || "";
const CRON = Deno.env.get("DC_CRON_SECRET") ?? Deno.env.get("HQ_CRON_SECRET") ?? "";
const SP = "https://api.sendpulse.com";

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function spToken(): Promise<string> {
  const r = await fetch(`${SP}/oauth/access_token`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: SP_ID, client_secret: SP_SECRET }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("SendPulse auth failed: " + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}
async function spGet(path: string, token: string): Promise<any> {
  const r = await fetch(`${SP}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return await r.json();
}

// Витягти TG chat_id з об'єкта чату SendPulse.
// Форма: row.contact.telegram_id = справжній TG chat_id; row.contact.id = SP contact-id (НЕ chat_id).
function extractChat(c: any): { chat_id: string | null; username?: string; first_name?: string; last_name?: string; sp_id?: string; lang?: string; banned?: boolean } {
  const ct = c.contact || c;
  const cd = ct.channel_data || {};
  const chat_id = ct.telegram_id ?? cd.id ?? cd.user_id ?? c.telegram_id ?? null;
  return {
    chat_id: chat_id != null ? String(chat_id) : null,
    username: cd.username || ct.username,
    first_name: cd.first_name || cd.name || ct.first_name,
    last_name: cd.last_name || ct.last_name,
    lang: cd.language_code || cd.lang,
    sp_id: ct.id ? String(ct.id) : undefined,
    banned: ct.is_banned === true,
  };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const probe = url.searchParams.get("probe") === "1";
  const botIdParam = url.searchParams.get("bot_id");
  const limit = parseInt(url.searchParams.get("limit") || "0", 10) || 0;
  const got = req.headers.get("x-hq-cron-secret") || url.searchParams.get("secret");
  const authed = CRON ? got === CRON : true;

  if (!SP_ID || !SP_SECRET) return new Response(JSON.stringify({ ok: false, error: "SENDPULSE_API_ID/SECRET не задані в Edge env" }), { status: 400 });

  try {
    const token = await spToken();
    const botsResp = await spGet("/telegram/bots", token);
    const bots = Array.isArray(botsResp?.data) ? botsResp.data : (Array.isArray(botsResp) ? botsResp : []);

    // === PROBE: показати сирі поля ===
    if (probe) {
      const firstBot = botIdParam || bots[0]?.id || bots[0]?.bot_id;
      let chatsRaw: any = null;
      if (firstBot) chatsRaw = await spGet(`/telegram/chats?bot_id=${firstBot}&size=3&skip=0`, token);
      const sample = Array.isArray(chatsRaw?.data) ? chatsRaw.data.slice(0, 3) : chatsRaw;
      return new Response(JSON.stringify({
        ok: true, mode: "probe",
        bots: bots.map((b: any) => ({ id: b.id ?? b.bot_id, name: b.name || b.channel_data?.name || b.bot_name, keys: Object.keys(b) })),
        first_bot: firstBot,
        chats_sample: sample,
        extracted: (Array.isArray(sample) ? sample : []).map((c: any) => extractChat(c)),
      }, null, 2), { headers: { "content-type": "application/json" } });
    }

    // === SYNC (потребує секрет). Відновлюваний: ?skip=<start> ?pages=<max за виклик> ===
    if (!authed) return new Response(JSON.stringify({ ok: false, error: "sync потребує x-hq-cron-secret" }), { status: 401 });

    const bid = botIdParam || bots[0]?.id || bots[0]?.bot_id;
    if (!bid) return new Response(JSON.stringify({ ok: false, error: "бота не знайдено" }), { status: 404 });
    const size = 200;
    const maxPages = parseInt(url.searchParams.get("pages") || "0", 10) || 0; // 0 = до кінця
    let skip = parseInt(url.searchParams.get("skip") || "0", 10) || 0;
    let upserted = 0, skipped = 0, seen = 0, pagesDone = 0, done = false;

    while (true) {
      const resp = await spGet(`/telegram/chats?bot_id=${bid}&size=${size}&skip=${skip}`, token);
      const rows = Array.isArray(resp?.data) ? resp.data : [];
      if (!rows.length) { done = true; break; }
      const batch: any[] = [];
      for (const c of rows) {
        seen++;
        const e = extractChat(c);
        if (!e.chat_id) { skipped++; continue; }
        batch.push({
          chat_id: e.chat_id, username: e.username || null, first_name: e.first_name || null,
          last_name: e.last_name || null, lang: e.lang || null, sp_contact_id: e.sp_id || null,
          source: "sendpulse", is_active: !e.banned, raw: c, updated_at: new Date().toISOString(),
        });
      }
      if (batch.length) {
        const { error } = await sb.from("bot_subscribers").upsert(batch, { onConflict: "chat_id" });
        if (error) return new Response(JSON.stringify({ ok: false, error: error.message, at: `skip ${skip}` }), { status: 500 });
        upserted += batch.length;
      }
      skip += size; pagesDone++;
      if (rows.length < size) { done = true; break; }
      if (limit && seen >= limit) { done = true; break; }
      if (maxPages && pagesDone >= maxPages) { done = false; break; }
    }
    return new Response(JSON.stringify({ ok: true, mode: "sync", seen, upserted, skipped_no_chatid: skipped, next_skip: done ? null : skip, done }, null, 2), { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), { status: 500 });
  }
});
