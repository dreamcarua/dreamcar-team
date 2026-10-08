/* Бібліотека креативів: папки Проєкт → Акція → Формат (08.10.2026)
 * Рішення Вадима: папки по проєктах, активний/наступний угорі, завершені — в «Архів»;
 * всередині проєкту — акції з плану проєкту, далі формат (Сторіс/Рілс/Пост/Карусель), далі Фото/Відео.
 * Неінвазивно: обгортає window.renderLibrary / window.renderLibGrid / window.openCreative.
 * Дані: rpc library_folders() (мапа креатив → проєкт/акція/формат), перенос: rpc library_assign().
 */
(function () {
  'use strict';
  if (window.__dcLibFolders) return;
  window.__dcLibFolders = true;

  var F = { data: null, at: 0, loading: null, launch: null, event: null, format: null, archive: false };
  var FMT = { stories: 'Сторіс', reels: 'Рілс', post: 'Пост', carousel: 'Карусель' };
  var NONE = '__none__';

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dm(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p[2] + '.' + p[1]; }
  function S() { try { return Store; } catch (_) { return window.Store; } }

  function load(force) {
    if (!force && F.data && Date.now() - F.at < 5 * 60 * 1000) return Promise.resolve(F.data);
    if (F.loading) return F.loading;
    F.loading = window.supabase.rpc('library_folders').then(function (r) {
      F.loading = null;
      if (r.error) { console.warn('[lib-folders]', r.error); return F.data; }
      var d = r.data || {};
      d.byId = {};
      (d.map || []).forEach(function (m) { d.byId[m[0]] = { l: m[1], e: m[2], f: m[3], src: m[4] }; });
      d.launchById = {}; (d.launches || []).forEach(function (l) { d.launchById[l.id] = l; });
      d.eventById = {}; (d.events || []).forEach(function (e) { d.eventById[e.id] = e; });
      F.data = d; F.at = Date.now();
      return d;
    });
    return F.loading;
  }

  function inFolder(c) {
    var d = F.data; if (!d) return true;
    var m = d.byId[c.id] || {};
    if (F.launch === null) { if (!F.archive) return true; var L = m.l && d.launchById[m.l]; return !!(L && L.archived); }
    if (F.launch === NONE) { if (m.l) return false; }
    else if (m.l !== F.launch) return false;
    if (F.event !== null) { if (F.event === NONE ? !!m.e : m.e !== F.event) return false; }
    if (F.format !== null) { if (F.format === NONE ? !!m.f : m.f !== F.format) return false; }
    return true;
  }

  function counts() {
    var d = F.data, all = S().creatives(), byL = {}, byE = {}, byF = {}, none = 0;
    all.forEach(function (c) {
      var m = d.byId[c.id] || {};
      if (!m.l) { none++; return; }
      byL[m.l] = (byL[m.l] || 0) + 1;
      if (m.l === F.launch) {
        var ek = m.e || NONE; byE[ek] = (byE[ek] || 0) + 1;
        if (F.event === null || (F.event === NONE ? !m.e : m.e === F.event)) { var fk = m.f || NONE; byF[fk] = (byF[fk] || 0) + 1; }
      }
    });
    return { byL: byL, byE: byE, byF: byF, none: none };
  }

  function folderTile(onclick, title, sub, n, cls) {
    return '<button class="lf-tile ' + (cls || '') + '" onclick="' + onclick + '"><span class="lf-ico">📁</span><span class="lf-t">' + esc(title) + '</span>' +
      (sub ? '<span class="lf-s">' + esc(sub) + '</span>' : '') + '<span class="lf-n">' + n + '</span></button>';
  }

  function renderBar() {
    var bar = document.getElementById('libFolders');
    if (!bar) return;
    var d = F.data;
    if (!d) { bar.innerHTML = '<div class="lf-muted">Завантажую папки…</div>'; return; }
    var cnt = counts(), h = '';
    // хлібні крихти
    var crumbs = ['<a href="javascript:void 0" onclick="dcLib.go(null)">Усі файли</a>'];
    if (F.archive && F.launch === null) crumbs.push('<b>Архів</b>');
    if (F.launch === NONE) crumbs.push('<b>Без проєкту</b>');
    else if (F.launch) {
      var L = d.launchById[F.launch] || { name: '?' };
      if (L.archived) crumbs.push('<a href="javascript:void 0" onclick="dcLib.archive()">Архів</a>');
      crumbs.push(F.event === null ? '<b>' + esc(L.name) + '</b>' : '<a href="javascript:void 0" onclick="dcLib.go(\'' + F.launch + '\')">' + esc(L.name) + '</a>');
      if (F.event !== null) crumbs.push('<b>' + (F.event === NONE ? 'Без акції' : esc(((d.eventById[F.event] || {}).title) || '?')) + '</b>');
    }
    h += '<div class="lf-crumbs">' + crumbs.join(' <span>›</span> ') + '</div>';

    if (F.launch === null) {
      var list = (d.launches || []).filter(function (l) { return F.archive ? l.archived : !l.archived; });
      list.sort(function (a, b) {
        var ar = a.kind === 'raffle' ? 0 : 1, br = b.kind === 'raffle' ? 0 : 1;
        if (ar !== br) return ar - br;
        return String(b.starts_on || '').localeCompare(String(a.starts_on || ''));
      });
      h += '<div class="lf-grid">' + list.map(function (l) {
        var sub = l.starts_on ? dm(l.starts_on) + (l.ends_on && l.ends_on < '2040' ? '–' + dm(l.ends_on) : '') : '';
        var tag = l.status === 'active' ? 'зараз' : l.status === 'planning' ? 'наступний' : '';
        return folderTile("dcLib.go('" + l.id + "')", (l.cycle_no ? '#' + l.cycle_no + ' · ' : '') + l.name, [tag, sub].filter(Boolean).join(' · '), cnt.byL[l.id] || 0, tag ? 'hot' : '');
      }).join('') +
        (!F.archive ? folderTile('dcLib.archive()', 'Архів', 'завершені проєкти', (d.launches || []).filter(function (l) { return l.archived; }).reduce(function (s, l) { return s + (cnt.byL[l.id] || 0); }, 0), 'arch') : '') +
        (!F.archive && cnt.none ? folderTile("dcLib.go('" + NONE + "')", 'Без проєкту', '', cnt.none, 'arch') : '') +
        '</div>';
    } else if (F.launch !== NONE) {
      var evs = (d.events || []).filter(function (e) { return e.launch_id === F.launch; });
      if (F.event === null) {
        h += '<div class="lf-grid">' + evs.filter(function (e) { return cnt.byE[e.id]; }).map(function (e) {
          return folderTile('dcLib.ev(' + e.id + ')', e.title, dm(e.day) + (e.audience !== 'all' ? ' · ' + (e.audience === 'retention' ? 'ретеншн' : 'Fortunatos') : ''), cnt.byE[e.id]);
        }).join('') + (cnt.byE[NONE] ? folderTile("dcLib.ev('" + NONE + "')", 'Без акції', 'загальні матеріали проєкту', cnt.byE[NONE], 'arch') : '') + '</div>';
      }
      // формат
      var fk = Object.keys(FMT).filter(function (k) { return cnt.byF[k]; });
      h += '<div class="lf-fmt"><span class="lf-muted">Формат:</span>' +
        '<button class="lf-chip' + (F.format === null ? ' on' : '') + '" onclick="dcLib.fmt(null)">Усі</button>' +
        fk.map(function (k) { return '<button class="lf-chip' + (F.format === k ? ' on' : '') + '" onclick="dcLib.fmt(\'' + k + '\')">' + FMT[k] + ' · ' + cnt.byF[k] + '</button>'; }).join('') +
        (cnt.byF[NONE] ? '<button class="lf-chip' + (F.format === NONE ? ' on' : '') + '" onclick="dcLib.fmt(\'' + NONE + '\')">Без формату · ' + cnt.byF[NONE] + '</button>' : '') +
        '</div>';
    }
    bar.innerHTML = h;
  }

  function regrid() {
    var seg = document.querySelector('#libType .btn-segmented.on');
    var q = document.getElementById('libSearch');
    if (typeof window.renderLibGrid === 'function') window.renderLibGrid(seg ? seg.dataset.type : 'all', q ? q.value : '');
  }

  window.dcLib = {
    go: function (id) { F.launch = id; F.event = null; F.format = null; if (id === null) F.archive = false; renderBar(); regrid(); },
    archive: function () { F.archive = true; F.launch = null; F.event = null; F.format = null; renderBar(); regrid(); },
    ev: function (id) { F.event = id; F.format = null; renderBar(); regrid(); },
    fmt: function (k) { F.format = k; renderBar(); regrid(); },
    assign: async function (cid) {
      var l = document.getElementById('lfAsL').value || null;
      var e = document.getElementById('lfAsE').value || null;
      var f = document.getElementById('lfAsF').value || null;
      var r = await window.supabase.rpc('library_assign', { p_ids: [cid], p_launch: l, p_event: e ? Number(e) : null, p_format: f });
      if (r.error) { if (typeof toast === 'function') toast('Папка', 'error', r.error.message); return; }
      if (typeof toast === 'function') toast('Перенесено', 'success', '');
      await load(true); renderBar(); regrid();
      var box = document.getElementById('lfAssign'); if (box) box.querySelector('.lf-ok').textContent = '✓ збережено';
    },
    syncEv: function () {
      var l = document.getElementById('lfAsL').value, sel = document.getElementById('lfAsE');
      var evs = (F.data.events || []).filter(function (e) { return e.launch_id === l; });
      sel.innerHTML = '<option value="">Без акції</option>' + evs.map(function (e) { return '<option value="' + e.id + '">' + esc(dm(e.day) + ' · ' + e.title) + '</option>'; }).join('');
    }
  };

  function css() {
    if (document.getElementById('lf-css')) return;
    var st = document.createElement('style'); st.id = 'lf-css';
    st.textContent =
      '#libFolders{margin:0 0 14px}' +
      '.lf-crumbs{font-size:13px;color:var(--grey,#888);margin-bottom:10px}.lf-crumbs a{color:#FF6A7A;text-decoration:none}.lf-crumbs b{color:#fff}.lf-crumbs span{opacity:.5;margin:0 4px}' +
      '.lf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:10px}' +
      '.lf-tile{display:grid;grid-template-columns:auto 1fr auto;grid-template-rows:auto auto;column-gap:8px;align-items:center;text-align:left;padding:10px 12px;border-radius:10px;border:1px solid var(--border,#2a2a2a);background:var(--bg-2,#141414);color:#fff;cursor:pointer;font:inherit}' +
      '.lf-tile:hover{border-color:#E30613}.lf-tile.hot{border-color:rgba(227,6,19,.55)}.lf-tile.arch{opacity:.8}' +
      '.lf-ico{grid-row:1/3;font-size:20px}.lf-t{font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lf-s{grid-column:2;font-size:11px;color:var(--grey,#888)}.lf-n{grid-row:1/3;grid-column:3;font-size:12px;color:var(--grey,#888)}' +
      '.lf-fmt{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px}.lf-muted{font-size:12px;color:var(--grey,#888)}' +
      '.lf-chip{padding:5px 10px;border-radius:999px;border:1px solid var(--border,#2a2a2a);background:var(--bg-2,#141414);color:#fff;font:inherit;font-size:12px;cursor:pointer}.lf-chip.on{background:#E30613;border-color:#E30613}' +
      '#lfAssign{margin-top:14px;padding:12px;border:1px solid var(--border,#2a2a2a);border-radius:10px;display:grid;gap:8px}#lfAssign select{background:var(--bg-3,#1b1b1b);border:1px solid var(--border,#2a2a2a);color:#fff;padding:7px 9px;border-radius:7px;font:inherit;font-size:13px}' +
      '#lfAssign .row{display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px}@media(max-width:640px){#lfAssign .row{grid-template-columns:1fr}}' +
      'html[data-dc-theme="light"] .lf-tile,html[data-dc-theme="light"] .lf-chip:not(.on){background:#fff;color:#0a0a0a}html[data-dc-theme="light"] .lf-crumbs b{color:#0a0a0a}';
    document.head.appendChild(st);
  }

  function patch() {
    if (typeof window.renderLibrary !== 'function' || typeof window.renderLibGrid !== 'function' || typeof window.openCreative !== 'function') return false;
    if (window.renderLibrary.__lf) return true;
    css();
    var origLib = window.renderLibrary, origGrid = window.renderLibGrid, origOpen = window.openCreative;

    window.renderLibrary = function (root) {
      origLib.apply(this, arguments);
      var wrap = document.querySelector('.library-wrap');
      if (wrap && !document.getElementById('libFolders')) {
        var bar = document.createElement('div'); bar.id = 'libFolders';
        wrap.insertBefore(bar, wrap.firstChild);
      }
      renderBar();
      load(false).then(function () { renderBar(); regrid(); });
    };
    window.renderLibrary.__lf = true;

    window.renderLibGrid = function (type, q) {
      var st = S();
      if (!F.data || (F.launch === null && !F.archive)) return origGrid.apply(this, arguments);
      var orig = st.creatives;
      try {
        var filtered = orig.call(st).filter(inFolder);
        st.creatives = function () { return filtered; };
        return origGrid.apply(this, arguments);
      } finally { st.creatives = orig; }
    };

    window.openCreative = function (id) {
      origOpen.apply(this, arguments);
      var d = F.data; if (!d) return;
      var body = document.querySelector('.modal-body'); if (!body) return;
      var m = d.byId[id] || {};
      var L = m.l && d.launchById[m.l], E = m.e && d.eventById[m.e];
      var h = '<div id="lfAssign"><div class="lf-muted">📁 Папка: <b style="color:inherit">' + esc(L ? L.name : 'Без проєкту') + (E ? ' › ' + esc(E.title) : '') +
        (m.f ? ' › ' + FMT[m.f] : '') + '</b>' + (m.src === 'upload_window' ? ' <i>(визначено за датою завантаження)</i>' : '') + ' <span class="lf-ok"></span></div>';
      if (d.can_assign) {
        var ls = (d.launches || []).slice().sort(function (a, b) { return (a.archived - b.archived) || String(b.starts_on || '').localeCompare(String(a.starts_on || '')); });
        h += '<div class="row"><select id="lfAsL" onchange="dcLib.syncEv()"><option value="">Без проєкту</option>' +
          ls.map(function (l) { return '<option value="' + l.id + '"' + (l.id === m.l ? ' selected' : '') + '>' + esc((l.archived ? '🗄 ' : '') + l.name) + '</option>'; }).join('') + '</select>' +
          '<select id="lfAsE"></select>' +
          '<select id="lfAsF"><option value="">Без формату</option>' + Object.keys(FMT).map(function (k) { return '<option value="' + k + '"' + (k === m.f ? ' selected' : '') + '>' + FMT[k] + '</option>'; }).join('') + '</select>' +
          '<button class="btn btn-sm" onclick="dcLib.assign(\'' + id + '\')">Перенести</button></div>';
      }
      h += '</div>';
      body.insertAdjacentHTML('beforeend', h);
      if (d.can_assign) {
        window.dcLib.syncEv();
        if (m.e) { var se = document.getElementById('lfAsE'); if (se) se.value = String(m.e); }
      }
    };
    return true;
  }

  var tries = 0;
  (function wait() {
    if (patch()) {
      if (location.hash.indexOf('#library') === 0 && document.querySelector('.library-wrap') && !document.getElementById('libFolders')) {
        try { window.renderLibrary(document.getElementById('main')); } catch (_) {}
      }
      return;
    }
    if (++tries < 200) setTimeout(wait, 150);
  })();
})();
