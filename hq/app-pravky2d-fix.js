/* ============================================================
   DreamCar HQ — Pravky-2d: f_appr direct fix
   ============================================================ */
// Approvers chip-row має id="f_appr" — таргетуємо напряму через ID.
// Re-render з усіма active users (включно members) щоразу як змінюється модал.

(function () {
  if (window.__hqPravky2d) return;
  window.__hqPravky2d = true;

  function rerenderApprovers() {
    var chipRow = document.getElementById('f_appr');
    if (!chipRow) return false;

    var pub = window.__hqCurrentPub;
    if (!pub) {
      // Спробуємо знайти через hash
      var hash = (location.hash || '').slice(1);
      if (hash.indexOf('publication/') === 0) {
        var pubId = hash.split('/')[1];
        pub = (window.Store && Store.pub && Store.pub(pubId));
        if (pub) window.__hqCurrentPub = pub;
      }
    }
    if (!pub) return false;

    var currentApprovers = Array.isArray(pub.approvers) ? pub.approvers : [];

    var users = (window.Store && Store.users && Store.users()) || [];
    users = users.filter(function (u) { return u && u.is_active !== false; });
    if (users.length === 0) return false;

    // Чи треба re-render? Перевіряємо чи ВСІ users присутні
    var existingChips = chipRow.querySelectorAll('.chip');
    var existingUserIds = Array.from(existingChips).map(function (c) { return c.dataset.user; }).filter(Boolean);
    var allPresent = users.every(function (u) { return existingUserIds.indexOf(u.id) >= 0; });
    if (allPresent && existingChips.length === users.length) return true;

    // Re-render
    chipRow.innerHTML = users.map(function (u) {
      var on = currentApprovers.indexOf(u.id) >= 0;
      return '<div class="chip ' + (on ? 'on' : '') + '" data-user="' + u.id + '">' +
        (u.initial || (u.name || '?')[0]) + ' · ' + (u.name || '?') +
        '</div>';
    }).join('');

    chipRow.querySelectorAll('.chip').forEach(function (chip) {
      chip.onclick = function () {
        var uid = chip.dataset.user;
        if (!Array.isArray(pub.approvers)) pub.approvers = [];
        var ix = pub.approvers.indexOf(uid);
        if (ix >= 0) pub.approvers.splice(ix, 1);
        else pub.approvers.push(uid);
        chip.classList.toggle('on');
        if (typeof window.autosave === 'function') {
          try { window.autosave(pub); } catch (_) {}
        }
      };
    });

    console.log('%cDreamCar HQ Approvers 2d %c· rerendered ' + users.length + ' users (з members)',
      'color:#fbbf24;font-weight:700;', 'color:#888;');
    return true;
  }

  // ---- Triggers ----
  // 1. MutationObserver на #f_appr — якщо вже існує
  function observeFApp() {
    var chipRow = document.getElementById('f_appr');
    if (!chipRow) return false;
    if (chipRow.__pravky2dObserved) return true;
    var mo = new MutationObserver(function (muts) {
      // Якщо хтось перерендерив (наприклад app-views.js) — повторно прокачаємо
      var chips = chipRow.querySelectorAll('.chip');
      var users = (window.Store && Store.users && Store.users()) || [];
      var realUsersCount = users.filter(function (u) { return u && u.is_active !== false; }).length;
      if (chips.length < realUsersCount) {
        clearTimeout(window.__hq2dTimer);
        window.__hq2dTimer = setTimeout(rerenderApprovers, 100);
      }
    });
    mo.observe(chipRow, { childList: true });
    chipRow.__pravky2dObserved = true;
    return true;
  }

  // 2. Body observer — coли #f_appr з'являється у DOM
  if ('MutationObserver' in window) {
    var bodyMo = new MutationObserver(function () {
      if (document.getElementById('f_appr')) {
        observeFApp();
        clearTimeout(window.__hq2dTimerB);
        window.__hq2dTimerB = setTimeout(rerenderApprovers, 50);
      }
    });
    bodyMo.observe(document.body, { childList: true, subtree: true });
  }

  // 3. Кожні 1.5с — fallback
  setInterval(function () {
    if (document.getElementById('f_appr')) {
      rerenderApprovers();
    }
  }, 1500);

  // 4. На click на cal-card etc.
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!el || !el.closest) return;
    var trigger = el.closest('.cal-card, .week-card, .board-card, .list-table tr, #addPubBtn, .cal-day');
    if (trigger) {
      [200, 500, 1000, 2000].forEach(function (ms) { setTimeout(rerenderApprovers, ms); });
    }
  }, true);

  // 5. hashchange
  window.addEventListener('hashchange', function () {
    [400, 1000, 2000].forEach(function (ms) { setTimeout(rerenderApprovers, ms); });
  });

  // 6. Initial
  [500, 1500, 3000].forEach(function (ms) {
    setTimeout(function () {
      observeFApp();
      rerenderApprovers();
    }, ms);
  });

  console.log('%cDreamCar HQ Pravky-2d %c· f_appr direct fix active',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
