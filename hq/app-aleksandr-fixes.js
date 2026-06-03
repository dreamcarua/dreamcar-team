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
    /* 2: cell не клікабельна на empty area (native + у нижньому правому куті — нехай він) */
    '.cal-day { cursor: default !important; position: relative; }',
    '.cal-card { cursor: pointer !important; }',
    /* HIDE моя дублююча .cal-add-btn (якщо ще лишилась з кеш-render) */
    '.cal-day .cal-add-btn { display: none !important; }',
    /* "+N ще" (синій pill) — щоб не плутати з нативним "+" (червоний) */
    '.cal-day .more { background: rgba(59,130,246,0.85) !important; color: #fff !important; padding: 2px 8px !important; border-radius: 100px !important; font-size: 10px !important; font-weight: 600; cursor: pointer; }',
    '.cal-day .more:hover { background: #3b82f6 !important; }',
    /* 3: DreamCar Life — білий фон, чорний текст */
    '.cal-card[data-launch-dc-life="1"], .week-card[data-launch-dc-life="1"], .list-row[data-launch-dc-life="1"] { background: #FFFFFF !important; color: #0a0a0a !important; border-color: #FFFFFF !important; }',
    '.cal-card[data-launch-dc-life="1"] .title, .week-card[data-launch-dc-life="1"] .title, .cal-card[data-launch-dc-life="1"] .time, .week-card[data-launch-dc-life="1"] .time { color: #0a0a0a !important; }',
    '.cal-card[data-launch-dc-life="1"]::before { content: "DC LIFE"; position: absolute; top: 2px; right: 4px; font-family: "JetBrains Mono",monospace; font-size: 8px; color: #888; letter-spacing: .08em; }',
    /* 1: SAVE FAB ВИМКНЕНО 03.06.2026 — Олександр скаржиться що перекриває native footer save. Native save кнопки у footer достатньо. */
    '.card-save-fab { display: none !important; }',
    /* 5: креативи у формі редагування — клікабельні + ▶ for video */
    '.cs-item { cursor: pointer; position: relative; }',
    '.cs-item:hover { outline: 2px solid var(--red, #E30613); }',
    '.cs-item video { background: #0a0a0a; }',
    '.cs-item::after { content: ""; }',
    '.cs-item[data-type="video"]::before { content: "▶"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 28px; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.7); pointer-events: none; z-index: 2; }',
    '.ov-cr-thumb { cursor: pointer; }',
    '.ov-cr-thumb:hover { outline: 2px solid var(--red, #E30613); }',
    '.ov-cr-thumb[data-type="video"]::before { content: "▶"; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 28px; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,0.7); pointer-events: none; z-index: 2; }',
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

  /* ===== 2. Прибрати випадкову створену .cal-add-btn з попередніх кешів =====
   * Native HQ має свій "+" внизу справа cell — не дублюємо. */
  function injectCellAddButtons() {
    document.querySelectorAll('.cal-add-btn').forEach(function(el){ el.remove(); });
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
    btn.innerHTML = '💾';
    btn.setAttribute('data-tip', 'Зберегти (⌘S)');
    btn.title = 'Зберегти публікацію';
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

  /* ===== Init =====
   * MutationObserver — БЕЗ injectSaveFab (вимкнено). 
   * Throttle 200ms щоб не плодити інфініті re-runs у edit-modal. */
  var moPending = false;
  var mo = new MutationObserver(function () {
    if (moPending) return;
    moPending = true;
    setTimeout(function () {
      moPending = false;
      markDcLifeCards();
      markCreativeTileTypes();
      if (location.hash.startsWith('#publication/')) {
        ensureDcLifeOption();
      }
    }, 200);
  });

  /* ===== 5. CREATIVE TILE CLICK → preview modal (03.06.2026 Вадим: video без preview) ===== */
  document.addEventListener('click', function (e) {
    // Strip у формі редагування (.cs-item) АБО overview thumbs (.ov-cr-thumb)
    var tile = e.target.closest('.cs-item') || e.target.closest('.ov-cr-thumb');
    if (!tile) return;
    // skip remove button
    if (e.target.classList.contains('cs-remove') || e.target.closest('.cs-remove')) return;
    // skip if click came from already-controlling <video controls>
    if (e.target.tagName === 'VIDEO' && e.target.hasAttribute('controls')) return;

    var creativeId = tile.dataset.id || tile.dataset.cid;
    if (!creativeId && tile.querySelector('img,video')) {
      // try to find id from parent walker
      var par = tile.closest('[data-id]'); if (par) creativeId = par.dataset.id;
    }
    if (!creativeId) return;

    e.preventDefault();
    e.stopPropagation();
    try {
      if (typeof window.openCreative === 'function') {
        window.openCreative(creativeId);
      } else {
        // fallback inline preview overlay
        var c = window.Store && Store.creative && Store.creative(creativeId);
        if (c) showCreativePreview(c);
      }
    } catch (err) {
      console.error('[creative-preview]', err);
    }
  }, true);

  /* Fallback inline preview overlay якщо openCreative не доступна */
  function showCreativePreview(c) {
    var url = c.compressed_url || c.url || c.thumbnail_url || '';
    if (!url) { alert('Файл недоступний (нема URL)'); return; }
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;cursor:pointer;';
    var media = c.type === 'video'
      ? '<video src="' + url + '" controls autoplay style="max-width:90vw;max-height:90vh;background:#000;"></video>'
      : '<img src="' + url + '" style="max-width:90vw;max-height:90vh;object-fit:contain;"/>';
    ov.innerHTML = media + '<button style="position:absolute;top:24px;right:24px;background:rgba(255,255,255,0.1);border:none;color:#fff;width:40px;height:40px;border-radius:50%;font-size:20px;cursor:pointer;">✕</button>';
    ov.onclick = function (e) { if (e.target === ov || e.target.tagName === 'BUTTON') ov.remove(); };
    document.body.appendChild(ov);
  }

  /* Mark creative tiles with data-type for CSS ::before ▶ */
  function markCreativeTileTypes() {
    if (!window.Store || !Store.creative) return;
    document.querySelectorAll('.cs-item[data-id], .ov-cr-thumb[data-id]').forEach(function (el) {
      var id = el.dataset.id;
      if (!id || el.hasAttribute('data-type')) return;
      try {
        var c = Store.creative(id);
        if (c && c.type) el.setAttribute('data-type', c.type);
      } catch (_) {}
    });
  }

  function init() {
    patchUpsertPubReRender();
    injectCellAddButtons(); // тепер тільки cleanup .cal-add-btn
    markDcLifeCards();
    markCreativeTileTypes();
    // Observer тільки на cal-content (не whole body — не bомбардуємо modal-body мутаціями)
    var calArea = document.querySelector('.cal-body, .cal-content, .board-grid, #appBody, main') || document.body;
    mo.observe(calArea, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(init, 800);
  setTimeout(init, 2500);
})();
