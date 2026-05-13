/* ============================================================
   DreamCar HQ — Patches v2
   Real thumbnails + team refresh + UUID fix + multi-platform previews
   + real bell counter + /settings route + UX-фіксы (sidebar filter,
   autosave flush, filter→card guard, undo-delete).
   ============================================================ */

(function () {
  // ---- Inject CSS для нових UX-станів ----
  (function injectCss() {
    if (document.getElementById('hq-patches-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-patches-css';
    css.textContent =
      '/* sidebar filter-chip — яскравіший active + checkmark */' +
      '.sidebar .filter-chip { position: relative; }' +
      '.sidebar .filter-chip.on { background: var(--red-dim); color: #fff; font-weight: 600; }' +
      '.sidebar .filter-chip.on::before { content: "✓"; position: absolute; right: 24px; color: var(--red-soft); font-size: 11px; font-weight: 700; }' +
      '.sidebar .filter-chip:not(.on) { opacity: 0.85; }' +
      '/* platform-filter — checkmark на active */' +
      '.pf-btn { position: relative; }' +
      '.pf-btn.on { box-shadow: 0 0 0 1px var(--red-soft); }' +
      // toast з undo-кнопкою
      '.toast.undoable { display: flex; align-items: center; gap: 12px; }' +
      '.toast .undo-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; }' +
      '.toast .undo-btn:hover { background: rgba(255,255,255,0.2); }';
    document.head.appendChild(css);
  })();

  // ---- UUID helper ----
  function uuidV4() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isUuid(v) { return typeof v === 'string' && UUID_RE.test(v); }
  window.uuidV4 = uuidV4;

  function patchNewPub() {
    if (typeof window.newPubObject !== 'function' || window.newPubObject.__uuidPatched) return;
    var _orig = window.newPubObject;
    window.newPubObject = function (forDate) {
      var p = _orig.call(this, forDate);
      if (p && !isUuid(p.id)) p.id = uuidV4();
      return p;
    };
    window.newPubObject.__uuidPatched = true;
  }
  patchNewPub(); setTimeout(patchNewPub, 300); setTimeout(patchNewPub, 1500);

  function patchUpsert() {
    if (!window.Store || typeof Store.upsertPub !== 'function' || Store.upsertPub.__uuidPatched) return;
    var _orig = Store.upsertPub.bind(Store);
    Store.upsertPub = function (pub) {
      if (pub && !isUuid(pub.id)) {
        var newId = uuidV4();
        try {
          var ix = (Store._data.publications || []).findIndex(function (x) { return x.id === pub.id; });
          if (ix >= 0) Store._data.publications[ix].id = newId;
        } catch (_) {}
        pub.id = newId;
      }
      return _orig(pub);
    };
    Store.upsertPub.__uuidPatched = true;
  }
  patchUpsert(); setTimeout(patchUpsert, 300); setTimeout(patchUpsert, 1500);

  // ---- Refresh demo team ----
  function refreshDemoTeam() {
    if (window.HQ_BACKEND) return;
    try {
      var data = window.Store && Store._data;
      if (!data || !Array.isArray(data.users)) return;
      var users = data.users;
      var migrations = {
        'vg@dreamcar.ua':    { email: 'dreamcarua@gmail.com',  name: 'Вадим', role: 'ceo',    initial: 'В' },
        'vg@abrisart.com':   { email: 'dreamcarua@gmail.com',  name: 'Вадим', role: 'ceo',    initial: 'В' },
        'danil@dreamcar.ua': { email: 'smth.mario@gmail.com',  name: 'Давид', role: 'coo',    initial: 'Д' },
        'sasha@dreamcar.ua': { email: 'lexbelov21@gmail.com',  name: 'Саша',  role: 'lead',   initial: 'С' },
        'artem@dreamcar.ua': { email: '1avrybak@gmail.com',    name: 'Артем', role: 'member', initial: 'А' },
        'vira@dreamcar.ua':  { email: 'verusya.nec@gmail.com', name: 'Віра',  role: 'member', initial: 'В' },
      };
      var changed = false;
      users.forEach(function (u) {
        var m = migrations[u.email];
        if (m) { u.email = m.email; u.name = m.name; u.role = m.role; u.initial = m.initial; changed = true; }
      });
      var hasVova = users.some(function (u) { return u.email === 'vdenishchuk@gmail.com'; });
      if (!hasVova) {
        users.push({ id: 'u_vova', name: 'Вова', role: 'member', email: 'vdenishchuk@gmail.com', initial: 'В' });
        changed = true;
      }
      if (changed && typeof Store._saveLocal === 'function') {
        Store._saveLocal();
        if (typeof renderRoleBadge === 'function') renderRoleBadge();
        if (typeof renderSidebarFilters === 'function') renderSidebarFilters();
      }
    } catch (e) { console.warn('refreshDemoTeam:', e); }
  }
  refreshDemoTeam(); setTimeout(refreshDemoTeam, 500); setTimeout(refreshDemoTeam, 2000);

  // ---- Helpers ----
  function safeUrl(u) {
    if (!u || typeof u !== 'string') return '';
    if (/^(https?:|data:|blob:)/i.test(u.trim())) return u.replace(/"/g, '&quot;');
    return '';
  }
  function mediaThumb(c, opts) {
    opts = opts || {};
    if (!c) return '<span style="font-size:24px;">📝</span>';
    var size = opts.size || 'tile';
    var url = safeUrl(c.url) || safeUrl(c.thumbnail_url) || '';
    var fontSize = size === 'modal' ? '72px' : size === 'card' ? '18px' : '30px';
    var emoji = '<span style="font-size:' + fontSize + ';">' + (c.preview || '📦') + '</span>';
    if (!url) return emoji;
    if (c.type === 'photo') {
      return '<img src="' + url + '" alt="' + escapeHtml(c.name || '') + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;"/>';
    }
    if (c.type === 'video') {
      return '<video src="' + url + '#t=0.1" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;pointer-events:none;"></video>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6);font-size:28px;pointer-events:none;">▶</div>';
    }
    return emoji;
  }
  window.mediaThumb = mediaThumb;
  window.safeUrl = safeUrl;

  // ---- boardCard / renderLibGrid / openCreative — без змін ----
  window.boardCard = function (p) {
    var cr = (p.creatives || []).map(function (id) { return Store.creative(id); }).filter(Boolean);
    var thumb = cr[0] ? mediaThumb(cr[0], { size: 'card' }) : '<span style="font-size:18px;">📝</span>';
    var urgency = urgencyClass(p);
    var dueLabel = (function () {
      var diff = daysBetween(new Date(), p.dateTime);
      if (diff < 0) return { txt: 'Пропущено: ' + fmtDate(p.dateTime), cls: 'due-now' };
      if (diff === 0) return { txt: 'Сьогодні о ' + fmtTime(p.dateTime), cls: 'due-now' };
      if (diff === 1) return { txt: 'Завтра ' + fmtTime(p.dateTime), cls: 'due-soon' };
      if (diff <= 3) return { txt: 'Через ' + diff + ' дні · ' + fmtDate(p.dateTime), cls: 'due-soon' };
      return { txt: fmtDate(p.dateTime) + ' · ' + fmtTime(p.dateTime), cls: '' };
    })();
    var respNames = (p.responsibles || []).map(function (id) { return Store.user(id) && Store.user(id).name; }).filter(Boolean).join(', ');
    return '<div class="board-card ' + urgency + '" data-id="' + p.id + '">' +
      '<div class="bc-head"><div class="bc-thumb" style="position:relative;overflow:hidden;">' + thumb + '</div>' +
      '<div class="bc-body"><div class="bc-title">' + escapeHtml(p.title) + '</div>' +
      '<div class="bc-meta">' + platformIcons(p.platforms) + ' · ' + p.contentType + ' · ' + respNames + '</div></div></div>' +
      '<div class="bc-date ' + dueLabel.cls + '" style="margin-top:8px;">📅 ' + dueLabel.txt + '</div>' +
      '<div class="bc-actions">' +
        '<button class="btn btn-success btn-sm" data-action="approve" data-id="' + p.id + '">✓ Погодити</button>' +
        '<button class="btn btn-warn btn-sm" data-action="reject" data-id="' + p.id + '">↩ Повернути</button>' +
        '<button class="btn btn-sm" data-action="open" data-id="' + p.id + '">Відкрити</button>' +
      '</div></div>';
  };
  window.renderLibGrid = function (type, q) {
    var cr = Store.creatives();
    if (type !== 'all') cr = cr.filter(function (c) { return c.type === type; });
    if (q) { var Q = q.toLowerCase(); cr = cr.filter(function (c) { return (c.name + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(Q) >= 0; }); }
    var grid = document.getElementById('libGrid');
    if (!cr.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1;"><div class="empty-icon">📦</div><div class="empty-title">Нічого не знайдено</div></div>'; return; }
    grid.innerHTML = cr.map(function (c) {
      var dur = c.duration ? '<div class="lt-dur">' + formatDur(c.duration) + '</div>' : '';
      var hasMedia = (c.url || c.thumbnail_url) && (c.type === 'photo' || c.type === 'video');
      var bg = hasMedia ? 'background:var(--bg-3);' : 'background:linear-gradient(135deg, ' + c.color + '33, transparent);';
      return '<div class="lib-tile" data-id="' + c.id + '"><div class="lt-preview" style="' + bg + 'position:relative;overflow:hidden;">' +
        mediaThumb(c, { size: 'tile' }) + '<div class="lt-type-badge">' + c.type + '</div>' + dur + '</div>' +
        '<div class="lt-info"><div class="lt-name" title="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</div>' +
        '<div class="lt-meta">' + c.size + ' · ' + c.res + '</div>' +
        '<div class="lt-tags">' + (c.tags || []).slice(0, 3).map(function (t) { return '<span class="lt-tag">#' + escapeHtml(t) + '</span>'; }).join('') + '</div></div></div>';
    }).join('');
    document.querySelectorAll('.lib-tile').forEach(function (el) { el.onclick = function () { openCreative(el.dataset.id); }; });
  };
  window.openCreative = function (id) {
    var c = Store.creative(id); if (!c) return;
    var usedIn = Store.pubs().filter(function (p) { return (p.creatives || []).indexOf(id) >= 0; });
    var hasReal = (c.url || c.thumbnail_url) && (c.type === 'photo' || c.type === 'video');
    var bg = hasReal ? 'background:#000;' : 'background:linear-gradient(135deg, ' + c.color + '33, transparent);';
    var mediaHtml;
    if (c.type === 'video' && safeUrl(c.url)) mediaHtml = '<video src="' + safeUrl(c.url) + '" controls preload="metadata" style="width:100%;height:100%;object-fit:contain;background:#000;"></video>';
    else if (c.type === 'photo' && safeUrl(c.url)) mediaHtml = '<img src="' + safeUrl(c.url) + '" alt="' + escapeHtml(c.name) + '" style="max-width:100%;max-height:100%;object-fit:contain;display:block;"/>';
    else mediaHtml = mediaThumb(c, { size: 'modal' });
    Modal.open(
      '<div class="modal-head"><h2>' + escapeHtml(c.name) + '</h2>' +
        '<span class="modal-meta">' + c.type + ' · ' + c.size + ' · ' + c.res + (c.duration ? ' · ' + formatDur(c.duration) : '') + '</span>' +
        '<button class="close" onclick="Modal.close()">×</button></div>' +
      '<div class="modal-body"><div style="' + bg + 'border:1px solid var(--border);border-radius:10px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;color:#fff;margin-bottom:18px;position:relative;overflow:hidden;">' + mediaHtml + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;"><div>' +
          '<h4 style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey);margin-bottom:8px;font-weight:700;">Інформація</h4>' +
          '<div style="display:grid;gap:8px;font-size:13px;">' +
            '<div>📁 <b style="color:#fff">' + escapeHtml(c.name) + '</b></div>' +
            '<div>📦 ' + c.size + ', ' + c.res + (c.duration ? ', ' + formatDur(c.duration) : '') + '</div>' +
            '<div>👤 Завантажив: <b style="color:#fff">' + ((Store.user(c.uploadedBy) || {}).name || '—') + '</b></div>' +
            '<div>📅 ' + fmtDateTime(c.uploadedAt) + '</div>' +
            '<div>🏷️ ' + ((c.tags || []).map(function (t) { return '#' + t; }).join(' ') || '—') + '</div></div></div>' +
          '<div><h4 style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey);margin-bottom:8px;font-weight:700;">Використовується в публікаціях</h4>' +
          '<div style="display:flex;flex-direction:column;gap:6px;">' +
          (usedIn.length ? usedIn.map(function (p) { return '<a href="#publication/' + p.id + '" style="background:var(--bg-3);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:12px;color:#fff;text-decoration:none;display:block;" onclick="Modal.close()">' + escapeHtml(p.title) + ' <small style="color:var(--grey)">· ' + fmtDate(p.dateTime) + '</small></a>'; }).join('') : '<div style="color:var(--grey);font-size:12px;padding:8px 0;">Не використовується.</div>') +
          '</div></div></div></div>' +
      '<div class="modal-foot">' + (safeUrl(c.url) ? '<a class="btn" href="' + safeUrl(c.url) + '" target="_blank" rel="noopener">⬇ Відкрити оригінал</a>' : '') +
        '<button class="btn btn-danger" onclick="Modal.close()">Закрити</button></div>'
    );
  };

  // ---- Multi-platform previews ----
  var PLATFORM_PREVIEW_META = {
    ig: { brand: 'Instagram', handle: '@dreamcar.ua',   accent: '#E1306C', aspect: '4/5'  },
    tg: { brand: 'Telegram',  handle: '@dreamcar_ua',   accent: '#0088cc', aspect: '16/9' },
    tt: { brand: 'TikTok',    handle: '@dreamcar.ua',   accent: '#fe2c55', aspect: '9/16' },
    yt: { brand: 'YT Shorts', handle: '@dreamcar',      accent: '#ff0000', aspect: '9/16' },
    th: { brand: 'Threads',   handle: '@dreamcar.ua',   accent: '#a78bfa', aspect: '4/5'  },
    fb: { brand: 'Facebook',  handle: 'Dream Car',      accent: '#1877f2', aspect: '16/9' },
  };
  function previewMediaBg(first) {
    var hasRealMedia = first && (first.url || first.thumbnail_url) && (first.type === 'photo' || first.type === 'video');
    if (hasRealMedia) return 'background:#000;';
    var color = (first && first.color) || '#cc0000';
    return 'background: linear-gradient(135deg, ' + color + '33, var(--bg-2));';
  }
  function previewText(p) {
    var txt = escapeHtml(p.text || '').replace(/(#[\p{L}\p{N}_]+)/gu, '<span class="pv-hash">$1</span>');
    var hashLine = (p.hashtags || []).map(function (h) { return h.indexOf('#') === 0 ? h : '#' + h; }).join(' ');
    var hashHtml = hashLine ? '<div style="margin-top:6px;color:var(--blue-soft);font-size:11px;">' + escapeHtml(hashLine).replace(/(#\S+)/g, '<span class="pv-hash">$1</span>') + '</div>' : '';
    return { txt: txt, hashHtml: hashHtml };
  }
  function buildPlatformCard(platform, p, firstMedia, mediaBg, txt, hashHtml) {
    var meta = PLATFORM_PREVIEW_META[platform];
    if (!meta) return '';
    var aspectStyle = 'aspect-ratio:' + meta.aspect + ';';
    // Per-platform schedule: коли в pub.platformSchedule є запис — показуємо його, інакше базовий p.dateTime
    var pSched = (p.platformSchedule && p.platformSchedule[platform]) || p.dateTime;
    var head = '<div class="pv-head" style="background:linear-gradient(180deg, ' + meta.accent + '20, transparent);">' +
      '<div class="pv-avatar" style="background:linear-gradient(135deg,' + meta.accent + ',' + meta.accent + 'aa);">DC</div>' +
      '<div><div class="pv-name">' + escapeHtml(meta.brand) + '</div>' +
      '<div class="pv-handle">' + escapeHtml(meta.handle) + ' · ' + fmtDate(pSched, {short: true}) + ' ' + fmtTime(pSched) + '</div></div></div>';
    var media = '<div class="pv-media" style="' + mediaBg + aspectStyle + 'position:relative;overflow:hidden;font-size:48px;display:flex;align-items:center;justify-content:center;">' +
      firstMedia +
      (platform === 'tt' || platform === 'yt' ? '<div style="position:absolute;right:8px;bottom:10px;display:flex;flex-direction:column;gap:10px;font-size:16px;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6);"><span>♥</span><span>💬</span><span>↗</span></div>' : '') +
      '</div>';
    var actions = '';
    if (platform === 'ig') actions = '<div class="pv-actions">♥ &nbsp; 💬 &nbsp; ↗ &nbsp; <span style="margin-left:auto">🔖</span></div>';
    else if (platform === 'fb') actions = '<div class="pv-actions">👍 Подобається &nbsp; 💬 Коментар &nbsp; ↗ Поділитися</div>';
    else if (platform === 'th') actions = '<div class="pv-actions">♥ &nbsp; 💬 &nbsp; 🔁 &nbsp; ↗</div>';
    var body = '<div class="pv-text">' + (platform === 'ig' || platform === 'th' ? '<b>' + escapeHtml(meta.handle.replace(/^@/, '')) + '</b> ' : '') +
      (txt || '<i style="color:var(--grey)">(пусто)</i>') + hashHtml + '</div>';
    return '<div class="preview-card ' + platform + '" style="border-top:2px solid ' + meta.accent + ';">' + head + media + actions + body + '</div>';
  }
  window.renderPreviewSection = function (p) {
    var cr = (p.creatives || []).map(function (id) { return Store.creative(id); }).filter(Boolean);
    var first = cr[0];
    var firstMedia = first ? mediaThumb(first, { size: 'preview' }) : '<span style="font-size:48px;">🚗</span>';
    var mediaBg = previewMediaBg(first);
    var t = previewText(p);
    if (!p.platforms || !p.platforms.length) return '<div style="color:var(--grey);font-size:12px;padding:8px 0;">Оберіть майданчики — побачите прев\'ю.</div>';
    var cards = p.platforms.map(function (pl) { return buildPlatformCard(pl, p, firstMedia, mediaBg, t.txt, t.hashHtml); }).join('');
    return '<div class="preview-row" style="overflow-x:auto;gap:14px;padding-bottom:8px;">' + cards + '</div>';
  };

  // ---- Bell counter ----
  function computeBellCount() {
    try {
      if (!window.Store || typeof Store.pubs !== 'function') return 0;
      var me = Store.currentUser && Store.currentUser(); if (!me) return 0;
      var pubs = Store.pubs();
      var board = pubs.filter(function (p) { return p.status === 'review' && (p.approvers || []).indexOf(me.id) >= 0; }).length;
      var missed = pubs.filter(function (p) { return typeof urgencyClass === 'function' && urgencyClass(p) === 'missed'; }).length;
      var urgent = pubs.filter(function (p) { return typeof urgencyClass === 'function' && urgencyClass(p) === 'urgent-red'; }).length;
      return board + missed + urgent;
    } catch (e) { return 0; }
  }
  function updateBellBadge() {
    var el = document.getElementById('bellBadge'); if (!el) return;
    var n = computeBellCount();
    if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.style.display = ''; }
    else el.style.display = 'none';
  }
  updateBellBadge(); setTimeout(updateBellBadge, 800); setTimeout(updateBellBadge, 2500);
  setInterval(updateBellBadge, 30000);
  window.addEventListener('hashchange', function () { setTimeout(updateBellBadge, 300); });
  var _origUpsertForBell = Store && Store.upsertPub;
  if (_origUpsertForBell && !_origUpsertForBell.__bellPatched) {
    var _f = _origUpsertForBell.bind(Store);
    Store.upsertPub = function (pub) {
      var r = _f(pub);
      if (r && typeof r.then === 'function') return r.then(function (v) { setTimeout(updateBellBadge, 300); return v; });
      setTimeout(updateBellBadge, 300);
      return r;
    };
    Store.upsertPub.__uuidPatched = _origUpsertForBell.__uuidPatched;
    Store.upsertPub.__bellPatched = true;
  }
  window.updateBellBadge = updateBellBadge;

  // ============================================================
  // FIX #5: AUTOSAVE FLUSH at Modal.close + beforeunload
  // ============================================================
  function flushAutosave() {
    try {
      if (typeof cardAutosaveTimer !== 'undefined' && cardAutosaveTimer) {
        clearTimeout(cardAutosaveTimer);
        // Викликаємо handler синхронно — він уже всередині пише в Store
        // Бо у core: setTimeout(() => { ... Store.upsertPub(p); ... }, 700)
        // Найпростіше — викликати autosave({...}) знову з нульовою затримкою.
        // Натомість, ми просто шукаємо last-opened pub з DOM:
      }
      // Витягуємо id картки з заголовка
      var titleInp = document.getElementById('f_title');
      if (!titleInp) return; // картка не відкрита
      // Беремо pub з останнього `Store.pub` — на жаль unknown без id. Замість того:
      // тригернемо autosave вручну якщо вона існує і відома _pub (через global)
      if (window.__hqCurrentPub && typeof autosave === 'function') {
        // прискорений flush: викликаємо без debounce
        var p = window.__hqCurrentPub;
        try { Store.upsertPub(p); } catch(_) {}
      }
    } catch (e) { console.warn('flushAutosave:', e); }
  }
  // Перехоплюємо openCard щоб зберігати __hqCurrentPub
  // (Виконається після refresh-creative-strip нижче)

  // Перехоплюємо Modal.close
  if (window.Modal && typeof Modal.close === 'function' && !Modal.close.__flushPatched) {
    var _origClose = Modal.close.bind(Modal);
    Modal.close = function () { try { flushAutosave(); } catch(_){} return _origClose(); };
    Modal.close.__flushPatched = true;
  }
  // beforeunload — flush
  window.addEventListener('beforeunload', flushAutosave);

  // ============================================================
  // FIX #6: filter click — guard від повторного openCard
  // ============================================================
  // Sidebar filter-chip onclick викликає navigate() з поточним hash.
  // Якщо хеш = #publication/xxx — то navigate знову відкриває картку.
  // Перехоплюємо клік на filter-chip і скидаємо hash на calendar/board/library.
  document.addEventListener('click', function (e) {
    var chip = e.target && e.target.closest && e.target.closest('.sidebar .filter-chip');
    if (!chip) return;
    // Якщо ми зараз на route 'publication' — повернути на calendar
    var hash = (location.hash || '').slice(1);
    var route = hash.split('/')[0];
    if (route === 'publication' || route === 'settings') {
      // підмінюємо хеш без перезавантаження
      var target = (window.App && App.view) || 'calendar';
      if (target === 'publication' || target === 'settings') target = 'calendar';
      // не викликаємо navigate тут — onclick chip сам викличе
      try { history.replaceState(null, '', '#' + target); } catch(_){ location.hash = '#' + target; }
    }
  }, true); // capture phase, до click handler у chip

  // ============================================================
  // FIX #7: SOFT DELETE з UNDO toast
  // ============================================================
  // Перехоплюємо Store.deletePub: ставимо _trashed flag, через 7 сек реально видаляємо.
  // Toast з кнопкою «Повернути» — скасовує.
  var _trashTimers = {};
  function softDelete(pubId) {
    var p = Store.pub(pubId);
    if (!p) return;
    p._trashed = true;
    p._trashedAt = Date.now();
    if (typeof Store._saveLocal === 'function') Store._saveLocal();
    // Перерендерити поточну view (щоб публікація сховалась)
    if (typeof navigate === 'function') navigate();
    if (typeof updateNavCounts === 'function') updateNavCounts();
    showUndoToast(pubId, p.title || 'Публікація');
    // Через 7 сек — справжній delete (тільки якщо ще _trashed)
    _trashTimers[pubId] = setTimeout(function () {
      var cur = Store.pub(pubId);
      if (cur && cur._trashed) {
        try {
          _hardDeletePub(pubId);
        } catch (e) { console.warn('hard delete:', e); }
      }
      delete _trashTimers[pubId];
    }, 7000);
  }
  function undoDelete(pubId) {
    var p = Store.pub(pubId);
    if (!p) return;
    delete p._trashed;
    delete p._trashedAt;
    if (_trashTimers[pubId]) { clearTimeout(_trashTimers[pubId]); delete _trashTimers[pubId]; }
    if (typeof Store._saveLocal === 'function') Store._saveLocal();
    if (typeof navigate === 'function') navigate();
    if (typeof updateNavCounts === 'function') updateNavCounts();
    if (typeof toast === 'function') toast('Повернено', 'success', p.title);
  }
  function _hardDeletePub(id) {
    // Викликаємо _orig delete зі збереженим reference (нижче)
    if (typeof _origDeletePub === 'function') _origDeletePub(id);
    else {
      // Fallback
      Store._data.publications = (Store._data.publications || []).filter(function (x) { return x.id !== id; });
      if (typeof Store._saveLocal === 'function') Store._saveLocal();
    }
  }
  function showUndoToast(pubId, title) {
    var stack = document.getElementById('toastStack');
    if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast warn undoable';
    el.innerHTML = '<div><b>Видалено</b><div class="toast-body">' + escapeHtml(title) + '</div></div>' +
      '<button class="undo-btn" data-undo="' + pubId + '">↶ Повернути</button>';
    stack.appendChild(el);
    el.querySelector('.undo-btn').onclick = function () { undoDelete(pubId); el.remove(); };
    setTimeout(function () { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all 0.3s'; }, 6500);
    setTimeout(function () { el.remove(); }, 7000);
  }
  var _origDeletePub;
  function patchDelete() {
    if (!window.Store || typeof Store.deletePub !== 'function' || Store.deletePub.__softPatched) return;
    _origDeletePub = Store.deletePub.bind(Store);
    Store.deletePub = function (id) { softDelete(id); };
    Store.deletePub.__softPatched = true;
  }
  patchDelete(); setTimeout(patchDelete, 300); setTimeout(patchDelete, 1500);

  // Сховати _trashed з усіх запитів pubs
  if (window.Store && typeof Store.pubs === 'function' && !Store.pubs.__trashFiltered) {
    var _origPubs = Store.pubs.bind(Store);
    Store.pubs = function () { return _origPubs().filter(function (p) { return !p._trashed; }); };
    Store.pubs.__trashFiltered = true;
  }

  // ============================================================
  // /settings ROUTE
  // ============================================================
  function renderSettings(root) {
    var me = Store.currentUser ? Store.currentUser() : null;
    root.innerHTML =
      '<div class="view-header"><h1>Налаштування</h1><span class="view-meta">· профіль і інтеграції</span></div>' +
      '<div style="padding:22px 28px;max-width:680px;">' +
        '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:22px;margin-bottom:18px;">' +
          '<h3 style="font-size:14px;color:#fff;margin-bottom:12px;">👤 Профіль</h3>' +
          '<div style="display:grid;grid-template-columns:140px 1fr;gap:10px 18px;font-size:13px;">' +
            '<div style="color:var(--grey);">Імʼя</div><div style="color:#fff;font-weight:600;">' + escapeHtml((me && me.name) || '—') + '</div>' +
            '<div style="color:var(--grey);">Email</div><div style="color:#fff;">' + escapeHtml((me && me.email) || '—') + '</div>' +
            '<div style="color:var(--grey);">Роль</div><div><span class="status ' + ((me && me.role) || 'member') + '">' + escapeHtml((me && me.role) || '—') + '</span></div>' +
            '<div style="color:var(--grey);">ID</div><div style="color:var(--grey-2);font-family:monospace;font-size:11px;">' + escapeHtml((me && me.id) || '—') + '</div>' +
          '</div></div>' +
        '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:22px;margin-bottom:18px;">' +
          '<h3 style="font-size:14px;color:#fff;margin-bottom:8px;">✈️ Telegram — персональні сповіщення</h3>' +
          '<p style="color:var(--grey);font-size:12px;line-height:1.6;margin-bottom:14px;">Щоб отримувати DM від HQ-бота про твої публікації — додай свій <code>tg_chat_id</code>. Як знайти: напиши боту <code>/start</code>, відкрий <code>https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code>, скопіюй число з <code>chat.id</code>.</p>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<input id="set_tg_chat_id" type="text" placeholder="123456789" value="' + escapeHtml((me && (me.tg_chat_id || '')) + '') + '" style="flex:1;background:var(--bg);border:1px solid var(--border);color:#fff;padding:9px 12px;border-radius:8px;font-size:13px;font-family:monospace;"/>' +
            '<button class="btn btn-primary" id="set_tg_save">Зберегти</button></div>' +
          '<div id="set_tg_status" style="font-size:11px;color:var(--grey);margin-top:8px;"></div></div>' +
        '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:22px;">' +
          '<h3 style="font-size:14px;color:#fff;margin-bottom:8px;">🔔 Сповіщення</h3>' +
          '<div style="font-size:12px;color:var(--grey);line-height:1.7;">Поточна логіка:<br>· Group chat — усі події.<br>· DM — приходять, якщо <code>tg_chat_id</code> заповнений вище.</div>' +
        '</div></div>';
    var saveBtn = document.getElementById('set_tg_save');
    if (saveBtn) saveBtn.onclick = saveTgChatId;
  }
  async function saveTgChatId() {
    var inp = document.getElementById('set_tg_chat_id'); var status = document.getElementById('set_tg_status');
    if (!inp) return;
    var v = (inp.value || '').trim();
    var num = v === '' ? null : parseInt(v, 10);
    if (v !== '' && (isNaN(num) || Math.abs(num) < 1000)) { status.textContent = '⚠ chat_id має бути числом.'; status.style.color = 'var(--red-soft)'; return; }
    if (!window.HQ_BACKEND) {
      status.textContent = 'У demo-режимі чат збережено локально.'; status.style.color = 'var(--grey)';
      var me = Store.currentUser(); if (me) { me.tg_chat_id = num; Store._saveLocal && Store._saveLocal(); }
      return;
    }
    var sb = window.supabase;
    if (!sb) { status.textContent = '⚠ Supabase клієнт недоступний.'; status.style.color = 'var(--red-soft)'; return; }
    status.textContent = 'Зберігаю…'; status.style.color = 'var(--gold)';
    try {
      var me = Store.currentUser();
      var { error } = await sb.from('users').update({ tg_chat_id: num }).eq('id', me.id);
      if (error) throw error;
      if (me) me.tg_chat_id = num;
      status.textContent = '✓ Збережено. Тепер бот зможе писати тобі DM.'; status.style.color = 'var(--green-soft)';
      if (typeof toast === 'function') toast('Збережено', 'success', 'TG chat_id оновлено');
    } catch (e) {
      console.error(e); status.textContent = '⚠ Помилка: ' + (e.message || e); status.style.color = 'var(--red-soft)';
    }
  }
  window.renderSettings = renderSettings;

  function ensureSettingsRoute() {
    var _origNavigate = window.navigate;
    if (typeof _origNavigate !== 'function' || _origNavigate.__settingsPatched) return;
    window.navigate = function () {
      var hash = (location.hash || '').slice(1);
      var route = hash.split('/')[0];
      if (route === 'settings') {
        document.querySelectorAll('.sidebar a.nav-item').forEach(function (a) { a.classList.remove('active'); });
        var bc = document.getElementById('breadcrumb');
        if (bc) bc.innerHTML = 'Стіл SMM · <b>Налаштування</b>';
        var main = document.getElementById('main');
        if (main) renderSettings(main);
        if (typeof updateNavCounts === 'function') updateNavCounts();
        return;
      }
      return _origNavigate.apply(this, arguments);
    };
    window.navigate.__settingsPatched = true;
  }
  ensureSettingsRoute(); setTimeout(ensureSettingsRoute, 300);

  document.addEventListener('click', function (e) {
    var item = e.target && e.target.closest && e.target.closest('.dropdown-item');
    if (item && /Профіль/i.test(item.textContent || '')) {
      e.preventDefault();
      location.hash = '#settings';
      if (window.Modal && typeof Modal.close === 'function') Modal.close();
    }
  }, true);

  // ---- Patch: refresh creative-strip + __hqCurrentPub для autosave flush ----
  function refreshCreativeStrip(p) {
    var strip = document.getElementById('f_creatives'); if (!strip || !p) return;
    strip.querySelectorAll('.cs-item').forEach(function (item) {
      var cid = item.dataset.id; var c = Store.creative(cid); if (!c) return;
      if (item.querySelector('img, video')) return;
      item.style.position = 'relative'; item.style.overflow = 'hidden';
      var removeBtn = item.querySelector('.cs-remove');
      item.innerHTML = mediaThumb(c, { size: 'tile' });
      if (removeBtn) item.appendChild(removeBtn);
    });
  }
  var _origOpenCard = window.openCard;
  window.openCard = function (id) {
    _origOpenCard.call(this, id);
    var p = id === 'new' ? null : Store.pub(id);
    if (p) {
      window.__hqCurrentPub = p;
      setTimeout(function () { refreshCreativeStrip(p); }, 0);
    }
  };
  var _origUpload = window.uploadCreativeFile;
  if (typeof _origUpload === 'function') {
    window.uploadCreativeFile = function (file, pub) {
      var r = _origUpload.call(this, file, pub);
      if (r && typeof r.then === 'function') return r.then(function (v) { refreshCreativeStrip(pub); return v; });
      setTimeout(function () { refreshCreativeStrip(pub); }, 300);
      return r;
    };
  }
  if (typeof window.openCreativePicker === 'function') {
    var _origPicker = window.openCreativePicker;
    window.openCreativePicker = function (p) {
      _origPicker.call(this, p);
      setTimeout(function () {
        document.querySelectorAll('.modal-body .lib-tile[data-pick]').forEach(function (el) {
          var cid = el.dataset.pick; var c = Store.creative(cid); if (!c) return;
          var preview = el.querySelector('.lt-preview'); if (!preview) return;
          if (preview.querySelector('img, video')) return;
          var badge = preview.querySelector('.lt-type-badge');
          var hasMedia = (c.url || c.thumbnail_url) && (c.type === 'photo' || c.type === 'video');
          if (hasMedia) preview.style.background = 'var(--bg-3)';
          preview.style.position = 'relative'; preview.style.overflow = 'hidden';
          preview.innerHTML = mediaThumb(c, { size: 'tile' });
          if (badge) preview.appendChild(badge);
        });
      }, 0);
    };
  }

  console.log('%cDreamCar HQ Patches v3 %c· thumbs+team+UUID+previews+bell+settings+undo+filter-guard active', 'color:#4ade80;font-weight:700;', 'color:#888;');
})();
