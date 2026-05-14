/* ============================================================
   DreamCar HQ — Theme Polish (контраст + brand consistency)
   ============================================================ */
// Брендбук DreamCar:
//   • Червоний: #d80004 (primary)
//   • Помаранчевий: #ff6a1f (accent)
//   • Темний bg: #0a0a0e / #141414 (motorsport mood)
//   • Брендовий градієнт: 135deg, #d80004 → #ff6a1f
//
// FIX:
//  1) Світла тема: основний текст почорнішав, secondary темний-сірий (#4a4a55, не #6b6b75)
//  2) Темна тема: активні елементи через --brand-grad, hover-стани з #ff6a1f tint
//  3) Status badges і buttons виправлені

(function () {
  if (window.__hqThemePolish) return;
  window.__hqThemePolish = true;

  function inject() {
    if (document.getElementById('hq-theme-polish-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-theme-polish-css';
    css.textContent =
      // =================================================================
      // DARK THEME (за замовчуванням) — brand-aligned
      // =================================================================
      // Headlines з brand gradient — підкреслюємо motorsport mood
      'body:not(.hq-light) .view-header h1 {' +
        'background: linear-gradient(90deg, #fff 30%, #ff6a1f 100%);' +
        '-webkit-background-clip: text;' +
        '-webkit-text-fill-color: transparent;' +
        'background-clip: text;' +
      '}' +
      // Active sidebar item — brand gradient
      'body:not(.hq-light) .sidebar a.nav-item.active {' +
        'background: linear-gradient(90deg, rgba(216,0,4,0.22), rgba(255,106,31,0.08)) !important;' +
        'border-left: 3px solid #ff6a1f !important;' +
        'color: #fff !important;' +
      '}' +
      'body:not(.hq-light) .sidebar a.nav-item:hover {' +
        'background: rgba(255,106,31,0.06) !important;' +
        'color: #fff !important;' +
      '}' +
      // btn-primary — повний brand gradient
      'body:not(.hq-light) .btn-primary {' +
        'background: linear-gradient(135deg, #d80004 0%, #ff6a1f 100%) !important;' +
        'color: #fff !important;' +
        'border: none !important;' +
        'box-shadow: 0 6px 20px -6px rgba(216,0,4,0.6) !important;' +
        'font-weight: 700;' +
      '}' +
      'body:not(.hq-light) .btn-primary:hover {' +
        'filter: brightness(1.15);' +
        'box-shadow: 0 8px 26px -6px rgba(255,106,31,0.7) !important;' +
      '}' +
      // Status badges на dark — насиченіші
      'body:not(.hq-light) .status.approved {' +
        'background: rgba(74,222,128,0.18);' +
        'color: #6ee7b7;' +
        'border: 1px solid rgba(74,222,128,0.45);' +
      '}' +
      'body:not(.hq-light) .status.review {' +
        'background: linear-gradient(135deg, rgba(216,0,4,0.18), rgba(255,106,31,0.18));' +
        'color: #ff8e4a;' +
        'border: 1px solid rgba(255,106,31,0.55);' +
        'box-shadow: 0 0 16px rgba(255,106,31,0.2);' +
      '}' +
      'body:not(.hq-light) .status.draft {' +
        'background: #2a2a3a;' +
        'color: #c8c8d6;' +
        'border: 1px solid #3a3a4a;' +
      '}' +
      // Calendar today — brand gradient
      'body:not(.hq-light) .cal-day.today .day-num {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
        'color: #fff;' +
        'box-shadow: 0 0 14px rgba(255,106,31,0.45);' +
      '}' +
      // Chip "on" — brand gradient
      'body:not(.hq-light) .chip.on {' +
        'background: linear-gradient(135deg, rgba(216,0,4,0.25), rgba(255,106,31,0.18));' +
        'border-color: #ff6a1f;' +
        'color: #fff;' +
        'box-shadow: 0 2px 8px rgba(255,106,31,0.25);' +
      '}' +
      // Bell badge — solid red
      'body:not(.hq-light) .bell .badge {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
      '}' +
      // Modal close button — hover на brand
      'body:not(.hq-light) .modal-head .close:hover {' +
        'background: rgba(255,106,31,0.15) !important;' +
        'color: #ff6a1f !important;' +
        'border-color: #ff6a1f !important;' +
      '}' +

      // =================================================================
      // LIGHT THEME — high-contrast text + brand colors stay
      // =================================================================
      'body.hq-light {' +
        '--bg: #ffffff;' +
        '--bg-2: #ffffff;' +
        '--bg-3: #f5f5f7;' +
        '--bg-4: #ebebee;' +
        '--bg-hover: #f0f0f5;' +
        '--border: #d8d8de;' +    /* більш видимий border */
        '--border-2: #c0c0c8;' +
        '--grey: #4a4a55;' +      /* secondary text — темніший */
        '--grey-2: #6b6b75;' +
      '}' +
      'body.hq-light, body.hq-light .main {' +
        'background: #f5f5f7 !important;' +
        'color: #0a0a0e !important;' +    /* основний text — майже чорний */
      '}' +
      'body.hq-light .app, body.hq-light .topbar, body.hq-light .sidebar, body.hq-light .logo {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
        'border-color: #d8d8de !important;' +
      '}' +
      'body.hq-light .view-header {' +
        'background: #ffffff !important;' +
        'border-bottom: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .view-header h1 {' +
        'color: #0a0a0e !important;' +
        'background: linear-gradient(90deg, #0a0a0e 50%, #d80004 100%) !important;' +
        '-webkit-background-clip: text !important;' +
        '-webkit-text-fill-color: transparent !important;' +
        'background-clip: text !important;' +
      '}' +
      'body.hq-light .view-header .view-meta {' +
        'color: #4a4a55 !important;' +
      '}' +
      // Topbar text
      'body.hq-light .topbar .breadcrumb {' +
        'color: #4a4a55 !important;' +
      '}' +
      'body.hq-light .topbar .breadcrumb b {' +
        'color: #0a0a0e !important;' +
        'font-weight: 700;' +
      '}' +
      'body.hq-light .topbar .role-switch {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
        'border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .topbar .role-name {' +
        'color: #0a0a0e !important;' +
        'font-weight: 700;' +
      '}' +
      'body.hq-light .topbar .role-tag {' +
        'color: #4a4a55 !important;' +
        'border-left-color: #c0c0c8 !important;' +
      '}' +
      'body.hq-light .topbar .search input {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
        'border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .topbar .search input::placeholder {' +
        'color: #6b6b75 !important;' +
      '}' +
      'body.hq-light .topbar .bell {' +
        'background: #ffffff !important;' +
        'border: 1px solid #d8d8de !important;' +
        'color: #4a4a55 !important;' +
      '}' +
      'body.hq-light .hq-topbar-icon {' +
        'background: #ffffff !important;' +
        'border: 1px solid #d8d8de !important;' +
        'color: #4a4a55 !important;' +
      '}' +
      'body.hq-light .hq-topbar-icon:hover {' +
        'background: #f0f0f5 !important;' +
        'border-color: #d80004 !important;' +
      '}' +
      // Sidebar
      'body.hq-light .sidebar a.nav-item {' +
        'color: #4a4a55 !important;' +
        'font-weight: 600;' +
      '}' +
      'body.hq-light .sidebar a.nav-item:hover {' +
        'background: #f0f0f5 !important;' +
        'color: #0a0a0e !important;' +
      '}' +
      'body.hq-light .sidebar a.nav-item.active {' +
        'background: linear-gradient(90deg, rgba(216,0,4,0.10), rgba(255,106,31,0.04)) !important;' +
        'border-left: 3px solid #d80004 !important;' +
        'color: #d80004 !important;' +
      '}' +
      'body.hq-light .sidebar a.nav-item .count {' +
        'background: #ebebee !important;' +
        'color: #0a0a0e !important;' +
        'font-weight: 700;' +
      '}' +
      'body.hq-light .sidebar a.nav-item.active .count {' +
        'background: var(--brand-grad) !important;' +
        'color: #fff !important;' +
      '}' +
      'body.hq-light .sidebar .nav-section {' +
        'color: #6b6b75 !important;' +
        'font-weight: 800;' +
      '}' +
      'body.hq-light .sidebar .filter-chip {' +
        'color: #4a4a55 !important;' +
      '}' +
      'body.hq-light .sidebar .filter-chip:hover {' +
        'color: #0a0a0e !important;' +
        'background: #f0f0f5 !important;' +
      '}' +
      'body.hq-light .sidebar .filter-chip.on {' +
        'color: #d80004 !important;' +
        'background: rgba(216,0,4,0.08) !important;' +
      '}' +
      'body.hq-light .sidebar .filter-group .filter-label {' +
        'color: #6b6b75 !important;' +
        'font-weight: 700;' +
      '}' +
      // Calendar
      'body.hq-light .cal-weekday {' +
        'background: #ebebee !important;' +
        'color: #4a4a55 !important;' +
        'font-weight: 700;' +
      '}' +
      'body.hq-light .cal-day {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
      '}' +
      'body.hq-light .cal-day.other-month {' +
        'background: #f8f8fa !important;' +
        'opacity: 0.7;' +
      '}' +
      'body.hq-light .cal-day .day-num {' +
        'color: #4a4a55 !important;' +
        'font-weight: 700;' +
      '}' +
      'body.hq-light .cal-day.today .day-num {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
        'color: #fff !important;' +
      '}' +
      'body.hq-light .cal-card {' +
        'background: #f5f5f7 !important;' +
        'color: #0a0a0e !important;' +
        'border: 1px solid #d8d8de;' +
      '}' +
      'body.hq-light .cal-card .title {' +
        'color: #0a0a0e !important;' +
        'font-weight: 600;' +
      '}' +
      'body.hq-light .cal-card .time {' +
        'color: #4a4a55 !important;' +
      '}' +
      // Board, Library, List
      'body.hq-light .week-col, body.hq-light .week-card,' +
      'body.hq-light .lib-tile, body.hq-light .board-card, body.hq-light .board-col,' +
      'body.hq-light .modal, body.hq-light .list-table {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
        'border-color: #d8d8de !important;' +
      '}' +
      'body.hq-light .lib-tile .lt-name,' +
      'body.hq-light .week-card .wc-title,' +
      'body.hq-light .board-card .bc-title,' +
      'body.hq-light .list-table .pub-title {' +
        'color: #0a0a0e !important;' +
        'font-weight: 700;' +
      '}' +
      'body.hq-light .lib-tile .lt-meta,' +
      'body.hq-light .week-card .wc-time,' +
      'body.hq-light .week-card .wc-meta,' +
      'body.hq-light .board-card .bc-meta,' +
      'body.hq-light .list-table .pub-meta {' +
        'color: #4a4a55 !important;' +
      '}' +
      'body.hq-light .list-table th {' +
        'background: #ebebee !important;' +
        'color: #4a4a55 !important;' +
        'font-weight: 800;' +
      '}' +
      'body.hq-light .list-table td {' +
        'color: #0a0a0e !important;' +
        'border-bottom-color: #ebebee !important;' +
      '}' +
      // Modal
      'body.hq-light .modal-head h2 {' +
        'color: #0a0a0e !important;' +
        'font-weight: 800;' +
      '}' +
      'body.hq-light .modal-head .modal-meta {' +
        'color: #6b6b75 !important;' +
      '}' +
      'body.hq-light .modal-body, body.hq-light .modal-head, body.hq-light .modal-foot {' +
        'background: #ffffff !important;' +
        'border-color: #d8d8de !important;' +
      '}' +
      // Fields
      'body.hq-light .field label {' +
        'color: #4a4a55 !important;' +
        'font-weight: 700;' +
      '}' +
      'body.hq-light .field input, body.hq-light .field textarea, body.hq-light .field select {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
        'border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .field input::placeholder, body.hq-light .field textarea::placeholder {' +
        'color: #8a8a95 !important;' +
      '}' +
      'body.hq-light .field .hint {' +
        'color: #6b6b75 !important;' +
      '}' +
      // Chips
      'body.hq-light .chip {' +
        'background: #f5f5f7 !important;' +
        'border: 1px solid #d8d8de !important;' +
        'color: #4a4a55 !important;' +
      '}' +
      'body.hq-light .chip:hover {' +
        'background: #ebebee !important;' +
        'color: #0a0a0e !important;' +
      '}' +
      'body.hq-light .chip.on {' +
        'background: linear-gradient(135deg, rgba(216,0,4,0.12), rgba(255,106,31,0.06)) !important;' +
        'border-color: #d80004 !important;' +
        'color: #d80004 !important;' +
        'font-weight: 700;' +
      '}' +
      // Buttons
      'body.hq-light .btn {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
        'border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .btn:hover {' +
        'background: #f0f0f5 !important;' +
        'border-color: #ababb5 !important;' +
      '}' +
      'body.hq-light .btn-primary {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
        'color: #fff !important;' +
        'border: none !important;' +
        'box-shadow: 0 4px 12px -3px rgba(216,0,4,0.4) !important;' +
      '}' +
      'body.hq-light .btn-primary:hover {' +
        'filter: brightness(1.1);' +
      '}' +
      'body.hq-light .btn-segmented {' +
        'background: #ffffff !important;' +
        'color: #4a4a55 !important;' +
        'border-color: #d8d8de !important;' +
      '}' +
      'body.hq-light .btn-segmented.on {' +
        'background: linear-gradient(135deg, #d80004, #ff6a1f) !important;' +
        'color: #fff !important;' +
        'border-color: #d80004 !important;' +
      '}' +
      // Status badges на світлій
      'body.hq-light .status.draft {' +
        'background: #ebebee !important;' +
        'color: #4a4a55 !important;' +
        'border: 1px solid #c0c0c8;' +
      '}' +
      'body.hq-light .status.in_work {' +
        'background: rgba(122,176,255,0.12) !important;' +
        'color: #2563eb !important;' +
        'border: 1px solid rgba(122,176,255,0.4);' +
      '}' +
      'body.hq-light .status.review {' +
        'background: linear-gradient(135deg, rgba(216,0,4,0.10), rgba(255,106,31,0.10)) !important;' +
        'color: #d80004 !important;' +
        'border: 1px solid #ff6a1f;' +
      '}' +
      'body.hq-light .status.approved {' +
        'background: rgba(74,222,128,0.12) !important;' +
        'color: #047857 !important;' +
        'border: 1px solid #4ade80;' +
      '}' +
      'body.hq-light .status.published {' +
        'background: #047857 !important;' +
        'color: #fff !important;' +
      '}' +
      'body.hq-light .status.rework {' +
        'background: rgba(251,146,60,0.12) !important;' +
        'color: #c2410c !important;' +
        'border: 1px solid #fb923c;' +
      '}' +
      // Toast
      'body.hq-light .toast {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
        'border: 1px solid #d8d8de !important;' +
        'box-shadow: 0 8px 24px rgba(0,0,0,0.12) !important;' +
      '}' +
      'body.hq-light .toast b { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .toast .toast-body { color: #4a4a55 !important; }' +
      // Onboarding, Templates, Tpl-section
      'body.hq-light .hq-tpl-card, body.hq-light .hq-onb-step,' +
      'body.hq-light .hq-tpl-section, body.hq-light .hq-onb-summary,' +
      'body.hq-light .hq-onb-links, body.hq-light .hq-approvers-panel {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
        'border: 1px solid #d8d8de !important;' +
      '}' +
      'body.hq-light .hq-onb-step .title { color: #0a0a0e !important; font-weight: 800; }' +
      'body.hq-light .hq-onb-step .desc { color: #2a2a35 !important; }' +
      'body.hq-light .hq-onb-step .desc p { color: #2a2a35 !important; }' +
      'body.hq-light .hq-onb-step .desc ul li, body.hq-light .hq-onb-step .desc ol li { color: #3a3a45 !important; }' +
      'body.hq-light .hq-onb-step .desc a { color: #d80004 !important; }' +
      'body.hq-light .hq-onb-step .desc code { background: #ebebee !important; color: #d80004 !important; }' +
      'body.hq-light .hq-onb-step.done { background: rgba(74,222,128,0.04) !important; border-color: #4ade80 !important; }' +
      'body.hq-light .hq-onb-summary .pct { color: #d80004 !important; }' +
      'body.hq-light .hq-onb-summary .label { color: #4a4a55 !important; }' +
      'body.hq-light .hq-onb-summary p { color: #4a4a55 !important; }' +
      'body.hq-light .hq-onb-links a { color: #0a0a0e !important; }' +
      'body.hq-light .hq-onb-links a b { color: #0a0a0e !important; }' +
      'body.hq-light .hq-approvers-panel .hap-title { color: #4a4a55 !important; }' +
      'body.hq-light .hq-approvers-panel .hap-name { color: #0a0a0e !important; }' +
      'body.hq-light .hq-approvers-panel .hap-status { color: #4a4a55 !important; }' +
      // Bell / role-switch у light
      'body.hq-light .bell:hover, body.hq-light .hq-topbar-icon:hover {' +
        'background: rgba(216,0,4,0.06) !important;' +
        'color: #d80004 !important;' +
      '}' +
      'body.hq-light .role-switch:hover {' +
        'border-color: #d80004 !important;' +
      '}' +
      // Comments
      'body.hq-light .comment { background: #f5f5f7 !important; color: #0a0a0e !important; }' +
      'body.hq-light .comment .c-author { color: #0a0a0e !important; font-weight: 700; }' +
      'body.hq-light .comment .c-time { color: #6b6b75 !important; }' +
      'body.hq-light .comment .c-body { color: #2a2a35 !important; }' +
      'body.hq-light .comment-input input {' +
        'background: #ffffff !important;' +
        'color: #0a0a0e !important;' +
        'border: 1px solid #d8d8de !important;' +
      '}' +
      // History
      'body.hq-light .history-item { border-color: #ebebee !important; }' +
      'body.hq-light .history-item .h-author { color: #0a0a0e !important; }' +
      'body.hq-light .history-item .h-time { color: #6b6b75 !important; }' +
      'body.hq-light .history-item .h-action { color: #4a4a55 !important; }' +
      // Meta items на правій стороні картки
      'body.hq-light .meta-item .ml-label { color: #6b6b75 !important; font-weight: 800; }' +
      'body.hq-light .meta-item .ml-value { color: #0a0a0e !important; }' +
      // Tabs
      'body.hq-light .tab { color: #4a4a55 !important; }' +
      'body.hq-light .tab:hover { color: #0a0a0e !important; }' +
      'body.hq-light .tab.active { color: #d80004 !important; border-bottom-color: #d80004 !important; }' +
      // Dropdown items
      'body.hq-light .dropdown-menu { background: #ffffff !important; border-color: #d8d8de !important; }' +
      'body.hq-light .dropdown-item { color: #0a0a0e !important; }' +
      'body.hq-light .dropdown-item:hover { background: #f0f0f5 !important; color: #d80004 !important; }' +
      // Backend indicator
      'body.hq-light .backend-indicator {' +
        'background: #ffffff !important;' +
        'border: 1px solid #d8d8de !important;' +
        'color: #4a4a55 !important;' +
      '}';
    document.head.appendChild(css);
  }

  inject();
  // На випадок якщо app-ui-extras завантажиться пізніше і перезапише деяку CSS — re-apply
  setTimeout(inject, 1000);
  setTimeout(inject, 3000);

  console.log('%cDreamCar HQ Theme Polish %c· контрастна світла + brand темна',
    'color:#d80004;font-weight:800;', 'color:#888;');
})();
