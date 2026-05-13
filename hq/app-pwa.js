/* ============================================================
   DreamCar HQ — PWA install + service worker registration
   ============================================================ */

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
      navigator.serviceWorker.register('service-worker.js', { scope: '/dreamcar-team/hq/' })
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

  // ---- 3. Install prompt ----
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showInstallButton();
  });

  function showInstallButton() {
    if (document.getElementById('hq-pwa-install')) return;
    var btn = document.createElement('button');
    btn.id = 'hq-pwa-install';
    btn.innerHTML = '📲 Встановити HQ';
    btn.style.cssText =
      'position:fixed;bottom:18px;right:18px;z-index:9000;' +
      'background:var(--brand-grad, linear-gradient(135deg,#d80004,#ff6a1f));' +
      'color:#fff;border:none;padding:11px 18px;border-radius:30px;' +
      'font-weight:700;font-size:13px;cursor:pointer;' +
      'box-shadow:0 8px 28px -6px rgba(216,0,4,0.5);' +
      'transition:transform 0.15s;';
    btn.onmouseenter = function () { btn.style.transform = 'translateY(-2px)'; };
    btn.onmouseleave = function () { btn.style.transform = ''; };
    btn.onclick = async function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      var choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        if (typeof toast === 'function') toast('HQ', 'success', 'Встановлено!');
      }
      deferredPrompt = null;
      btn.remove();
    };
    document.body.appendChild(btn);
  }

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

  console.log('%cDreamCar HQ PWA %c· wired (manifest + SW + install)', 'color:#4ade80;font-weight:700;', 'color:#888;');
})();
