/* HQ — 30-day Trash для publications (Вадим feature 03.06.2026) */
(function () {
  if (window.__hqTrashLoaded) return;
  window.__hqTrashLoaded = true;

  var css = document.createElement('style');
  css.id = 'hq-trash-css';
  css.textContent = [
    '.dc-del-modal { position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:99999; display:flex; align-items:center; justify-content:center; padding:24px; font-family:Manrope,sans-serif; }',
    '.dc-del-box { background:#141414; border:1px solid #2a2a2a; border-radius:12px; padding:28px; max-width:480px; width:100%; color:#fff; box-shadow:0 20px 60px rgba(0,0,0,0.6); }',
    '.dc-del-title { font-family:Oswald,sans-serif; font-size:20px; letter-spacing:.05em; text-transform:uppercase; margin-bottom:6px; }',
    '.dc-del-sub { font-size:14px; color:#bbb; margin-top:8px; line-height:1.45; font-style:italic; }',
    '.dc-del-btns { display:flex; flex-direction:column; gap:8px; margin-top:24px; }',
    '.dc-del-btn { padding:12px 18px; border-radius:8px; font-family:Manrope,sans-serif; font-size:13px; font-weight:600; letter-spacing:.06em; cursor:pointer; text-transform:uppercase; border:1px solid transparent; }',
    '.dc-del-btn.hard { background:linear-gradient(135deg,#DC2626,#991B1B); color:#fff; border:none; font-weight:700; }',
    '.dc-del-btn.soft { background:rgba(245,158,11,0.15); color:#FBBF24; border-color:#F59E0B; }',
    '.dc-del-btn.cancel { background:transparent; color:#888; border-color:#2a2a2a; }',
    '.hq-trash-view { padding:24px 28px; }',
    '.hq-trash-empty { padding:60px; text-align:center; color:#888; font-size:14px; }',
    '.hq-trash-row { padding:14px 18px; border:1px solid #2a2a2a; border-radius:8px; margin-bottom:10px; background:#141414; display:flex; justify-content:space-between; align-items:start; gap:14px; }',
    '.hq-trash-row:hover { border-color:#3a3a3a; }',
    '.hq-trash-actions { display:flex; gap:6px; flex-shrink:0; }',
    '.hq-trash-restore { padding:6px 12px; background:rgba(16,185,129,0.1); border:1px solid #10B981; color:#34D399; border-radius:6px; cursor:pointer; font-size:11px; letter-spacing:.05em; }',
    '.hq-trash-purge { padding:6px 10px; background:rgba(220,38,38,0.1); border:1px solid #DC2626; color:#FF6A7A; border-radius:6px; cursor:pointer; font-size:11px; }',
    '.hq-trash-info { font-size:11px; color:#888; line-height:1.6; margin-top:4px; }',
  ].join('\n');
  document.head.appendChild(css);

  function showDeleteChoice(title, isAdmin) {
    return new Promise(function (resolve) {
      var ov = document.createElement('div');
      ov.className = 'dc-del-modal';
      var safeTitle = (title || 'без назви').replace(/</g, '&lt;');
      ov.innerHTML = '<div class="dc-del-box">' +
        '<div class="dc-del-title">Як саме видалити?</div>' +
        '<div class="dc-del-sub">«' + safeTitle + '»</div>' +
        '<div class="dc-del-btns">' +
          (isAdmin ? '<button class="dc-del-btn hard" data-mode="hard">🗑 Видалити НАЗАВЖДИ</button>' : '') +
          '<button class="dc-del-btn soft" data-mode="soft">📦 Перемістити в корзину</button>' +
          '<button class="dc-del-btn cancel" data-mode="cancel">✕ Скасувати</button>' +
        '</div></div>';
      document.body.appendChild(ov);
      function close(r) { ov.remove(); resolve(r); }
      ov.querySelectorAll('.dc-del-btn').forEach(function (b) {
        b.onclick = function () {
          var m = b.dataset.mode;
          if (m === 'cancel') return close(null);
          if (m === 'soft') return close({ mode: 'soft' });
          if (!confirm('Точно видалити НАЗАВЖДИ?\n\nКорзини НЕ буде. Це фінальне рішення.')) return;
          close({ mode: 'hard' });
        };
      });
      ov.addEventListener('click', function (e) { if (e.target === ov) close(null); });
      document.addEventListener('keydown', function escH(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', escH); close(null); }
      });
    });
  }
  window.hqShowDeleteChoice = showDeleteChoice;

  function patchDelete() {
    if (!window.Store || typeof Store.deletePub !== 'function') { setTimeout(patchDelete, 300); return; }
    if (Store.deletePub.__trashV2) return;
    Store.deletePub = async function (id) {
      var pub = Store.pub(id);
      if (!pub) return;
      var me = Store.currentUser && Store.currentUser();
      var isAuthor = pub.createdBy === me?.id || pub.created_by === me?.id;
      var isAdmin = me && me.role && ['ceo', 'coo'].includes(me.role);
      if (!isAuthor && !isAdmin) {
        window.toast && toast('Видалити може тільки автор або CEO/COO', 'error');
        return;
      }
      var choice = await showDeleteChoice(pub.title, isAdmin);
      if (!choice) return;
      var sb = window.supabase;
      if (!sb || !window.HQ_BACKEND) {
        window.toast && toast('Доступно тільки у backend режимі', 'error');
        return;
      }
      var res;
      if (choice.mode === 'hard') {
        res = await sb.from('publications').delete().eq('id', id);
      } else {
        res = await sb.from('publications').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      }
      if (res.error) {
        window.toast && toast('Помилка: ' + res.error.message, 'error');
        return;
      }
      Store._data.publications = (Store._data.publications || []).filter(function (p) { return p.id !== id; });
      if (typeof Store._saveLocal === 'function') Store._saveLocal();
      window.toast && toast(choice.mode === 'hard' ? 'Видалено назавжди' : 'Перенесено у корзину', 'success');
      if (typeof navigate === 'function') navigate();
      if (typeof updateNavCounts === 'function') updateNavCounts();
      updateTrashCount();
    };
    Store.deletePub.__trashV2 = true;
  }
  patchDelete();
  setTimeout(patchDelete, 600); setTimeout(patchDelete, 2000);

  var _trashCache = [];
  async function loadTrash() {
    if (!window.supabase || !window.HQ_BACKEND) return [];
    try {
      var res = await window.supabase.rpc('publications_trash');
      _trashCache = res.data || [];
      return _trashCache;
    } catch (e) { console.warn('[hq trash load]', e); return []; }
  }
  function updateTrashCount() {
    loadTrash().then(function (items) {
      var el = document.getElementById('hq-trash-count');
      if (el) el.textContent = items.length ? '(' + items.length + ')' : '';
    });
  }
  window.hqLoadTrash = loadTrash;
  window.hqUpdateTrashCount = updateTrashCount;

  async function restorePub(id) {
    if (!window.supabase) return;
    var res = await window.supabase.from('publications').update({ deleted_at: null }).eq('id', id);
    if (res.error) { window.toast && toast('Помилка: ' + res.error.message, 'error'); return; }
    _trashCache = _trashCache.filter(function (p) { return p.id !== id; });
    renderTrashView();
    updateTrashCount();
    window.toast && toast('Публікацію відновлено', 'success');
    try { if (Store._loadFromBackend) await Store._loadFromBackend(); if (typeof navigate === 'function') navigate(); } catch (_) {}
  }
  async function purgePub(id) {
    if (!confirm('Видалити НАЗАВЖДИ? Не можна буде відновити.')) return;
    var res = await window.supabase.from('publications').delete().eq('id', id);
    if (res.error) { window.toast && toast('Помилка: ' + res.error.message, 'error'); return; }
    _trashCache = _trashCache.filter(function (p) { return p.id !== id; });
    renderTrashView();
    updateTrashCount();
    window.toast && toast('Видалено назавжди', 'success');
  }
  window.hqRestorePub = restorePub;
  window.hqPurgePub = purgePub;

  function renderTrashView() {
    var root = document.getElementById('view-trash');
    if (!root) return;
    var me = Store.currentUser && Store.currentUser();
    var isAdmin = me && ['ceo', 'coo'].includes(me.role);
    var items = _trashCache || [];
    if (!items.length) {
      root.innerHTML = '<div class="view-header"><h1>🗑 Корзина</h1><span class="view-meta">· публікації · 30 днів</span></div>' +
        '<div class="hq-trash-empty">🗑 Корзина порожня</div>';
      return;
    }
    root.innerHTML = '<div class="view-header"><h1>🗑 Корзина</h1><span class="view-meta">· ' + items.length + ' публікацій · ' + (isAdmin ? 'CEO/COO бачить ВСІ' : 'тільки твої') + '</span></div>' +
      '<div class="hq-trash-view">' +
      '<div style="font-size:12px;color:#888;margin-bottom:14px;">Зберігається 30 днів, потім видаляється назавжди.</div>' +
      items.map(function (p) {
        var daysLeft = p.days_remaining || 0;
        var daysColor = daysLeft <= 3 ? '#FF6A7A' : daysLeft <= 7 ? '#FBBF24' : '#888';
        var canRestore = (p.deleted_by === me?.id) || (p.created_by === me?.id) || isAdmin;
        var canPurge = (p.created_by === me?.id) || isAdmin;
        var safeTitle = (p.title || 'без назви').replace(/</g, '&lt;');
        return '<div class="hq-trash-row">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:14px;font-weight:600;color:#fff;">' + safeTitle + '</div>' +
            '<div class="hq-trash-info">' +
              'Видалив: <b style="color:#fff;">' + ((p.deleted_by_name || '?')).replace(/</g, '&lt;') + '</b> · ' +
              new Date(p.deleted_at).toLocaleString('uk-UA') + ' · ' +
              '<span style="color:' + daysColor + ';">залишилось ' + daysLeft + 'д</span>' +
              (p.deleted_reason ? '<br><i>«' + p.deleted_reason.replace(/</g, '&lt;') + '»</i>' : '') +
            '</div>' +
          '</div>' +
          '<div class="hq-trash-actions">' +
            (canRestore ? '<button class="hq-trash-restore" data-restore="' + p.id + '">↩ Відновити</button>' : '') +
            (canPurge ? '<button class="hq-trash-purge" data-purge="' + p.id + '">🗑</button>' : '') +
          '</div>' +
        '</div>';
      }).join('') +
      '</div>';
    root.querySelectorAll('[data-restore]').forEach(function (b) { b.onclick = function () { restorePub(b.dataset.restore); }; });
    root.querySelectorAll('[data-purge]').forEach(function (b) { b.onclick = function () { purgePub(b.dataset.purge); }; });
  }

  function injectSidebar() {
    if (document.getElementById('nav-trash')) return;
    var target = document.querySelector('.sidebar-nav, .nav-list, aside nav, aside');
    if (!target) { setTimeout(injectSidebar, 500); return; }
    var item = document.createElement('a');
    item.id = 'nav-trash';
    item.href = '#trash';
    item.className = 'nav-item';
    item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 14px;color:#888;font-size:12px;text-decoration:none;border-radius:6px;cursor:pointer;';
    item.innerHTML = '🗑 <span>Корзина</span> <span id="hq-trash-count" style="opacity:.6;margin-left:auto;"></span>';
    target.appendChild(item);
    item.onclick = function (e) { e.preventDefault(); location.hash = '#trash'; };
  }
  function ensureViewContainer() {
    if (document.getElementById('view-trash')) return;
    var main = document.querySelector('main, .app-main, #app');
    if (!main) { setTimeout(ensureViewContainer, 500); return; }
    var view = document.createElement('div');
    view.id = 'view-trash';
    view.className = 'view hidden';
    view.style.display = 'none';
    main.appendChild(view);
  }

  function handleRoute() {
    if (location.hash !== '#trash') {
      var v = document.getElementById('view-trash');
      if (v) v.style.display = 'none';
      return;
    }
    document.querySelectorAll('.view, [class*="view-"]').forEach(function (v) {
      if (v.id !== 'view-trash') v.style.display = 'none';
    });
    var trashV = document.getElementById('view-trash');
    if (trashV) {
      trashV.style.display = 'block';
      loadTrash().then(renderTrashView);
    }
  }
  window.addEventListener('hashchange', handleRoute);

  function init() {
    injectSidebar();
    ensureViewContainer();
    updateTrashCount();
    if (location.hash === '#trash') setTimeout(handleRoute, 500);
    setInterval(updateTrashCount, 120000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  setTimeout(init, 800);
  setTimeout(init, 2500);

  if (window.DEBUG) console.log('[HQ trash] v2 loaded — 30-day soft-delete + restore');
})();
