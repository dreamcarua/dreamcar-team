/* ============================================================
   DreamCar HQ — Analytics (C2 + §13.2 метрики успіху пілота)
   ============================================================ */
// Окрема сторінка #analytics з KPI cards + графіками:
//   • Частка публікацій, що пройшли через систему (created in HQ)
//   • Частка погоджених через систему (status=approved або published)
//   • Середній час погодження (review → approved)
//   • Частка пропущених публікацій (publish_at < now AND status != published)
//   • Втрачені креативи (creatives без посилання)
//   • Графік: публікації по місяцях × платформах
//   • Топ-перформери (по responsibles — хто скільки публікацій провів)

(function () {
  if (window.__hqAnalyticsLoaded) return;
  window.__hqAnalyticsLoaded = true;

  function getStore() { try { return Store; } catch (_) { return null; } }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- CSS ----
  (function () {
    if (document.getElementById('hq-an-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-an-css';
    css.textContent =
      '.an-wrap { padding: 18px 28px 32px; }' +
      '.an-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }' +
      '.an-kpi { background: var(--bg-2); border: 1px solid var(--border); border-radius: 10px; padding: 16px 18px; }' +
      '.an-kpi.good { border-left: 3px solid var(--green); }' +
      '.an-kpi.warn { border-left: 3px solid var(--gold); }' +
      '.an-kpi.bad  { border-left: 3px solid var(--red); }' +
      '.an-kpi .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--grey); margin-bottom: 6px; }' +
      '.an-kpi .val { font-size: 24px; font-weight: 800; color: #fff; line-height: 1.1; }' +
      '.an-kpi .sub { font-size: 11px; color: var(--grey); margin-top: 4px; }' +
      '.an-kpi .target { font-size: 10px; color: var(--gold); margin-top: 4px; }' +
      '.an-section { background: var(--bg-2); border: 1px solid var(--border); border-radius: 10px; padding: 18px 22px; margin-bottom: 20px; }' +
      '.an-section h3 { font-size: 14px; font-weight: 800; color: #fff; margin-bottom: 14px; }' +
      '.an-section h3 .meta { font-size: 11px; color: var(--grey); font-weight: 400; margin-left: 8px; }' +
      '.an-chart { display: flex; flex-direction: column; gap: 10px; }' +
      '.an-row { display: grid; grid-template-columns: 110px 1fr 60px; align-items: center; gap: 10px; font-size: 12px; }' +
      '.an-row .label { color: #ddd; }' +
      '.an-row .bar { background: var(--bg-3); height: 18px; border-radius: 3px; overflow: hidden; position: relative; }' +
      '.an-row .fill { height: 100%; background: linear-gradient(90deg, var(--red), var(--red-soft)); transition: width 0.3s; }' +
      '.an-row .val { text-align: right; color: #fff; font-weight: 700; font-variant-numeric: tabular-nums; }' +
      '.an-stack { display: flex; height: 22px; border-radius: 3px; overflow: hidden; background: var(--bg-3); }' +
      '.an-stack span { display: block; height: 100%; font-size: 9px; color: rgba(255,255,255,0.7); text-align: center; line-height: 22px; min-width: 2px; }' +
      '.an-stack .ig { background: #e1306c; }' +
      '.an-stack .tg { background: #0088cc; }' +
      '.an-stack .tt { background: #69c9d0; }' +
      '.an-stack .yt { background: #ff0000; }' +
      '.an-stack .fb { background: #1877f2; }' +
      '.an-stack .th { background: #888; }' +
      '.an-legend { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 10px; font-size: 11px; }' +
      '.an-legend .li { display: inline-flex; align-items: center; gap: 5px; color: var(--grey); }' +
      '.an-legend .sw { width: 10px; height: 10px; border-radius: 2px; }';
    document.head.appendChild(css);
  })();

  function pct(n, total) { return total > 0 ? Math.round((n / total) * 100) : 0; }

  function compute() {
    var s = getStore();
    if (!s) return null;
    var pubs = (s.pubs && s.pubs()) || [];
    pubs = pubs.filter(function (p) { return p && !p._trashed; });
    var creatives = (s.creatives && s.creatives()) || [];
    var users = (s.users && s.users()) || [];
    var now = new Date();

    var total = pubs.length;
    var approvedOrPublished = pubs.filter(function (p) { return p.status === 'approved' || p.status === 'published'; }).length;
    var missed = pubs.filter(function (p) {
      return new Date(p.dateTime) < now && p.status !== 'published';
    }).length;
    var inReview = pubs.filter(function (p) { return p.status === 'review'; }).length;

    var reviewToApprove = [];
    pubs.forEach(function (p) {
      var hist = p.history || [];
      var revAt = null;
      hist.forEach(function (h) {
        if (h.action === 'status' && /review/i.test(h.detail || '')) revAt = new Date(h.at);
        if (h.action === 'status' && /approved/i.test(h.detail || '') && revAt) {
          reviewToApprove.push(new Date(h.at) - revAt);
          revAt = null;
        }
      });
    });
    var avgMs = reviewToApprove.length ? reviewToApprove.reduce(function (a, b) { return a + b; }, 0) / reviewToApprove.length : 0;
    var avgHrs = avgMs > 0 ? Math.round(avgMs / 3600000 * 10) / 10 : null;

    var creBroken = creatives.filter(function (c) { return c && !c.url; }).length;

    var byMonth = {};
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var key = d.toISOString().slice(0, 7);
      byMonth[key] = { _label: d.toLocaleDateString('uk-UA', { month: 'short', year: '2-digit' }) };
    }
    pubs.forEach(function (p) {
      var key = (p.dateTime || '').slice(0, 7);
      if (!byMonth[key]) return;
      (p.platforms || []).forEach(function (plat) {
        byMonth[key][plat] = (byMonth[key][plat] || 0) + 1;
      });
    });

    var byUser = {};
    pubs.forEach(function (p) {
      (p.responsibles || []).forEach(function (uid) {
        byUser[uid] = (byUser[uid] || 0) + 1;
      });
    });
    var topUsers = Object.entries(byUser)
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, 5)
      .map(function (e) {
        var u = users.find(function (x) { return x.id === e[0]; });
        return { name: u ? (u.name || u.email) : '—', count: e[1] };
      });

    return {
      total: total,
      throughSystem: pct(total, total),
      approved: approvedOrPublished, approvedPct: pct(approvedOrPublished, total),
      missed: missed, missedPct: pct(missed, total),
      inReview: inReview,
      avgHrs: avgHrs,
      creativesTotal: creatives.length,
      creativesBroken: creBroken,
      byMonth: byMonth,
      topUsers: topUsers,
    };
  }

  function renderKpi(stats) {
    function box(label, val, sub, cls, target) {
      cls = cls || '';
      return '<div class="an-kpi ' + cls + '">' +
        '<div class="lbl">' + escapeHtml(label) + '</div>' +
        '<div class="val">' + val + '</div>' +
        (sub ? '<div class="sub">' + escapeHtml(sub) + '</div>' : '') +
        (target ? '<div class="target">🎯 ' + escapeHtml(target) + '</div>' : '') +
        '</div>';
    }
    return '<div class="an-kpi-grid">' +
      box('Всього публікацій', stats.total, '', '') +
      box('Через HQ', stats.throughSystem + '%', '', stats.throughSystem >= 90 ? 'good' : 'warn', 'мета ≥ 90%') +
      box('Погоджено', stats.approvedPct + '%', stats.approved + ' з ' + stats.total, stats.approvedPct >= 80 ? 'good' : 'warn', 'мета ≥ 80%') +
      box('Пропущено', stats.missedPct + '%', stats.missed + ' постів', stats.missedPct <= 2 ? 'good' : (stats.missedPct <= 10 ? 'warn' : 'bad'), 'мета ≤ 2%') +
      box('Avg time-to-approve', stats.avgHrs !== null ? stats.avgHrs + ' год' : '—', '', (stats.avgHrs !== null && stats.avgHrs <= 24) ? 'good' : 'warn', 'мета ≤ 24 год') +
      box('На погодженні', stats.inReview, '', stats.inReview > 0 ? 'warn' : '') +
      box('Креативів', stats.creativesTotal, stats.creativesBroken > 0 ? stats.creativesBroken + ' зламані' : 'всі цілі', stats.creativesBroken === 0 ? 'good' : 'bad') +
      '</div>';
  }

  function renderMonthly(stats) {
    var rows = Object.entries(stats.byMonth).map(function (e) {
      var m = e[1];
      var total = ['ig', 'tg', 'tt', 'yt', 'fb', 'th'].reduce(function (a, p) { return a + (m[p] || 0); }, 0);
      if (total === 0) {
        return '<div class="an-row"><div class="label">' + escapeHtml(m._label) + '</div>' +
          '<div class="bar"><div class="fill" style="width:0%"></div></div>' +
          '<div class="val">0</div></div>';
      }
      var stack = ['ig', 'tg', 'tt', 'yt', 'fb', 'th'].map(function (p) {
        if (!m[p]) return '';
        var w = (m[p] / total) * 100;
        return '<span class="' + p + '" style="width:' + w + '%">' + m[p] + '</span>';
      }).join('');
      return '<div class="an-row">' +
        '<div class="label">' + escapeHtml(m._label) + '</div>' +
        '<div class="an-stack">' + stack + '</div>' +
        '<div class="val">' + total + '</div>' +
        '</div>';
    }).join('');
    return '<div class="an-section">' +
      '<h3>📊 Публікації по місяцях × платформах <span class="meta">останні 6 міс</span></h3>' +
      '<div class="an-chart">' + rows + '</div>' +
      '<div class="an-legend">' +
        '<span class="li"><span class="sw" style="background:#e1306c"></span>Instagram</span>' +
        '<span class="li"><span class="sw" style="background:#0088cc"></span>Telegram</span>' +
        '<span class="li"><span class="sw" style="background:#69c9d0"></span>TikTok</span>' +
        '<span class="li"><span class="sw" style="background:#ff0000"></span>YT Shorts</span>' +
        '<span class="li"><span class="sw" style="background:#1877f2"></span>Facebook</span>' +
        '<span class="li"><span class="sw" style="background:#888"></span>Threads</span>' +
      '</div>' +
      '</div>';
  }

  function renderTop(stats) {
    if (stats.topUsers.length === 0) return '';
    var max = stats.topUsers[0].count;
    var rows = stats.topUsers.map(function (u) {
      var w = (u.count / max) * 100;
      return '<div class="an-row">' +
        '<div class="label">' + escapeHtml(u.name) + '</div>' +
        '<div class="bar"><div class="fill" style="width:' + w + '%"></div></div>' +
        '<div class="val">' + u.count + '</div>' +
        '</div>';
    }).join('');
    return '<div class="an-section">' +
      '<h3>🏆 Топ виконавців <span class="meta">за кількістю публікацій</span></h3>' +
      '<div class="an-chart">' + rows + '</div>' +
      '</div>';
  }

  function renderTargets() {
    return '<div class="an-section">' +
      '<h3>🎯 Метрики успіху пілота <span class="meta">за ТЗ §13.2</span></h3>' +
      '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
        '<tr style="border-bottom:1px solid var(--border);"><th style="text-align:left;padding:6px 8px;color:var(--grey);">Метрика</th><th style="text-align:right;padding:6px 8px;color:var(--grey);">Ціль</th></tr>' +
        '<tr><td style="padding:6px 8px;">Частка публікацій через систему</td><td style="text-align:right;padding:6px 8px;color:var(--green-soft)">≥ 90%</td></tr>' +
        '<tr><td style="padding:6px 8px;">Частка погоджених через систему</td><td style="text-align:right;padding:6px 8px;color:var(--green-soft)">≥ 80%</td></tr>' +
        '<tr><td style="padding:6px 8px;">Середній час погодження</td><td style="text-align:right;padding:6px 8px;color:var(--green-soft)">≤ 24 год</td></tr>' +
        '<tr><td style="padding:6px 8px;">Частка пропущених публікацій</td><td style="text-align:right;padding:6px 8px;color:var(--green-soft)">≤ 2%</td></tr>' +
        '<tr><td style="padding:6px 8px;">Втрачені креативи</td><td style="text-align:right;padding:6px 8px;color:var(--green-soft)">0 випадків</td></tr>' +
        '<tr><td style="padding:6px 8px;">Час пошуку креативу</td><td style="text-align:right;padding:6px 8px;color:var(--green-soft)">≤ 30 сек</td></tr>' +
        '<tr><td style="padding:6px 8px;">NPS команди</td><td style="text-align:right;padding:6px 8px;color:var(--green-soft)">≥ 7 з 10</td></tr>' +
      '</table>' +
      '</div>';
  }

  function renderAnalytics(root) {
    var stats = compute();
    if (!stats) {
      root.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><div class="empty-title">Аналітика недоступна</div><div>Store ще не ініціалізований</div></div>';
      return;
    }
    root.innerHTML =
      '<div class="view-header">' +
        '<h1>📊 Аналітика</h1>' +
        '<span class="view-meta">· ' + stats.total + ' публікацій · ' + stats.creativesTotal + ' креативів</span>' +
      '</div>' +
      '<div class="an-wrap">' +
        renderKpi(stats) +
        renderMonthly(stats) +
        renderTop(stats) +
        renderTargets() +
      '</div>';
  }
  window.renderAnalytics = renderAnalytics;

  function injectSidebar() {
    if (document.querySelector('.sidebar a[data-route="analytics"]')) return;
    var settingsLink = document.querySelector('.sidebar a[data-route="settings"]');
    if (!settingsLink) return;
    var a = document.createElement('a');
    a.className = 'nav-item';
    a.dataset.route = 'analytics';
    a.href = '#analytics';
    a.innerHTML = '<span class="ico">📊</span><span class="label">Аналітика</span>';
    settingsLink.parentNode.insertBefore(a, settingsLink);
  }
  [200, 800, 1800].forEach(function (ms) { setTimeout(injectSidebar, ms); });

  function maybeRoute() {
    var route = (location.hash || '').slice(1).split('/')[0];
    if (route !== 'analytics') return;
    var main = document.getElementById('main');
    if (!main) return;
    document.querySelectorAll('.sidebar a.nav-item').forEach(function (x) { x.classList.remove('active'); });
    var lnk = document.querySelector('.sidebar a[data-route="analytics"]');
    if (lnk) lnk.classList.add('active');
    var bc = document.getElementById('breadcrumb');
    if (bc) bc.innerHTML = 'Стіл SMM · <b>Аналітика</b>';
    renderAnalytics(main);
  }
  window.addEventListener('hashchange', maybeRoute);
  [400, 1500].forEach(function (ms) { setTimeout(maybeRoute, ms); });

  if (window.DEBUG) console.log('%cDreamCar HQ Analytics %c· KPI dashboard ready', 'color:#4ade80;font-weight:700;', 'color:#888;');
})();
