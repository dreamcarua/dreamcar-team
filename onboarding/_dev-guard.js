/* Dev-only guard for /onboarding/* hub.
   Запускається ПІСЛЯ auth-guard. Якщо юзер не CEO/COO/lead — overlay з redirect на /onboarding.html.
   Доступ дозволено: ceo, coo, lead. Заборонено: member, designer (надсилаємо їх на user-facing).
*/
(async function() {
  if (window.__devGuard) return;
  window.__devGuard = true;

  // Чекаємо поки auth-guard завершить session check
  let attempts = 0;
  while (attempts < 60 && !window.__dcAuth) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  if (!window.__dcAuth || !window.__dcAuth.user) {
    return; // Auth-guard сам показує login overlay
  }

  try {
    const cfg = window.HQ_CONFIG || {};
    const SB_URL = cfg.SUPABASE_URL;
    const SB_KEY = cfg.SUPABASE_ANON_KEY;
    const token = window.__dcAuth.session?.access_token;
    if (!SB_URL || !token) return;

    const r = await fetch(`${SB_URL}/rest/v1/users?select=role&auth_id=eq.${window.__dcAuth.user.id}&limit=1`, {
      headers: {
        'apikey': SB_KEY,
        'Authorization': `Bearer ${token}`,
      }
    });
    if (!r.ok) return;
    const data = await r.json();
    const role = data[0]?.role;
    const ADMIN_ROLES = ['ceo', 'coo', 'lead'];
    if (ADMIN_ROLES.includes(role)) return; // OK

    // Не admin → overlay + redirect через 4 сек
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(10,10,10,0.97); backdrop-filter: blur(14px);
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 22px; padding: 24px;
      font-family: 'Manrope', sans-serif; color: #fff; text-align: center;
    `;
    overlay.innerHTML = `
      <div style="background:#141414;border:1px solid #2A2A2A;border-radius:12px;padding:36px 32px;max-width:480px;">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#E30613;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:14px;">/// DEV-ONLY РОЗДІЛ</div>
        <h2 style="font-family:'Oswald',sans-serif;font-size:24px;text-transform:uppercase;margin-bottom:14px;">Цей розділ — для адмінів</h2>
        <p style="font-size:14px;color:#aaa;line-height:1.7;margin-bottom:20px;">Тут описані технічні деталі систем — архітектура, SQL, troubleshooting. Для користувацького гайду перейди у <b>/onboarding.html</b>.</p>
        <a href="/onboarding.html" style="display:inline-block;background:#E30613;color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:700;font-size:14px;">Перейти на онбординг →</a>
        <div style="margin-top:16px;font-family:'JetBrains Mono',monospace;font-size:10px;color:#555;">Автоматичний redirect за 4 сек…</div>
      </div>
    `;
    document.body.appendChild(overlay);
    setTimeout(() => { window.location.href = '/onboarding.html'; }, 4000);
  } catch (e) { /* fail-silent */ }
})();
