/* ============================================================
   DreamCar HQ — Drag-Drop Off-By-One Fix (calendar)
   ============================================================ */
// БАГ: при перетягуванні картки у клітинку дня (наприклад на 19) — пост
// потрапляє у попередній стовпчик (18). Причина: HTML5 DnD реєструє drop
// по top-left ghost image, а не за позицією курсора. У grid з 1px gap
// це регулярно дає off-by-one зміщення вліво.
//
// FIX: при кожному dragover ми tracking-ом записуємо реальну клітинку
// під курсором через document.elementFromPoint(e.clientX, e.clientY).
// На drop використовуємо ЦЕЙ tracked cell, а не el (на якому fired event).

(function () {
  if (window.__hqDragDropFix) return;
  window.__hqDragDropFix = true;

  // Track останньої клітинки під курсором
  var lastHoverCell = null;
  var lastHoverDate = null;

  function findCellUnderCursor(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;
    return el.closest('.cal-day');
  }

  function setHoverVisual(cell) {
    if (lastHoverCell && lastHoverCell !== cell) {
      lastHoverCell.classList.remove('drop-over');
    }
    if (cell && !cell.classList.contains('drop-over')) {
      cell.classList.add('drop-over');
    }
    lastHoverCell = cell;
    lastHoverDate = cell ? cell.dataset.date : null;
  }

  // GLOBAL dragover — track cursor position via elementFromPoint
  document.addEventListener('dragover', function (e) {
    if (!document.querySelector('.cal-day')) return;
    var cell = findCellUnderCursor(e.clientX, e.clientY);
    if (cell) {
      e.preventDefault();
      e.dataTransfer && (e.dataTransfer.dropEffect = 'move');
      setHoverVisual(cell);
    } else {
      setHoverVisual(null);
    }
  }, true);

  document.addEventListener('dragend', function () {
    if (lastHoverCell) lastHoverCell.classList.remove('drop-over');
    lastHoverCell = null;
    lastHoverDate = null;
  }, true);

  // GLOBAL drop — використовуємо tracked cell
  document.addEventListener('drop', function (e) {
    if (!document.querySelector('.cal-day')) return;
    var cell = findCellUnderCursor(e.clientX, e.clientY) || lastHoverCell;
    if (!cell || !cell.dataset.date) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation && e.stopImmediatePropagation();

    if (lastHoverCell) lastHoverCell.classList.remove('drop-over');
    lastHoverCell = null;

    try {
      var pid = e.dataTransfer.getData('text/plain');
      if (!pid) return;
      var p = window.Store && window.Store.pub && window.Store.pub(pid);
      if (!p) return;

      var fmtTime = window.fmtTime || function (dt) {
        var d = new Date(dt);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      };
      var fmtDate = window.fmtDate || function (dt) {
        var d = new Date(dt);
        return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear();
      };

      var oldDate = fmtDate(p.dateTime);
      var newDt = new Date(cell.dataset.date + 'T' + fmtTime(p.dateTime) + ':00');
      if (isNaN(newDt.getTime())) return;

      if (oldDate === fmtDate(newDt)) {
        console.log('[DragDrop Fix] same date, skip');
        return;
      }

      p.dateTime = newDt.toISOString();
      p.updatedAt = new Date().toISOString();

      window.Store.upsertPub(p);
      if (window.Store.addHistory) {
        try { window.Store.addHistory(p.id, 'move', oldDate + ' → ' + fmtDate(newDt)); } catch (_) {}
      }
      if (typeof window.toast === 'function') {
        window.toast('Перенесено', 'success', p.title + ' → ' + fmtDate(newDt));
      }

      console.log('[DragDrop Fix] ' + p.id + ': ' + oldDate + ' → ' + fmtDate(newDt) + ' (cell=' + cell.dataset.date + ')');

      if (typeof window.renderCalBody === 'function') {
        window.renderCalBody();
      } else if (typeof window.navigate === 'function') {
        window.navigate();
      } else if (typeof window.renderCalendar === 'function') {
        var main = document.getElementById('main');
        if (main) window.renderCalendar(main);
      }
    } catch (err) {
      console.error('[DragDrop Fix] error:', err);
    }
  }, true);

  // Прибрати original handlers щоб не плутали
  function neutralizeOriginalHandlers() {
    document.querySelectorAll('.cal-day').forEach(function (el) {
      el.ondragover = function (e) { e.preventDefault(); };
      el.ondragleave = function () {};
      el.ondrop = function () {};
    });
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.querySelector('.cal-day')) {
        clearTimeout(window.__hqDDFTimer);
        window.__hqDDFTimer = setTimeout(neutralizeOriginalHandlers, 50);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  setTimeout(neutralizeOriginalHandlers, 800);
  setTimeout(neutralizeOriginalHandlers, 2000);
  setTimeout(neutralizeOriginalHandlers, 5000);

  console.log('%cDreamCar HQ DragDrop Fix %c· global drop via elementFromPoint',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
