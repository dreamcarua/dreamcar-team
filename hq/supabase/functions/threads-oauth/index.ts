// threads-oauth — OAuth-калбек Threads API: ловить ?code, міняє на long-lived токен (60 днів) і кладе в app_secrets.
// Режими: GET ?code=…&state=… (калбек браузера) · GET/POST ?refresh=1 + x-hq-cron-secret (тижневий крон-рефреш)
// Секрети в app_secrets: threads_app_id, threads_app_secret, threads_oauth_state (одноразовий) → пише: threads_access_token, threads_user_id, threads_token_updated_at

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("HQ_CRON_SECRET") ?? "";
const JH = { "Content-Type": "application/json" };

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`sb ${path.split("?")[0]} ${r.status}`);
  return t ? JSON.parse(t) : null;
}
const getSecret = async (key: string): Promise<string> => ((await sb(`app_secrets?key=eq.${encodeURIComponent(key)}&select=value`))?.[0]?.value || "");
async function putSecret(key: string, value: string) {
  await sb("app_secrets?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key, value }) });
}
const html = (title: string, body: string, code = 200) =>
  new Response(`<!doctype html><html><body style="font-family:system-ui;max-width:560px;margin:80px auto;padding:0 20px"><h2>${title}</h2><p>${body}</p></body></html>`, { status: code, headers: { "content-type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  const u = new URL(req.url);
  try {
    // ===== режим крон-рефрешу (токен має бути старший 24 год, вікно 60 днів) =====
    if (u.searchParams.get("refresh") === "1") {
      if (!CRON_SECRET || req.headers.get("x-hq-cron-secret") !== CRON_SECRET) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: JH });
      const tok = await getSecret("threads_access_token");
      if (!tok) return new Response(JSON.stringify({ error: "no threads token yet" }), { status: 400, headers: JH });
      const r = await fetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(tok)}`);
      const j = await r.json().catch(() => ({}));
      if (!j.access_token) return new Response(JSON.stringify({ error: "refresh failed", detail: JSON.stringify(j).slice(0, 250) }), { status: 502, headers: JH });
      await putSecret("threads_access_token", j.access_token);
      await putSecret("threads_token_updated_at", new Date().toISOString());
      return new Response(JSON.stringify({ ok: true, expires_in_days: Math.round((j.expires_in || 0) / 86400) }), { status: 200, headers: JH });
    }

    // ===== OAuth-калбек =====
    const err = u.searchParams.get("error");
    if (err) return html("❌ Доступ не надано", `Threads повернув: ${err}. Спробуй лінк ще раз.`, 400);
    const code = u.searchParams.get("code");
    if (!code) return html("Це службовий калбек", "Немає ?code — відкрий лінк авторизації, який надіслав Клод.", 400);
    const wantState = await getSecret("threads_oauth_state");
    if (!wantState || u.searchParams.get("state") !== wantState) return html("❌ state mismatch", "Лінк застарів або вже використаний — попроси в Клода новий.", 403);
    const appId = await getSecret("threads_app_id");
    const appSecret = await getSecret("threads_app_secret");
    if (!appId || !appSecret) return html("⚙️ Ще не готово", "threads_app_id / threads_app_secret ще не в app_secrets.", 500);

    const redirect = `${SB_URL}/functions/v1/threads-oauth`;
    const r1 = await fetch("https://graph.threads.net/oauth/access_token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: "authorization_code", redirect_uri: redirect, code }),
    });
    const j1 = await r1.json().catch(() => ({}));
    if (!j1.access_token) return html("❌ Обмін коду не вдався", `Відповідь: ${JSON.stringify(j1).slice(0, 250)}`, 502);

    const r2 = await fetch(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(j1.access_token)}`);
    const j2 = await r2.json().catch(() => ({}));
    const longTok = j2.access_token || j1.access_token;

    await putSecret("threads_access_token", longTok);
    await putSecret("threads_user_id", String(j1.user_id || ""));
    await putSecret("threads_token_updated_at", new Date().toISOString());
    await putSecret("threads_oauth_state", ""); // одноразовий
    return html("✅ Threads підключено", `Токен збережено (${j2.access_token ? "60 днів, авто-оновлення кроном" : "короткий — Клод перевірить"}). Вкладку можна закривати.`);
  } catch (e) {
    console.error("threads-oauth:", e);
    return html("❌ Внутрішня помилка", String(e).slice(0, 200), 500);
  }
});
