/* ============================================================
   DreamCar HQ — Drag-Drop Fix v5 (calendar month + week + Undo Toast)
   ============================================================ */
// v1: global capture + stopProp → дублі, race із attachCalendarHandlers
// v2: per-cell override + elementFromPoint(e.clientX,e.clientY) → досі off-by-one
// v3: трекаємо cursor на КОЖНОМУ dragover (там clientX/Y точні),
//     на drop скануємо .cal-day getBoundingClientRect → ТОЧНА клітинка.
// v4: той самий bounding-rect scan для week view (.week-col[data-date]).
//     Картки тижня (.week-card[draggable]) перетягуються між днями.
// v5: + UNDO TOAST. Після успішного drop (month АБО week) показуємо
//     toast у bottom-right з відліком 10→0. «Скасувати» повертає стару
//     дату. Timeout (0 сек) → зміна лишається закоммічена. Nice fade.

(function () {
  if (window.__hqDragDropFixV5) return;
  window.__hqDragDropFixV5 = true;
  // Блокуємо попередні версії повторні запуски
  window.__hqDragDropFix = true;
  window.__hqDragDropFixV2 = true;
  window.__hqDragDropFixV3 = true;
  window.__hqDragDropFixV4 = true;

  // Селектор усіх drop-зон (місяць + тиждень). week-col без data-date (renderDay) ігноруємо.
  var CELL_SELECTOR = '.cal-day, .week-col[data-date]';

  // Tracked cursor (оновлюється на КОЖНОМУ dragover globally)
  var trackedX = -1;
  var trackedY = -1;

  /* ---------- safe helpers ---------- */
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
  function safeRerender() {
    try { if (typeof renderCalBody === 'function') { renderCalBody(); return; } } catch (_) {}
    try { if (typeof navigate === 'function') { navigate(); return; } } catch (_) {}
    try {
      var h = location.hash;
      location.hash = '#__hq_force__';
      setTimeout(function () { location.hash = h; }, 10);
    } catch (_) {}
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ========================================================
     UNDO TOAST (self-contained; bottom-right; countdown 10→0)
     ======================================================== */
  (function injectUndoCss() {
    if (document.getElementById('hq-undo-toast-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-undo-toast-css';
    css.textContent = [
      '.undo-toast{position:fixed;right:24px;bottom:24px;z-index:99999;',
      'display:flex;align-items:center;gap:14px;',
      'background:#15151f;border:1px solid #2a2a3a;border-left:4px solid var(--orange,#fb923c);',
      'border-radius:12px;padding:12px 16px;min-width:260px;max-width:360px;',
      'box-shadow:0 10px 40px rgba(0,0,0,0.5);color:#fff;',
      'font-family:inherit;font-size:13px;line-height:1.35;',
      'opacity:0;transform:translateY(12px) scale(0.98);',
      'transition:opacity .25s ease,transform .25s ease;pointer-events:auto;}',
      '.undo-toast.show{opacity:1;transform:translateY(0) scale(1);}',
      '.undo-toast .undo-body{flex:1;min-width:0;}',
      '.undo-toast .undo-title{font-weight:600;color:#fff;}',
      '.undo-toast .undo-sub{font-size:11px;color:var(--grey,#8a8a99);margin-top:2px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.undo-toast .undo-count{display:inline-flex;align-items:center;justify-content:center;',
      'min-width:26px;height:26px;padding:0 4px;border-radius:50%;',
      'background:rgba(251,146,60,0.15);color:var(--orange,#fb923c);',
      'font-weight:800;font-size:13px;font-variant-numeric:tabular-nums;flex-shrink:0;}',
      '.undo-toast .undo-btn{flex-shrink:0;background:var(--orange,#fb923c);border:none;',
      'color:#2a1500;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;',
      'cursor:pointer;font-family:inherit;transition:filter .15s ease;}',
      '.undo-toast .undo-btn:hover{filter:brightness(1.1);}',
      '.undo-toast .undo-btn:active{filter:brightness(0.95);}',
      '@media (max-width:640px){.undo-toast{right:12px;left:12px;bottom:12px;min-width:0;max-width:none;}}'
    ].join('');
    document.head.appendChild(css);
  })();

  // Тримаємо максимум один активний undo-toast (щоб не громадились).
  var activeUndo = null;

  /**
   * showUndoToast(oldState, restoreFn)
   *  oldState  — { title, from, to } (для підпису; всі опційні)
   *  restoreFn — функція яку викликаємо при click «Скасувати».
   * Повертає контролер { commit(), undo(), dismiss() }.
   */
  function showUndoToast(oldState, restoreFn) {
    oldState = oldState || {};
    // Закриваємо попередній toast (без rollback — попередня зміна коммітиться).
    if (activeUndo) { try { activeUndo.commit(); } catch (_) {} activeUndo = null; }

    var remaining = 10;
    var done = false;

    var toastEl = document.createElement('div');
    toastEl.className = 'undo-toast';

    var sub = '';
    if (oldState.from && oldState.to) sub = esc(oldState.from) + ' → ' + esc(oldState.to);
    else if (oldState.to) sub = esc(oldState.to);

    toastEl.innerHTML =
      '<span class="undo-count">' + remaining + '</span>' +
      '<div class="undo-body">' +
        '<div class="undo-title">' + esc(oldState.title || 'Перенесено') + '</div>' +
        (sub ? '<div class="undo-sub">' + sub + '</div>' : '') +
      '</div>' +
      '<button class="undo-btn" type="button">Скасувати</button>';

    document.body.appendChild(toastEl);
    requestAnimationFrame(function () { toastEl.classList.add('show'); }); // fade-in

    var countEl = toastEl.querySelector('.undo-count');
    var btn = toastEl.querySelector('.undo-btn');
    var timerId = null;

    function removeEl() {
      toastEl.classList.remove('show'); // fade-out
      setTimeout(function () { if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl); }, 300);
    }
    function cleanup() {
      if (timerId) { clearInterval(timerId); timerId = null; }
      if (activeUndo === ctrl) activeUndo = null;
    }
    // timeout / інший toast → зміна лишається (commit), просто прибираємо UI
    function commit() {
      if (done) return; done = true;
      cleanup(); removeEl();
    }
    // click «Скасувати» → rollback + прибираємо UI
    function undo() {
      if (done) return; done = true;
      cleanup();
      try { if (typeof restoreFn === 'function') restoreFn(); } catch (err) { console.error('[DDFv5] undo restore:', err); }
      removeEl();
    }

    var ctrl = { commit: commit, undo: undo, dismiss: commit };
    activeUndo = ctrl;

    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      undo();
    });

    timerId = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) { commit(); return; }
      if (countEl) countEl.textContent = remaining;
    }, 1000);

    return ctrl;
  }
  // Публічний API (перевикористовний тост з rollback-колбеком)
  window.showUndoToast = showUndoToast;

  /* ========================================================
     Спільна логіка переносу дати + undo (month і week)
     ======================================================== */
  function movePubToDate(p, newDateISODay, boundEl) {
    var S = safeStore();
    if (!S || typeof S.upsertPub !== 'function') { console.warn('[DDFv5] Store недоступний'); return false; }

    var oldDateTimeISO = p.dateTime;        // повний старий стан (для rollback)
    var oldUpdatedAt = p.updatedAt;
    var oldDateLabel = safeFmtDate(oldDateTimeISO);

    var newDt = new Date(newDateISODay + 'T' + safeFmtTime(oldDateTimeISO) + ':00');
    if (isNaN(newDt.getTime())) return false;
    var newDateLabel = safeFmtDate(newDt);
    if (oldDateLabel === newDateLabel) {
      if (window.DEBUG) console.log('[DDFv5] same date, skip');
      return false;
    }

    // COMMIT нового стану
    p.dateTime = newDt.toISOString();
    p.updatedAt = new Date().toISOString();
    try { S.upsertPub(p); } catch (err) { console.error('[DDFv5] upsert:', err); return false; }
    try { if (S.addHistory) S.addHistory(p.id, 'move', oldDateLabel + ' → ' + newDateLabel); } catch (_) {}
    safeRerender();

    if (window.DEBUG) console.log('[DDFv5] ' + p.id + ': ' + oldDateLabel + ' → ' + newDateLabel +
      ' | target=' + newDateISODay + (boundEl ? ' | bound=' + boundEl.dataset.date : ''));

    // UNDO: повертаємо повний старий стан
    showUndoToast(
      { title: (p.title || 'Пост'), from: oldDateLabel, to: newDateLabel },
      function restore() {
        var pp = S.pub(p.id) || p;
        pp.dateTime = oldDateTimeISO;
        pp.updatedAt = oldUpdatedAt || new Date().toISOString();
        try { S.upsertPub(pp); } catch (err) { console.error('[DDFv5] rollback upsert:', err); return; }
        try { if (S.addHistory) S.addHistory(pp.id, 'move', newDateLabel + ' → ' + oldDateLabel + ' (скасовано)'); } catch (_) {}
        safeRerender();
      }
    );
    return true;
  }

  /* ========================================================
     BOUNDING-RECT scan (month + week drop-зони)
     ======================================================== */
  function findCellByPoint(x, y) {
    if (x < 0 || y < 0) return null;
    var cells = document.querySelectorAll(CELL_SELECTOR);
    if (cells.length === 0) return null;
    // Direct hit
    for (var i = 0; i < cells.length; i++) {
      if (!cells[i].dataset.date) continue;
      var r = cells[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return cells[i];
    }
    // Nearest (fallback на 1px gap)
    var nearest = null, minDist = Infinity;
    for (var j = 0; j < cells.length; j++) {
      if (!cells[j].dataset.date) continue;
      var rr = cells[j].getBoundingClientRect();
      var cx = rr.left + rr.width / 2, cy = rr.top + rr.height / 2;
      var d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d < minDist) { minDist = d; nearest = cells[j]; }
    }
    return nearest;
  }

  // GLOBAL cursor tracking — оновлюємо trackedX/Y на кожному русі під час drag
  document.addEventListener('dragover', function (e) {
    trackedX = e.clientX;
    trackedY = e.clientY;
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
    if (el.__hqDDFv5) return;
    el.__hqDDFv5 = true;

    el.ondragover = function (e) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    };
    el.ondragleave = function () {};

    el.ondrop = function (e) {
      e.preventDefault();
      e.stopPropagation();

      var x = (e.clientX !== undefined && e.clientX > 0) ? e.clientX : trackedX;
      var y = (e.clientY !== undefined && e.clientY > 0) ? e.clientY : trackedY;

      document.querySelectorAll('.cal-day.drop-over, .week-col.drop-over').forEach(function (c) {
        c.classList.remove('drop-over');
      });

      var target = findCellByPoint(x, y);
      if (!target || !target.dataset.date) {
        target = el;
        console.warn('[DDFv5] fallback to bound el; tracked=(' + x + ',' + y + '), bound=' + el.dataset.date);
      }

      var pid;
      try { pid = e.dataTransfer.getData('text/plain'); } catch (_) {}
      if (!pid) { trackedX = -1; trackedY = -1; return; }

      var S = safeStore();
      var p = S && typeof S.pub === 'function' ? S.pub(pid) : null;
      if (!p) { trackedX = -1; trackedY = -1; return; }

      movePubToDate(p, target.dataset.date, el);
      trackedX = -1; trackedY = -1;
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
        clearTimeout(window.__hqDDFv5Timer);
        window.__hqDDFv5Timer = setTimeout(bindAllCells, 30);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(bindAllCells, 500);
  setTimeout(bindAllCells, 1500);
  setTimeout(bindAllCells, 4000);

  if (window.DEBUG) console.log('%cDreamCar HQ DragDrop Fix v5 %c· month + week · undo toast',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
