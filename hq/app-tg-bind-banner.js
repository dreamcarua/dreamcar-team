/* ============================================================
   DreamCar HQ — Persistent TG-bind banner
   ============================================================
   Якщо у юзера tg_chat_id IS NULL — показуємо banner з deep-link
   щоб одним кліком пройти flow з @dreamcar_team_bot.

   Brand-compliant стиль (warm warning):
   - bg: rgba(251,191,36,0.1)
   - border: rgba(251,191,36,0.4)
   - text: var(--gold) #fbbf24
   - JetBrains Mono для CTA
   ============================================================ */
(function(){
  if (window.__hqTgBannerLoaded) return;
  window.__hqTgBannerLoaded = true;

  var BOT_USERNAME = 'dreamcar_team_bot';
  var DISMISS_KEY = 'hq:tgbind-banner-dismissed';
  var CHECK_INTERVAL_MS = 30000; // 30s

  function injectStyles(){
    if (document.getElementById('hq-tg-banner-styles')) return;
    var s = document.createElement('style');
    s.id = 'hq-tg-banner-styles';
    s.textContent = [
      '.hq-tg-banner{position:sticky;top:0;left:0;right:0;z-index:90;',
      '  background:rgba(251,191,36,0.12);border-bottom:1px solid rgba(251,191,36,0.4);',
      '  color:#fbbf24;padding:10px 18px;font-size:13px;',
      '  font-family:Manrope,sans-serif;display:flex;align-items:center;gap:14px;}',
      '.hq-tg-banner .hq-tg-msg{flex:1;line-height:1.4;}',
      '.hq-tg-banner .hq-tg-msg b{color:#fff;}',
      '.hq-tg-banner .hq-tg-cta{display:inline-flex;align-items:center;gap:6px;',
      '  background:#fbbf24;color:#1a1100;padding:7px 14px;border-radius:6px;',
      '  font-family:"JetBrains Mono",monospace;font-size:11px;font-weight:700;',
      '  letter-spacing:0.08em;text-transform:uppercase;text-decoration:none;',
      '  transition:background 0.15s,transform 0.1s;}',
      '.hq-tg-banner .hq-tg-cta:hover{background:#ffd24d;transform:translateY(-1px);}',
      '.hq-tg-banner .hq-tg-dismiss{background:transparent;border:1px solid rgba(251,191,36,0.3);',
      '  color:rgba(251,191,36,0.6);width:26px;height:26px;border-radius:6px;',
      '  cursor:pointer;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center;}',
      '.hq-tg-banner .hq-tg-dismiss:hover{background:rgba(251,191,36,0.1);color:#fbbf24;}',
      '@media(max-width:640px){.hq-tg-banner{flex-direction:column;align-items:flex-start;padding:10px 14px;gap:8px;}',
      '  .hq-tg-banner .hq-tg-msg{font-size:12px;}.hq-tg-banner .hq-tg-cta{font-size:10px;padding:6px 10px;}}',
    ].join('');
    document.head.appendChild(s);
  }

  function renderBanner(userId){
    if (document.getElementById('hq-tg-banner')) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;
    injectStyles();
    var el = document.createElement('div');
    el.id = 'hq-tg-banner';
    el.className = 'hq-tg-banner';
    var deeplink = 'https://t.me/' + BOT_USERNAME + '?start=hq_' + (userId || '');
    el.innerHTML =
      '<div class="hq-tg-msg">🔗 <b>Telegram не прив\'язано.</b> Ти не отримуєш сповіщень про @mentions, погодження, нові задачі.</div>' +
      '<a href="' + deeplink + '" target="_blank" rel="noopener" class="hq-tg-cta">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="margin-right:4px"><path d="M9.99 15.21l-.4 5.6c.57 0 .82-.24 1.12-.54l2.7-2.58 5.6 4.1c1.03.57 1.76.27 2.04-.95L24 4.83c.33-1.5-.54-2.09-1.54-1.72L1.18 11.27c-1.47.57-1.45 1.39-.25 1.76l5.3 1.65L18.7 6.78c.58-.39 1.1-.17.67.22"/></svg>' +
      'Прив\'язати' +
      '</a>' +
      '<button class="hq-tg-dismiss" title="Сховати на сьогодні">×</button>';
    el.querySelector('.hq-tg-dismiss').addEventListener('click', function(){
      localStorage.setItem(DISMISS_KEY, '1');
      el.remove();
    });
    // Вставляємо ПЕРЕД першим .topbar / .global-header / .app
    var anchor = document.querySelector('.app') || document.querySelector('.topbar') || document.body.firstChild;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor);
    else document.body.insertBefore(el, document.body.firstChild);
  }

  function removeBanner(){
    var el = document.getElementById('hq-tg-banner');
    if (el) el.remove();
  }

  async function checkAndShow(){
    if (!window.HQ_BACKEND || !window.supabase) return;
    try {
      var { data: { session } } = await window.supabase.auth.getSession();
      if (!session) return;
      var { data: user } = await window.supabase.auth.getUser();
      if (!user || !user.user) return;
      var { data: me } = await window.supabase
        .from('users')
        .select('id, name, tg_chat_id')
        .eq('auth_id', user.user.id)
        .single();
      if (!me) return;
      if (me.tg_chat_id) {
        removeBanner();
        // Якщо tg_chat_id з'явився після bind — очистити dismiss
        localStorage.removeItem(DISMISS_KEY);
      } else {
        renderBanner(me.id);
      }
    } catch(e){
      console.warn('[TG-Bind Banner] check failed:', e);
    }
  }

  // Перший запуск + поллінг кожні 30с
  function init(){
    checkAndShow();
    setInterval(checkAndShow, CHECK_INTERVAL_MS);
  }

  if (window.HQ_BACKEND !== undefined) {
    init();
  } else {
    window.addEventListener('hq-loader-ready', init, { once: true });
  }
})();
