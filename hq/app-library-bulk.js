/* ============================================================
   DreamCar HQ — Library Bulk Tag (#121)
   ============================================================ */
// Розширює bulk-bar Бібліотеки (з #108) кнопкою "🏷 Додати теги".
// При натисканні — модалка з input для тегів (через пробіл),
// додає до всіх обраних креативів через Store.upsertCreative.
//
// Move-to-folder поки не реалізовано — у `creatives` немає колонки folder.
// Якщо потрібні папки — окрема задача з міграцією + UI categorization.

(function () {
  if (window.__hqLibBulk) return;
  window.__hqLibBulk = true;

  function getSelectedIds() {
    // Знайти checkboxes у бібліотеці
    var checked = document.querySelectorAll('.lib-tile input[type="checkbox"]:checked');
    return Array.from(checked).map(function (cb) {
      var tile = cb.closest('.lib-tile');
      return tile && tile.dataset.id;
    }).filter(Boolean);
  }

  function showTagModal(ids) {
    var existing = document.getElementById('hq-bulk-tag-modal');
    if (existing) existing.remove();

    var backdrop = document.createElement('div');
    backdrop.id = 'hq-bulk-tag-modal';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);' +
      'backdrop-filter:blur(4px);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;';
    backdrop.innerHTML =
      '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:14px;' +
      'max-width:480px;width:100%;box-shadow:var(--shadow);">' +
        '<div style="padding:18px 22px;border-bottom:1px solid var(--border);">' +
          '<h2 style="font-size:17px;font-weight:700;color:#fff;">🏷 Додати теги</h2>' +
          '<div style="font-size:12px;color:var(--grey);margin-top:4px;">Буде додано до ' + ids.length + ' креативів</div>' +
        '</div>' +
        '<div style="padding:22px;">' +
          '<div class="field">' +
            '<label style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey);font-weight:700;margin-bottom:6px;display:block;">Теги (через пробіл)</label>' +
            '<input type="text" id="hq-bulk-tag-input" autofocus placeholder="dreamcar mustang весна2026" ' +
              'style="width:100%;background:var(--bg);border:1px solid var(--border);color:#fff;padding:9px 12px;border-radius:8px;font-size:13px;"/>' +
            '<div style="font-size:11px;color:var(--grey);margin-top:4px;">' +
              'Префікс # не обов\'язковий. Дублікати у тегах будуть проігноровані.' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div style="padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;background:var(--bg);">' +
          '<button class="btn" id="hq-bulk-tag-cancel">Скасувати</button>' +
          '<button class="btn btn-primary" id="hq-bulk-tag-apply">🏷 Додати</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);

    var input = document.getElementById('hq-bulk-tag-input');
    var cancel = document.getElementById('hq-bulk-tag-cancel');
    var apply = document.getElementById('hq-bulk-tag-apply');

    setTimeout(function () { input && input.focus(); }, 50);

    function close() { backdrop.remove(); }

    cancel.onclick = close;
    backdrop.onclick = function (e) { if (e.target === backdrop) close(); };
    input.onkeydown = function (e) {
      if (e.key === 'Enter') apply.click();
      else if (e.key === 'Escape') close();
    };

    apply.onclick = function () {
      var val = (input.value || '').trim();
      if (!val) { close(); return; }
      var newTags = val.split(/\s+/)
        .map(function (t) { return t.replace(/^#+/, ''); })
        .filter(Boolean);
      if (newTags.length === 0) { close(); return; }

      var S = (typeof Store !== 'undefined' ? Store : window.Store);
      if (!S || !S.creative) { close(); return; }

      var updated = 0;
      ids.forEach(function (cid) {
        try {
          var c = S.creative(cid);
          if (!c) return;
          var curTags = Array.isArray(c.tags) ? c.tags.slice() : [];
          var added = false;
          newTags.forEach(function (t) {
            if (curTags.indexOf(t) < 0) { curTags.push(t); added = true; }
          });
          if (added) {
            c.tags = curTags;
            if (typeof S.upsertCreative === 'function') S.upsertCreative(c);
            updated++;
          }
        } catch (e) { console.warn('bulk-tag:', e); }
      });

      if (typeof toast === 'function') {
        toast('Теги додано', 'success', updated + ' креативів · ' + newTags.map(function (t) { return '#' + t; }).join(' '));
      }
      // Перерисувати бібліотеку
      if (typeof window.navigate === 'function') {
        setTimeout(window.navigate, 200);
      }
      close();
    };
  }

  function installBulkTagButton() {
    var bar = document.querySelector('.bulk-bar');
    if (!bar) return;
    var actions = bar.querySelector('.bb-actions');
    if (!actions) return;
    if (bar.__hqBulkTagInstalled) return;
    bar.__hqBulkTagInstalled = true;

    var btn = document.createElement('button');
    btn.className = 'btn btn-sm';
    btn.innerHTML = '🏷 Додати теги';
    btn.title = 'Додати теги до обраних креативів';
    btn.style.cssText = 'background:transparent;color:var(--gold);border:1px solid var(--gold);';
    btn.onclick = function () {
      var ids = getSelectedIds();
      if (ids.length === 0) {
        if (typeof toast === 'function') toast('Нічого не обрано', 'warn', 'Постав галочки на креативах');
        return;
      }
      showTagModal(ids);
    };

    // Вставити ПЕРЕД "Видалити" кнопкою (щоб delete лишився останнім)
    var deleteBtn = actions.querySelector('button.btn-danger') || actions.lastElementChild;
    if (deleteBtn) {
      actions.insertBefore(btn, deleteBtn);
    } else {
      actions.appendChild(btn);
    }
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.querySelector('.bulk-bar .bb-actions')) {
        clearTimeout(window.__hqLBTimer);
        window.__hqLBTimer = setTimeout(installBulkTagButton, 50);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(installBulkTagButton, 500);
  setTimeout(installBulkTagButton, 1500);
  setTimeout(installBulkTagButton, 4000);

  if (window.DEBUG) console.log('%cDreamCar HQ Library Bulk Tag %c· (#121)',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
