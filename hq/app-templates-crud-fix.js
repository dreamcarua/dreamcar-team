/* ============================================================
   DreamCar HQ — Templates CRUD enhancement
   ============================================================ */
// Розширює enhanceSettingsTemplates з app-templates.js:
//  - + Створити шаблон
//  - Редагувати (для user-defined, не для def_*)
//  - Видалити (вже було)
// Backend: pub_templates таблиця (migration 010).

(function () {
  if (window.__hqTplCrud) return;
  window.__hqTplCrud = true;

  function getMe() {
    try { return Store.currentUser && Store.currentUser(); } catch (_) { return null; }
  }
  function isLead() {
    var u = getMe(); return u && ['ceo','coo','lead'].includes(u.role);
  }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    if (document.getElementById('hq-tpl-crud-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-tpl-crud-css';
    css.textContent =
      '.hq-tpl-section .add-btn { background: var(--red); color: #fff; border: none; padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 700; cursor: pointer; margin-top: 12px; }' +
      '.hq-tpl-section .add-btn:hover { filter: brightness(1.1); }' +
      '.hq-tpl-row .actions { display: flex; gap: 6px; align-items: center; }' +
      '.hq-tpl-row .edit-btn { background: transparent; border: 1px solid var(--border); color: #93c5fd; padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; }' +
      '.hq-tpl-row .edit-btn:hover { border-color: #93c5fd; }' +
      '.hq-tpl-form { display: grid; gap: 12px; margin-top: 12px; }' +
      '.hq-tpl-form label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--grey); margin-bottom: 4px; }' +
      '.hq-tpl-form input, .hq-tpl-form select, .hq-tpl-form textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); color: #fff; padding: 8px 10px; border-radius: 6px; font-size: 12px; font-family: inherit; }' +
      '.hq-tpl-form .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }' +
      '.hq-tpl-form .plat-chips { display: flex; flex-wrap: wrap; gap: 6px; }' +
      '.hq-tpl-form .plat-chip { padding: 5px 10px; background: var(--bg-3); border: 1px solid var(--border); color: var(--grey); border-radius: 6px; font-size: 11px; cursor: pointer; user-select: none; }' +
      '.hq-tpl-form .plat-chip.on { background: var(--red); color: #fff; border-color: var(--red); }';
    document.head.appendChild(css);
  })();

  var PLATFORMS = [
    { id: 'ig', name: 'Instagram' },
    { id: 'tg', name: 'Telegram' },
    { id: 'tt', name: 'TikTok' },
    { id: 'yt', name: 'YT Shorts' },
    { id: 'th', name: 'Threads' },
    { id: 'fb', name: 'Facebook' },
  ];

  function showFormModal(existing) {
    var isEdit = !!existing;
    var t = existing || {
      id: null, name: '', icon: '📋', description: '',
      preset_data: { platforms: [], time: '12:00', tone: 'expert', length: 'medium', hashtags: [], contentType: 'post' },
    };
    var preset = t.preset_data || {};

    // Видалити попередній modal якщо є
    document.querySelectorAll('.hq-tpl-modal').forEach(function (m) { m.remove(); });

    var sc = document.createElement('div');
    sc.className = 'hq-tpl-modal';
    sc.innerHTML =
      '<div class="hq-tpl-card">' +
        '<h2>' + (isEdit ? '✎ Редагувати шаблон' : '+ Створити шаблон') + '</h2>' +
        '<div class="hq-tpl-form">' +
          '<div class="row">' +
            '<div><label>Назва *</label><input id="tplf_name" maxlength="60" value="' + escapeHtml(t.name) + '" placeholder="Анонс переможця"/></div>' +
            '<div><label>Іконка (emoji)</label><input id="tplf_icon" maxlength="4" value="' + escapeHtml(t.icon || '') + '" placeholder="🏆"/></div>' +
          '</div>' +
          '<div><label>Опис</label><input id="tplf_desc" maxlength="120" value="' + escapeHtml(t.description || '') + '" placeholder="IG+TG+FB о 20:00"/></div>' +
          '<div><label>Платформи</label>' +
            '<div class="plat-chips">' +
              PLATFORMS.map(function (p) {
                var on = (preset.platforms || []).indexOf(p.id) >= 0;
                return '<span class="plat-chip ' + (on ? 'on' : '') + '" data-plat="' + p.id + '">' + p.name + '</span>';
              }).join('') +
            '</div>' +
          '</div>' +
          '<div class="row">' +
            '<div><label>Час (HH:MM)</label><input id="tplf_time" type="time" value="' + escapeHtml(preset.time || '12:00') + '"/></div>' +
            '<div><label>Тип контенту</label><select id="tplf_ctype">' +
              ['post','reel','story','carousel','longread'].map(function (x) {
                return '<option value="' + x + '"' + (preset.contentType === x ? ' selected' : '') + '>' + x + '</option>';
              }).join('') +
            '</select></div>' +
          '</div>' +
          '<div class="row">' +
            '<div><label>Тон</label><select id="tplf_tone">' +
              ['playful','salesy','expert','casual','formal'].map(function (x) {
                return '<option value="' + x + '"' + (preset.tone === x ? ' selected' : '') + '>' + x + '</option>';
              }).join('') +
            '</select></div>' +
            '<div><label>Довжина</label><select id="tplf_len">' +
              ['short','medium','long'].map(function (x) {
                return '<option value="' + x + '"' + (preset.length === x ? ' selected' : '') + '>' + x + '</option>';
              }).join('') +
            '</select></div>' +
          '</div>' +
          '<div><label>Хештеги (через кому)</label><input id="tplf_tags" value="' + escapeHtml((preset.hashtags || []).join(', ')) + '" placeholder="#DreamCar, #Переможець"/></div>' +
        '</div>' +
        '<div class="hq-tpl-actions" style="margin-top:16px;">' +
          '<button class="btn" id="tplf_cancel">Скасувати</button>' +
          '<button class="btn btn-primary" id="tplf_save" style="background:var(--red);color:#fff;">' + (isEdit ? '💾 Зберегти' : '+ Створити') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sc);

    // Plat chip toggle
    sc.querySelectorAll('.plat-chip').forEach(function (c) {
      c.onclick = function () { c.classList.toggle('on'); };
    });

    sc.querySelector('#tplf_cancel').onclick = function () { sc.remove(); };
    sc.onclick = function (e) { if (e.target === sc) sc.remove(); };

    sc.querySelector('#tplf_save').onclick = async function () {
      var name = (sc.querySelector('#tplf_name').value || '').trim();
      if (!name) {
        if (typeof toast === 'function') toast('Назва обовʼязкова', 'warn');
        return;
      }
      var icon = (sc.querySelector('#tplf_icon').value || '📋').trim();
      var desc = (sc.querySelector('#tplf_desc').value || '').trim();
      var platforms = Array.from(sc.querySelectorAll('.plat-chip.on')).map(function (c) { return c.dataset.plat; });
      var time = sc.querySelector('#tplf_time').value || '12:00';
      var ctype = sc.querySelector('#tplf_ctype').value || 'post';
      var tone = sc.querySelector('#tplf_tone').value || 'expert';
      var len = sc.querySelector('#tplf_len').value || 'medium';
      var tagsRaw = (sc.querySelector('#tplf_tags').value || '').trim();
      var hashtags = tagsRaw ? tagsRaw.split(',').map(function (s) { return s.trim().replace(/^#/, ''); }).filter(Boolean).map(function (s) { return '#' + s; }) : [];

      var row = {
        name: name,
        icon: icon,
        description: desc || null,
        preset_data: {
          platforms: platforms,
          time: time,
          contentType: ctype,
          tone: tone,
          length: len,
          hashtags: hashtags,
        },
        visible_for_user_ids: null,  // null = visible to all
      };

      var sb = window.supabase;
      if (!window.HQ_BACKEND || !sb) {
        if (typeof toast === 'function') toast('Demo-режим', 'warn', 'Шаблон не збережено');
        sc.remove();
        return;
      }
      var saveBtn = sc.querySelector('#tplf_save');
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Збереження…';

      var me = getMe();
      try {
        var resp;
        if (isEdit && t.id) {
          resp = await sb.from('pub_templates').update(row).eq('id', t.id).select().single();
        } else {
          row.id = uuidV4();
          row.created_by = me && me.id;
          resp = await sb.from('pub_templates').insert(row).select().single();
        }
        if (resp.error) {
          console.error('template save err:', resp.error);
          if (typeof toast === 'function') toast('Помилка', 'error', resp.error.message);
          saveBtn.disabled = false;
          saveBtn.textContent = isEdit ? '💾 Зберегти' : '+ Створити';
          return;
        }
        if (typeof toast === 'function') toast(isEdit ? 'Збережено' : 'Створено', 'success', name);
        sc.remove();
        // Re-render templates section
        if (typeof window.enhanceSettingsTemplates === 'function') {
          // Видалити поточну
          document.querySelectorAll('.hq-tpl-section').forEach(function (s) { s.remove(); });
          window.enhanceSettingsTemplates();
        }
      } catch (e) {
        if (typeof toast === 'function') toast('Помилка', 'error', String(e.message || e));
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? '💾 Зберегти' : '+ Створити';
      }
    };
  }

  async function loadAll() {
    if (!window.HQ_BACKEND || !window.supabase) return [];
    var resp = await window.supabase
      .from('pub_templates')
      .select('id, name, description, icon, preset_data, visible_for_user_ids, created_by')
      .order('created_at', { ascending: true });
    if (resp.error) return [];
    return resp.data || [];
  }

  // Override enhanceSettingsTemplates to add CRUD buttons
  function enhanceWithCrud() {
    if (!isLead()) return;
    if ((location.hash || '').slice(1).split('/')[0] !== 'settings') return;

    var existing = document.querySelector('.hq-tpl-section');
    if (existing) existing.remove();

    var anchor = document.getElementById('main');
    if (!anchor) return;

    var block = document.createElement('div');
    block.className = 'hq-tpl-section';
    block.style.maxWidth = '720px';
    block.style.margin = '20px auto';
    block.innerHTML =
      '<div class="hts-title">📋 Шаблони публікацій</div>' +
      '<div class="hts-desc">Збережені пресети полів картки. Натиснеш «📋 З шаблону» у новій публікації — і 80% полів заповниться автоматично.</div>' +
      '<div class="hq-tpl-list" id="hq_tpl_settings_list">Завантаження…</div>' +
      '<button class="add-btn" id="hq_tpl_create">+ Створити шаблон</button>';
    anchor.appendChild(block);

    block.querySelector('#hq_tpl_create').onclick = function () { showFormModal(null); };

    loadAll().then(function (list) {
      var listEl = block.querySelector('#hq_tpl_settings_list');
      if (!list.length) {
        listEl.innerHTML = '<div style="font-size:11px;color:var(--grey-2);padding:8px 0;">Поки немає кастомних шаблонів — натисни «+ Створити».</div>';
        return;
      }
      listEl.innerHTML = list.map(function (t) {
        var plats = ((t.preset_data && t.preset_data.platforms) || []).map(function (p) {
          var n = {ig:'IG',tg:'TG',tt:'TT',yt:'YT',fb:'FB',th:'Th'};
          return n[p] || p;
        }).join('·');
        return '<div class="hq-tpl-row" data-id="' + escapeHtml(t.id) + '">' +
          '<div class="info">' +
            '<span style="font-size:18px;">' + (t.icon || '📋') + '</span>' +
            '<span><b>' + escapeHtml(t.name) + '</b>' +
            (plats ? '<span class="meta">' + plats + '</span>' : '') +
            (t.description ? '<div style="font-size:10px;color:var(--grey);margin-top:2px;">' + escapeHtml(t.description) + '</div>' : '') +
            '</span>' +
          '</div>' +
          '<div class="actions">' +
            '<button class="edit-btn" data-edit="' + escapeHtml(t.id) + '">✎ Редагувати</button>' +
            '<button data-del="' + escapeHtml(t.id) + '">Видалити</button>' +
          '</div>' +
          '</div>';
      }).join('');
      listEl.querySelectorAll('button[data-del]').forEach(function (b) {
        b.onclick = async function () {
          if (!confirm('Видалити цей шаблон?')) return;
          var sb = window.supabase;
          var resp = await sb.from('pub_templates').delete().eq('id', b.dataset.del);
          if (resp.error) {
            if (typeof toast === 'function') toast('Помилка', 'error', resp.error.message);
            return;
          }
          if (typeof toast === 'function') toast('Видалено', 'success');
          enhanceWithCrud();
        };
      });
      listEl.querySelectorAll('button[data-edit]').forEach(function (b) {
        b.onclick = function () {
          var item = list.find(function (x) { return String(x.id) === b.dataset.edit; });
          if (item) showFormModal(item);
        };
      });
    });
  }

  // Override
  window.enhanceSettingsTemplates = enhanceWithCrud;

  function maybeRunSettings() {
    if ((location.hash || '').slice(1).split('/')[0] !== 'settings') return;
    [400, 1200, 2500].forEach(function (ms) { setTimeout(enhanceWithCrud, ms); });
  }
  window.addEventListener('hashchange', maybeRunSettings);
  maybeRunSettings();

  if (window.DEBUG) console.log('%cDreamCar HQ Templates CRUD %c· create/edit ready', 'color:#93c5fd;font-weight:700;', 'color:#888;');
})();
