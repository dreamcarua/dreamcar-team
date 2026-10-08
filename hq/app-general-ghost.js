/* GENERAL → SMM-календар (08.10.2026)
 * Показує акції з плану проєкту (team.dreamcar.ua/general/) на плитках днів SMM-календаря,
 * щоб SMM бачив, під яку акцію робити контент. Неінвазивно: app-core.js не змінюється,
 * MutationObserver на #calBody дописує смужку у .cal-day / .week-col з data-date.
 * Дані: rpc general_day_promos(from, to) — без фінансів, роль перевіряє БД (media → порожньо).
 */
(function () {
  'use strict';
  if (window.__dcGeneralGhost) return;
  window.__dcGeneralGhost = true;

  var byDay = {};          // 'YYYY-MM-DD' → [{launch_id, launch_name, audience, kind, title, event_id}]
  var loadedAt = 0, loading = false, obs = null, painting = false;
  var AUD = { all: { l: 'Акція', c: '#E30613' }, retention: { l: 'Ретеншн', c: '#3b82f6' }, fortunatos: { l: 'Fortunatos', c: '#a855f7' } };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  async function load() {
    if (loading || !window.supabase || !window.supabase.rpc) return;
    loading = true;
    try {
      var from = new Date(); from.setDate(from.getDate() - 70);
      var to = new Date(); to.setDate(to.getDate() + 200);
      var r = await window.supabase.rpc('general_day_promos', { p_from: ymd(from), p_to: ymd(to) });
      if (!r.error) {
        var m = {};
        (r.data || []).forEach(function (x) { (m[x.day] = m[x.day] || []).push(x); });
        byDay = m;
        loadedAt = Date.now();
        paint(true);
      }
    } catch (e) { console.warn('[general-ghost]', e); }
    loading = false;
  }

  function pillHtml(list, compact) {
    var shown = list.slice(0, compact ? 2 : 4);
    var h = shown.map(function (x) {
      var a = AUD[x.audience] || AUD.all;
      return '<div class="gg-pill" style="border-left-color:' + a.c + '" title="' + esc(a.l + ' · ' + x.launch_name + ' · ' + x.title) + '"' +
        ' onclick="event.stopPropagation();window.dcGeneralOpen(\'' + x.launch_id + '\',\'' + x.day + '\')">' +
        '<span class="gg-a" style="color:' + a.c + '">' + esc(a.l) + '</span> ' + esc(x.title) + '</div>';
    }).join('');
    if (list.length > shown.length) h += '<div class="gg-more">+' + (list.length - shown.length) + ' акц.</div>';
    return '<div class="gg-wrap">' + h + '</div>';
  }

  function paint(force) {
    var body = document.getElementById('calBody');
    if (!body || painting) return;
    painting = true;
    try {
      body.querySelectorAll('.cal-day[data-date], .week-col[data-date]').forEach(function (cell) {
        var day = cell.getAttribute('data-date');
        var list = byDay[day] || [];
        var cur = cell.querySelector(':scope > .gg-wrap');
        var sig = list.map(function (x) { return x.event_id; }).join(',');
        if (cur && !force && cur.getAttribute('data-sig') === sig) return;
        if (cur) cur.remove();
        if (!list.length) return;
        var holder = document.createElement('div');
        holder.innerHTML = pillHtml(list, cell.classList.contains('cal-day'));
        var node = holder.firstChild;
        node.setAttribute('data-sig', sig);
        var head = cell.querySelector(':scope > .day-num, :scope > .col-head');
        if (head && head.nextSibling) cell.insertBefore(node, head.nextSibling);
        else cell.appendChild(node);
      });
    } finally { painting = false; }
  }

  window.dcGeneralOpen = function (launchId, day) {
    window.open('/projects/?d=' + day + '#project/' + encodeURIComponent(launchId), '_blank', 'noopener');
  };

  function css() {
    if (document.getElementById('gg-css')) return;
    var st = document.createElement('style');
    st.id = 'gg-css';
    st.textContent =
      '.gg-wrap{display:flex;flex-direction:column;gap:2px;margin:2px 0 4px}' +
      '.gg-pill{font-size:10px;line-height:1.25;padding:2px 5px;border-left:3px solid #E30613;border-radius:4px;background:rgba(227,6,19,.08);' +
      'color:rgba(255,255,255,.85);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '.gg-pill:hover{background:rgba(227,6,19,.16)}' +
      '.gg-a{font-weight:800;text-transform:uppercase;letter-spacing:.04em;font-size:9px}' +
      '.gg-more{font-size:9px;color:rgba(255,255,255,.5);padding-left:4px}' +
      '.week-col .gg-pill{white-space:normal;font-size:11px;padding:4px 6px}' +
      'html[data-dc-theme="light"] .gg-pill{color:#0a0a0a;background:rgba(227,6,19,.06)}' +
      'html[data-dc-theme="light"] .gg-more{color:#6b6b73}';
    document.head.appendChild(st);
  }

  function watch() {
    var body = document.getElementById('calBody');
    if (!body) return false;
    if (obs) obs.disconnect();
    obs = new MutationObserver(function () { if (!painting) paint(false); });
    obs.observe(body, { childList: true });
    paint(false);
    return true;
  }

  function boot() {
    css();
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (window.supabase && window.supabase.rpc && !loadedAt) load();
      // #calBody перестворюється при переході між розділами HQ — переприв'язуємось
      var body = document.getElementById('calBody');
      if (body && (!obs || !body.__ggWatched)) { body.__ggWatched = true; watch(); }
      if (loadedAt && Date.now() - loadedAt > 10 * 60 * 1000) load();
      if (tries > 100000) clearInterval(t);
    }, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
