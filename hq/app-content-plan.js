/* ============================================================
   DreamCar HQ — 🗂 Базовий контент-план (бібліотека без дат)
   Запит Олександра (SMM), 10.08.2026.
   ------------------------------------------------------------
   Постійний шаблон контенту для кожного нового проєкту:
   картки без дати, згруповані за етапом (stage) + порядковий №.
   Кожна: назва, опис, тип, категорія, рубрика, посилання-референс.
   «＋ В календар» — копіює картку у publications як чернетку на
   старт проєкту з міткою work_status='Потребує дати' (картка в
   шаблоні лишається). Масовий вибір → «Додати вибрані в проект».
   БД: base_content_items (міграція 020).
   ============================================================ */
(function () {
  if (window.__hqContentPlan) return;
  window.__hqContentPlan = true;

  var TYPES = ['Пост', 'Відео', 'Reels', 'Сторіз', 'Карусель', 'Рубрика', 'Лонгрід'];
  // base type → мітка календаря (Store.contentType). Відео/Reels → reels.
  function appLabel(t) {
    return ({ 'Пост': 'Пост', 'Відео': 'Reels', 'Reels': 'Reels', 'Сторіз': 'Сторис', 'Карусель': 'Карусель', 'Рубрика': 'Пост', 'Лонгрід': 'Лонгрід' })[t] || 'Пост';
  }

  var state = { items: [], rubrics: [], launches: [], sel: {}, target: null, dragId: null };

  function sb() { return window.supabase; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function say(m, k) { if (typeof toast === 'function') toast(m, k || 'success'); }
  function me() { return (typeof Store !== 'undefined' && Store.currentUser) ? Store.currentUser() : null; }
  function uid() { var u = me(); return u ? u.id : null; }

  function injectCss() {
    if (document.getElementById('hq-cp-css')) return;
    var st = document.createElement('style'); st.id = 'hq-cp-css';
    st.textContent = [
      '.cp-wrap{padding:0 26px 46px;}',
      '.cp-bar{display:flex;gap:10px;align-items:center;background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:11px 14px;margin-bottom:14px;flex-wrap:wrap;}',
      '.cp-bar label{font-size:12.5px;color:var(--grey-2);}',
      '.cp-bar select{background:var(--bg-3);border:1px solid var(--border);color:#fff;border-radius:8px;padding:8px 11px;font-size:13px;}',
      '.cp-add{display:flex;gap:8px;align-items:flex-start;background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:16px;flex-wrap:wrap;}',
      '.cp-add input,.cp-add select{background:var(--bg-3);border:1px solid var(--border);color:#fff;border-radius:8px;padding:9px 11px;font-size:13px;font-family:inherit;}',
      '.cp-add input.stage{width:140px;} .cp-add input.ttl{flex:1;min-width:200px;}',
      '.cp-add button{background:var(--red);color:#fff;border:1px solid var(--red);border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;}',
      '.cp-stage{margin:18px 0 8px;font-size:12px;letter-spacing:.8px;text-transform:uppercase;color:var(--grey-2);font-weight:700;}',
      '.cp-card{display:flex;gap:12px;align-items:flex-start;background:var(--bg-2);border:1px solid var(--border);border-left:3px solid var(--grey-2);border-radius:11px;padding:12px 14px;margin-bottom:8px;}',
      '.cp-card.sel{border-left-color:var(--red);background:linear-gradient(90deg,var(--red-dim),transparent 55%),var(--bg-2);}',
      '.cp-grip{cursor:grab;color:var(--grey-2);font-size:15px;padding-top:2px;user-select:none;}',
      '.cp-cb{width:19px;height:19px;flex:none;margin-top:2px;cursor:pointer;accent-color:var(--red,#cc0000);}',
      '.cp-main{flex:1;min-width:0;}',
      '.cp-ttl{font-size:14.5px;line-height:1.4;color:#e8e8f0;font-weight:600;}',
      '.cp-seq{color:var(--grey-2);font-weight:400;font-size:12.5px;margin-right:6px;}',
      '.cp-desc{margin-top:4px;font-size:12.5px;color:var(--grey);white-space:pre-wrap;}',
      '.cp-tags{margin-top:7px;display:flex;gap:7px;flex-wrap:wrap;align-items:center;font-size:11.5px;}',
      '.cp-badge{padding:2px 9px;border-radius:20px;background:var(--bg-3);border:1px solid var(--border);color:var(--grey);}',
      '.cp-dot{width:9px;height:9px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:-1px;}',
      '.cp-ref{color:#7ab0ff;text-decoration:none;} .cp-ref:hover{text-decoration:underline;}',
      '.cp-acts{display:flex;flex-direction:column;gap:6px;align-items:flex-end;}',
      '.cp-tocal{background:var(--green-dim);border:1px solid var(--green);color:var(--green);border-radius:8px;padding:6px 11px;font-size:12px;cursor:pointer;white-space:nowrap;}',
      '.cp-ico{background:none;border:none;color:var(--grey-2);cursor:pointer;font-size:13.5px;padding:2px 4px;}',
      '.cp-ico:hover{color:var(--red-soft);}',
      '.cp-selbar{position:sticky;bottom:0;background:var(--bg-2);border:1px solid rgba(204,0,0,.4);border-radius:12px;padding:11px 15px;margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;box-shadow:0 -6px 20px rgba(0,0,0,.35);}',
      '.cp-selbar button{background:var(--red);color:#fff;border:1px solid var(--red);border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;}',
      '.cp-selbar .ghost{background:none;border:1px solid var(--border);color:var(--grey);}',
      '.cp-empty{text-align:center;padding:46px 20px;color:var(--grey-2);font-size:14px;}',
      '@media(max-width:760px){.cp-wrap{padding:0 14px 30px;}.cp-card{flex-wrap:wrap;}.cp-acts{flex-direction:row;}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------
  async function loadAll() {
    var r = await Promise.all([
      sb().from('base_content_items').select('id,stage,seq,title,description,content_type,rubric_id,category,reference_url,sort_order').is('deleted_at', null).order('sort_order'),
      sb().from('rubrics').select('id,name,color').order('sort_order'),
      sb().from('launches').select('id,name,code,status,starts_on,is_active').order('created_at', { ascending: false })
    ]);
    if (r[0].error) throw r[0].error;
    state.items = r[0].data || [];
    state.rubrics = r[1].error ? [] : (r[1].data || []);
    state.launches = (r[2].data || []).filter(function (l) { return l.is_active !== false; });
    if (!state.target && state.launches.length) {
      var act = state.launches.find(function (l) { return l.status === 'active'; });
      state.target = (act || state.launches[0]).id;
    }
  }

  function rubricOf(id) { return state.rubrics.find(function (x) { return x.id === id; }); }
  function groupByStage(rows) {
    var g = {}, order = [];
    rows.forEach(function (r) { var s = r.stage || 'Інше'; if (!g[s]) { g[s] = []; order.push(s); } g[s].push(r); });
    return order.map(function (s) { return { stage: s, rows: g[s] }; });
  }

  function card(it) {
    var ru = rubricOf(it.rubric_id);
    var selected = !!state.sel[it.id];
    return '<div class="cp-card' + (selected ? ' sel' : '') + '" draggable="true" data-cp="' + it.id + '">' +
      '<span class="cp-grip" title="Перетягни">⠿</span>' +
      '<input type="checkbox" class="cp-cb" ' + (selected ? 'checked' : '') + ' onchange="cpToggleSel(\'' + it.id + '\',this.checked)">' +
      '<div class="cp-main">' +
        '<div class="cp-ttl">' + (it.seq ? '<span class="cp-seq">#' + it.seq + '</span>' : '') + esc(it.title) + '</div>' +
        (it.description ? '<div class="cp-desc">' + esc(it.description) + '</div>' : '') +
        '<div class="cp-tags">' +
          '<span class="cp-badge">' + esc(it.content_type) + '</span>' +
          (it.category ? '<span class="cp-badge">' + esc(it.category) + '</span>' : '') +
          (ru ? '<span class="cp-badge"><span class="cp-dot" style="background:' + esc(ru.color || '#888') + '"></span>' + esc(ru.name) + '</span>' : '') +
          (it.reference_url ? '<a class="cp-ref" href="' + esc(it.reference_url) + '" target="_blank" rel="noopener">🔗 приклад</a>' : '') +
        '</div>' +
      '</div>' +
      '<div class="cp-acts">' +
        '<button type="button" class="cp-tocal" title="Додати чернетку в календар проєкту" onclick="cpToCal(\'' + it.id + '\')">＋ В календар</button>' +
        '<div>' +
          '<button type="button" class="cp-ico" title="Редагувати" onclick="cpEdit(\'' + it.id + '\')">✏️</button>' +
          '<button type="button" class="cp-ico" title="Видалити" onclick="cpDelete(\'' + it.id + '\')">🗑</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function paint() {
    var host = document.getElementById('cpBody'); if (!host) return;
    var groups = groupByStage(state.items);
    var body = groups.length ? groups.map(function (g) {
      return '<div class="cp-stage">' + esc(g.stage) + '</div>' + g.rows.map(card).join('');
    }).join('') : '<div class="cp-empty">Бібліотека порожня. Додай першу картку вище.</div>';

    var selN = Object.keys(state.sel).filter(function (k) { return state.sel[k]; }).length;
    var selbar = selN ? '<div class="cp-selbar"><span>Обрано <b>' + selN + '</b></span><span>' +
      '<button type="button" class="ghost" onclick="cpClearSel()">Зняти</button> ' +
      '<button type="button" onclick="cpAddSelected()">Додати вибрані в проект →</button></span></div>' : '';
    host.innerHTML = body + selbar;
    bindDrag(host);
  }

  async function renderContentPlan(root) {
    injectCss();
    root.innerHTML =
      '<div class="view-header"><h1>🗂 Базовий контент-план</h1><span class="view-meta" id="cpMeta">· завантаження…</span></div>' +
      '<div class="cp-wrap"><div id="cpTop"></div><div id="cpBody"><div class="cp-empty">Завантаження…</div></div></div>';
    try {
      await loadAll();
      renderTop();
      var m = document.getElementById('cpMeta'); if (m) m.textContent = '· ' + state.items.length + ' карток';
      paint();
    } catch (e) {
      console.error('[hq-content-plan] load', e);
      document.getElementById('cpBody').innerHTML = '<div class="cp-empty">Не вдалось завантажити: ' + esc(e.message || e) + '</div>';
    }
  }

  function renderTop() {
    var top = document.getElementById('cpTop'); if (!top) return;
    top.innerHTML =
      '<div class="cp-bar"><label>Куди додавати:</label><select id="cpTarget" onchange="cpSetTarget(this.value)">' +
        '<option value="">— оберіть проєкт —</option>' +
        state.launches.map(function (l) { return '<option value="' + l.id + '"' + (l.id === state.target ? ' selected' : '') + '>' + esc(l.name || l.code) + (l.status === 'active' ? ' (активний)' : '') + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="cp-add">' +
        '<input class="stage" id="cpStage" placeholder="Етап" maxlength="120" list="cpStageList">' +
        '<datalist id="cpStageList">' + [...new Set(state.items.map(function (t) { return t.stage; }))].map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>' +
        '<input class="ttl" id="cpTtl" placeholder="Назва публікації" maxlength="500">' +
        '<select id="cpType">' + TYPES.map(function (t) { return '<option value="' + t + '">' + t + '</option>'; }).join('') + '</select>' +
        '<button type="button" onclick="cpAdd()">+ Додати картку</button>' +
      '</div>';
  }

  // ---------------------------------------------------------------
  // drag&drop reorder
  // ---------------------------------------------------------------
  function bindDrag(host) {
    host.querySelectorAll('[data-cp]').forEach(function (row) {
      row.addEventListener('dragstart', function () { state.dragId = row.getAttribute('data-cp'); row.style.opacity = '.4'; });
      row.addEventListener('dragend', function () { row.style.opacity = ''; });
      row.addEventListener('dragover', function (e) { e.preventDefault(); });
      row.addEventListener('drop', function (e) { e.preventDefault(); reorder(state.dragId, row.getAttribute('data-cp')); });
    });
  }
  async function reorder(fromId, toId) {
    if (!fromId || fromId === toId) return;
    var arr = state.items;
    var fi = arr.findIndex(function (x) { return x.id === fromId; });
    var ti = arr.findIndex(function (x) { return x.id === toId; });
    if (fi < 0 || ti < 0) return;
    var moved = arr.splice(fi, 1)[0];
    moved.stage = arr[Math.min(ti, arr.length - 1)] ? arr[Math.min(ti, arr.length - 1)].stage : moved.stage;
    arr.splice(ti, 0, moved);
    arr.forEach(function (x, i) { x.sort_order = i * 10; });
    paint();
    try { for (var i = 0; i < arr.length; i++) { await sb().from('base_content_items').update({ sort_order: arr[i].sort_order, stage: arr[i].stage }).eq('id', arr[i].id); } }
    catch (e) { console.error('[cp] reorder', e); say('Порядок не зберігся', 'error'); }
  }

  // ---------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------
  window.cpSetTarget = function (v) { state.target = v || null; };
  window.cpAdd = async function () {
    var stage = (document.getElementById('cpStage').value || '').trim() || 'Інше';
    var ttl = (document.getElementById('cpTtl').value || '').trim();
    var type = document.getElementById('cpType').value || 'Пост';
    if (!ttl) { say('Впиши назву', 'error'); return; }
    var ord = (state.items.length ? Math.max.apply(null, state.items.map(function (t) { return t.sort_order; })) : 0) + 10;
    var seq = state.items.filter(function (x) { return x.stage === stage; }).length + 1;
    try {
      var r = await sb().from('base_content_items').insert({ stage: stage, seq: seq, title: ttl, content_type: type, sort_order: ord, created_by: uid() }).select().single();
      if (r.error) throw r.error;
      state.items.push(r.data); document.getElementById('cpTtl').value = ''; renderTop(); paint(); say('Картку додано');
    } catch (e) { say('Не додалось: ' + (e.message || e), 'error'); }
  };
  window.cpEdit = async function (id) {
    var it = state.items.find(function (x) { return x.id === id; }); if (!it) return;
    var ttl = prompt('Назва:', it.title); if (ttl == null) return;
    var desc = prompt('Опис:', it.description || '');
    var cat = prompt('Категорія:', it.category || '');
    var ref = prompt('Посилання на приклад/референс (URL):', it.reference_url || '');
    try {
      var patch = { title: ttl.trim(), description: (desc || '').trim() || null, category: (cat || '').trim() || null, reference_url: (ref || '').trim() || null, updated_at: new Date().toISOString() };
      var r = await sb().from('base_content_items').update(patch).eq('id', id).select().single();
      if (r.error) throw r.error; Object.assign(it, r.data); paint(); say('Збережено');
    } catch (e) { say('Не збереглось: ' + (e.message || e), 'error'); }
  };
  window.cpDelete = async function (id) {
    var it = state.items.find(function (x) { return x.id === id; }); if (!it) return;
    if (!confirm('Видалити картку «' + it.title.slice(0, 80) + '» з базового плану?')) return;
    try {
      var r = await sb().from('base_content_items').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      if (r.error) throw r.error; state.items = state.items.filter(function (x) { return x.id !== id; }); delete state.sel[id]; paint(); say('Видалено');
    } catch (e) { say('Не вдалось: ' + (e.message || e), 'error'); }
  };
  window.cpToggleSel = function (id, checked) { state.sel[id] = checked; paint(); };
  window.cpClearSel = function () { state.sel = {}; paint(); };

  // ---------------------------------------------------------------
  // Перенос у календар (рідний шлях Store — щоб одразу зʼявилось)
  // ---------------------------------------------------------------
  function targetDate() {
    var l = state.launches.find(function (x) { return x.id === state.target; });
    if (l && l.starts_on) { return new Date(l.starts_on + 'T12:00:00+03:00'); }
    return new Date();
  }
  async function pushToCalendar(it) {
    if (typeof Store === 'undefined' || typeof newPubObject !== 'function') throw new Error('Календар ще не готовий — відкрий вкладку Календар і повтори');
    var pub = newPubObject(targetDate());
    pub.title = it.title;
    pub.text = it.description || '';
    pub.contentType = appLabel(it.content_type);
    pub.rubric = it.rubric_id || '';
    if (state.target) pub.launch = state.target;
    pub.workStatus = 'Потребує дати';
    pub.status = 'draft';
    await Store.upsertPub(pub);
  }
  window.cpToCal = async function (id) {
    var it = state.items.find(function (x) { return x.id === id; }); if (!it) return;
    if (!state.target && !confirm('Проєкт не обрано — додати без привʼязки до циклу?')) return;
    try { await pushToCalendar(it); say('Додано в календар як чернетку (мітка «Потребує дати»)'); }
    catch (e) { say('Не вдалось: ' + (e.message || e), 'error'); }
  };
  window.cpAddSelected = async function () {
    var ids = Object.keys(state.sel).filter(function (k) { return state.sel[k]; });
    if (!ids.length) return;
    if (!confirm('Додати ' + ids.length + ' публікацій у календар проєкту як чернетки?')) return;
    var ok = 0;
    for (var i = 0; i < ids.length; i++) {
      var it = state.items.find(function (x) { return x.id === ids[i]; });
      if (!it) continue;
      try { await pushToCalendar(it); ok++; } catch (e) { console.error('[cp] bulk', e); }
    }
    state.sel = {}; paint();
    say(ok + ' з ' + ids.length + ' додано в календар. Признач їм дати у Календарі.');
  };

  window.renderContentPlan = renderContentPlan;
  if (window.DEBUG) console.log('%cDreamCar HQ %c· Контент-план завантажено', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
})();
