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

  /* ===== 0. ESCAPE DIRTY-STATE GUARD (capture-phase, перший у chain) =====
   * Це HARD-блокування Esc якщо taskModal відкрита і має введені дані.
   * capture:true + stopImmediatePropagation гарантує що ми ловимо ПЕРЕД
   * native handler у HTML (рядок 1444) і ПЕРЕД drawer handler (рядок 1032).
   * Якщо confirm = OK → ми СКАСОВУЄМО handler і відсилаємо click на cancelBtn (модалка закриється).
   * Якщо confirm = Cancel → залишаємо модалку відкритою. */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' && e.keyCode !== 27) return;
    var modal = document.getElementById('taskModal');
    if (!modal || !modal.classList.contains('show')) return;

    // Швидка перевірка чи є введені дані
    var t = '', d = '';
    try {
      t = (document.getElementById('f-title') || {}).value || '';
      d = (document.getElementById('f-description') || {}).value || '';
    } catch (_) {}
    var subN = (window.state && state.subtasks && state.subtasks.length) || 0;
    var watN = (window.state && state.watchers && state.watchers.length) || 0;
    var hasContent = !!(t.trim() || d.trim() || subN || watN);

    if (!hasContent) return; // нічого не введено — нехай native handler закриє

    // ЛОВИМО ESCAPE - блокуємо всіх інших і питаємо
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    var ok = confirm('⚠ Закрити без збереження?\n\nВведені дані втратяться:\n• назва: "' + t.substring(0, 40) + (t.length > 40 ? '…' : '') + '"\n• опис: ' + d.length + ' симв.\n• чек-лист: ' + subN + ' позицій\n• спостерігачів: ' + watN);
    if (ok) {
      modal.classList.remove('show');
    }
    // якщо not ok — нічого не робимо, модалка лишається
  }, true); // capture:true — спрацьовує ПЕРШИМ у DOM tree

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

  /* ===== 7. saveTask REPLACEMENT — DISABLED 03.06.2026 evening
   * Виявилось що bare `toast(...)` падає TypeError у app-tasks-fixes.js scope (toast лише у HTML closure).
   * Тепер vmesto override — самий saveTask переписаний прямо у tasks/index.html line 1093
   * (з alert + console.log + .select().single() + RLS silent fail detection).
   * Cmd+S handler також у HTML line 1420 — викликає саме той локальний saveTask.
   * Ми НЕ перевизначаємо нічого, тільки залишаємо це як no-op stub для зворотньої сумісності.
   */
  function wrapSaveTaskErrors() { /* no-op */ }

  /* ===== 7d. + Нова задача button — DISABLED повністю ===== */
  /* HTML коментар біля #addTaskBtn у tasks/index.html line 427:
   *   "Прихована для compat (FAB і drawer тригерять цю кнопку)"
   * Тобто кнопка ЗАВЕДОМО display:none — FAB її тригерить програмно через .click().
   * Моя попередня версія (showing її inline-flex) ламала верстку — вона великого
   * розміру і wraps на новий рядок під filter-bar.
   * Тепер: тільки очистка застарілої .new-task-cta з кешу попередніх render. */
  function injectNewTaskButton() {
    // 03.06.2026 v8: addTaskBtn тепер ВСЕРЕДИНІ <nav class="filter-rad"> як перший chip
    // (виділений червоним через .chip-cta). FAB лишається у правому кутку як швидкий доступ.
    // Просто очистити застарілу .new-task-cta з попередніх кешів.
    document.querySelectorAll('.new-task-cta').forEach(function(el){ el.remove(); });
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

  /* ===== 9. Watchers dropdown — robust handler через event delegation =====
   * v3 (03.06): + API fallback якщо state.users пустий + visible placeholder. */
  
  var _watchersCache = null;
  
  async function ensureUsersLoaded() {
    // 1) Check state.users (native populated through loadUsers)
    if (window.state && Array.isArray(state.users) && state.users.length) {
      _watchersCache = state.users;
      return state.users;
    }
    // 2) Wait up to 2 сек поки native loadUsers() завершить (на load modal паралельно)
    for (var i = 0; i < 20; i++) {
      await new Promise(function(r){ setTimeout(r, 100); });
      if (window.state && Array.isArray(state.users) && state.users.length) {
        _watchersCache = state.users;
        return state.users;
      }
    }
    if (_watchersCache && _watchersCache.length) return _watchersCache;
    // 3) Fallback fetch напряму (БЕЗ .eq('is_active',true) — RLS вже фільтрує)
    if (!window.supabase) { console.error('[watchers] no supabase client'); return []; }
    try {
      console.log('[watchers] fallback fetch from API');
      var r = await window.supabase.from('users').select('id,name,email,role,is_active').order('name');
      var users = (r.data || []).filter(function(u){ return u.is_active !== false; });
      _watchersCache = users;
      if (window.state) state.users = users;
      console.log('[watchers] fallback loaded:', users.length, 'users; rpc err:', r.error);
      return users;
    } catch (e) {
      console.error('[watchers] fallback fetch error', e);
      return [];
    }
  }
  
  // POSITIONING FIX: переносимо watchersList у multiselect parent щоб top:100% працювало
  function ensureWatchersListAttached() {
    var ms = document.getElementById('watchersMS');
    var list = document.getElementById('watchersList');
    if (!ms || !list) return;
    if (!ms.contains(list)) {
      ms.style.position = 'relative';
      ms.appendChild(list);
      list.style.position = 'absolute';
      list.style.top = 'calc(100% + 4px)';
      list.style.left = '0';
      list.style.right = '0';
      list.style.width = 'auto';
    }
  }
  
  async function renderWatchersListAt(inp, list, query) {
    var users = await ensureUsersLoaded();
    
    if (!users.length) {
      list.innerHTML = '<div class="ms-list-item" style="opacity:.6;cursor:default;">Немає юзерів у системі</div>';
      list.classList.add('show');
      var r0 = inp.getBoundingClientRect();
      list.style.left = r0.left + 'px';
      list.style.top = (r0.bottom + window.scrollY + 2) + 'px';
      list.style.width = Math.max(r0.width, 240) + 'px';
      return;
    }
    
    var q = (query || '').toLowerCase().trim();
    var sel = (window.state && state.watchers) || [];
    var matches = users.filter(function (u) {
      if (sel.indexOf(u.id) >= 0) return false;
      if (!q) return true;
      var n = (u.name || '').toLowerCase();
      var e = (u.email || '').toLowerCase();
      return n.indexOf(q) >= 0 || e.indexOf(q) >= 0;
    }).slice(0, 20);

    if (!matches.length) {
      list.innerHTML = '<div class="ms-list-item" style="opacity:.6;cursor:default;">' + (q ? 'Нічого не знайдено за "' + q + '"' : 'Всіх юзерів вже додано') + '</div>';
      list.classList.add('show');
    } else {
      list.innerHTML = matches.map(function (u) {
        var label = (u.name || u.email).replace(/</g, '&lt;');
        var role = u.role ? ' <span style="opacity:.5;font-size:11px">· ' + u.role + '</span>' : '';
        return '<div class="ms-list-item" data-uid="' + u.id + '">' + label + role + '</div>';
      }).join('');
      list.classList.add('show');
    }
    // Якщо list переміщений у multiselect parent — top:100% уже set. Інакше — getBoundingClientRect fallback.
    ensureWatchersListAttached();
    if (!list.parentElement || list.parentElement.id !== 'watchersMS') {
      var r = inp.getBoundingClientRect();
      list.style.left = r.left + 'px';
      list.style.top = (r.bottom + window.scrollY + 2) + 'px';
      list.style.width = Math.max(r.width, 240) + 'px';
    }
  }

  /* Watchers — переписано на native <select> у HTML (03.06.2026 Вадим feedback).
   * Старий custom input з autocomplete dropdown прибраний. Native renderWatchers робить роботу. */
  function patchWatchersFocus() { /* no-op */ }

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
