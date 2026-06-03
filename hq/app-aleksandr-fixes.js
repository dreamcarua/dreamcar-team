/* ============================================================
   DreamCar HQ — UX fixes для Олександра 03.06.2026
   ============================================================
   1) Optimistic UI: re-render після save без F5
   2) Cell-day НЕ клікабельна → + button у кожній комірці; cal-card клікабельна
   3) DreamCar Life launch — white bg styling
   ============================================================ */
(function () {
  if (window.__aleksandrFixesLoaded) return;
  window.__aleksandrFixesLoaded = true;

  var DREAMCAR_LIFE_ID = '3d4df73c-ab00-4514-8e68-3bac6ef06370';

  /* ===== CSS ===== */
  var css = document.createElement('style');
  css.id = 'aleksandr-fixes-css';
  css.textContent = [
    /* 2: cell не клікабельна, + кнопка показується при hover */
    '.cal-day { cursor: default !important; position: relative; }',
    '.cal-day .cal-add-btn { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; border-radius: 50%; background: rgba(227,6,19,0.85); color: #fff; border: none; cursor: pointer; font-size: 14px; line-height: 1; display: none; align-items: center; justify-content: center; padding: 0; z-index: 2; transition: transform .12s, background .12s; }',
    '.cal-day:hover .cal-add-btn { display: flex; }',
    '.cal-day .cal-add-btn:hover { background: #ff1a2b; transform: scale(1.15); }',
    '.cal-card { cursor: pointer !important; }',
    /* 3: DreamCar Life — білий фон, чорний текст */
    '.cal-card[data-launch-dc-life="1"], .week-card[data-launch-dc-life="1"], .list-row[data-launch-dc-life="1"] { background: #FFFFFF !important; color: #0a0a0a !important; border-color: #FFFFFF !important; }',
    '.cal-card[data-launch-dc-life="1"] .title, .week-card[data-launch-dc-life="1"] .title, .cal-card[data-launch-dc-life="1"] .time, .week-card[data-launch-dc-life="1"] .time { color: #0a0a0a !important; }',
    '.cal-card[data-launch-dc-life="1"]::before { content: "DC LIFE"; position: absolute; top: 2px; right: 4px; font-family: "JetBrains Mono",monospace; font-size: 8px; color: #888; letter-spacing: .08em; }',
    /* 1: floating Save button у card edit */
    '.card-save-fab { position: sticky; bottom: 12px; right: 12px; float: right; padding: 10px 18px; background: var(--red,#E30613); color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; box-shadow: 0 4px 12px rgba(227,6,19,.4); z-index: 50; }',
    '.card-save-fab:hover { background: #ff1a2b; }',
  ].join('\n');
  document.head.appendChild(css);

  /* ===== 1. Optimistic re-render після Store.upsertPub success ===== */
  function patchUpsertPubReRender() {
    if (!window.Store || typeof Store.upsertPub !== 'function') { setTimeout(patchUpsertPubReRender, 300); return; }
    if (Store.upsertPub.__optimistic) return;
    var orig = Store.upsertPub.bind(Store);
    Store.upsertPub = async function (pub) {
      var res = await orig(pub);
      try {
        if (typeof window.renderCalBody === 'function' && (location.hash === '' || location.hash === '#' || location.hash === '#calendar')) {
          window.renderCalBody();
        }
        if (typeof window.updateNavCounts === 'function') window.updateNavCounts();
      } catch (e) { console.warn('[optimistic-rerender]', e); }
      return res;
    };
    Store.upsertPub.__optimistic = true;
  }

  /* ===== 2. + button у комірці calendar + блокування cell click ===== */
  function injectCellAddButtons() {
    document.querySelectorAll('.cal-day').forEach(function (cell) {
      if (cell.querySelector('.cal-add-btn')) return;
      var btn = document.createElement('button');
      btn.className = 'cal-add-btn';
      btn.title = 'Нова публікація у цей день';
      btn.textContent = '+';
      btn.onclick = function (e) {
        e.stopPropagation();
        e.preventDefault();
        if (typeof window.createPub !== 'function') return;
        var date = cell.dataset.date;
        if (!date) return;
        window.createPub(new Date(date + 'T12:00:00'));
      };
      cell.appendChild(btn);
      // Блокуємо існуючий cell onclick (createPub on empty area)
      var origOnClick = cell.onclick;
      cell.onclick = function (e) {
        // Якщо клік на cal-card / more / cal-add-btn → нехай рідний handler спрацює
        if (e.target.closest('.cal-card') || e.target.classList.contains('more') || e.target.classList.contains('cal-add-btn')) {
          if (origOnClick) origOnClick.call(cell, e);
          return;
        }
        // Інакше — нічого не робимо (cell не клікабельна)
        e.preventDefault();
        e.stopPropagation();
      };
    });
  }

  /* ===== 3. DreamCar Life launch styling ===== */
  function markDcLifeCards() {
    if (!window.Store) return;
    document.querySelectorAll('[data-id]').forEach(function (el) {
      var pid = el.dataset.id; if (!pid) return;
      var p = null; try { p = Store.pub(pid); } catch (_) {}
      if (!p) return;
      var isDcLife = p.launch === DREAMCAR_LIFE_ID;
      if (isDcLife) el.setAttribute('data-launch-dc-life', '1');
      else el.removeAttribute('data-launch-dc-life');
    });
  }

  /* ===== 4. Floating Save button у edit-modal ===== */
  function injectSaveFab() {
    if (!location.hash.startsWith('#publication/')) return;
    var modal = document.getElementById('modal');
    if (!modal || modal.querySelector('.card-save-fab')) return;
    var body = modal.querySelector('.modal-body') || modal;
    var btn = document.createElement('button');
    btn.className = 'card-save-fab';
    btn.textContent = '💾 Зберегти';
    btn.onclick = async function () {
      var idMatch = location.hash.match(/^#publication\/(.+)$/);
      if (!idMatch) return;
      var pub = null;
      try { pub = Store.pub(idMatch[1]); } catch (_) {}
      if (!pub) return;
      // Підбираємо актуальні значення з форми
      try {
        var f_title = document.getElementById('f_title');
        if (f_title && f_title.value !== undefined) pub.title = f_title.value.trim();
        var f_text = document.getElementById('f_text');
        if (f_text && f_text.value !== undefined) pub.text = f_text.value;
      } catch (_) {}
      pub.updatedAt = new Date().toISOString();
      if (pub._isNew) delete pub._isNew;
      try {
        await Store.upsertPub(pub);
        window.toast && toast('Збережено', 'success');
        // Закриваємо modal і re-render calendar
        try { window.Modal && Modal.close && Modal.close(); } catch (_) {}
        location.hash = '#calendar';
      } catch (e) {
        window.toast && toast('Помилка: ' + (e.message || e), 'error');
      }
    };
    body.appendChild(btn);
  }

  /* ===== 5. Додати «DreamCar Life» у launch select (якщо ще не у списку) ===== */
  function ensureDcLifeOption() {
    var sel = document.getElementById('f_launch');
    if (!sel) return;
    if (Array.from(sel.options).some(function (o) { return o.value === DREAMCAR_LIFE_ID; })) return;
    var opt = document.createElement('option');
    opt.value = DREAMCAR_LIFE_ID;
    opt.textContent = '🌟 DreamCar Life';
    sel.appendChild(opt);
  }

  /* ===== Init ===== */
  var mo = new MutationObserver(function () {
    injectCellAddButtons();
    markDcLifeCards();
    if (location.hash.startsWith('#publication/')) {
      injectSaveFab();
      ensureDcLifeOption();
    }
  });

  function init() {
    patchUpsertPubReRender();
    injectCellAddButtons();
    markDcLifeCards();
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(init, 800);
  setTimeout(init, 2500);
})();
