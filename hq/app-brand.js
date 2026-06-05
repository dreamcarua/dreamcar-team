/* ============================================================
   DreamCar HQ — Brand identity override
   ============================================================ */
// Підтягує справжні візуальні елементи DreamCar (з etron.dreamcar.ua):
//   • favicon (racing plate avatar)
//   • topbar logo (UA + DREAMCAR plate)
//   • кольори: #E30613 (red glow), #141414 (bg)
//   • motorsport-стиль для headlines (Inter 900 + uppercase + tracking)

(function () {
  if (window.__hqBrandLoaded) return;
  window.__hqBrandLoaded = true;

  var ASSETS_BASE = 'https://etron.dreamcar.ua/etron/assets/img/';
  var FAVICON_URL = ASSETS_BASE + 'dreamcar-avatar-mark.ico';
  var LOGO_PLATE_URL = ASSETS_BASE + 'dreamcar-racing-plate.webp';

  // ---- 1. Favicon ----
  (function () {
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(function (l) { l.remove(); });
    var link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/x-icon';
    link.href = FAVICON_URL;
    document.head.appendChild(link);
    var apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.href = FAVICON_URL;
    document.head.appendChild(apple);
  })();

  // ---- 2. Brand colors override (CSS variables) ----
  (function () {
    if (document.getElementById('hq-brand-colors')) return;
    var s = document.createElement('style');
    s.id = 'hq-brand-colors';
    s.textContent =
      ':root {' +
        '--bg:        #0a0a0e;' +
        '--bg-2:      #141414;' +
        '--bg-3:      #1c1c20;' +
        '--bg-4:      #242428;' +
        '--bg-hover:  #2a2a2e;' +
        '--border:    #2a2a30;' +
        '--border-2:  #3a3a42;' +
        '--red:       #E30613;' +
        '--red-soft:  #ff3a3f;' +
        '--red-2:     #ff7a7e;' +
        '--red-dim:   rgba(216,0,4,0.15);' +
        '--orange:    #FF1A2B;' +
        '--orange-soft:#ff8e4a;' +
        '--gold:      #fbbf24;' +
        '--green:     #4ade80;' +
        '--green-soft:#6ee7b7;' +
        '--blue:      #93c5fd;' +
        '--blue-soft: #7ab0ff;' +
        '--purple:    #c89af0;' +
        '--white:     #fff;' +
        '--grey:      #888;' +
        '--grey-2:    #555;' +
        '--shadow:    0 12px 32px rgba(0,0,0,0.55);' +
        '--brand-grad: linear-gradient(135deg, #E30613, #FF1A2B);' +
      '}' +
      // Brand buttons
      '.btn-primary {' +
        'background: var(--brand-grad);' +
        'border-color: var(--red);' +
        'box-shadow: 0 6px 20px -6px rgba(216,0,4,0.55);' +
      '}' +
      '.btn-primary:hover {' +
        'background: linear-gradient(135deg, #ff1a1e, #ff7a30);' +
        'border-color: #ff1a1e;' +
      '}' +
      // Headlines DreamCar-style
      '.view-header h1, .modal-head h2, .auth-card h1 {' +
        'text-transform: uppercase;' +
        'letter-spacing: -0.01em;' +
        'font-weight: 900;' +
      '}' +
      // Logo
      '.logo {' +
        'background: linear-gradient(180deg, #0d0d11 0%, #141418 100%);' +
        'padding: 0 14px;' +
      '}' +
      '.logo-mark {' +
        'background: none !important;' +
        'box-shadow: none !important;' +
        'overflow: hidden;' +
        'width: 90px !important;' +
        'height: 38px !important;' +
        'border-radius: 5px;' +
        'padding: 0;' +
        'flex-shrink: 0;' +
      '}' +
      '.logo-mark img { width: 100%; height: 100%; object-fit: contain; display: block; }' +
      '.logo-mark .dc-fallback { display: none; }' +
      '.logo-text { margin-left: 8px; }' +
      '.logo-text .small { color: var(--red-soft); }' +
      // Auth screen FULL OPAQUE OVERLAY (фікс прозорості)
      '.auth-screen {' +
        'background: ' +
          'radial-gradient(ellipse at top, rgba(216,0,4,0.18) 0%, transparent 50%),' +
          'radial-gradient(ellipse at bottom, rgba(255,106,31,0.1) 0%, transparent 50%),' +
          '#000 !important;' +
        'z-index: 9999 !important;' +
      '}' +
      '.auth-card {' +
        'box-shadow: 0 30px 100px -20px rgba(216,0,4,0.4), 0 0 60px rgba(0,0,0,0.8) !important;' +
        'border: 1px solid rgba(216,0,4,0.3) !important;' +
      '}' +
      '.auth-card .auth-logo {' +
        'background: var(--brand-grad) !important;' +
        'box-shadow: 0 12px 40px -6px rgba(216,0,4,0.7) !important;' +
        'width: 72px; height: 72px;' +
        'overflow: hidden; padding: 6px;' +
        'border-radius: 14px;' +
      '}' +
      '.auth-card .auth-logo img {' +
        'width: 100%; height: 100%; object-fit: contain;' +
      '}' +
      '.auth-card h1 {' +
        'background: var(--brand-grad);' +
        '-webkit-background-clip: text;' +
        '-webkit-text-fill-color: transparent;' +
        'background-clip: text;' +
        'font-size: 26px !important;' +
        'letter-spacing: 1px;' +
      '}' +
      // Calendar today
      '.cal-day.today .day-num {' +
        'background: var(--brand-grad) !important;' +
        'box-shadow: 0 0 12px rgba(216,0,4,0.5);' +
      '}' +
      // Sidebar active
      '.sidebar a.nav-item.active {' +
        'background: linear-gradient(90deg, rgba(216,0,4,0.18), rgba(255,106,31,0.05)) !important;' +
        'color: #fff !important;' +
        'border-color: var(--red) !important;' +
      '}' +
      // Backend indicator
      '.backend-indicator.live .dot {' +
        'background: var(--red);' +
        'box-shadow: 0 0 8px var(--red);' +
      '}' +
      // Status — review (gold red glow)
      '.status.review { box-shadow: 0 0 12px rgba(251,191,36,0.25); }' +
      // Logo pulse on hover
      '@keyframes hq-brand-pulse {' +
        '0%,100% { box-shadow: 0 4px 18px -4px rgba(216,0,4,0.4); }' +
        '50%     { box-shadow: 0 4px 24px -4px rgba(216,0,4,0.7); }' +
      '}' +
      '.logo:hover .logo-mark { animation: hq-brand-pulse 1.5s ease-in-out infinite; }';
    document.head.appendChild(s);
  })();

  // ---- 3. Sidebar logo: ХОВАЄМО plate (вже є у global-header згори),
  //         залишаємо тільки текст «HQ КОМАНДНИЙ ШТАБ».
  function applyTopbarLogo() {
    var logoMark = document.querySelector('.logo .logo-mark');
    if (logoMark) {
      logoMark.style.display = 'none'; // не дублюємо лого з global-header
      logoMark.dataset.brandApplied = '1';
    }
    var logoText = document.querySelector('.logo .logo-text');
    if (logoText && !logoText.dataset.brandApplied) {
      logoText.dataset.brandApplied = '1';
      logoText.style.marginLeft = '0';
      logoText.innerHTML = '<span style="font-weight:800;color:#fff;letter-spacing:0.5px;">SMM</span> <span class="small">КОНТЕНТ І ПОГОДЖЕННЯ</span>';
    }
  }

  // ---- 4. Replace auth-screen logo ----
  function applyAuthLogo() {
    var authLogo = document.querySelector('.auth-card .auth-logo');
    if (!authLogo) return;
    if (authLogo.dataset.brandApplied) return;
    authLogo.dataset.brandApplied = '1';

    var img = document.createElement('img');
    img.src = LOGO_PLATE_URL;
    img.alt = 'DreamCar';
    img.onerror = function () { authLogo.textContent = 'DC'; };
    authLogo.textContent = '';
    authLogo.appendChild(img);

    // Update title H1
    var h1 = document.getElementById('authTitle');
    if (h1) h1.textContent = 'DREAMCAR HQ';
  }

  // ---- 5. Title update ----
  if (document.title.indexOf('Командний') < 0) {
    document.title = document.title.replace('Стіл SMM', 'Командний штаб');
  }

  function runAll() {
    applyTopbarLogo();
    applyAuthLogo();
  }
  runAll();
  [200, 800, 1800, 3500].forEach(function (ms) { setTimeout(runAll, ms); });

  var obs = new MutationObserver(runAll);
  obs.observe(document.body, { childList: true, subtree: true });

  console.log('%cDreamCar HQ Brand %c· Visual identity applied', 'color:#E30613;font-weight:800;', 'color:#888;');
})();
