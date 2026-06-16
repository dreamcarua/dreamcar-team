/* ============================================================
   DreamCar HQ — Per-platform cell expansion у Calendar
   ============================================================ */
// Користувач хоче: пост на IG+TG показувати як 2 окремі картки
// (з іконкою кожної платформи), щоб у view "Всі платформи" бути видно
// "проплішини" (де реально менше контенту ніж здається).

(function () {
  if (window.__hqPerPlat) return;
  window.__hqPerPlat = true;

  function patch() {
    if (!window.Store || typeof Store.pubs !== 'function') return false;
    if (Store.pubs.__perPlatExpanded) return true;
    var _origPubs = Store.pubs.bind(Store);
    var lastResult = null;
    var lastInput = null;

    // Helper: розгорнути 1 pub у N copies (по 1 на платформу)
    function expandPub(p) {
      var plats = Array.isArray(p.platforms) ? p.platforms : [];
      if (plats.length <= 1) return [p];
      return plats.map(function (plat) {
        // Створюємо shallow-copy з прапором _platform і обмеженим масивом
        var copy = Object.assign({}, p, {
          platforms: [plat],
          _platform: plat,
          _origId: p.id,
          _isClone: true,
        });
        return copy;
      });
    }

    Store.pubs = function () {
      var orig = _origPubs();
      // Cache by reference
      if (orig === lastInput && lastResult) return lastResult;
      var expanded = [];
      orig.forEach(function (p) {
        // Якщо вже clone — пропустити expansion (захист)
        if (p._isClone) { expanded.push(p); return; }
        expandPub(p).forEach(function (c) { expanded.push(c); });
      });
      lastInput = orig;
      lastResult = expanded;
      return expanded;
    };
    Store.pubs.__perPlatExpanded = true;

    // Store.pub(id) — має повертати оригінал, не clone
    var _origPub = Store.pub.bind(Store);
    Store.pub = function (id) {
      // Якщо id має префікс — extract origId
      var origId = id;
      if (id && typeof id === 'string' && id.indexOf('::') > 0) {
        origId = id.split('::')[0];
      }
      return _origPub(origId);
    };
    return true;
  }

  if (!patch()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (patch() || tries++ > 20) clearInterval(iv);
    }, 250);
  }

  // ---- Override openCard щоб резолвити _origId ----
  function patchOpenCard() {
    if (typeof window.openCard !== 'function' || window.openCard.__perPlat) return false;
    var _orig = window.openCard;
    window.openCard = function (id) {
      // Якщо передано clone id з ::PLATFORM — забрати origId
      if (id && typeof id === 'string' && id.indexOf('::') > 0) {
        id = id.split('::')[0];
      }
      return _orig.call(this, id);
    };
    window.openCard.__perPlat = true;
    return true;
  }
  patchOpenCard();
  setTimeout(patchOpenCard, 500);
  setTimeout(patchOpenCard, 1500);

  // ---- Override platformIcons щоб показувати лише one platform для clones ----
  // Це працює бо renderMonth/Week передає p.platforms у platformIcons.
  // Оскільки наш expanded clone має platforms=[singlePlat] — icons показує тільки одну.

  // Tweak data-id у calendar cards щоб містити platform suffix (для DOM unique)
  // Зробимо через MutationObserver
  function fixDuplicateIds() {
    document.querySelectorAll('.cal-card, .week-card, .list-table tr').forEach(function (el) {
      var id = el.dataset.id;
      if (!id) return;
      // Якщо у DOM є дублікати з тим самим data-id — додати platform suffix з clone
      // Складно без перерендеру — пропустимо для початку
    });
  }

  if (window.DEBUG) console.log('%cDreamCar HQ Per-platform expansion %c· active',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
