/* ============================================================
   DreamCar HQ — Drag-Drop Off-By-One Fix v4 (calendar month + week)
   ============================================================ */
// v1: global capture + stopProp → дублі, race із attachCalendarHandlers
// v2: per-cell override + elementFromPoint(e.clientX,e.clientY) → досі off-by-one
// v3: трекаємо cursor на КОЖНОМУ dragover (там clientX/Y точні),
//     на drop використовуємо ОСТАННІЙ tracked cursor → скануємо всі
//     .cal-day getBoundingClientRect щоб знайти ТОЧНО ту, що під cursor.
// v4: ТОЙ САМИЙ bounding-rect scan тепер працює і для week view (.week-col).
//     Картки тижня (.week-card[draggable]) перетягуються між колонками днів →
//     дата змінюється так само як у місяці. Selector cells = .cal-day, .week-col[data-date].

(function () {
  if (window.__hqDragDropFixV4) return;
  window.__hqDragDropFixV4 = true;
  // Блокуємо попередні версії повторні запуски
  window.__hqDragDropFix = true;
  window.__hqDragDropFixV2 = true;
  window.__hqDragDropFixV3 = true;

  // Селектор усіх drop-зон (місяць + тиждень). week-col без data-date (renderDay) ігноруємо.
  var CELL_SELECTOR = '.cal-day, .week-col[data-date]';

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

  // BOUNDING-RECT scan — найточніший спосіб знайти cell під точкою.
  // Скануємо лише клітинки що мають data-date (валідна drop-зона).
  function findCellByPoint(x, y) {
    if (x < 0 || y < 0) return null;
    var cells = document.querySelectorAll(CELL_SELECTOR);
    if (cells.length === 0) return null;
    // Direct hit
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i].dataset.date) continue;
      var r = cells[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return cells[i];
      }
    }
    // Nearest cell (fallback на випадок якщо point на 1px gap)
    var nearest = null;
    var minDist = Infinity;
    for (var j = 0; j < cells.length; j++) {
      if (!cells[j].dataset.date) continue;
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
    if (document.querySelector(CELL_SELECTOR)) {
      var real = findCellByPoint(e.clientX, e.clientY);
      document.querySelectorAll('.cal-day.drop-over, .week-col.drop-over').forEach(function (c) {
        if (c !== real) c.classList.remove('drop-over');
      });
      if (real) real.classList.add('drop-over');
    }
  }, true);

  document.addEventListener('dragend', function () {
    trackedX = -1; trackedY = -1;
    document.querySelectorAll('.cal-day.drop-over, .week-col.drop-over').forEach(function (c) {
      c.classList.remove('drop-over');
    });
  }, true);

  function bindCell(el) {
    if (el.__hqDDFv4) return;
    el.__hqDDFv4 = true;

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

      document.querySelectorAll('.cal-day.drop-over, .week-col.drop-over').forEach(function (c) {
        c.classList.remove('drop-over');
      });

      var target = findCellByPoint(x, y);
      if (!target || !target.dataset.date) {
        // Останній fallback: bound el
        target = el;
        console.warn('[DDFv4] fallback to bound el; tracked=(' + x + ',' + y + '), bound=' + el.dataset.date);
      }

      var S = safeStore();
      if (!S || typeof S.pub !== 'function') {
        console.warn('[DDFv4] Store недоступний');
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
        if (window.DEBUG) console.log('[DDFv4] same date, skip');
        trackedX = -1; trackedY = -1;
        return;
      }

      p.dateTime = newDt.toISOString();
      p.updatedAt = new Date().toISOString();

      try { S.upsertPub(p); } catch (err) { console.error('[DDFv4] upsert:', err); return; }
      try { if (S.addHistory) S.addHistory(p.id, 'move', oldDate + ' → ' + newDateStr); } catch (_) {}

      safeToast('Перенесено', 'success', (p.title || 'Пост') + ' → ' + newDateStr);
      if (window.DEBUG) console.log('[DDFv4] ' + p.id + ': ' + oldDate + ' → ' + newDateStr +
        ' | target=' + target.dataset.date + ' | bound=' + el.dataset.date +
        ' | cursor=(' + x + ',' + y + ')');

      trackedX = -1; trackedY = -1;
      safeRerender();
    };
  }

  function bindAllCells() {
    document.querySelectorAll(CELL_SELECTOR).forEach(function (el) {
      if (el.dataset.date) bindCell(el);
    });
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.querySelector(CELL_SELECTOR)) {
        clearTimeout(window.__hqDDFv4Timer);
        window.__hqDDFv4Timer = setTimeout(bindAllCells, 30);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(bindAllCells, 500);
  setTimeout(bindAllCells, 1500);
  setTimeout(bindAllCells, 4000);

  if (window.DEBUG) console.log('%cDreamCar HQ DragDrop Fix v4 %c· month + week · tracked cursor + bounding-rect scan',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
