/* ===========================================================
   DreamCar Team Auth Guard v1
   Захищає сторінку через Supabase Auth — якщо немає сесії, показує overlay
   з CTA «Увійти через /hq». Поки немає сесії — контент схований.

   Підключення (один тег):
     <script src="/assets/auth-guard.js" defer></script>

   ВАЖЛИВО: window.HQ_CONFIG треба завантажити ПЕРЕД цим скриптом —
   або скрипт сам підвантажить /hq/config.js.
   =========================================================== */
(function () {
  if (window.__dcAuthGuard) return;
  window.__dcAuthGuard = true;

  const STYLES = `
    #dc-auth-overlay {
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(10,10,10,0.96);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex; align-items: center; justify-content: center;
      flex-direction: column; gap: 24px;
      font-family: 'Manrope', sans-serif; color: #fff;
      padding: 24px;
    }
    #dc-auth-overlay .dc-auth-card {
      background: #141414; border: 1px solid #2A2A2A;
      border-radius: 12px; padding: 36px 32px;
      max-width: 420px; width: 100%; text-align: center;
      box-shadow: 0 30px 80px -20px rgba(227,6,19,0.18);
    }
    #dc-auth-overlay h2 {
      font-family: 'Oswald','Bebas Neue',sans-serif;
      font-size: 28px; letter-spacing: 0.02em;
      margin: 0 0 8px; color: #fff;
    }
    #dc-auth-overlay h2 .red { color: #E30613; }
    #dc-auth-overlay p {
      color: #BBB; font-size: 14px; line-height: 1.5;
      margin: 0 0 24px;
    }
    #dc-auth-overlay .dc-auth-spinner {
      width: 28px; height: 28px;
      border: 3px solid #2A2A2A; border-top-color: #E30613;
      border-radius: 50%;
      animation: dc-auth-spin 0.8s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes dc-auth-spin { to { transform: rotate(360deg); } }
    #dc-auth-overlay .dc-auth-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 24px;
      font-family: 'Archivo Black', sans-serif;
      font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase;
      background: #E30613; color: #fff;
      border: none; border-radius: 6px;
      text-decoration: none; cursor: pointer;
      transition: background 120ms, transform 120ms;
    }
    #dc-auth-overlay .dc-auth-btn:hover { background: #B8050F; transform: translateY(-1px); }
    #dc-auth-overlay .dc-auth-status {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px; color: #888;
      letter-spacing: 0.12em; text-transform: uppercase;
      margin-top: 16px;
    }
    body.dc-auth-locked { overflow: hidden; }
    body.dc-auth-locked > *:not(#dc-auth-overlay):not(script) {
      filter: blur(6px); pointer-events: none; user-select: none;
    }
  `;

  function injectStyles() {
    const s = document.createElement('style');
    s.id = 'dc-auth-guard-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function buildOverlay(state) {
    const ov = document.createElement('div');
    ov.id = 'dc-auth-overlay';
    const next = encodeURIComponent(location.href);
    if (state === 'checking') {
      ov.innerHTML = `
        <div class="dc-auth-card">
          <div class="dc-auth-spinner"></div>
          <h2>DREAM<span class="red">CAR</span></h2>
          <p>Перевіряю доступ…</p>
        </div>
      `;
    } else if (state === 'denied') {
      ov.innerHTML = `
        <div class="dc-auth-card">
          <h2>DREAM<span class="red">CAR</span> · ВНУТРІШНЯ</h2>
          <p>Ця сторінка потребує авторизації команди DreamCar.<br>Увійди через Google або Telegram у Центрі.</p>
          <a class="dc-auth-btn" href="https://team.dreamcar.ua/hq/?next=${next}">▶ Увійти через /hq</a>
          <div class="dc-auth-status">Доступ обмежено · команда DreamCar</div>
        </div>
      `;
    } else if (state === 'error') {
      ov.innerHTML = `
        <div class="dc-auth-card">
          <h2>DREAM<span class="red">CAR</span></h2>
          <p>Помилка перевірки доступу. Спробуй оновити сторінку через 5 секунд.</p>
          <a class="dc-auth-btn" href="${location.href}">↻ Оновити</a>
        </div>
      `;
    }
    document.body.appendChild(ov);
    document.body.classList.add('dc-auth-locked');
  }

  function removeOverlay() {
    const ov = document.getElementById('dc-auth-overlay');
    if (ov) ov.remove();
    document.body.classList.remove('dc-auth-locked');
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => res();
      s.onerror = (e) => rej(e);
      document.head.appendChild(s);
    });
  }

  async function ensureSupabase() {
    if (window.supabase && window.supabase.auth) return window.supabase;
    if (!window.HQ_CONFIG) {
      // Підвантажуємо config.js з /hq/
      await loadScript('https://team.dreamcar.ua/hq/config.js').catch(()=>{});
    }
    if (!window.HQ_CONFIG || !window.HQ_CONFIG.SUPABASE_URL) {
      throw new Error('HQ_CONFIG missing');
    }
    const mod = await import('https://esm.sh/@supabase/supabase-js@2');
    window.supabase = mod.createClient(
      window.HQ_CONFIG.SUPABASE_URL,
      window.HQ_CONFIG.SUPABASE_ANON_KEY,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
    );
    return window.supabase;
  }

  async function check() {
    injectStyles();
    buildOverlay('checking');
    try {
      const sb = await Promise.race([
        ensureSupabase(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('SDK timeout')), 8000))
      ]);
      const { data: { session } } = await Promise.race([
        sb.auth.getSession(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Session timeout')), 6000))
      ]);
      if (session && session.user) {
        removeOverlay();
        window.dispatchEvent(new CustomEvent('dc-auth-ok', { detail: { user: session.user } }));
        console.log('[dc-auth] ✓ session:', session.user.email);
      } else {
        removeOverlay();
        buildOverlay('denied');
      }
    } catch (e) {
      console.error('[dc-auth] error:', e);
      removeOverlay();
      buildOverlay('denied'); // fail-closed: краще не пускати ніж пустити без перевірки
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check);
  } else {
    check();
  }
})();
