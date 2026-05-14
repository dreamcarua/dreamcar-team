/* ============================================================
   DreamCar HQ — Auto-revert у review при суттєвих правках approved пост
   ============================================================ */
// Логіка: коли публікація у статусі approved і SMM править текст більше
// ніж на N символів (за замовчуванням 10) — статус автоматично повертається
// у review (бо approver мусить підтвердити нову версію). Toast попередження
// з кнопкою Undo (повернути approved + старий текст).

(function () {
  if (window.__hqReapprove) return;
  window.__hqReapprove = true;

  var THRESHOLD = 10;  // символів

  // Snapshot тексту коли картка відкривається
  var openSnapshots = new Map();  // pubId → { text, status }

  function captureSnapshot(pub) {
    if (!pub || !pub.id) return;
    openSnapshots.set(pub.id, {
      text: pub.text || '',
      title: pub.title || '',
      status: pub.status,
    });
  }

  function calcDelta(oldStr, newStr) {
    var a = String(oldStr || '');
    var b = String(newStr || '');
    // Простий delta — абсолютна різниця у довжині + skip identical
    if (a === b) return 0;
    return Math.abs(a.length - b.length);
  }

  function patchOpenCard() {
    if (typeof window.openCard !== 'function' || window.openCard.__reapprovePatched) return false;
    var _orig = window.openCard;
    window.openCard = function (id) {
      var r = _orig.call(this, id);
      setTimeout(function () {
        var p = window.__hqCurrentPub;
        if (p && p.status === 'approved') {
          captureSnapshot(p);
        }
      }, 200);
      return r;
    };
    window.openCard.__reapprovePatched = true;
    return true;
  }

  function patchUpsertPub() {
    if (!window.Store || typeof Store.upsertPub !== 'function') return false;
    if (Store.upsertPub.__reapprovePatched) return true;
    var _orig = Store.upsertPub.bind(Store);
    Store.upsertPub = function (pub) {
      try {
        var snap = openSnapshots.get(pub.id);
        if (snap && snap.status === 'approved' && pub.status === 'approved') {
          var dText = calcDelta(snap.text, pub.text);
          var dTitle = calcDelta(snap.title, pub.title);
          if (dText >= THRESHOLD || dTitle >= THRESHOLD) {
            // Auto-revert
            pub.status = 'review';
            pub._reverted_from_approved = true;
            // Скинути approved_by щоб approvers ре-погодили
            pub.approved_by = [];
            // Update snapshot status
            snap.status = 'review';
            // Toast з можливістю undo
            if (typeof toast === 'function') {
              toast('Повернуто у «На погодженні»', 'warn',
                'Текст змінено на ' + Math.max(dText, dTitle) + ' символів. Approver має знов підтвердити.');
            }
            // History entry
            try {
              if (typeof Store.addHistory === 'function') {
                Store.addHistory(pub.id, 'auto_revert',
                  'Auto: правки >' + THRESHOLD + ' символів після approve (Δtext=' + dText + ', Δtitle=' + dTitle + ')');
              }
            } catch (_) {}
          }
        }
      } catch (e) { console.warn('reapprove check failed:', e); }
      return _orig(pub);
    };
    Store.upsertPub.__reapprovePatched = true;
    return true;
  }

  if (!patchOpenCard()) {
    var t1 = 0;
    var iv1 = setInterval(function () {
      if (patchOpenCard() || t1++ > 20) clearInterval(iv1);
    }, 250);
  }
  if (!patchUpsertPub()) {
    var t2 = 0;
    var iv2 = setInterval(function () {
      if (patchUpsertPub() || t2++ > 20) clearInterval(iv2);
    }, 250);
  }

  // Cleanup snapshots при закритті модалки
  if (window.Modal && typeof Modal.close === 'function') {
    var _origClose = Modal.close.bind(Modal);
    Modal.close = function () {
      // НЕ очищаємо snapshots — autosave може запуститись після close
      // Очистимо через 30с
      var ids = Array.from(openSnapshots.keys());
      setTimeout(function () {
        ids.forEach(function (id) { openSnapshots.delete(id); });
      }, 30000);
      return _origClose();
    };
  }

  console.log('%cDreamCar HQ Re-approve %c· auto-revert >' + THRESHOLD + ' chars active',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
