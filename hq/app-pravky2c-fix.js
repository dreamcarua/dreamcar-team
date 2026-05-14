/* ============================================================
   DreamCar HQ — Pravky-2c (robust approvers + meta fix)
   ============================================================ */

(function () {
  if (window.__hqPravky2c) return;
  window.__hqPravky2c = true;

  // =================================================================
  // FIX 1: Replace deprecated apple-mobile-web-app-capable
  // =================================================================
  try {
    var oldMeta = document.querySelector('meta[name="apple-mobile-web-app-capable"]');
    if (oldMeta) {
      // Додати новий поряд
      if (!document.querySelector('meta[name="mobile-web-app-capable"]')) {
        var newMeta = document.createElement('meta');
        newMeta.name = 'mobile-web-app-capable';
        newMeta.content = 'yes';
        oldMeta.parentNode.insertBefore(newMeta, oldMeta.nextSibling);
      }
      // Залишаємо старий для backward compat з iOS Safari
    } else {
      // Створити обидва
      var m1 = document.createElement('meta');
      m1.name = 'mobile-web-app-capable';
      m1.content = 'yes';
      document.head.appendChild(m1);
    }
  } catch (e) {}

  // =================================================================
  // FIX 2: Robust approvers re-render
  // =================================================================
  function findApproversChipRow() {
    // Шукаємо field з label "Погоджувачі" (під будь-яким style)
    var labels = document.querySelectorAll('.modal label');
    var apprField = null;
    for (var i = 0; i < labels.length; i++) {
      var text = (labels[i].textContent || '').toLowerCase().trim();
      if (/погоджув|approv/i.test(text)) {
        apprField = labels[i].closest('.field') || labels[i].parentElement;
        break;
      }
    }
    if (!apprField) return null;
    // Шукаємо chip-row під ним
    var chipRow = apprField.querySelector('.chip-row, .chips, [data-role="chip-row"]');
    if (!chipRow) {
      // Перебираємо все що йде після label
      var lbl = apprField.querySelector('label');
      if (lbl) {
        var sib = lbl.nextElementSibling;
        while (sib) {
          if (sib.querySelectorAll && sib.querySelectorAll('.chip').length > 0) {
            chipRow = sib;
            break;
          }
          sib = sib.nextElementSibling;
        }
      }
    }
    return chipRow;
  }

  function getCurrentPub() {
    if (window.__hqCurrentPub) return window.__hqCurrentPub;
    // Знайти з hash
    var hash = (location.hash || '').slice(1);
    if (hash.indexOf('publication/') === 0) {
      var pubId = hash.split('/')[1];
      var p = (window.Store && Store.pub && Store.pub(pubId));
      if (p) {
        window.__hqCurrentPub = p;
        return p;
      }
    }
    return null;
  }

  function rerenderApprovers() {
    var chipRow = findApproversChipRow();
    if (!chipRow) return false;
    var pub = getCurrentPub();
    if (!pub) return false;
    var currentApprovers = Array.isArray(pub.approvers) ? pub.approvers : [];

    // Всі юзери (включно members)
    var users = (window.Store && Store.users && Store.users()) || [];
    users = users.filter(function (u) { return u && u.is_active !== false; });
    if (users.length === 0) return false;

    // Перевірка — чи треба перерендерити (можливо вже всі юзери є)
    var currentChips = chipRow.querySelectorAll('.chip');
    if (currentChips.length === users.length) {
      // Можливо вже OK — перевіримо чи всі імена є
      var renderedNames = Array.from(currentChips).map(function (c) { return c.textContent.trim(); });
      var allPresent = users.every(function (u) {
        return renderedNames.some(function (n) { return n.indexOf(u.name) >= 0; });
      });
      if (allPresent) return true;  // OK, нічого не міняти
    }

    // Re-render
    chipRow.innerHTML = users.map(function (u) {
      var on = currentApprovers.indexOf(u.id) >= 0;
      return '<div class="chip ' + (on ? 'on' : '') + '" data-user-id="' + u.id + '" data-approver-uid="' + u.id + '">' +
        (u.initial || (u.name || '?')[0]) + ' · ' + (u.name || '?') +
        '</div>';
    }).join('');

    chipRow.querySelectorAll('[data-approver-uid]').forEach(function (chip) {
      chip.onclick = function () {
        var uid = chip.dataset.approverUid;
        if (!pub.approvers) pub.approvers = [];
        var ix = pub.approvers.indexOf(uid);
        if (ix >= 0) pub.approvers.splice(ix, 1);
        else pub.approvers.push(uid);
        chip.classList.toggle('on');
        if (typeof window.autosave === 'function') {
          try { window.autosave(pub); } catch (_) {}
        }
      };
    });

    console.log('%cDreamCar HQ Approvers 2c %c· rerendered ' + users.length + ' chips',
      'color:#fbbf24;font-weight:700;', 'color:#888;');
    return true;
  }

  // ---- Triggers ----
  // 1. Глобальний body observer — спрацьовує коли модалка з'являється
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      // Модалка відкрита?
      if (document.getElementById('modalBackdrop')?.classList.contains('open')) {
        clearTimeout(window.__hq2cTimer);
        window.__hq2cTimer = setTimeout(rerenderApprovers, 150);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // 2. Кожні 2с перевіряти якщо модалка відкрита
  setInterval(function () {
    if (document.getElementById('modalBackdrop')?.classList.contains('open')) {
      rerenderApprovers();
    }
  }, 2000);

  // 3. Click на cal-card / board-card / new pub — re-render через delay
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (!el || !el.closest) return;
    var trigger = el.closest('.cal-card, .week-card, .board-card, .list-table tr, #addPubBtn, .cal-day');
    if (trigger) {
      [300, 700, 1500].forEach(function (ms) { setTimeout(rerenderApprovers, ms); });
    }
  }, true);

  // 4. hashchange (відкриття pub через URL)
  window.addEventListener('hashchange', function () {
    [400, 1200, 2500].forEach(function (ms) { setTimeout(rerenderApprovers, ms); });
  });

  // 5. Initial — якщо вже відкрита модалка
  [500, 1500, 3000].forEach(function (ms) { setTimeout(rerenderApprovers, ms); });

  console.log('%cDreamCar HQ Pravky-2c %c· robust approvers + meta fix active',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
