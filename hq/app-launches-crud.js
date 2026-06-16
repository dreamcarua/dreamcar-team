/* ============================================================
   DreamCar HQ — Launches CRUD
   ============================================================ */
// #97: Адміни можуть додавати/редагувати/видаляти проекти-запуски
// (наприклад "AUDI E-TRON 2026", "BMW X5 Hybrid #17").

(function () {
  if (window.__hqLaunchesCrud) return;
  window.__hqLaunchesCrud = true;

  function getMe() { try { return Store.currentUser && Store.currentUser(); } catch (_) { return null; } }
  function isAdmin() {
    var u = getMe(); return u && ['ceo','coo','lead'].includes(u.role);
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }
  function uuidV4() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  (function injectCss() {
    if (document.getElementById('hq-launches-crud-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-launches-crud-css';
    css.textContent =
      '.hq-launch-actions { display: flex; gap: 6px; margin-top: 10px; }' +
      '.hq-launch-actions button { background: var(--bg-3); border: 1px solid var(--border); color: #ddd; padding: 5px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; }' +
      '.hq-launch-actions button:hover { background: var(--bg-hover); border-color: var(--red); }' +
      '.hq-launch-actions button.del { color: var(--red-soft); }' +
      '.hq-launch-add-btn { background: var(--red); color: #fff; border: none; padding: 9px 16px; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; margin-bottom: 16px; }' +
      '.hq-launch-add-btn:hover { filter: brightness(1.1); }' +
      '.hq-launch-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 300; display: flex; align-items: center; justify-content: center; padding: 20px; }' +
      '.hq-launch-form-card { background: var(--bg-2); border: 1px solid var(--border); border-radius: 12px; padding: 22px 24px; max-width: 520px; width: 100%; box-shadow: var(--shadow); }' +
      '.hq-launch-form-card h2 { font-size: 16px; color: #fff; margin-bottom: 14px; font-weight: 800; }' +
      '.hq-launch-form { display: grid; gap: 12px; }' +
      '.hq-launch-form label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--grey); margin-bottom: 4px; font-weight: 700; }' +
      '.hq-launch-form input, .hq-launch-form textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); color: #fff; padding: 8px 10px; border-radius: 6px; font-size: 12px; font-family: inherit; }' +
      '.hq-launch-form .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }' +
      '.hq-launch-form .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }';
    document.head.appendChild(css);
  })();

  function showFormModal(existing) {
    var isEdit = !!existing;
    var l = existing || {
      id: null, name: '', color: '#E30613',
      from: new Date().toISOString().slice(0,10),
      to: new Date(Date.now() + 30 * 86400000).toISOString().slice(0,10),
    };

    document.querySelectorAll('.hq-launch-modal').forEach(function (m) { m.remove(); });

    var sc = document.createElement('div');
    sc.className = 'hq-launch-modal';
    sc.innerHTML =
      '<div class="hq-launch-form-card">' +
        '<h2>' + (isEdit ? '✎ Редагувати проєкт' : '+ Новий проєкт') + '</h2>' +
        '<div class="hq-launch-form">' +
          '<div><label>Назва *</label><input id="lnf_name" maxlength="80" value="' + escapeHtml(l.name) + '" placeholder="AUDI E-TRON 2026"/></div>' +
          '<div class="row">' +
            '<div><label>Дата старту</label><input id="lnf_from" type="date" value="' + escapeHtml(l.from || '') + '"/></div>' +
            '<div><label>Дата завершення</label><input id="lnf_to" type="date" value="' + escapeHtml(l.to || '') + '"/></div>' +
          '</div>' +
          '<div><label>Колір (hex)</label><input id="lnf_color" type="color" value="' + escapeHtml(l.color || '#E30613') + '" style="height:40px;cursor:pointer;"/></div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn" id="lnf_cancel">Скасувати</button>' +
          '<button class="btn btn-primary" id="lnf_save" style="background:var(--red);color:#fff;">' + (isEdit ? '💾 Зберегти' : '+ Створити') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sc);

    sc.querySelector('#lnf_cancel').onclick = function () { sc.remove(); };
    sc.onclick = function (e) { if (e.target === sc) sc.remove(); };

    sc.querySelector('#lnf_save').onclick = async function () {
      var name = (sc.querySelector('#lnf_name').value || '').trim();
      if (!name) {
        if (typeof toast === 'function') toast('Назва обовʼязкова', 'warn');
        return;
      }
      var row = {
        name: name,
        color: sc.querySelector('#lnf_color').value || '#E30613',
        starts_on: sc.querySelector('#lnf_from').value || null,
        ends_on: sc.querySelector('#lnf_to').value || null,
        is_active: true,
      };

      var sb = window.supabase;
      if (!window.HQ_BACKEND || !sb) {
        if (typeof toast === 'function') toast('Demo-режим', 'warn', 'Проєкт не збережено');
        sc.remove();
        return;
      }
      var saveBtn = sc.querySelector('#lnf_save');
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳…';

      try {
        var resp;
        if (isEdit && l.id) {
          resp = await sb.from('launches').update(row).eq('id', l.id).select().single();
        } else {
          row.id = uuidV4();
          row.desk_id = '11111111-1111-1111-1111-111111111111';
          resp = await sb.from('launches').insert(row).select().single();
        }
        if (resp.error) {
          console.error('launch save err:', resp.error);
          if (typeof toast === 'function') toast('Помилка', 'error', resp.error.message);
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? '💾 Зберегти' : '+ Створити';
          return;
        }
        if (typeof toast === 'function') toast(isEdit ? 'Збережено' : 'Створено', 'success', name);

        // Update Store optimistically
        try {
          var fresh = {
            id: resp.data.id,
            name: resp.data.name,
            color: resp.data.color,
            from: resp.data.starts_on,
            to: resp.data.ends_on,
          };
          if (isEdit) {
            var ix = (Store._data.launches || []).findIndex(function (x) { return x.id === l.id; });
            if (ix >= 0) Store._data.launches[ix] = fresh;
          } else {
            (Store._data.launches = Store._data.launches || []).push(fresh);
          }
        } catch (_) {}

        sc.remove();
        // Re-render launches view
        if (typeof window.navigate === 'function') {
          try { window.navigate(); } catch (_) {}
        }
        setTimeout(injectCrudButtons, 300);
      } catch (e) {
        if (typeof toast === 'function') toast('Помилка', 'error', String(e.message || e));
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? '💾 Зберегти' : '+ Створити';
      }
    };
  }

  async function deleteLaunch(launchId, launchName) {
    if (!confirm('Видалити проєкт «' + launchName + '»?\n\nПовʼязані публікації не будуть видалені, але вони втратять прив\'язку до проєкту.')) return;
    var sb = window.supabase;
    if (!sb) return;
    try {
      // Soft-delete через is_active = false (краще ніж hard delete для history)
      var resp = await sb.from('launches').update({ is_active: false }).eq('id', launchId);
      if (resp.error) {
        if (typeof toast === 'function') toast('Помилка', 'error', resp.error.message);
        return;
      }
      if (typeof toast === 'function') toast('Видалено', 'success', launchName);
      // Видалити з local Store
      try {
        Store._data.launches = (Store._data.launches || []).filter(function (l) { return l.id !== launchId; });
      } catch (_) {}
      if (typeof window.navigate === 'function') {
        try { window.navigate(); } catch (_) {}
      }
      setTimeout(injectCrudButtons, 300);
    } catch (e) {
      if (typeof toast === 'function') toast('Помилка', 'error', String(e.message || e));
    }
  }

  function injectCrudButtons() {
    if (!isAdmin()) return;
    var route = (location.hash || '').slice(1).split('/')[0];
    if (route !== 'launches') return;

    var main = document.getElementById('main');
    if (!main) return;

    // Add «+ Новий проєкт» button у view-header якщо ще нема
    var header = main.querySelector('.view-header .actions, .view-header');
    if (header && !header.querySelector('.hq-launch-add-btn')) {
      var addBtn = document.createElement('button');
      addBtn.className = 'hq-launch-add-btn';
      addBtn.textContent = '+ Новий проєкт';
      addBtn.onclick = function () { showFormModal(null); };
      var actions = main.querySelector('.view-header .actions');
      if (actions) actions.appendChild(addBtn);
      else if (header) header.appendChild(addBtn);
    }

    // Add edit/delete buttons на кожну launch card
    var launches = Store.launches ? Store.launches() : [];
    // Шукаємо launch cards — це різноманітні селектори
    var cards = main.querySelectorAll('[data-launch-id], .launch-card, .lnch-card');
    if (cards.length === 0) {
      // Fallback — додаємо панель внизу для кожного launch
      var existingPanel = main.querySelector('.hq-launches-list-fallback');
      if (existingPanel) existingPanel.remove();
      if (launches.length > 0) {
        var panel = document.createElement('div');
        panel.className = 'hq-launches-list-fallback';
        panel.style.cssText = 'padding: 18px 28px; max-width: 900px; margin: 0 auto;';
        panel.innerHTML = '<h3 style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey);margin-bottom:10px;font-weight:700;">⚙️ Управління проєктами (admin)</h3>' +
          launches.map(function (l) {
            return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg-2);border:1px solid var(--border);border-left:3px solid ' + escapeHtml(l.color || '#E30613') + ';border-radius:6px;margin-bottom:6px;">' +
              '<span style="font-weight:700;color:#fff;flex:1;">' + escapeHtml(l.name || '') + '</span>' +
              '<span style="font-size:11px;color:var(--grey);">' + escapeHtml(l.from || '') + ' → ' + escapeHtml(l.to || '') + '</span>' +
              '<button class="btn btn-sm" data-edit-launch="' + escapeHtml(l.id) + '">✎ Редагувати</button>' +
              '<button class="btn btn-sm btn-danger" data-del-launch="' + escapeHtml(l.id) + '" data-del-name="' + escapeHtml(l.name) + '">✕ Видалити</button>' +
            '</div>';
          }).join('');
        main.appendChild(panel);

        panel.querySelectorAll('[data-edit-launch]').forEach(function (btn) {
          btn.onclick = function () {
            var l = launches.find(function (x) { return String(x.id) === btn.dataset.editLaunch; });
            if (l) showFormModal(l);
          };
        });
        panel.querySelectorAll('[data-del-launch]').forEach(function (btn) {
          btn.onclick = function () {
            deleteLaunch(btn.dataset.delLaunch, btn.dataset.delName);
          };
        });
      }
    } else {
      // Inject actions на кожну card
      cards.forEach(function (card) {
        if (card.querySelector('.hq-launch-actions')) return;
        var id = card.dataset.launchId || card.dataset.id;
        if (!id) return;
        var l = launches.find(function (x) { return String(x.id) === String(id); });
        if (!l) return;
        var actions = document.createElement('div');
        actions.className = 'hq-launch-actions';
        actions.innerHTML =
          '<button data-edit="' + escapeHtml(id) + '">✎ Редагувати</button>' +
          '<button class="del" data-del="' + escapeHtml(id) + '" data-name="' + escapeHtml(l.name) + '">✕ Видалити</button>';
        card.appendChild(actions);
        actions.querySelector('[data-edit]').onclick = function (e) {
          e.stopPropagation();
          showFormModal(l);
        };
        actions.querySelector('[data-del]').onclick = function (e) {
          e.stopPropagation();
          deleteLaunch(id, l.name);
        };
      });
    }
  }

  function maybeRun() {
    if ((location.hash || '').slice(1).split('/')[0] === 'launches') {
      [400, 1200, 2500].forEach(function (ms) { setTimeout(injectCrudButtons, ms); });
    }
  }
  window.addEventListener('hashchange', maybeRun);
  maybeRun();

  if (window.DEBUG) console.log('%cDreamCar HQ Launches CRUD %c· admin actions ready',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
