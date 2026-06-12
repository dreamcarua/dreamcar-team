/* ============================================================
   DreamCar HQ — Patches v3
   Real thumbnails + team refresh + UUID fix + multi-platform previews
   + real bell counter + /settings route + UX-фіксы (sidebar filter,
   autosave flush, filter→card guard, undo-delete) + per-platform schedule.
   ============================================================ */

(function () {
  // ---- Inject CSS ----
  (function injectCss() {
    if (document.getElementById('hq-patches-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-patches-css';
    css.textContent =
      '.sidebar .filter-chip { position: relative; }' +
      '.sidebar .filter-chip.on { background: var(--red-dim); color: #fff; font-weight: 600; }' +
      '.sidebar .filter-chip.on::before { content: "✓"; position: absolute; right: 24px; color: var(--red-soft); font-size: 11px; font-weight: 700; }' +
      '.sidebar .filter-chip:not(.on) { opacity: 0.85; }' +
      '.pf-btn { position: relative; }' +
      '.pf-btn.on { box-shadow: 0 0 0 1px var(--red-soft); }' +
      '.toast.undoable { display: flex; align-items: center; gap: 12px; }' +
      '.toast .undo-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.25); color: #fff; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; }' +
      '.toast .undo-btn:hover { background: rgba(255,255,255,0.2); }' +
      // Per-platform schedule block
      '.platform-schedule { margin-top: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }' +
      '.platform-schedule .ps-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--grey); margin-bottom: 8px; font-weight: 700; }' +
      '.platform-schedule .ps-row { display: grid; grid-template-columns: 130px 1fr auto; gap: 8px; align-items: center; padding: 4px 0; }' +
      '.platform-schedule .ps-row + .ps-row { border-top: 1px solid var(--border); }' +
      '.platform-schedule .ps-platform { font-size: 12px; color: #fff; font-weight: 600; }' +
      '.platform-schedule .ps-platform.is-override { color: var(--gold); }' +
      '.platform-schedule .ps-platform .ps-base-hint { font-size: 10px; color: var(--grey); font-weight: 400; margin-top: 2px; }' +
      '.platform-schedule input[type="datetime-local"] { background: var(--bg-3); border: 1px solid var(--border); color: #fff; padding: 6px 8px; border-radius: 6px; font-size: 12px; font-family: inherit; width: 100%; }' +
      '.platform-schedule .ps-reset { background: transparent; border: 1px solid var(--border); color: var(--grey); padding: 4px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; }' +
      '.platform-schedule .ps-reset:hover { color: var(--red-soft); border-color: var(--red); }' +
      '.platform-schedule .ps-empty { color: var(--grey-2); font-size: 11px; padding: 4px 0; }';
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
      if (p && !p.platformSchedule) p.platformSchedule = {};
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
    var fontSize = size === 'modal' ? '72px' : size === 'card' ? '18px' : '30px';
    var emoji = '<span style="font-size:' + fontSize + ';">' + (c.preview || '📦') + '</span>';
    // #369 (12.06.2026 Vadym): для PREVIEW (як у TG/IG) показуємо ЗАВЖДИ <img> з thumbnail_url,
    // НЕ <video>. Video element без autoplay = чорний блок з play button без кадру.
    // TG/IG показують preview як poster image — те саме робимо тут.
    if (c.type === 'photo') {
      var pUrl = safeUrl(c.thumbnail_url) || safeUrl(c.compressed_url) || safeUrl(c.url) || '';
      if (!pUrl) return emoji;
      return '<img src="' + pUrl + '" alt="' + escapeHtml(c.name || '') + '" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;"/>';
    }
    if (c.type === 'video') {
      // Завжди thumbnail_url як poster, ніколи <video>. Play overlay поверх.
      var vUrl = safeUrl(c.thumbnail_url) || safeUrl(c.compressed_url) || safeUrl(c.url) || '';
      if (!vUrl) {
        // Fallback: фоновий emoji + play overlay
        return '<div style="position:absolute;inset:0;background:#000;display:flex;align-items:center;justify-content:center;font-size:64px;color:#fff;">🎬</div>' +
          '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6);font-size:48px;pointer-events:none;">▶</div>';
      }
      return '<img src="' + vUrl + '" alt="' + escapeHtml(c.name || '') + '" loading="lazy" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;"/>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.8);font-size:48px;pointer-events:none;">▶</div>';
    }
    return emoji;
  }
  window.mediaThumb = mediaThumb;
  window.safeUrl = safeUrl;

  // ---- boardCard ----
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

  // ---- renderLibGrid ----
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

  // ---- openCreative ----
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
    var color = (first && first.color) || '#E30613';
    return 'background: linear-gradient(135deg, ' + color + '33, var(--bg-2));';
  }
  // #258: TG HTML parser — дозволені теги розпарсуємо, все інше escape (XSS-safe)
  function tgFmt(raw) {
    if (!raw) return '';
    var s = String(raw).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var tags = ['b','strong','i','em','u','s','strike','del','code','pre','tg-spoiler','blockquote','br'];
    tags.forEach(function(t){
      s = s.replace(new RegExp('&lt;' + t + '&gt;', 'gi'), '<' + t + '>')
           .replace(new RegExp('&lt;\\/' + t + '&gt;', 'gi'), '</' + t + '>');
    });
    s = s.replace(/&lt;a\s+href=&quot;([^&]+)&quot;&gt;([\s\S]*?)&lt;\/a&gt;/gi, function(_, url, txt){
      return '<a href="' + url.replace(/"/g,'&quot;') + '" target="_blank" rel="noopener" style="color:#3390ec;">' + txt + '</a>';
    });
    s = s.replace(/&lt;&lt;&lt;([\s\S]+?)&gt;&gt;&gt;/g, '<tg-spoiler>$1</tg-spoiler>');
    return s;
  }
  function previewText(p) {
    // #258: replace escapeHtml → tgFmt — TG-теги (b/i/u/s/code/pre/tg-spoiler/blockquote/a) рендеряться
    var txt = tgFmt(p.text || '').replace(/(#[\p{L}\p{N}_]+)/gu, '<span class="pv-hash">$1</span>');
    var hashLine = (p.hashtags || []).map(function (h) { return h.indexOf('#') === 0 ? h : '#' + h; }).join(' ');
    var hashHtml = hashLine ? '<div style="margin-top:6px;color:var(--blue-soft);font-size:11px;">' + escapeHtml(hashLine).replace(/(#\S+)/g, '<span class="pv-hash">$1</span>') + '</div>' : '';
    return { txt: txt, hashHtml: hashHtml };
  }
  function buildPlatformCard(platform, p, firstMedia, mediaBg, txt, hashHtml) {
    var meta = PLATFORM_PREVIEW_META[platform]; if (!meta) return '';
    var aspectStyle = 'aspect-ratio:' + meta.aspect + ';';
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
  // PER-PLATFORM SCHEDULE (#3)
  // ============================================================
  // Допоміжна: ISO → "YYYY-MM-DDTHH:MM" для datetime-local input
  function isoToLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function localInputToIso(v) {
    if (!v) return null;
    var d = new Date(v); if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function renderPlatformScheduleBlock(p) {
    if (!p.platforms || !p.platforms.length) return '';
    if (!p.platformSchedule) p.platformSchedule = {};
    var PLATFORM_NAMES = (typeof PLATFORMS !== 'undefined' && PLATFORMS) || [];
    var rows = p.platforms.map(function (pid) {
      var meta = PLATFORM_NAMES.find(function (x) { return x.id === pid; }) || { id: pid, name: pid, icon: '' };
      var override = p.platformSchedule[pid] || '';
      var isOverride = !!override;
      var localVal = isoToLocalInput(override || p.dateTime);
      return '<div class="ps-row" data-platform="' + pid + '">' +
        '<div class="ps-platform ' + (isOverride ? 'is-override' : '') + '">' +
          (meta.icon || '') + ' ' + escapeHtml(meta.name) +
          '<div class="ps-base-hint">' + (isOverride ? '↳ власний час' : 'базовий час') + '</div>' +
        '</div>' +
        '<input type="datetime-local" data-ps-input="' + pid + '" value="' + localVal + '"/>' +
        '<button type="button" class="ps-reset" data-ps-reset="' + pid + '" ' + (isOverride ? '' : 'style="visibility:hidden;"') + '>↺ скинути</button>' +
        '</div>';
    }).join('');
    return '<div class="platform-schedule" id="platformSchedule">' +
      '<div class="ps-title">⏰ Розклад по платформах</div>' +
      rows +
    '</div>';
  }
  function attachPlatformScheduleHandlers(p) {
    var wrap = document.getElementById('platformSchedule');
    if (!wrap) return;
    wrap.querySelectorAll('[data-ps-input]').forEach(function (inp) {
      inp.onchange = function () {
        var pid = inp.dataset.psInput;
        var iso = localInputToIso(inp.value);
        if (!p.platformSchedule) p.platformSchedule = {};
        if (iso && iso !== p.dateTime) {
          p.platformSchedule[pid] = iso;
        } else {
          delete p.platformSchedule[pid];
        }
        // Перерендерити блок щоб оновити "is-override" + reset button
        var newHtml = renderPlatformScheduleBlock(p);
        var holder = document.createElement('div');
        holder.innerHTML = newHtml;
        wrap.replaceWith(holder.firstChild);
        attachPlatformScheduleHandlers(p);
        if (typeof autosave === 'function') autosave(p);
      };
    });
    wrap.querySelectorAll('[data-ps-reset]').forEach(function (btn) {
      btn.onclick = function () {
        var pid = btn.dataset.psReset;
        if (p.platformSchedule) delete p.platformSchedule[pid];
        var newHtml = renderPlatformScheduleBlock(p);
        var holder = document.createElement('div');
        holder.innerHTML = newHtml;
        wrap.replaceWith(holder.firstChild);
        attachPlatformScheduleHandlers(p);
        if (typeof autosave === 'function') autosave(p);
      };
    });
  }
  function installPlatformScheduleUI(p) {
    if (!p) return;
    // Знаходимо chip-row #f_platforms — вставляємо блок після його батьківського .field
    var chipRow = document.getElementById('f_platforms');
    if (!chipRow) return;
    var field = chipRow.closest('.field') || chipRow.parentElement;
    if (!field) return;
    // Видаляємо попередній (на випадок реcреш)
    var existing = document.getElementById('platformSchedule');
    if (existing) existing.remove();
    field.insertAdjacentHTML('afterend', renderPlatformScheduleBlock(p));
    attachPlatformScheduleHandlers(p);

    // Хук: коли user міняє chip — переписувати блок
    chipRow.querySelectorAll('.chip').forEach(function (c) {
      // оригінальний onclick зберігається; додаємо додатковий handler
      c.addEventListener('click', function () {
        // На наступний tick (після того як addEventListener у views.js встиг переключити on/off)
        setTimeout(function () {
          // Перерендерити блок із актуальним p.platforms
          var holder = document.createElement('div');
          holder.innerHTML = renderPlatformScheduleBlock(p);
          var cur = document.getElementById('platformSchedule');
          if (cur) cur.replaceWith(holder.firstChild);
          else field.insertAdjacentHTML('afterend', renderPlatformScheduleBlock(p));
          attachPlatformScheduleHandlers(p);
        }, 50);
      });
    });
  }

  // ============================================================
  // Persist platform_schedule у Supabase
  // ============================================================
  function patchPersistForPlatformSchedule() {
    if (!window.Store || typeof Store._persistPub !== 'function' || Store._persistPub.__psPatched) return;
    var _orig = Store._persistPub.bind(Store);
    Store._persistPub = async function (pub) {
      // Викликаємо оригінал — він робить upsert main row + relations.
      // Потім окремо оновлюємо platform_schedule.
      await _orig(pub);
      try {
        var sb = window.supabase;
        var sched = pub.platformSchedule && Object.keys(pub.platformSchedule).length > 0 ? pub.platformSchedule : null;
        var { error } = await sb.from('publications').update({ platform_schedule: sched }).eq('id', pub.id);
        if (error) console.warn('platform_schedule update:', error);
      } catch (e) { console.warn('platform_schedule persist:', e); }
    };
    Store._persistPub.__psPatched = true;
  }
  patchPersistForPlatformSchedule();
  setTimeout(patchPersistForPlatformSchedule, 500);
  setTimeout(patchPersistForPlatformSchedule, 2000);

  // Hydrate platformSchedule при завантаженні з бекенду
  function patchLoadForPlatformSchedule() {
    if (!window.Store || typeof Store._loadFromBackend !== 'function' || Store._loadFromBackend.__psPatched) return;
    var _orig = Store._loadFromBackend.bind(Store);
    Store._loadFromBackend = async function () {
      await _orig();
      try {
        var sb = window.supabase;
        var { data } = await sb.from('publications').select('id, platform_schedule, deleted_at');
        var bySchedId = {};
        (data || []).forEach(function (r) { bySchedId[r.id] = r; });
        (Store._data.publications || []).forEach(function (p) {
          var row = bySchedId[p.id];
          if (!row) return;
          p.platformSchedule = row.platform_schedule || {};
          if (row.deleted_at) p._trashed = true;
        });
      } catch (e) { console.warn('platform_schedule hydrate:', e); }
    };
    Store._loadFromBackend.__psPatched = true;
  }
  patchLoadForPlatformSchedule();
  setTimeout(patchLoadForPlatformSchedule, 500);
  setTimeout(patchLoadForPlatformSchedule, 2000);

  // ============================================================
  // FIX #5: AUTOSAVE FLUSH at Modal.close + beforeunload
  // ============================================================
  function flushAutosave() {
    try {
      if (window.__hqCurrentPub) {
        var p = window.__hqCurrentPub;
        try { Store.upsertPub(p); } catch(_) {}
      }
    } catch (e) { console.warn('flushAutosave:', e); }
  }
  if (window.Modal && typeof Modal.close === 'function' && !Modal.close.__flushPatched) {
    var _origClose = Modal.close.bind(Modal);
    Modal.close = function () { try { flushAutosave(); } catch(_){} return _origClose(); };
    Modal.close.__flushPatched = true;
  }
  window.addEventListener('beforeunload', flushAutosave);

  // ============================================================
  // FIX #6: filter click — guard від повторного openCard
  // ============================================================
  document.addEventListener('click', function (e) {
    var chip = e.target && e.target.closest && e.target.closest('.sidebar .filter-chip');
    if (!chip) return;
    var hash = (location.hash || '').slice(1);
    var route = hash.split('/')[0];
    if (route === 'publication' || route === 'settings') {
      var target = (window.App && App.view) || 'calendar';
      if (target === 'publication' || target === 'settings') target = 'calendar';
      try { history.replaceState(null, '', '#' + target); } catch(_){ location.hash = '#' + target; }
    }
  }, true);

  // ============================================================
  // FIX #7: SOFT DELETE з UNDO toast
  // ============================================================
  var _trashTimers = {};
  function softDelete(pubId) {
    var p = Store.pub(pubId); if (!p) return;
    p._trashed = true; p._trashedAt = Date.now();
    if (typeof Store._saveLocal === 'function') Store._saveLocal();
    if (window.HQ_BACKEND && window.supabase) {
      window.supabase.from('publications').update({ deleted_at: new Date().toISOString() }).eq('id', pubId).then(function (res) {
        if (res.error) console.warn('soft delete persist:', res.error);
      });
    }
    if (typeof navigate === 'function') navigate();
    if (typeof updateNavCounts === 'function') updateNavCounts();
    showUndoToast(pubId, p.title || 'Публікація');
    _trashTimers[pubId] = setTimeout(function () {
      var cur = Store.pub(pubId);
      if (cur && cur._trashed) {
        try { _hardDeletePub(pubId); } catch (e) { console.warn('hard delete:', e); }
      }
      delete _trashTimers[pubId];
    }, 7000);
  }
  function undoDelete(pubId) {
    var p = Store.pub(pubId); if (!p) return;
    delete p._trashed; delete p._trashedAt;
    if (_trashTimers[pubId]) { clearTimeout(_trashTimers[pubId]); delete _trashTimers[pubId]; }
    if (typeof Store._saveLocal === 'function') Store._saveLocal();
    if (window.HQ_BACKEND && window.supabase) {
      window.supabase.from('publications').update({ deleted_at: null }).eq('id', pubId);
    }
    if (typeof navigate === 'function') navigate();
    if (typeof updateNavCounts === 'function') updateNavCounts();
    if (typeof toast === 'function') toast('Повернено', 'success', p.title);
  }
  function _hardDeletePub(id) {
    if (typeof _origDeletePub === 'function') _origDeletePub(id);
    else { Store._data.publications = (Store._data.publications || []).filter(function (x) { return x.id !== id; }); if (typeof Store._saveLocal === 'function') Store._saveLocal(); }
  }
  function showUndoToast(pubId, title) {
    var stack = document.getElementById('toastStack'); if (!stack) return;
    var el = document.createElement('div');
    el.className = 'toast warn undoable';
    el.innerHTML = '<div><b>Видалено</b><div class="toast-body">' + escapeHtml(title) + '</div></div>' +
      '<button class="undo-btn" data-undo="' + pubId + '">↶ Повернути</button>';
    stack.appendChild(el);
    el.querySelector('.undo-btn').onclick = function () { undoDelete(pubId); el.remove(); };
    setTimeout(function () { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all 0.3s'; }, 6500);
    setTimeout(function () { el.remove(); }, 7000);
  }
  // 03.06.2026: старий 7-сек soft-delete DISABLED. Замінений у app-trash.js на 30-day Корзину.
  // Не патчимо Store.deletePub тут — щоб не конфліктувати з __trashV2.
  /* function patchDelete() { ... } — REMOVED */

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
          '<p style="color:var(--grey);font-size:12px;line-height:1.6;margin-bottom:14px;">Щоб отримувати DM від HQ-бота — додай свій <code>tg_chat_id</code>.</p>' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
            '<input id="set_tg_chat_id" type="text" placeholder="123456789" value="' + escapeHtml((me && (me.tg_chat_id || '')) + '') + '" style="flex:1;background:var(--bg);border:1px solid var(--border);color:#fff;padding:9px 12px;border-radius:8px;font-size:13px;font-family:monospace;"/>' +
            '<button class="btn btn-primary" id="set_tg_save">Зберегти</button></div>' +
          '<div id="set_tg_status" style="font-size:11px;color:var(--grey);margin-top:8px;"></div></div>' +
        '<div style="background:var(--bg-2);border:1px solid var(--border);border-radius:12px;padding:22px;">' +
          '<h3 style="font-size:14px;color:#fff;margin-bottom:8px;">🔔 Сповіщення</h3>' +
          '<div style="font-size:12px;color:var(--grey);line-height:1.7;">Group chat — усі події. DM — якщо <code>tg_chat_id</code> заповнений вище.</div>' +
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
      var me = Store.currentUser(); if (me) { me.tg_chat_id = num; Store._saveLocal && Store._saveLocal(); } return;
    }
    var sb = window.supabase;
    if (!sb) { status.textContent = '⚠ Supabase клієнт недоступний.'; status.style.color = 'var(--red-soft)'; return; }
    status.textContent = 'Зберігаю…'; status.style.color = 'var(--gold)';
    try {
      var me = Store.currentUser();
      var { error } = await sb.from('users').update({ tg_chat_id: num }).eq('id', me.id);
      if (error) throw error;
      if (me) me.tg_chat_id = num;
      status.textContent = '✓ Збережено.'; status.style.color = 'var(--green-soft)';
      if (typeof toast === 'function') toast('Збережено', 'success', 'TG chat_id оновлено');
    } catch (e) { console.error(e); status.textContent = '⚠ Помилка: ' + (e.message || e); status.style.color = 'var(--red-soft)'; }
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

  // ---- Refresh creative-strip + __hqCurrentPub + platformSchedule UI ----
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
      if (!p.platformSchedule) p.platformSchedule = {};
      setTimeout(function () {
        refreshCreativeStrip(p);
        installPlatformScheduleUI(p);
      }, 0);
    } else {
      // new pub case — p === null, спробуємо взяти через global
      setTimeout(function () {
        var titleInp = document.getElementById('f_title');
        if (titleInp && window.__hqCurrentPub) installPlatformScheduleUI(window.__hqCurrentPub);
      }, 50);
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

  console.log('%cDreamCar HQ Patches v3 %c· all UX-фіксы active + per-platform schedule', 'color:#4ade80;font-weight:700;', 'color:#888;');
})();
