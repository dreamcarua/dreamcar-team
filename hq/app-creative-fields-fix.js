/* ============================================================
   DreamCar HQ — Creative fields hydration FIX
   ============================================================ */
// БАГ: app-core.js _loadFromBackend mapping creatives робить cherry-pick:
//   {id, name, type, size, duration, res, tags, uploadedBy, uploadedAt, preview, color}
// ВТРАЧАЄ: thumbnail_url, drive_file_id — все що потрібно для рендеру preview.
// FIX: окремий select після _loadFromBackend який hydrate-ить ці поля
// + додає `url` alias для зручності mediaThumb.

(function () {
  if (window.__hqCreativeFieldsFix) return;
  window.__hqCreativeFieldsFix = true;

  async function hydrate() {
    try {
      var sb = window.supabase;
      if (!sb || !window.Store || !Store._data || !Array.isArray(Store._data.creatives)) return;
      if (Store._data.creatives.length === 0) return;

      var resp = await sb.from('creatives')
        .select('id, thumbnail_url, drive_file_id, width_px, height_px, size_bytes, duration_sec')
        .is('deleted_at', null);
      if (resp.error) { console.warn('creative hydrate err:', resp.error); return; }

      var byId = {};
      (resp.data || []).forEach(function (c) { byId[c.id] = c; });

      var updated = 0;
      Store._data.creatives.forEach(function (c) {
        var extra = byId[c.id];
        if (!extra) return;
        c.thumbnail_url = extra.thumbnail_url || null;
        c.drive_file_id = extra.drive_file_id || null;
        // url alias — щоб mediaThumb знаходив незалежно від ключа
        if (!c.url && extra.thumbnail_url) c.url = extra.thumbnail_url;
        updated++;
      });

      if (window.DEBUG) console.log('%cDreamCar HQ Creative fields %c· hydrated ' + updated + ' creatives',
        'color:#7ab0ff;font-weight:700;', 'color:#888;');

      // Якщо ми на сторінці що залежить від creatives — перерендерити
      var route = (location.hash || '').slice(1).split('/')[0];
      if (route === 'library' || route === 'calendar' || route === 'board' || route === 'publication') {
        if (typeof window.navigate === 'function') {
          try { window.navigate(); } catch (_) {}
        }
      }
      // refresh preview у відкритій картці
      if (typeof window.refreshPreview === 'function' && window.__hqCurrentPub) {
        try { window.refreshPreview(window.__hqCurrentPub); } catch (_) {}
      }
    } catch (e) { console.warn('creative hydrate exception:', e); }
  }

  function patchLoad() {
    if (!window.Store || typeof Store._loadFromBackend !== 'function') return false;
    if (Store._loadFromBackend.__creativeFieldsPatched) return true;
    var _orig = Store._loadFromBackend.bind(Store);
    Store._loadFromBackend = async function () {
      await _orig();
      await hydrate();
    };
    Store._loadFromBackend.__creativeFieldsPatched = true;
    return true;
  }

  if (!patchLoad()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (patchLoad() || tries++ > 20) clearInterval(iv);
    }, 250);
  }

  // Initial hydrate якщо Store вже завантажений
  setTimeout(function () {
    if (window.HQ_BACKEND && window.Store && Store._data && Array.isArray(Store._data.creatives) && Store._data.creatives.length > 0) {
      hydrate();
    }
  }, 1800);

  if (window.DEBUG) console.log('%cDreamCar HQ Creative-fields fix %c· installed', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
})();
