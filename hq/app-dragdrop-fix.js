/* ============================================================
   DreamCar HQ — Drag-Drop Off-By-One Fix v3 (calendar)
   ============================================================ */
// v1: global capture + stopProp → дублі, race із attachCalendarHandlers
// v2: per-cell override + elementFromPoint(e.clientX,e.clientY) → досі off-by-one
// v3: трекаємо cursor на КОЖНОМУ dragover (там clientX/Y точні),
//     на drop використовуємо ОСТАННІЙ tracked cursor → скануємо всі
//     .cal-day getBoundingClientRect щоб знайти ТОЧНО ту, що під cursor.
//     Це обходить і ghost-image hit-test, і випадки коли drop event
//     приходить з clientX=0 або з застарілими координатами.

(function () {
  if (window.__hqDragDropFixV3) return;
  window.__hqDragDropFixV3 = true;
  // Блокуємо v1 і v2 повторні запуски
  window.__hqDragDropFix = true;
  window.__hqDragDropFixV2 = true;

  // Tracked cursor (оновлюється на КОЖНОМУ dragover globally)
  var trackedX = -1;
  var trackedY = -1;

  function safeStore() {
    try { return typeof Store !== 'undefined' ? Store : (window.Store || null); }
    catch (_) { return window.Store || null; }
  }
  function safeFmtTime(dt) {
    try { if (typeof fmtTime === 'function') return fmtTime(dt); } catch (_) {}
    var d = new Date(dt);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function safeFmtDate(dt) {
    try { if (typeof fmtDate === 'function') return fmtDate(dt); } catch (_) {}
    var d = new Date(dt);
    return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
  }
  function safeToast(t, k, m) {
    try { if (typeof toast === 'function') { toast(t, k, m); return; } } catch (_) {}
    if (typeof window.toast === 'function') window.toast(t, k, m);
  }
  function safeRerender() {
    try { if (typeof renderCalBody === 'function') { renderCalBody(); return; } } catch (_) {}
    try { if (typeof navigate === 'function') { navigate(); return; } } catch (_) {}
    try {
      var h = location.hash;
      location.hash = '#__hq_force__';
      setTimeout(function () { location.hash = h; }, 10);
    } catch (_) {}
  }

  // BOUNDING-RECT scan — найточніший спосіб знайти cell під точкою
  function findCellByPoint(x, y) {
    if (x < 0 || y < 0) return null;
    var cells = document.querySelectorAll('.cal-day');
    if (cells.length === 0) return null;
    // Direct hit
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return cells[i];
      }
    }
    // Nearest cell (fallback на випадок якщо point на 1px gap)
    var nearest = null;
    var minDist = Infinity;
    for (var j = 0; j < cells.length; j++) {
      var rr = cells[j].getBoundingClientRect();
      var cx = rr.left + rr.width / 2;
      var cy = rr.top + rr.height / 2;
      var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < minDist) { minDist = d; nearest = cells[j]; }
    }
    return nearest;
  }

  // GLOBAL cursor tracking — оновлюємо trackedX/Y на кожному русі під час drag
  document.addEventListener('dragover', function (e) {
    trackedX = e.clientX;
    trackedY = e.clientY;
    // visual: підсвітити правильну клітинку
    if (document.querySelector('.cal-day')) {
      var real = findCellByPoint(e.clientX, e.clientY);
      document.querySelectorAll('.cal-day.drop-over').forEach(function (c) {
        if (c !== real) c.classList.remove('drop-over');
      });
      if (real) real.classList.add('drop-over');
    }
  }, true);

  document.addEventListener('dragend', function () {
    trackedX = -1; trackedY = -1;
    document.querySelectorAll('.cal-day.drop-over').forEach(function (c) {
      c.classList.remove('drop-over');
    });
  }, true);

  function bindCell(el) {
    if (el.__hqDDFv3) return;
    el.__hqDDFv3 = true;

    el.ondragover = function (e) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    };
    el.ondragleave = function () {};

    el.ondrop = function (e) {
      e.preventDefault();
      e.stopPropagation();

      // На drop використовуємо TRACKED координати (з останнього dragover) —
      // це обходить випадки коли drop event має застарілі/0/неточні clientX/Y.
      var x = (e.clientX !== undefined && e.clientX > 0) ? e.clientX : trackedX;
      var y = (e.clientY !== undefined && e.clientY > 0) ? e.clientY : trackedY;

      document.querySelectorAll('.cal-day.drop-over').forEach(function (c) {
        c.classList.remove('drop-over');
      });

      var target = findCellByPoint(x, y);
      if (!target || !target.dataset.date) {
        // Останній fallback: bound el
        target = el;
        console.warn('[DDFv3] fallback to bound el; tracked=(' + x + ',' + y + '), bound=' + el.dataset.date);
      }

      var S = safeStore();
      if (!S || typeof S.pub !== 'function') {
        console.warn('[DDFv3] Store недоступний');
        return;
      }

      var pid;
      try { pid = e.dataTransfer.getData('text/plain'); } catch (_) {}
      if (!pid) return;

      var p = S.pub(pid);
      if (!p) return;

      var oldDate = safeFmtDate(p.dateTime);
      var newDt = new Date(target.dataset.date + 'T' + safeFmtTime(p.dateTime) + ':00');
      if (isNaN(newDt.getTime())) return;
      var newDateStr = safeFmtDate(newDt);
      if (oldDate === newDateStr) {
        console.log('[DDFv3] same date, skip');
        trackedX = -1; trackedY = -1;
        return;
      }

      p.dateTime = newDt.toISOString();
      p.updatedAt = new Date().toISOString();

      try { S.upsertPub(p); } catch (err) { console.error('[DDFv3] upsert:', err); return; }
      try { if (S.addHistory) S.addHistory(p.id, 'move', oldDate + ' → ' + newDateStr); } catch (_) {}

      safeToast('Перенесено', 'success', (p.title || 'Пост') + ' → ' + newDateStr);
      console.log('[DDFv3] ' + p.id + ': ' + oldDate + ' → ' + newDateStr +
        ' | target=' + target.dataset.date + ' | bound=' + el.dataset.date +
        ' | cursor=(' + x + ',' + y + ')');

      trackedX = -1; trackedY = -1;
      safeRerender();
    };
  }

  function bindAllCells() {
    document.querySelectorAll('.cal-day').forEach(bindCell);
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.querySelector('.cal-day')) {
        clearTimeout(window.__hqDDFv3Timer);
        window.__hqDDFv3Timer = setTimeout(bindAllCells, 30);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(bindAllCells, 500);
  setTimeout(bindAllCells, 1500);
  setTimeout(bindAllCells, 4000);

  console.log('%cDreamCar HQ DragDrop Fix v3 %c· tracked cursor + bounding-rect scan',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
