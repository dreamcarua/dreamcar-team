/* ============================================================
   DreamCar HQ — Pravky-2f: force re-render після rescue
   ============================================================ */
// Pravky-2e оновив Store.creatives, але DOM lib-tile рендерився раніше з emoji.
// Викликаємо window.navigate() після rescue щоб renderLibGrid знов виконав
// з актуальними url.

(function () {
  if (window.__hqPravky2f) return;
  window.__hqPravky2f = true;

  var lastForceRender = 0;

  async function forceRescueAndRender() {
    var now = Date.now();
    if (now - lastForceRender < 1500) return;
    try {
      var sb = window.supabase;
      if (!sb || !Store || !Store._data || !Store._data.creatives) return;

      // 1. Fetch creatives з url
      var resp = await sb.from('creatives')
        .select('id, thumbnail_url, drive_file_id')
        .is('deleted_at', null);
      if (resp.error) return;
      var byId = {};
      (resp.data || []).forEach(function (c) { byId[c.id] = c; });

      var updated = 0;
      Store._data.creatives.forEach(function (c) {
        var e = byId[c.id];
        if (!e) return;
        if (!c.thumbnail_url && e.thumbnail_url) { c.thumbnail_url = e.thumbnail_url; updated++; }
        if (!c.drive_file_id && e.drive_file_id) c.drive_file_id = e.drive_file_id;
        if (!c.url && e.thumbnail_url) { c.url = e.thumbnail_url; updated++; }
      });

      if (updated > 0) {
        if (window.DEBUG) console.log('%cDreamCar HQ Rescue 2f %c· hydrated, force navigate()',
          'color:#7ab0ff;font-weight:700;', 'color:#888;');
        // FORCE re-render через navigate() — це переробить .lib-tile / .cal-card etc
        if (typeof window.navigate === 'function') {
          try { window.navigate(); } catch (_) {}
        }
        // Якщо відкрита картка — refreshPreview
        if (typeof window.refreshPreview === 'function' && window.__hqCurrentPub) {
          try { window.refreshPreview(window.__hqCurrentPub); } catch (_) {}
        }
        lastForceRender = now;
      }
    } catch (e) { console.warn('rescue2f:', e); }
  }

  // ---- Triggers ----
  // 1. Initial — кілька разів
  [800, 2000, 4000, 8000].forEach(function (ms) { setTimeout(forceRescueAndRender, ms); });

  // 2. hashchange (відкриття будь-якого розділу)
  window.addEventListener('hashchange', function () {
    [500, 1500, 3000].forEach(function (ms) { setTimeout(forceRescueAndRender, ms); });
  });

  // 3. DOM trigger: коли з'явилися .lib-tile або .cal-card
  if ('MutationObserver' in window) {
    var lastTriggerTime = 0;
    var mo = new MutationObserver(function () {
      var now = Date.now();
      if (now - lastTriggerTime < 500) return;
      // Чи є lib-tile / cal-card з emoji (без img)?
      var emojiTiles = document.querySelectorAll('.lib-tile, .cal-card');
      var hasEmoji = false;
      for (var i = 0; i < Math.min(emojiTiles.length, 5); i++) {
        if (!emojiTiles[i].querySelector('img, video') && emojiTiles[i].textContent.includes('🖼️')) {
          hasEmoji = true;
          break;
        }
      }
      if (hasEmoji) {
        lastTriggerTime = now;
        setTimeout(forceRescueAndRender, 200);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (window.DEBUG) console.log('%cDreamCar HQ Pravky-2f %c· rescue + force navigate active',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
