/* ============================================================
   DreamCar HQ — Analytics v2 (#126)
   ============================================================ */
// Розширює існуючий розділ Аналітика додатковими картками:
//   1. Time-in-status — середній час публікації у кожному статусі
//      (draft → in_work → review → approved → published)
//   2. Rework cycles — середня кількість циклів «доопрацювання»
//      на публікацію + Top-5 публікацій з найбільшою кількістю reworks
//   3. Pipeline velocity — публікацій approved/published за тиждень
//      (за останні 8 тижнів, гістограма)
//
// Бере дані з window.Store: pubs, history.
// Рендериться у блок #analytics-v2 у в'юшці Аналітика.

(function () {
  if (window.__hqAnalyticsV2) return;
  window.__hqAnalyticsV2 = true;

  function safeStore() {
    try { return typeof Store !== 'undefined' ? Store : window.Store; }
    catch (_) { return window.Store; }
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function fmtHours(ms) {
    if (!ms || isNaN(ms) || ms < 0) return '—';
    var h = ms / 3600000;
    if (h < 1) return Math.round(h * 60) + ' хв';
    if (h < 24) return h.toFixed(1) + ' год';
    var d = h / 24;
    if (d < 7) return d.toFixed(1) + ' дн';
    return (d / 7).toFixed(1) + ' тиж';
  }

  function startOfWeek(date) {
    var d = new Date(date);
    var day = d.getDay() || 7;
    d.setHours(0, 0, 0, 0);
    if (day !== 1) d.setDate(d.getDate() - (day - 1));
    return d;
  }

  function computeTimeInStatus() {
    var S = safeStore();
    if (!S || !S.allPubs) return null;
    var pubs = S.allPubs().filter(function(p){ return !p.deletedAt; });
    var statusTotals = { draft: 0, in_work: 0, review: 0, approved: 0, rework: 0 };
    var statusCounts = { draft: 0, in_work: 0, review: 0, approved: 0, rework: 0 };

    pubs.forEach(function(p) {
      var hist = (S.allHistory ? S.allHistory(p.id) : []) || [];
      hist = hist.slice().sort(function(a,b){
        return new Date(a.at || a.created_at || 0) - new Date(b.at || b.created_at || 0);
      });

      var prevTime = new Date(p.createdAt || p.created_at).getTime();
      var prevStatus = 'draft';

      hist.forEach(function(h) {
        var act = (h.action || '').toLowerCase();
        var newStatus = null;
        if (act === 'submit' || act === 'send_to_review' || act.indexOf('review') >= 0) newStatus = 'review';
        else if (act === 'approve' || act === 'approved') newStatus = 'approved';
        else if (act === 'reject' || act === 'rework') newStatus = 'rework';
        else if (act === 'start_work' || act === 'in_work') newStatus = 'in_work';
        else if (act === 'publish' || act === 'published') newStatus = 'published';
        if (!newStatus) return;

        var t = new Date(h.at || h.created_at).getTime();
        var dur = t - prevTime;
        if (dur > 0 && prevStatus in statusTotals) {
          statusTotals[prevStatus] += dur;
          statusCounts[prevStatus]++;
        }
        prevTime = t;
        prevStatus = newStatus;
      });

      if (p.status !== 'published' && prevStatus in statusTotals) {
        var dur = Date.now() - prevTime;
        if (dur > 0) {
          statusTotals[prevStatus] += dur;
          statusCounts[prevStatus]++;
        }
      }
    });

    var avg = {};
    Object.keys(statusTotals).forEach(function(s){
      avg[s] = statusCounts[s] > 0 ? statusTotals[s] / statusCounts[s] : 0;
    });
    return { avg: avg, counts: statusCounts };
  }

  function computeReworkCycles() {
    var S = safeStore();
    if (!S || !S.allPubs) return null;
    var pubs = S.allPubs().filter(function(p){ return !p.deletedAt; });
    var perPub = {};

    pubs.forEach(function(p) {
      var hist = (S.allHistory ? S.allHistory(p.id) : []) || [];
      var rejects = hist.filter(function(h){ return (h.action || '').toLowerCase() === 'reject'; }).length;
      perPub[p.id] = { title: p.title, rejects: rejects };
    });

    var counts = Object.values(perPub).map(function(x){ return x.rejects; });
    var avgRework = counts.length > 0 ? counts.reduce(function(a,b){ return a+b; }, 0) / counts.length : 0;

    var top = Object.values(perPub)
      .filter(function(x){ return x.rejects > 0; })
      .sort(function(a,b){ return b.rejects - a.rejects; })
      .slice(0, 5);

    return { avg: avgRework, total: counts.reduce(function(a,b){ return a+b; }, 0), top: top };
  }

  function computeVelocity() {
    var S = safeStore();
    if (!S || !S.allPubs) return null;
    var pubs = S.allPubs().filter(function(p){ return !p.deletedAt; });
    var now = new Date();
    var weeks = [];
    for (var i = 7; i >= 0; i--) {
      var start = startOfWeek(new Date(now.getTime() - i * 7 * 86400000));
      weeks.push({
        label: String(start.getDate()).padStart(2, '0') + '.' + String(start.getMonth()+1).padStart(2, '0'),
        start: start.getTime(),
        end: start.getTime() + 7 * 86400000,
        approved: 0,
        published: 0,
      });
    }

    pubs.forEach(function(p) {
      var hist = (S.allHistory ? S.allHistory(p.id) : []) || [];
      hist.forEach(function(h) {
        var act = (h.action || '').toLowerCase();
        var t = new Date(h.at || h.created_at).getTime();
        weeks.forEach(function(w) {
          if (t >= w.start && t < w.end) {
            if (act === 'approve' || act === 'approved') w.approved++;
            if (act === 'publish' || act === 'published') w.published++;
          }
        });
      });
      if (p.status === 'published' && p.publishedAt) {
        var t = new Date(p.publishedAt).getTime();
        var hasInHist = false;
        hist.forEach(function(h){
          var act = (h.action || '').toLowerCase();
          if (act === 'publish' || act === 'published') hasInHist = true;
        });
        if (!hasInHist) {
          weeks.forEach(function(w){
            if (t >= w.start && t < w.end) w.published++;
          });
        }
      }
    });

    return weeks;
  }

  var STATUS_COLORS = {
    draft: '#7a7a8a',
    in_work: '#5a8fb8',
    review: '#fbbf24',
    approved: '#22c55e',
    rework: '#E30613',
  };

  var STATUS_LABELS = {
    draft: '📝 Чернетка',
    in_work: '⚙️ В роботі',
    review: '👀 На погодженні',
    approved: '✅ Погоджено',
    rework: '↩️ Доопрацювання',
  };

  function renderTimeInStatus(data) {
    if (!data) return '';
    var max = Math.max.apply(null, Object.values(data.avg)) || 1;
    var rows = Object.keys(STATUS_LABELS).map(function(s) {
      var v = data.avg[s] || 0;
      var c = data.counts[s] || 0;
      var pct = max > 0 ? Math.round(v / max * 100) : 0;
      return '<div style="display:grid;grid-template-columns:160px 1fr 90px;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' +
        '<div style="font-size:13px;color:var(--bone,#ccc);">' + STATUS_LABELS[s] + '</div>' +
        '<div style="height:10px;background:rgba(255,255,255,0.05);border-radius:5px;overflow:hidden;"><div style="width:' + pct + '%;height:100%;background:' + STATUS_COLORS[s] + ';"></div></div>' +
        '<div style="font-size:12px;color:var(--white,#fff);text-align:right;font-family:JetBrains Mono,monospace;">' + fmtHours(v) + ' <span style="color:var(--grey,#888);">(' + c + ')</span></div>' +
      '</div>';
    }).join('');

    return '<div class="hq-an-card" style="background:var(--bg-2,#11111a);border:1px solid var(--border,#232338);border-radius:12px;padding:20px;margin-bottom:16px;">' +
      '<h3 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:1px;">⏱ Середній час у статусі</h3>' +
      '<div style="font-size:11px;color:var(--grey,#888);margin-bottom:14px;">Скільки в середньому пост стоїть у кожному статусі. У дужках — скільки публікацій пройшло через статус.</div>' +
      rows +
    '</div>';
  }

  function renderReworkCycles(data) {
    if (!data) return '';
    var topHtml = data.top.length === 0
      ? '<div style="font-size:12px;color:var(--grey,#888);font-style:italic;padding:10px 0;">🎉 Жодна публікація не була повернена. Чудова робота команди!</div>'
      : data.top.map(function(x){
          return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);">' +
            '<span style="color:var(--bone,#ccc);font-size:13px;">' + escHtml(x.title) + '</span>' +
            '<span style="color:#E30613;font-weight:700;font-family:JetBrains Mono,monospace;font-size:13px;">' + x.rejects + '×</span>' +
          '</div>';
        }).join('');

    return '<div class="hq-an-card" style="background:var(--bg-2,#11111a);border:1px solid var(--border,#232338);border-radius:12px;padding:20px;margin-bottom:16px;">' +
      '<h3 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:1px;">↩️ Цикли доопрацювань</h3>' +
      '<div style="font-size:11px;color:var(--grey,#888);margin-bottom:14px;">Скільки разів пости в середньому повертались на доопрацювання.</div>' +
      '<div style="display:flex;gap:24px;margin-bottom:18px;">' +
        '<div><div style="font-size:11px;color:var(--grey,#888);">У середньому</div><div style="font-size:24px;font-weight:700;color:#fff;font-family:JetBrains Mono,monospace;">' + data.avg.toFixed(2) + '×</div></div>' +
        '<div><div style="font-size:11px;color:var(--grey,#888);">Загалом reworks</div><div style="font-size:24px;font-weight:700;color:#fff;font-family:JetBrains Mono,monospace;">' + data.total + '</div></div>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--grey,#888);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Top-5 з найбільшою кількістю reworks:</div>' +
      topHtml +
    '</div>';
  }

  function renderVelocity(weeks) {
    if (!weeks) return '';
    var maxAppr = Math.max.apply(null, weeks.map(function(w){ return w.approved; })) || 1;
    var maxPub = Math.max.apply(null, weeks.map(function(w){ return w.published; })) || 1;
    var max = Math.max(maxAppr, maxPub) || 1;

    var bars = weeks.map(function(w){
      var pctApr = Math.round(w.approved / max * 100);
      var pctPub = Math.round(w.published / max * 100);
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">' +
        '<div style="display:flex;align-items:end;gap:2px;height:140px;">' +
          '<div title="approved" style="width:14px;height:' + pctApr + '%;background:#22c55e;border-radius:2px 2px 0 0;"></div>' +
          '<div title="published" style="width:14px;height:' + pctPub + '%;background:#E30613;border-radius:2px 2px 0 0;"></div>' +
        '</div>' +
        '<div style="font-size:10px;color:var(--grey,#888);font-family:JetBrains Mono,monospace;">' + w.label + '</div>' +
        '<div style="font-size:10px;color:#22c55e;">' + w.approved + '/' + w.published + '</div>' +
      '</div>';
    }).join('');

    return '<div class="hq-an-card" style="background:var(--bg-2,#11111a);border:1px solid var(--border,#232338);border-radius:12px;padding:20px;margin-bottom:16px;">' +
      '<h3 style="font-size:14px;font-weight:700;color:#fff;margin:0 0 4px 0;text-transform:uppercase;letter-spacing:1px;">🚀 Pipeline Velocity (8 тижнів)</h3>' +
      '<div style="font-size:11px;color:var(--grey,#888);margin-bottom:14px;">Зелений — погоджено · червоний — опубліковано · числа під стовпцями = approved/published</div>' +
      '<div style="display:flex;gap:6px;align-items:end;justify-content:space-between;">' + bars + '</div>' +
    '</div>';
  }

  function mount() {
    var view = document.getElementById('main');
    if (!view) return;
    var hash = (location.hash || '').slice(1);
    if (hash.indexOf('analytics') !== 0 && hash !== 'analytics') return;

    var existing = document.getElementById('analytics-v2');
    if (existing) existing.remove();

    var container = document.createElement('div');
    container.id = 'analytics-v2';
    container.style.cssText = 'margin-top:24px;padding:0 20px;';

    var t = computeTimeInStatus();
    var r = computeReworkCycles();
    var v = computeVelocity();

    container.innerHTML =
      '<div style="margin-bottom:16px;padding:12px 16px;background:linear-gradient(90deg,rgba(216,0,4,0.15),rgba(216,0,4,0));border-left:3px solid #E30613;border-radius:0 8px 8px 0;">' +
        '<div style="font-family:JetBrains Mono,monospace;font-size:11px;color:#E30613;letter-spacing:1.5px;text-transform:uppercase;">/// ANALYTICS V2 · #126</div>' +
        '<div style="font-size:14px;color:#fff;margin-top:4px;">Time-in-status · Rework cycles · Pipeline velocity</div>' +
      '</div>' +
      renderTimeInStatus(t) +
      renderReworkCycles(r) +
      renderVelocity(v);

    var existingAn = view.querySelector('.analytics-wrap, .analytics, [data-view="analytics"]');
    if (existingAn) {
      existingAn.appendChild(container);
    } else {
      view.appendChild(container);
    }
  }

  function tryMount() {
    var hash = (location.hash || '').slice(1);
    if (hash === 'analytics' || hash.indexOf('analytics/') === 0) {
      setTimeout(mount, 200);
      setTimeout(mount, 600);
      setTimeout(mount, 1200);
    }
  }

  window.addEventListener('hashchange', tryMount);
  setTimeout(tryMount, 500);

  if (window.Store && typeof window.Store.subscribe === 'function') {
    try {
      window.Store.subscribe(function(){
        var hash = (location.hash || '').slice(1);
        if (hash === 'analytics' || hash.indexOf('analytics/') === 0) {
          clearTimeout(window.__hqAnV2Tm);
          window.__hqAnV2Tm = setTimeout(mount, 300);
        }
      });
    } catch (_) {}
  }

  if (window.DEBUG) console.log('%cDreamCar HQ Analytics v2 %c· #126 time-in-status + rework + velocity',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
