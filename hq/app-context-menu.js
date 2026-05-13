// =====================================================================
// DreamCar HQ — Context Menu (правий клік у календарі)
// =====================================================================
// Тікет #40 з ТЗ — «контекстне меню по клацанню на розділеннях».
// Логіка:
//   • Правий клік на пустій клітинці (Month) або колонці (Week) → меню з опціями:
//       - Створити публікацію тут (на дату клітинки)
//       - Створити з пресетом часу (9:00 / 12:00 / 18:00)
//       - Перейти у режим Тиждень / День
//   • Правий клік на існуючій публікації → інше меню:
//       - Відкрити
//       - Дублювати
//       - Видалити
//   • Меню закривається кліком за межами / Esc / scroll
// =====================================================================

(function() {
  'use strict';

  // ----- CSS ----------------------------------------------------------
  const css = `
  .hq-ctx {
    position: fixed; z-index: 9999;
    min-width: 220px; max-width: 280px;
    background: var(--bg-2, #1a1a1a);
    border: 1px solid var(--border, #2a2a2a);
    border-radius: 10px;
    box-shadow: 0 10px 40px rgba(0,0,0,.55);
    padding: 6px;
    font-size: 13px; color: #fff;
    user-select: none;
    animation: hq-ctx-in .12s ease-out;
  }
  @keyframes hq-ctx-in {
    from { opacity:0; transform:translateY(-4px) scale(.96); }
    to   { opacity:1; transform:translateY(0)    scale(1);   }
  }
  .hq-ctx-item {
    display:flex; align-items:center; gap:10px;
    padding: 8px 12px; border-radius: 6px;
    cursor: pointer; line-height: 1.2;
  }
  .hq-ctx-item:hover { background: rgba(255,255,255,.06); }
  .hq-ctx-item.danger { color: #ff7474; }
  .hq-ctx-item.danger:hover { background: rgba(255, 60, 60, .12); }
  .hq-ctx-icon { width: 16px; text-align:center; opacity:.85; }
  .hq-ctx-shortcut {
    margin-left: auto; opacity: .5; font-size: 10px;
    text-transform: uppercase; letter-spacing: .5px;
  }
  .hq-ctx-sep { height: 1px; background: var(--border, #2a2a2a); margin: 4px 8px; }
  .hq-ctx-header {
    padding: 6px 12px 4px;
    font-size: 10px; text-transform: uppercase; letter-spacing: 1px;
    opacity: .5;
  }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ----- Helpers ------------------------------------------------------
  let activeMenu = null;
  function closeMenu() {
    if (activeMenu) { activeMenu.remove(); activeMenu = null; }
  }

  function openMenu(x, y, items) {
    closeMenu();
    const el = document.createElement('div');
    el.className = 'hq-ctx';
    el.style.left = '0px'; el.style.top = '0px';
    el.innerHTML = items.map(it => {
      if (it.type === 'sep')   return '<div class="hq-ctx-sep"></div>';
      if (it.type === 'header')return `<div class="hq-ctx-header">${it.label}</div>`;
      const danger = it.danger ? ' danger' : '';
      const sc = it.shortcut ? `<span class="hq-ctx-shortcut">${it.shortcut}</span>` : '';
      const ic = it.icon ? `<span class="hq-ctx-icon">${it.icon}</span>` : '';
      return `<div class="hq-ctx-item${danger}" data-idx="${it._idx}">${ic}<span>${it.label}</span>${sc}</div>`;
    }).join('');
    document.body.appendChild(el);

    // зміщення щоб не вилазило за вʼюпорт
    const r = el.getBoundingClientRect();
    const W = window.innerWidth, H = window.innerHeight;
    let nx = x, ny = y;
    if (x + r.width  > W - 8) nx = W - r.width  - 8;
    if (y + r.height > H - 8) ny = H - r.height - 8;
    el.style.left = nx + 'px';
    el.style.top  = ny + 'px';

    // handlers
    el.querySelectorAll('.hq-ctx-item').forEach(node => {
      node.onclick = (e) => {
        e.stopPropagation();
        const idx = +node.dataset.idx;
        const item = items.find(i => i._idx === idx);
        closeMenu();
        if (item && typeof item.action === 'function') {
          try { item.action(); } catch (err) { console.error('ctx action threw:', err); }
        }
      };
    });

    activeMenu = el;
  }

  // global close handlers (одноразово)
  document.addEventListener('click', (e) => {
    if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', closeMenu, true);
  window.addEventListener('resize', closeMenu);

  // ----- Context-aware menu builders ---------------------------------
  function buildDayCellMenu(dateIso) {
    const d = new Date(dateIso + 'T12:00:00');
    const label = d.toLocaleDateString('uk-UA', { day:'numeric', month:'long' });
    return assignIdx([
      { type:'header', label: `📅 ${label}` },
      { icon:'➕', label:'Створити публікацію', action: () => safeCreatePub(d) },
      { type:'sep' },
      { type:'header', label:'Пресети часу' },
      { icon:'🌅', label:'09:00 (ранок)',  action: () => safeCreatePub(withTime(d, 9, 0))  },
      { icon:'🌞', label:'12:00 (день)',   action: () => safeCreatePub(withTime(d, 12, 0)) },
      { icon:'🌆', label:'18:00 (вечір)',  action: () => safeCreatePub(withTime(d, 18, 0)) },
      { icon:'🌃', label:'21:00 (ніч)',    action: () => safeCreatePub(withTime(d, 21, 0)) },
      { type:'sep' },
      { icon:'📆', label:'Перейти на цей тиждень', action: () => switchMode('week', d) },
      { icon:'🔍', label:'Відкрити цей день',     action: () => switchMode('day', d)  },
    ]);
  }

  function buildPubMenu(pubId) {
    const p = (window.Store && Store.pub) ? Store.pub(pubId) : null;
    if (!p) return null;
    return assignIdx([
      { type:'header', label: `«${truncate(p.title, 24)}»` },
      { icon:'👁', label:'Відкрити',     action: () => location.hash = '#publication/' + pubId, shortcut:'Enter' },
      { icon:'📋', label:'Дублювати',    action: () => safeDuplicatePub(pubId) },
      { icon:'📤', label:'У роботу (in_work)', action: () => safeSetStatus(pubId, 'in_work') },
      { icon:'👀', label:'На погодження (review)', action: () => safeSetStatus(pubId, 'review') },
      { type:'sep' },
      { icon:'🗑', label:'Видалити',     action: () => safeDeletePub(pubId), danger:true },
    ]);
  }

  function assignIdx(items) {
    items.forEach((it, i) => it._idx = i);
    return items;
  }

  function withTime(d, h, m) {
    const x = new Date(d);
    x.setHours(h, m, 0, 0);
    return x;
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // ----- Safe wrappers (existing functions, optional fallbacks) ------
  function safeCreatePub(date) {
    if (typeof window.createPub === 'function') return window.createPub(date);
    if (typeof window.Store?.createPub === 'function') return window.Store.createPub(date);
    console.warn('createPub not available');
  }
  function safeDuplicatePub(id) {
    if (typeof window.duplicatePub === 'function') return window.duplicatePub(id);
    console.warn('duplicatePub not available — використай footer-кнопку в картці');
  }
  function safeSetStatus(id, status) {
    const p = window.Store?.pub?.(id);
    if (!p) return;
    p.status = status;
    p.updatedAt = new Date().toISOString();
    if (typeof window.Store?.upsertPub === 'function') {
      window.Store.upsertPub(p);
    }
    if (typeof window.Store?.addHistory === 'function') {
      window.Store.addHistory(id, 'status', `→ ${status}`);
    }
    if (typeof window.toast === 'function') {
      window.toast('Статус оновлено', 'success', status);
    }
    if (typeof window.renderCalBody === 'function') window.renderCalBody();
  }
  function safeDeletePub(id) {
    if (typeof window.deletePub === 'function') return window.deletePub(id);
    const p = window.Store?.pub?.(id);
    if (!p) return;
    if (!confirm(`Видалити «${p.title}»?`)) return;
    p.deletedAt = new Date().toISOString();
    p.updatedAt = new Date().toISOString();
    window.Store?.upsertPub?.(p);
    if (typeof window.renderCalBody === 'function') window.renderCalBody();
  }
  function switchMode(mode, date) {
    if (!window.App) return;
    window.App.calendarMode = mode;
    if (date) window.App.calendarDate = new Date(date);
    if (typeof window.renderCalendar === 'function') {
      window.renderCalendar(document.getElementById('main'));
    }
  }

  // ----- Wire up to calendar cells -----------------------------------
  // Делегований listener на document — рендерінг календаря може переписувати DOM,
  // тому делегуємо тут раз і назавжди.
  document.addEventListener('contextmenu', (e) => {
    // не перехоплюємо у формах/інпутах — там нативний контекст потрібен
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;
    if (e.target.isContentEditable) return;

    // 1) клік на конкретній публікації (cal-card / week-card)
    const card = e.target.closest('.cal-card[data-id], .week-card[data-id]');
    if (card && card.dataset.id) {
      const items = buildPubMenu(card.dataset.id);
      if (items) {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, items);
        return;
      }
    }

    // 2) клік на день у місячному календарі
    const dayCell = e.target.closest('.cal-day[data-date]');
    if (dayCell) {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, buildDayCellMenu(dayCell.dataset.date));
      return;
    }

    // 3) клік на колонку тижня
    const weekCol = e.target.closest('.week-col[data-date]');
    if (weekCol) {
      e.preventDefault();
      openMenu(e.clientX, e.clientY, buildDayCellMenu(weekCol.dataset.date));
      return;
    }

    // 4) клік у Day view (пуста зона під календарем)
    const dayView = e.target.closest('#calBody');
    if (dayView && window.App?.calendarMode === 'day' && window.App.calendarDate) {
      e.preventDefault();
      const iso = new Date(window.App.calendarDate).toISOString().slice(0, 10);
      openMenu(e.clientX, e.clientY, buildDayCellMenu(iso));
      return;
    }
  }, false);

  console.info('[HQ ctx-menu] ready');

  // ============================================================
  // LOADER CHAIN — підвантажуємо app-tg-login.js (#27)
  // ============================================================
  if (!document.querySelector('script[src*="app-tg-login.js"]')) {
    var sTg = document.createElement('script');
    sTg.src = 'app-tg-login.js?v=' + Date.now();
    sTg.defer = true;
    document.head.appendChild(sTg);
  }
})();
