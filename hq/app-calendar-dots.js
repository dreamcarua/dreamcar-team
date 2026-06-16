/* ============================================================
   DreamCar HQ — Platform Color Dots in Calendar (#118)
   ============================================================ */
// У місячному календарі картки публікацій показують тільки час + назву,
// з emoji-іконками платформ, які дрібні й невиразні. Замінюємо emoji
// на яскраві кольорові точки бренд-кольорів платформ.

(function () {
  if (window.__hqCalendarDots) return;
  window.__hqCalendarDots = true;

  // Бренд-кольори платформ (з app-core PLATFORM_BY_ID)
  var PLATFORM_COLORS = {
    ig: '#E1306C',  // Instagram pink
    tg: '#0088cc',  // Telegram blue
    tt: '#fe2c55',  // TikTok red
    th: '#666',     // Threads dark
    yt: '#ff0000',  // YouTube red
    fb: '#1877f2',  // Facebook blue
  };

  function processCard(card) {
    if (card.__hqDotsApplied) return;
    card.__hqDotsApplied = true;

    var pid = card.dataset.id;
    if (!pid) return;

    // Беремо pub з Store (bare reference у classic script)
    var p = null;
    try { p = (typeof Store !== 'undefined' ? Store : window.Store).pub(pid); } catch (_) {}
    if (!p || !Array.isArray(p.platforms) || p.platforms.length === 0) return;

    // Знаходимо існуючий .platform-icons або створюємо новий
    var dotsSpan = card.querySelector('.platform-icons');
    if (!dotsSpan) {
      dotsSpan = document.createElement('span');
      dotsSpan.className = 'platform-icons';
      var titleEl = card.querySelector('.title');
      if (titleEl) titleEl.parentNode.insertBefore(dotsSpan, titleEl);
      else card.appendChild(dotsSpan);
    }

    dotsSpan.innerHTML = p.platforms.map(function (plat) {
      var color = PLATFORM_COLORS[plat] || '#888';
      return '<span title="' + plat.toUpperCase() + '" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' + color + ';box-shadow:0 0 0 1px rgba(0,0,0,0.15);"></span>';
    }).join('');
    dotsSpan.style.cssText = 'display:inline-flex;gap:2px;align-items:center;flex-shrink:0;opacity:1;';
  }

  // Так само для week-card (тижневий вигляд)
  function processWeekCard(card) {
    if (card.__hqDotsApplied) return;
    card.__hqDotsApplied = true;

    var pid = card.dataset.id;
    if (!pid) return;
    var p = null;
    try { p = (typeof Store !== 'undefined' ? Store : window.Store).pub(pid); } catch (_) {}
    if (!p || !Array.isArray(p.platforms) || p.platforms.length === 0) return;

    var meta = card.querySelector('.wc-meta');
    if (!meta) return;

    // Перед meta додамо ряд з точками
    var dotsRow = card.querySelector('.wc-dots');
    if (!dotsRow) {
      dotsRow = document.createElement('div');
      dotsRow.className = 'wc-dots';
      dotsRow.style.cssText = 'display:flex;gap:3px;margin-top:4px;';
      meta.parentNode.insertBefore(dotsRow, meta);
    }
    dotsRow.innerHTML = p.platforms.map(function (plat) {
      var color = PLATFORM_COLORS[plat] || '#888';
      return '<span title="' + plat.toUpperCase() + '" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';box-shadow:0 0 0 1px rgba(0,0,0,0.15);"></span>';
    }).join('');
  }

  function processAll() {
    document.querySelectorAll('.cal-card[data-id]').forEach(processCard);
    document.querySelectorAll('.week-card[data-id]').forEach(processWeekCard);
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.querySelector('.cal-card, .week-card')) {
        clearTimeout(window.__hqCDTimer);
        window.__hqCDTimer = setTimeout(processAll, 30);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(processAll, 500);
  setTimeout(processAll, 1500);
  setTimeout(processAll, 4000);

  if (window.DEBUG) console.log('%cDreamCar HQ Calendar Dots %c· бренд-кольори платформ (#118)',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
