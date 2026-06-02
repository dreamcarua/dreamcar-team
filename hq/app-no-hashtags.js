/* ============================================================
   DreamCar HQ — Прибрати hashtags з AI та постів (#E)
   ============================================================ */
// Користувач: "хештеги нужно удалить вовсе — занимают лишнее место,
// для продвижения уже работают"
// Реалізація:
//  1) Hide #f_hashtags field + label у картці публікації (CSS)
//  2) Hide hashtags блок у preview cards (CSS)
//  3) Перехопити AI fetch і додати "БЕЗ hashtags" у prompt
//  4) Перехопити AI response — почистити hashtags array

(function () {
  if (window.__hqNoHashtags) return;
  window.__hqNoHashtags = true;

  // 1+2: CSS hiding
  (function injectCss() {
    if (document.getElementById('hq-no-hashtags-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-no-hashtags-css';
    css.textContent =
      // Сховати #f_hashtags input та його label у картці
      '.field:has(#f_hashtags) { display: none !important; }' +
      // Якщо :has не підтримується — backup ID-based hide
      '#f_hashtags, label[for="f_hashtags"] { display: none !important; }' +
      // Сховати hashtags у preview
      '.preview-card .pv-text .pv-hash { display: none !important; }' +
      // Сховати dedicated hashtags block у preview
      '.preview-card .pv-text > div[style*="color:var(--blue-soft)"] { display: none !important; }';
    document.head.appendChild(css);
  })();

  // Додатковий JS-rescue для браузерів без :has — заховати batьківський .field
  // (audit 02.06.2026: setInterval forever замінений на MutationObserver — CSS :has всюди підтримується крім старого Firefox, observer спрацьовує тільки на mutation)
  function hideHashtagsField() {
    var inp = document.getElementById('f_hashtags');
    if (!inp) return;
    var field = inp.closest('.field');
    if (field && field.style.display !== 'none') field.style.display = 'none';
  }
  hideHashtagsField();
  if (!window.__hqNoHashtagsObserver) {
    window.__hqNoHashtagsObserver = new MutationObserver(hideHashtagsField);
    window.__hqNoHashtagsObserver.observe(document.body, { childList: true, subtree: true });
  }

  // 3+4: AI fetch interception
  function patchFetch() {
    if (window.fetch.__noHashtagsPatched) return;
    var _origFetch = window.fetch;
    window.fetch = function (url, opts) {
      try {
        if (typeof url === 'string' && url.indexOf('/ai-copy-assistant') >= 0 && opts?.body) {
          // Modify request body — add hint "no hashtags"
          var body = JSON.parse(opts.body);
          if (body && typeof body === 'object') {
            body.no_hashtags = true;
            // Якщо є system prompt — додати
            if (body.system) {
              body.system += ' КРИТИЧНО: НЕ генеруй hashtags у тексті поста. Hashtags array повертай порожнім.';
            }
            // Якщо є user prompt
            if (body.brief || body.prompt) {
              var addOn = '\n\n⚠️ ВАЖЛИВО: пост БЕЗ hashtags. hashtags array повертай як [].';
              body.brief = (body.brief || body.prompt || '') + addOn;
            }
            opts = Object.assign({}, opts, { body: JSON.stringify(body) });
          }
        }
      } catch (_) {}
      // Wrap response — strip hashtags
      return _origFetch.call(this, url, opts).then(function (r) {
        if (typeof url === 'string' && url.indexOf('/ai-copy-assistant') >= 0 && r.ok) {
          // Clone response, parse, modify, recreate
          return r.clone().json().then(function (data) {
            if (data && typeof data === 'object') {
              data.hashtags = [];
              // Strip hashtags з main text body
              if (typeof data.text === 'string') {
                data.text = data.text.replace(/#[A-Za-zА-Яа-яёЁіїєґІЇЄҐ0-9_]+/g, '').replace(/\s+/g, ' ').trim();
              }
              if (typeof data.body === 'string') {
                data.body = data.body.replace(/#[A-Za-zА-Яа-яёЁіїєґІЇЄҐ0-9_]+/g, '').replace(/\s+/g, ' ').trim();
              }
            }
            return new Response(JSON.stringify(data), {
              status: r.status, headers: r.headers,
            });
          }).catch(function () { return r; });
        }
        return r;
      });
    };
    window.fetch.__noHashtagsPatched = true;
  }
  patchFetch();

  // Strip hashtags при autosave/upsertPub
  function patchUpsertPub() {
    if (!window.Store || typeof Store.upsertPub !== 'function') return false;
    if (Store.upsertPub.__noHashtags) return true;
    var _orig = Store.upsertPub.bind(Store);
    Store.upsertPub = function (pub) {
      if (pub) {
        // Очищаємо hashtags
        pub.hashtags = [];
      }
      return _orig(pub);
    };
    Store.upsertPub.__noHashtags = true;
    return true;
  }
  if (!patchUpsertPub()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (patchUpsertPub() || tries++ > 20) clearInterval(iv);
    }, 250);
  }

  console.log('%cDreamCar HQ No Hashtags %c· #E active — AI + posts без hashtags',
    'color:#7ab0ff;font-weight:700;', 'color:#888;');
})();
