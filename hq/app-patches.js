/* ============================================================
   DreamCar HQ — Patches v2 (real thumbnails + team refresh + UUID fix)
   Завантажується ПІСЛЯ app-core.js + app-views.js.
   ============================================================ */

(function () {
  // ---- UUID helper: для backend-mode потрібен валідний UUID, а не "p_xxx"
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

  // ---- Patch newPubObject: id завжди UUID (інакше Supabase упаде на upsert)
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
  patchNewPub();
  setTimeout(patchNewPub, 300);
  setTimeout(patchNewPub, 1500);

  // ---- Patch Store.upsertPub: підмінити "p_xxx" на UUID перед persist
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
  patchUpsert();
  setTimeout(patchUpsert, 300);
  setTimeout(patchUpsert, 1500);

  // ---- Refresh demo team (тільки для demo, не backend)
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
  refreshDemoTeam();
  setTimeout(refreshDemoTeam, 500);
  setTimeout(refreshDemoTeam, 2000);

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
      return '<img src="' + url + '" alt="' + escapeHtml(c.name || '') +
        '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;"/>';
    }
    if (c.type === 'video') {
      return '<video src="' + url + '#t=0.1" preload="metadata" muted playsinline ' +
        'style="width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;pointer-events:none;"></video>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.6);font-size:28px;pointer-events:none;">▶</div>';
    }
    return emoji;
  }
  window.mediaThumb = mediaThumb;
  window.safeUrl = safeUrl;

  // ---- Override: boardCard ----
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
      '<div class="bc-head">' +
        '<div class="bc-thumb" style="position:relative;overflow:hidden;">' + thumb + '</div>' +
        '<div class="bc-body">' +
          '<div class="bc-title">' + escapeHtml(p.title) + '</div>' +
          '<div class="bc-meta">' + platformIcons(p.platforms) + ' · ' + p.contentType + ' · ' + respNames + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="bc-date ' + dueLabel.cls + '" style="margin-top:8px;">📅 ' + dueLabel.txt + '</div>' +
      '<div class="bc-actions">' +
        '<button class="btn btn-success btn-sm" data-action="approve" data-id="' + p.id + '">✓ Погодити</button>' +
        '<button class="btn btn-warn btn-sm" data-action="reject" data-id="' + p.id + '">↩ Повернути</button>' +
        '<button class="btn btn-sm" data-action="open" data-id="' + p.id + '">Відкрити</button>' +
      '</div>' +
    '</div>';
  };

  // ---- Override: renderLibGrid ----
  window.renderLibGrid = function (type, q) {
    var cr = Store.creatives();
    if (type !== 'all') cr = cr.filter(function (c) { return c.type === type; });
    if (q) {
      var Q = q.toLowerCase();
      cr = cr.filter(function (c) {
        return (c.name + ' ' + (c.tags || []).join(' ')).toLowerCase().indexOf(Q) >= 0;
      });
    }
    var grid = document.getElementById('libGrid');
    if (!cr.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1;"><div class="empty-icon">📦</div><div class="empty-title">Нічого не знайдено</div></div>'; return; }
    grid.innerHTML = cr.map(function (c) {
      var dur = c.duration ? '<div class="lt-dur">' + formatDur(c.duration) + '</div>' : '';
      var hasMedia = (c.url || c.thumbnail_url) && (c.type === 'photo' || c.type === 'video');
      var bg = hasMedia ? 'background:var(--bg-3);' : 'background:linear-gradient(135deg, ' + c.color + '33, transparent);';
      return '<div class="lib-tile" data-id="' + c.id + '">' +
        '<div class="lt-preview" style="' + bg + 'position:relative;overflow:hidden;">' +
          mediaThumb(c, { size: 'tile' }) +
          '<div class="lt-type-badge">' + c.type + '</div>' +
          dur +
        '</div>' +
        '<div class="lt-info">' +
          '<div class="lt-name" title="' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</div>' +
          '<div class="lt-meta">' + c.size + ' · ' + c.res + '</div>' +
          '<div class="lt-tags">' + (c.tags || []).slice(0, 3).map(function (t) { return '<span class="lt-tag">#' + escapeHtml(t) + '</span>'; }).join('') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    document.querySelectorAll('.lib-tile').forEach(function (el) { el.onclick = function () { openCreative(el.dataset.id); }; });
  };

  // ---- Override: openCreative ----
  window.openCreative = function (id) {
    var c = Store.creative(id);
    if (!c) return;
    var usedIn = Store.pubs().filter(function (p) { return (p.creatives || []).indexOf(id) >= 0; });
    var hasReal = (c.url || c.thumbnail_url) && (c.type === 'photo' || c.type === 'video');
    var bg = hasReal ? 'background:#000;' : 'background:linear-gradient(135deg, ' + c.color + '33, transparent);';
    var mediaHtml;
    if (c.type === 'video' && safeUrl(c.url)) {
      mediaHtml = '<video src="' + safeUrl(c.url) + '" controls preload="metadata" style="width:100%;height:100%;object-fit:contain;background:#000;"></video>';
    } else if (c.type === 'photo' && safeUrl(c.url)) {
      mediaHtml = '<img src="' + safeUrl(c.url) + '" alt="' + escapeHtml(c.name) + '" style="max-width:100%;max-height:100%;object-fit:contain;display:block;"/>';
    } else {
      mediaHtml = mediaThumb(c, { size: 'modal' });
    }
    Modal.open(
      '<div class="modal-head">' +
        '<h2>' + escapeHtml(c.name) + '</h2>' +
        '<span class="modal-meta">' + c.type + ' · ' + c.size + ' · ' + c.res + (c.duration ? ' · ' + formatDur(c.duration) : '') + '</span>' +
        '<button class="close" onclick="Modal.close()">×</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<div style="' + bg + 'border:1px solid var(--border);border-radius:10px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;color:#fff;margin-bottom:18px;position:relative;overflow:hidden;">' + mediaHtml + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">' +
          '<div>' +
            '<h4 style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey);margin-bottom:8px;font-weight:700;">Інформація</h4>' +
            '<div style="display:grid;gap:8px;font-size:13px;">' +
              '<div>📁 <b style="color:#fff">' + escapeHtml(c.name) + '</b></div>' +
              '<div>📦 ' + c.size + ', ' + c.res + (c.duration ? ', ' + formatDur(c.duration) : '') + '</div>' +
              '<div>👤 Завантажив: <b style="color:#fff">' + ((Store.user(c.uploadedBy) || {}).name || '—') + '</b></div>' +
              '<div>📅 ' + fmtDateTime(c.uploadedAt) + '</div>' +
              '<div>🏷️ ' + ((c.tags || []).map(function (t) { return '#' + t; }).join(' ') || '—') + '</div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<h4 style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey);margin-bottom:8px;font-weight:700;">Використовується в публікаціях</h4>' +
            '<div style="display:flex;flex-direction:column;gap:6px;">' +
              (usedIn.length ? usedIn.map(function (p) {
                return '<a href="#publication/' + p.id + '" style="background:var(--bg-3);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:12px;color:#fff;text-decoration:none;display:block;" onclick="Modal.close()">' + escapeHtml(p.title) + ' <small style="color:var(--grey)">· ' + fmtDate(p.dateTime) + '</small></a>';
              }).join('') : '<div style="color:var(--grey);font-size:12px;padding:8px 0;">Не використовується.</div>') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="modal-foot">' +
        (safeUrl(c.url) ? '<a class="btn" href="' + safeUrl(c.url) + '" target="_blank" rel="noopener">⬇ Відкрити оригінал</a>' : '') +
        '<button class="btn btn-danger" onclick="Modal.close()">Закрити</button>' +
      '</div>'
    );
  };

  // ---- Override: renderPreviewSection ----
  window.renderPreviewSection = function (p) {
    var cr = (p.creatives || []).map(function (id) { return Store.creative(id); }).filter(Boolean);
    var first = cr[0];
    var firstMedia = first ? mediaThumb(first, { size: 'preview' }) : '<span style="font-size:48px;">🚗</span>';
    var firstColor = (first && first.color) || '#cc0000';
    var hasRealMedia = first && (first.url || first.thumbnail_url) && (first.type === 'photo' || first.type === 'video');
    var mediaBg = hasRealMedia ? 'background:#000;' : 'background: linear-gradient(135deg, ' + firstColor + '33, var(--bg-2));';
    var txt = escapeHtml(p.text || '').replace(/(#[\p{L}\p{N}_]+)/gu, '<span class="pv-hash">$1</span>');
    var hashLine = (p.hashtags || []).map(function (h) { return h.indexOf('#') === 0 ? h : '#' + h; }).join(' ');
    var hashHtml = hashLine ? '<div style="margin-top:6px;color:var(--blue-soft);font-size:11px;">' + escapeHtml(hashLine).replace(/(#\S+)/g, '<span class="pv-hash">$1</span>') + '</div>' : '';
    var showIg = p.platforms.indexOf('ig') >= 0;
    var showTg = p.platforms.indexOf('tg') >= 0;
    if (!showIg && !showTg) return '<div style="color:var(--grey);font-size:12px;padding:8px 0;">Оберіть Instagram або Telegram у майданчиках — побачите прев\'ю.</div>';
    var igCard = !showIg ? '' :
      '<div class="preview-card ig">' +
        '<div class="pv-head"><div class="pv-avatar">DC</div><div><div class="pv-name">dreamcar.ua</div><div class="pv-handle">Sponsored</div></div></div>' +
        '<div class="pv-media" style="' + mediaBg + 'position:relative;overflow:hidden;">' + firstMedia + '</div>' +
        '<div class="pv-actions">♥ &nbsp; 💬 &nbsp; ↗ &nbsp; <span style="margin-left:auto">🔖</span></div>' +
        '<div class="pv-text"><b>dreamcar.ua</b> ' + (txt || '<i style="color:var(--grey)">(пусто)</i>') + hashHtml + '</div>' +
      '</div>';
    var tgCard = !showTg ? '' :
      '<div class="preview-card tg">' +
        '<div class="pv-head"><div class="pv-avatar">DC</div><div><div class="pv-name">Dream Car</div><div class="pv-handle">@dreamcar_ua · ' + fmtDate(new Date()) + ' ' + fmtTime(p.dateTime) + '</div></div></div>' +
        '<div class="pv-media tg" style="' + mediaBg + 'position:relative;overflow:hidden;">' + firstMedia + '</div>' +
        '<div class="pv-text">' + (txt || '<i style="color:var(--grey)">(пусто)</i>') + hashHtml + '</div>' +
      '</div>';
    return '<div class="preview-row">' + igCard + tgCard + '</div>';
  };

  // ---- Patch: refresh creative-strip у відкритій картці ----
  function refreshCreativeStrip(p) {
    var strip = document.getElementById('f_creatives');
    if (!strip || !p) return;
    strip.querySelectorAll('.cs-item').forEach(function (item) {
      var cid = item.dataset.id;
      var c = Store.creative(cid);
      if (!c) return;
      if (item.querySelector('img, video')) return;
      item.style.position = 'relative';
      item.style.overflow = 'hidden';
      var removeBtn = item.querySelector('.cs-remove');
      item.innerHTML = mediaThumb(c, { size: 'tile' });
      if (removeBtn) item.appendChild(removeBtn);
    });
  }

  var _origOpenCard = window.openCard;
  window.openCard = function (id) {
    _origOpenCard.call(this, id);
    var p = id === 'new' ? null : Store.pub(id);
    if (p) setTimeout(function () { refreshCreativeStrip(p); }, 0);
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
          var cid = el.dataset.pick;
          var c = Store.creative(cid);
          if (!c) return;
          var preview = el.querySelector('.lt-preview');
          if (!preview) return;
          if (preview.querySelector('img, video')) return;
          var badge = preview.querySelector('.lt-type-badge');
          var hasMedia = (c.url || c.thumbnail_url) && (c.type === 'photo' || c.type === 'video');
          if (hasMedia) preview.style.background = 'var(--bg-3)';
          preview.style.position = 'relative';
          preview.style.overflow = 'hidden';
          preview.innerHTML = mediaThumb(c, { size: 'tile' });
          if (badge) preview.appendChild(badge);
        });
      }, 0);
    };
  }

  console.log('%cDreamCar HQ Patches v2 %c· thumbs + team + UUID active', 'color:#4ade80;font-weight:700;', 'color:#888;');
})();
