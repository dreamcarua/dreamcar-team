/* ============================================================
   DreamCar HQ — Library delete + bulk-delete
   ============================================================ */
// Користувач може:
//  1) Hover на lib-tile → показується ✕ у top-right для швидкого delete
//  2) Click на checkbox → toggle selection (bulk mode)
//  3) Bulk-bar внизу з кнопкою "✕ Видалити N виділених"

(function () {
  if (window.__hqLibDelete) return;
  window.__hqLibDelete = true;

  var selectedIds = new Set();

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  (function injectCss() {
    if (document.getElementById('hq-lib-delete-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-lib-delete-css';
    css.textContent =
      '.lib-tile { position: relative; }' +
      '.lib-tile .lt-del-btn { position: absolute; top: 8px; right: 8px; z-index: 5; ' +
        'width: 28px; height: 28px; border-radius: 50%; background: rgba(204,0,0,0.85); ' +
        'color: #fff; border: none; cursor: pointer; font-size: 14px; line-height: 1; ' +
        'display: none; align-items: center; justify-content: center; ' +
        'box-shadow: 0 2px 8px rgba(0,0,0,0.5); transition: transform 0.15s, background 0.15s; }' +
      '.lib-tile:hover .lt-del-btn { display: flex; }' +
      '.lib-tile .lt-del-btn:hover { transform: scale(1.1); background: var(--red); }' +
      '.lib-tile .lt-checkbox { position: absolute; top: 8px; left: 8px; z-index: 5; ' +
        'width: 22px; height: 22px; border-radius: 4px; background: rgba(0,0,0,0.6); ' +
        'border: 2px solid rgba(255,255,255,0.7); cursor: pointer; ' +
        'display: none; align-items: center; justify-content: center; font-size: 14px; color: #fff; ' +
        'transition: background 0.15s; }' +
      '.lib-tile:hover .lt-checkbox, .lib-tile.lt-selected .lt-checkbox { display: flex; }' +
      '.lib-tile.lt-selected .lt-checkbox { background: var(--red); border-color: var(--red); }' +
      '.lib-tile.lt-selected { outline: 2px solid var(--red); outline-offset: -2px; }' +
      '.hq-lib-bulk-bar { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); ' +
        'background: var(--bg-3); border: 1px solid var(--red); border-radius: 12px; ' +
        'padding: 12px 18px; box-shadow: 0 -4px 24px rgba(0,0,0,0.5); ' +
        'display: none; align-items: center; gap: 14px; z-index: 200; ' +
        'animation: bulkSlideUp 0.3s ease; }' +
      '@keyframes bulkSlideUp { from { transform: translate(-50%, 50px); opacity: 0 } to { transform: translate(-50%, 0); opacity: 1 } }' +
      '.hq-lib-bulk-bar.shown { display: flex; }' +
      '.hq-lib-bulk-bar .bulk-count { font-weight: 700; color: #fff; font-size: 13px; }' +
      '.hq-lib-bulk-bar .bulk-del { background: var(--red); color: #fff; border: none; ' +
        'padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 700; cursor: pointer; }' +
      '.hq-lib-bulk-bar .bulk-del:hover { filter: brightness(1.15); }' +
      '.hq-lib-bulk-bar .bulk-clear { background: transparent; color: var(--grey); border: 1px solid var(--border); ' +
        'padding: 7px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; }';
    document.head.appendChild(css);
  })();

  // ---- Soft-delete one creative ----
  async function deleteCreative(creativeId, name) {
    var sb = window.supabase;
    if (!sb) {
      if (typeof toast === 'function') toast('Demo-режим', 'warn');
      return false;
    }
    try {
      var resp = await sb.from('creatives')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', creativeId);
      if (resp.error) {
        if (typeof toast === 'function') toast('Помилка', 'error', resp.error.message);
        return false;
      }
      // Remove з Store
      try {
        Store._data.creatives = (Store._data.creatives || []).filter(function (c) { return c.id !== creativeId; });
      } catch (_) {}
      return true;
    } catch (e) {
      if (typeof toast === 'function') toast('Помилка', 'error', String(e.message || e));
      return false;
    }
  }

  async function bulkDelete(ids) {
    if (!ids || ids.length === 0) return;
    var sb = window.supabase;
    if (!sb) return;
    try {
      var resp = await sb.from('creatives')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', ids);
      if (resp.error) {
        if (typeof toast === 'function') toast('Помилка', 'error', resp.error.message);
        return;
      }
      // Remove з Store
      var idSet = new Set(ids);
      try {
        Store._data.creatives = (Store._data.creatives || []).filter(function (c) { return !idSet.has(c.id); });
      } catch (_) {}
      if (typeof toast === 'function') toast('Видалено', 'success', ids.length + ' креативів у кошик');
      selectedIds.clear();
      // Re-render
      if (typeof window.navigate === 'function') {
        try { window.navigate(); } catch (_) {}
      }
      updateBulkBar();
    } catch (e) {
      if (typeof toast === 'function') toast('Помилка', 'error', String(e.message || e));
    }
  }

  // ---- Bulk bar ----
  function getBulkBar() {
    var bar = document.getElementById('hqLibBulkBar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'hqLibBulkBar';
    bar.className = 'hq-lib-bulk-bar';
    bar.innerHTML =
      '<span class="bulk-count">Вибрано: <b id="hqLibBulkCount">0</b></span>' +
      '<button class="bulk-del" id="hqLibBulkDel">✕ Видалити виділене</button>' +
      '<button class="bulk-clear" id="hqLibBulkClear">Скасувати</button>';
    document.body.appendChild(bar);
    bar.querySelector('#hqLibBulkDel').onclick = function () {
      var ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      if (!confirm('Видалити ' + ids.length + ' креативів?\n\nВони перейдуть у кошик (можна відновити через БД).')) return;
      bulkDelete(ids);
    };
    bar.querySelector('#hqLibBulkClear').onclick = function () {
      selectedIds.clear();
      document.querySelectorAll('.lib-tile.lt-selected').forEach(function (t) {
        t.classList.remove('lt-selected');
        var cb = t.querySelector('.lt-checkbox');
        if (cb) cb.textContent = '';
      });
      updateBulkBar();
    };
    return bar;
  }

  function updateBulkBar() {
    var bar = getBulkBar();
    var n = selectedIds.size;
    if (n === 0) {
      bar.classList.remove('shown');
      return;
    }
    bar.classList.add('shown');
    var cnt = document.getElementById('hqLibBulkCount');
    if (cnt) cnt.textContent = String(n);
  }

  // ---- Inject buttons into each lib-tile ----
  function enhanceTiles() {
    var route = (location.hash || '').slice(1).split('/')[0];
    if (route !== 'library') return;
    var tiles = document.querySelectorAll('.lib-tile');
    tiles.forEach(function (tile) {
      if (tile.dataset.hqDelEnhanced) return;
      var id = tile.dataset.id;
      if (!id) return;

      // Checkbox
      var cb = document.createElement('div');
      cb.className = 'lt-checkbox';
      if (selectedIds.has(id)) {
        cb.textContent = '✓';
        tile.classList.add('lt-selected');
      }
      cb.onclick = function (e) {
        e.stopPropagation();
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
          tile.classList.remove('lt-selected');
          cb.textContent = '';
        } else {
          selectedIds.add(id);
          tile.classList.add('lt-selected');
          cb.textContent = '✓';
        }
        updateBulkBar();
      };
      tile.appendChild(cb);

      // Delete button (single)
      var del = document.createElement('button');
      del.className = 'lt-del-btn';
      del.innerHTML = '✕';
      del.title = 'Видалити';
      del.onclick = async function (e) {
        e.stopPropagation();
        var c = Store.creative ? Store.creative(id) : null;
        var name = c?.name || 'креатив';
        if (!confirm('Видалити «' + name + '»?\n\nПерейде у кошик. Якщо креатив прикріплений до публікацій — звʼязки зникнуть.')) return;
        var ok = await deleteCreative(id, name);
        if (ok) {
          tile.style.transition = 'opacity 0.3s, transform 0.3s';
          tile.style.opacity = '0';
          tile.style.transform = 'scale(0.8)';
          setTimeout(function () { tile.remove(); }, 300);
          if (typeof toast === 'function') toast('Видалено', 'success', name);
          // Removing from select
          selectedIds.delete(id);
          updateBulkBar();
        }
      };
      tile.appendChild(del);

      tile.dataset.hqDelEnhanced = '1';
    });
  }

  function maybeEnhance() {
    if ((location.hash || '').slice(1).split('/')[0] === 'library') {
      [200, 800, 1800].forEach(function (ms) { setTimeout(enhanceTiles, ms); });
    }
  }

  window.addEventListener('hashchange', function () {
    if ((location.hash || '').slice(1).split('/')[0] !== 'library') {
      selectedIds.clear();
      updateBulkBar();
    } else {
      maybeEnhance();
    }
  });
  maybeEnhance();

  // MutationObserver — на нові lib-tile після rescue navigate()
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if ((location.hash || '').slice(1).split('/')[0] === 'library') {
        clearTimeout(window.__hqLibEnhTimer);
        window.__hqLibEnhTimer = setTimeout(enhanceTiles, 100);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ---- Add Delete button у openCreative lightbox ----
  // Перехоплення Modal.open для додавання кнопки якщо це creative lightbox
  function patchModalOpen() {
    if (!window.Modal || typeof Modal.open !== 'function' || Modal.open.__libDel) return false;
    var _orig = Modal.open.bind(Modal);
    Modal.open = function (html, size) {
      var r = _orig(html, size);
      // Якщо це creative lightbox — додамо кнопку Видалити
      setTimeout(function () {
        var modal = document.getElementById('modal');
        if (!modal) return;
        // Шукаємо чи це creative-modal: має кнопку "⬇ Відкрити оригінал" або "background:#000"
        var head = modal.querySelector('.modal-head h2');
        if (!head) return;
        // Чи це креатив? Подивимось на foot
        var foot = modal.querySelector('.modal-foot');
        if (!foot) return;
        if (foot.querySelector('.hq-cr-del')) return;
        // Спробуємо знайти creative id з тексту або з посилань
        var openLink = foot.querySelector('a[href*="supabase.co/storage"]');
        if (!openLink) return; // Не схоже на creative modal
        // Знаходимо creative за url
        var url = openLink.href;
        var creative = (Store.creatives && Store.creatives() || []).find(function (c) {
          return c.url === url || c.thumbnail_url === url;
        });
        if (!creative) return;

        var delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger hq-cr-del';
        delBtn.style.marginRight = 'auto';
        delBtn.innerHTML = '🗑 Видалити';
        delBtn.onclick = async function () {
          if (!confirm('Видалити «' + (creative.name || 'креатив') + '»?\n\nПерейде у кошик.')) return;
          var ok = await deleteCreative(creative.id, creative.name);
          if (ok) {
            if (typeof toast === 'function') toast('Видалено', 'success', creative.name);
            if (window.Modal && typeof Modal.close === 'function') Modal.close();
            if (typeof window.navigate === 'function') {
              try { window.navigate(); } catch (_) {}
            }
          }
        };
        foot.insertBefore(delBtn, foot.firstChild);
      }, 100);
      return r;
    };
    Modal.open.__libDel = true;
    return true;
  }
  if (!patchModalOpen()) {
    var t1 = 0;
    var iv1 = setInterval(function () {
      if (patchModalOpen() || t1++ > 20) clearInterval(iv1);
    }, 250);
  }

  console.log('%cDreamCar HQ Library Delete %c· single + bulk delete active',
    'color:#ff6577;font-weight:700;', 'color:#888;');
})();
