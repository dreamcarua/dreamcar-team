/* ============================================================
   DreamCar HQ — ✅ Чек-лист (базовий шаблон + інстанси на проєкт)
   Запит Олександра (SMM), 10.08.2026.
   ------------------------------------------------------------
   Дві зони на одній сторінці:
     • «Базовий шаблон» — незмінний майстер-список по секціях
       (додати / редагувати / видалити / drag&drop / вкл-викл).
     • «Чек-листи проєктів» — копії шаблону, привʼязані до циклу;
       у них ставляться галочки (autosave), прогрес-бар, лічильник,
       «Скинути галочки».
   БД: checklist_template_items / checklist_projects /
       checklist_project_items (міграція 020).
   ============================================================ */
(function () {
  if (window.__hqChecklist) return;
  window.__hqChecklist = true;

  var state = {
    tab: 'template',        // 'template' | 'projects'
    openInstance: null,     // id інстансу, якщо відкритий
    tpl: [],                // checklist_template_items
    projects: [],           // checklist_projects
    items: [],              // checklist_project_items відкритого інстансу
    launches: [],
    loading: false, saving: false, dragId: null
  };

  function sb() { return window.supabase; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function say(m, k) { if (typeof toast === 'function') toast(m, k || 'success'); }
  function me() { return (typeof Store !== 'undefined' && Store.currentUser) ? Store.currentUser() : null; }
  function uid() { var u = me(); return u ? u.id : null; }

  // ---------------------------------------------------------------
  function injectCss() {
    if (document.getElementById('hq-cl-css')) return;
    var st = document.createElement('style'); st.id = 'hq-cl-css';
    st.textContent = [
      '.cl-wrap{padding:0 26px 46px;}',
      '.cl-tabs{display:flex;gap:8px;margin:4px 0 18px;flex-wrap:wrap;}',
      '.cl-tabs button{background:var(--bg-3);border:1px solid var(--border);color:var(--grey);border-radius:9px;padding:8px 16px;font-size:13px;cursor:pointer;font-weight:600;}',
      '.cl-tabs button.on{background:var(--red-dim);border-color:rgba(204,0,0,.4);color:#fff;}',
      '.cl-add{display:flex;gap:8px;align-items:flex-start;background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:16px;flex-wrap:wrap;}',
      '.cl-add input,.cl-add textarea,.cl-add select{background:var(--bg-3);border:1px solid var(--border);color:#fff;border-radius:8px;padding:9px 11px;font-size:13px;font-family:inherit;}',
      '.cl-add input.sec{width:150px;} .cl-add input.ttl{flex:1;min-width:200px;} .cl-add textarea{flex:1;min-width:200px;min-height:40px;resize:vertical;}',
      '.cl-add button{background:var(--red);color:#fff;border:1px solid var(--red);border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;}',
      '.cl-add button:disabled{opacity:.5;}',
      '.cl-sec{margin:18px 0 8px;font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:var(--grey-2);font-weight:700;}',
      '.cl-row{display:flex;gap:12px;align-items:flex-start;background:var(--bg-2);border:1px solid var(--border);border-left:3px solid var(--grey-2);border-radius:11px;padding:12px 14px;margin-bottom:8px;}',
      '.cl-row.done{opacity:.55;border-left-color:var(--green);background:linear-gradient(90deg,var(--green-dim),transparent 55%),var(--bg-2);}',
      '.cl-row.off{opacity:.4;}',
      '.cl-grip{cursor:grab;color:var(--grey-2);font-size:15px;padding-top:2px;user-select:none;}',
      '.cl-cb{width:20px;height:20px;flex:none;margin-top:1px;cursor:pointer;accent-color:var(--green,#33c46a);}',
      '.cl-main{flex:1;min-width:0;}',
      '.cl-ttl{font-size:14.5px;line-height:1.45;color:#e8e8f0;white-space:pre-wrap;word-break:break-word;}',
      '.cl-row.done .cl-ttl{text-decoration:line-through;text-decoration-color:var(--grey-2);}',
      '.cl-desc{margin-top:4px;font-size:12.5px;color:var(--grey);white-space:pre-wrap;}',
      '.cl-meta{margin-top:6px;font-size:11.5px;color:var(--grey-2);display:flex;gap:10px;flex-wrap:wrap;align-items:center;}',
      '.cl-status{color:var(--green);font-weight:600;}',
      '.cl-ico{background:none;border:none;color:var(--grey-2);cursor:pointer;font-size:13.5px;padding:2px 4px;}',
      '.cl-ico:hover{color:var(--red-soft);}',
      '.cl-prog{background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:16px;}',
      '.cl-prog-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;font-size:13px;color:var(--grey);flex-wrap:wrap;gap:8px;}',
      '.cl-prog-bar{height:9px;background:var(--bg-3);border-radius:6px;overflow:hidden;}',
      '.cl-prog-fill{height:100%;background:linear-gradient(90deg,#2fa85a,#57d98a);transition:width .3s;}',
      '.cl-pcard{background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:12px;}',
      '.cl-pcard:hover{border-color:rgba(204,0,0,.4);}',
      '.cl-pcard .nm{font-size:14.5px;color:#e8e8f0;font-weight:600;}',
      '.cl-pcard .mini{height:7px;width:130px;background:var(--bg-3);border-radius:5px;overflow:hidden;margin-top:8px;}',
      '.cl-pcard .mini > i{display:block;height:100%;background:linear-gradient(90deg,#2fa85a,#57d98a);}',
      '.cl-empty{text-align:center;padding:46px 20px;color:var(--grey-2);font-size:14px;}',
      '.cl-back{background:none;border:1px solid var(--border);color:var(--grey);border-radius:8px;padding:6px 12px;font-size:12.5px;cursor:pointer;margin-bottom:14px;}',
      '@media(max-width:760px){.cl-wrap{padding:0 14px 30px;}.cl-add input.sec,.cl-add input.ttl{width:100%;}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------
  // Дані
  // ---------------------------------------------------------------
  async function loadTemplate() {
    var r = await sb().from('checklist_template_items')
      .select('id,section,title,description,sort_order,is_active')
      .is('deleted_at', null).order('sort_order');
    if (r.error) throw r.error; state.tpl = r.data || [];
  }
  async function loadProjects() {
    var r = await sb().from('checklist_projects')
      .select('id,name,launch_id,archived,created_at')
      .is('deleted_at', null).eq('archived', false).order('created_at', { ascending: false });
    if (r.error) throw r.error; state.projects = r.data || [];
    // рахуємо прогрес по кожному
    var ids = state.projects.map(function (p) { return p.id; });
    state._counts = {};
    if (ids.length) {
      var ci = await sb().from('checklist_project_items').select('project_id,done').in('project_id', ids);
      (ci.data || []).forEach(function (x) {
        var c = state._counts[x.project_id] || { t: 0, d: 0 };
        c.t++; if (x.done) c.d++; state._counts[x.project_id] = c;
      });
    }
  }
  async function loadInstance(pid) {
    var r = await sb().from('checklist_project_items')
      .select('id,section,title,description,sort_order,done,done_at')
      .eq('project_id', pid).order('sort_order');
    if (r.error) throw r.error; state.items = r.data || [];
  }
  async function loadLaunches() {
    var r = await sb().from('launches').select('id,name,code,status,is_active').order('created_at', { ascending: false });
    state.launches = (r.data || []).filter(function (l) { return l.is_active !== false; });
  }

  // ---------------------------------------------------------------
  // Рендер: базовий шаблон
  // ---------------------------------------------------------------
  function groupBySection(rows) {
    var g = {}, order = [];
    rows.forEach(function (r) { var s = r.section || 'Загальне'; if (!g[s]) { g[s] = []; order.push(s); } g[s].push(r); });
    return order.map(function (s) { return { section: s, rows: g[s] }; });
  }

  function tplRow(it) {
    return '<div class="cl-row' + (it.is_active ? '' : ' off') + '" draggable="true" data-tpl="' + it.id + '">' +
      '<span class="cl-grip" title="Перетягни">⠿</span>' +
      '<div class="cl-main">' +
        '<div class="cl-ttl">' + esc(it.title) + '</div>' +
        (it.description ? '<div class="cl-desc">' + esc(it.description) + '</div>' : '') +
        '<div class="cl-meta">' +
          '<button type="button" class="cl-ico" title="Редагувати" onclick="clTplEdit(\'' + it.id + '\')">✏️</button>' +
          '<button type="button" class="cl-ico" title="' + (it.is_active ? 'Вимкнути (не потрапляє в нові чек-листи)' : 'Увімкнути') + '" onclick="clTplToggleActive(\'' + it.id + '\')">' + (it.is_active ? '👁' : '🚫') + '</button>' +
          '<button type="button" class="cl-ico" title="Видалити" onclick="clTplDelete(\'' + it.id + '\')">🗑</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderTemplate(host) {
    var groups = groupBySection(state.tpl);
    var body = groups.length ? groups.map(function (g) {
      return '<div class="cl-sec">' + esc(g.section) + '</div>' + g.rows.map(tplRow).join('');
    }).join('') : '<div class="cl-empty">Шаблон порожній. Додай перший пункт вище.</div>';

    host.innerHTML =
      '<div class="cl-add">' +
        '<input class="sec" id="clTplSec" placeholder="Секція (етап)" maxlength="120" list="clSecList">' +
        '<datalist id="clSecList">' + [...new Set(state.tpl.map(function (t) { return t.section; }))].map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
        '<input class="ttl" id="clTplTtl" placeholder="Назва пункту" maxlength="500">' +
        '<button type="button" onclick="clTplAdd()">+ Додати пункт</button>' +
      '</div>' + body;
    bindDrag(host, 'tpl');
  }

  // ---------------------------------------------------------------
  // Рендер: список інстансів
  // ---------------------------------------------------------------
  function renderProjects(host) {
    var cards = state.projects.map(function (p) {
      var c = (state._counts && state._counts[p.id]) || { t: 0, d: 0 };
      var pct = c.t ? Math.round(c.d / c.t * 100) : 0;
      var ln = state.launches.find(function (l) { return l.id === p.launch_id; });
      return '<div class="cl-pcard" onclick="clOpenInstance(\'' + p.id + '\')">' +
        '<div><div class="nm">' + esc(p.name) + (ln ? ' <span style="color:var(--grey-2);font-weight:400">· ' + esc(ln.code || ln.name) + '</span>' : '') + '</div>' +
          '<div class="mini"><i style="width:' + pct + '%"></i></div></div>' +
        '<div style="text-align:right;white-space:nowrap"><div style="color:var(--green);font-weight:700">' + c.d + '/' + c.t + '</div>' +
          '<button type="button" class="cl-ico" title="Видалити чек-лист" onclick="event.stopPropagation();clInstDelete(\'' + p.id + '\')">🗑</button></div>' +
      '</div>';
    }).join('');
    host.innerHTML =
      '<div class="cl-add">' +
        '<select id="clNewLaunch"><option value="">— без привʼязки —</option>' +
          state.launches.map(function (l) { return '<option value="' + l.id + '">' + esc(l.name || l.code) + '</option>'; }).join('') +
        '</select>' +
        '<input class="ttl" id="clNewName" placeholder="Назва чек-листа (необовʼязково)" maxlength="200">' +
        '<button type="button" onclick="clCreateInstance()">+ Створити чек-лист для проєкту</button>' +
      '</div>' +
      (state.projects.length ? cards : '<div class="cl-empty">Ще немає жодного чек-листа проєкту. Створи перший — кнопка вище копіює базовий шаблон.</div>');
  }

  // ---------------------------------------------------------------
  // Рендер: відкритий інстанс
  // ---------------------------------------------------------------
  function instRow(it) {
    return '<div class="cl-row' + (it.done ? ' done' : '') + '" draggable="true" data-item="' + it.id + '">' +
      '<span class="cl-grip" title="Перетягни">⠿</span>' +
      '<input type="checkbox" class="cl-cb" ' + (it.done ? 'checked' : '') + ' onchange="clItemToggle(\'' + it.id + '\',this.checked)">' +
      '<div class="cl-main">' +
        '<div class="cl-ttl">' + esc(it.title) + '</div>' +
        (it.description ? '<div class="cl-desc">' + esc(it.description) + '</div>' : '') +
        '<div class="cl-meta">' +
          (it.done ? '<span class="cl-status">✓ Виконано</span>' : '') +
          '<button type="button" class="cl-ico" title="Редагувати" onclick="clItemEdit(\'' + it.id + '\')">✏️</button>' +
          '<button type="button" class="cl-ico" title="Видалити" onclick="clItemDelete(\'' + it.id + '\')">🗑</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function renderInstance(host) {
    var p = state.projects.find(function (x) { return x.id === state.openInstance; });
    var total = state.items.length, done = state.items.filter(function (i) { return i.done; }).length;
    var pct = total ? Math.round(done / total * 100) : 0;
    var groups = groupBySection(state.items);
    var body = groups.map(function (g) {
      return '<div class="cl-sec">' + esc(g.section) + '</div>' + g.rows.map(instRow).join('');
    }).join('');
    host.innerHTML =
      '<button type="button" class="cl-back" onclick="clBackToProjects()">← До списку чек-листів</button>' +
      '<div class="cl-prog">' +
        '<div class="cl-prog-top"><b style="color:#e8e8f0">' + esc(p ? p.name : 'Чек-лист') + '</b>' +
          '<span>' + done + ' з ' + total + ' виконано · ' + pct + '%' +
          ' <button type="button" class="cl-ico" title="Скинути всі галочки" onclick="clResetInstance()">↺ Скинути</button></span></div>' +
        '<div class="cl-prog-bar"><div class="cl-prog-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<div class="cl-add">' +
        '<input class="sec" id="clItSec" placeholder="Секція" maxlength="120" list="clItSecList">' +
        '<datalist id="clItSecList">' + [...new Set(state.items.map(function (t) { return t.section; }))].map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
        '<input class="ttl" id="clItTtl" placeholder="Новий пункт" maxlength="500">' +
        '<button type="button" onclick="clItemAdd()">+ Додати</button>' +
      '</div>' +
      (total ? body : '<div class="cl-empty">У цьому чек-листі порожньо.</div>');
    bindDrag(host, 'item');
  }

  // ---------------------------------------------------------------
  // Головний рендер
  // ---------------------------------------------------------------
  function paint() {
    var host = document.getElementById('clBody');
    if (!host) return;
    if (state.openInstance) { renderInstance(host); return; }
    if (state.tab === 'template') renderTemplate(host); else renderProjects(host);
  }

  async function renderChecklist(root) {
    injectCss();
    root.innerHTML =
      '<div class="view-header"><h1>✅ Чек-лист</h1><span class="view-meta" id="clMeta">· завантаження…</span></div>' +
      '<div class="cl-wrap">' +
        '<div class="cl-tabs" id="clTabs">' +
          '<button data-t="template" class="' + (state.tab === 'template' && !state.openInstance ? 'on' : '') + '">📋 Базовий шаблон</button>' +
          '<button data-t="projects" class="' + (state.tab === 'projects' || state.openInstance ? 'on' : '') + '">🚗 Чек-листи проєктів</button>' +
        '</div>' +
        '<div id="clBody"><div class="cl-empty">Завантаження…</div></div>' +
      '</div>';
    document.getElementById('clTabs').onclick = function (e) {
      var b = e.target.closest('button[data-t]'); if (!b) return;
      state.tab = b.dataset.t; state.openInstance = null;
      document.querySelectorAll('#clTabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      paint();
    };
    try {
      state.loading = true;
      await Promise.all([loadTemplate(), loadLaunches()]);
      await loadProjects();
      var m = document.getElementById('clMeta'); if (m) m.textContent = '· ' + state.tpl.length + ' у шаблоні · ' + state.projects.length + ' проєктів';
      paint();
    } catch (e) {
      console.error('[hq-checklist] load', e);
      document.getElementById('clBody').innerHTML = '<div class="cl-empty">Не вдалось завантажити: ' + esc(e.message || e) + '</div>';
    } finally { state.loading = false; }
  }

  // ---------------------------------------------------------------
  // drag & drop reorder (по секції; персист sort_order)
  // ---------------------------------------------------------------
  function bindDrag(host, kind) {
    host.querySelectorAll('[data-' + kind + ']').forEach(function (row) {
      row.addEventListener('dragstart', function () { state.dragId = row.getAttribute('data-' + kind); row.style.opacity = '.4'; });
      row.addEventListener('dragend', function () { row.style.opacity = ''; });
      row.addEventListener('dragover', function (e) { e.preventDefault(); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        var from = state.dragId, to = row.getAttribute('data-' + kind);
        if (!from || from === to) return;
        reorder(kind, from, to);
      });
    });
  }
  async function reorder(kind, fromId, toId) {
    var arr = kind === 'tpl' ? state.tpl : state.items;
    var fi = arr.findIndex(function (x) { return x.id === fromId; });
    var ti = arr.findIndex(function (x) { return x.id === toId; });
    if (fi < 0 || ti < 0) return;
    var moved = arr.splice(fi, 1)[0];
    // при переносі — успадковуємо секцію цілі (дозволяє перетягувати між секціями)
    moved.section = arr[ti > fi ? ti - 1 : ti] ? arr[Math.min(ti, arr.length - 1)].section : moved.section;
    arr.splice(ti, 0, moved);
    arr.forEach(function (x, i) { x.sort_order = i * 10; });
    paint();
    var tbl = kind === 'tpl' ? 'checklist_template_items' : 'checklist_project_items';
    try {
      for (var i = 0; i < arr.length; i++) {
        await sb().from(tbl).update({ sort_order: arr[i].sort_order, section: arr[i].section }).eq('id', arr[i].id);
      }
    } catch (e) { console.error('[checklist] reorder', e); say('Порядок не зберігся: ' + (e.message || e), 'error'); }
  }

  // ---------------------------------------------------------------
  // Дії — ШАБЛОН
  // ---------------------------------------------------------------
  window.clTplAdd = async function () {
    var sec = (document.getElementById('clTplSec').value || '').trim() || 'Загальне';
    var ttl = (document.getElementById('clTplTtl').value || '').trim();
    if (!ttl) { say('Впиши назву пункту', 'error'); return; }
    var ord = (state.tpl.length ? Math.max.apply(null, state.tpl.map(function (t) { return t.sort_order; })) : 0) + 10;
    try {
      var r = await sb().from('checklist_template_items').insert({ section: sec, title: ttl, sort_order: ord, created_by: uid() }).select().single();
      if (r.error) throw r.error;
      state.tpl.push(r.data); paint(); say('Пункт додано');
    } catch (e) { say('Не додалось: ' + (e.message || e), 'error'); }
  };
  window.clTplEdit = async function (id) {
    var it = state.tpl.find(function (x) { return x.id === id; }); if (!it) return;
    var ttl = prompt('Назва пункту:', it.title); if (ttl == null) return;
    var desc = prompt('Опис (необовʼязково):', it.description || '');
    try {
      var r = await sb().from('checklist_template_items').update({ title: ttl.trim(), description: (desc || '').trim() || null, updated_at: new Date().toISOString() }).eq('id', id).select().single();
      if (r.error) throw r.error;
      Object.assign(it, r.data); paint(); say('Збережено');
    } catch (e) { say('Не збереглось: ' + (e.message || e), 'error'); }
  };
  window.clTplToggleActive = async function (id) {
    var it = state.tpl.find(function (x) { return x.id === id; }); if (!it) return;
    try {
      var r = await sb().from('checklist_template_items').update({ is_active: !it.is_active }).eq('id', id).select().single();
      if (r.error) throw r.error; it.is_active = r.data.is_active; paint();
    } catch (e) { say('Помилка: ' + (e.message || e), 'error'); }
  };
  window.clTplDelete = async function (id) {
    var it = state.tpl.find(function (x) { return x.id === id; }); if (!it) return;
    if (!confirm('Видалити пункт «' + it.title.slice(0, 80) + '» з базового шаблону?')) return;
    try {
      var r = await sb().from('checklist_template_items').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (r.error) throw r.error;
      state.tpl = state.tpl.filter(function (x) { return x.id !== id; }); paint(); say('Видалено');
    } catch (e) { say('Не вдалось: ' + (e.message || e), 'error'); }
  };

  // ---------------------------------------------------------------
  // Дії — ІНСТАНСИ
  // ---------------------------------------------------------------
  window.clCreateInstance = async function () {
    if (state.saving) return; state.saving = true;
    var launch = document.getElementById('clNewLaunch').value || null;
    var nm = (document.getElementById('clNewName').value || '').trim() || null;
    try {
      var r = await sb().rpc('checklist_create_from_template', { p_launch: launch, p_name: nm });
      if (r.error) throw r.error;
      say('Чек-лист створено з шаблону'); await loadProjects();
      state.openInstance = r.data; await loadInstance(r.data); paint();
    } catch (e) { say('Не створилось: ' + (e.message || e), 'error'); }
    finally { state.saving = false; }
  };
  window.clOpenInstance = async function (pid) {
    try { state.openInstance = pid; await loadInstance(pid); paint(); }
    catch (e) { say('Не відкрилось: ' + (e.message || e), 'error'); }
  };
  window.clBackToProjects = async function () {
    state.openInstance = null; state.tab = 'projects';
    await loadProjects(); paint();
  };
  window.clInstDelete = async function (pid) {
    var p = state.projects.find(function (x) { return x.id === pid; }); if (!p) return;
    if (!confirm('Видалити чек-лист «' + p.name + '»? Пункти всередині теж зникнуть.')) return;
    try {
      var r = await sb().from('checklist_projects').update({ deleted_at: new Date().toISOString() }).eq('id', pid);
      if (r.error) throw r.error;
      state.projects = state.projects.filter(function (x) { return x.id !== pid; }); paint(); say('Видалено');
    } catch (e) { say('Не вдалось: ' + (e.message || e), 'error'); }
  };
  window.clResetInstance = async function () {
    if (!state.openInstance) return;
    if (!confirm('Скинути всі галочки в цьому чек-листі?')) return;
    try {
      var r = await sb().from('checklist_project_items').update({ done: false, done_at: null, done_by: null }).eq('project_id', state.openInstance);
      if (r.error) throw r.error;
      state.items.forEach(function (i) { i.done = false; }); paint(); say('Галочки скинуто');
    } catch (e) { say('Не вдалось: ' + (e.message || e), 'error'); }
  };

  // ---------------------------------------------------------------
  // Дії — ПУНКТИ ІНСТАНСУ (autosave)
  // ---------------------------------------------------------------
  window.clItemToggle = async function (id, checked) {
    var it = state.items.find(function (x) { return x.id === id; }); if (!it) return;
    it.done = checked; paint();  // optimistic
    try {
      var r = await sb().from('checklist_project_items')
        .update({ done: checked, done_at: checked ? new Date().toISOString() : null, done_by: checked ? uid() : null }).eq('id', id);
      if (r.error) throw r.error;
    } catch (e) { it.done = !checked; paint(); say('Не збереглось: ' + (e.message || e), 'error'); }
  };
  window.clItemAdd = async function () {
    var sec = (document.getElementById('clItSec').value || '').trim() || 'Загальне';
    var ttl = (document.getElementById('clItTtl').value || '').trim();
    if (!ttl) { say('Впиши пункт', 'error'); return; }
    var ord = (state.items.length ? Math.max.apply(null, state.items.map(function (t) { return t.sort_order; })) : 0) + 10;
    try {
      var r = await sb().from('checklist_project_items').insert({ project_id: state.openInstance, section: sec, title: ttl, sort_order: ord }).select().single();
      if (r.error) throw r.error; state.items.push(r.data); paint(); say('Додано');
    } catch (e) { say('Не додалось: ' + (e.message || e), 'error'); }
  };
  window.clItemEdit = async function (id) {
    var it = state.items.find(function (x) { return x.id === id; }); if (!it) return;
    var ttl = prompt('Пункт:', it.title); if (ttl == null) return;
    var desc = prompt('Опис (необовʼязково):', it.description || '');
    try {
      var r = await sb().from('checklist_project_items').update({ title: ttl.trim(), description: (desc || '').trim() || null }).eq('id', id).select().single();
      if (r.error) throw r.error; Object.assign(it, r.data); paint(); say('Збережено');
    } catch (e) { say('Не збереглось: ' + (e.message || e), 'error'); }
  };
  window.clItemDelete = async function (id) {
    var it = state.items.find(function (x) { return x.id === id; }); if (!it) return;
    if (!confirm('Видалити пункт «' + it.title.slice(0, 80) + '»?')) return;
    try {
      var r = await sb().from('checklist_project_items').delete().eq('id', id);
      if (r.error) throw r.error; state.items = state.items.filter(function (x) { return x.id !== id; }); paint(); say('Видалено');
    } catch (e) { say('Не вдалось: ' + (e.message || e), 'error'); }
  };

  window.renderChecklist = renderChecklist;
  if (window.DEBUG) console.log('%cDreamCar HQ %c· Чек-лист завантажено', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
})();
