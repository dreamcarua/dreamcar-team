/* ============================================================
   DreamCar HQ — Theme Polish v3 (контраст + brand consistency)
   ============================================================ */
// Брендбук DreamCar:
//   • Червоний: #d80004 (primary)
//   • Помаранчевий: #ff6a1f (accent)
//   • Темний bg: #0a0a0e / #141414 (motorsport mood)
//   • Брендовий градієнт: 135deg, #d80004 → #ff6a1f
//
// v3: додано attribute-selector override для INLINE style="color:#fff"/aaa/ddd
//     які присутні у app-views.js (модалки, бель сповіщень, селекти, lib creative)
//     та app-core (day view). Виключення: .avatar, .pv-avatar (текст на брендовому bg).

(function () {
  if (window.__hqThemePolish) return;
  window.__hqThemePolish = true;

  function inject() {
    var existing = document.getElementById('hq-theme-polish-css');
    if (existing) existing.remove();
    var css = document.createElement('style');
    css.id = 'hq-theme-polish-css';
    css.textContent =
      // =================================================================
      // DARK THEME — brand-aligned
      // =================================================================
      'body:not(.hq-light) .view-header h1 {' +
        'background: linear-gradient(90deg, #fff 30%, #ff6a1f 100%);' +
        '-webkit-background-clip: text;' +
        '-webkit-text-fill-color: transparent;' +
        'background-clip: text;' +
      '}' +
      'body:not(.hq-light) .sidebar a.nav-item.active {' +
        'background: linear-gradient(90deg, rgba(216,0,4,0.22), rgba(255,106,31,0.08)) !important;' +
        'border-left: 3px solid #ff6a1f !important;' +
        'color: #fff !important;' +
      '}' +
      'body:not(.hq-light) .sidebar a.nav-item:hover {' +
        'background: rgba(255,106,31,0.06) !important;' +
        'color: #fff !important;' +
      '}' +
      'body:not(.hq-light) .btn-primary, body:not(.hq-light) .pf-btn.on, body:not(.hq-light) .btn-segmented.on {' +
        'background: linear-gradient(135deg, #d80004 0%, #ff6a1f 100%) !important;' +
        'color: #fff !important;' +
        'border-color: #d80004 !important;' +
        'box-shadow: 0 6px 20px -6px rgba(216,0,4,0.6) !important;' +
        'font-weight: 700;' +
      '}' +
      'body:not(.hq-light) .btn-primary:hover {' +
        'filter: brightness(1.15);' +
        'box-shadow: 0 8px 26px -6px rgba(255,106,31,0.7) !important;' +
      '}' +
      'body:not(.hq-light) .status.approved {' +
        'background: rgba(74,222,128,0.18); color: #6ee7b7; border: 1px solid rgba(74,222,128,0.45);' +
      '}' +
      'body:not(.hq-light) .status.review {' +
        'background: linear-gradient(135deg, rgba(216,0,4,0.18), rgba(255,106,31,0.18));' +
        'color: #ff8e4a; border: 1px solid rgba(255,106,31,0.55);' +
        'box-shadow: 0 0 16px rgba(255,106,31,0.2);' +
      '}' +
      'body:not(.hq-light) .cal-day.today .day-num {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
        'color: #fff; box-shadow: 0 0 14px rgba(255,106,31,0.45);' +
      '}' +
      'body:not(.hq-light) .chip.on {' +
        'background: linear-gradient(135deg, rgba(216,0,4,0.25), rgba(255,106,31,0.18));' +
        'border-color: #ff6a1f; color: #fff;' +
      '}' +
      'body:not(.hq-light) .bell .badge {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
      '}' +

      // =================================================================
      // LIGHT THEME — COMPLETE OVERRIDE
      // =================================================================
      'body.hq-light {' +
        '--bg: #ffffff; --bg-2: #ffffff; --bg-3: #f5f5f7; --bg-4: #ebebee;' +
        '--bg-hover: #f0f0f5; --border: #d8d8de; --border-2: #c0c0c8;' +
        '--grey: #4a4a55; --grey-2: #6b6b75;' +
      '}' +
      'body.hq-light, body.hq-light .main {' +
        'background: #f5f5f7 !important; color: #0a0a0e !important;' +
      '}' +
      'body.hq-light .app, body.hq-light .topbar, body.hq-light .sidebar, body.hq-light .logo {' +
        'background: #ffffff !important; color: #0a0a0e !important; border-color: #d8d8de !important;' +
      '}' +
      'body.hq-light .logo-text { color: #0a0a0e !important; font-weight: 800; }' +
      'body.hq-light .logo-text .small { color: #6b6b75 !important; }' +
      'body.hq-light .view-header { background: #ffffff !important; border-bottom: 1px solid #d8d8de !important; }' +
      'body.hq-light .view-header h1 {' +
        'color: #0a0a0e !important; -webkit-text-fill-color: #0a0a0e !important;' +
        'background: none !important; font-weight: 800;' +
      '}' +
      'body.hq-light .view-header .view-meta { color: #4a4a55 !important; }' +
      'body.hq-light .topbar .breadcrumb { color: #4a4a55 !important; }' +
      'body.hq-light .topbar .breadcrumb b { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .topbar .role-switch {' +
        'background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .topbar .role-name { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .topbar .role-tag { color: #4a4a55 !important; border-left-color: #c0c0c8 !important; }' +
      'body.hq-light .topbar .role-switch .avatar { color: #fff !important; }' +
      'body.hq-light .topbar .search input {' +
        'background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .topbar .search input::placeholder { color: #8a8a95 !important; }' +
      'body.hq-light .topbar .bell, body.hq-light .hq-topbar-icon {' +
        'background: #ffffff !important; border: 1px solid #d8d8de !important; color: #4a4a55 !important;' +
      '}' +
      'body.hq-light .topbar .bell:hover, body.hq-light .hq-topbar-icon:hover {' +
        'background: rgba(216,0,4,0.06) !important; color: #d80004 !important; border-color: #d80004 !important;' +
      '}' +
      'body.hq-light .sidebar a.nav-item { color: #4a4a55 !important; font-weight: 600; }' +
      'body.hq-light .sidebar a.nav-item:hover { background: #f0f0f5 !important; color: #0a0a0e !important; }' +
      'body.hq-light .sidebar a.nav-item.active {' +
        'background: linear-gradient(90deg, rgba(216,0,4,0.10), rgba(255,106,31,0.04)) !important;' +
        'border-left: 3px solid #d80004 !important; color: #d80004 !important;' +
      '}' +
      'body.hq-light .sidebar a.nav-item .count { background: #ebebee !important; color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .sidebar a.nav-item.active .count {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important; color: #fff !important;' +
      '}' +
      'body.hq-light .sidebar .nav-section { color: #6b6b75 !important; font-weight: 800; }' +
      'body.hq-light .sidebar .filter-chip { color: #4a4a55 !important; }' +
      'body.hq-light .sidebar .filter-chip:hover { color: #0a0a0e !important; background: #f0f0f5 !important; }' +
      'body.hq-light .sidebar .filter-chip.on { color: #d80004 !important; background: rgba(216,0,4,0.08) !important; }' +
      'body.hq-light .sidebar .filter-group .filter-label { color: #6b6b75 !important; font-weight: 700; }' +
      'body.hq-light .cal-nav .month-label { color: #0a0a0e !important; font-weight: 800; }' +
      'body.hq-light .cal-nav button {' +
        'background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .cal-nav button:hover {' +
        'background: #f0f0f5 !important; border-color: #d80004 !important; color: #d80004 !important;' +
      '}' +
      'body.hq-light .pf-btn {' +
        'background: #ffffff !important; color: #0a0a0e !important;' +
        'border: 1px solid #d8d8de !important; font-weight: 600;' +
      '}' +
      'body.hq-light .pf-btn:hover { background: #f0f0f5 !important; border-color: #ababb5 !important; }' +
      'body.hq-light .pf-btn.on {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
        'color: #fff !important; border-color: #d80004 !important;' +
      '}' +
      'body.hq-light .pf-btn .pf-cnt { opacity: 0.7; }' +
      'body.hq-light .cal-weekday { background: #ebebee !important; color: #4a4a55 !important; font-weight: 700; }' +
      'body.hq-light .cal-day { background: #ffffff !important; color: #0a0a0e !important; }' +
      'body.hq-light .cal-day:hover { background: #f0f0f5 !important; }' +
      'body.hq-light .cal-day.other-month { background: #f8f8fa !important; opacity: 0.7; }' +
      'body.hq-light .cal-day.today { background: rgba(216,0,4,0.04) !important; }' +
      'body.hq-light .cal-day .day-num { color: #4a4a55 !important; font-weight: 700; }' +
      'body.hq-light .cal-day.today .day-num {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important; color: #fff !important;' +
      '}' +
      'body.hq-light .cal-card { background: #f5f5f7 !important; color: #0a0a0e !important; border: 1px solid #d8d8de; }' +
      'body.hq-light .cal-card .title { color: #0a0a0e !important; font-weight: 600; }' +
      'body.hq-light .cal-card .time { color: #4a4a55 !important; }' +
      'body.hq-light .cal-card .platform-icons { color: #4a4a55 !important; }' +
      'body.hq-light .cal-day .more { color: #6b6b75 !important; }' +
      'body.hq-light .cal-day .more:hover { color: #d80004 !important; }' +
      'body.hq-light .week-col { background: #ffffff !important; color: #0a0a0e !important; }' +
      'body.hq-light .week-col .col-head { color: #4a4a55 !important; border-bottom-color: #d8d8de !important; }' +
      'body.hq-light .week-col .col-head.today { color: #d80004 !important; }' +
      'body.hq-light .week-col .day-num { color: #0a0a0e !important; }' +
      'body.hq-light .week-col .day-name { color: #4a4a55 !important; }' +
      'body.hq-light .week-card { background: #f5f5f7 !important; color: #0a0a0e !important; border: 1px solid #d8d8de; }' +
      'body.hq-light .week-card:hover { background: #f0f0f5 !important; }' +
      'body.hq-light .week-card .wc-time { color: #4a4a55 !important; }' +
      'body.hq-light .week-card .wc-title { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .week-card .wc-meta { color: #4a4a55 !important; }' +
      'body.hq-light .board-col { background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important; }' +
      'body.hq-light .board-col .col-head { border-bottom-color: #d8d8de !important; }' +
      'body.hq-light .board-col .col-head h3 { color: #0a0a0e !important; font-weight: 800; }' +
      'body.hq-light .board-col .col-head .cnt { background: #ebebee !important; color: #0a0a0e !important; }' +
      'body.hq-light .board-col.urgent .col-head .cnt { background: linear-gradient(135deg, #d80004, #ff6a1f) !important; color: #fff !important; }' +
      'body.hq-light .board-card { background: #f5f5f7 !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important; }' +
      'body.hq-light .board-card:hover { background: #f0f0f5 !important; }' +
      'body.hq-light .board-card .bc-title { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .board-card .bc-meta { color: #4a4a55 !important; }' +
      'body.hq-light .board-card .bc-thumb { background: #ebebee !important; color: #6b6b75 !important; }' +
      'body.hq-light .board-card .bc-actions { border-top-color: #d8d8de !important; }' +
      'body.hq-light .board-empty { color: #6b6b75 !important; }' +
      'body.hq-light .lib-tile { background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important; }' +
      'body.hq-light .lib-tile .lt-preview { background: linear-gradient(135deg, #f0f0f5, #ebebee) !important; color: #4a4a55 !important; }' +
      'body.hq-light .lib-tile .lt-name { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .lib-tile .lt-meta { color: #4a4a55 !important; }' +
      'body.hq-light .lib-tile .lt-tag { background: #ebebee !important; color: #4a4a55 !important; }' +
      'body.hq-light .list-table { background: #ffffff !important; color: #0a0a0e !important; border-color: #d8d8de !important; }' +
      'body.hq-light .list-table th { background: #ebebee !important; color: #4a4a55 !important; font-weight: 800; border-bottom-color: #d8d8de !important; }' +
      'body.hq-light .list-table td { color: #0a0a0e !important; border-bottom-color: #ebebee !important; }' +
      'body.hq-light .list-table tr:hover td { background: #f0f0f5 !important; }' +
      'body.hq-light .list-table .pub-title { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .list-table .pub-meta { color: #4a4a55 !important; }' +
      'body.hq-light .modal { background: #ffffff !important; color: #0a0a0e !important; border-color: #d8d8de !important; }' +
      'body.hq-light .modal-head, body.hq-light .modal-foot { background: #ffffff !important; border-color: #d8d8de !important; }' +
      'body.hq-light .modal-body { background: #ffffff !important; }' +
      'body.hq-light .modal-head h2 { color: #0a0a0e !important; font-weight: 800; }' +
      'body.hq-light .modal-head .modal-meta { color: #6b6b75 !important; }' +
      'body.hq-light .modal-head .close { background: #ffffff !important; color: #4a4a55 !important; border: 1px solid #d8d8de !important; }' +
      'body.hq-light .modal-head .close:hover { background: #f0f0f5 !important; color: #d80004 !important; border-color: #d80004 !important; }' +
      'body.hq-light .field label { color: #4a4a55 !important; font-weight: 700; }' +
      'body.hq-light .field input, body.hq-light .field textarea, body.hq-light .field select {' +
        'background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .field input::placeholder, body.hq-light .field textarea::placeholder { color: #8a8a95 !important; }' +
      'body.hq-light .field .hint { color: #6b6b75 !important; }' +
      'body.hq-light .chip { background: #ffffff !important; border: 1px solid #d8d8de !important; color: #4a4a55 !important; }' +
      'body.hq-light .chip:hover { background: #f0f0f5 !important; color: #0a0a0e !important; }' +
      'body.hq-light .chip.on {' +
        'background: linear-gradient(135deg, rgba(216,0,4,0.12), rgba(255,106,31,0.06)) !important;' +
        'border-color: #d80004 !important; color: #d80004 !important; font-weight: 700;' +
      '}' +
      'body.hq-light .btn { background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important; }' +
      'body.hq-light .btn:hover { background: #f0f0f5 !important; border-color: #ababb5 !important; color: #0a0a0e !important; }' +
      'body.hq-light .btn-primary {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
        'color: #fff !important; border: none !important; box-shadow: 0 4px 12px -3px rgba(216,0,4,0.4) !important;' +
      '}' +
      'body.hq-light .btn-primary:hover { filter: brightness(1.1); color: #fff !important; }' +
      'body.hq-light .btn-danger { background: #ffffff !important; color: #d80004 !important; border: 1px solid #d80004 !important; }' +
      'body.hq-light .btn-danger:hover { background: rgba(216,0,4,0.06) !important; }' +
      'body.hq-light .btn-success { background: #047857 !important; color: #fff !important; border-color: #047857 !important; }' +
      'body.hq-light .btn-success:hover { background: #036946 !important; color: #fff !important; }' +
      'body.hq-light .btn-warn { background: #c2410c !important; color: #fff !important; border-color: #c2410c !important; }' +
      'body.hq-light .segmented { border-color: #d8d8de !important; }' +
      'body.hq-light .btn-segmented { background: #ffffff !important; color: #4a4a55 !important; border-color: #d8d8de !important; }' +
      'body.hq-light .btn-segmented.on {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
        'color: #fff !important; border-color: #d80004 !important;' +
      '}' +
      'body.hq-light .status.draft { background: #ebebee !important; color: #4a4a55 !important; border: 1px solid #c0c0c8; }' +
      'body.hq-light .status.in_work { background: rgba(37,99,235,0.10) !important; color: #1d4ed8 !important; border: 1px solid #2563eb; }' +
      'body.hq-light .status.review {' +
        'background: linear-gradient(135deg, rgba(216,0,4,0.10), rgba(255,106,31,0.10)) !important;' +
        'color: #d80004 !important; border: 1px solid #ff6a1f;' +
      '}' +
      'body.hq-light .status.approved { background: rgba(74,222,128,0.12) !important; color: #047857 !important; border: 1px solid #4ade80; }' +
      'body.hq-light .status.published { background: #047857 !important; color: #fff !important; }' +
      'body.hq-light .status.rework { background: rgba(251,146,60,0.12) !important; color: #c2410c !important; border: 1px solid #fb923c; }' +
      'body.hq-light .toast { background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important; box-shadow: 0 8px 24px rgba(0,0,0,0.12) !important; }' +
      'body.hq-light .toast b { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .toast .toast-body { color: #4a4a55 !important; }' +
      'body.hq-light .preview-card { background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important; }' +
      'body.hq-light .preview-card .pv-head { border-bottom-color: #d8d8de !important; }' +
      'body.hq-light .preview-card .pv-name { color: #0a0a0e !important; }' +
      'body.hq-light .preview-card .pv-handle { color: #6b6b75 !important; }' +
      'body.hq-light .preview-card .pv-media { background: linear-gradient(135deg, #ebebee, #f5f5f7) !important; color: #6b6b75 !important; }' +
      'body.hq-light .preview-card .pv-text { color: #0a0a0e !important; }' +
      'body.hq-light .preview-card .pv-text b { color: #0a0a0e !important; }' +
      'body.hq-light .preview-card .pv-text .pv-hash { color: #d80004 !important; }' +
      'body.hq-light .preview-card .pv-actions { color: #4a4a55 !important; border-top-color: #d8d8de !important; }' +
      'body.hq-light .creative-strip .cs-item { background: #f5f5f7 !important; color: #4a4a55 !important; border: 1px solid #d8d8de !important; }' +
      'body.hq-light .creative-strip .cs-add { background: #ffffff !important; color: #6b6b75 !important; border: 2px dashed #c0c0c8 !important; }' +
      'body.hq-light .creative-strip .cs-add:hover { border-color: #d80004 !important; color: #d80004 !important; }' +
      'body.hq-light .hq-tpl-card, body.hq-light .hq-onb-step, body.hq-light .hq-tpl-section, body.hq-light .hq-onb-summary,' +
      'body.hq-light .hq-onb-links, body.hq-light .hq-approvers-panel {' +
        'background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .hq-onb-step .title { color: #0a0a0e !important; font-weight: 800; }' +
      'body.hq-light .hq-onb-step .desc, body.hq-light .hq-onb-step .desc p { color: #2a2a35 !important; }' +
      'body.hq-light .hq-onb-step .desc ul li, body.hq-light .hq-onb-step .desc ol li { color: #3a3a45 !important; }' +
      'body.hq-light .hq-onb-step .desc a { color: #d80004 !important; }' +
      'body.hq-light .hq-onb-step .desc code { background: #ebebee !important; color: #d80004 !important; }' +
      'body.hq-light .hq-onb-step.done { background: rgba(74,222,128,0.04) !important; border-color: #4ade80 !important; }' +
      'body.hq-light .hq-onb-summary .pct { color: #d80004 !important; }' +
      'body.hq-light .hq-onb-summary .label, body.hq-light .hq-onb-summary p { color: #4a4a55 !important; }' +
      'body.hq-light .hq-onb-links a, body.hq-light .hq-onb-links a b { color: #0a0a0e !important; }' +
      'body.hq-light .hq-approvers-panel .hap-title { color: #4a4a55 !important; }' +
      'body.hq-light .hq-approvers-panel .hap-name { color: #0a0a0e !important; }' +
      'body.hq-light .hq-approvers-panel .hap-status { color: #4a4a55 !important; }' +
      'body.hq-light .comment { background: #f5f5f7 !important; color: #0a0a0e !important; }' +
      'body.hq-light .comment .c-author { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .comment .c-time { color: #6b6b75 !important; }' +
      'body.hq-light .comment .c-body { color: #2a2a35 !important; }' +
      'body.hq-light .comment-input input { background: #ffffff !important; color: #0a0a0e !important; border: 1px solid #d8d8de !important; }' +
      'body.hq-light .history-item { border-color: #ebebee !important; }' +
      'body.hq-light .history-item .h-author { color: #0a0a0e !important; }' +
      'body.hq-light .history-item .h-time { color: #6b6b75 !important; }' +
      'body.hq-light .history-item .h-action { color: #4a4a55 !important; }' +
      'body.hq-light .history-item .h-detail { color: #047857 !important; }' +
      'body.hq-light .meta-item .ml-label { color: #6b6b75 !important; font-weight: 800; }' +
      'body.hq-light .meta-item .ml-value { color: #0a0a0e !important; }' +
      'body.hq-light .tab { color: #4a4a55 !important; }' +
      'body.hq-light .tab:hover { color: #0a0a0e !important; }' +
      'body.hq-light .tab.active { color: #d80004 !important; border-bottom-color: #d80004 !important; }' +
      'body.hq-light .tabs { border-bottom-color: #d8d8de !important; }' +
      'body.hq-light .dropdown-menu { background: #ffffff !important; border-color: #d8d8de !important; box-shadow: 0 8px 24px rgba(0,0,0,0.12); }' +
      'body.hq-light .dropdown-item { color: #0a0a0e !important; }' +
      'body.hq-light .dropdown-item:hover { background: #f0f0f5 !important; color: #d80004 !important; }' +
      'body.hq-light .dropdown-divider { background: #d8d8de !important; }' +
      'body.hq-light .pub-section h4 { color: #4a4a55 !important; font-weight: 800; }' +
      'body.hq-light .autosave { color: #4a4a55 !important; }' +
      'body.hq-light .backend-indicator { background: #ffffff !important; border: 1px solid #d8d8de !important; color: #4a4a55 !important; }' +
      'body.hq-light .empty { color: #4a4a55 !important; }' +
      'body.hq-light .empty .empty-title { color: #0a0a0e !important; font-weight: 800; }' +
      'body.hq-light ::-webkit-scrollbar-thumb { background: #c0c0c8 !important; }' +
      'body.hq-light ::-webkit-scrollbar-thumb:hover { background: #ababb5 !important; }' +
      'body.hq-light .bulk-bar { background: #ffffff !important; border: 1px solid #d80004 !important; box-shadow: 0 -4px 20px rgba(0,0,0,0.08) !important; }' +
      'body.hq-light .bulk-bar .bb-count { color: #0a0a0e !important; }' +

      // =================================================================
      // INLINE STYLE OVERRIDES — критично для app-views.js та app-core
      // =================================================================
      // У коді багато <div style="color:#fff"> які перебивають мої class-based правила.
      // !important у CSS перебиває inline без !important, тому ці правила спрацюють.
      // Виключаємо .avatar / .pv-avatar / .logo-mark — там текст білий на брендовому bg.
      'body.hq-light div[style*="color:#fff"]:not(.avatar):not(.pv-avatar):not(.logo-mark),' +
      'body.hq-light div[style*="color: #fff"]:not(.avatar):not(.pv-avatar):not(.logo-mark),' +
      'body.hq-light b[style*="color:#fff"],' +
      'body.hq-light b[style*="color: #fff"],' +
      'body.hq-light a[style*="color:#fff"],' +
      'body.hq-light a[style*="color: #fff"],' +
      'body.hq-light input[style*="color:#fff"],' +
      'body.hq-light input[style*="color: #fff"],' +
      'body.hq-light select[style*="color:#fff"],' +
      'body.hq-light select[style*="color: #fff"],' +
      'body.hq-light textarea[style*="color:#fff"],' +
      'body.hq-light textarea[style*="color: #fff"] {' +
        'color: #0a0a0e !important;' +
      '}' +
      // #aaa light text (renderDay body text)
      'body.hq-light div[style*="color:#aaa"],' +
      'body.hq-light div[style*="color: #aaa"] {' +
        'color: #2a2a35 !important;' +
      '}' +
      // #ddd light grey text
      'body.hq-light div[style*="color:#ddd"],' +
      'body.hq-light div[style*="color: #ddd"],' +
      'body.hq-light span[style*="color:#ddd"],' +
      'body.hq-light span[style*="color: #ddd"] {' +
        'color: #4a4a55 !important;' +
      '}' +
      // inline bg-2/bg-3 на divs у renderDay/Launches/Library opens — переоприділяємо для світла
      'body.hq-light div[style*="background:var(--bg-2)"],' +
      'body.hq-light div[style*="background: var(--bg-2)"] {' +
        'background: #ffffff !important;' +
      '}' +
      'body.hq-light div[style*="background:var(--bg-3)"],' +
      'body.hq-light div[style*="background: var(--bg-3)"],' +
      'body.hq-light input[style*="background:var(--bg-3)"],' +
      'body.hq-light input[style*="background: var(--bg-3)"],' +
      'body.hq-light a[style*="background:var(--bg-3)"],' +
      'body.hq-light a[style*="background: var(--bg-3)"] {' +
        'background: #f5f5f7 !important;' +
      '}';
    document.head.appendChild(css);
  }

  inject();
  setTimeout(inject, 1000);
  setTimeout(inject, 3000);
  setTimeout(inject, 6000);

  console.log('%cDreamCar HQ Theme Polish v3 %c· повне покриття + inline overrides',
    'color:#d80004;font-weight:800;', 'color:#888;');
})();
