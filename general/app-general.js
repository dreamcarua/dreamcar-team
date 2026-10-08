/* GENERAL — план проєкту (08.10.2026)
 * Одне джерело правди: public.ad_events (+ launch_landings, launch_banners, launch_day_marks).
 * Усі дані йдуть через RPC general_* (SECURITY DEFINER, ролі перевіряє БД).
 * Час: сервер віддає локальний київський рядок 'YYYY-MM-DDTHH:MM' і сирий timestamptz.
 * Фінансів тут немає і бути не повинно.
 */
(function () {
  'use strict';

  var S = { launches: [], launchId: null, plan: null, aud: 'any', log: null, logOpen: false, timer: null };
  var LS_KEY = 'dc-general-launch';

  var AUD = {
    all:        { label: 'Загальна',   cls: 'a-all' },
    retention:  { label: 'Ретеншн',    cls: 'a-ret' },
    fortunatos: { label: 'Fortunatos', cls: 'a-fort' }
  };
  var KIND = {
    launch: 'Старт', offer: 'Офер', x2: '×2', final: 'Фінал', live: 'Ефір', promo: 'Акція',
    mailing: 'Розсилка', handover: 'Вручення', shoot: 'Зйомка', other: 'Інше'
  };
  var CH = { viber: 'Viber', bot: 'Бот', tg: 'Бот', email: 'Email', push: 'Push', sms: 'SMS', instagram: 'Instagram', other: 'Інше' };
  var ROLE = { main: 'Основний', vip: 'VIP', fortunatos: 'Fortunatos', preview: 'Тестовий', ab_variant: 'A/B', other: 'Інший' };
  var BSTAT = { pending: 'Очікує погодження', approved: 'Погоджено', live: 'На сайті' };
  var WD = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var MON = ['січ', 'лют', 'бер', 'кві', 'тра', 'чер', 'лип', 'сер', 'вер', 'жов', 'лис', 'гру'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function sb() { return window.supabase; }

  // 'YYYY-MM-DD' → '09.10 · пт'
  function dayLabel(d) {
    var p = d.split('-');
    var wd = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return p[2] + '.' + p[1] + ' · ' + WD[wd];
  }
  function dmy(d) { if (!d) return '—'; var p = d.slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function hm(local) { return local ? local.slice(11, 16) : ''; }
  function dtl(local) { if (!local) return '—'; return dmy(local) + ' ' + hm(local); }
  function inRange(day, a, b) { return day >= a && day <= b; }

  function toast(msg, bad) {
    var t = $('gToast');
    t.textContent = msg;
    t.className = 'g-toast show' + (bad ? ' bad' : '');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.className = 'g-toast'; }, 3200);
  }

  async function rpc(name, args) {
    var r = await sb().rpc(name, args || {});
    if (r.error) throw new Error(r.error.message || String(r.error));
    return r.data;
  }

  // ───────────────────────── Завантаження ─────────────────────────
  async function boot() {
    try {
      S.launches = await rpc('general_list_launches');
      if (!S.launches.length) { $('gMain').innerHTML = '<div class="g-empty">Немає жодного проєкту-розіграшу з датами.</div>'; return; }
      var saved = null;
      try { saved = localStorage.getItem(LS_KEY); } catch (_) {}
      var urlId = new URLSearchParams(location.search).get('p');
      var pick = [urlId, saved].filter(Boolean).find(function (id) { return S.launches.some(function (l) { return l.id === id; }); });
      if (!pick) { var def = S.launches.find(function (l) { return l.is_default; }) || S.launches[0]; pick = def.id; }
      renderPicker(pick);
      await load(pick);
      clearInterval(S.timer);
      S.timer = setInterval(function () { if (S.plan) renderStrip(); }, 60000);
    } catch (e) {
      $('gMain').innerHTML = '<div class="g-empty bad">' + esc(e.message) + '</div>';
    }
  }

  function renderPicker(sel) {
    var act = S.launches.filter(function (l) { return !l.archived; });
    var arc = S.launches.filter(function (l) { return l.archived; });
    function opt(l) {
      return '<option value="' + l.id + '"' + (l.id === sel ? ' selected' : '') + '>' +
        esc((l.cycle_no ? '#' + l.cycle_no + ' · ' : '') + l.name) + ' (' + dmy(l.starts_on).slice(0, 5) + '–' + dmy(l.ends_on).slice(0, 5) + ')</option>';
    }
    $('gPicker').innerHTML = act.map(opt).join('') + (arc.length ? '<optgroup label="Архів">' + arc.map(opt).join('') + '</optgroup>' : '');
  }

  async function load(id) {
    S.launchId = id; S.log = null;
    try { localStorage.setItem(LS_KEY, id); } catch (_) {}
    $('gMain').innerHTML = '<div class="g-empty">Завантажую план…</div>';
    try {
      S.plan = await rpc('general_get_plan', { p_launch: id });
      // День ефіру зазвичай після STOP — показуємо його окремим рядком у кінці
      var L = S.plan.launch, days = S.plan.days;
      if (L.live_local && days.length) {
        var ld = L.live_local.slice(0, 10);
        if (ld > days[days.length - 1].day) days.push({ day: ld, n: null, live: true });
      }
      render();
    } catch (e) {
      $('gMain').innerHTML = '<div class="g-empty bad">' + esc(e.message) + '</div>';
    }
  }
  async function reload() { await load(S.launchId); }

  // ───────────────────────── Рендер ─────────────────────────
  function landingById(id) { return (S.plan.landings || []).find(function (x) { return x.id === id; }); }

  function eventsOn(day) {
    return S.plan.events.filter(function (e) { return inRange(day, e.day_from, e.day_to); });
  }
  function bannerOn(day) {
    return (S.plan.banners || []).find(function (b) { return inRange(day, b.from_day, b.to_day); });
  }
  function chanText(ch) {
    return (ch || []).map(function (c) {
      return (CH[c.ch] || c.ch) + (c.at ? ' ' + c.at : '') + (c.note ? ' (' + c.note + ')' : '');
    }).join(', ');
  }

  function render() {
    var p = S.plan, L = p.launch;
    document.title = 'GENERAL · ' + L.name;
    var h = '';
    h += '<section class="g-strip" id="gStrip"></section>';
    h += '<section class="g-card g-sched">' +
      '<div class="g-sched-row">' +
      cell('Старт', dtl(L.starts_local)) + cell('STOP', dtl(L.stop_local), 'stop') + cell('Ефір', dtl(L.live_local)) +
      (L.live_url ? cell('Трансляція', '<a href="' + esc(L.live_url) + '" target="_blank" rel="noopener">відкрити</a>', '', true) : '') +
      (p.can_edit ? '<button class="g-btn ghost sm" onclick="G.editSchedule()">Змінити</button>' : '') +
      '</div>' +
      (L.packages && L.packages.length ? '<div class="g-packs">' + L.packages.map(function (k) {
        return '<span class="g-pack"><b>' + esc(k.name) + '</b> ' + esc(fmtNum(k.price)) + ' ₴ · ' + esc(k.tokens) + ' ток.</span>';
      }).join('') + '</div>' : '') +
      '</section>';

    h += '<div class="g-toolbar">' +
      '<div class="g-chips">' + ['any', 'all', 'retention', 'fortunatos'].map(function (a) {
        return '<button class="g-chip' + (S.aud === a ? ' on' : '') + '" onclick="G.aud(\'' + a + '\')">' +
          (a === 'any' ? 'Усі аудиторії' : AUD[a].label) + '</button>';
      }).join('') + '</div>' +
      (p.can_edit ? '<button class="g-btn" onclick="G.editEvent()">+ Акція</button>' : '') +
      '</div>';

    h += '<section class="g-days">' + p.days.map(renderDay).join('') + '</section>';
    h += renderLandings();
    h += renderBanners();
    if (p.can_edit) {
      h += '<section class="g-card"><div class="g-sec-head"><h2>Журнал змін</h2>' +
        '<button class="g-btn ghost sm" onclick="G.toggleLog()">' + (S.logOpen ? 'Сховати' : 'Показати') + '</button></div>' +
        '<div id="gLog">' + (S.logOpen ? renderLog() : '<div class="g-muted">Бачать лише CEO і COO.</div>') + '</div></section>';
    }
    $('gMain').innerHTML = h;
    renderStrip();
    var t = document.querySelector('.g-day.today');
    if (t && !S._scrolled) { S._scrolled = true; setTimeout(function () { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 150); }
  }

  function cell(k, v, cls, raw) {
    return '<div class="g-cell ' + (cls || '') + '"><span>' + k + '</span><b>' + (raw ? v : esc(v)) + '</b></div>';
  }
  function fmtNum(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function renderStrip() {
    var p = S.plan, L = p.launch, now = Date.now();
    var today = kyivToday();
    var pd = p.days.filter(function (d) { return !d.live; });
    var dayIdx = pd.findIndex(function (d) { return d.day === today; });
    var items = [];

    if (dayIdx >= 0) items.push(stripItem('День', (dayIdx + 1) + ' з ' + pd.length));
    else if (pd.length && today < pd[0].day) items.push(stripItem('Старт через', untilText(Date.parse(L.starts_at) - now)));
    else items.push(stripItem('Проєкт', 'завершено'));

    if (L.stop_at && Date.parse(L.stop_at) > now) items.push(stripItem('До STOP', untilText(Date.parse(L.stop_at) - now), 'stop'));

    var aud = S.aud;
    var vis = p.events.filter(function (e) { return aud === 'any' || e.audience === aud; });
    var nowEv = vis.filter(function (e) {
      var a = Date.parse(e.starts_at), b = e.ends_at ? Date.parse(e.ends_at) : a + 3600e3;
      return a <= now && now <= b;
    });
    var next = vis.filter(function (e) { return Date.parse(e.starts_at) > now; })
      .sort(function (a, b) { return Date.parse(a.starts_at) - Date.parse(b.starts_at); })[0];
    items.push(stripItem('Зараз', nowEv.length ? nowEv.map(function (e) { return e.title; }).join(' · ') : 'без акцій', '', nowEv.length ? 'G.open(' + nowEv[0].id + ')' : ''));
    items.push(stripItem('Далі', next ? dmy(next.starts_local).slice(0, 5) + ' ' + hm(next.starts_local) + ' — ' + next.title : '—', '', next ? 'G.open(' + next.id + ')' : ''));

    var mail = [];
    eventsOn(today).forEach(function (e) {
      (e.channels || []).forEach(function (c) { mail.push((CH[c.ch] || c.ch) + (c.at ? ' ' + c.at : '')); });
    });
    var ret = (p.retention || []).filter(function (r) { return r.day === today; });
    ret.forEach(function (r) { mail.push((CH[r.channel] || r.channel) + ' ' + hm(r.publish_local)); });
    items.push(stripItem('Розсилки сьогодні', mail.length ? uniq(mail).join(' · ') : '—'));

    var b = bannerOn(today);
    items.push(stripItem('Шапка зараз', b ? (b.text || BSTAT[b.status] + ', тексту ще немає') : '—', b && b.status === 'pending' ? 'warn' : ''));

    var el = $('gStrip');
    if (el) el.innerHTML = items.join('');
  }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function stripItem(k, v, cls, onclick) {
    return '<div class="g-si ' + (cls || '') + '"' + (onclick ? ' onclick="' + onclick + '" role="button"' : '') + '><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>';
  }
  function untilText(ms) {
    if (ms <= 0) return 'зараз';
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? d + ' д ' + h + ' год' : h ? h + ' год ' + mm + ' хв' : mm + ' хв';
  }
  function kyivToday() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (_) { return S.plan.today; }
  }

  function renderDay(d) {
    var p = S.plan, day = d.day, today = kyivToday();
    var evs = eventsOn(day).filter(function (e) { return S.aud === 'any' || e.audience === S.aud; });
    var marks = (p.marks || []).filter(function (m) { return m.day === day && (S.aud === 'any' || m.audience === S.aud); });
    var b = bannerOn(day);
    var ret = (p.retention || []).filter(function (r) { return r.day === day; });
    var cls = 'g-day' + (day === today ? ' today' : '') + (day < today ? ' past' : '');

    var body = evs.map(function (e) {
      var multi = e.day_from !== e.day_to;
      var t = multi ? (day === e.day_from ? 'з ' + hm(e.starts_local) : day === e.day_to ? 'до ' + hm(e.ends_local) : 'весь день')
                    : (hm(e.starts_local) === '00:00' && (!e.ends_local || hm(e.ends_local) === '23:59') ? 'весь день' : hm(e.starts_local) + (e.ends_local ? '–' + hm(e.ends_local) : ''));
      return '<button class="g-ev ' + AUD[e.audience].cls + '" onclick="G.open(' + e.id + ')">' +
        '<span class="g-ev-top"><span class="g-tag">' + esc(AUD[e.audience].label + (e.segment ? ' · ' + e.segment.toUpperCase() : '')) + '</span>' +
        '<span class="g-kind">' + esc(KIND[e.kind] || e.kind) + '</span><span class="g-time">' + esc(t) + '</span></span>' +
        '<span class="g-ev-title">' + esc(e.title) + '</span>' +
        (e.conditions ? '<span class="g-ev-sub">' + esc(e.conditions) + '</span>' : '') +
        (e.limit_qty || e.limit_note ? '<span class="g-ev-sub">Ліміт: ' + esc(e.limit_qty ? e.limit_qty + ' шт.' : e.limit_note) + '</span>' : '') +
        (e.channels && e.channels.length ? '<span class="g-ev-ch">' + esc(chanText(e.channels)) + '</span>' : '') +
        (e.notes ? '<span class="g-ev-note">⚠ ' + esc(e.notes) + '</span>' : '') +
        '</button>';
    }).join('');

    var shownAud = evs.map(function (e) { return e.audience; });
    marks.forEach(function (m) {
      if (m.state === 'no_promo' && shownAud.indexOf(m.audience) >= 0) return;
      if (m.state === 'no_promo' && m.audience === 'fortunatos' && S.aud !== 'fortunatos') return;
      body += '<div class="g-mark ' + m.state + '"' + (p.can_edit ? ' onclick="G.editMark(\'' + day + '\',\'' + m.audience + '\')" role="button"' : '') + '>' +
        (m.state === 'tbd' ? '⏳ ' : '— ') + esc(AUD[m.audience].label + ': ' + (m.state === 'tbd' ? 'акцію ще не обрано' : 'без акцій')) +
        (m.note && m.state === 'tbd' ? ' · ' + esc(m.note) : '') + '</div>';
    });
    if (!body) {
      body += '<div class="g-mark wait"' + (p.can_edit ? ' onclick="G.editMark(\'' + day + '\',\'' + (S.aud === 'any' ? 'all' : S.aud) + '\')" role="button"' : '') + '>Очікує план</div>';
    }
    if (ret.length) {
      body += '<div class="g-ret">Ретеншн-розсилки: ' + ret.map(function (r) { return esc((CH[r.channel] || r.channel) + ' ' + hm(r.publish_local) + (r.title ? ' «' + r.title + '»' : '')); }).join(' · ') + '</div>';
    }

    return '<article class="' + cls + '" id="d-' + day + '">' +
      '<div class="g-day-head"><b>' + dayLabel(day) + '</b><span>' + (d.live ? 'Ефір, після STOP' : 'День ' + d.n) + '</span>' +
      (day === today ? '<em>сьогодні</em>' : '') +
      (b ? '<span class="g-ban-mini ' + b.status + '" title="' + esc(b.text || '') + '">Шапка: ' + esc(BSTAT[b.status]) + '</span>' : '') +
      (p.can_edit ? '<button class="g-plus" title="Додати акцію на цей день" onclick="G.editEvent(null,\'' + day + '\')">+</button>' : '') +
      '</div><div class="g-day-body">' + body + '</div></article>';
  }

  function renderLandings() {
    var ls = S.plan.landings || [];
    return '<section class="g-card"><div class="g-sec-head"><h2>Лендинги</h2>' +
      (S.plan.can_edit ? '<button class="g-btn ghost sm" onclick="G.editLanding()">+ Лендинг</button>' : '') + '</div>' +
      (ls.length ? '<div class="g-list">' + ls.map(function (l) {
        return '<div class="g-li">' +
          '<span class="g-role">' + esc(ROLE[l.role] || l.role) + (l.ab_label ? ' ' + esc(l.ab_label) : '') + '</span>' +
          '<span class="g-li-main">' + (l.internal_only ? '🔒 ' : '') +
          '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.url.replace('https://', '')) + '</a>' +
          (l.description ? '<small>' + esc(l.description) + (l.internal_only ? ' · не давати клієнтам' : '') + '</small>' : '') + '</span>' +
          '<span class="g-li-act"><button class="g-btn ghost sm" onclick="G.copy(\'' + esc(l.url) + '\')">Копіювати</button>' +
          (S.plan.can_edit ? '<button class="g-btn ghost sm" onclick="G.editLanding(\'' + l.id + '\')">✎</button>' : '') + '</span></div>';
      }).join('') + '</div>' : '<div class="g-muted">Лендингів ще не додано.</div>') + '</section>';
  }

  function renderBanners() {
    var bs = S.plan.banners || [];
    return '<section class="g-card"><div class="g-sec-head"><h2>Шапка сайту по періодах</h2>' +
      (S.plan.can_edit ? '<button class="g-btn ghost sm" onclick="G.editBanner()">+ Період</button>' : '') + '</div>' +
      (bs.length ? '<div class="g-list">' + bs.map(function (b) {
        return '<div class="g-li">' +
          '<span class="g-role">' + dmy(b.from_day).slice(0, 5) + '–' + dmy(b.to_day).slice(0, 5) + '</span>' +
          '<span class="g-li-main">' + (b.text ? esc(b.text) : '<i class="g-muted">Текст ще не задано</i>') +
          '<small><span class="g-bst ' + b.status + '">' + esc(BSTAT[b.status]) + '</span>' +
          (b.approved_by_name ? ' · ' + esc(b.approved_by_name) + ', ' + esc(dtl(b.approved_at)) : '') +
          (b.note ? ' · ' + esc(b.note) : '') + '</small></span>' +
          '<span class="g-li-act">' + (b.text ? '<button class="g-btn ghost sm" onclick="G.copyBanner(\'' + b.id + '\')">Копіювати</button>' : '') +
          (S.plan.can_edit ? '<button class="g-btn ghost sm" onclick="G.editBanner(\'' + b.id + '\')">✎</button>' : '') + '</span></div>';
      }).join('') + '</div>' : '<div class="g-muted">Періодів ще немає.</div>') + '</section>';
  }

  var ENT = { ad_events: 'Акція', launch_landings: 'Лендинг', launch_banners: 'Шапка', launch_day_marks: 'День', launches: 'Проєкт' };
  var ACT = { insert: 'додано', update: 'змінено', delete: 'видалено' };
  var FIELD = {
    title: 'назва', starts_at: 'початок', ends_at: 'кінець', status: 'статус', audience: 'аудиторія', conditions: 'умови',
    offer: 'офер', client_text: 'текст клієнту', limit_qty: 'ліміт', limit_note: 'ліміт (примітка)', channels: 'канали',
    utm_slug: 'UTM', landing_id: 'лендинг', notes: 'нотатки', text: 'текст', from_day: 'з', to_day: 'по', state: 'стан',
    stop_at: 'STOP', live_at: 'ефір', live_url: 'трансляція', packages: 'пакети', url: 'адреса', removed_at: 'прибрано',
    approved_at: 'погоджено', approved_by: 'хто погодив', segment: 'сегмент', kind: 'тип', owner_id: 'відповідальний'
  };
  function renderLog() {
    if (!S.log) return '<div class="g-muted">Завантажую…</div>';
    if (!S.log.length) return '<div class="g-muted">Змін ще не було.</div>';
    return '<div class="g-log">' + S.log.map(function (r) {
      var diff = r.diff || {}, parts = [];
      if (r.action === 'update') {
        Object.keys(diff).forEach(function (k) {
          var v = diff[k];
          parts.push('<b>' + esc(FIELD[k] || k) + '</b>: ' + esc(short(v[0])) + ' → ' + esc(short(v[1])));
        });
      } else {
        parts.push(esc(diff.title || diff.url || diff.text || diff.state || diff.name || ''));
      }
      return '<div class="g-log-row"><span class="g-muted">' + esc(dtl(r.at)) + '</span> <b>' + esc(r.who) + '</b> · ' +
        esc(ENT[r.entity] || r.entity) + ' ' + esc(ACT[r.action] || r.action) + '<div>' + parts.join('<br>') + '</div></div>';
    }).join('') + '</div>';
  }
  function short(v) {
    if (v == null) return '∅';
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
      try {
        var f = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        return f.format(new Date(s));
      } catch (_) {}
    }
    return s.length > 80 ? s.slice(0, 80) + '…' : s;
  }

  // ───────────────────────── Деталі акції ─────────────────────────
  function utmLink(e) {
    var l = landingById(e.landing_id);
    if (!l) return null;
    if (!e.utm_slug) return l.url;
    return l.url + (l.url.indexOf('?') >= 0 ? '&' : '?') + 'utm_campaign=' + encodeURIComponent(e.utm_slug);
  }
  function open(id) {
    var e = S.plan.events.find(function (x) { return x.id === id; });
    if (!e) return;
    var l = landingById(e.landing_id), link = utmLink(e);
    var rows = [
      ['Аудиторія', AUD[e.audience].label + (e.segment ? ' · ' + e.segment.toUpperCase() : '')],
      ['Коли', dtl(e.starts_local) + (e.ends_local ? ' → ' + dtl(e.ends_local) : '')],
      ['Тип', KIND[e.kind] || e.kind],
      e.offer ? ['Офер', e.offer] : null,
      e.mechanic ? ['Механіка', e.mechanic] : null,
      e.conditions ? ['Умови', e.conditions] : null,
      (e.limit_qty || e.limit_note) ? ['Ліміт', (e.limit_qty ? e.limit_qty + ' шт.' : '') + (e.limit_note ? ' ' + e.limit_note : '')] : null,
      e.channels && e.channels.length ? ['Канали', chanText(e.channels)] : null,
      e.utm_slug ? ['UTM', e.utm_slug] : null,
      e.owner_name ? ['Відповідальний', e.owner_name] : null,
      e.notes ? ['Нотатки', e.notes] : null
    ].filter(Boolean);
    var h = '<h3>' + esc(e.title) + '</h3><dl class="g-dl">' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl>';
    if (e.client_text) h += '<div class="g-client"><span>Текст для клієнта</span><p>' + esc(e.client_text) + '</p><button class="g-btn ghost sm" onclick="G.copyText(' + e.id + ')">Копіювати текст</button></div>';
    if (l) {
      h += '<div class="g-client"><span>Лендинг' + (l.internal_only ? ' · 🔒 тільки для команди' : '') + '</span><p class="mono">' + esc(link) + '</p>' +
        '<button class="g-btn sm" onclick="G.copy(\'' + esc(link) + '\')">Копіювати посилання з UTM</button></div>';
    }
    if (S.plan.can_edit) {
      h += '<div class="g-actions"><button class="g-btn" onclick="G.editEvent(' + e.id + ')">Редагувати</button>' +
        '<button class="g-btn ghost danger" onclick="G.cancelEvent(' + e.id + ')">Скасувати акцію</button></div>';
    }
    sheet(h);
  }

  // ───────────────────────── Модалки/шит ─────────────────────────
  function sheet(html) {
    $('gSheetBody').innerHTML = html;
    $('gSheet').classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('gSheet').classList.remove('show');
    document.body.style.overflow = '';
  }

  function field(label, name, val, type, extra) {
    type = type || 'text';
    if (type === 'textarea') return '<label class="g-f"><span>' + label + '</span><textarea name="' + name + '" rows="3"' + (extra || '') + '>' + esc(val) + '</textarea></label>';
    return '<label class="g-f"><span>' + label + '</span><input type="' + type + '" name="' + name + '" value="' + esc(val == null ? '' : val) + '"' + (extra || '') + '></label>';
  }
  function select(label, name, val, opts) {
    return '<label class="g-f"><span>' + label + '</span><select name="' + name + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val == null ? '' : val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
  }
  function formData() {
    var o = {};
    $('gSheetBody').querySelectorAll('[name]').forEach(function (el) {
      o[el.name] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    return o;
  }

  // Канали: рядок "viber 08:45; bot 00:05 · 09:30; email" ↔ jsonb
  function chToText(ch) {
    return (ch || []).map(function (c) { return c.ch + (c.at ? ' ' + c.at : '') + (c.note ? ' (' + c.note + ')' : ''); }).join('; ');
  }
  function textToCh(s) {
    if (!s) return [];
    return s.split(';').map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) {
      var note = null, m = x.match(/\(([^)]*)\)\s*$/);
      if (m) { note = m[1]; x = x.slice(0, m.index).trim(); }
      var sp = x.indexOf(' ');
      var ch = (sp < 0 ? x : x.slice(0, sp)).toLowerCase(), at = sp < 0 ? '' : x.slice(sp + 1).trim();
      var o = { ch: ch };
      if (at) o.at = at;
      if (note) o.note = note;
      return o;
    });
  }

  function editEvent(id, day) {
    var e = id ? S.plan.events.find(function (x) { return x.id === id; }) : null;
    day = day || (e ? e.day_from : kyivToday());
    var d = e || { kind: 'offer', audience: S.aud === 'any' ? 'all' : S.aud, starts_local: day + 'T00:00', ends_local: day + 'T23:59', channels: [] };
    var lands = [['', '— без лендингу —']].concat((S.plan.landings || []).map(function (l) { return [l.id, (ROLE[l.role] || l.role) + (l.ab_label ? ' ' + l.ab_label : '') + ' · ' + l.url.replace('https://', '')]; }));
    var users = [['', '—']].concat((S.plan.users || []).map(function (u) { return [u.id, u.name]; }));
    var h = '<h3>' + (e ? 'Редагувати акцію' : 'Нова акція') + '</h3><form class="g-form" onsubmit="return false">' +
      field('Назва *', 'title', d.title) +
      '<div class="g-row">' +
      select('Аудиторія', 'audience', d.audience, [['all', 'Загальна'], ['retention', 'Ретеншн'], ['fortunatos', 'Fortunatos']]) +
      field('Сегмент (напр. vip)', 'segment', d.segment) +
      select('Тип', 'kind', d.kind, Object.keys(KIND).map(function (k) { return [k, KIND[k]]; })) +
      '</div><div class="g-row">' +
      field('Початок (Київ) *', 'starts_local', d.starts_local, 'datetime-local') +
      field('Кінець (Київ)', 'ends_local', d.ends_local, 'datetime-local') +
      '</div>' +
      field('Офер', 'offer', d.offer) +
      field('Умови', 'conditions', d.conditions) +
      field('Текст для клієнта', 'client_text', d.client_text, 'textarea') +
      '<div class="g-row">' +
      field('Ліміт, шт.', 'limit_qty', d.limit_qty, 'number', ' min="1"') +
      field('Ліміт (примітка)', 'limit_note', d.limit_note) +
      '</div>' +
      select('Лендинг', 'landing_id', d.landing_id, lands) +
      '<div class="g-row">' +
      field('UTM (латиниця, _)', 'utm_slug', d.utm_slug, 'text', ' pattern="[a-z0-9]+(_[a-z0-9]+)*" placeholder="bmw330_x2"') +
      select('Статус', 'status', d.status || 'planned', [['planned', 'Заплановано'], ['ready', 'Готово'], ['live', 'Йде'], ['done', 'Завершено']]) +
      '</div>' +
      field('Канали: viber 08:45; bot 00:05 · 09:30; email (примітка)', 'channels', chToText(d.channels)) +
      select('Відповідальний', 'owner_id', d.owner_id, users) +
      field('Нотатки для команди', 'notes', d.notes, 'textarea') +
      '<div class="g-actions"><button class="g-btn" onclick="G.saveEvent(' + (e ? e.id : 'null') + ')">Зберегти</button>' +
      '<button class="g-btn ghost" onclick="G.close()">Скасувати</button></div></form>';
    sheet(h);
  }
  async function saveEvent(id) {
    var f = formData(), e = id ? S.plan.events.find(function (x) { return x.id === id; }) : null;
    if (!f.title) return toast('Вкажи назву', true);
    if (f.utm_slug && !/^[a-z0-9]+(_[a-z0-9]+)*$/.test(f.utm_slug.toLowerCase())) return toast('UTM: лише латиниця, цифри і _', true);
    var payload = Object.assign({}, f, { launch_id: S.launchId, channels: textToCh(f.channels) });
    if (id) { payload.id = id; payload.updated_at = e.updated_at; }
    try {
      await rpc('general_upsert_event', { p: payload });
      closeSheet(); toast('Збережено'); await reload();
    } catch (err) { toast(err.message, true); }
  }
  async function cancelEvent(id) {
    var e = S.plan.events.find(function (x) { return x.id === id; });
    if (!e) return;
    var btn = event && event.target;
    if (btn && !btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Натисни ще раз, щоб скасувати'; return; }
    try { await rpc('general_cancel_event', { p_id: id }); closeSheet(); toast('Акцію скасовано'); await reload(); }
    catch (err) { toast(err.message, true); }
  }

  function editSchedule() {
    var L = S.plan.launch;
    var h = '<h3>Розклад проєкту</h3><form class="g-form" onsubmit="return false">' +
      '<div class="g-row">' + field('Старт (Київ)', 'starts_local', L.starts_local, 'datetime-local') +
      field('STOP (Київ)', 'stop_local', L.stop_local, 'datetime-local') + '</div>' +
      '<div class="g-row">' + field('Ефір (Київ)', 'live_local', L.live_local, 'datetime-local') +
      field('Номер розіграшу', 'cycle_no', L.cycle_no, 'number') + '</div>' +
      field('Посилання на трансляцію', 'live_url', L.live_url, 'url') +
      field('Пакети: НАЗВА ціна токени; …', 'packages', (L.packages || []).map(function (k) { return k.name + ' ' + k.price + ' ' + k.tokens; }).join('; ')) +
      '<div class="g-actions"><button class="g-btn" onclick="G.saveSchedule()">Зберегти</button><button class="g-btn ghost" onclick="G.close()">Скасувати</button></div></form>';
    sheet(h);
  }
  async function saveSchedule() {
    var f = formData(), packs = [];
    var bad = false;
    (f.packages || '').split(';').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) {
      var m = x.match(/^(\S+)\s+(\d+)\s+(\d+)$/);
      if (!m) { bad = true; return; }
      packs.push({ name: m[1].toUpperCase(), price: +m[2], tokens: +m[3] });
    });
    if (bad) return toast('Пакети: формат «START 199 1; DRIVE 499 3»', true);
    f.packages = packs;
    try { await rpc('general_set_schedule', { p_launch: S.launchId, p: f }); closeSheet(); toast('Розклад збережено'); await reload(); }
    catch (err) { toast(err.message, true); }
  }

  function editLanding(id) {
    var l = id ? landingById(id) : { role: 'other', url: 'https://' };
    var h = '<h3>' + (id ? 'Лендинг' : 'Новий лендинг') + '</h3><form class="g-form" onsubmit="return false">' +
      field('Адреса *', 'url', l.url, 'url') +
      '<div class="g-row">' + select('Роль', 'role', l.role, Object.keys(ROLE).map(function (k) { return [k, ROLE[k]]; })) +
      field('A/B мітка', 'ab_label', l.ab_label) + field('Порядок', 'sort', l.sort, 'number') + '</div>' +
      field('Опис', 'description', l.description) +
      '<label class="g-check"><input type="checkbox" name="internal_only"' + (l.internal_only ? ' checked' : '') + '> Тільки для команди (не давати клієнтам)</label>' +
      '<div class="g-actions"><button class="g-btn" onclick="G.saveLanding(' + (id ? '\'' + id + '\'' : 'null') + ')">Зберегти</button>' +
      (id ? '<button class="g-btn ghost danger" onclick="G.removeLanding(\'' + id + '\')">Прибрати</button>' : '') +
      '<button class="g-btn ghost" onclick="G.close()">Скасувати</button></div></form>';
    sheet(h);
  }
  async function saveLanding(id) {
    var f = formData(); f.launch_id = S.launchId; if (id) f.id = id;
    try { await rpc('general_upsert_landing', { p: f }); closeSheet(); toast('Збережено'); await reload(); }
    catch (err) { toast(err.message, true); }
  }
  async function removeLanding(id) {
    var btn = event && event.target;
    if (btn && !btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Точно прибрати?'; return; }
    try { await rpc('general_delete_landing', { p_id: id }); closeSheet(); toast('Лендинг прибрано'); await reload(); }
    catch (err) { toast(err.message, true); }
  }

  function editBanner(id) {
    var b = id ? S.plan.banners.find(function (x) { return x.id === id; }) : { status: 'pending', from_day: kyivToday(), to_day: kyivToday() };
    var evs = [['', '—']].concat(S.plan.events.map(function (e) { return [e.id, dmy(e.day_from).slice(0, 5) + ' ' + e.title]; }));
    var h = '<h3>' + (id ? 'Шапка' : 'Новий період шапки') + '</h3><form class="g-form" onsubmit="return false">' +
      '<div class="g-row">' + field('З', 'from_day', b.from_day, 'date') + field('По', 'to_day', b.to_day, 'date') +
      select('Статус', 'status', b.status, [['pending', BSTAT.pending], ['approved', BSTAT.approved], ['live', BSTAT.live]]) + '</div>' +
      field('Текст шапки', 'text', b.text, 'textarea') +
      select('Пов’язана акція', 'ad_event_id', b.ad_event_id, evs) +
      field('Примітка', 'note', b.note) +
      '<div class="g-actions"><button class="g-btn" onclick="G.saveBanner(' + (id ? '\'' + id + '\'' : 'null') + ')">Зберегти</button>' +
      (id ? '<button class="g-btn ghost danger" onclick="G.removeBanner(\'' + id + '\')">Прибрати</button>' : '') +
      '<button class="g-btn ghost" onclick="G.close()">Скасувати</button></div></form>';
    sheet(h);
  }
  async function saveBanner(id) {
    var f = formData(); f.launch_id = S.launchId; if (id) f.id = id;
    try { await rpc('general_upsert_banner', { p: f }); closeSheet(); toast('Збережено'); await reload(); }
    catch (err) { toast(err.message, true); }
  }
  async function removeBanner(id) {
    var btn = event && event.target;
    if (btn && !btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Точно прибрати?'; return; }
    try { await rpc('general_delete_banner', { p_id: id }); closeSheet(); toast('Період прибрано'); await reload(); }
    catch (err) { toast(err.message, true); }
  }

  function editMark(day, aud) {
    var m = (S.plan.marks || []).find(function (x) { return x.day === day && x.audience === aud; }) || {};
    var h = '<h3>' + dayLabel(day) + '</h3><form class="g-form" onsubmit="return false">' +
      select('Аудиторія', 'audience', aud, [['all', 'Загальна'], ['retention', 'Ретеншн'], ['fortunatos', 'Fortunatos']]) +
      select('Стан дня', 'state', m.state || '', [['', 'Без позначки (очікує план)'], ['no_promo', 'Свідомо без акцій'], ['tbd', 'Акцію ще не обрано']]) +
      field('Примітка', 'note', m.note) +
      '<div class="g-actions"><button class="g-btn" onclick="G.saveMark(\'' + day + '\')">Зберегти</button>' +
      '<button class="g-btn ghost" onclick="G.editEvent(null,\'' + day + '\')">+ Акція на цей день</button>' +
      '<button class="g-btn ghost" onclick="G.close()">Скасувати</button></div></form>';
    sheet(h);
  }
  async function saveMark(day) {
    var f = formData();
    try {
      await rpc('general_mark_day', { p_launch: S.launchId, p_day: day, p_audience: f.audience, p_state: f.state || null, p_note: f.note || null });
      closeSheet(); toast('Збережено'); await reload();
    } catch (err) { toast(err.message, true); }
  }

  async function toggleLog() {
    S.logOpen = !S.logOpen;
    if (S.logOpen && !S.log) {
      render();
      try { S.log = await rpc('general_change_log', { p_launch: S.launchId, p_limit: 300 }); }
      catch (err) { S.log = []; toast(err.message, true); }
    }
    render();
  }

  function copy(text) {
    var done = function () { toast('Скопійовано'); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var t = document.createElement('textarea'); t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (_) {} t.remove();
  }

  window.G = {
    pick: function (id) { var u = new URL(location.href); u.searchParams.set('p', id); history.replaceState(null, '', u); S._scrolled = false; load(id); },
    aud: function (a) { S.aud = a; render(); },
    open: open, close: closeSheet,
    editEvent: editEvent, saveEvent: saveEvent, cancelEvent: cancelEvent,
    editSchedule: editSchedule, saveSchedule: saveSchedule,
    editLanding: editLanding, saveLanding: saveLanding, removeLanding: removeLanding,
    editBanner: editBanner, saveBanner: saveBanner, removeBanner: removeBanner,
    editMark: editMark, saveMark: saveMark, toggleLog: toggleLog,
    copy: copy,
    copyText: function (id) { var e = S.plan.events.find(function (x) { return x.id === id; }); if (e) copy(e.client_text || ''); },
    copyBanner: function (id) { var b = S.plan.banners.find(function (x) { return x.id === id; }); if (b) copy(b.text || ''); }
  };

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  window.addEventListener('dcg-ready', boot);
  if (window.__dcgReady) boot();
})();
