/* DreamCar shared storage adapter — копія з /retention/ */
(function () {
  if (window.dcStorage) return;
  var COOKIE_MAX_SIZE = 3500;
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
  function getCookie(name) {
    var nameEQ = encodeURIComponent(name) + '=';
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
      var c = ca[i].replace(/^\s+/, '');
      if (c.indexOf(nameEQ) === 0) {
        try { return decodeURIComponent(c.substring(nameEQ.length)); } catch (e) { return null; }
      }
    }
    return null;
  }
  function setCookie(name, value) {
    try {
      var encoded = encodeURIComponent(value);
      if (encoded.length > COOKIE_MAX_SIZE) { console.warn('[dcStorage] too big:', name, encoded.length); return false; }
      var cookie = encodeURIComponent(name) + '=' + encoded + '; path=/' + '; max-age=' + COOKIE_MAX_AGE + '; SameSite=Lax';
      if (location.protocol === 'https:') cookie += '; Secure';
      document.cookie = cookie;
      return true;
    } catch (e) { console.warn('[dcStorage] setCookie err:', e); return false; }
  }
  function deleteCookie(name) {
    try { document.cookie = encodeURIComponent(name) + '=; path=/; max-age=0; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); } catch (e) {}
  }
  window.dcStorage = {
    getItem: function (key) {
      try {
        var fromCookie = getCookie(key);
        if (fromCookie !== null) return fromCookie;
        try { return localStorage.getItem(key); } catch (_) { return null; }
      } catch (e) { return null; }
    },
    setItem: function (key, value) {
      try { setCookie(key, value); try { localStorage.setItem(key, value); } catch (_) {} } catch (e) {}
    },
    removeItem: function (key) {
      try { deleteCookie(key); try { localStorage.removeItem(key); } catch (_) {} } catch (e) {}
    },
  };
  console.log('[dcStorage] initialized (inventory)');
})();
