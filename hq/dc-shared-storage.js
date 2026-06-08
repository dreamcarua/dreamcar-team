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

  // 08.06.2026 R2 fix (Давид login loop):
  // Cookie size raised to 4090 (real browser limit ~4096 - safety margin for prefix).
  // Якщо value перевищує — chunk-имо у 3 cookies (sb-auth-token, sb-auth-token-2, -3).
  var COOKIE_MAX_SIZE = 4090;
  var COOKIE_CHUNK_SIZE = 3800;       // безпечний chunk
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

  // Chunked cookie helpers — для session > COOKIE_MAX_SIZE
  function setCookieChunks(name, value) {
    // Спочатку видаляємо старі chunks
    for (var ci = 1; ci <= 5; ci++) deleteCookie(name + '-c' + ci);
    var encoded = encodeURIComponent(value);
    if (encoded.length <= COOKIE_MAX_SIZE) {
      // Просто один cookie без chunking
      deleteCookie(name + '-meta');
      return setCookie(name, value);
    }
    // Chunking: спочатку видаляємо single cookie, потім пишемо meta + chunks
    deleteCookie(name);
    var chunks = Math.ceil(encoded.length / COOKIE_CHUNK_SIZE);
    if (chunks > 5) {
      console.warn('[dcStorage] value too large even for chunking:', encoded.length);
      return false;
    }
    try {
      document.cookie = encodeURIComponent(name + '-meta') + '=' + chunks +
        '; path=/; max-age=' + COOKIE_MAX_AGE + '; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
      for (var i = 0; i < chunks; i++) {
        var part = encoded.substring(i * COOKIE_CHUNK_SIZE, (i + 1) * COOKIE_CHUNK_SIZE);
        document.cookie = encodeURIComponent(name + '-c' + (i + 1)) + '=' + part +
          '; path=/; max-age=' + COOKIE_MAX_AGE + '; SameSite=Lax' +
          (location.protocol === 'https:' ? '; Secure' : '');
      }
      return true;
    } catch (e) {
      console.warn('[dcStorage] setCookieChunks err:', e);
      return false;
    }
  }

  function getCookieChunks(name) {
    var meta = getCookie(name + '-meta');
    if (!meta) return getCookie(name);   // single cookie
    var chunks = parseInt(meta, 10);
    if (!chunks || chunks < 1) return null;
    var out = '';
    for (var i = 1; i <= chunks; i++) {
      var part = getCookie(name + '-c' + i);
      if (part === null) return null;     // missing chunk → broken state
      out += part;
    }
    try { return decodeURIComponent(out); } catch (_) { return out; }
  }

  // Public API — Supabase auth.storage сумісний
  // 08.06.2026 R2 (Давид login loop fix): порядок get → localStorage ПЕРШИМ.
  // Причина: Supabase auto-refresh пише новий access_token у localStorage синхронно;
  // якщо cookie не оновлений (size > 3500 fail на старій версії, або race) →
  // dcStorage віддавав СТАРИЙ token → session expired → Tasks redirect на HQ → loop.
  // localStorage shared by origin (team.dreamcar.ua) — для browser достатньо.
  // Cookie лишається як TG WebView / iOS Safari fallback.
  window.dcStorage = {
    getItem: function (key) {
      try {
        // 1. localStorage пріоритет — синхронно оновлюється Supabase auto-refresh
        try {
          var ls = localStorage.getItem(key);
          if (ls !== null) return ls;
        } catch (_) {}
        // 2. Cookie fallback (для TG WebView де localStorage може бути sandboxed)
        return getCookieChunks(key);
      } catch (e) {
        console.warn('[dcStorage] getItem err:', e);
        return null;
      }
    },
    setItem: function (key, value) {
      try {
        // localStorage primary (fast + reliable у browser)
        try { localStorage.setItem(key, value); } catch (_) {}
        // Cookie secondary з chunking якщо > 4090 байт
        var ok = setCookieChunks(key, value);
        if (!ok) console.warn('[dcStorage] cookie persist failed (size/limit). Falling back to localStorage only:', key);
      } catch (e) {
        console.warn('[dcStorage] setItem err:', e);
      }
    },
    removeItem: function (key) {
      try {
        try { localStorage.removeItem(key); } catch (_) {}
        deleteCookie(key);
        deleteCookie(key + '-meta');
        for (var ci = 1; ci <= 5; ci++) deleteCookie(key + '-c' + ci);
      } catch (e) {
        console.warn('[dcStorage] removeItem err:', e);
      }
    },
  };

  console.log('[dcStorage] v2 initialized — localStorage primary + chunked cookies fallback');
})();
