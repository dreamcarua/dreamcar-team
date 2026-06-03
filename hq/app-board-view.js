/* ============================================================
   DreamCar HQ — Board View (5-й режим календаря)
   ============================================================
   Daniel feedback: "в смм сделать такой же календарь как в тасках"
   4 колонки kanban: Чернетка → На погодженні → Погоджено → Опубліковано
   Drag-drop між колонками = transitionStatus()
   ============================================================ */
(function () {
  if (window.__boardViewLoaded) return;
  window.__boardViewLoaded = true;

  var COLUMNS = [
    { id: 'draft',     label: 'Чернетка',      color: '#888',    accept: ['draft'] },
    { id: 'review',    label: 'На погодженні', color: '#F59E0B', accept: ['review'] },
    { id: 'approved',  label: 'Погоджено',     color: '#10B981', accept: ['approved'] },
    { id: 'published', label: 'Опубліковано',  color: '#3B82F6', accept: ['published'] },
  ];

  /* ===== CSS ===== */
  var css = document.createElement('style');
  css.id = 'hq-board-view-css';
  css.textContent = [
    '.hq-bv-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; padding: 8px 0 40px; height: calc(100vh - 240px); min-height: 540px; }',
    '@media (max-width: 1100px) { .hq-bv-grid { grid-template-columns: repeat(2, 1fr); } }',
    '@media (max-width: 640px) { .hq-bv-grid { grid-template-columns: 1fr; } }',
    '.hq-bv-col { background: var(--bg-2, #141414); border: 1px solid var(--border, #2a2a2a); border-radius: 10px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }',
    '.hq-bv-col-head { padding: 12px 14px; border-bottom: 2px solid var(--col-color, #888); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }',
    '.hq-bv-col-head .hq-bv-title { font-family: "Oswald", sans-serif; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; color: #fff; font-weight: 700; }',
    '.hq-bv-col-head .hq-bv-count { font-family: "JetBrains Mono", monospace; font-size: 11px; color: var(--ash, #aaa); padding: 2px 8px; background: var(--bg, #0a0a0a); border-radius: 4px; }',
    '.hq-bv-cards { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; min-height: 100px; }',
    '.hq-bv-cards.drop-over { background: rgba(227,6,19,0.05); outline: 2px dashed var(--red, #E30613); outline-offset: -8px; }',
    '.hq-bv-card { background: var(--bg-3, #1f1f1f); border: 1px solid var(--border, #2a2a2a); border-left: 3px solid var(--card-color, #888); border-radius: 6px; padding: 10px 12px; cursor: pointer; transition: all .15s; user-select: none; }',
    '.hq-bv-card:hover { border-color: var(--red, #E30613); transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.3); }',
    '.hq-bv-card.dragging { opacity: 0.4; }',
    '.hq-bv-card .hq-bv-card-time { font-family: "JetBrains Mono", monospace; font-size: 10px; color: var(--ash, #aaa); margin-bottom: 4px; }',
    '.hq-bv-card .hq-bv-card-title { font-size: 13px; color: #fff; line-height: 1.4; font-weight: 500; }',
    '.hq-bv-card .hq-bv-card-meta { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; align-items: center; }',
    '.hq-bv-card .hq-bv-card-platforms { display: flex; gap: 3px; }',
    '.hq-bv-card .hq-bv-card-platforms span { font-size: 11px; padding: 1px 4px; background: var(--bg, #0a0a0a); border-radius: 3px; }',
    '.hq-bv-card .hq-bv-card-ws { font-size: 11px; padding: 1px 5px; background: rgba(245,158,11,0.15); color: #F59E0B; border-radius: 3px; }',
    '.hq-bv-card .hq-bv-card-deadline { font-size: 10px; color: var(--ash-2, #888); margin-left: auto; }',
    '.hq-bv-card .hq-bv-card-deadline.overdue { color: #DC2626; font-weight: 600; }',
    '.hq-bv-empty { text-align: center; padding: 30px 16px; color: var(--ash-2, #888); font-size: 12px; font-style: italic; }',
    /* кнопка 5-го режиму */
    'button.btn-segmented[data-mode="board"]::before { content: "▦ "; }',
  ].join('\n');
  document.head.appendChild(css);

  /* ===== Inject 5-й button у view-toggle ===== */
  function injectBoardButton() {
    var grp = document.querySelector('.view-toggle, [data-view-toggle]');
    if (!grp) {
      // fallback — find by structure
      var listBtn = document.querySelector('button.btn-segmented[data-mode="list"]');
      if (!listBtn) return;
      grp = listBtn.parentNode;
    }
    if (grp.querySelector('button[data-mode="board"]')) return;
    var listBtn = grp.querySelector('button.btn-segmented[data-mode="list"]') || grp.querySelector('button.btn-segmented:last-child');
    if (!listBtn) return;
    var btn = document.createElement('button');
    btn.className = 'btn-segmented' + (App && App.calendarMode === 'board' ? ' on' : '');
    btn.dataset.mode = 'board';
    btn.textContent = 'Дошка';
    btn.onclick = function () {
      App.calendarMode = 'board';
      App.selectedPubs && App.selectedPubs.clear && App.selectedPubs.clear();
      window.renderCalendar && renderCalendar(document.getElementById('main'));
    };
    listBtn.parentNode.insertBefore(btn, listBtn.nextSibling);
  }

  /* ===== Patch renderCalBody щоб обробити board mode ===== */
  function patchRenderCalBody() {
    if (window.renderCalBody && !window.renderCalBody.__bvPatched) {
      var orig = window.renderCalBody;
      window.renderCalBody = function () {
        if (App && App.calendarMode === 'board') {
          renderBoardBody();
        } else {
          orig.apply(this, arguments);
        }
      };
      window.renderCalBody.__bvPatched = true;
    } else if (!window.renderCalBody) {
      setTimeout(patchRenderCalBody, 300);
    }
  }

  /* ===== Render Board ===== */
  function renderBoardBody() {
    var body = document.getElementById('calBody');
    if (!body) return;
    var meta = document.getElementById('calMeta');
    var label = document.getElementById('monthLabel');
    if (label) label.textContent = 'Дошка погоджень';
    if (meta) meta.textContent = '';

    var pubs = (typeof window.filteredPubs === 'function') ? window.filteredPubs() : (Store.pubs() || []);

    var colsHtml = COLUMNS.map(function (col) {
      var colPubs = pubs.filter(function (p) { return col.accept.indexOf(p.status) >= 0; })
        .sort(function (a, b) { return new Date(a.dateTime) - new Date(b.dateTime); });
      var cardsHtml = colPubs.map(function (p) { return renderCard(p, col.color); }).join('');
      if (!cardsHtml) cardsHtml = '<div class="hq-bv-empty">Порожньо</div>';
      return [
        '<div class="hq-bv-col" data-col-status="' + col.id + '" style="--col-color:' + col.color + ';">',
        '  <div class="hq-bv-col-head">',
        '    <span class="hq-bv-title">' + col.label + '</span>',
        '    <span class="hq-bv-count">' + colPubs.length + '</span>',
        '  </div>',
        '  <div class="hq-bv-cards" data-drop-zone="' + col.id + '">' + cardsHtml + '</div>',
        '</div>'
      ].join('');
    }).join('');

    body.innerHTML = '<div class="hq-bv-grid">' + colsHtml + '</div>';
    bindBoardHandlers();
  }

  function renderCard(p, color) {
    var dt = new Date(p.dateTime);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var time = pad(dt.getDate()) + '.' + pad(dt.getMonth() + 1) + ' ' + pad(dt.getHours()) + ':' + pad(dt.getMinutes());
    var platHtml = (p.platforms || []).slice(0, 4).map(function (pl) {
      var emoji = { instagram: '📷', telegram: '✈️', tiktok: '🎵', threads: '🧵', facebook: '📘', youtube: '▶️' }[pl] || '◯';
      return '<span title="' + pl + '">' + emoji + '</span>';
    }).join('');
    var wsEmoji = { script: '✍️', design: '🎨', editing: '🎬', done: '✅' };
    var wsHtml = p.workStatus && wsEmoji[p.workStatus]
      ? '<span class="hq-bv-card-ws">' + wsEmoji[p.workStatus] + '</span>' : '';
    var ddlHtml = '';
    if (p.deadline) {
      var ddl = new Date(p.deadline);
      var overdue = ddl < new Date();
      ddlHtml = '<span class="hq-bv-card-deadline' + (overdue ? ' overdue' : '') + '">⏰ ' + pad(ddl.getDate()) + '.' + pad(ddl.getMonth() + 1) + '</span>';
    }
    return [
      '<div class="hq-bv-card" draggable="true" data-id="' + p.id + '" style="--card-color:' + color + ';">',
      '  <div class="hq-bv-card-time">' + time + '</div>',
      '  <div class="hq-bv-card-title">' + escapeHtml(p.title || 'Без назви') + '</div>',
      '  <div class="hq-bv-card-meta">',
      '    <div class="hq-bv-card-platforms">' + platHtml + '</div>',
      '    ' + wsHtml,
      '    ' + ddlHtml,
      '  </div>',
      '</div>'
    ].join('');
  }

  function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ===== Drag-drop ===== */
  function bindBoardHandlers() {
    // click card → open
    document.querySelectorAll('.hq-bv-card').forEach(function (el) {
      el.onclick = function (e) {
        if (e.target.closest('button')) return;
        location.hash = '#publication/' + el.dataset.id;
      };
      el.ondragstart = function (e) {
        e.dataTransfer.setData('text/plain', el.dataset.id);
        el.classList.add('dragging');
      };
      el.ondragend = function () {
        el.classList.remove('dragging');
        document.querySelectorAll('.hq-bv-cards').forEach(function (z) { z.classList.remove('drop-over'); });
      };
    });
    document.querySelectorAll('.hq-bv-cards').forEach(function (zone) {
      zone.ondragover = function (e) { e.preventDefault(); zone.classList.add('drop-over'); };
      zone.ondragleave = function () { zone.classList.remove('drop-over'); };
      zone.ondrop = async function (e) {
        e.preventDefault();
        zone.classList.remove('drop-over');
        var pid = e.dataTransfer.getData('text/plain');
        var target = zone.dataset.dropZone;
        var p = null; try { p = Store.pub(pid); } catch (_) {}
        if (!p) return;
        if (p.status === target) return;
        // Викликаємо існуючий transitionStatus якщо є — він обробляє валідації
        try {
          if (typeof window.transitionStatus === 'function') {
            await window.transitionStatus(p, target, null);
          } else {
            p.status = target;
            p.updatedAt = new Date().toISOString();
            await Store.upsertPub(p);
          }
          window.toast && toast('Статус → ' + target, 'success');
          renderBoardBody();
        } catch (err) {
          console.error('[board-view drop]', err);
          window.toast && toast('Помилка: ' + (err.message || err), 'error');
        }
      };
    });
  }

  /* ===== Init + observers ===== */
  function init() {
    injectBoardButton();
    patchRenderCalBody();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setTimeout(init, 600);
  setTimeout(init, 2000);

  // re-inject button if calendar re-renders
  var mo = new MutationObserver(function () {
    if (location.hash === '' || location.hash === '#' || location.hash === '#calendar') {
      injectBoardButton();
    }
  });
  setTimeout(function () { mo.observe(document.body, { childList: true, subtree: true }); }, 1500);

  // re-render board on filter change / hashchange
  window.addEventListener('hashchange', function () {
    if (App && App.calendarMode === 'board' && (location.hash === '' || location.hash === '#calendar' || location.hash === '#')) {
      setTimeout(renderBoardBody, 150);
    }
  });
})();
