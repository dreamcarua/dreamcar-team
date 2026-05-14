/* ============================================================
   DreamCar HQ — Drag-Drop Off-By-One Fix v2 (calendar)
   ============================================================ */
// v1 fix створив дублі через global capture + neutralize race.
// v2: чистий per-cell override. Без global handler. Без stopPropagation.
// Використовуємо bare reference на Store/fmtTime/fmtDate/renderCalBody/toast
// — у classic-script lexical scope вони доступні з app-core.js.

(function () {
  // v2 guard — НЕ ділимо стан з v1
  if (window.__hqDragDropFixV2) return;
  window.__hqDragDropFixV2 = true;

  // Disable v1 global handler if still active (нічого не зробимо там)
  window.__hqDragDropFix = true;  // блокує повторний запуск v1

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
    try { if (typeof toast === 'function') return toast(t, k, m); } catch (_) {}
    if (typeof window.toast === 'function') window.toast(t, k, m);
  }
  function safeRerender() {
    try { if (typeof renderCalBody === 'function') { renderCalBody(); return; } } catch (_) {}
    try { if (typeof navigate === 'function') { navigate(); return; } } catch (_) {}
    // Fallback — hashchange re-trigger
    try {
      var h = location.hash;
      location.hash = '#';
      setTimeout(function () { location.hash = h; }, 10);
    } catch (_) {}
  }

  function findCellUnderCursor(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    return el.closest('.cal-day');
  }

  function bindCell(el) {
    if (el.__hqDDFv2) return;
    el.__hqDDFv2 = true;

    // dragover — preventDefault (allow drop) + visual marker by REAL cursor cell
    el.ondragover = function (e) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
      var real = findCellUnderCursor(e.clientX, e.clientY) || el;
      // Знімаємо drop-over з усіх, додаємо тільки на real
      document.querySelectorAll('.cal-day.drop-over').forEach(function (c) {
        if (c !== real) c.classList.remove('drop-over');
      });
      real.classList.add('drop-over');
    };

    el.ondragleave = function () {
      // Не знімаємо тут drop-over — це робить dragover на наступній клітинці
    };

    // drop — використовуємо elementFromPoint(cursor), а НЕ el (bound cell)
    el.ondrop = function (e) {
      e.preventDefault();
      e.stopPropagation();

      // Cleanup visual
      document.querySelectorAll('.cal-day.drop-over').forEach(function (c) {
        c.classList.remove('drop-over');
      });

      var target = findCellUnderCursor(e.clientX, e.clientY) || el;
      if (!target || !target.dataset.date) return;

      var S = safeStore();
      if (!S || typeof S.pub !== 'function') {
        console.warn('[DDFv2] Store недоступний');
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
        console.log('[DDFv2] same date, skip');
        return;
      }

      p.dateTime = newDt.toISOString();
      p.updatedAt = new Date().toISOString();

      try { S.upsertPub(p); } catch (err) { console.error('[DDFv2] upsert:', err); return; }
      try { if (S.addHistory) S.addHistory(p.id, 'move', oldDate + ' → ' + newDateStr); } catch (_) {}

      safeToast('Перенесено', 'success', (p.title || 'Пост') + ' → ' + newDateStr);
      console.log('[DDFv2] ' + p.id + ': ' + oldDate + ' → ' + newDateStr +
        ' | target=' + target.dataset.date + ' | bound=' + el.dataset.date);

      safeRerender();
    };
  }

  function bindAllCells() {
    document.querySelectorAll('.cal-day').forEach(bindCell);
  }

  // Спостерігаємо за DOM, ребіндимо на нові клітинки після re-render
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.querySelector('.cal-day')) {
        clearTimeout(window.__hqDDFv2Timer);
        window.__hqDDFv2Timer = setTimeout(bindAllCells, 30);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(bindAllCells, 500);
  setTimeout(bindAllCells, 1500);
  setTimeout(bindAllCells, 4000);

  console.log('%cDreamCar HQ DragDrop Fix v2 %c· per-cell override (elementFromPoint)',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
