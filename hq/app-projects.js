/* ============================================================
   DreamCar Проєкти — Phase 1 (05.06.2026)
   ============================================================
   Нова системна сутність. Route /hq/#projects.
   Поки що живе у /hq/ (тимчасово), пізніше винесемо у /projects/.

   Що робить:
   - List/Kanban view всіх проектів
   - Detail view: KPI, бюджет, публікації, задачі, нотатки
   - CRUD проєкту (CEO/COO)
   - Cross-link: фільтр у SMM публікацій та Tasks за project_id

   Storage: public.projects (VIEW на launches) + extended fields.
============================================================ */

(function () {
  if (window.__projectsLoaded) return;
  window.__projectsLoaded = true;

  // ============================================================
  // CSS — додаємо одноразово
  // ============================================================
  (function injectCss() {
    if (document.getElementById('dc-projects-css')) return;
    var s = document.createElement('style');
    s.id = 'dc-projects-css';
    s.textContent = [
      '.dcp-view{padding:24px 28px;color:#ddd;max-width:1400px;margin:0 auto;}',
      '.dcp-view h1{font-family:Oswald,sans-serif;font-size:26px;color:#fff;letter-spacing:.02em;margin-bottom:6px;}',
      '.dcp-view .dcp-sub{color:#888;font-size:13px;margin-bottom:22px;}',
      '.dcp-toolbar{display:flex;gap:10px;align-items:center;margin-bottom:18px;flex-wrap:wrap;}',
      '.dcp-toolbar .dcp-btn{padding:8px 14px;font-size:12px;background:#141414;color:#ddd;border:1px solid #2a2a2a;border-radius:6px;cursor:pointer;font-family:JetBrains Mono,monospace;letter-spacing:.05em;text-transform:uppercase;}',
      '.dcp-toolbar .dcp-btn:hover{border-color:#E30613;color:#fff;}',
      '.dcp-toolbar .dcp-btn.primary{background:#E30613;border-color:#E30613;color:#fff;}',
      '.dcp-toolbar .dcp-btn.primary:hover{background:#ff1a1a;}',
      '.dcp-toolbar .dcp-tab{padding:8px 14px;font-size:12px;background:transparent;color:#888;border:1px solid #2a2a2a;border-radius:6px;cursor:pointer;font-family:JetBrains Mono,monospace;letter-spacing:.05em;text-transform:uppercase;}',
      '.dcp-toolbar .dcp-tab.active{background:#E30613;color:#fff;border-color:#E30613;}',
      '.dcp-kanban{display:grid;grid-template-columns:repeat(6,1fr);gap:14px;}',
      '@media(max-width:1200px){.dcp-kanban{grid-template-columns:repeat(3,1fr);}}',
      '@media(max-width:760px){.dcp-kanban{grid-template-columns:1fr;}}',
      '.dcp-col{background:#0a0a0a;border:1px solid #1a1a1a;border-radius:12px;padding:12px;min-height:200px;}',
      '.dcp-col h3{font-family:Oswald,sans-serif;font-size:13px;color:#fff;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #2a2a2a;display:flex;justify-content:space-between;align-items:center;}',
      '.dcp-col h3 .dcp-cnt{color:#888;font-size:11px;font-weight:400;}',
      '.dcp-card{background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:14px;margin-bottom:10px;cursor:pointer;transition:border-color .15s,transform .1s;}',
      '.dcp-card:hover{border-color:#E30613;transform:translateY(-1px);}',
      '.dcp-card .dcp-card-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;}',
      '.dcp-card .dcp-card-code{font-family:JetBrains Mono,monospace;font-size:10px;color:#888;letter-spacing:.1em;}',
      '.dcp-card .dcp-card-color{width:10px;height:10px;border-radius:50%;flex-shrink:0;}',
      '.dcp-card h4{font-size:15px;color:#fff;font-weight:700;margin-bottom:6px;line-height:1.3;}',
      '.dcp-card .dcp-card-meta{font-size:11px;color:#888;display:flex;gap:12px;flex-wrap:wrap;}',
      '.dcp-card .dcp-card-meta b{color:#bbb;}',
      '.dcp-list{display:flex;flex-direction:column;gap:8px;}',
      '.dcp-list .dcp-row{background:#141414;border:1px solid #2a2a2a;border-radius:8px;padding:14px 18px;display:grid;grid-template-columns:60px 100px 1fr 140px 140px 100px;gap:14px;align-items:center;cursor:pointer;transition:border-color .15s;}',
      '.dcp-list .dcp-row:hover{border-color:#E30613;}',
      '.dcp-list .dcp-row .dcp-row-code{font-family:JetBrains Mono,monospace;font-size:11px;color:#888;letter-spacing:.1em;}',
      '.dcp-list .dcp-row .dcp-row-status{font-size:10px;padding:3px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:.1em;text-align:center;font-weight:700;}',
      '.dcp-list .dcp-row .dcp-row-title{color:#fff;font-weight:700;font-size:14px;}',
      '.dcp-list .dcp-row .dcp-row-meta{font-size:11px;color:#888;}',
      '@media(max-width:900px){.dcp-list .dcp-row{grid-template-columns:1fr;gap:6px;}.dcp-row > *{font-size:13px;}}',
      // Status colors
      '.dcp-status-idea{background:#3a3a3a;color:#ccc;}',
      '.dcp-status-planning{background:rgba(245,158,11,.15);color:#FBBF24;}',
      '.dcp-status-active{background:rgba(227,6,19,.15);color:#FF6A7A;}',
      '.dcp-status-measure{background:rgba(74,222,128,.15);color:#10B981;}',
      '.dcp-status-completed{background:rgba(99,102,241,.15);color:#a5b4fc;}',
      '.dcp-status-archived{background:#1a1a1a;color:#666;}',
      // Detail
      '.dcp-detail{padding:24px 28px;max-width:1100px;margin:0 auto;color:#ddd;}',
      '.dcp-detail .dcp-detail-head{display:flex;justify-content:space-between;align-items:start;gap:16px;margin-bottom:20px;}',
      '.dcp-detail h1{font-family:Oswald,sans-serif;font-size:30px;color:#fff;letter-spacing:.02em;margin-bottom:6px;}',
      '.dcp-detail .dcp-detail-meta{color:#888;font-size:13px;display:flex;gap:14px;flex-wrap:wrap;margin-bottom:18px;}',
      '.dcp-detail .dcp-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;}',
      '@media(max-width:760px){.dcp-detail .dcp-grid{grid-template-columns:1fr;}}',
      '.dcp-detail .dcp-card-box{background:#141414;border:1px solid #2a2a2a;border-radius:10px;padding:18px 22px;}',
      '.dcp-detail .dcp-card-box h3{font-family:Oswald,sans-serif;font-size:13px;color:#888;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px;}',
      '.dcp-detail .dcp-card-box .dcp-big{font-size:24px;color:#fff;font-weight:800;}',
      '.dcp-detail .dcp-card-box .dcp-sub-info{font-size:12px;color:#888;margin-top:4px;}',
      '.dcp-link-btn{display:inline-block;background:#1a1a1a;color:#FF6A7A;border:1px solid #2a2a2a;border-radius:6px;padding:6px 12px;font-size:12px;text-decoration:none;margin-right:8px;margin-bottom:6px;}',
      '.dcp-link-btn:hover{border-color:#E30613;background:#222;}',
    ].join('\n');
    document.head.appendChild(s);
  })();

  // ============================================================
  // Helpers
  // ============================================================
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmtDate(d) { if (!d) return '—'; var p = d.split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function statusLabel(s) {
    return ({
      idea: '💡 Ідея',
      planning: '📋 Підготовка',
      active: '🚀 Активний',
      measure: '📊 Вимірюємо',
      completed: '✅ Завершено',
      archived: '📦 Архів',
    })[s] || s;
  }
  var STATUSES = ['idea', 'planning', 'active', 'measure', 'completed', 'archived'];

  function getCurrentUser() {
    try { return (window.Store && Store.currentUser && Store.currentUser()) || null; } catch (_) { return null; }
  }
  function isAdmin() {
    var u = getCurrentUser();
    return u && ['ceo', 'coo'].includes((u.role || '').toLowerCase());
  }

  // ============================================================
  // Data loaders
  // ============================================================
  async function loadProjects() {
    var sb = window.supabase;
    if (!sb) return [];
    var res = await sb.from('projects').select('*').order('created_at', { ascending: false });
    if (res.error) { console.warn('[projects] load error:', res.error); return []; }
    return res.data || [];
  }

  async function loadProjectTasks(projectId) {
    var sb = window.supabase;
    if (!sb) return [];
    var res = await sb.from('team_tasks')
      .select('id,title,status,priority,assignee_id,due_date')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    return (res.data || []);
  }

  async function loadProjectPubs(projectId) {
    var sb = window.supabase;
    if (!sb) return [];
    var res = await sb.from('publications')
      .select('id,title,status,publish_at')
      .eq('launch_id', projectId)  // публікації використовують launch_id
      .is('deleted_at', null)
      .order('publish_at', { ascending: false })
      .limit(20);
    return (res.data || []);
  }

  // ============================================================
  // Views
  // ============================================================
  var state = { view: 'kanban', projects: [], currentDetailId: null };

  function renderList(root) {
    var html = ['<div class="dcp-list">'];
    if (state.projects.length === 0) html.push('<div style="padding:40px;text-align:center;color:#888;">Немає проєктів. Створи перший — кнопка зверху.</div>');
    state.projects.forEach(function (p) {
      var dateRange = (p.starts_on ? fmtDate(p.starts_on) : '?') + ' → ' + (p.ends_on ? fmtDate(p.ends_on) : '?');
      html.push(
        '<div class="dcp-row" data-id="' + esc(p.id) + '">' +
          '<div class="dcp-row-code">' + esc(p.code || '—') + '</div>' +
          '<div class="dcp-row-status dcp-status-' + esc(p.status) + '">' + esc(statusLabel(p.status)) + '</div>' +
          '<div class="dcp-row-title">' + esc(p.name) + '</div>' +
          '<div class="dcp-row-meta">📅 ' + dateRange + '</div>' +
          '<div class="dcp-row-meta">📝 ' + p.publications_count + ' пуб</div>' +
          '<div class="dcp-row-meta">' + (p.budget_plan ? '💰 ' + p.budget_plan : '—') + '</div>' +
        '</div>'
      );
    });
    html.push('</div>');
    root.innerHTML = html.join('');
    root.querySelectorAll('.dcp-row').forEach(function (el) {
      el.addEventListener('click', function () { location.hash = '#project/' + el.dataset.id; });
    });
  }

  function renderKanban(root) {
    var byStatus = {};
    STATUSES.forEach(function (s) { byStatus[s] = []; });
    state.projects.forEach(function (p) { (byStatus[p.status] || byStatus.active).push(p); });

    var html = ['<div class="dcp-kanban">'];
    STATUSES.forEach(function (s) {
      html.push('<div class="dcp-col">');
      html.push('<h3>' + esc(statusLabel(s)) + ' <span class="dcp-cnt">' + byStatus[s].length + '</span></h3>');
      byStatus[s].forEach(function (p) {
        var dateRange = (p.starts_on ? fmtDate(p.starts_on) : '?') + ' → ' + (p.ends_on ? fmtDate(p.ends_on) : '?');
        html.push(
          '<div class="dcp-card" data-id="' + esc(p.id) + '">' +
            '<div class="dcp-card-head">' +
              (p.color ? '<div class="dcp-card-color" style="background:' + esc(p.color) + ';"></div>' : '') +
              '<span class="dcp-card-code">' + esc(p.code || '—') + '</span>' +
            '</div>' +
            '<h4>' + esc(p.name) + '</h4>' +
            '<div class="dcp-card-meta">' +
              '<span>📅 ' + dateRange + '</span>' +
              '<span><b>' + p.publications_count + '</b> пуб</span>' +
            '</div>' +
          '</div>'
        );
      });
      if (byStatus[s].length === 0) html.push('<div style="color:#444;font-size:11px;text-align:center;padding:20px 0;">—</div>');
      html.push('</div>');
    });
    html.push('</div>');
    root.innerHTML = html.join('');
    root.querySelectorAll('.dcp-card').forEach(function (el) {
      el.addEventListener('click', function () { location.hash = '#project/' + el.dataset.id; });
    });
  }

  function renderToolbar(root) {
    var html = [];
    html.push('<div class="dcp-toolbar">');
    html.push('<button class="dcp-tab ' + (state.view === 'kanban' ? 'active' : '') + '" data-view="kanban">📋 Kanban</button>');
    html.push('<button class="dcp-tab ' + (state.view === 'list' ? 'active' : '') + '" data-view="list">📃 Список</button>');
    html.push('<div style="flex:1;"></div>');
    html.push('<span style="font-size:11px;color:#666;font-family:JetBrains Mono,monospace;letter-spacing:.1em;">' + state.projects.length + ' ПРОЄКТІВ</span>');
    if (isAdmin()) {
      html.push('<button class="dcp-btn primary" id="dcp-new-btn">+ НОВИЙ ПРОЄКТ</button>');
    }
    html.push('</div>');
    root.innerHTML = html.join('');
    root.querySelectorAll('.dcp-tab').forEach(function (el) {
      el.addEventListener('click', function () { state.view = el.dataset.view; renderListView(); });
    });
    var nb = document.getElementById('dcp-new-btn');
    if (nb) nb.addEventListener('click', openCreateModal);
  }

  function ensureRoot() {
    var existing = document.getElementById('dcpView');
    if (existing) return existing;
    var root = document.createElement('div');
    root.id = 'dcpView';
    root.style.cssText = 'min-height:60vh;background:var(--bg,#0a0a0a);';
    // Інжектимо у .main щоб замінити content area SMM, а не дублювати
    var mainContent = document.querySelector('.main') || document.querySelector('.app') || document.body;
    mainContent.appendChild(root);
    return root;
  }

  async function renderListView() {
    var root = ensureRoot();
    hideOtherHqViews();
    state.projects = await loadProjects();
    var html = ['<div class="dcp-view">'];
    html.push('<h1>📁 ПРОЄКТИ</h1>');
    html.push('<div class="dcp-sub">Запуски, проекти, кампанії. Усе що має життєвий цикл і ROI. URL поки <code>/hq/#projects</code>, у майбутньому винесемо у <code>/projects/</code>.</div>');
    html.push('<div id="dcp-toolbar"></div>');
    html.push('<div id="dcp-body"></div>');
    html.push('</div>');
    root.innerHTML = html.join('');
    renderToolbar(document.getElementById('dcp-toolbar'));
    if (state.view === 'kanban') renderKanban(document.getElementById('dcp-body'));
    else renderList(document.getElementById('dcp-body'));
  }

  async function renderDetail(projectId) {
    var root = ensureRoot();
    hideOtherHqViews();
    var sb = window.supabase;
    var pRes = await sb.from('projects').select('*').eq('id', projectId).maybeSingle();
    var p = pRes.data;
    if (!p) { root.innerHTML = '<div class="dcp-view"><h1>⚠ Не знайдено</h1><p><a href="#projects">← Назад до проєктів</a></p></div>'; return; }
    var tasks = await loadProjectTasks(projectId);
    var pubs = await loadProjectPubs(projectId);

    var html = [];
    html.push('<div class="dcp-detail">');
    html.push('<a href="#projects" class="dcp-link-btn">← Усі проєкти</a>');
    html.push('<div class="dcp-detail-head">');
    html.push('<div>');
    html.push('<h1>' + esc(p.name) + '</h1>');
    html.push('<div class="dcp-detail-meta">');
    html.push('<span><b style="color:#bbb;">Код:</b> ' + esc(p.code || '—') + '</span>');
    html.push('<span class="dcp-row-status dcp-status-' + esc(p.status) + '" style="padding:3px 10px;">' + esc(statusLabel(p.status)) + '</span>');
    if (p.starts_on || p.ends_on) html.push('<span>📅 ' + fmtDate(p.starts_on) + ' → ' + fmtDate(p.ends_on) + '</span>');
    html.push('</div>');
    html.push('</div>');
    if (isAdmin()) html.push('<button class="dcp-btn" id="dcp-edit-btn">✏ РЕДАГУВАТИ</button>');
    html.push('</div>');

    html.push('<div class="dcp-grid">');
    html.push('<div class="dcp-card-box"><h3>Бюджет (план)</h3><div class="dcp-big">' + (p.budget_plan ? esc(p.budget_plan) : '—') + '</div><div class="dcp-sub-info">Фактично: ' + esc(p.budget_actual || 0) + '</div></div>');
    html.push('<div class="dcp-card-box"><h3>Публікацій</h3><div class="dcp-big">' + p.publications_count + '</div><div class="dcp-sub-info">Усього у SMM</div></div>');
    html.push('</div>');

    if (p.description) {
      html.push('<div class="dcp-card-box"><h3>Опис</h3><div style="white-space:pre-wrap;color:#ccc;">' + esc(p.description) + '</div></div>');
      html.push('<div style="margin-top:14px;"></div>');
    }

    html.push('<div class="dcp-card-box"><h3>Задачі по проєкту (' + tasks.length + ')</h3>');
    if (tasks.length === 0) {
      html.push('<p style="color:#888;font-size:13px;">Немає задач. Створи задачу у Tasks і обери цей проєкт.</p>');
    } else {
      tasks.forEach(function (t) {
        html.push('<a href="https://team.dreamcar.ua/tasks/#task=' + esc(t.id) + '" class="dcp-link-btn" target="_blank">' + esc(t.title.slice(0, 50)) + ' <span style="opacity:.6">(' + esc(t.status) + ')</span></a>');
      });
    }
    html.push('</div>');
    html.push('<div style="margin-top:14px;"></div>');

    html.push('<div class="dcp-card-box"><h3>Публікації по проєкту (' + pubs.length + ')</h3>');
    if (pubs.length === 0) {
      html.push('<p style="color:#888;font-size:13px;">Немає публікацій по цьому проєкту.</p>');
    } else {
      pubs.forEach(function (pub) {
        html.push('<a href="#publication/' + esc(pub.id) + '" class="dcp-link-btn">' + esc(pub.title.slice(0, 50)) + ' <span style="opacity:.6">(' + esc(pub.status) + ')</span></a>');
      });
    }
    html.push('</div>');

    if (p.notes) {
      html.push('<div style="margin-top:14px;"></div>');
      html.push('<div class="dcp-card-box"><h3>Нотатки</h3><div style="white-space:pre-wrap;color:#ccc;">' + esc(p.notes) + '</div></div>');
    }

    html.push('</div>');
    root.innerHTML = html.join('');

    var editBtn = document.getElementById('dcp-edit-btn');
    if (editBtn) editBtn.addEventListener('click', function () { openEditModal(p); });
  }

  // ============================================================
  // Create / Edit modal — простий form
  // ============================================================
  function openCreateModal() { openProjectModal(null); }
  function openEditModal(p) { openProjectModal(p); }
  function openProjectModal(p) {
    var isEdit = !!p;
    var data = p || { name: '', code: '', status: 'active', description: '', color: '#E30613', starts_on: '', ends_on: '', budget_plan: '', notes: '' };
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML =
      '<div style="background:#141414;border:1px solid #2a2a2a;border-radius:14px;padding:26px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;">' +
        '<h2 style="color:#fff;margin-bottom:18px;font-family:Oswald,sans-serif;">' + (isEdit ? 'РЕДАГУВАТИ ПРОЄКТ' : 'НОВИЙ ПРОЄКТ') + '</h2>' +
        '<div style="display:flex;flex-direction:column;gap:12px;">' +
          inp('Назва *', 'name', data.name, 'text', true) +
          inp('Код (slug, NEMOTO)', 'code', data.code, 'text') +
          sel('Статус', 'status', data.status, STATUSES.map(function (s) { return { v: s, label: statusLabel(s) }; })) +
          ta('Опис', 'description', data.description) +
          inp('Старт', 'starts_on', data.starts_on, 'date') +
          inp('Кінець', 'ends_on', data.ends_on, 'date') +
          inp('Бюджет (план, грн)', 'budget_plan', data.budget_plan, 'number') +
          inp('Колір', 'color', data.color, 'color') +
          ta('Нотатки', 'notes', data.notes) +
        '</div>' +
        '<div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">' +
          '<button class="dcp-btn" id="dcp-cancel">Скасувати</button>' +
          '<button class="dcp-btn primary" id="dcp-save">' + (isEdit ? '💾 ЗБЕРЕГТИ' : '+ СТВОРИТИ') + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#dcp-cancel').onclick = function () { overlay.remove(); };
    overlay.querySelector('#dcp-save').onclick = async function () {
      var payload = {};
      ['name', 'code', 'status', 'description', 'starts_on', 'ends_on', 'budget_plan', 'color', 'notes'].forEach(function (k) {
        var el = overlay.querySelector('[name="' + k + '"]');
        if (el) payload[k] = el.value || null;
      });
      if (!payload.name) { alert('Введи назву'); return; }
      var sb = window.supabase;
      var res;
      if (isEdit) {
        res = await sb.from('launches').update(payload).eq('id', p.id);
      } else {
        // INSERT через launches (бо projects = VIEW)
        payload.desk_id = '11111111-1111-1111-1111-111111111111';
        payload.is_active = true;
        res = await sb.from('launches').insert(payload);
      }
      if (res.error) { alert('Помилка: ' + res.error.message); return; }
      overlay.remove();
      if (location.hash === '#projects') renderListView();
      else if (location.hash.indexOf('#project/') === 0) renderDetail(p.id);
    };

    function inp(label, name, val, type, req) {
      var t = type || 'text';
      var attrs = 'name="' + name + '" type="' + t + '"' + (req ? ' required' : '');
      var style = 'background:#0a0a0a;border:1px solid #2a2a2a;color:#fff;padding:9px 12px;border-radius:6px;font-size:13px;width:100%;font-family:inherit;' + (t === 'color' ? 'height:40px;' : '');
      return '<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#888;letter-spacing:.05em;text-transform:uppercase;">' + label + '<input ' + attrs + ' value="' + esc(val || '') + '" style="' + style + '"/></label>';
    }
    function ta(label, name, val) {
      return '<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#888;letter-spacing:.05em;text-transform:uppercase;">' + label + '<textarea name="' + name + '" rows="3" style="background:#0a0a0a;border:1px solid #2a2a2a;color:#fff;padding:9px 12px;border-radius:6px;font-size:13px;width:100%;font-family:inherit;resize:vertical;">' + esc(val || '') + '</textarea></label>';
    }
    function sel(label, name, val, opts) {
      var html = '<label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#888;letter-spacing:.05em;text-transform:uppercase;">' + label + '<select name="' + name + '" style="background:#0a0a0a;border:1px solid #2a2a2a;color:#fff;padding:9px 12px;border-radius:6px;font-size:13px;width:100%;font-family:inherit;">';
      opts.forEach(function (o) {
        html += '<option value="' + esc(o.v) + '"' + (o.v === val ? ' selected' : '') + '>' + esc(o.label || o.v) + '</option>';
      });
      html += '</select></label>';
      return html;
    }
  }

  // ============================================================
  // Hide existing HQ views коли на /hq/#projects
  // ============================================================
  // Приховуємо ВСІ children .main крім dcpView
  function hideOtherHqViews() {
    var main = document.querySelector('.main');
    if (!main) return;
    Array.prototype.forEach.call(main.children, function (el) {
      if (el.id === 'dcpView') return;
      if (!el.dataset.dcpHidden) {
        el.dataset.dcpHidden = el.style.display || 'block';
        el.style.display = 'none';
      }
    });
    // Також ховаємо banner онбордингу якщо є — він поза .main
    var banner = document.querySelector('.hq-onb-banner');
    if (banner && !banner.dataset.dcpHidden) {
      banner.dataset.dcpHidden = banner.style.display || 'flex';
      banner.style.display = 'none';
    }
  }
  function restoreOtherHqViews() {
    var main = document.querySelector('.main');
    if (main) {
      Array.prototype.forEach.call(main.children, function (el) {
        if (el.id === 'dcpView') return;
        if (el.dataset.dcpHidden) {
          el.style.display = el.dataset.dcpHidden === 'block' ? '' : el.dataset.dcpHidden;
          delete el.dataset.dcpHidden;
        }
      });
    }
    var banner = document.querySelector('.hq-onb-banner');
    if (banner && banner.dataset.dcpHidden) {
      banner.style.display = banner.dataset.dcpHidden;
      delete banner.dataset.dcpHidden;
    }
    var v = document.getElementById('dcpView');
    if (v) v.remove();
  }

  // ============================================================
  // Route handler
  // ============================================================
  function maybeRoute() {
    var h = location.hash || '';
    // 05.06.2026: Phase 2 — Проєкти винесено у /projects/. Redirect старих URL.
    if (h === '#projects' || h === '#launches') {
      window.location.replace('/projects/');
      return;
    }
    if (h.indexOf('#project/') === 0) {
      var id = h.substring('#project/'.length);
      window.location.replace('/projects/#project/' + id);
      return;
    }
    restoreOtherHqViews();
  }
  window.addEventListener('hashchange', maybeRoute);

  // ============================================================
  // 05.06.2026: injectNavChip ПРИБРАНО — після Phase 2 entry "Проєкти" вже у sidebar HTML (data-route=projects-ext)
  // Прибираємо існуючий chip якщо є у DOM (cleanup для старих сесій)
  function cleanupOldNavChip() {
    var old = document.getElementById('dcp-nav-link');
    if (old) old.remove();
  }

  // ============================================================
  // Init
  // ============================================================
  function init() {
    cleanupOldNavChip();
    maybeRoute();
  }
  if (document.readyState !== 'loading') init();
  else document.addEventListener('DOMContentLoaded', init);
  setTimeout(init, 500);
  setTimeout(init, 2000);

  // Expose for debug
  window.dcProjects = { renderListView: renderListView, renderDetail: renderDetail, state: state };
})();
