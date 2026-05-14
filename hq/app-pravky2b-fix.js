/* ============================================================
   DreamCar HQ — Pravky-2b (post-mortem fixes)
   ============================================================ */
// 1) Approvers picker — показати ВСІХ user (включно member) — Артема нема бо app-views фільтрує
// 2) __hqCurrentPub для нових pubs (новий openCard зберігає p якщо id='new' теж)
// 3) AudioContext — створити одразу + listen на ANY user gesture for resume

(function () {
  if (window.__hqPravky2b) return;
  window.__hqPravky2b = true;

  // =================================================================
  // #1 — Approvers picker: re-render усіма юзерами
  // =================================================================
  function rerenderApproversPicker() {
    var modal = document.getElementById('modal');
    if (!modal) return;
    // Знаходимо approvers field — по label "погоджувачі" або id
    var labels = modal.querySelectorAll('.field label, .field .label, label');
    var apprField = null;
    labels.forEach(function (lbl) {
      var text = (lbl.textContent || '').toLowerCase();
      if (text.indexOf('погоджувач') >= 0 || text.indexOf('погодж') >= 0) {
        apprField = lbl.closest('.field') || lbl.parentElement;
      }
    });
    if (!apprField) return;
    var chipRow = apprField.querySelector('.chip-row, .chips, [data-role="chip-row"]');
    if (!chipRow) {
      // Find chip-row by структурі — після label
      var nextEl = apprField.querySelector('label') ? apprField.querySelector('label').nextElementSibling : null;
      if (nextEl && nextEl.querySelectorAll('.chip').length > 0) chipRow = nextEl;
    }
    if (!chipRow) return;

    // Знайти поточний pub
    var pub = window.__hqCurrentPub;
    var currentApprovers = (pub && pub.approvers) || [];

    // Active users — використовуємо ВСІХ
    var users = (Store && Store.users && Store.users()) || [];
    users = users.filter(function (u) { return u && u.is_active !== false; });

    // Re-render chip-row
    chipRow.innerHTML = users.map(function (u) {
      var on = currentApprovers.indexOf(u.id) >= 0;
      return '<div class="chip ' + (on ? 'on' : '') + '" data-user-id="' + u.id + '" data-approver-uid="' + u.id + '">' +
        (u.initial || (u.name || '?')[0]) + ' · ' + (u.name || '?') +
        '</div>';
    }).join('');

    // Wire clicks
    chipRow.querySelectorAll('[data-approver-uid]').forEach(function (chip) {
      chip.onclick = function () {
        var uid = chip.dataset.approverUid;
        if (!pub) return;
        if (!Array.isArray(pub.approvers)) pub.approvers = [];
        var ix = pub.approvers.indexOf(uid);
        if (ix >= 0) pub.approvers.splice(ix, 1);
        else pub.approvers.push(uid);
        chip.classList.toggle('on');
        if (typeof window.autosave === 'function') window.autosave(pub);
      };
    });

    console.log('%cDreamCar HQ Approvers re-render %c· ' + users.length + ' users (з members)',
      'color:#fbbf24;font-weight:700;', 'color:#888;');
  }

  function patchOpenCardForApprovers() {
    if (typeof window.openCard !== 'function' || window.openCard.__pravky2b) return false;
    var _orig = window.openCard;
    window.openCard = function (id) {
      var r = _orig.call(this, id);
      setTimeout(function () {
        // Set __hqCurrentPub для нових pubs (баг у app-patches.js — null коли id='new')
        if (!window.__hqCurrentPub && id && id !== 'new') {
          var p = Store.pub && Store.pub(id);
          if (p) window.__hqCurrentPub = p;
        }
        // Якщо це нова publication і __hqCurrentPub все ще null — спробуємо знайти через DOM
        if (!window.__hqCurrentPub) {
          // Можливо у app-core є newPubObject обʼєкт у пам'яті
          // Подивимось останню створену
          var pubs = (Store.pubs && Store.pubs()) || [];
          // Сортуємо по createdAt desc
          var sorted = pubs.slice().sort(function (a, b) {
            return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
          });
          if (sorted.length > 0) {
            window.__hqCurrentPub = sorted[0];
          }
        }
        rerenderApproversPicker();
      }, 250);
      setTimeout(rerenderApproversPicker, 800);
      return r;
    };
    window.openCard.__pravky2b = true;
    return true;
  }
  if (!patchOpenCardForApprovers()) {
    var t1 = 0;
    var iv1 = setInterval(function () {
      if (patchOpenCardForApprovers() || t1++ > 30) clearInterval(iv1);
    }, 200);
  }

  // Також re-render approvers при будь-якому MutationObserver на modal — на випадок якщо app-views перерендерує
  if ('MutationObserver' in window) {
    var modalEl = document.getElementById('modal');
    if (modalEl) {
      var mo = new MutationObserver(function () {
        clearTimeout(window.__hqApproversTimer);
        window.__hqApproversTimer = setTimeout(rerenderApproversPicker, 100);
      });
      mo.observe(modalEl, { childList: true, subtree: false });
    }
  }

  // =================================================================
  // #2 — AudioContext eager init + global gesture listener
  // =================================================================
  function eagerInitAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!window.__hqAudioCtxPersist) {
        window.__hqAudioCtxPersist = new AC();
        console.log('%cDreamCar HQ Audio %c· context created, state=' + window.__hqAudioCtxPersist.state,
          'color:#fbbf24;font-weight:700;', 'color:#888;');
      }
    } catch (e) { console.warn('eager audio init:', e); }
  }
  eagerInitAudio();

  function resumeAudio() {
    var ctx = window.__hqAudioCtxPersist;
    if (!ctx) {
      eagerInitAudio();
      return;
    }
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().then(function () {
        console.log('%cDreamCar HQ Audio %c· resumed, state=' + ctx.state,
          'color:#fbbf24;font-weight:700;', 'color:#888;');
      }).catch(function () {});
    }
  }
  // Listen на ВСІ user gestures (НЕ removeEventListener — на випадок повторного suspend)
  document.addEventListener('click', resumeAudio, true);
  document.addEventListener('keydown', resumeAudio, true);
  document.addEventListener('touchstart', resumeAudio, true);
  document.addEventListener('pointerdown', resumeAudio, true);

  // =================================================================
  // #3 — Diagnostic: проверка realtime channels stability
  // =================================================================
  setTimeout(function () {
    var sb = window.supabase;
    if (!sb || !sb.realtime || !sb.realtime.channels) return;
    var channels = sb.realtime.channels;
    var states = channels.map(function (c) { return c.topic + ':' + c.state; });
    console.log('%cDreamCar HQ RT channels %c· ' + states.join(', '),
      'color:#7ab0ff;font-weight:700;', 'color:#888;');
    // Якщо comments-card-rt відсутній — re-subscribe
    var hasCommentsRT = channels.some(function (c) {
      return c.topic.indexOf('comments-card-rt') >= 0 && c.state === 'joined';
    });
    if (!hasCommentsRT) {
      console.warn('comments-card-rt not joined, manually re-subscribing...');
      // Re-trigger pravky2 subscribe
      if (window.__hqCommentsRtChan) {
        try { window.__hqCommentsRtChan.unsubscribe(); } catch (_) {}
        window.__hqCommentsRtChan = null;
      }
    }
  }, 3000);

  console.log('%cDreamCar HQ Pravky-2b %c· approvers fix + audio eager + cur-pub fix active',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
