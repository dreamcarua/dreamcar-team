/* ============================================================
   DreamCar HQ — Pravky-2e: creatives rescue на hashchange
   ============================================================ */
// Користувач відкрив pub через URL — rescueCreatives не спрацював.
// Додаємо hashchange listener + DOM observer на f_creatives.

(function () {
  if (window.__hqPravky2e) return;
  window.__hqPravky2e = true;

  var rescueRunning = false;
  var lastRescueAt = 0;

  async function rescueCreatives() {
    var now = Date.now();
    if (rescueRunning || now - lastRescueAt < 1500) return;
    rescueRunning = true;
    try {
      var sb = window.supabase;
      if (!sb || !window.Store || !Store._data || !Array.isArray(Store._data.creatives)) return;
      if (Store._data.creatives.length === 0) return;
      // Якщо ВСІ creatives мають url або thumbnail_url — skip
      var missing = Store._data.creatives.filter(function (c) { return !c.url && !c.thumbnail_url; });
      if (missing.length === 0) return;

      var resp = await sb.from('creatives')
        .select('id, thumbnail_url, drive_file_id, width_px, height_px, size_bytes')
        .is('deleted_at', null);
      if (resp.error) { console.warn('rescue2e err:', resp.error); return; }
      var byId = {};
      (resp.data || []).forEach(function (c) { byId[c.id] = c; });
      var updated = 0;
      Store._data.creatives.forEach(function (c) {
        var e = byId[c.id];
        if (!e) return;
        if (!c.thumbnail_url && e.thumbnail_url) c.thumbnail_url = e.thumbnail_url;
        if (!c.drive_file_id && e.drive_file_id) c.drive_file_id = e.drive_file_id;
        if (!c.url && e.thumbnail_url) { c.url = e.thumbnail_url; updated++; }
      });
      if (updated > 0) {
        if (window.DEBUG) console.log('%cDreamCar HQ Rescue 2e %c· ' + updated + ' creatives',
          'color:#7ab0ff;font-weight:700;', 'color:#888;');
        // Triggers
        if (typeof window.refreshPreview === 'function' && window.__hqCurrentPub) {
          try { window.refreshPreview(window.__hqCurrentPub); } catch (_) {}
        }
        // Force re-render creative strip thumbnails
        var strip = document.getElementById('f_creatives');
        if (strip) {
          strip.querySelectorAll('.cs-item').forEach(function (item) {
            var cid = item.dataset.id;
            var c = Store.creative(cid);
            if (!c || !c.url) return;
            // Якщо вже img — skip
            if (item.querySelector('img, video')) return;
            // Replace emoji з img
            var removeBtn = item.querySelector('.cs-remove');
            item.style.position = 'relative';
            item.style.overflow = 'hidden';
            if (c.type === 'photo') {
              item.innerHTML = '<img src="' + c.url + '" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;"/>';
            } else if (c.type === 'video') {
              item.innerHTML = '<video src="' + c.url + '#t=0.1" preload="metadata" muted playsinline style="width:100%;height:100%;object-fit:cover;"></video>';
            }
            if (removeBtn) item.appendChild(removeBtn);
          });
        }
      }
      lastRescueAt = now;
    } catch (e) { console.warn('rescue2e exception:', e); }
    finally { rescueRunning = false; }
  }

  // ---- Triggers ----
  // 1. hashchange — найважливіше
  window.addEventListener('hashchange', function () {
    [300, 800, 1500, 3000].forEach(function (ms) { setTimeout(rescueCreatives, ms); });
  });

  // 2. DOM observer на body — коли з'являється f_creatives або preview-card
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function (muts) {
      var trigger = false;
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (!(n instanceof Element)) return;
          if (n.id === 'f_creatives' || n.querySelector && (n.querySelector('#f_creatives, .preview-card, .cs-item'))) {
            trigger = true;
          }
        });
      });
      if (trigger) {
        clearTimeout(window.__hq2eTimer);
        window.__hq2eTimer = setTimeout(rescueCreatives, 200);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // 3. Кожні 4с — fallback
  setInterval(function () {
    if (Store && Store._data && Array.isArray(Store._data.creatives) && Store._data.creatives.length > 0) {
      var anyMissing = Store._data.creatives.some(function (c) { return !c.url && !c.thumbnail_url; });
      if (anyMissing) rescueCreatives();
    }
  }, 4000);

  // 4. Initial
  [400, 1200, 2500, 5000].forEach(function (ms) { setTimeout(rescueCreatives, ms); });

  if (window.DEBUG) console.log('%cDreamCar HQ Pravky-2e %c· creatives rescue на hashchange active',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
