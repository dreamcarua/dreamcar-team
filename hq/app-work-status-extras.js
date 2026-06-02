/* ============================================================
   DreamCar HQ — Work Status: calendar chips + sidebar filter + board sort
   ============================================================ */
(function () {
  if (window.__hqWorkStatusExtras) return;
  window.__hqWorkStatusExtras = true;

  var WS_EMOJI = { script:'✍️', design:'🎨', editing:'🎬', done:'✅' };
  var WS_LABEL = {
    script:'Пишу сценарій', design:'Роблю дизайн',
    editing:'Роблю монтаж', done:'Зробив'
  };
  var WS_ORDER = { script:1, design:2, editing:3, done:4, '':5, null:5, undefined:5 };

  // Filter state (persisted у localStorage)
  try { App._workStatusFilter = localStorage.getItem('hq-ws-filter') || ''; }
  catch (_) { App._workStatusFilter = ''; }

  function getStore() { try { return (typeof Store !== 'undefined' ? Store : window.Store); } catch (_) { return null; } }

  /* ============== 1. CALENDAR CHIPS ============== */
  function decorateCard(card) {
    if (card.__hqWsApplied) return;
    var pid = card.dataset.id; if (!pid) return;
    var S = getStore(); if (!S) return;
    var p = null; try { p = S.pub(pid); } catch (_) {}
    if (!p) return;
    card.__hqWsApplied = true;
    var ws = p.workStatus;
    if (!ws || !WS_EMOJI[ws]) return;
    // Append emoji chip to .title
    var titleEl = card.querySelector('.title') || card.querySelector('.bc-title') || card.querySelector('.cell-title');
    if (!titleEl) return;
    if (titleEl.querySelector('.ws-chip')) return;
    var chip = document.createElement('span');
    chip.className = 'ws-chip';
    chip.title = WS_LABEL[ws] || '';
    chip.textContent = ' ' + WS_EMOJI[ws];
    chip.style.cssText = 'font-size:11px;margin-left:4px;opacity:0.95;';
    titleEl.appendChild(chip);
  }

  function applyFilter() {
    var f = App._workStatusFilter;
    document.querySelectorAll('[data-id]').forEach(function (card) {
      var pid = card.dataset.id; if (!pid) return;
      var S = getStore(); if (!S) return;
      var p = null; try { p = S.pub(pid); } catch (_) {}
      if (!p) return;
      // Only hide cards on calendar / board (skip if it's a different DOM)
      var inCalendar = !!card.closest('.month-grid, .week-grid, .day-view, .list-view, .board');
      if (!inCalendar) return;
      var ws = p.workStatus || '';
      card.style.display = (!f || ws === f) ? '' : 'none';
    });
  }

  function processAll() {
    document.querySelectorAll('[data-id]').forEach(decorateCard);
    applyFilter();
  }

  /* ============== 2. SIDEBAR FILTER ============== */
  function injectSidebarFilter() {
    if (document.getElementById('ws-filter-group')) return;
    // Find sidebar filter container — most likely #sidebar or .sidebar
    var sb = document.querySelector('#sidebar, aside.sidebar, .sidebar');
    if (!sb) return;
    var div = document.createElement('div');
    div.id = 'ws-filter-group';
    div.style.cssText = 'padding:10px 14px;border-top:1px solid var(--border, #2a2a2a);margin-top:8px;';
    div.innerHTML =
      '<div style="font-size:10px;letter-spacing:.1em;color:var(--grey,#888);text-transform:uppercase;margin-bottom:6px;">Статус виконання</div>' +
      '<div id="ws-filter-chips" style="display:flex;flex-wrap:wrap;gap:4px;">' +
        '<span class="ws-fl-chip" data-ws="">Усі</span>' +
        '<span class="ws-fl-chip" data-ws="script">✍️</span>' +
        '<span class="ws-fl-chip" data-ws="design">🎨</span>' +
        '<span class="ws-fl-chip" data-ws="editing">🎬</span>' +
        '<span class="ws-fl-chip" data-ws="done">✅</span>' +
      '</div>';
    sb.appendChild(div);
    // Style for chips
    if (!document.getElementById('ws-chip-style')) {
      var st = document.createElement('style');
      st.id = 'ws-chip-style';
      st.textContent =
        '.ws-fl-chip{cursor:pointer;padding:4px 8px;border:1px solid var(--border,#2a2a2a);border-radius:14px;font-size:12px;background:var(--bg,#0a0a0a);color:var(--ash,#bbb);transition:all .15s;}' +
        '.ws-fl-chip:hover{border-color:var(--red,#E30613);}' +
        '.ws-fl-chip.on{background:var(--red,#E30613);color:#fff;border-color:var(--red,#E30613);}';
      document.head.appendChild(st);
    }
    div.addEventListener('click', function (e) {
      var t = e.target.closest('.ws-fl-chip'); if (!t) return;
      App._workStatusFilter = t.dataset.ws || '';
      try { localStorage.setItem('hq-ws-filter', App._workStatusFilter); } catch (_) {}
      refreshChipsActive();
      applyFilter();
      // Board view має пересортувати — викликаємо renderBoard через hashchange
      if (location.hash === '#board' && typeof renderBoard === 'function') {
        var main = document.getElementById('main'); if (main) renderBoard(main);
      }
    });
    refreshChipsActive();
  }
  function refreshChipsActive() {
    document.querySelectorAll('.ws-fl-chip').forEach(function (el) {
      el.classList.toggle('on', (el.dataset.ws || '') === (App._workStatusFilter || ''));
    });
  }

  /* ============== 3. BOARD SORT ============== */
  function sortBoardCards() {
    document.querySelectorAll('.board .col').forEach(function (col) {
      var cards = Array.from(col.querySelectorAll('[data-id]'));
      if (cards.length < 2) return;
      var S = getStore(); if (!S) return;
      cards.sort(function (a, b) {
        var pa = null, pb = null;
        try { pa = S.pub(a.dataset.id); pb = S.pub(b.dataset.id); } catch (_) {}
        var oa = WS_ORDER[(pa && pa.workStatus) || ''] || 5;
        var ob = WS_ORDER[(pb && pb.workStatus) || ''] || 5;
        return oa - ob;
      });
      cards.forEach(function (c) { col.appendChild(c); });
    });
  }

  /* ============== Observers ============== */
  var mo = new MutationObserver(function (muts) {
    var any = false;
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        if (n.nodeType === 1) {
          if (n.matches && n.matches('[data-id]')) { decorateCard(n); any = true; }
          else n.querySelectorAll && n.querySelectorAll('[data-id]').forEach(function (c) { decorateCard(c); any = true; });
        }
      });
    });
    if (any) {
      applyFilter();
      if (location.hash === '#board') sortBoardCards();
    }
  });

  function init() {
    injectSidebarFilter();
    processAll();
    if (location.hash === '#board') sortBoardCards();
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

  // Re-process після route change
  window.addEventListener('hashchange', function () {
    setTimeout(function () { processAll(); if (location.hash === '#board') sortBoardCards(); }, 100);
  });
})();
