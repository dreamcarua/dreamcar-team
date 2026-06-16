/* ============================================================
   DreamCar HQ — Compress Preview (auto-swap compressed_url + spinner)
   ============================================================
   Логіка:
   - Якщо creative.type='video' AND compressed_status='ready' AND compressed_url
     → preview/playback використовує compressed_url (як прийде в TG)
   - Якщо pending/processing → overlay-spinner "Стискаю для прев'ю…"
   - Polling кожні 8с: REST GET creatives select id, compressed_status, compressed_url
     для всіх pending у поточному view
   - При status→ready: live update у Store + DOM
   ============================================================ */
(function () {
  if (window.__hqCompressPreviewLoaded) return;
  window.__hqCompressPreviewLoaded = true;

  var POLL_INTERVAL_MS = 8000;
  var pendingIds = new Set();
  var pollTimer = null;

  function injectStyles() {
    if (document.getElementById('hq-compress-preview-styles')) return;
    var s = document.createElement('style');
    s.id = 'hq-compress-preview-styles';
    s.textContent = `
      .hq-compress-overlay {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.75);
        color: #fff; font-size: 13px;
        z-index: 10;
        pointer-events: none;
        backdrop-filter: blur(2px);
        border-radius: inherit;
      }
      .hq-compress-overlay .hq-spinner {
        width: 24px; height: 24px;
        border: 3px solid rgba(255,255,255,0.2);
        border-top-color: var(--blue-soft, #7ab0ff);
        border-radius: 50%;
        animation: hq-spin 0.9s linear infinite;
        margin-right: 10px;
      }
      .hq-compress-overlay-text { display: flex; align-items: center; flex-direction: row; }
      @keyframes hq-spin { to { transform: rotate(360deg); } }
      .hq-compress-failed {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(120,0,0,0.7);
        color: #ffaaaa; font-size: 12px;
        z-index: 10;
        pointer-events: none;
        border-radius: inherit;
      }
    `;
    document.head.appendChild(s);
  }
  injectStyles();

  function addOverlay(host, status) {
    if (!host) return;
    if (host.querySelector('.hq-compress-overlay, .hq-compress-failed')) return;
    var ov = document.createElement('div');
    if (status === 'failed') {
      ov.className = 'hq-compress-failed';
      ov.innerHTML = '<span>⚠️ Стиснення не вдалося</span>';
    } else {
      ov.className = 'hq-compress-overlay';
      ov.innerHTML = '<span class="hq-compress-overlay-text"><span class="hq-spinner"></span>Стискаю для прев\'ю…</span>';
    }
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(ov);
  }
  function removeOverlay(host) {
    if (!host) return;
    host.querySelectorAll('.hq-compress-overlay, .hq-compress-failed').forEach(function (e) { e.remove(); });
  }

  // Знаходимо DOM-елементи що показують конкретний creative
  function hostsForCreative(creativeId) {
    var nodes = document.querySelectorAll('[data-creative-id="' + creativeId + '"], [data-id="' + creativeId + '"]');
    return Array.from(nodes);
  }

  function swapVideoSrc(host, newUrl) {
    if (!host) return;
    var v = host.querySelector('video');
    if (v) {
      try {
        if (v.src !== newUrl) {
          v.src = newUrl;
          v.load();
        }
      } catch (_) {}
    }
    // Також можна оновити <img> poster чи фоновий thumbnail якщо є
    host.dataset.compressedUrl = newUrl;
  }

  function applyState(cre) {
    if (!cre) return;
    var hosts = hostsForCreative(cre.id);
    if (cre.compressed_status === 'ready' && cre.compressed_url) {
      hosts.forEach(function (h) {
        removeOverlay(h);
        swapVideoSrc(h, cre.compressed_url);
      });
      pendingIds.delete(cre.id);
    } else if (cre.compressed_status === 'pending' || cre.compressed_status === 'processing') {
      hosts.forEach(function (h) { addOverlay(h, cre.compressed_status); });
      pendingIds.add(cre.id);
    } else if (cre.compressed_status === 'failed') {
      hosts.forEach(function (h) { addOverlay(h, 'failed'); });
      pendingIds.delete(cre.id);
    } else {
      // n/a (photo/audio/doc) — нічого
      pendingIds.delete(cre.id);
    }
  }

  // Сканує Store на video creatives і застосовує state до DOM
  function scanStore() {
    if (typeof Store === 'undefined' || !Store._data || !Array.isArray(Store._data.creatives)) return;
    Store._data.creatives.forEach(function (c) {
      if (c.type !== 'video') return;
      // Store creative може не мати compressed_status — тоді треба poll
      var status = c.compressed_status;
      if (status === undefined && c.id) pendingIds.add(c.id);
      applyState({ id: c.id, compressed_status: status, compressed_url: c.compressed_url });
    });
  }

  // Polling: REST GET для всіх pending creative IDs
  async function pollPending() {
    if (!window.supabase || !window.HQ_BACKEND) return;
    if (pendingIds.size === 0) return;

    var ids = Array.from(pendingIds);
    try {
      var { data, error } = await window.supabase
        .from('creatives')
        .select('id, type, compressed_status, compressed_url, compressed_size_bytes')
        .in('id', ids);
      if (error) { console.warn('compress poll error', error); return; }

      (data || []).forEach(function (cre) {
        applyState(cre);
        // Оновлюємо Store cache
        if (typeof Store !== 'undefined' && Store._data && Array.isArray(Store._data.creatives)) {
          var local = Store._data.creatives.find(function (c) { return c.id === cre.id; });
          if (local) {
            local.compressed_status     = cre.compressed_status;
            local.compressed_url        = cre.compressed_url;
            local.compressed_size_bytes = cre.compressed_size_bytes;
          }
        }
      });
    } catch (e) { console.warn('compress poll throw', e); }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      scanStore();
      pollPending();
    }, POLL_INTERVAL_MS);
    // Перший scan після завантаження DOM
    setTimeout(scanStore, 800);
    setTimeout(scanStore, 2500);
    setTimeout(function () { scanStore(); pollPending(); }, 5000);
  }

  // MutationObserver — нові DOM-вузли (наприклад відкриття картки)
  var observer = new MutationObserver(function () {
    scanStore();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Старт
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPolling);
  } else {
    startPolling();
  }

  // Експорт для дебагу
  window.HQ_COMPRESS = {
    scan: scanStore,
    poll: pollPending,
    pendingIds: pendingIds,
  };
  if (window.DEBUG) console.log('%cDreamCar HQ Compress Preview %c· polling every 8s · auto-swap when ready', 'color:#10b981;font-weight:700;', 'color:#888;');
})();
