/* ============================================================
   DreamCar HQ — Publication Templates (B3)
   ============================================================ */
// Додає кнопку «📋 З шаблону» у картку публікації + секцію «Шаблони»
// у Settings для CRUD.
// Backend: pub_templates таблиця (migration 010).

(function () {
  if (window.__hqTemplatesLoaded) return;
  window.__hqTemplatesLoaded = true;

  function getStore() { try { return Store; } catch (_) { return null; } }
  function getCurrentUser() {
    var s = getStore();
    if (!s || typeof s.currentUser !== 'function') return null;
    try { return s.currentUser() || null; } catch (_) { return null; }
  }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function isLead() {
    var u = getCurrentUser();
    return u && ['ceo', 'coo', 'lead'].includes(u.role);
  }

  (function () {
    if (document.getElementById('hq-tpl-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-tpl-css';
    css.textContent =
      '.hq-tpl-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; background: var(--bg-3); border: 1px solid var(--border); color: #fff; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; margin-left: 8px; transition: background 0.15s; }' +
      '.hq-tpl-btn:hover { background: var(--bg-hover); border-color: var(--red); }' +
      '.hq-tpl-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 2000; display: flex; align-items: center; justify-content: center; padding: 20px; }' +
      '.hq-tpl-card { background: var(--bg-2); border: 1px solid var(--border); border-radius: 12px; padding: 22px 24px; max-width: 720px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: var(--shadow); }' +
      '.hq-tpl-card h2 { font-size: 16px; color: #fff; margin-bottom: 14px; font-weight: 800; }' +
      '.hq-tpl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px; }' +
      '.hq-tpl-item { background: var(--bg-3); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; cursor: pointer; transition: border-color 0.15s, transform 0.1s; }' +
      '.hq-tpl-item:hover { border-color: var(--red); transform: translateY(-2px); }' +
      '.hq-tpl-item .ico { font-size: 24px; margin-bottom: 6px; display: block; }' +
      '.hq-tpl-item .name { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 4px; }' +
      '.hq-tpl-item .desc { font-size: 11px; color: var(--grey); line-height: 1.4; }' +
      '.hq-tpl-item .platforms { margin-top: 8px; font-size: 10px; color: var(--gold); }' +
      '.hq-tpl-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 8px; }' +
      '.hq-tpl-empty { text-align: center; padding: 30px 14px; color: var(--grey); }' +
      '.hq-tpl-section { background: linear-gradient(135deg, rgba(147,197,253,0.08), transparent); border: 1px solid rgba(147,197,253,0.3); border-radius: 8px; padding: 14px; margin-top: 12px; }' +
      '.hq-tpl-section .hts-title { font-weight: 700; color: #fff; margin-bottom: 8px; font-size: 13px; }' +
      '.hq-tpl-section .hts-desc { font-size: 12px; color: var(--grey); margin-bottom: 10px; }' +
      '.hq-tpl-list { display: flex; flex-direction: column; gap: 6px; }' +
      '.hq-tpl-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: var(--bg-3); border-radius: 6px; font-size: 12px; }' +
      '.hq-tpl-row .info { display: flex; align-items: center; gap: 10px; color: #fff; }' +
      '.hq-tpl-row .meta { font-size: 11px; color: var(--grey); margin-left: 6px; }' +
      '.hq-tpl-row button { background: transparent; border: 1px solid var(--border); color: var(--red-soft); padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; }';
    document.head.appendChild(css);
  })();

  async function loadTemplates() {
    if (!window.HQ_BACKEND || !window.supabase) return defaultTemplates();
    var resp = await window.supabase
      .from('pub_templates')
      .select('id, name, description, icon, preset_data, visible_for_user_ids, created_by')
      .order('created_at', { ascending: true });
    if (resp.error) {
      console.warn('templates load err:', resp.error);
      return defaultTemplates();
    }
    var me = getCurrentUser();
    return (resp.data || []).filter(function (t) {
      if (!t.visible_for_user_ids || t.visible_for_user_ids.length === 0) return true;
      return me && t.visible_for_user_ids.indexOf(me.id) >= 0;
    });
  }

  function defaultTemplates() {
    return [
      { id: 'def_winner', name: 'Анонс переможця', icon: '🏆', description: 'IG+TG+FB о 20:00',
        preset_data: { platforms: ['ig', 'tg', 'fb'], time: '20:00', tone: 'playful', length: 'medium',
                       hashtags: ['#DreamCar', '#Переможець'], contentType: 'reel' } },
      { id: 'def_launch', name: 'Новий запуск авто', icon: '🚗', description: 'Анонс сезону',
        preset_data: { platforms: ['ig', 'tg', 'fb', 'tt'], time: '12:00', tone: 'salesy', length: 'long',
                       hashtags: ['#DreamCar', '#НовийСезон'], contentType: 'carousel' } },
      { id: 'def_expert', name: 'Експертний пост про AI', icon: '🤖', description: 'TG + Threads',
        preset_data: { platforms: ['tg', 'th'], time: '14:00', tone: 'expert', length: 'long',
                       hashtags: ['#AI', '#DreamCar'], contentType: 'post' } },
      { id: 'def_ugc', name: 'Сторіз — UGC', icon: '📸', description: 'IG Stories',
        preset_data: { platforms: ['ig'], time: '18:00', tone: 'casual', length: 'short',
                       hashtags: ['#DreamCarUGC'], contentType: 'story' } },
    ];
  }

  async function deleteTemplate(id) {
    if (!window.HQ_BACKEND || !window.supabase) return false;
    if (String(id).startsWith('def_')) return false;
    var resp = await window.supabase.from('pub_templates').delete().eq('id', id);
    return !resp.error;
  }

  function applyTemplate(t) {
    var preset = t.preset_data || {};

    if (Array.isArray(preset.platforms)) {
      preset.platforms.forEach(function (plat) {
        var chip = document.querySelector('.field [data-plat="' + plat + '"], .chip[data-plat="' + plat + '"]');
        if (chip && !chip.classList.contains('on')) chip.click();
      });
    }

    if (preset.time) {
      var timeInput = document.getElementById('f_time') ||
        document.querySelector('input[type="time"]');
      if (timeInput) {
        timeInput.value = preset.time;
        timeInput.dispatchEvent(new Event('input', { bubbles: true }));
        timeInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    if (preset.contentType) {
      var ctSel = document.getElementById('f_contentType') ||
        document.querySelector('select[name="contentType"]');
      if (ctSel) {
        ctSel.value = preset.contentType;
        ctSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    if (preset.rubric) {
      var rubricSel = document.getElementById('f_rubric') ||
        document.querySelector('select[name="rubric"]');
      if (rubricSel) {
        rubricSel.value = preset.rubric;
        rubricSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    if (Array.isArray(preset.hashtags) && preset.hashtags.length) {
      var tagsInput = document.getElementById('f_hashtags');
      if (tagsInput) {
        var existing = tagsInput.value ? tagsInput.value.split(',').map(function (s) { return s.trim(); }) : [];
        preset.hashtags.forEach(function (h) {
          var clean = String(h || '').replace(/^#/, '');
          if (clean && existing.indexOf(clean) < 0) existing.push(clean);
        });
        tagsInput.value = existing.filter(Boolean).join(', ');
        tagsInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    if (typeof toast === 'function') toast('Шаблон застосовано', 'success', t.name);
  }

  async function showPickerModal() {
    if (document.querySelector('.hq-tpl-modal')) return;
    var sc = document.createElement('div');
    sc.className = 'hq-tpl-modal';
    sc.innerHTML =
      '<div class="hq-tpl-card">' +
        '<h2>📋 Обери шаблон публікації</h2>' +
        '<div id="hq_tpl_list" style="min-height:120px;">Завантаження…</div>' +
        '<div class="hq-tpl-actions"><button class="btn" id="hq_tpl_close">Закрити</button></div>' +
      '</div>';
    document.body.appendChild(sc);
    sc.querySelector('#hq_tpl_close').onclick = function () { sc.remove(); };
    sc.onclick = function (e) { if (e.target === sc) sc.remove(); };

    var templates = await loadTemplates();
    var listEl = sc.querySelector('#hq_tpl_list');
    if (!templates.length) {
      listEl.innerHTML = '<div class="hq-tpl-empty">Немає доступних шаблонів</div>';
      return;
    }
    listEl.innerHTML = '<div class="hq-tpl-grid">' +
      templates.map(function (t) {
        var plats = ((t.preset_data && t.preset_data.platforms) || []).map(function (p) {
          var names = { ig: 'IG', tg: 'TG', tt: 'TT', yt: 'YT', fb: 'FB', th: 'Th' };
          return names[p] || p;
        }).join(' · ');
        return '<div class="hq-tpl-item" data-id="' + escapeHtml(t.id) + '">' +
          '<span class="ico">' + (t.icon || '📋') + '</span>' +
          '<div class="name">' + escapeHtml(t.name) + '</div>' +
          (t.description ? '<div class="desc">' + escapeHtml(t.description) + '</div>' : '') +
          (plats ? '<div class="platforms">' + plats + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';

    listEl.querySelectorAll('.hq-tpl-item').forEach(function (el) {
      el.onclick = function () {
        var t = templates.find(function (x) { return String(x.id) === el.dataset.id; });
        if (t) { applyTemplate(t); sc.remove(); }
      };
    });
  }

  // #296: defensive button binding — unique ID, dual onclick+addEventListener,
  // re-injection if label was recreated, console.log for debug, body delegation fallback.
  function bindTplHandler(btn) {
    var handler = function (e) {
      console.log('[#296 hq-tpl-btn click]', e && e.type);
      if (e) { e.preventDefault(); e.stopPropagation(); }
      try { showPickerModal(); } catch (err) {
        console.error('[#296 showPickerModal err]', err);
        if (typeof toast === 'function') toast('Шаблони', 'error', String(err.message || err));
      }
    };
    btn.onclick = handler;
    btn.addEventListener('click', handler);
    btn.__hqTplBound = true;
  }

  function injectButton() {
    var titleField = document.getElementById('f_title');
    if (!titleField) return;
    var fieldEl = titleField.closest('.field');
    var label = fieldEl && fieldEl.querySelector('label');
    if (!label) return;
    // #296: якщо кнопка вже існує — переконуємось що handler не null (re-inject не потрібен)
    var existing = label.querySelector('#hq_tpl_btn');
    if (existing) {
      if (!existing.__hqTplBound) bindTplHandler(existing);
      return;
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hq_tpl_btn';
    btn.className = 'hq-tpl-btn';
    btn.innerHTML = '📋 З шаблону';
    btn.title = 'Заповнити поля із збереженого шаблону';
    bindTplHandler(btn);
    label.appendChild(btn);
  }

  var observer = new MutationObserver(function () {
    if (document.getElementById('f_title')) injectButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  [400, 1500, 3500].forEach(function (ms) { setTimeout(injectButton, ms); });

  // #296: ultimate fallback — body-level delegated click handler.
  // Catches click on .hq-tpl-btn або #hq_tpl_btn навіть якщо onclick десь обнулено.
  if (!window.__hqTplDelegated) {
    window.__hqTplDelegated = true;
    document.body.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('#hq_tpl_btn, .hq-tpl-btn');
      if (!btn) return;
      // якщо native onclick відпрацював — не дублюємо
      if (btn.__hqTplHandledAt && (Date.now() - btn.__hqTplHandledAt) < 500) return;
      btn.__hqTplHandledAt = Date.now();
      console.log('[#296 hq-tpl-btn delegated click]');
      e.preventDefault();
      e.stopPropagation();
      try { showPickerModal(); } catch (err) { console.error(err); }
    }, false);
  }

  async function enhanceSettingsTemplates() {
    if (!isLead()) return;
    if (document.querySelector('.hq-tpl-section')) return;
    var anchor = document.getElementById('main');
    if (!anchor) return;
    if ((location.hash || '').slice(1).split('/')[0] !== 'settings') return;

    var block = document.createElement('div');
    block.className = 'hq-tpl-section';
    block.innerHTML =
      '<div class="hts-title">📋 Шаблони публікацій</div>' +
      '<div class="hts-desc">Збережені пресети полів картки. Натискаєш «З шаблону» у новій публікації — і 80% полів заповнюється автоматично.</div>' +
      '<div class="hq-tpl-list" id="hq_tpl_settings_list">Завантаження…</div>';
    anchor.appendChild(block);

    var list = await loadTemplates();
    var listEl = block.querySelector('#hq_tpl_settings_list');
    if (!list.length) {
      listEl.innerHTML = '<div style="font-size:11px;color:var(--grey-2)">Немає шаблонів</div>';
      return;
    }
    listEl.innerHTML = list.map(function (t) {
      var plats = ((t.preset_data && t.preset_data.platforms) || []).join(' · ');
      var canDelete = !String(t.id).startsWith('def_');
      return '<div class="hq-tpl-row" data-id="' + escapeHtml(t.id) + '">' +
        '<div class="info">' +
          '<span style="font-size:18px;">' + (t.icon || '📋') + '</span>' +
          '<span><b>' + escapeHtml(t.name) + '</b>' +
          (plats ? '<span class="meta">' + plats + '</span>' : '') + '</span>' +
        '</div>' +
        (canDelete ? '<button data-del="' + escapeHtml(t.id) + '">Видалити</button>' : '<span style="font-size:10px;color:var(--grey-2)">default</span>') +
        '</div>';
    }).join('');
    listEl.querySelectorAll('button[data-del]').forEach(function (b) {
      b.onclick = async function () {
        if (!confirm('Видалити цей шаблон?')) return;
        var ok = await deleteTemplate(b.dataset.del);
        if (ok) {
          if (typeof toast === 'function') toast('Шаблон видалено', 'success');
          enhanceSettingsTemplates();
        }
      };
    });
  }
  window.enhanceSettingsTemplates = enhanceSettingsTemplates;

  function maybeRunSettings() {
    if ((location.hash || '').slice(1).split('/')[0] !== 'settings') return;
    [400, 1200, 2500].forEach(function (ms) { setTimeout(enhanceSettingsTemplates, ms); });
  }
  window.addEventListener('hashchange', maybeRunSettings);
  maybeRunSettings();

  console.log('%cDreamCar HQ Templates %c· Pub templates ready', 'color:#93c5fd;font-weight:700;', 'color:#888;');
})();
