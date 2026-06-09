/* ============================================================
   DreamCar HQ — PWA install + service worker registration
   ============================================================ */
// FIX #131: install button перенесено з bottom-right fixed (перекривав CTA
// "Взяти в роботу" / "На погодження") у topbar поряд з bell-іконкою.

(function () {
  if (window.__hqPwaLoaded) return;
  window.__hqPwaLoaded = true;

  // ---- 1. Manifest + theme-color + iOS meta ----
  (function () {
    if (!document.querySelector('link[rel="manifest"]')) {
      var link = document.createElement('link');
      link.rel = 'manifest';
      link.href = 'manifest.webmanifest';
      document.head.appendChild(link);
    }
    if (!document.querySelector('meta[name="theme-color"]')) {
      var meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = '#0a0a0e';
      document.head.appendChild(meta);
    }
    var appleCap = document.createElement('meta');
    appleCap.name = 'apple-mobile-web-app-capable';
    appleCap.content = 'yes';
    document.head.appendChild(appleCap);
    var appleStatus = document.createElement('meta');
    appleStatus.name = 'apple-mobile-web-app-status-bar-style';
    appleStatus.content = 'black-translucent';
    document.head.appendChild(appleStatus);
  })();

  // ---- 2. Register Service Worker ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      // #228 fix: scope був hardcoded '/dreamcar-team/hq/' що НЕ match script path (на team.dreamcar.ua скрипт лежить у /hq/).
      // Браузер відмовляв з: "scope '/dreamcar-team/hq/' is not under the max scope allowed ('/hq/')".
      // Не передаємо scope — браузер сам використає directory скрипта як scope.
      navigator.serviceWorker.register('service-worker.js')
        .then(function (reg) {
          console.log('%cDreamCar HQ PWA %c· SW registered', 'color:#4ade80;font-weight:700;', 'color:#888;', reg.scope);
          reg.addEventListener('updatefound', function () {
            var newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', function () {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  if (typeof toast === 'function') {
                    toast('Нова версія HQ', 'info', 'Перезавантаж сторінку щоб оновити');
                  }
                }
              });
            }
          });
        })
        .catch(function (err) { console.warn('SW registration failed:', err); });
    });
  }

  // ---- 3. Install prompt у TOPBAR (поряд з bell) ----
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallTopbarIcon();
  });

  function showInstallTopbarIcon() {
    // Якщо запущений як standalone PWA — кнопка не потрібна
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return;
    if (document.getElementById('hq-pwa-install')) return;

    // Прибрати залишки старого bottom-right розташування (на випадок старого кешу)
    var legacyBtn = document.querySelector('button[id="hq-pwa-install-legacy"], #hq-pwa-install-old');
    if (legacyBtn) legacyBtn.remove();

    var actions = document.querySelector('.topbar .actions');
    if (!actions) {
      // Topbar не готовий — почекаємо
      setTimeout(showInstallTopbarIcon, 500);
      return;
    }

    var btn = document.createElement('button');
    btn.id = 'hq-pwa-install';
    btn.className = 'hq-topbar-icon';
    btn.title = 'Встановити HQ як додаток';
    btn.setAttribute('aria-label', 'Встановити HQ як додаток');
    btn.innerHTML = '<span style="font-size:14px;">↓</span>';
    btn.style.cssText =
      'background:var(--bg-3);border:1px solid var(--border);' +
      'width:36px;height:36px;border-radius:8px;' +
      'display:flex;align-items:center;justify-content:center;' +
      'color:#fff;font-size:14px;cursor:pointer;' +
      'transition:background 0.15s,border-color 0.15s;' +
      'position:relative;';
    btn.onmouseenter = function () {
      btn.style.background = 'var(--bg-hover)';
      btn.style.borderColor = 'var(--red, #E30613)';
    };
    btn.onmouseleave = function () {
      btn.style.background = 'var(--bg-3)';
      btn.style.borderColor = 'var(--border)';
    };

    btn.onclick = async function () {
      if (!deferredPrompt) {
        if (typeof toast === 'function') toast('Встановлення', 'info', 'Браузер не дозволяє встановлення зараз. Спробуй через меню браузера (⋮ → Встановити DreamCar HQ).');
        return;
      }
      deferredPrompt.prompt();
      var choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        if (typeof toast === 'function') toast('HQ', 'success', 'Встановлено як додаток');
      }
      deferredPrompt = null;
      btn.remove();
    };

    // Маленька червона crowna що приваблює увагу 1 раз
    var seenInstallBadge = false;
    try { seenInstallBadge = localStorage.getItem('hq-pwa-seen-badge') === '1'; } catch (_) {}
    if (!seenInstallBadge) {
      var pulse = document.createElement('span');
      pulse.style.cssText =
        'position:absolute;top:-2px;right:-2px;width:8px;height:8px;border-radius:50%;' +
        'background:#E30613;box-shadow:0 0 0 0 rgba(216,0,4,0.6);' +
        'animation:hq-pwa-pulse 2s infinite;';
      btn.appendChild(pulse);
      // Прибираємо pulse після першого натискання
      btn.addEventListener('click', function once() {
        try { localStorage.setItem('hq-pwa-seen-badge', '1'); } catch (_) {}
        if (pulse.parentNode) pulse.parentNode.removeChild(pulse);
        btn.removeEventListener('click', once);
      });

      // Pulse animation keyframes (одноразово)
      if (!document.getElementById('hq-pwa-pulse-style')) {
        var style = document.createElement('style');
        style.id = 'hq-pwa-pulse-style';
        style.textContent = '@keyframes hq-pwa-pulse{0%{box-shadow:0 0 0 0 rgba(216,0,4,0.6)}70%{box-shadow:0 0 0 8px rgba(216,0,4,0)}100%{box-shadow:0 0 0 0 rgba(216,0,4,0)}}';
        document.head.appendChild(style);
      }
    }

    // Вставити ПЕРЕД bell (щоб порядок: install · bell · role-switch)
    var bell = actions.querySelector('.bell, #bellBtn');
    if (bell) {
      actions.insertBefore(btn, bell);
    } else {
      actions.insertBefore(btn, actions.firstChild);
    }
  }

  // Якщо beforeinstallprompt вже спрацював до того як ми завантажились
  // (наприклад app-pwa.js завантажено пізніше) — спробувати показати кнопку
  setTimeout(function () {
    if (deferredPrompt) showInstallTopbarIcon();
  }, 500);

  window.addEventListener('appinstalled', function () {
    var btn = document.getElementById('hq-pwa-install');
    if (btn) btn.remove();
    if (typeof toast === 'function') toast('HQ', 'success', 'Встановлено як додаток');
  });

  if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
    document.documentElement.classList.add('hq-standalone');
  }

  // ---- 4. Push subscription (опційно через Settings UI) ----
  window.HQ_PWA = {
    async requestPushPermission() {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        return { ok: false, error: 'Push не підтримується у цьому браузері' };
      }
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') return { ok: false, error: 'Дозвіл відхилено' };

      var reg = await navigator.serviceWorker.ready;
      var vapid = window.HQ_CONFIG && window.HQ_CONFIG.VAPID_PUBLIC_KEY;
      if (!vapid) {
        return { ok: true, perm: perm, note: 'Permission granted. VAPID не налаштований — push поки не активний.' };
      }
      try {
        var sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapid),
        });
        if (window.supabase && typeof Store !== 'undefined' && Store.currentUser()) {
          await window.supabase.from('users').update({
            push_subscription: sub.toJSON(),
          }).eq('id', Store.currentUser().id);
        }
        return { ok: true, subscription: sub.toJSON() };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },
  };

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(base64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  console.log('%cDreamCar HQ PWA %c· wired (topbar install + SW + push)', 'color:#4ade80;font-weight:700;', 'color:#888;');
})();
