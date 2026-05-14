/* ============================================================
   DreamCar HQ — Duplicate to Platform (#120)
   ============================================================ */
// Кнопка "📋 Дублювати на →" у footer картки публікації.
// При натисканні — dropdown з платформами. Обраний пункт створює
// нову публікацію з тим самим текстом, креативами і налаштуваннями,
// але з ЄДИНОЮ обраною платформою (статус=draft, нова історія, новий id).

(function () {
  if (window.__hqDuplicateTo) return;
  window.__hqDuplicateTo = true;

  var PLATFORMS = [
    { id: 'ig', name: 'Instagram', icon: '📷', color: '#E1306C' },
    { id: 'tg', name: 'Telegram',  icon: '✈️', color: '#0088cc' },
    { id: 'tt', name: 'TikTok',    icon: '🎵', color: '#fe2c55' },
    { id: 'fb', name: 'Facebook',  icon: '📘', color: '#1877f2' },
    { id: 'yt', name: 'YT Shorts', icon: '▶️', color: '#ff0000' },
    { id: 'th', name: 'Threads',   icon: '🧵', color: '#666' },
  ];

  function getCurrentPub() {
    if (window.__hqCurrentPub) return window.__hqCurrentPub;
    var hash = (location.hash || '').slice(1);
    if (hash.indexOf('publication/') === 0) {
      try { return (typeof Store !== 'undefined' ? Store : window.Store).pub(hash.split('/')[1]); }
      catch (_) {}
    }
    return null;
  }

  function shortId() {
    return Math.random().toString(36).slice(2, 10);
  }

  function duplicateToPlat(p, platId) {
    if (!p) return;
    var pdef = PLATFORMS.find(function (x) { return x.id === platId; });
    if (!pdef) return;
    try {
      var newPub = JSON.parse(JSON.stringify(p));
      newPub.id = 'p_' + shortId() + Date.now().toString(36);
      newPub.platforms = [platId];
      newPub.status = 'draft';
      newPub.approved_by = [];
      newPub.title = p.title + ' [' + platId.toUpperCase() + ']';
      delete newPub.comments;

      // Якщо є per-platform datetime — взяти тільки для цього майданчика
      if (newPub.platformDates && newPub.platformDates[platId]) {
        newPub.dateTime = newPub.platformDates[platId];
      }
      newPub.platformDates = {};

      var me = null;
      try { me = (typeof Store !== 'undefined' ? Store : window.Store).currentUser(); } catch (_) {}
      var actorId = (me && me.id) || null;

      newPub.history = [{
        id: 'h_' + shortId(),
        at: new Date().toISOString(),
        author: actorId,
        action: 'create',
        detail: 'Дубльовано з «' + (p.title || '?') + '» (' + p.id + ')',
      }];
      newPub.createdAt = new Date().toISOString();
      newPub.updatedAt = new Date().toISOString();
      delete newPub._isNew;
      delete newPub._trashed;
      delete newPub._isClone;

      var S = (typeof Store !== 'undefined' ? Store : window.Store);
      S.upsertPub(newPub);

      if (typeof toast === 'function') {
        toast('Дубльовано', 'success', pdef.icon + ' ' + pdef.name + ' · «' + newPub.title + '»');
      }

      // Закрити поточну модалку, відкрити нову
      setTimeout(function () {
        if (window.Modal && typeof window.Modal.close === 'function') {
          try { window.Modal.close(); } catch (_) {}
        }
        setTimeout(function () {
          location.hash = '#publication/' + newPub.id;
        }, 200);
      }, 300);
    } catch (e) {
      console.error('duplicate-to:', e);
      if (typeof toast === 'function') toast('Помилка', 'error', String(e.message || e));
    }
  }

  function buildDropdown(p) {
    var wrap = document.createElement('div');
    wrap.className = 'hq-dup-wrap';
    wrap.style.cssText = 'position:relative;display:inline-block;';

    var btn = document.createElement('button');
    btn.className = 'btn hq-dup-btn';
    btn.innerHTML = '📋 Дублювати на ▾';
    wrap.appendChild(btn);

    var menu = document.createElement('div');
    menu.className = 'hq-dup-menu';
    menu.style.cssText = 'display:none;position:absolute;bottom:calc(100% + 4px);left:0;' +
      'background:var(--bg-3);border:1px solid var(--border);border-radius:8px;' +
      'box-shadow:var(--shadow);min-width:200px;padding:4px;z-index:101;';
    menu.innerHTML = PLATFORMS.map(function (pl) {
      var alreadyHas = (p.platforms || []).indexOf(pl.id) >= 0;
      return '<div class="hq-dup-item' + (alreadyHas ? ' disabled' : '') + '" data-plat="' + pl.id + '" ' +
        'style="padding:8px 12px;' + (alreadyHas ? 'cursor:not-allowed;opacity:0.4;' : 'cursor:pointer;') +
        'border-radius:6px;display:flex;align-items:center;gap:10px;font-size:13px;color:#fff;">' +
        '<span style="font-size:16px;">' + pl.icon + '</span> ' +
        '<span>' + pl.name + (alreadyHas ? ' <small style="color:var(--grey);">(вже є)</small>' : '') + '</span>' +
        '</div>';
    }).join('');
    wrap.appendChild(menu);

    btn.onclick = function (e) {
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    };
    menu.querySelectorAll('.hq-dup-item:not(.disabled)').forEach(function (item) {
      item.onclick = function (e) {
        e.stopPropagation();
        menu.style.display = 'none';
        duplicateToPlat(p, item.dataset.plat);
      };
      item.onmouseenter = function () { item.style.background = 'var(--bg-hover)'; };
      item.onmouseleave = function () { item.style.background = 'transparent'; };
    });

    // Close on outside click
    var closer = function (e) {
      if (!wrap.contains(e.target)) menu.style.display = 'none';
    };
    document.addEventListener('click', closer);

    // Cleanup на видалення з DOM
    var watcher = new MutationObserver(function () {
      if (!document.body.contains(wrap)) {
        document.removeEventListener('click', closer);
        watcher.disconnect();
      }
    });
    watcher.observe(document.body, { childList: true, subtree: true });

    return wrap;
  }

  function installButton() {
    var foot = document.querySelector('.modal-foot');
    if (!foot) return;
    if (foot.__hqDupInstalled) return;
    var left = foot.querySelector('.left');
    if (!left) return;
    var p = getCurrentPub();
    if (!p) return;
    // Не показувати для нового поста (без id у списку Store) і для cloned-картки
    if (p._isClone) return;

    foot.__hqDupInstalled = true;
    left.appendChild(buildDropdown(p));
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.querySelector('.modal-foot .left')) {
        clearTimeout(window.__hqDupTimer);
        window.__hqDupTimer = setTimeout(installButton, 50);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(installButton, 500);
  setTimeout(installButton, 1500);
  setTimeout(installButton, 4000);

  console.log('%cDreamCar HQ Duplicate To %c· (#120)',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
