/* ============================================================
   DreamCar Tasks — UX fixes batch v1 (Daniel feedback 03.06.2026)
   - description textarea таtaller
   - backdrop click → confirm if dirty
   - workflow buttons у overview (✓ Виконано / ↩ На перевірку / 🤝 Передати)
   - tags datalist autocomplete з історії
   - priority label hint
   - save button error visibility (console.error + toast)
   ============================================================ */
(function () {
  if (window.__tasksFixesLoaded) return;
  window.__tasksFixesLoaded = true;

  /* ===== 1. CSS injections ===== */
  var css = document.createElement('style');
  css.id = 'tasks-fixes-css';
  css.textContent = [
    '/* Bigger description textarea */',
    '#f-description { min-height: 180px !important; resize: vertical; font-size: 14px; line-height: 1.55; }',
    '/* Priority hint inline */',
    '#f-priority + .pri-hint { font-size: 10px; color: var(--ash, #888); margin-top: 4px; line-height: 1.4; }',
    '/* Workflow buttons у overview modal */',
    '.ov-workflow { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; padding-top:14px; border-top:1px solid var(--steel, #2a2a2a); }',
    '.ov-workflow .wf-btn { padding:8px 14px; border:1px solid var(--steel); background:var(--coal, #141414); color:#fff; border-radius:6px; cursor:pointer; font-family:"JetBrains Mono",monospace; font-size:11px; letter-spacing:.1em; text-transform:uppercase; transition:all .15s; }',
    '.ov-workflow .wf-btn:hover { border-color: var(--red, #E30613); background: rgba(227,6,19,.06); }',
    '.ov-workflow .wf-btn.success:hover { border-color:#10B981; background:rgba(16,185,129,.08); color:#10B981; }',
    '.ov-workflow .wf-btn.warn:hover { border-color:#F59E0B; background:rgba(245,158,11,.08); color:#F59E0B; }',
    '/* Dirty-state warning */',
    '.dirty-confirm { position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.85); display:flex; align-items:center; justify-content:center; }',
    '.dirty-confirm .box { background:var(--coal, #141414); border:1px solid var(--red, #E30613); border-radius:10px; padding:24px 28px; max-width:420px; font-family:"Manrope",sans-serif; color:#fff; }',
    '.dirty-confirm h3 { font-family:"Oswald",sans-serif; font-size:18px; margin-bottom:12px; text-transform:uppercase; }',
    '.dirty-confirm p { font-size:13px; color:var(--ash,#bbb); margin-bottom:18px; line-height:1.6; }',
    '.dirty-confirm .actions { display:flex; gap:8px; justify-content:flex-end; }',
    '.dirty-confirm button { padding:8px 14px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; border:1px solid var(--steel); background:transparent; color:#fff; }',
    '.dirty-confirm button.primary { background:var(--red,#E30613); border-color:var(--red); }',
    '.dirty-confirm button.danger { color:#F59E0B; border-color:#F59E0B; }',
  ].join('\n');
  document.head.appendChild(css);

  /* ===== 2. Priority hint label ===== */
  function injectPriorityHint() {
    var sel = document.getElementById('f-priority');
    if (!sel || sel.__hintInjected) return;
    sel.__hintInjected = true;
    var hint = document.createElement('div');
    hint.className = 'pri-hint';
    hint.innerHTML = 'P1 — терміново сьогодні · P2 — цього тижня · P3 — стандарт · P4 — без поспіху';
    sel.parentNode.appendChild(hint);
  }

  /* ===== 3. Description textarea (CSS вже зробив, тут JS-fallback for safari) ===== */
  // CSS already increases height, nothing extra needed.

  /* ===== 4. Tags datalist autocomplete з історії ===== */
  function injectTagsAutocomplete() {
    var inp = document.getElementById('f-tags');
    if (!inp || inp.__autocompleteInjected) return;
    inp.__autocompleteInjected = true;
    if (!document.getElementById('tags-history')) {
      var dl = document.createElement('datalist');
      dl.id = 'tags-history';
      document.body.appendChild(dl);
      inp.setAttribute('list', 'tags-history');
    }
    // Збираємо top-tags з state.tasks
    function rebuild() {
      var dl = document.getElementById('tags-history');
      if (!dl) return;
      var counts = {};
      (window.state && window.state.tasks ? state.tasks : []).forEach(function (t) {
        (t.tags || []).forEach(function (tag) { counts[tag] = (counts[tag] || 0) + 1; });
      });
      var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; }).slice(0, 50);
      dl.innerHTML = top.map(function (t) { return '<option value="' + t.replace(/"/g, '&quot;') + '">'; }).join('');
    }
    rebuild();
    // Re-collect after tasks reload
    setInterval(rebuild, 8000);
  }

  /* ===== 5. Dirty-state confirmation on backdrop click ===== */
  function isModalDirty() {
    var title = document.getElementById('f-title');
    var desc = document.getElementById('f-description');
    if (!title) return false;
    return (title.value.trim().length > 0) || (desc && desc.value.trim().length > 0);
  }

  function showDirtyConfirm(onSave, onDiscard) {
    var wrap = document.createElement('div');
    wrap.className = 'dirty-confirm';
    wrap.innerHTML =
      '<div class="box">' +
      '<h3>Закрити без збереження?</h3>' +
      '<p>У задачі є незбережені зміни. Що зробити?</p>' +
      '<div class="actions">' +
      '<button data-act="cancel">← Назад редагувати</button>' +
      '<button class="danger" data-act="discard">Видалити чернетку</button>' +
      '<button class="primary" data-act="save">Зберегти зараз</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      var act = e.target && e.target.dataset && e.target.dataset.act;
      if (!act) return;
      wrap.remove();
      if (act === 'save') onSave();
      else if (act === 'discard') onDiscard();
    });
  }

  function bindBackdropGuard() {
    var modal = document.getElementById('taskModal');
    if (!modal || modal.__dirtyGuard) return;
    modal.__dirtyGuard = true;
    // Перехопимо існуючий backdrop click — він був на 1009: if(e.target===modal)modal.classList.remove('show');
    // Замість видалення existing — додаємо capture-listener що блокує якщо dirty
    modal.addEventListener('click', function (e) {
      if (e.target !== modal) return;
      if (!isModalDirty()) return; // не dirty → дозволяю стандартний close
      e.stopImmediatePropagation();
      e.preventDefault();
      showDirtyConfirm(
        function () { var btn = document.getElementById('saveTaskBtn'); if (btn) btn.click(); },
        function () { modal.classList.remove('show'); }
      );
    }, true); // capture phase щоб попередити existing listener
  }

  /* ===== 6. Workflow buttons у overview modal ===== */
  function injectOverviewWorkflow() {
    var overview = document.getElementById('overviewModal');
    if (!overview) return;
    // observer для коли overview-modal заповнюється task
    var mo = new MutationObserver(function () {
      var actBox = overview.querySelector('.ov-actions, .modal-actions');
      var existing = overview.querySelector('.ov-workflow');
      if (existing) return;
      if (!actBox) return;
      var taskCardEl = overview.querySelector('[data-task-id]');
      var taskId = taskCardEl ? taskCardEl.getAttribute('data-task-id') : null;
      var task = null;
      try { task = (window.state && state.tasks || []).find(function (t) { return t.id === taskId; }); } catch (_) {}
      if (!task && !taskId) return;
      var wf = document.createElement('div');
      wf.className = 'ov-workflow';
      var st = task ? task.status : null;
      var html = '';
      // ✓ Виконано (для doing/review)
      if (st && st !== 'done' && st !== 'blocked') {
        html += '<button class="wf-btn success" data-wf="done">✓ Виконано</button>';
      }
      // ↩ На перевірку (для doing → review)
      if (st === 'doing') {
        html += '<button class="wf-btn" data-wf="review">↩ На перевірку</button>';
      }
      // 🚧 Заблокувати
      if (st && st !== 'blocked' && st !== 'done') {
        html += '<button class="wf-btn warn" data-wf="blocked">🚧 Заблоковано</button>';
      }
      // ▶ Взяти в роботу (з inbox)
      if (st === 'inbox') {
        html += '<button class="wf-btn" data-wf="doing">▶ Взяти в роботу</button>';
      }
      // 🤝 Передати іншому
      html += '<button class="wf-btn" data-wf="reassign">🤝 Передати</button>';
      if (!html) return;
      wf.innerHTML = html;
      actBox.parentNode.insertBefore(wf, actBox);
      wf.addEventListener('click', async function (e) {
        var btn = e.target.closest('[data-wf]'); if (!btn) return;
        var wfAct = btn.dataset.wf;
        if (!task || !window.supabase) return;
        if (wfAct === 'reassign') {
          // Prompt-fallback — обери з списку юзерів
          var names = (window.state && state.users || []).map(function (u) { return u.name; }).join('\n');
          var name = prompt('Передати кому?\n\n' + names, '');
          if (!name) return;
          var u = (state.users || []).find(function (x) { return x.name && x.name.toLowerCase() === name.trim().toLowerCase(); });
          if (!u) { window.toast && toast('Користувача не знайдено', 'error'); return; }
          var res = await supabase.from('team_tasks').update({ assignee_id: u.id, updated_at: new Date().toISOString() }).eq('id', task.id);
          if (res.error) { window.toast && toast('Помилка: ' + res.error.message, 'error'); return; }
          window.toast && toast('Передано → ' + u.name, 'success');
        } else {
          var newStatus = wfAct; // done/review/blocked/doing
          var update = { status: newStatus, updated_at: new Date().toISOString() };
          if (newStatus === 'done') update.completed_at = new Date().toISOString();
          var res = await supabase.from('team_tasks').update(update).eq('id', task.id);
          if (res.error) { window.toast && toast('Помилка: ' + res.error.message, 'error'); return; }
          window.toast && toast('Статус → ' + newStatus, 'success');
        }
        overview.classList.remove('show');
        try { window.loadTasks && loadTasks(); } catch (_) {}
        try { window.triggerNotifyWorker && triggerNotifyWorker(); } catch (_) {}
      });
    });
    mo.observe(overview, { childList: true, subtree: true });
  }

  /* ===== 7. saveTask REPLACEMENT — explicit error visibility + .select() to detect RLS silent fails ===== */
  async function saveTaskV2() {
    var titleEl = document.getElementById('f-title');
    var title = (titleEl && titleEl.value || '').trim();
    if (!title) { window.toast && toast('Введи назву', 'error'); titleEl && titleEl.focus(); return; }

    // Перевірка авторизації перед insert
    if (!window.state || !state.publicUser || !state.publicUser.id) {
      console.error('[saveTaskV2] state.publicUser missing — auth not ready');
      window.toast && toast('Сесія не завантажена. Оновіть сторінку (Cmd+R) і спробуй ще раз.', 'error');
      return;
    }

    var data = {
      title: title,
      description: (document.getElementById('f-description').value || '').trim() || null,
      status: document.getElementById('f-status').value,
      priority: document.getElementById('f-priority').value,
      assignee_id: document.getElementById('f-assignee').value || null,
      due_date: document.getElementById('f-due').value || null,
      recurrence: document.getElementById('f-recurrence').value || null,
      estimated_h: parseFloat(document.getElementById('f-estimated').value) || null,
      tags: (document.getElementById('f-tags').value || '').split(',').map(function(s){return s.trim();}).filter(Boolean),
      subtasks: state.subtasks || [],
      watchers: state.watchers || [],
      updated_at: new Date().toISOString(),
    };

    console.log('[saveTaskV2] payload', { editingId: state.editingId, data, user: state.publicUser.id });

    var res;
    try {
      if (state.editingId) {
        res = await window.supabase.from('team_tasks').update(data).eq('id', state.editingId).select().single();
      } else {
        data.created_by = state.publicUser.id;
        data.created_at = new Date().toISOString();
        res = await window.supabase.from('team_tasks').insert(data).select().single();
      }
    } catch (e) {
      console.error('[saveTaskV2] throw', e);
      window.toast && toast('Виняток: ' + (e.message || e), 'error');
      return;
    }

    console.log('[saveTaskV2] result', res);

    if (res.error) {
      window.toast && toast('Помилка: ' + res.error.message, 'error');
      return;
    }
    if (!res.data) {
      // RLS silent fail — 0 rows повернуто
      window.toast && toast('Не збережено (RLS заблокувала). Перевір що ти у списку users (auth_id мапиться).', 'error');
      return;
    }

    window.toast && toast(state.editingId ? 'Збережено' : 'Створено: ' + res.data.title, 'success');
    var m = document.getElementById('taskModal'); if (m) m.classList.remove('show');
    try { window.loadTasks && await loadTasks(); } catch (_) {}
    try { window.triggerNotifyWorker && triggerNotifyWorker(); } catch (_) {}
  }

  function installSaveTaskV2() {
    window.saveTask = saveTaskV2;
    var btn = document.getElementById('saveTaskBtn');
    if (btn) btn.onclick = saveTaskV2;
  }
  function wrapSaveTaskErrors() {
    installSaveTaskV2();
    // Retry щоб переконатися що onclick привʼязаний навіть після pізніших script binders
    setTimeout(installSaveTaskV2, 600);
    setTimeout(installSaveTaskV2, 2000);
  }

  /* ===== 7c. Cmd+S перехопити ГЛОБАЛЬНО з preventDefault ===== */
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы' || e.key === 'і' || e.key === 'І')) {
      var modal = document.getElementById('taskModal');
      if (modal && modal.classList.contains('show')) {
        e.preventDefault();
        e.stopPropagation();
        saveTaskV2();
      }
    }
  }, true); // capture phase — раніше за browser і за існуючий handler

  /* ===== 7d. + Нова задача button у view header (раніше display:none) ===== */
  function injectNewTaskButton() {
    var addBtn = document.getElementById('addTaskBtn');
    if (addBtn) addBtn.style.display = 'inline-flex';
    // Якщо нема — додаємо у header
    var headerArea = document.querySelector('.filter-bar, .toolbar, .header, header, .topbar');
    if (!headerArea || headerArea.querySelector('.new-task-cta')) return;
    var btn = document.createElement('button');
    btn.className = 'add-btn new-task-cta';
    btn.style.cssText = 'background:var(--red,#E30613);color:#fff;border:none;padding:8px 14px;border-radius:6px;font-weight:700;font-size:12px;cursor:pointer;margin-left:8px;letter-spacing:.05em;';
    btn.innerHTML = '+ НОВА ЗАДАЧА';
    btn.onclick = function () { window.openTaskModal && openTaskModal(null); };
    headerArea.appendChild(btn);
  }

  /* ===== 7b. Same wrap для postComment — Daniel "коментарі не відправляються" ===== */
  function wrapPostCommentErrors() {
    if (typeof window.postComment !== 'function') { setTimeout(wrapPostCommentErrors, 500); return; }
    if (window.postComment.__wrappedForErr) return;
    var orig = window.postComment;
    window.postComment = async function () {
      try {
        var r = await orig.apply(this, arguments);
        return r;
      } catch (e) {
        console.error('[postComment error]', e);
        window.toast && toast('Не вдалось відправити коментар: ' + (e && e.message || 'unknown'), 'error');
        throw e;
      }
    };
    window.postComment.__wrappedForErr = true;
    var btn = document.getElementById('postCommentBtn');
    if (btn) btn.onclick = window.postComment;
  }

  /* ===== 8. Flatpickr — кращий календар для f-due ===== */
  var FP_CSS_URL = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css';
  var FP_DARK_URL = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/themes/dark.css';
  var FP_JS_URL = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js';
  var FP_UK_URL = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/uk.js';
  function ensureFlatpickr(cb) {
    if (window.flatpickr) return cb();
    // CSS
    ['flatpickr-css', FP_CSS_URL, 'flatpickr-css-dark', FP_DARK_URL].forEach(function (_, i) {
      if (i % 2) return;
      var id = arguments[0]; // not really; ignore
    });
    if (!document.getElementById('flatpickr-css')) {
      var l = document.createElement('link'); l.id = 'flatpickr-css'; l.rel = 'stylesheet'; l.href = FP_CSS_URL; document.head.appendChild(l);
      var l2 = document.createElement('link'); l2.id = 'flatpickr-css-dark'; l2.rel = 'stylesheet'; l2.href = FP_DARK_URL; document.head.appendChild(l2);
    }
    var s = document.createElement('script'); s.src = FP_JS_URL; s.onload = function () {
      var s2 = document.createElement('script'); s2.src = FP_UK_URL; s2.onload = cb; document.head.appendChild(s2);
    }; document.head.appendChild(s);
  }
  function bindDuePicker() {
    var inp = document.getElementById('f-due');
    if (!inp || inp.__fpBound) return;
    ensureFlatpickr(function () {
      try {
        inp.type = 'text'; // flatpickr працює з text input
        inp.placeholder = 'дд.мм.рррр';
        inp._fp = window.flatpickr(inp, {
          dateFormat: 'Y-m-d',
          altInput: true,
          altFormat: 'd.m.Y',
          locale: window.flatpickr.l10ns && window.flatpickr.l10ns.uk,
          allowInput: true,
          minDate: '2026-01-01',
          disableMobile: false
        });
        inp.__fpBound = true;
      } catch (e) { console.warn('[flatpickr bind] ', e); }
    });
  }

  /* ===== 9. Watchers dropdown — show ALL available users on focus (без введення) ===== */
  function patchWatchersFocus() {
    var inp = document.getElementById('watchersInput');
    var list = document.getElementById('watchersList');
    if (!inp || !list) { return; }
    if (inp.__focusPatched) return;
    inp.__focusPatched = true;
    inp.addEventListener('focus', function () {
      if (!window.state || !state.users) return;
      var matches = state.users.filter(function (u) { return !(state.watchers || []).includes(u.id); }).slice(0, 12);
      if (!matches.length) return;
      list.innerHTML = matches.map(function (u) {
        return '<div class="ms-list-item" data-uid="' + u.id + '">' + (u.name || u.email).replace(/</g, '&lt;') + '</div>';
      }).join('');
      list.querySelectorAll('.ms-list-item').forEach(function (el) {
        el.onclick = function () {
          state.watchers.push(el.dataset.uid);
          try { window.renderWatchers && renderWatchers(); } catch (_) {}
          list.classList.remove('show');
        };
      });
      list.classList.add('show');
      var r = inp.getBoundingClientRect();
      list.style.left = r.left + 'px';
      list.style.top = (r.bottom + window.scrollY) + 'px';
      list.style.width = r.width + 'px';
    });
  }

  /* ===== Initialization ===== */
  function init() {
    injectPriorityHint();
    injectTagsAutocomplete();
    bindBackdropGuard();
    injectOverviewWorkflow();
    wrapSaveTaskErrors();
    wrapPostCommentErrors();
    bindDuePicker();
    patchWatchersFocus();
    injectNewTaskButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Retry — на випадок якщо elements з'являться пізніше
  setTimeout(init, 600);
  setTimeout(init, 1800);
  setTimeout(init, 4000);

  // Re-init при показі taskModal (динамічно)
  var modalObserver = new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      if (m.attributeName === 'class') {
        var t = m.target;
        if (t.id === 'taskModal' && t.classList && t.classList.contains('show')) {
          injectPriorityHint();
          injectTagsAutocomplete();
          bindDuePicker();
          patchWatchersFocus();
        }
      }
    });
  });
  setTimeout(function () {
    var modal = document.getElementById('taskModal');
    if (modal) modalObserver.observe(modal, { attributes: true });
  }, 1000);
})();
