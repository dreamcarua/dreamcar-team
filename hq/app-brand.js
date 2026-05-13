/* ============================================================
   DreamCar HQ — Brand identity override
   ============================================================ */
// Підтягує справжні візуальні елементи DreamCar (з etron.dreamcar.ua):
//   • favicon (racing plate avatar)
//   • topbar logo (UA + DREAMCAR plate)
//   • кольори: #d80004 (red glow), #141414 (bg)
//   • motorsport-стиль для headlines (Inter 900 + uppercase + tracking)

(function () {
  if (window.__hqBrandLoaded) return;
  window.__hqBrandLoaded = true;

  var ASSETS_BASE = 'https://etron.dreamcar.ua/etron/assets/img/';
  var FAVICON_URL = ASSETS_BASE + 'dreamcar-avatar-mark.ico';
  var LOGO_PLATE_URL = ASSETS_BASE + 'dreamcar-racing-plate.webp';

  // ---- 1. Favicon ----
  (function () {
    // Видаляємо існуючі
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]').forEach(function (l) { l.remove(); });
    var link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/x-icon';
    link.href = FAVICON_URL;
    document.head.appendChild(link);
    // Apple touch icon — теж для PWA-like
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
      // DreamCar palette
      ':root {' +
        '--bg:        #0a0a0e;' +
        '--bg-2:      #141414;' +
        '--bg-3:      #1c1c20;' +
        '--bg-4:      #242428;' +
        '--bg-hover:  #2a2a2e;' +
        '--border:    #2a2a30;' +
        '--border-2:  #3a3a42;' +
        '--red:       #d80004;' +
        '--red-soft:  #ff3a3f;' +
        '--red-2:     #ff7a7e;' +
        '--red-dim:   rgba(216,0,4,0.15);' +
        '--orange:    #ff6a1f;' +
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
        '--brand-grad: linear-gradient(135deg, #d80004, #ff6a1f);' +
      '}' +
      // Тіні з brand red glow
      '.btn-primary {' +
        'background: var(--brand-grad);' +
        'border-color: var(--red);' +
        'box-shadow: 0 6px 20px -6px rgba(216,0,4,0.55);' +
      '}' +
      '.btn-primary:hover {' +
        'background: linear-gradient(135deg, #ff1a1e, #ff7a30);' +
        'border-color: #ff1a1e;' +
      '}' +
      // Headlines у DreamCar-стилі — uppercase, tight, expressive
      '.view-header h1, .modal-head h2, .auth-card h1 {' +
        'text-transform: uppercase;' +
        'letter-spacing: -0.01em;' +
        'font-weight: 900;' +
      '}' +
      // Логотип через img — більший і чіткіший
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
      '.logo-mark img {' +
        'width: 100%; height: 100%; object-fit: contain; display: block;' +
      '}' +
      '.logo-mark .dc-fallback {' +
        'display: none;' +
      '}' +
      '.logo-text { margin-left: 8px; }' +
      '.logo-text .small { color: var(--red-soft); }' +
      // Auth screen — додаємо drama
      '.auth-screen {' +
        'background: radial-gradient(ellipse at top, rgba(216,0,4,0.12) 0%, #0a0a0e 60%) !important;' +
      '}' +
      '.auth-card .auth-logo {' +
        'background: var(--brand-grad) !important;' +
        'box-shadow: 0 10px 32px -6px rgba(216,0,4,0.7) !important;' +
        'width: 64px; height: 64px;' +
        'overflow: hidden; padding: 0;' +
      '}' +
      '.auth-card .auth-logo img {' +
        'width: 100%; height: 100%; object-fit: contain;' +
      '}' +
      // Calendar today highlight
      '.cal-day.today .day-num {' +
        'background: var(--brand-grad) !important;' +
        'box-shadow: 0 0 12px rgba(216,0,4,0.5);' +
      '}' +
      // Sidebar active item
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
      // Logo subtle glow
      '@keyframes hq-brand-pulse {' +
        '0%,100% { box-shadow: 0 4px 18px -4px rgba(216,0,4,0.4); }' +
        '50%     { box-shadow: 0 4px 24px -4px rgba(216,0,4,0.7); }' +
      '}' +
      '.logo:hover .logo-mark {' +
        'animation: hq-brand-pulse 1.5s ease-in-out infinite;' +
      '}';
    document.head.appendChild(s);
  })();

  // ---- 3. Replace topbar logo with real DreamCar plate ----
  function applyTopbarLogo() {
    var logoMark = document.querySelector('.logo .logo-mark');
    if (!logoMark) return;
    if (logoMark.dataset.brandApplied) return;
    logoMark.dataset.brandApplied = '1';

    // Append real img
    var img = document.createElement('img');
    img.src = LOGO_PLATE_URL;
    img.alt = 'DreamCar';
    img.loading = 'eager';
    img.onerror = function () {
      // Fallback — повертаємо текстове "DC"
      logoMark.innerHTML = '<span class="dc-fallback" style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-weight:800;color:#fff;">DC</span>';
    };

    // Чистимо існуючий текст "DC" і кладемо img
    logoMark.innerHTML = '';
    logoMark.appendChild(img);

    // Update logo-text
    var logoText = document.querySelector('.logo .logo-text');
    if (logoText) {
      logoText.innerHTML = '<span style="font-weight:800;color:#fff;letter-spacing:0.5px;">HQ</span> <span class="small">КОМАНДНИЙ ШТАБ</span>';
    }
  }

  // ---- 4. Replace auth-screen logo too ----
  function applyAuthLogo() {
    var authLogo = document.querySelector('.auth-card .auth-logo');
    if (!authLogo) return;
    if (authLogo.dataset.brandApplied) return;
    authLogo.dataset.brandApplied = '1';

    var img = document.createElement('img');
    img.src = LOGO_PLATE_URL;
    img.alt = 'DreamCar';
    img.onerror = function () {
      authLogo.textContent = 'DC';
    };
    authLogo.textContent = '';
    authLogo.appendChild(img);
  }

  // ---- 5. Title update ----
  if (document.title.indexOf('DreamCar') < 0) {
    document.title = 'DreamCar HQ · Командний штаб';
  } else {
    document.title = document.title.replace('Стіл SMM', 'Командний штаб');
  }

  // Run on DOM ready + retries (бо у нас рендеринг динамічний)
  function runAll() {
    applyTopbarLogo();
    applyAuthLogo();
  }
  runAll();
  [200, 800, 1800, 3500].forEach(function (ms) { setTimeout(runAll, ms); });

  // Also re-run when auth screen toggles
  var obs = new MutationObserver(runAll);
  obs.observe(document.body, { childList: true, subtree: true });

  console.log('%cDreamCar HQ Brand %c· Visual identity applied', 'color:#d80004;font-weight:800;', 'color:#888;');
})();
