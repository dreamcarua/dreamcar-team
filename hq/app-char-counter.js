/* ============================================================
   DreamCar HQ — Per-Platform Char Counter (#117)
   ============================================================ */
// Замість простого "347/5000 символів" — показуємо ліміт для КОЖНОЇ
// обраної платформи: "IG 347/2200 · TG 347/4096 · Threads 347/500 ⚠️"
// Червоніє коли > 90% ліміту, з ⚠️ коли overflow.

(function () {
  if (window.__hqCharCounter) return;
  window.__hqCharCounter = true;

  // #387 (14.06.2026): TG ліміт ЗАЛЕЖИТЬ від наявності медіа.
  // sendMessage (text-only) → 4096 chars. sendVideo/sendPhoto/sendMediaGroup caption → 1024 chars.
  // Telegram рахує усі символи РАЗОМ з HTML тегами (<b>, <i>, <a href="...">, тощо).
  // Корінь: #383 — мій тестовий пост з ~1500 chars провалився "Bad Request: caption is too long".
  //
  // Реальні ліміти символів caption/post body
  var LIMITS = {
    ig: { name: 'IG', limit: 2200 },
    fb: { name: 'FB', limit: 63206 },
    tg: { name: 'TG', limit: 4096 },  // оновлюється динамічно у getEffectiveLimit
    tt: { name: 'TT', limit: 2200 },
    yt: { name: 'YT', limit: 5000 },
    th: { name: 'Threads', limit: 500 },
  };

  // Чи є хоч 1 прикріплений creative у редакторі?
  // Якщо так → TG sendVideo/Photo/MediaGroup ліміт caption = 1024 (з HTML)
  function hasMediaAttached() {
    var strip = document.getElementById('f_creatives');
    if (!strip) return false;
    var items = strip.querySelectorAll('.cs-item');
    return items && items.length > 0;
  }

  function getEffectiveLimit(platformId) {
    var lim = LIMITS[platformId];
    if (!lim) return null;
    // TG особливий випадок — caption (з медіа) = 1024, sendMessage (без медіа) = 4096
    if (platformId === 'tg' && hasMediaAttached()) {
      return { name: 'TG (caption)', limit: 1024 };
    }
    return lim;
  }

  function updateCounter() {
    var textEl = document.getElementById('f_text');
    if (!textEl) return;
    var len = (textEl.value || '').length;

    var counter = document.getElementById('f_textCount');
    var hint = counter && counter.closest('.hint');
    if (!hint) return;

    // Знайти обрані платформи (з chip.on у #f_platforms)
    var selected = [];
    document.querySelectorAll('#f_platforms .chip.on').forEach(function (c) {
      var id = c.dataset.platform;
      if (LIMITS[id]) selected.push(id);
    });

    if (selected.length === 0) {
      hint.innerHTML = '<span id="f_textCount">' + len + '</span> символів · ' +
        '<span style="color:#8a8a95;">обери майданчики щоб побачити ліміти</span>';
      return;
    }

    var parts = selected.map(function (id) {
      var lim = getEffectiveLimit(id);  // #387: TG динамічний 1024/4096
      if (!lim) return '';
      var pct = lim.limit > 0 ? len / lim.limit : 0;
      var color;
      var weight = '500';
      var icon = '';
      if (pct >= 1) {
        color = '#E30613';
        weight = '800';
        icon = ' ⚠️';
      } else if (pct >= 0.9) {
        color = '#FF1A2B';
        weight = '700';
      } else if (pct >= 0.7) {
        color = '#fbbf24';
      } else {
        color = '#8a8a95';
      }
      return '<span style="color:' + color + ';font-weight:' + weight + ';">' +
        lim.name + ' ' + len + '/' + lim.limit + icon + '</span>';
    });

    hint.innerHTML = parts.join(' · ');
  }

  // Підв'язатися до input на textarea
  function bindTextInput() {
    var textEl = document.getElementById('f_text');
    if (!textEl || textEl.__hqCharCounted) return;
    textEl.__hqCharCounted = true;
    textEl.addEventListener('input', updateCounter);
    textEl.addEventListener('change', updateCounter);
    updateCounter();
  }

  // Підв'язатися до chip-кліків (платформ)
  function bindPlatformChips() {
    document.querySelectorAll('#f_platforms .chip').forEach(function (chip) {
      if (chip.__hqCharCounted) return;
      chip.__hqCharCounted = true;
      // Не блокуємо оригінальний onclick — просто додаємо listener
      chip.addEventListener('click', function () {
        // toggle відбувається у оригінальному handler, потім ми оновлюємо counter
        setTimeout(updateCounter, 30);
      });
    });
  }

  // #387: спостерігаємо за #f_creatives — коли користувач додає/видаляє creative
  // ліміт TG змінюється між 1024 (з медіа) і 4096 (без), counter має одразу перерахуватись
  function bindCreativesObserver() {
    var strip = document.getElementById('f_creatives');
    if (!strip || strip.__hqCCObserved) return;
    strip.__hqCCObserved = true;
    if ('MutationObserver' in window) {
      var stripMo = new MutationObserver(function () {
        clearTimeout(window.__hqCCStripTimer);
        window.__hqCCStripTimer = setTimeout(updateCounter, 30);
      });
      stripMo.observe(strip, { childList: true, subtree: true });
    }
  }

  function rebind() {
    bindTextInput();
    bindPlatformChips();
    bindCreativesObserver();
    updateCounter();
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.getElementById('f_text') || document.getElementById('f_platforms') || document.getElementById('f_creatives')) {
        clearTimeout(window.__hqCCTimer);
        window.__hqCCTimer = setTimeout(rebind, 50);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(rebind, 500);
  setTimeout(rebind, 1500);
  setTimeout(rebind, 4000);

  console.log('%cDreamCar HQ Char Counter %c· per-platform limits (#117)',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
