/* ============================================================
   DreamCar HQ — 📝 Нотатки (ідеї для реалізації)
   Tech-request #3 (Олександр, 02.08.2026)
   ------------------------------------------------------------
   Список ідей стовпчиком. Поруч з кожним рядком — рішення
   Вадима (ceo), Артема (cfo) і Давида (coo): Апрув / Відхилено.
   Статус рахує БД (trigger hq_notes_recompute_status):
     хоч один «Відхилено» → rejected
     усі три «Апрув»      → approved
     інакше               → pending
   TG-сповіщення шле Edge hq-notes-notify з DB-тригерів.
   ============================================================ */
(function () {
  if (window.__hqNotes) return;
  window.__hqNotes = true;

  var VOTER_ROLES = ['ceo', 'cfo', 'coo'];
  var FILTERS = [
    { id: 'pending',  label: 'На розгляді' },
    { id: 'approved', label: 'Схвалені' },
    { id: 'rejected', label: 'Відхилені' },
    { id: 'all',      label: 'Усі' }
  ];

  var state = { filter: 'pending', notes: [], votes: [], loading: false, saving: false };

  function sb() { return window.supabase; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function say(msg, kind) {
    if (typeof toast === 'function') toast(msg, kind || 'success');
  }

  // ---------------------------------------------------------------
  // Стилі
  // ---------------------------------------------------------------
  function injectCss() {
    if (document.getElementById('hq-notes-css')) return;
    var st = document.createElement('style');
    st.id = 'hq-notes-css';
    st.textContent = [
      '.notes-wrap { padding: 0 26px 40px; }',
      '.notes-add { display:flex; gap:10px; align-items:flex-start; background:var(--bg-2); border:1px solid var(--border);',
      '  border-radius:12px; padding:14px; margin-bottom:18px; flex-wrap:wrap; }',
      '.notes-add textarea { flex:1; min-width:260px; min-height:44px; max-height:180px; resize:vertical;',
      '  background:var(--bg-3); border:1px solid var(--border); color:#fff; border-radius:9px;',
      '  padding:11px 13px; font-size:14px; line-height:1.5; font-family:inherit; }',
      '.notes-add textarea:focus { outline:none; border-color:var(--red); }',
      '.notes-add .btn-add { background:var(--red); color:#fff; border:1px solid var(--red); border-radius:9px;',
      '  padding:11px 20px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; }',
      '.notes-add .btn-add:disabled { opacity:.5; cursor:default; }',
      '.notes-seg { display:flex; gap:6px; margin-bottom:16px; flex-wrap:wrap; }',
      '.notes-seg button { background:var(--bg-3); border:1px solid var(--border); color:var(--grey);',
      '  border-radius:8px; padding:7px 14px; font-size:12.5px; cursor:pointer; }',
      '.notes-seg button.on { background:var(--red-dim); border-color:rgba(204,0,0,.4); color:#fff; }',
      '.note-row { display:flex; gap:16px; align-items:flex-start; background:var(--bg-2);',
      '  border:1px solid var(--border); border-left:3px solid var(--grey-2);',
      '  border-radius:12px; padding:14px 16px; margin-bottom:10px; }',
      '.note-row.st-approved { border-left-color:var(--green); background:linear-gradient(90deg,var(--green-dim),transparent 55%),var(--bg-2); }',
      '.note-row.st-rejected { border-left-color:var(--red); background:linear-gradient(90deg,var(--red-dim),transparent 55%),var(--bg-2); opacity:.75; }',
      '.note-row.st-pending  { border-left-color:var(--gold); }',
      '.note-main { flex:1; min-width:0; }',
      '.note-title { font-size:14.5px; line-height:1.5; color:#e8e8f0; white-space:pre-wrap; word-break:break-word; }',
      '.note-row.st-rejected .note-title { text-decoration:line-through; text-decoration-color:var(--grey-2); }',
      '.note-meta { margin-top:7px; font-size:11.5px; color:var(--grey-2); display:flex; gap:10px; flex-wrap:wrap; align-items:center; }',
      '.note-badge { font-size:10.5px; letter-spacing:.6px; text-transform:uppercase; padding:2px 8px; border-radius:20px; }',
      '.nb-pending  { background:rgba(251,191,36,.15); color:var(--gold); }',
      '.nb-approved { background:var(--green-dim); color:var(--green); }',
      '.nb-rejected { background:var(--red-dim); color:var(--red-soft); }',
      '.note-votes { display:flex; gap:14px; flex-wrap:wrap; }',
      '.vote-col { min-width:104px; }',
      '.vote-name { font-size:10.5px; letter-spacing:1px; text-transform:uppercase; color:var(--grey-2); margin-bottom:6px; }',
      '.vote-btns { display:flex; gap:5px; }',
      '.vote-btns button { border:1px solid var(--border-2); background:var(--bg-3); color:var(--grey);',
      '  border-radius:7px; padding:5px 9px; font-size:12px; cursor:pointer; line-height:1.2; }',
      '.vote-btns button:disabled { cursor:default; }',
      '.vote-btns button.on-ok { background:var(--green-dim); border-color:var(--green); color:var(--green); }',
      '.vote-btns button.on-no { background:var(--red-dim); border-color:var(--red); color:var(--red-soft); }',
      '.vote-static { font-size:13px; padding:5px 2px; color:var(--grey); }',
      '.note-del { background:none; border:none; color:var(--grey-2); cursor:pointer; font-size:14px; padding:2px 4px; }',
      '.note-del:hover { color:var(--red-soft); }',
      '.notes-empty { text-align:center; padding:50px 20px; color:var(--grey-2); font-size:14px; }',
      '@media (max-width:760px) {',
      '  .notes-wrap { padding:0 14px 30px; }',
      '  .note-row { flex-direction:column; gap:12px; }',
      '  .note-votes { gap:10px; }',
      '  .vote-col { min-width:92px; }',
      '}'
    ].join('\n');
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------
  // Дані
  // ---------------------------------------------------------------
  function voters() {
    var all = (typeof Store !== 'undefined' && Store.users) ? Store.users() : [];
    return all
      .filter(function (u) { return VOTER_ROLES.indexOf(String(u.role)) !== -1 && u.is_active !== false; })
      .sort(function (a, b) { return VOTER_ROLES.indexOf(String(a.role)) - VOTER_ROLES.indexOf(String(b.role)); });
  }
  // Store/App оголошені через `const` у app-core.js — це global LEXICAL binding,
  // якого НЕМА як властивості window. Через це перевірка по window віддавала
  // undefined, me() -> null, і «Додати ідею» мовчки падало. Тому typeof-guard.
  function me() { return (typeof Store !== 'undefined' && Store.currentUser) ? Store.currentUser() : null; }
  function canVote() {
    var u = me();
    return !!u && VOTER_ROLES.indexOf(String(u.role)) !== -1;
  }

  async function load() {
    var client = sb();
    if (!client) { state.notes = []; state.votes = []; return; }
    var res = await Promise.all([
      client.from('hq_notes')
        .select('id,title,details,author_id,status,created_at')
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      client.from('hq_note_votes').select('note_id,voter_id,vote,comment,voted_at')
    ]);
    if (res[0].error) throw res[0].error;
    state.notes = res[0].data || [];
    state.votes = res[1].error ? [] : (res[1].data || []);
  }

  // ---------------------------------------------------------------
  // Рендер
  // ---------------------------------------------------------------
  function statusBadge(st) {
    if (st === 'approved') return '<span class="note-badge nb-approved">Схвалено</span>';
    if (st === 'rejected') return '<span class="note-badge nb-rejected">Відхилено</span>';
    return '<span class="note-badge nb-pending">На розгляді</span>';
  }

  function voteCell(note, voter, myId, editable) {
    var v = state.votes.find(function (x) { return x.note_id === note.id && x.voter_id === voter.id; });
    var isOk = v && v.vote === 'approve';
    var isNo = v && v.vote === 'reject';
    var short = String(voter.name || '').split(' ')[0];

    if (!editable || voter.id !== myId) {
      var ico = !v ? '⏳ чекаємо' : (isOk ? '✅ Апрув' : '❌ Відхилено');
      return '<div class="vote-col"><div class="vote-name">' + esc(short) + '</div>' +
             '<div class="vote-static">' + ico + '</div></div>';
    }
    // Свій голос — клікабельний. Inline onclick + глобальна функція (див. правило
    // про критичні кнопки: делеговані/повторні binding'и вже ламали кліки в HQ).
    return '<div class="vote-col"><div class="vote-name">' + esc(short) + ' · ти</div>' +
      '<div class="vote-btns">' +
        '<button type="button" class="' + (isOk ? 'on-ok' : '') + '" title="Апрув"' +
          ' onclick="hqNotesVote(\'' + note.id + '\',\'approve\')">✅</button>' +
        '<button type="button" class="' + (isNo ? 'on-no' : '') + '" title="Відхилено"' +
          ' onclick="hqNotesVote(\'' + note.id + '\',\'reject\')">❌</button>' +
      '</div></div>';
  }

  function noteRow(note, users, myId, editable, myUser) {
    var author = users.find(function (u) { return u.id === note.author_id; });
    var d = new Date(note.created_at);
    var date = ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
    var canDelete = myUser && (myUser.id === note.author_id || myUser.role === 'ceo' || myUser.role === 'coo');

    return '<div class="note-row st-' + esc(note.status) + '">' +
      '<div class="note-main">' +
        '<div class="note-title">' + esc(note.title) + '</div>' +
        '<div class="note-meta">' + statusBadge(note.status) +
          '<span>' + esc(author ? author.name : '—') + '</span><span>' + date + '</span>' +
          (canDelete ? '<button type="button" class="note-del" title="Прибрати зі списку"' +
            ' onclick="hqNotesDelete(\'' + note.id + '\')">🗑</button>' : '') +
        '</div>' +
      '</div>' +
      '<div class="note-votes">' +
        voters().map(function (v) { return voteCell(note, v, myId, editable); }).join('') +
      '</div>' +
    '</div>';
  }

  function paint() {
    var root = document.getElementById('main');
    if (!root || (typeof App !== 'undefined' && App.view !== 'notes')) return;
    var host = document.getElementById('notesList');
    if (!host) return;

    var users = (typeof Store !== 'undefined' && Store.users) ? Store.users() : [];
    var myUser = me();
    var myId = myUser ? myUser.id : null;
    var editable = canVote();

    var rows = state.notes.filter(function (n) {
      return state.filter === 'all' ? true : n.status === state.filter;
    });

    if (!rows.length) {
      host.innerHTML = '<div class="notes-empty">' +
        (state.filter === 'pending'
          ? 'Немає ідей на розгляді. Додай першу — поле вище.'
          : 'Тут поки порожньо.') + '</div>';
    } else {
      host.innerHTML = rows.map(function (n) { return noteRow(n, users, myId, editable, myUser); }).join('');
    }

    var cnt = document.getElementById('notesCount');
    if (cnt) cnt.textContent = '· ' + rows.length + ' з ' + state.notes.length;
  }

  async function renderNotes(root) {
    injectCss();
    root.innerHTML =
      '<div class="view-header">' +
        '<h1>📝 Нотатки</h1>' +
        '<span class="view-meta" id="notesCount">· завантаження…</span>' +
      '</div>' +
      '<div class="notes-wrap">' +
        '<div class="notes-add">' +
          '<textarea id="noteInput" placeholder="Ідея для реалізації… (Ctrl+Enter — додати)" maxlength="500"></textarea>' +
          '<button type="button" class="btn-add" onclick="hqNotesAdd()">+ Додати ідею</button>' +
        '</div>' +
        '<div class="notes-seg" id="notesSeg">' +
          FILTERS.map(function (f) {
            return '<button type="button" data-f="' + f.id + '"' +
              (state.filter === f.id ? ' class="on"' : '') + '>' + f.label + '</button>';
          }).join('') +
        '</div>' +
        '<div id="notesList"><div class="notes-empty">Завантаження…</div></div>' +
      '</div>';

    var seg = document.getElementById('notesSeg');
    seg.onclick = function (e) {
      var b = e.target.closest('button[data-f]');
      if (!b) return;
      state.filter = b.dataset.f;
      seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      paint();
    };

    var ta = document.getElementById('noteInput');
    ta.onkeydown = function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); window.hqNotesAdd(); }
    };

    try {
      await load();
      paint();
    } catch (e) {
      console.error('[hq-notes] load', e);
      document.getElementById('notesList').innerHTML =
        '<div class="notes-empty">Не вдалось завантажити нотатки: ' + esc(e.message || e) + '</div>';
    }
  }

  // ---------------------------------------------------------------
  // Дії (глобальні — викликаються з inline onclick)
  // ---------------------------------------------------------------
  window.hqNotesAdd = async function () {
    if (state.saving) return;
    var ta = document.getElementById('noteInput');
    var btn = document.querySelector('.notes-add .btn-add');
    if (!ta) return;
    var title = (ta.value || '').trim();
    if (!title) { say('Спочатку впиши ідею', 'error'); ta.focus(); return; }

    var u = me();
    if (!u) { say('Не видно, хто ти — перезайди в HQ', 'error'); return; }

    state.saving = true;
    if (btn) btn.disabled = true;
    try {
      var r = await sb().from('hq_notes').insert({ title: title, author_id: u.id }).select().single();
      if (r.error) throw r.error;
      ta.value = '';
      state.notes.unshift(r.data);
      if (state.filter !== 'pending' && state.filter !== 'all') state.filter = 'pending';
      paint(); refreshBadge();
      say('Ідею додано — Вадим, Артем і Давид отримали сповіщення');
    } catch (e) {
      console.error('[hq-notes] add', e);
      say('Не вдалось додати: ' + (e.message || e), 'error');
    } finally {
      state.saving = false;
      if (btn) btn.disabled = false;
    }
  };

  window.hqNotesVote = async function (noteId, vote) {
    if (state.saving) return;
    var u = me();
    if (!u) return;
    if (!canVote()) { say('Голосувати можуть Вадим, Артем і Давид', 'error'); return; }

    var prev = state.votes.find(function (x) { return x.note_id === noteId && x.voter_id === u.id; });
    // Повторний клік по тій самій кнопці — знімаємо свій голос
    var undo = prev && prev.vote === vote;

    state.saving = true;
    try {
      if (undo) {
        var d = await sb().from('hq_note_votes').delete().eq('note_id', noteId).eq('voter_id', u.id);
        if (d.error) throw d.error;
        state.votes = state.votes.filter(function (x) { return !(x.note_id === noteId && x.voter_id === u.id); });
      } else {
        var r = await sb().from('hq_note_votes')
          .upsert({ note_id: noteId, voter_id: u.id, vote: vote, voted_at: new Date().toISOString() },
                  { onConflict: 'note_id,voter_id' })
          .select().single();
        if (r.error) throw r.error;
        state.votes = state.votes.filter(function (x) { return !(x.note_id === noteId && x.voter_id === u.id); });
        state.votes.push(r.data);
      }
      // статус перерахував тригер — перечитуємо саме цей рядок
      var nr = await sb().from('hq_notes').select('id,title,details,author_id,status,created_at').eq('id', noteId).maybeSingle();
      if (!nr.error && nr.data) {
        var i = state.notes.findIndex(function (n) { return n.id === noteId; });
        if (i >= 0) state.notes[i] = nr.data;
      }
      paint(); refreshBadge();
      say(undo ? 'Голос знято' : (vote === 'approve' ? 'Апрув зараховано' : 'Відхилено зараховано'));
    } catch (e) {
      console.error('[hq-notes] vote', e);
      say('Не вдалось зберегти голос: ' + (e.message || e), 'error');
    } finally {
      state.saving = false;
    }
  };

  window.hqNotesDelete = async function (noteId) {
    var n = state.notes.find(function (x) { return x.id === noteId; });
    if (!n) return;
    if (!confirm('Прибрати ідею «' + n.title.slice(0, 80) + '» зі списку?')) return;
    try {
      var r = await sb().from('hq_notes').update({ deleted_at: new Date().toISOString() }).eq('id', noteId);
      if (r.error) throw r.error;
      state.notes = state.notes.filter(function (x) { return x.id !== noteId; });
      paint(); refreshBadge();
      say('Прибрано');
    } catch (e) {
      console.error('[hq-notes] delete', e);
      say('Не вдалось прибрати: ' + (e.message || e), 'error');
    }
  };

  // ---------------------------------------------------------------
  // Лічильник «на розгляді» у лівому меню
  // ---------------------------------------------------------------
  async function refreshBadge() {
    var el = document.getElementById('navCntNotes');
    if (!el || !sb()) return;
    try {
      var r = await sb().from('hq_notes')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null).eq('status', 'pending');
      if (!r.error) el.textContent = String(r.count || 0);
    } catch (e) { /* badge — не критично */ }
  }
  window.hqNotesRefreshBadge = refreshBadge;

  // Перший підрахунок — коли Store вже піднявся
  setTimeout(refreshBadge, 2500);

  window.renderNotes = renderNotes;

  if (window.DEBUG) console.log('%cDreamCar HQ %c· Нотатки завантажено', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
})();
