/* ============================================================
   DreamCar shared storage adapter for Supabase Auth
   ============================================================
   Зберігає session у cookies (shared across /hq/, /tasks/, /brand/
   у одному origin team.dreamcar.ua) + localStorage як fallback.

   Чому cookies:
   - localStorage НЕ shared між path у TG WebView / iOS Safari
   - Cookies з path=/ shared автоматично всюди у origin
   - max-age=2592000 (30 днів) — refresh token живе довго

   API сумісний з Supabase auth.storage interface:
   - getItem(key) → string|null
   - setItem(key, value) → void
   - removeItem(key) → void

   Usage:
     supabase.createClient(URL, KEY, {
       auth: { storage: window.dcStorage, ... }
     })

   Створено 05.06.2026 для fix login loop між HQ↔Tasks.
============================================================ */
(function () {
  if (window.dcStorage) return; // вже інжектована

  // Cookie size limit ~4KB. Supabase session ~1.5KB. Має fit.
  // Якщо value більше 3500 байт — НЕ зберігаємо у cookie (fallback localStorage)
  var COOKIE_MAX_SIZE = 3500;
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 днів

  // Парс cookie value з document.cookie за іменем
  function getCookie(name) {
    var nameEQ = encodeURIComponent(name) + '=';
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
      var c = ca[i].replace(/^\s+/, '');
      if (c.indexOf(nameEQ) === 0) {
        try {
          return decodeURIComponent(c.substring(nameEQ.length));
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  }

  // Set cookie з origin-wide scope
  function setCookie(name, value) {
    try {
      var encoded = encodeURIComponent(value);
      if (encoded.length > COOKIE_MAX_SIZE) {
        console.warn('[dcStorage] Value too big for cookie, skip set:', name, encoded.length);
        return false;
      }
      // Не задаємо domain= — за дефолтом cookie прив'язана до поточного host (team.dreamcar.ua)
      // що достатньо щоб шерити між /hq/, /tasks/, /brand/, тощо.
      var cookie = encodeURIComponent(name) + '=' + encoded +
        '; path=/' +
        '; max-age=' + COOKIE_MAX_AGE +
        '; SameSite=Lax';
      if (location.protocol === 'https:') cookie += '; Secure';
      document.cookie = cookie;
      return true;
    } catch (e) {
      console.warn('[dcStorage] setCookie error:', e);
      return false;
    }
  }

  function deleteCookie(name) {
    try {
      document.cookie = encodeURIComponent(name) + '=; path=/; max-age=0; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    } catch (e) {}
  }

  // Public API — Supabase auth.storage сумісний
  window.dcStorage = {
    getItem: function (key) {
      try {
        // Спочатку cookie (shared), fallback на localStorage
        var fromCookie = getCookie(key);
        if (fromCookie !== null) return fromCookie;
        try { return localStorage.getItem(key); } catch (_) { return null; }
      } catch (e) {
        console.warn('[dcStorage] getItem err:', e);
        return null;
      }
    },
    setItem: function (key, value) {
      try {
        // Cookie (для cross-path sharing)
        var ok = setCookie(key, value);
        // localStorage як backup (якщо cookies disabled)
        try { localStorage.setItem(key, value); } catch (_) {}
        if (!ok) console.warn('[dcStorage] only localStorage set:', key);
      } catch (e) {
        console.warn('[dcStorage] setItem err:', e);
      }
    },
    removeItem: function (key) {
      try {
        deleteCookie(key);
        try { localStorage.removeItem(key); } catch (_) {}
      } catch (e) {
        console.warn('[dcStorage] removeItem err:', e);
      }
    },
  };

  console.log('[dcStorage] initialized — cookies + localStorage backup');
})();
