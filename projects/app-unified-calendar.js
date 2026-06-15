/* ============================================================
 * #360 (12.06.2026 Vadym): ЗВЕДЕНИЙ КАЛЕНДАР SMM+Retention
 * Окремий таб у /projects/ — `#calendar` hash.
 *
 * Views: Місяць / Тиждень / День / Тиждень×Канал / Список
 * Conflict detection: per-channel (TG 60 / Email 240 / Push 480 / IG 90 хв)
 * Diversity insights: chip "3×REELS · 1×EMAIL · 0×STORIES"
 * Inline preview modal: read-only popover з reschedule + open у SMM/Retention
 *
 * Архітектура: окремий controller на window.dcUnifiedCalendar.
 * Підключається з app-projects-app.js через hash route #calendar.
 * Працює без модифікацій /hq/ і /retention/ — RPC unified_calendar_events.
 * ============================================================ */

(function () {
  'use strict';

  // Per-channel conflict thresholds (хвилини)
  // Vadym обрав: TG 60 / Email 240 / Push 480 / IG 90.
  var DEFAULT_THRESHOLDS = { tg: 60, email: 240, push: 480, ig: 90, fb: 120, tt: 90, yt: 120, threads: 120, sms: 240, viber: 240, other: 120 };
  function thresholds() {
    try {
      var saved = JSON.parse(localStorage.getItem('uc_thresholds') || '{}');
      return Object.assign({}, DEFAULT_THRESHOLDS, saved);
    } catch (_) { return DEFAULT_THRESHOLDS; }
  }

  var SOURCE_COLOR = { smm: '#3b82f6', retention: '#a855f7' };
  var SOURCE_LABEL = { smm: 'SMM', retention: 'RET' };
  // #364 (12.06.2026 Vadym): emoji-піктограми соцмереж замість текстових літер
  var CHANNEL_LABEL = {
    tg: '✈️',       // Telegram paper plane
    ig: '📷',       // Instagram camera
    fb: 'ⓕ',       // Facebook
    tt: '🎵',       // TikTok music note
    yt: '▶️',       // YouTube play
    threads: '🧵',  // Threads
    email: '📧',    // Email envelope
    push: '🔔',     // Push bell
    sms: '💬',      // SMS chat bubble
    viber: '📞',    // Viber phone
    other: '🔗'     // Other link
  };
  var CHANNEL_NAME = {
    tg: 'Telegram', ig: 'Instagram', fb: 'Facebook', tt: 'TikTok', yt: 'YouTube',
    threads: 'Threads', email: 'Email', push: 'Push', sms: 'SMS', viber: 'Viber', other: 'Інше'
  };
  // #420 (15.06.2026 Vadym): різні emoji для TG-канал (SMM) vs TG-бот (Retention)
  function chEmoji(c, src) {
    if (c === 'tg') return src === 'retention' ? '🤖' : '📢';
    return CHANNEL_LABEL[c] || (c || '').toUpperCase();
  }
  function chFullName(c, src) {
    if (c === 'tg') return src === 'retention' ? 'TG-бот (Retention)' : 'TG-канал (SMM)';
    return CHANNEL_NAME[c] || c;
  }
  var STATUS_LABEL = { draft: 'Чорнетка', planned: 'Заплановано', review: 'На погодженні', approved: 'Затверджено', ready: 'Готово', scheduled: 'Заплановано', publishing: 'Публікація', published: 'Опубліковано', sent: 'Відправлено', sending: 'Розсилка', failed: 'Помилка', cancelled: 'Скасовано' };

  var state = {
    view: 'month',
    cursor: new Date(),
    events: [],
    filters: {
      sources: ['smm', 'retention'],
      channels: [],
      owners: [],
      statuses: [],
      onlyConflicts: false,
    },
    users: [],
    selected: null,
  };

  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem('uc_prefs') || '{}');
      if (p.view) state.view = p.view;
      if (p.filters) state.filters = Object.assign(state.filters, p.filters);
    } catch (_) {}
  }
  function savePrefs() {
    try { localStorage.setItem('uc_prefs', JSON.stringify({ view: state.view, filters: state.filters })); } catch (_) {}
  }

  // Date helpers — все у Europe/Kyiv (HARD RULE)
  function ymd(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
  function hhmm(d) {
    return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  }
  function ddmm(d) {
    return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit' }).format(d);
  }
  function dayOfWeekShort(d) {
    return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'short' }).format(d).toUpperCase();
  }
  function startOfMonth(d) {
    var iso = ymd(d);
    return new Date(Date.UTC(+iso.slice(0,4), +iso.slice(5,7) - 1, 1));
  }
  function endOfMonth(d) {
    var iso = ymd(d);
    return new Date(Date.UTC(+iso.slice(0,4), +iso.slice(5,7), 1));
  }
  function startOfWeekMon(d) {
    var iso = ymd(d).split('-').map(Number);
    var base = new Date(Date.UTC(iso[0], iso[1] - 1, iso[2]));
    var dow = base.getUTCDay() || 7;
    base.setUTCDate(base.getUTCDate() - (dow - 1));
    return base;
  }
  function addDays(d, n) { var c = new Date(d); c.setUTCDate(c.getUTCDate() + n); return c; }
  function addMonths(d, n) {
    var iso = ymd(d);
    return new Date(Date.UTC(+iso.slice(0,4), +iso.slice(5,7) - 1 + n, 1));
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (m) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]; });
  }

  function diversityStats(events) {
    var byCtype = {}, byChannel = {}, bySource = {};
    events.forEach(function (e) {
      byCtype[e.ctype] = (byCtype[e.ctype] || 0) + 1;
      bySource[e.source] = (bySource[e.source] || 0) + 1;
      (e.channels || []).forEach(function (ch) { byChannel[ch] = (byChannel[ch] || 0) + 1; });
    });
    return { byCtype: byCtype, byChannel: byChannel, bySource: bySource };
  }
  function diversityChipHtml(events, label) {
    if (!events.length) return '<div class="uc-diversity">' + label + ': порожньо</div>';
    var s = diversityStats(events);
    var ctypePart = Object.keys(s.byCtype).map(function (k) { return s.byCtype[k] + 'x' + k.toUpperCase(); }).join(' &middot; ');
    var sourcePart = (s.bySource.smm || 0) + 'xSMM &middot; ' + (s.bySource.retention || 0) + 'xRET';
    return '<div class="uc-diversity"><b>' + label + ':</b> ' + ctypePart + ' &nbsp;|&nbsp; ' + sourcePart + '</div>';
  }

  // Conflict detection per-channel
  function detectConflicts(events) {
    var th = thresholds();
    var byChannel = {};
    events.forEach(function (e) {
      (e.channels || []).forEach(function (ch) {
        if (!byChannel[ch]) byChannel[ch] = [];
        byChannel[ch].push({ id: e.id + '|' + e.source, at: new Date(e.scheduled_at).getTime(), eventRef: e });
      });
    });
    var conflicts = {};
    Object.keys(byChannel).forEach(function (ch) {
      var list = byChannel[ch].sort(function (a, b) { return a.at - b.at; });
      var windowMin = th[ch] || 120;
      for (var i = 0; i < list.length - 1; i++) {
        var diff = (list[i + 1].at - list[i].at) / 60000;
        if (diff < windowMin) {
          var k1 = list[i].id, k2 = list[i + 1].id;
          if (!conflicts[k1]) conflicts[k1] = [];
          if (!conflicts[k2]) conflicts[k2] = [];
          conflicts[k1].push({ channel: ch, partnerTitle: list[i + 1].eventRef.title, diffMin: Math.round(diff) });
          conflicts[k2].push({ channel: ch, partnerTitle: list[i].eventRef.title, diffMin: Math.round(diff) });
        }
      }
    });
    events.forEach(function (e) {
      var key = e.id + '|' + e.source;
      e.conflicts = conflicts[key] || [];
      e.hasConflict = e.conflicts.length > 0;
    });
    return events;
  }

  function applyFilters(events) {
    var f = state.filters;
    return events.filter(function (e) {
      if (f.sources.length && f.sources.indexOf(e.source) === -1) return false;
      if (f.channels.length && !(e.channels || []).some(function (c) { return f.channels.indexOf(c) >= 0; })) return false;
      if (f.owners.length && f.owners.indexOf(e.owner_id) === -1) return false;
      if (f.statuses.length && f.statuses.indexOf(e.status) === -1) return false;
      if (f.onlyConflicts && !e.hasConflict) return false;
      return true;
    });
  }

  async function loadEvents() {
    var from, to;
    if (state.view === 'month') {
      var mStart = startOfMonth(state.cursor);
      from = startOfWeekMon(mStart);
      to = addDays(from, 42);
    } else if (state.view === 'week' || state.view === 'grid') {
      from = startOfWeekMon(state.cursor);
      to = addDays(from, 7);
    } else if (state.view === 'day') {
      var iso = ymd(state.cursor).split('-').map(Number);
      from = new Date(Date.UTC(iso[0], iso[1] - 1, iso[2]));
      to = addDays(from, 1);
    } else {
      var lStart = startOfWeekMon(state.cursor);
      from = addDays(lStart, -7);
      to = addDays(lStart, 28);
    }
    try {
      var rpc = await window.supabase.rpc('unified_calendar_events', {
        p_from: from.toISOString(),
        p_to: to.toISOString(),
        p_systems: null,
        p_channels: null,
        p_owners: null,
        p_statuses: null,
      });
      if (rpc.error) {
        console.error('[unified_calendar]', rpc.error);
        state.events = [];
        return;
      }
      state.events = rpc.data || [];
      detectConflicts(state.events);
    } catch (e) {
      console.error('[unified_calendar] load failed', e);
      state.events = [];
    }
  }

  async function loadUsersIfNeeded() {
    if (state.users.length) return;
    try {
      var r = await window.supabase.from('users').select('id,name,email,role,is_active').order('name');
      state.users = (r.data || []).filter(function (u) { return u.is_active !== false; });
    } catch (_) {}
  }

  function injectCss() {
    if (document.getElementById('uc-css')) return;
    var css = [
      '.uc-wrap{padding:18px 24px;}',
      '.uc-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px;}',
      '.uc-head h1{font-family:Oswald,sans-serif;font-size:22px;font-weight:800;letter-spacing:0.05em;color:#fff;}',
      '.uc-head .red{color:#E30613;}',
      '.uc-views{display:flex;gap:6px;}',
      '.uc-views button{padding:7px 12px;background:#141414;border:1px solid #2a2a2a;color:#ddd;font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:0.12em;cursor:pointer;border-radius:6px;}',
      '.uc-views button.active{background:#E30613;color:#fff;border-color:#E30613;}',
      '.uc-nav{display:flex;gap:6px;align-items:center;}',
      '.uc-nav button{padding:7px 12px;background:#141414;border:1px solid #2a2a2a;color:#ddd;cursor:pointer;border-radius:6px;font-size:13px;}',
      '.uc-nav .label{font-family:Oswald,sans-serif;font-size:15px;font-weight:700;color:#fff;letter-spacing:0.05em;min-width:160px;text-align:center;}',
      '.uc-filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0;border-top:1px solid #1a1a1a;border-bottom:1px solid #1a1a1a;margin-bottom:14px;}',
      '.uc-toggle{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid #2a2a2a;border-radius:4px;cursor:pointer;font-size:11px;font-family:JetBrains Mono,monospace;letter-spacing:0.1em;color:#999;background:#141414;}',
      '.uc-toggle.active{background:rgba(227,6,19,0.15);border-color:#E30613;color:#fff;}',
      '.uc-toggle.smm.active{background:rgba(59,130,246,0.18);border-color:#3b82f6;color:#7ab0ff;}',
      '.uc-toggle.retention.active{background:rgba(168,85,247,0.18);border-color:#a855f7;color:#c4a3ff;}',
      '.uc-toggle .dot{width:8px;height:8px;border-radius:50%;}',
      '.uc-select{background:#141414;border:1px solid #2a2a2a;color:#ddd;padding:5px 8px;border-radius:4px;font-size:11px;font-family:JetBrains Mono,monospace;}',
      '.uc-diversity{font-size:11px;color:#888;padding:6px 10px;background:rgba(59,130,246,0.06);border-left:3px solid #3b82f6;margin-bottom:10px;font-family:JetBrains Mono,monospace;letter-spacing:0.05em;}',
      '.uc-diversity b{color:#ddd;}',

      '.uc-month{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:#1a1a1a;border:1px solid #1a1a1a;border-radius:8px;overflow:hidden;}',
      '.uc-month .uc-wd{background:#141414;padding:8px;text-align:center;font-size:9px;color:#888;letter-spacing:0.15em;font-family:JetBrains Mono,monospace;}',
      '.uc-month .uc-day{background:#0a0a0a;min-height:120px;padding:6px;display:flex;flex-direction:column;gap:2px;overflow:hidden;min-width:0;}',
      '.uc-month .uc-day.outside{opacity:0.35;}',
      '.uc-month .uc-day.today{background:rgba(227,6,19,0.06);box-shadow:inset 0 0 0 1px rgba(227,6,19,0.4);}',
      '.uc-month .uc-day .num{font-family:Oswald,sans-serif;font-weight:700;color:#fff;font-size:13px;margin-bottom:4px;}',
      '.uc-event{display:flex;align-items:center;gap:4px;padding:3px 5px;border-radius:4px;cursor:pointer;font-size:11px;line-height:1.3;min-height:20px;}',
      '.uc-event.src-smm{background:rgba(59,130,246,0.18);border-left:3px solid #3b82f6;}',
      '.uc-event.src-retention{background:rgba(168,85,247,0.18);border-left:3px solid #a855f7;}',
      '.uc-event.has-conflict{outline:1px dashed #eab308;}',
      '.uc-event .chip{font-size:14px;line-height:1;flex-shrink:0;padding:0 2px;}',
      '.uc-event .time{font-family:JetBrains Mono,monospace;font-size:10px;color:#ddd;flex-shrink:0;}',
      '.uc-event .title{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eee;}',
      '.uc-event .warn{color:#eab308;font-size:10px;}',
      '.uc-more{font-size:9px;color:#666;padding:2px 5px;text-align:center;}',

      // #366 (12.06.2026 Віра): minmax(0,1fr) щоб колонки стискалися — інакше довгі назви подій виштовхують Чт/Пт/Сб/Нд за overflow:hidden
      '.uc-week{display:grid;grid-template-columns:50px repeat(7,minmax(0,1fr));gap:1px;background:#1a1a1a;border:1px solid #1a1a1a;border-radius:8px;overflow:hidden;}',
      '.uc-week .uc-cell{background:#0a0a0a;min-height:50px;padding:3px;border-bottom:1px solid #1a1a1a;min-width:0;overflow:hidden;}',
      '.uc-week .uc-hour{background:#141414;font-size:9px;color:#888;text-align:right;padding:3px 5px;font-family:JetBrains Mono,monospace;border-bottom:1px solid #1a1a1a;}',
      '.uc-week .uc-wd-head{background:#141414;padding:8px;text-align:center;font-size:11px;color:#fff;font-family:Oswald,sans-serif;font-weight:700;border-bottom:1px solid #2a2a2a;}',
      '.uc-week .uc-wd-head.today{color:#E30613;}',
      '.uc-day-view{display:grid;grid-template-columns:60px 1fr;gap:1px;background:#1a1a1a;border:1px solid #1a1a1a;border-radius:8px;overflow:hidden;}',
      '.uc-day-view .uc-cell{background:#0a0a0a;min-height:60px;padding:5px;border-bottom:1px solid #1a1a1a;}',
      '.uc-day-view .uc-hour{background:#141414;font-size:11px;color:#aaa;text-align:right;padding:5px;border-bottom:1px solid #1a1a1a;}',

      '.uc-grid{display:grid;background:#1a1a1a;border:1px solid #1a1a1a;border-radius:8px;overflow:hidden;}',
      '.uc-grid .gc{background:#0a0a0a;padding:6px 8px;font-size:11px;color:#ddd;border-right:1px solid #1a1a1a;border-bottom:1px solid #1a1a1a;min-height:50px;display:flex;flex-direction:column;gap:3px;min-width:0;overflow:hidden;}',
      '.uc-grid .gh{background:#141414;font-family:Oswald,sans-serif;font-weight:700;color:#fff;text-align:center;padding:8px;letter-spacing:0.08em;font-size:13px;}',
      '.uc-grid .gh.today{color:#E30613;}',
      '.uc-grid .gch{background:#141414;color:#fff;font-family:JetBrains Mono,monospace;font-size:11px;font-weight:700;letter-spacing:0.12em;padding:8px;text-align:left;}',
      '.uc-grid .grid-event{font-size:10px;padding:3px 5px;border-radius:3px;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.uc-grid .grid-event.src-smm{background:rgba(59,130,246,0.22);color:#bcd4ff;}',
      '.uc-grid .grid-event.src-retention{background:rgba(168,85,247,0.22);color:#dec0ff;}',
      '.uc-grid .grid-event.has-conflict{outline:1px dashed #eab308;}',

      '.uc-list{display:flex;flex-direction:column;gap:1px;background:#1a1a1a;border:1px solid #1a1a1a;border-radius:8px;overflow:hidden;}',
      '.uc-list .row{background:#0a0a0a;padding:10px 14px;display:grid;grid-template-columns:90px 80px 1fr 100px 110px 24px;gap:10px;align-items:center;cursor:pointer;font-size:13px;}',
      '.uc-list .row:hover{background:#141414;}',
      '.uc-list .row.has-conflict{box-shadow:inset 3px 0 0 #eab308;}',
      '.uc-list .row .when{font-family:JetBrains Mono,monospace;font-size:11px;color:#ccc;}',
      '.uc-list .row .src{font-size:9px;letter-spacing:0.1em;padding:2px 6px;border-radius:3px;font-weight:700;text-align:center;}',
      '.uc-list .row .src-smm{background:rgba(59,130,246,0.2);color:#7ab0ff;}',
      '.uc-list .row .src-retention{background:rgba(168,85,247,0.2);color:#c4a3ff;}',
      '.uc-list .row .title{color:#eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '.uc-list .row .channels{font-size:16px;line-height:1;letter-spacing:2px;}',
      '.uc-list .row .who{font-size:11px;color:#aaa;}',
      '.uc-list .row .warn{color:#eab308;font-size:14px;}',

      '.uc-preview-backdrop{position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;display:none;align-items:center;justify-content:center;padding:24px;}',
      '.uc-preview-backdrop.show{display:flex;}',
      '.uc-preview{background:#0a0a0a;border:1px solid #2a2a2a;border-radius:10px;max-width:560px;width:100%;padding:22px;color:#eee;font-family:JetBrains Mono,monospace;}',
      '.uc-preview h2{font-family:Oswald,sans-serif;font-size:17px;font-weight:800;letter-spacing:0.05em;margin-bottom:12px;color:#fff;}',
      '.uc-preview .row{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #1a1a1a;font-size:13px;}',
      '.uc-preview .row .lbl{color:#888;font-size:10px;letter-spacing:0.1em;min-width:90px;}',
      '.uc-preview .actions{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;}',
      '.uc-preview .btn{padding:9px 14px;background:#141414;border:1px solid #2a2a2a;color:#ddd;cursor:pointer;border-radius:6px;font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:0.1em;text-decoration:none;display:inline-block;}',
      '.uc-preview .btn.primary{background:#E30613;border-color:#E30613;color:#fff;}',
      '.uc-preview .conflict-box{background:rgba(234,179,8,0.1);border:1px solid #eab308;border-radius:6px;padding:10px;margin-top:12px;font-size:12px;color:#facc15;}',

      '@media (max-width: 768px) { .uc-month .uc-day { min-height: 70px; padding:4px;font-size:10px; } .uc-event .title { font-size:10px; } .uc-list .row { grid-template-columns: 80px 60px 1fr 24px; } .uc-list .row .channels, .uc-list .row .who { display:none; } }',
    ].join('');
    var st = document.createElement('style');
    st.id = 'uc-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  async function render() {
    injectCss();
    var root = document.getElementById('appContent');
    if (!root) return;
    root.innerHTML = '<div class="uc-wrap" style="padding:40px;text-align:center;color:#888;">Завантажую…</div>';
    await loadUsersIfNeeded();
    await loadEvents();
    var visible = applyFilters(state.events);

    var html = ['<div class="uc-wrap">'];
    html.push('<div class="uc-head">');
    html.push('<h1>📅 ЗВЕДЕНИЙ <span class="red">КАЛЕНДАР</span></h1>');
    html.push('<div class="uc-views">');
    ['month', 'week', 'day', 'grid', 'list'].forEach(function (v) {
      var lbl = { month: 'МІСЯЦЬ', week: 'ТИЖДЕНЬ', day: 'ДЕНЬ', grid: 'ТИЖД×КАНАЛ', list: 'СПИСОК' }[v];
      html.push('<button class="' + (state.view === v ? 'active' : '') + '" data-view="' + v + '">' + lbl + '</button>');
    });
    html.push('</div>');
    html.push('<div style="flex:1;"></div>');
    html.push('<div class="uc-nav">');
    html.push('<button data-nav="prev" title="Попередній">◀</button>');
    html.push('<div class="label">' + currentRangeLabel() + '</div>');
    html.push('<button data-nav="next" title="Наступний">▶</button>');
    html.push('<button data-nav="today" title="Сьогодні">СЬОГОДНІ</button>');
    html.push('</div>');
    html.push('</div>');

    html.push(filtersBarHtml());
    html.push(diversityChipHtml(visible, currentRangeLabel()));

    html.push('<div id="uc-body">');
    if (state.view === 'month') html.push(renderMonth(visible));
    else if (state.view === 'week') html.push(renderWeek(visible));
    else if (state.view === 'day') html.push(renderDay(visible));
    else if (state.view === 'grid') html.push(renderGrid(visible));
    else html.push(renderList(visible));
    html.push('</div>');
    html.push('</div>');

    html.push('<div class="uc-preview-backdrop" id="ucPreview"><div class="uc-preview" id="ucPreviewBody"></div></div>');

    root.innerHTML = html.join('');
    bindEvents();
  }

  function currentRangeLabel() {
    if (state.view === 'month') {
      return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', month: 'long', year: 'numeric' }).format(state.cursor).toUpperCase();
    }
    if (state.view === 'day') {
      return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(state.cursor).toUpperCase();
    }
    var s = startOfWeekMon(state.cursor);
    var e = addDays(s, 6);
    return ddmm(s) + ' — ' + ddmm(e);
  }

  function filtersBarHtml() {
    var h = ['<div class="uc-filters">'];
    h.push('<span class="uc-toggle smm ' + (state.filters.sources.indexOf('smm') >= 0 ? 'active' : '') + '" data-source="smm"><span class="dot" style="background:#3b82f6;"></span> SMM</span>');
    h.push('<span class="uc-toggle retention ' + (state.filters.sources.indexOf('retention') >= 0 ? 'active' : '') + '" data-source="retention"><span class="dot" style="background:#a855f7;"></span> RETENTION</span>');
    h.push('<span style="width:1px;height:18px;background:#2a2a2a;"></span>');
    h.push('<select class="uc-select" id="ucOwnerSel"><option value="">Всі виконавці</option>');
    state.users.forEach(function (u) {
      var sel = state.filters.owners.indexOf(u.id) >= 0 ? ' selected' : '';
      h.push('<option value="' + u.id + '"' + sel + '>' + escapeHtml(u.name || u.email) + '</option>');
    });
    h.push('</select>');
    h.push('<select class="uc-select" id="ucChannelSel"><option value="">Всі канали</option>');
    ['tg', 'ig', 'fb', 'tt', 'yt', 'threads', 'email', 'push', 'sms', 'viber', 'other'].forEach(function (c) {
      var sel = state.filters.channels.indexOf(c) >= 0 ? ' selected' : '';
      h.push('<option value="' + c + '"' + sel + '>' + c.toUpperCase() + '</option>');
    });
    h.push('</select>');
    h.push('<span class="uc-toggle ' + (state.filters.onlyConflicts ? 'active' : '') + '" id="ucConflictToggle">⚠ Тільки конфлікти</span>');
    h.push('<span style="flex:1;"></span>');
    h.push('<span style="font-size:10px;color:#666;font-family:JetBrains Mono,monospace;">' + state.events.length + ' подій · показано: ' + applyFilters(state.events).length + '</span>');
    h.push('</div>');
    return h.join('');
  }

  function renderMonth(events) {
    var monthStart = startOfMonth(state.cursor);
    var gridStart = startOfWeekMon(monthStart);
    var monthNum = +ymd(monthStart).slice(5, 7);
    var todayYmd = ymd(new Date());
    var byDay = {};
    events.forEach(function (e) {
      var k = ymd(new Date(e.scheduled_at));
      if (!byDay[k]) byDay[k] = [];
      byDay[k].push(e);
    });
    Object.keys(byDay).forEach(function (k) {
      byDay[k].sort(function (a, b) { return new Date(a.scheduled_at) - new Date(b.scheduled_at); });
    });
    var h = ['<div class="uc-month">'];
    ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'НД'].forEach(function (d) { h.push('<div class="uc-wd">' + d + '</div>'); });
    for (var i = 0; i < 42; i++) {
      var d = addDays(gridStart, i);
      var key = ymd(d);
      var outside = (+key.slice(5, 7)) !== monthNum;
      var today = key === todayYmd;
      var list = byDay[key] || [];
      h.push('<div class="uc-day ' + (outside ? 'outside' : '') + (today ? ' today' : '') + '">');
      h.push('<div class="num">' + (+key.slice(8, 10)) + '</div>');
      list.slice(0, 5).forEach(function (e) { h.push(eventChipHtml(e)); });
      if (list.length > 5) h.push('<div class="uc-more">+' + (list.length - 5) + ' ще</div>');
      h.push('</div>');
    }
    h.push('</div>');
    return h.join('');
  }

  function eventChipHtml(e) {
    var time = hhmm(new Date(e.scheduled_at));
    var ch = (e.channels || [])[0];
    var chLbl = chEmoji(ch, e.source);
    var warn = e.hasConflict ? '<span class="warn" title="Конфлікт каналу">⚠</span>' : '';
    return '<div class="uc-event src-' + e.source + (e.hasConflict ? ' has-conflict' : '') + '" data-evid="' + e.id + '" data-src="' + e.source + '" title="' + escapeHtml(e.title) + '">' +
      '<span class="chip">' + chLbl + '</span>' +
      '<span class="time">' + time + '</span>' +
      warn +
      '<span class="title">' + escapeHtml(e.title || '— без назви —') + '</span>' +
      '</div>';
  }

  function renderWeek(events) {
    var weekStart = startOfWeekMon(state.cursor);
    var todayYmd = ymd(new Date());
    var h = ['<div class="uc-week">'];
    h.push('<div class="uc-hour"></div>');
    for (var d = 0; d < 7; d++) {
      var day = addDays(weekStart, d);
      var isToday = ymd(day) === todayYmd;
      h.push('<div class="uc-wd-head ' + (isToday ? 'today' : '') + '">' + dayOfWeekShort(day) + ' ' + ddmm(day) + '</div>');
    }
    for (var hr = 6; hr < 24; hr++) {
      h.push('<div class="uc-hour">' + (hr < 10 ? '0' + hr : hr) + ':00</div>');
      for (var d2 = 0; d2 < 7; d2++) {
        var day2 = addDays(weekStart, d2);
        var dayYmd2 = ymd(day2);
        var inHour = events.filter(function (e) {
          var dt = new Date(e.scheduled_at);
          return ymd(dt) === dayYmd2 && (+hhmm(dt).slice(0, 2)) === hr;
        });
        h.push('<div class="uc-cell">');
        inHour.forEach(function (e) { h.push(eventChipHtml(e)); });
        h.push('</div>');
      }
    }
    h.push('</div>');
    return h.join('');
  }

  function renderDay(events) {
    var todayKey = ymd(state.cursor);
    var todayEvents = events.filter(function (e) { return ymd(new Date(e.scheduled_at)) === todayKey; });
    var h = ['<div class="uc-day-view">'];
    h.push('<div class="uc-hour" style="background:#0a0a0a;"></div>');
    h.push('<div class="uc-cell" style="background:#0a0a0a;font-family:Oswald,sans-serif;font-weight:700;color:#fff;font-size:14px;padding:8px;">' + currentRangeLabel() + '</div>');
    for (var hr = 6; hr < 24; hr++) {
      var hrEvents = todayEvents.filter(function (e) {
        return (+hhmm(new Date(e.scheduled_at)).slice(0, 2)) === hr;
      });
      h.push('<div class="uc-hour">' + (hr < 10 ? '0' + hr : hr) + ':00</div>');
      h.push('<div class="uc-cell">');
      hrEvents.forEach(function (e) { h.push(eventChipHtml(e)); });
      h.push('</div>');
    }
    h.push('</div>');
    return h.join('');
  }

  function renderGrid(events) {
    var weekStart = startOfWeekMon(state.cursor);
    var todayYmd = ymd(new Date());
    var presentCh = {};
    events.forEach(function (e) { (e.channels || []).forEach(function (c) { presentCh[c] = true; }); });
    var chList = Object.keys(presentCh);
    if (!chList.length) chList = ['tg', 'ig', 'email'];
    chList.sort();
    // #366: minmax(0,1fr) щоб довгі назви events не виштовхували дні за overflow:hidden
    var h = ['<div class="uc-grid" style="grid-template-columns:140px repeat(7,minmax(0,1fr));">'];
    h.push('<div class="gch">КАНАЛ</div>');
    for (var d = 0; d < 7; d++) {
      var day = addDays(weekStart, d);
      var isToday = ymd(day) === todayYmd;
      h.push('<div class="gh ' + (isToday ? 'today' : '') + '">' + dayOfWeekShort(day) + ' ' + ddmm(day) + '</div>');
    }
    chList.forEach(function (ch) {
      var icon = CHANNEL_LABEL[ch] || '🔗';
      var name = CHANNEL_NAME[ch] || ch.toUpperCase();
      h.push('<div class="gch"><span style="font-size:18px;margin-right:6px;">' + icon + '</span>' + name + '</div>');
      for (var d2 = 0; d2 < 7; d2++) {
        var day2 = addDays(weekStart, d2);
        var dayYmd2 = ymd(day2);
        var cellEvents = events.filter(function (e) {
          return (e.channels || []).indexOf(ch) >= 0 && ymd(new Date(e.scheduled_at)) === dayYmd2;
        }).sort(function (a, b) { return new Date(a.scheduled_at) - new Date(b.scheduled_at); });
        h.push('<div class="gc">');
        cellEvents.forEach(function (e) {
          var time = hhmm(new Date(e.scheduled_at));
          var warn = e.hasConflict ? ' ⚠' : '';
          h.push('<div class="grid-event src-' + e.source + (e.hasConflict ? ' has-conflict' : '') + '" data-evid="' + e.id + '" data-src="' + e.source + '" title="' + escapeHtml(e.title) + '">' + time + warn + ' ' + escapeHtml((e.title || '').slice(0, 40)) + '</div>');
        });
        h.push('</div>');
      }
    });
    h.push('</div>');
    return h.join('');
  }

  function renderList(events) {
    events = events.slice().sort(function (a, b) { return new Date(a.scheduled_at) - new Date(b.scheduled_at); });
    var h = ['<div class="uc-list">'];
    if (!events.length) {
      h.push('<div class="row" style="grid-template-columns:1fr;color:#666;text-align:center;padding:24px;">Подій немає у вибраному періоді.</div>');
    }
    events.forEach(function (e) {
      var dt = new Date(e.scheduled_at);
      var when = ddmm(dt) + ' ' + hhmm(dt);
      // #364: emoji-піктограми каналів замість літер · #420: TG-канал vs TG-бот
      var chips = (e.channels || []).map(function (c) { return chEmoji(c, e.source); }).join(' ');
      h.push('<div class="row ' + (e.hasConflict ? 'has-conflict' : '') + '" data-evid="' + e.id + '" data-src="' + e.source + '">');
      h.push('<div class="when">' + when + '</div>');
      h.push('<div class="src src-' + e.source + '">' + SOURCE_LABEL[e.source] + '</div>');
      h.push('<div class="title">' + escapeHtml(e.title || '— без назви —') + '</div>');
      h.push('<div class="channels">' + chips + '</div>');
      h.push('<div class="who">' + escapeHtml(e.owner_name || '—') + '</div>');
      h.push('<div class="warn">' + (e.hasConflict ? '⚠' : '') + '</div>');
      h.push('</div>');
    });
    h.push('</div>');
    return h.join('');
  }

  function openPreview(evid, src) {
    var ev = state.events.find(function (e) { return e.id === evid && e.source === src; });
    if (!ev) return;
    state.selected = ev;
    var body = document.getElementById('ucPreviewBody');
    var dt = new Date(ev.scheduled_at);
    var statusLbl = STATUS_LABEL[ev.status] || ev.status;
    var openHref = ev.source === 'smm'
      ? '/hq/#publication/' + ev.id
      : '/retention/#message/' + ev.id;
    var conflictsHtml = '';
    if (ev.conflicts && ev.conflicts.length) {
      conflictsHtml = '<div class="conflict-box"><b>⚠ Конфлікти каналу:</b><br>' +
        ev.conflicts.map(function (c) { return '• ' + c.channel.toUpperCase() + ': « ' + escapeHtml((c.partnerTitle || '').slice(0, 60)) + ' » (' + c.diffMin + ' хв)'; }).join('<br>') +
        '</div>';
    }
    var html = [
      '<h2>' + escapeHtml(ev.title || '— без назви —') + '</h2>',
      '<div class="row"><span class="lbl">СИСТЕМА</span><span style="color:' + SOURCE_COLOR[ev.source] + ';font-weight:700;">' + SOURCE_LABEL[ev.source] + '</span></div>',
      '<div class="row"><span class="lbl">КОЛИ</span><span>' + ddmm(dt) + ' · ' + hhmm(dt) + '</span></div>',
      '<div class="row"><span class="lbl">КАНАЛИ</span><span>' + (ev.channels || []).map(function (c) { return chEmoji(c, ev.source) + ' ' + chFullName(c, ev.source); }).join(' · ') + '</span></div>',
      '<div class="row"><span class="lbl">ТИП</span><span>' + (ev.ctype || '—').toUpperCase() + '</span></div>',
      '<div class="row"><span class="lbl">СТАТУС</span><span>' + statusLbl + '</span></div>',
      '<div class="row"><span class="lbl">ВИКОНАВЕЦЬ</span><span>' + escapeHtml(ev.owner_name || '—') + '</span></div>',
      conflictsHtml,
      '<div class="actions">',
      '<a href="' + openHref + '" class="btn primary" target="_blank">↗ Відкрити у ' + SOURCE_LABEL[ev.source] + '</a>',
      '<button class="btn" id="ucReschedule">⏰ Перенести час</button>',
      '<button class="btn" id="ucClosePreview">Закрити</button>',
      '</div>',
    ].join('');
    body.innerHTML = html;
    document.getElementById('ucPreview').classList.add('show');
    document.getElementById('ucClosePreview').addEventListener('click', function () {
      document.getElementById('ucPreview').classList.remove('show');
    });
    document.getElementById('ucReschedule').addEventListener('click', function () {
      rescheduleEvent(ev);
    });
  }

  async function rescheduleEvent(ev) {
    var dt = new Date(ev.scheduled_at);
    var localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
    var localTime = hhmm(dt);
    var input = prompt('Новий час публікації (YYYY-MM-DD HH:MM, Europe/Kyiv):', localDate + ' ' + localTime);
    if (!input) return;
    var match = input.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!match) { alert('Невірний формат. Має бути YYYY-MM-DD HH:MM'); return; }
    var newIso = match[1] + '-' + match[2] + '-' + match[3] + 'T' + match[4] + ':' + match[5] + ':00+03:00';
    try {
      var rpc = await window.supabase.rpc('unified_reschedule', {
        p_source: ev.source,
        p_id: ev.id,
        p_new_at: newIso,
      });
      if (rpc.error || (rpc.data && rpc.data.ok === false)) {
        alert('Помилка: ' + (rpc.error?.message || rpc.data?.err || 'unknown'));
        return;
      }
      document.getElementById('ucPreview').classList.remove('show');
      await render();
    } catch (e) {
      alert('Помилка: ' + e.message);
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-view]').forEach(function (el) {
      el.addEventListener('click', function () { state.view = el.dataset.view; savePrefs(); render(); });
    });
    document.querySelectorAll('[data-nav]').forEach(function (el) {
      el.addEventListener('click', function () {
        var dir = el.dataset.nav;
        if (dir === 'today') state.cursor = new Date();
        else {
          var step = dir === 'next' ? 1 : -1;
          if (state.view === 'month') state.cursor = addMonths(state.cursor, step);
          else if (state.view === 'day') state.cursor = addDays(state.cursor, step);
          else state.cursor = addDays(state.cursor, step * 7);
        }
        render();
      });
    });
    document.querySelectorAll('[data-source]').forEach(function (el) {
      el.addEventListener('click', function () {
        var src = el.dataset.source;
        var i = state.filters.sources.indexOf(src);
        if (i >= 0) state.filters.sources.splice(i, 1);
        else state.filters.sources.push(src);
        savePrefs();
        render();
      });
    });
    var ownerSel = document.getElementById('ucOwnerSel');
    if (ownerSel) ownerSel.addEventListener('change', function () {
      state.filters.owners = ownerSel.value ? [ownerSel.value] : [];
      savePrefs(); render();
    });
    var chSel = document.getElementById('ucChannelSel');
    if (chSel) chSel.addEventListener('change', function () {
      state.filters.channels = chSel.value ? [chSel.value] : [];
      savePrefs(); render();
    });
    var confT = document.getElementById('ucConflictToggle');
    if (confT) confT.addEventListener('click', function () {
      state.filters.onlyConflicts = !state.filters.onlyConflicts;
      savePrefs(); render();
    });
    document.querySelectorAll('[data-evid]').forEach(function (el) {
      el.addEventListener('click', function () {
        openPreview(el.dataset.evid, el.dataset.src);
      });
    });
    var backdrop = document.getElementById('ucPreview');
    if (backdrop) backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) backdrop.classList.remove('show');
    });
  }

  window.dcUnifiedCalendar = {
    open: async function () {
      loadPrefs();
      await render();
    },
  };
})();
