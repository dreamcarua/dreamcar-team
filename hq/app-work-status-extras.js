/* ============================================================
   DreamCar HQ — Work Status: calendar chips + sidebar filter + board sort
   v2: integrates with filteredPubs() + matches sidebar filter-chip style
   ============================================================ */
(function () {
  if (window.__hqWorkStatusExtras) return;
  window.__hqWorkStatusExtras = true;

  var WS_EMOJI = { script:'✍️', design:'🎨', editing:'🎬', done:'✅' };
  var WS_LABEL = {
    script:'Пишу сценарій',
    design:'Роблю дизайн',
    editing:'Роблю монтаж',
    done:'Зробив'
  };
  var WS_COLOR = { script:'#f59e0b', design:'#ec4899', editing:'#8b5cf6', done:'#22c55e' };
  var WS_KEYS = ['script','design','editing','done'];

  // Single-select filter — persisted у localStorage
  try { window.App = window.App || {}; App._wsFilter = localStorage.getItem('hq-ws-filter') || ''; }
  catch (_) { App._wsFilter = ''; }

  function getStore() { try { return (typeof Store !== 'undefined' ? Store : window.Store); } catch (_) { return null; } }

  /* ============== 1. Inject у filteredPubs() pipeline ============== */
  function patchFilteredPubs() {
    if (window.__wsFpPatched) return;
    if (typeof window.filteredPubs !== 'function') return;
    var orig = window.filteredPubs;
    window.filteredPubs = function () {
      var pubs = orig.apply(this, arguments);
      if (App._wsFilter) {
        pubs = pubs.filter(function (p) { return (p.workStatus || '') === App._wsFilter; });
      }
      return pubs;
    };
    window.__wsFpPatched = true;
  }

  /* ============== 2. Sidebar filter — стиль як інші filter-chip ============== */
  function renderWorkStatusFilter() {
    var host = document.getElementById('sidebarFilters');
    if (!host) return;
    var group = document.getElementById('ws-filter-group');
    if (!group) {
      group = document.createElement('div');
      group.className = 'filter-group';
      group.id = 'ws-filter-group';
      group.innerHTML =
        '<div class="filter-label">Статус виконання</div>' +
        '<div id="filterWorkStatus"></div>';
      host.appendChild(group);
    }
    var box = document.getElementById('filterWorkStatus');
    if (!box) return;
    var S = getStore();
    var all = S ? S.pubs() : [];
    var counts = { '':all.length };
    WS_KEYS.forEach(function (k) {
      counts[k] = all.filter(function (p) { return (p.workStatus || '') === k; }).length;
    });
    var items = [{ k:'', label:'Усі', color:'#888', emoji:'•' }];
    WS_KEYS.forEach(function (k) {
      items.push({ k:k, label:WS_LABEL[k], color:WS_COLOR[k], emoji:WS_EMOJI[k] });
    });
    box.innerHTML = items.map(function (it) {
      var on = (App._wsFilter || '') === it.k;
      return '<div class="filter-chip ' + (on ? 'on' : '') + '" data-ws="' + it.k + '">' +
        '<span class="swatch" style="background:' + it.color + '"></span>' +
        '<span>' + (it.emoji && it.k ? it.emoji + ' ' : '') + it.label + '</span>' +
        '<span class="cnt">' + counts[it.k] + '</span>' +
        '</div>';
    }).join('');
    box.querySelectorAll('.filter-chip').forEach(function (el) {
      el.onclick = function () {
        var v = el.dataset.ws || '';
        App._wsFilter = (App._wsFilter === v) ? '' : v;
        try { localStorage.setItem('hq-ws-filter', App._wsFilter); } catch (_) {}
        renderWorkStatusFilter();
        if (typeof navigate === 'function') navigate();
      };
    });
  }

  /* ============== 3. Patch renderSidebarFilters() — щоб наш filter оновлювався разом ============== */
  function patchRenderSidebarFilters() {
    if (window.__wsRsfPatched) return;
    if (typeof window.renderSidebarFilters !== 'function') return;
    var orig = window.renderSidebarFilters;
    window.renderSidebarFilters = function () {
      orig.apply(this, arguments);
      renderWorkStatusFilter();
    };
    window.__wsRsfPatched = true;
  }

  /* ============== 4. Calendar/Board card emoji decoration ============== */
  function decorateCard(card) {
    if (card.__wsApplied) return;
    var pid = card.dataset.id; if (!pid) return;
    var S = getStore(); if (!S) return;
    var p = null; try { p = S.pub(pid); } catch (_) {}
    if (!p) return;
    card.__wsApplied = true;
    var ws = p.workStatus;
    if (!ws || !WS_EMOJI[ws]) return;
    var titleEl = card.querySelector('.title') || card.querySelector('.bc-title');
    if (!titleEl) return;
    if (titleEl.querySelector('.ws-chip')) return;
    var chip = document.createElement('span');
    chip.className = 'ws-chip';
    chip.title = WS_LABEL[ws] || '';
    chip.textContent = ' ' + WS_EMOJI[ws];
    chip.style.cssText = 'font-size:11px;margin-left:4px;opacity:0.95;';
    titleEl.appendChild(chip);
  }

  function decorateAll() {
    document.querySelectorAll('[data-id]').forEach(decorateCard);
  }

  /* ============== Observers ============== */
  var mo = new MutationObserver(function (muts) {
    var needDecorate = false;
    var needFilter = false;
    muts.forEach(function (m) {
      m.addedNodes.forEach(function (n) {
        if (n.nodeType !== 1) return;
        if (n.id === 'sidebarFilters' || (n.querySelector && n.querySelector('#sidebarFilters'))) {
          needFilter = true;
        }
        if (n.matches && n.matches('[data-id]')) needDecorate = true;
        else if (n.querySelectorAll && n.querySelectorAll('[data-id]').length) needDecorate = true;
      });
    });
    if (needDecorate) decorateAll();
    if (needFilter) {
      patchRenderSidebarFilters();
      renderWorkStatusFilter();
    }
  });

  function init() {
    patchFilteredPubs();
    patchRenderSidebarFilters();
    renderWorkStatusFilter();
    decorateAll();
    mo.observe(document.body, { childList: true, subtree: true });

    // Retry attaches кілька разів — на випадок якщо app-core завантажується після цього скрипту
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      patchFilteredPubs();
      patchRenderSidebarFilters();
      if (document.getElementById('sidebarFilters')) renderWorkStatusFilter();
      if (window.__wsFpPatched && window.__wsRsfPatched && document.getElementById('ws-filter-group')) clearInterval(iv);
      if (tries > 30) clearInterval(iv);
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 100);
  }

  // Re-decorate після route change
  window.addEventListener('hashchange', function () {
    setTimeout(decorateAll, 150);
  });
})();
