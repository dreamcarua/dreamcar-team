/* Бібліотека креативів v2 (08.10.2026) — один модуль замість шарів латок.
 * Повністю володіє renderLibrary / renderLibGrid / openCreative (завантажується останнім).
 * Модель: ПАПКА = лише проєкт (ліва панель). Усе інше — фільтри: тип, використання, автор,
 * акція (стрічка з плану проєкту), формат, «визначено за датою», можливі дублі, пошук.
 * Групування за днями (Київ), вибір сортування, масові дії, стан у localStorage.
 * Дані: rpc library_data() (усі файли, без ліміту 1000), зміни: rpc library_bulk(ids, patch).
 * Повторні navigate() після realtime перемальовують з кешу без втрати фільтрів і прокрутки.
 */
(function () {
  'use strict';
  if (window.__dcLibV2) return;
  window.__dcLibV2 = true;

  var LS = 'dc-lib-v2';
  var FMT = { stories: 'Сторіс', reels: 'Рілс', post: 'Пост', carousel: 'Карусель' };
  var SORTS = [['new', 'Нові спочатку'], ['old', 'Старі спочатку'], ['used', 'Нещодавно використані'], ['name', 'Назва'], ['size', 'Розмір'], ['dur', 'Тривалість відео']];
  var ST = {
    data: null, at: 0, loading: null, err: null,
    project: null, type: 'all', use: 'all', author: 'all', event: null, format: null, guess: false, dups: false,
    q: '', scope: 'project', sort: 'new', showOld: false, sel: {}, selN: 0, lastId: null, order: [], dirty: false
  };
  (function restore() {
    try {
      var s = JSON.parse(localStorage.getItem(LS) || '{}');
      ['project', 'type', 'use', 'author', 'sort', 'scope'].forEach(function (k) { if (s[k] != null) ST[k] = s[k]; });
    } catch (_) {}
  })();
  function persist() {
    try { localStorage.setItem(LS, JSON.stringify({ project: ST.project, type: ST.type, use: ST.use, author: ST.author, sort: ST.sort, scope: ST.scope })); } catch (_) {}
  }

  // ───────── утиліти ─────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function kyivDay(ts) {
    if (!ts) return '0000-00-00';
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts)); }
    catch (_) { return String(ts).slice(0, 10); }
  }
  var TODAY = function () { return kyivDay(new Date().toISOString()); };
  function dmy(d) { var p = String(d).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function dm(d) { if (!d) return ''; var p = String(d).slice(0, 10).split('-'); return p[2] + '.' + p[1]; }
  function dayTitle(d) {
    var t = TODAY(), y = kyivDay(new Date(Date.now() - 864e5).toISOString());
    if (d === t) return 'Сьогодні · ' + dm(d);
    if (d === y) return 'Вчора · ' + dm(d);
    if (d === '0000-00-00') return 'Без дати';
    return dmy(d);
  }
  function hsize(b) { if (!b) return '—'; var u = ['Б', 'КБ', 'МБ', 'ГБ'], i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return (b >= 10 || i === 0 ? Math.round(b) : b.toFixed(1)) + ' ' + u[i]; }
  function hdur(s) { if (!s) return ''; var m = Math.floor(s / 60), ss = s % 60; return m + ':' + String(ss).padStart(2, '0'); }
  function initials(name) { return String(name || '?').split(/\s+/).map(function (w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); }
  function normName(n) { return String(n || '').toLowerCase().replace(/\s*\(\d+\)(?=\.[a-z0-9]+$|$)/, '').replace(/-corrected(?=\.)/, ''); }
  function isSb(u) { return u && u.indexOf('.supabase.co/storage/v1/object/public/') > 0; }
  // Supabase image transform: стискає і конвертує HEIC → JPEG; розмір + режим обов'язкові, інакше ламаються пропорції
  function thumbUrl(u, w, mode) { w = w || 360; return isSb(u) ? u.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + (u.indexOf('?') > 0 ? '&' : '?') + 'width=' + w + '&height=' + w + '&resize=' + (mode || 'cover') + '&quality=' + (w > 600 ? 75 : 60) : u; }
  function isImgUrl(u) { return /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(u || ''); }
  function toastOk(t, m) { try { toast(t, 'success', m || ''); } catch (_) {} }
  function toastErr(t, m) { try { toast(t, 'error', m || ''); } catch (_) { alert(t + ': ' + m); } }

  // ───────── дані ─────────
  function load(force) {
    if (!force && ST.data && !ST.dirty && Date.now() - ST.at < 15000) return Promise.resolve(ST.data);
    if (ST.loading) return ST.loading;
    ST.loading = window.supabase.rpc('library_data').then(function (r) {
      ST.loading = null;
      if (r.error) { ST.err = r.error.message; return ST.data; }
      var d = r.data || {};
      var users = {}; (d.users || []).forEach(function (u) { users[u.id] = u.name; });
      var L = {}; (d.launches || []).forEach(function (l) { L[l.id] = l; });
      var E = {}; (d.events || []).forEach(function (e) { E[e.id] = e; });
      var items = (d.items || []).map(function (a) {
        return {
          id: a[0], name: a[1] || '', type: a[2], size: a[3], dur: a[4], w: a[5], h: a[6], at: a[7], by: a[8],
          l: a[9], e: a[10] != null ? Number(a[10]) : null, f: a[11], src: a[12], used: a[13] || 0, lastUsed: a[14],
          poster: a[15], thumb: a[16], comp: a[17], hevc: a[18], tags: a[19] || [], day: kyivDay(a[7]), norm: normName(a[1])
        };
      });
      // можливі дублі: однакова нормалізована назва + розмір
      var seen = {}; items.forEach(function (it) { var k = it.norm + '|' + it.size; (seen[k] = seen[k] || []).push(it); });
      Object.keys(seen).forEach(function (k) { if (seen[k].length > 1) seen[k].forEach(function (it) { it.dup = seen[k].length; }); });
      var byId = {}; items.forEach(function (it) { byId[it.id] = it; });
      ST.data = { items: items, byId: byId, L: L, E: E, launches: d.launches || [], events: d.events || [], users: users,
        me: d.me, can_edit: !!d.can_edit, can_delete: !!d.can_delete };
      ST.at = Date.now(); ST.dirty = false; ST.err = null;
      var nav = $('navCntLibrary'); if (nav) { nav.textContent = items.length; nav.dataset.lbTotal = items.length; }
      // прибрати з вибору зниклі
      Object.keys(ST.sel).forEach(function (id) { if (!byId[id]) delete ST.sel[id]; });
      ST.selN = Object.keys(ST.sel).length;
      return ST.data;
    }, function (e) { ST.loading = null; ST.err = String(e && e.message || e); return ST.data; });
    return ST.loading;
  }

  function defaultProject(d) {
    if (ST.project && (ST.project === '__all' || ST.project === '__none' || d.L[ST.project])) return ST.project;
    var raf = d.launches.filter(function (l) { return l.kind === 'raffle'; });
    var act = raf.filter(function (l) { return l.status === 'active'; })[0] || raf.filter(function (l) { return l.status === 'planning'; })[0] || raf[0];
    return act ? act.id : '__all';
  }

  // ───────── фільтри ─────────
  function inProject(it) {
    if (ST.project === '__all') return true;
    if (ST.project === '__none') return !it.l;
    return it.l === ST.project;
  }
  function matchQ(it, q) {
    if (!q) return true;
    var ev = it.e && ST.data.E[it.e];
    return (it.name + ' ' + (it.tags || []).join(' ') + ' ' + (ev ? ev.title : '')).toLowerCase().indexOf(q) >= 0;
  }
  function pass(it, skip) {
    var q = ST.q.trim().toLowerCase();
    if (!(q && ST.scope === 'all') && !inProject(it)) return false;
    if (skip !== 'type' && ST.type !== 'all' && it.type !== ST.type) return false;
    if (skip !== 'use' && ST.use === 'unused' && it.used > 0) return false;
    if (skip !== 'use' && ST.use === 'used' && !it.used) return false;
    if (skip !== 'author' && ST.author !== 'all' && (ST.author === 'me' ? it.by !== ST.data.me : it.by !== ST.author)) return false;
    if (skip !== 'event' && ST.event !== null && (ST.event === 'none' ? !!it.e : it.e !== ST.event)) return false;
    if (skip !== 'format' && ST.format !== null && (ST.format === 'none' ? !!it.f : it.f !== ST.format)) return false;
    if (skip !== 'guess' && ST.guess && it.src !== 'upload_window') return false;
    if (skip !== 'dups' && ST.dups && !it.dup) return false;
    if (!matchQ(it, q)) return false;
    return true;
  }
  function sortItems(list) {
    var by = {
      new: function (a, b) { return (b.at || '').localeCompare(a.at || '') || a.id.localeCompare(b.id); },
      old: function (a, b) { return (a.at || '').localeCompare(b.at || '') || a.id.localeCompare(b.id); },
      used: function (a, b) { return (b.lastUsed || '').localeCompare(a.lastUsed || '') || (b.at || '').localeCompare(a.at || ''); },
      name: function (a, b) { return a.name.localeCompare(b.name, 'uk', { numeric: true }); },
      size: function (a, b) { return (b.size || 0) - (a.size || 0); },
      dur: function (a, b) { return (b.dur || 0) - (a.dur || 0); }
    }[ST.sort] || null;
    return list.slice().sort(by);
  }
  function countBy(skip, fn) { var n = 0; ST.data.items.forEach(function (it) { if (pass(it, skip) && fn(it)) n++; }); return n; }

  // ───────── каркас ─────────
  function shellHtml() {
    return '<div class="view-header lb-head"><h1>Бібліотека креативів</h1><span class="view-meta" id="lbMeta"></span>' +
      '<div class="actions"><button class="btn" id="libUpload" onclick="dcLib2.upload()">📁 Завантажити</button></div></div>' +
      '<div class="library-wrap lb-wrap">' +
      '<aside class="lb-side" id="lbSide"></aside>' +
      '<section class="lb-main">' +
      '<div class="lb-mproj"><select id="lbProjSel" onchange="dcLib2.project(this.value)"></select></div>' +
      '<div class="lb-phead" id="lbPHead"></div>' +
      '<div class="lb-promos" id="lbPromos"></div>' +
      '<div class="library-toolbar lb-tools">' +
      '<div class="segmented" id="libType"></div>' +
      '<div class="lb-chips" id="lbUse"></div>' +
      '<select class="lb-sel" id="lbAuthor" onchange="dcLib2.set(\'author\', this.value)"></select>' +
      '<select class="lb-sel" id="lbSort" onchange="dcLib2.set(\'sort\', this.value)"></select>' +
      '<input id="libSearch" placeholder="Пошук: назва, тег, акція…" oninput="dcLib2.search(this.value)"/>' +
      '</div>' +
      '<div class="lb-chips lb-more" id="lbMore"></div>' +
      '<div id="libGrid" class="lb-grid-wrap"></div>' +
      '</section></div>' +
      '<div class="lb-bulk" id="lbBulk"></div>';
  }

  function scrollBox() { var m = document.querySelector('.main'); return (m && m.scrollHeight > m.clientHeight + 4) ? m : (document.scrollingElement || document.documentElement); }

  window.renderLibrary = function (root) {
    root = root || $('main') || document.querySelector('.main');
    if (!root) return;
    var keep = $('libGrid') ? scrollBox().scrollTop : null;
    root.innerHTML = shellHtml();
    var paintAll = function () {
      if (!$('libGrid')) return;              // користувач уже пішов з бібліотеки
      if (!ST.data) { $('libGrid').innerHTML = '<div class="lb-empty">' + (ST.err ? '⚠ ' + esc(ST.err) : 'Завантажую файли…') + '</div>'; return; }
      ST.project = defaultProject(ST.data);
      paint();
      if (keep != null) { var b = scrollBox(); b.scrollTop = keep; keep = null; }
    };
    paintAll();
    load(false).then(paintAll);
  };
  window.renderLibGrid = function () { if (ST.data && $('libGrid')) paintGrid(); };

  function paint() {
    var s = $('libSearch'); if (s && s.value !== ST.q) s.value = ST.q;
    paintSide(); paintHead(); paintTools(); paintGrid(); paintBulk();
  }

  // ───────── ліва панель ─────────
  function projStats() {
    var st = {};
    ST.data.items.forEach(function (it) {
      var k = it.l || '__none';
      var o = st[k] || (st[k] = { n: 0, un: 0 });
      o.n++; if (!it.used) o.un++;
    });
    return st;
  }
  function paintSide() {
    var d = ST.data, st = projStats();
    var raf = d.launches.filter(function (l) { return l.kind === 'raffle'; });
    var oth = d.launches.filter(function (l) { return l.kind !== 'raffle' && st[l.id]; });
    var cutoff = kyivDay(new Date(Date.now() - 183 * 864e5).toISOString());
    var recent = raf.filter(function (l) { return ST.showOld || l.status === 'active' || l.status === 'planning' || !l.ends_on || l.ends_on >= cutoff || l.id === ST.project; });
    var hidden = raf.length - recent.length;
    function row(id, name, sub, s, dot) {
      return '<button class="lb-prow' + (ST.project === id ? ' on' : '') + '" onclick="dcLib2.project(\'' + id + '\')">' +
        (dot ? '<i class="lb-dot ' + dot + '"></i>' : '<i class="lb-dot"></i>') +
        '<span class="lb-pn">' + esc(name) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
        '<span class="lb-pc">' + (s ? s.n : 0) + (s && s.un ? '<small>' + s.un + ' нових</small>' : '') + '</span></button>';
    }
    function lrow(l) {
      var dates = l.starts_on ? dm(l.starts_on) + (l.ends_on && l.ends_on < '2040' ? '–' + dm(l.ends_on) : '') : '';
      return row(l.id, (l.cycle_no ? '#' + l.cycle_no + ' · ' : '') + l.name, dates, st[l.id], l.status === 'active' ? 'act' : l.status === 'planning' ? 'plan' : l.status === 'idea' ? 'idea' : 'done');
    }
    var h = '<div class="lb-sh">Розіграші</div>' + recent.map(lrow).join('') +
      (hidden ? '<button class="lb-more-btn" onclick="dcLib2.toggleOld()">Показати старіші · ' + hidden + '</button>' : '') +
      (ST.showOld && raf.length > recent.length ? '' : '') +
      (oth.length ? '<div class="lb-sh">Інше</div>' + oth.map(lrow).join('') : '') +
      '<div class="lb-sh">Усе</div>' +
      (st.__none ? row('__none', 'Без проєкту', '', st.__none) : '') +
      row('__all', 'Усі файли', '', { n: d.items.length, un: d.items.filter(function (i) { return !i.used; }).length });
    $('lbSide').innerHTML = h;
    // мобільний вибір
    var opts = raf.map(function (l) { return '<option value="' + l.id + '"' + (l.id === ST.project ? ' selected' : '') + '>' + esc((l.cycle_no ? '#' + l.cycle_no + ' · ' : '') + l.name) + ' · ' + ((st[l.id] || {}).n || 0) + '</option>'; }).join('') +
      oth.map(function (l) { return '<option value="' + l.id + '"' + (l.id === ST.project ? ' selected' : '') + '>' + esc(l.name) + ' · ' + st[l.id].n + '</option>'; }).join('') +
      (st.__none ? '<option value="__none"' + (ST.project === '__none' ? ' selected' : '') + '>Без проєкту · ' + st.__none.n + '</option>' : '') +
      '<option value="__all"' + (ST.project === '__all' ? ' selected' : '') + '>Усі файли · ' + d.items.length + '</option>';
    $('lbProjSel').innerHTML = opts;
  }

  // ───────── шапка проєкту + стрічка акцій ─────────
  function paintHead() {
    var d = ST.data, L = d.L[ST.project];
    var inP = d.items.filter(inProject);
    var un = inP.filter(function (i) { return !i.used; }).length;
    var gs = inP.filter(function (i) { return i.src === 'upload_window'; }).length;
    var title = ST.project === '__all' ? 'Усі файли' : ST.project === '__none' ? 'Без проєкту' : ((L.cycle_no ? '#' + L.cycle_no + ' · ' : '') + L.name);
    var sub = L && L.starts_on ? dmy(L.starts_on) + (L.ends_on && L.ends_on < '2040' ? ' → ' + dmy(L.ends_on) : '') : '';
    $('lbPHead').innerHTML = '<div class="lb-ptitle">' + esc(title) + (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</div>' +
      '<div class="lb-pstats">' + inP.length + ' файлів · <b>' + un + '</b> не використані' +
      (gs ? ' · <button class="lb-link" onclick="dcLib2.set(\'guess\', true)">≈ ' + gs + ' визначено за датою — перевір</button>' : '') + '</div>';
    $('lbMeta').textContent = '· ' + d.items.length + ' файлів';

    var evs = (L ? d.events.filter(function (e) { return e.launch_id === L.id; }) : []);
    if (!evs.length) { $('lbPromos').innerHTML = ''; return; }
    var cnt = {}, none = 0;
    d.items.forEach(function (it) { if (inProject(it) && pass(it, 'event')) { if (it.e) cnt[it.e] = (cnt[it.e] || 0) + 1; else none++; } });
    $('lbPromos').innerHTML = '<span class="lb-lbl">Акції:</span>' +
      '<button class="lb-chip' + (ST.event === null ? ' on' : '') + '" onclick="dcLib2.set(\'event\', null)">Усі</button>' +
      evs.map(function (e) {
        var n = cnt[e.id] || 0;
        return '<button class="lb-chip' + (ST.event === e.id ? ' on' : '') + (n ? '' : ' zero') + '" title="' + esc(e.title) + '" onclick="dcLib2.set(\'event\', ' + e.id + ')">' +
          esc(dm(e.day)) + ' ' + esc(e.title.length > 26 ? e.title.slice(0, 25) + '…' : e.title) + ' · ' + n + '</button>';
      }).join('') +
      '<button class="lb-chip' + (ST.event === 'none' ? ' on' : '') + '" onclick="dcLib2.set(\'event\', \'none\')">Без акції · ' + none + '</button>';
  }

  // ───────── панель інструментів ─────────
  function paintTools() {
    var d = ST.data;
    var types = [['all', 'Усі'], ['photo', 'Фото'], ['video', 'Відео'], ['doc', 'Документи']];
    $('libType').innerHTML = types.map(function (t) {
      var n = countBy('type', function (it) { return t[0] === 'all' || it.type === t[0]; });
      if (t[0] === 'doc' && !n) return '';
      return '<button class="btn-segmented' + (ST.type === t[0] ? ' on' : '') + '" data-type="' + t[0] + '" onclick="dcLib2.set(\'type\', \'' + t[0] + '\')">' + t[1] + ' <small>' + n + '</small></button>';
    }).join('');
    var uses = [['all', 'Усі'], ['unused', 'Не використані'], ['used', 'Використані']];
    $('lbUse').innerHTML = uses.map(function (u) {
      var n = countBy('use', function (it) { return u[0] === 'all' || (u[0] === 'used' ? it.used > 0 : !it.used); });
      return '<button class="lb-chip' + (ST.use === u[0] ? ' on' : '') + '" onclick="dcLib2.set(\'use\', \'' + u[0] + '\')">' + u[1] + ' · ' + n + '</button>';
    }).join('');
    var authors = {}; d.items.forEach(function (it) { if (inProject(it) && it.by) authors[it.by] = (authors[it.by] || 0) + 1; });
    $('lbAuthor').innerHTML = '<option value="all">Усі автори</option><option value="me"' + (ST.author === 'me' ? ' selected' : '') + '>Мої файли</option>' +
      Object.keys(authors).sort(function (a, b) { return authors[b] - authors[a]; }).map(function (id) {
        return '<option value="' + id + '"' + (ST.author === id ? ' selected' : '') + '>' + esc(d.users[id] || '—') + ' · ' + authors[id] + '</option>';
      }).join('');
    $('lbSort').innerHTML = SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (ST.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('');

    var fmtCnt = {}, fNone = 0;
    d.items.forEach(function (it) { if (pass(it, 'format')) { if (it.f) fmtCnt[it.f] = (fmtCnt[it.f] || 0) + 1; else fNone++; } });
    var g = countBy('guess', function (it) { return it.src === 'upload_window'; });
    var dp = countBy('dups', function (it) { return !!it.dup; });
    var q = ST.q.trim();
    var h = '<span class="lb-lbl">Формат:</span><button class="lb-chip' + (ST.format === null ? ' on' : '') + '" onclick="dcLib2.set(\'format\', null)">Усі</button>' +
      Object.keys(FMT).filter(function (k) { return fmtCnt[k]; }).map(function (k) {
        return '<button class="lb-chip' + (ST.format === k ? ' on' : '') + '" onclick="dcLib2.set(\'format\', \'' + k + '\')">' + FMT[k] + ' · ' + fmtCnt[k] + '</button>';
      }).join('') +
      (fNone ? '<button class="lb-chip' + (ST.format === 'none' ? ' on' : '') + '" title="Формат стає відомим, коли файл додано в публікацію" onclick="dcLib2.set(\'format\', \'none\')">Невідомо · ' + fNone + '</button>' : '') +
      '<span class="lb-sep"></span>' +
      ((g || ST.guess) ? '<button class="lb-chip' + (ST.guess ? ' on' : '') + '" title="Проєкт визначено автоматично за датою завантаження" onclick="dcLib2.set(\'guess\', ' + !ST.guess + ')">≈ За датою · ' + g + '</button>' : '') +
      ((dp || ST.dups) ? '<button class="lb-chip' + (ST.dups ? ' on' : '') + '" title="Однакова назва (без «(1)») і розмір" onclick="dcLib2.set(\'dups\', ' + !ST.dups + ')">Можливі дублі · ' + dp + '</button>' : '') +
      (q ? '<span class="lb-sep"></span><button class="lb-chip' + (ST.scope === 'project' ? ' on' : '') + '" onclick="dcLib2.set(\'scope\', \'project\')">У проєкті</button>' +
        '<button class="lb-chip' + (ST.scope === 'all' ? ' on' : '') + '" onclick="dcLib2.set(\'scope\', \'all\')">Шукати всюди</button>' : '') +
      (activeFilters() ? '<button class="lb-link" onclick="dcLib2.reset()">Скинути фільтри</button>' : '');
    $('lbMore').innerHTML = h;
  }
  function activeFilters() { return ST.type !== 'all' || ST.use !== 'all' || ST.author !== 'all' || ST.event !== null || ST.format !== null || ST.guess || ST.dups || !!ST.q.trim(); }

  // ───────── сітка ─────────
  function tileHtml(it) {
    var d = ST.data, ev = it.e && d.E[it.e];
    var src = it.type === 'video' ? (it.poster || (isImgUrl(it.thumb) ? it.thumb : '')) : (it.thumb || it.comp || '');
    var heic = /\.hei[cf]$/i.test(src || '');
    var img = src && (!heic || isSb(src)) ? '<img src="' + esc(thumbUrl(src, 360)) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '';
    var badge = it.type === 'video' ? '▶' : it.type === 'doc' ? 'DOC' : '';
    var path = '';
    if (ST.scope === 'all' && ST.q.trim()) { var L = it.l && d.L[it.l]; path = (L ? L.name : 'Без проєкту') + (ev ? ' › ' + ev.title : ''); }
    var sel = !!ST.sel[it.id];
    return '<div class="lb-tile' + (sel ? ' sel' : '') + (it.src === 'upload_window' ? ' guess' : '') + '" data-id="' + it.id + '" onclick="dcLib2.tile(event, \'' + it.id + '\')">' +
      '<div class="lb-prev">' + img +
      '<span class="lb-ph">' + (it.type === 'video' ? '🎬' : it.type === 'doc' ? '📄' : '🖼️') + '</span>' +
      (badge ? '<span class="lb-badge">' + badge + '</span>' : '') +
      (it.dur ? '<span class="lb-dur">' + hdur(it.dur) + '</span>' : '') +
      (it.used ? '<span class="lb-used" title="Використано в публікаціях: ' + it.used + '">✓' + it.used + '</span>' : '') +
      (it.src === 'upload_window' ? '<span class="lb-guess" title="Проєкт визначено за датою завантаження">≈</span>' : '') +
      (it.dup ? '<span class="lb-dupb" title="Можливий дубль">×' + it.dup + '</span>' : '') +
      '<label class="lb-check" onclick="event.stopPropagation()"><input type="checkbox"' + (sel ? ' checked' : '') + ' onclick="dcLib2.check(event, \'' + it.id + '\')"></label>' +
      '</div>' +
      '<div class="lb-info"><div class="lb-name" title="' + esc(it.name) + '">' + esc(it.name) + '</div>' +
      '<div class="lt-meta">' + esc(hsize(it.size)) + (it.w && it.h ? ' · ' + it.w + '×' + it.h : '') +
      (it.f ? ' · ' + FMT[it.f] : '') + ' · <span title="' + esc(d.users[it.by] || '') + '">' + esc(initials(d.users[it.by])) + '</span></div>' +
      (path ? '<div class="lt-meta lb-path">' + esc(path) + '</div>' : (ev ? '<div class="lt-meta lb-path">' + esc(ev.title) + '</div>' : '')) +
      '</div></div>';
  }

  function paintGrid() {
    var box = $('libGrid'); if (!box || !ST.data) return;
    var list = sortItems(ST.data.items.filter(function (it) { return pass(it); }));
    ST.order = list.map(function (it) { return it.id; });
    if (!list.length) {
      var q = ST.q.trim(), msg;
      if (q && ST.scope === 'project') {
        var elsewhere = ST.data.items.filter(function (it) { return matchQ(it, q.toLowerCase()); }).length;
        msg = 'У цьому проєкті нічого не знайдено.' + (elsewhere ? ' <button class="lb-link" onclick="dcLib2.set(\'scope\', \'all\')">Знайдено ' + elsewhere + ' в інших — показати</button>' : '');
      } else if (activeFilters()) msg = 'Немає файлів під ці фільтри. <button class="lb-link" onclick="dcLib2.reset()">Скинути фільтри</button>';
      else msg = 'Тут ще немає файлів. <button class="lb-link" onclick="dcLib2.upload()">Завантажити</button> — вони одразу потраплять у цей проєкт.';
      box.innerHTML = '<div class="lb-empty">' + msg + '</div>';
      return;
    }
    var grouped = ST.sort === 'new' || ST.sort === 'old';
    var h = '';
    if (grouped) {
      var cur = null, buf = [];
      var flush = function () {
        if (!buf.length) return;
        var allSel = buf.every(function (it) { return ST.sel[it.id]; });
        h += '<div class="lb-day"><label class="lb-dayh"><input type="checkbox"' + (allSel ? ' checked' : '') + ' onclick="dcLib2.selDay(\'' + cur + '\', this.checked)">' +
          '<b>' + esc(dayTitle(cur)) + '</b><span>' + buf.length + '</span></label><div class="lb-grid">' + buf.map(tileHtml).join('') + '</div></div>';
        buf = [];
      };
      list.forEach(function (it) { if (it.day !== cur) { flush(); cur = it.day; } buf.push(it); });
      flush();
    } else {
      h = '<div class="lb-grid">' + list.map(tileHtml).join('') + '</div>';
    }
    box.innerHTML = h;
  }

  // ───────── вибір і масові дії ─────────
  function paintBulk() {
    var bar = $('lbBulk'); if (!bar) return;
    var n = ST.selN, d = ST.data;
    if (!n || !d) { bar.className = 'lb-bulk'; bar.innerHTML = ''; return; }
    var ids = Object.keys(ST.sel);
    var used = ids.filter(function (id) { return d.byId[id] && d.byId[id].used; }).length;
    var L = d.L[ST.project];
    var evs = L ? d.events.filter(function (e) { return e.launch_id === L.id; }) : [];
    var raf = d.launches.slice().sort(function (a, b) { return String(b.starts_on || '').localeCompare(String(a.starts_on || '')); });
    var h = '<b>Вибрано ' + n + '</b>';
    if (d.can_edit) {
      h += '<select onchange="dcLib2.bulk({launch_id: this.value}); this.selectedIndex = 0"><option value="">Перенести в проєкт…</option>' +
        raf.map(function (l) { return '<option value="' + l.id + '">' + esc((l.cycle_no ? '#' + l.cycle_no + ' · ' : '') + l.name) + '</option>'; }).join('') +
        '<option value="__null">Без проєкту</option></select>';
      if (evs.length) h += '<select onchange="dcLib2.bulk({ad_event_id: this.value}); this.selectedIndex = 0"><option value="">Акція…</option>' +
        evs.map(function (e) { return '<option value="' + e.id + '">' + esc(dm(e.day) + ' · ' + e.title) + '</option>'; }).join('') + '<option value="__null">Без акції</option></select>';
      h += '<select onchange="dcLib2.bulk({format: this.value}); this.selectedIndex = 0"><option value="">Формат…</option>' +
        Object.keys(FMT).map(function (k) { return '<option value="' + k + '">' + FMT[k] + '</option>'; }).join('') + '<option value="__null">Невідомо</option></select>';
      h += '<button class="btn btn-sm" onclick="dcLib2.bulk({confirm: true})" title="Підтвердити, що файли в правильному проєкті">✓ Підтвердити проєкт</button>';
    }
    h += '<button class="btn btn-sm" onclick="dcLib2.downloadSel()">⬇ Скачати' + (n > 20 ? ' (перші 20)' : '') + '</button>';
    if (d.can_edit) h += '<button class="btn btn-sm btn-danger" id="lbDelBtn" onclick="dcLib2.del()">Видалити' + (used ? ' (' + used + ' у публікаціях)' : '') + '</button>';
    h += '<button class="btn btn-sm" onclick="dcLib2.clearSel()">Скасувати</button>';
    bar.className = 'lb-bulk on'; bar.innerHTML = h;
  }
  function setSel(id, on) { if (on) ST.sel[id] = 1; else delete ST.sel[id]; }
  function refreshSel() {
    ST.selN = Object.keys(ST.sel).length;
    document.querySelectorAll('.lb-tile').forEach(function (t) {
      var on = !!ST.sel[t.dataset.id]; t.classList.toggle('sel', on);
      var cb = t.querySelector('.lb-check input'); if (cb) cb.checked = on;
    });
    document.querySelectorAll('.lb-dayh input').forEach(function (cb) {
      var grid = cb.closest('.lb-day').querySelectorAll('.lb-tile');
      cb.checked = grid.length > 0 && [].every.call(grid, function (t) { return ST.sel[t.dataset.id]; });
    });
    var w = $('libGrid'); if (w) w.classList.toggle('selecting', ST.selN > 0);
    paintBulk();
  }

  async function runBulk(patch) {
    var ids = Object.keys(ST.sel);
    if (!ids.length) return;
    Object.keys(patch).forEach(function (k) { if (patch[k] === '__null') patch[k] = ''; });
    if (patch.launch_id === undefined && patch.ad_event_id === undefined && patch.format === undefined && !patch.confirm && !patch.delete) return;
    var r = await window.supabase.rpc('library_bulk', { p_ids: ids, p: patch });
    if (r.error) { toastErr('Не вдалося', r.error.message); return; }
    toastOk(patch.delete ? 'Видалено' : 'Збережено', (r.data && r.data.n) + ' файл(ів)');
    if (patch.delete) { ST.sel = {}; ST.selN = 0; try { Store._data.creatives = Store._data.creatives.filter(function (c) { return ids.indexOf(c.id) < 0; }); } catch (_) {} }
    ST.dirty = true;
    await load(true);
    if ($('libGrid')) paint();
  }

  function dlUrl(it) { return it.type === 'video' ? (it.comp || it.hevc || it.poster) : (it.comp || it.thumb); }
  async function download(it) {
    var url = dlUrl(it); if (!url) return false;
    var clean = String(url).split('?')[0]; var ext = (clean.split('.').pop() || '').toLowerCase(); if (ext.length > 5) ext = '';
    var base = String(it.name || 'creative').replace(/[\/\\?%*:|"<>]/g, '_');
    var fname = /\.[a-z0-9]{2,5}$/i.test(base) ? base : base + (ext ? '.' + ext : '');
    try {
      var resp = await fetch(url, { mode: 'cors' }); if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var blob = await resp.blob(), obj = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = obj; a.download = fname; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(obj); a.remove(); }, 2000);
      return true;
    } catch (e) { try { window.open(url, '_blank'); } catch (_) {} return false; }
  }

  // ───────── модалка файлу ─────────
  window.openCreative = function (id) {
    var d = ST.data, it = d && d.byId[id];
    if (!it) { load(true).then(function () { if (ST.data && ST.data.byId[id]) window.openCreative(id); }); return; }
    var L = it.l && d.L[it.l], ev = it.e && d.E[it.e];
    var vsrc = it.comp || it.hevc;
    var media = it.type === 'video' && vsrc
      ? '<video src="' + esc(vsrc) + '" controls playsinline preload="metadata" poster="' + esc(it.poster || '') + '"></video>'
      : (it.thumb || it.comp) && (!/\.hei[cf]$/i.test(it.thumb || '') || isSb(it.thumb)) ? '<img src="' + esc(thumbUrl(it.thumb || it.comp, 1600, 'contain')) + '" alt="">'
        : '<span style="font-size:64px">' + (it.type === 'video' ? '🎬' : '🖼️') + '</span>';
    var pubs = [];
    try { pubs = Store.pubs().filter(function (p) { return (p.creatives || []).indexOf(id) >= 0; }); } catch (_) {}
    var srcTxt = it.src === 'upload_window' ? '≈ визначено за датою завантаження' : it.src === 'publication' ? 'з публікації' : it.src === 'manual' ? 'підтверджено вручну' : '';
    var raf = d.launches.slice().sort(function (a, b) { return String(b.starts_on || '').localeCompare(String(a.starts_on || '')); });
    var h = '<div class="modal-head"><h2>' + esc(it.name) + '</h2><span class="modal-meta">' + esc(it.type) + ' · ' + esc(hsize(it.size)) +
      (it.w ? ' · ' + it.w + '×' + it.h : '') + (it.dur ? ' · ' + hdur(it.dur) : '') + '</span><button class="close" onclick="Modal.close()">×</button></div>' +
      '<div class="modal-body"><div class="lb-mprev">' + media + '</div>' +
      '<div class="lb-mgrid"><div><h4>Інформація</h4>' +
      '<div>👤 ' + esc(d.users[it.by] || '—') + ' · 📅 ' + esc(it.at ? new Date(it.at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—') + '</div>' +
      ((it.tags || []).length ? '<div>🏷️ ' + esc(it.tags.map(function (t) { return '#' + t; }).join(' ')) + '</div>' : '') +
      '<div>📁 ' + esc(L ? L.name : 'Без проєкту') + (ev ? ' › ' + esc(ev.title) : '') + (it.f ? ' › ' + FMT[it.f] : '') + (srcTxt ? ' <i class="lb-src">(' + srcTxt + ')</i>' : '') + '</div>' +
      (it.dup ? '<div>⚠ Схоже на дубль (' + it.dup + ' файли з такою назвою і розміром)</div>' : '') +
      '</div><div><h4>Використовується в публікаціях (' + it.used + ')</h4>' +
      (pubs.length ? pubs.map(function (p) { return '<a class="lb-pub" href="#publication/' + p.id + '" onclick="Modal.close()">' + esc(p.title) + ' <small>· ' + esc(typeof fmtDate === 'function' ? fmtDate(p.dateTime) : '') + '</small></a>'; }).join('')
        : (it.used ? '<div class="lb-src">Публікації за межами завантаженого періоду</div>' : '<div class="lb-src">Ще не використано</div>')) +
      '</div></div>';
    if (d.can_edit) {
      h += '<div class="lb-assign"><select id="lbAsL" onchange="dcLib2.modalEv()"><option value="">Без проєкту</option>' +
        raf.map(function (l) { return '<option value="' + l.id + '"' + (l.id === it.l ? ' selected' : '') + '>' + esc((l.cycle_no ? '#' + l.cycle_no + ' · ' : '') + l.name) + '</option>'; }).join('') + '</select>' +
        '<select id="lbAsE"></select><select id="lbAsF"><option value="">Формат невідомий</option>' +
        Object.keys(FMT).map(function (k) { return '<option value="' + k + '"' + (k === it.f ? ' selected' : '') + '>' + FMT[k] + '</option>'; }).join('') + '</select>' +
        '<button class="btn btn-sm" onclick="dcLib2.modalSave(\'' + id + '\')">Зберегти</button>' +
        (it.src === 'upload_window' ? '<button class="btn btn-sm" onclick="dcLib2.modalConfirm(\'' + id + '\')">✓ Проєкт правильний</button>' : '') + '</div>';
    }
    h += '</div><div class="modal-foot"><button class="btn" onclick="dcLib2.dl(\'' + id + '\')">⬇ Завантажити оригінал</button>' +
      '<button class="btn btn-danger" onclick="Modal.close()">Закрити</button></div>';
    Modal.open(h);
    if (d.can_edit) { window.dcLib2.modalEv(); var se = $('lbAsE'); if (se && it.e) se.value = String(it.e); }
  };

  // ───────── завантаження у поточний проєкт ─────────
  async function upload() {
    if (typeof uploadCreativeFile !== 'function') { toastErr('Завантаження не готове', 'Онови сторінку'); return; }
    var target = (ST.project && ST.project.indexOf('__') !== 0) ? ST.project : null;
    var fi = document.createElement('input'); fi.type = 'file'; fi.multiple = true; fi.accept = 'image/*,video/*,application/pdf,.heic,.heif';
    fi.onchange = async function () {
      var files = [].slice.call(fi.files || []); if (!files.length) return;
      var t0 = new Date(Date.now() - 5000).toISOString();
      for (var i = 0; i < files.length; i++) { try { await uploadCreativeFile(files[i], null); } catch (e) { console.warn('[lib upload]', files[i].name, e); } }
      await load(true);
      if (target && ST.data) {
        var fresh = ST.data.items.filter(function (it) { return it.by === ST.data.me && it.at >= t0 && it.l !== target; }).map(function (it) { return it.id; });
        if (fresh.length) await window.supabase.rpc('library_bulk', { p_ids: fresh, p: { launch_id: target } });
        await load(true);
      }
      toastOk('Завантажено', files.length + ' файл(ів)');
      if ($('libGrid')) paint();
    };
    fi.click();
  }

  // ───────── публічний API (inline onclick) ─────────
  window.dcLib2 = {
    project: function (id) { ST.project = id; ST.event = null; ST.format = null; ST.guess = false; ST.dups = false; persist(); paint(); var b = scrollBox(); b.scrollTop = 0; },
    set: function (k, v) {
      ST[k] = v; if (k === 'sort' || k === 'type' || k === 'use' || k === 'author' || k === 'scope') persist();
      paintHead(); paintTools(); paintGrid(); refreshSel();
    },
    search: function (v) {
      clearTimeout(ST._qt);
      ST._qt = setTimeout(function () { ST.q = v || ''; paintHead(); paintTools(); paintGrid(); refreshSel(); }, 220);
    },
    reset: function () { ST.type = 'all'; ST.use = 'all'; ST.author = 'all'; ST.event = null; ST.format = null; ST.guess = false; ST.dups = false; ST.q = ''; persist(); paint(); },
    toggleOld: function () { ST.showOld = !ST.showOld; paintSide(); },
    tile: function (e, id) {
      if (ST.selN > 0 || e.shiftKey || e.metaKey || e.ctrlKey) { window.dcLib2.check(e, id, true); return; }
      window.openCreative(id);
    },
    check: function (e, id, fromTile) {
      if (e && e.stopPropagation) e.stopPropagation();
      var on = !ST.sel[id];
      if (e && e.shiftKey && ST.lastId && ST.order.indexOf(ST.lastId) >= 0) {
        var a = ST.order.indexOf(ST.lastId), b = ST.order.indexOf(id);
        var lo = Math.min(a, b), hi = Math.max(a, b);
        var target = !!ST.sel[ST.lastId];
        for (var i = lo; i <= hi; i++) setSel(ST.order[i], target);
      } else setSel(id, on);
      ST.lastId = id;
      refreshSel();
    },
    selDay: function (day, on) {
      ST.data.items.forEach(function (it) { if (it.day === day && ST.order.indexOf(it.id) >= 0) setSel(it.id, on); });
      refreshSel();
    },
    clearSel: function () { ST.sel = {}; refreshSel(); },
    bulk: function (patch) { runBulk(patch); },
    del: function () {
      var b = $('lbDelBtn');
      if (b && !b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Точно видалити ' + ST.selN + '?'; return; }
      runBulk({ delete: true });
    },
    downloadSel: async function () {
      var ids = Object.keys(ST.sel).slice(0, 20);
      for (var i = 0; i < ids.length; i++) { var it = ST.data.byId[ids[i]]; if (it) { await download(it); await new Promise(function (r) { setTimeout(r, 400); }); } }
    },
    dl: function (id) { var it = ST.data && ST.data.byId[id]; if (it) download(it); },
    upload: upload,
    modalEv: function () {
      var l = ($('lbAsL') || {}).value, sel = $('lbAsE'); if (!sel) return;
      var evs = ST.data.events.filter(function (e) { return e.launch_id === l; });
      sel.innerHTML = '<option value="">Без акції</option>' + evs.map(function (e) { return '<option value="' + e.id + '">' + esc(dm(e.day) + ' · ' + e.title) + '</option>'; }).join('');
    },
    modalSave: async function (id) {
      var patch = { launch_id: $('lbAsL').value || '', ad_event_id: $('lbAsE').value || '', format: $('lbAsF').value || '' };
      var r = await window.supabase.rpc('library_bulk', { p_ids: [id], p: patch });
      if (r.error) { toastErr('Не вдалося', r.error.message); return; }
      toastOk('Збережено'); try { Modal.close(); } catch (_) {}
      await load(true); if ($('libGrid')) paint();
    },
    modalConfirm: async function (id) {
      var r = await window.supabase.rpc('library_bulk', { p_ids: [id], p: { confirm: true } });
      if (r.error) { toastErr('Не вдалося', r.error.message); return; }
      toastOk('Підтверджено'); try { Modal.close(); } catch (_) {}
      await load(true); if ($('libGrid')) paint();
    }
  };
  // сумісність зі старою розміткою (app-library-folders більше не підключається)
  window.dcLib = window.dcLib || { go: function (id) { window.dcLib2.project(id || '__all'); } };

  // гарячі клавіші: Esc — зняти вибір, Ctrl/Cmd+A — вибрати все видиме
  document.addEventListener('keydown', function (e) {
    if (!$('libGrid') || document.querySelector('#modalBackdrop.show, .modal-backdrop.show')) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape' && ST.selN) { window.dcLib2.clearSel(); }
    if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); ST.order.forEach(function (id) { ST.sel[id] = 1; }); refreshSel(); }
  });

  // realtime: позначаємо дані застарілими; navigate() сам перемалює, ми підтягнемо свіже
  (function rt(tries) {
    if (!(window.supabase && window.supabase.channel)) { if (tries < 100) setTimeout(function () { rt(tries + 1); }, 500); return; }
    try {
      window.supabase.channel('lib-v2')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'creatives' }, function () { ST.dirty = true; })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'creative_publications' }, function () { ST.dirty = true; })
        .subscribe();
    } catch (_) {}
  })(0);

  function css() {
    if ($('lb-css')) return;
    var st = document.createElement('style'); st.id = 'lb-css';
    st.textContent = [
      '.lb-wrap{display:grid;grid-template-columns:250px minmax(0,1fr);gap:18px;align-items:start}.lb-main{min-width:0}',
      '.lb-side{position:sticky;top:12px;max-height:calc(100vh - 120px);overflow:auto;display:flex;flex-direction:column;gap:2px;padding-right:4px}',
      '.lb-sh{font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:var(--grey,#888);margin:12px 8px 4px;font-weight:700}',
      '.lb-prow{display:grid;grid-template-columns:10px 1fr auto;gap:8px;align-items:center;text-align:left;padding:7px 8px;border-radius:8px;border:1px solid transparent;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}',
      '.lb-prow:hover{background:var(--bg-3,#1b1b1b)}.lb-prow.on{background:var(--bg-3,#1b1b1b);border-color:#E30613}',
      '.lb-pn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lb-pn small,.lb-pc small{display:block;font-size:10px;color:var(--grey,#888)}',
      '.lb-pc{text-align:right;font-size:12px}.lb-pc small{color:#34d399}',
      '.lb-dot{width:8px;height:8px;border-radius:50%;background:#555}.lb-dot.act{background:#E30613}.lb-dot.plan{background:#f59e0b}.lb-dot.idea{background:#60a5fa}.lb-dot.done{background:#666}',
      '.lb-more-btn,.lb-link{background:none;border:0;color:#FF6A7A;font:inherit;font-size:12px;cursor:pointer;padding:6px 8px;text-align:left}',
      '.lb-mproj{display:none;margin-bottom:10px}.lb-mproj select,.lb-sel{background:var(--bg-3,#1b1b1b);border:1px solid var(--border,#2a2a2a);color:inherit;padding:7px 10px;border-radius:8px;font:inherit;font-size:13px}',
      '.lb-mproj select{width:100%;font-size:15px;font-weight:700;padding:10px}',
      '.lb-phead{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:baseline;margin-bottom:8px}.lb-ptitle{font-size:18px;font-weight:800}.lb-ptitle small{font-size:12px;font-weight:400;color:var(--grey,#888)}.lb-pstats{font-size:13px;color:var(--grey,#888)}.lb-pstats b{color:#34d399}',
      '.lb-promos,.lb-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.lb-promos{margin-bottom:10px;flex-wrap:nowrap;overflow-x:auto;padding-bottom:4px}',
      '.lb-chip{white-space:nowrap;padding:5px 10px;border-radius:999px;border:1px solid var(--border,#2a2a2a);background:var(--bg-2,#141414);color:inherit;font:inherit;font-size:12px;cursor:pointer}',
      '.lb-chip.on{background:#E30613;border-color:#E30613;color:#fff}.lb-chip.zero{opacity:.5}',
      '.lb-lbl{font-size:12px;color:var(--grey,#888)}.lb-sep{width:1px;height:18px;background:var(--border,#2a2a2a);margin:0 4px}',
      '.lb-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}.lb-tools #libSearch{box-sizing:border-box;flex:1;min-width:180px;max-width:320px;background:var(--bg-3,#1b1b1b);border:1px solid var(--border,#2a2a2a);color:inherit;padding:7px 12px;border-radius:8px;font-size:13px}',
      '#libType small{opacity:.6;margin-left:3px}.lb-more{margin-bottom:12px}',
      '.lb-day{margin-bottom:18px}.lb-dayh{position:sticky;top:0;z-index:3;display:flex;align-items:center;gap:8px;padding:8px 2px;background:var(--bg,#0a0a0a);font-size:13px;cursor:pointer}.lb-dayh span{color:var(--grey,#888)}',
      '.lb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
      '.lb-tile{position:relative;cursor:pointer;background:var(--bg-2,#141414);border:1px solid var(--border,#2a2a2a);border-radius:10px;overflow:hidden;transition:border-color .12s}.lb-tile:hover{border-color:rgba(227,6,19,.6)}.lb-info{padding:7px 8px}.lb-name{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lb-info .lt-meta{font-size:11px;color:var(--grey,#888);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lb-tile.sel{outline:2px solid #E30613;outline-offset:2px;border-radius:10px}',
      '.lb-prev{position:relative;overflow:hidden;aspect-ratio:1/1;background:var(--bg-3,#1b1b1b);display:flex;align-items:center;justify-content:center}',
      '.lb-prev img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1}.lb-ph{font-size:30px;opacity:.5}',
      '.lb-badge,.lb-used,.lb-guess,.lb-dupb{position:absolute;z-index:2;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.65);color:#fff}',
      '.lb-badge{left:6px;bottom:6px}.lb-used{right:6px;top:6px;background:rgba(16,185,129,.85)}.lb-guess{left:6px;top:6px;background:rgba(245,158,11,.85)}.lb-dupb{right:6px;bottom:6px;background:rgba(227,6,19,.8)}',
      '.lb-dur{position:absolute;right:6px;bottom:6px;z-index:2;font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.65);color:#fff}.lb-dupb{bottom:auto;top:28px}',
      '.lb-check{position:absolute;left:6px;top:28px;z-index:3;opacity:0;transition:opacity .12s}.lb-check input{width:18px;height:18px;accent-color:#E30613;cursor:pointer}',
      '.lb-tile:hover .lb-check,.lb-tile.sel .lb-check,.selecting .lb-check{opacity:1}',
      '.lb-path{color:#FF6A7A !important;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.lb-empty{padding:40px 10px;text-align:center;color:var(--grey,#888);font-size:14px}',
      '.lb-bulk{display:none}.lb-bulk.on{display:flex;position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9000;gap:8px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);padding:10px 12px;border-radius:12px;background:var(--bg-2,#141414);border:1px solid #E30613;box-shadow:0 8px 30px rgba(0,0,0,.5);font-size:13px}',
      '.lb-bulk select{background:var(--bg-3,#1b1b1b);border:1px solid var(--border,#2a2a2a);color:inherit;padding:6px 8px;border-radius:7px;font:inherit;font-size:12px;max-width:190px}',
      '.lb-mprev{background:#000;border-radius:10px;min-height:220px;max-height:62vh;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:14px}.lb-mprev img,.lb-mprev video{max-width:100%;max-height:62vh;object-fit:contain}',
      '.lb-mgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;font-size:13px}.lb-mgrid h4{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey,#888);margin-bottom:8px}.lb-mgrid>div>div{margin-bottom:6px}',
      '.lb-pub{display:block;background:var(--bg-3,#1b1b1b);border:1px solid var(--border,#2a2a2a);border-radius:6px;padding:7px 10px;margin-bottom:6px;font-size:12px;color:inherit;text-decoration:none}',
      '.lb-src{color:var(--grey,#888);font-style:normal;font-size:12px}',
      '.lb-assign{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--border,#2a2a2a)}.lb-assign select{background:var(--bg-3,#1b1b1b);border:1px solid var(--border,#2a2a2a);color:inherit;padding:7px 9px;border-radius:7px;font:inherit;font-size:13px;max-width:220px}',
      '@media (max-width:900px){.lb-wrap{grid-template-columns:minmax(0,1fr)}.lb-tools .lb-sel{flex:1 1 140px;min-width:0}.lb-tools .lb-chips{flex-wrap:nowrap;overflow-x:auto;max-width:100%}.lb-more{flex-wrap:nowrap;overflow-x:auto}.lb-ptitle{font-size:16px}.lb-side{display:none}.lb-mproj{display:block}.lb-grid{grid-template-columns:repeat(3,1fr);gap:6px}.lb-tools #libSearch{max-width:none;min-width:100%}.lb-mgrid{grid-template-columns:1fr}.lb-check{opacity:1}.lb-info .lt-meta{display:none}.lb-info .lb-path{display:block}}',
      'html[data-dc-theme="light"] .lb-dayh{background:#fafafa}html[data-dc-theme="light"] .lb-chip:not(.on){background:#fff;color:#0a0a0a}'
    ].join('\n');
    document.head.appendChild(st);
  }
  css();
  // core.js оновлює #navCntLibrary з Store (обрізаний лімітом 1000) — повертаємо справжню кількість
  setInterval(function () { var n = $('navCntLibrary'); if (n && n.dataset.lbTotal && n.textContent !== n.dataset.lbTotal) n.textContent = n.dataset.lbTotal; }, 3000);

  // якщо бібліотека вже відкрита на момент завантаження модуля — перемалювати
  if (location.hash.indexOf('#library') === 0 && $('libGrid') && !$('lbSide')) {
    try { window.renderLibrary($('main') || document.querySelector('.main')); } catch (_) {}
  }
})();
