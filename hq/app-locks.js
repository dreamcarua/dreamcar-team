/* ============================================================
   DreamCar HQ — Soft-Lock через editing_sessions
   Завантажується ПІСЛЯ app-core.js + app-views.js + app-patches.js.
   Також завантажує app-extras.js у кінці (loader chain).
   ============================================================ */

(function () {
  if (window.__hqLocksLoaded) return;
  window.__hqLocksLoaded = true;

  // ---- CSS для банера ----
  (function () {
    if (document.getElementById('hq-locks-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-locks-css';
    css.textContent =
      '#softLockBanner { background: linear-gradient(90deg, rgba(251,191,36,0.15), rgba(251,191,36,0.05)); border-left: 3px solid var(--gold); padding: 10px 14px; margin: 0 22px 12px; border-radius: 6px; font-size: 12px; color: #fff; display: flex; align-items: center; gap: 10px; animation: lockFadeIn 0.3s ease; }' +
      '@keyframes lockFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }' +
      '#softLockBanner .lock-pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--gold); animation: lockPulse 1.5s infinite; }' +
      '@keyframes lockPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }';
    document.head.appendChild(css);
  })();

  var SOFT_LOCK_PING_MS = 30000;     // ping кожні 30 сек
  var SOFT_LOCK_TTL_MS  = 120000;    // session живе 2 хв без ping
  var _pingTimer = null;
  var _currentLockPubId = null;
  var _rtChannel = null;

  function nowPlusMs(ms) { return new Date(Date.now() + ms).toISOString(); }

  async function startLock(pubId) {
    if (!window.HQ_BACKEND || !window.supabase || !window.Store) return;
    var me = Store.currentUser && Store.currentUser();
    if (!me) return;
    _currentLockPubId = pubId;
    try {
      await window.supabase.from('editing_sessions').upsert({
        publication_id: pubId,
        user_id: me.id,
        last_ping: new Date().toISOString(),
        expires_at: nowPlusMs(SOFT_LOCK_TTL_MS),
      }, { onConflict: 'publication_id,user_id' });
    } catch (e) { console.warn('startLock:', e); }

    if (_pingTimer) clearInterval(_pingTimer);
    _pingTimer = setInterval(pingLock, SOFT_LOCK_PING_MS);

    try {
      if (_rtChannel) window.supabase.removeChannel(_rtChannel);
      _rtChannel = window.supabase.channel('hq-lock-' + pubId)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'editing_sessions',
          filter: 'publication_id=eq.' + pubId
        }, function () { refreshBanner(pubId); })
        .subscribe();
    } catch (e) { console.warn('rtChannel:', e); }

    refreshBanner(pubId);
  }

  async function pingLock() {
    if (!_currentLockPubId || !window.supabase) return;
    var me = Store.currentUser && Store.currentUser();
    if (!me) return;
    try {
      await window.supabase.from('editing_sessions').update({
        last_ping: new Date().toISOString(),
        expires_at: nowPlusMs(SOFT_LOCK_TTL_MS),
      }).match({ publication_id: _currentLockPubId, user_id: me.id });
    } catch (e) { console.warn('pingLock:', e); }
  }

  async function endLock() {
    if (_pingTimer) { clearInterval(_pingTimer); _pingTimer = null; }
    var pubId = _currentLockPubId;
    _currentLockPubId = null;
    if (_rtChannel && window.supabase) {
      try { window.supabase.removeChannel(_rtChannel); } catch (_) {}
      _rtChannel = null;
    }
    if (!pubId || !window.supabase) return;
    var me = Store.currentUser && Store.currentUser();
    if (!me) return;
    try {
      await window.supabase.from('editing_sessions').delete()
        .match({ publication_id: pubId, user_id: me.id });
    } catch (e) { /* fire-and-forget */ }
    var banner = document.getElementById('softLockBanner');
    if (banner) banner.remove();
  }

  async function refreshBanner(pubId) {
    if (!window.supabase) return;
    var me = Store.currentUser && Store.currentUser();
    if (!me) return;
    try {
      var nowIso = new Date().toISOString();
      var resp = await window.supabase
        .from('editing_sessions')
        .select('user_id')
        .eq('publication_id', pubId)
        .gt('expires_at', nowIso)
        .neq('user_id', me.id);
      var sessions = resp.data || [];
      var names = [];
      if (sessions.length > 0) {
        var userIds = sessions.map(function (s) { return s.user_id; });
        var ur = await window.supabase.from('users').select('id, name').in('id', userIds);
        names = (ur.data || []).map(function (u) { return u.name || 'хтось'; });
      }
      var modal = document.getElementById('modal');
      var head = modal && modal.querySelector('.modal-head');
      var existing = document.getElementById('softLockBanner');
      if (existing) existing.remove();
      if (!head || names.length === 0) return;
      var banner = document.createElement('div');
      banner.id = 'softLockBanner';
      banner.innerHTML = '<span class="lock-pulse"></span>' +
        '<span><b>' + escapeHtml(names.join(', ')) + '</b> ' +
        (names.length > 1 ? 'зараз редагують' : 'зараз редагує') +
        ' цю публікацію. Будь обережним — можуть конфліктувати правки.</span>';
      head.parentNode.insertBefore(banner, head.nextSibling);
    } catch (e) { console.warn('refreshBanner:', e); }
  }

  function patchOpenCardForLock() {
    if (typeof window.openCard !== 'function' || window.openCard.__lockPatched) return;
    var _orig = window.openCard;
    window.openCard = function (id) {
      _orig.call(this, id);
      if (id && id !== 'new') {
        setTimeout(function () { startLock(id); }, 100);
      }
    };
    window.openCard.__lockPatched = true;
  }
  function patchModalCloseForLock() {
    if (!window.Modal || typeof Modal.close !== 'function' || Modal.close.__lockPatched) return;
    var _orig = Modal.close.bind(Modal);
    Modal.close = function () {
      try { endLock(); } catch (_) {}
      return _orig();
    };
    Modal.close.__lockPatched = true;
  }
  patchOpenCardForLock(); setTimeout(patchOpenCardForLock, 300); setTimeout(patchOpenCardForLock, 1500);
  patchModalCloseForLock(); setTimeout(patchModalCloseForLock, 300); setTimeout(patchModalCloseForLock, 1500);

  window.addEventListener('beforeunload', function () {
    try { endLock(); } catch (_) {}
  });

  window.HQ_LOCKS = {
    start: startLock, end: endLock, ping: pingLock, refresh: refreshBanner,
    current: function () { return _currentLockPubId; },
  };
  if (window.DEBUG) console.log('%cDreamCar HQ Soft-Lock %c· active', 'color:#fbbf24;font-weight:700;', 'color:#888;');

  // ============================================================
  // LOADER CHAIN — підвантажуємо app-extras.js
  // ============================================================
  if (!document.querySelector('script[src*="app-extras.js"]')) {
    var s = document.createElement('script');
    s.src = 'app-extras.js?v=' + Date.now();
    s.defer = true;
    document.head.appendChild(s);
  }
})();
