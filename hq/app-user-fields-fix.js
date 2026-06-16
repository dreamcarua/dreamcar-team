/* ============================================================
   DreamCar HQ — User fields hydration FIX
   ============================================================ */
// БАГ: у Store._loadFromBackend mapping users.data викидає важливі поля:
//   tg_chat_id, tg_username, onboarding_steps, onboarding_completed_at,
//   push_subscription.
// Результат: Settings показує placeholder "123456789" замість реального
// tg_chat_id, AI-копірайт не бачить підписки, onboarding скидається.
// FIX: окремий select запит після _loadFromBackend який hydrate-ить
// ці поля у Store._data.users.

(function () {
  if (window.__hqUserFieldsFix) return;
  window.__hqUserFieldsFix = true;

  function patchLoad() {
    if (!window.Store || typeof Store._loadFromBackend !== 'function') return false;
    if (Store._loadFromBackend.__userFieldsPatched) return true;

    var _orig = Store._loadFromBackend.bind(Store);
    Store._loadFromBackend = async function () {
      await _orig();
      try {
        var sb = window.supabase;
        if (!sb) return;
        var resp = await sb.from('users').select('id, tg_chat_id, tg_username, onboarding_steps, onboarding_completed_at, push_subscription');
        if (resp.error) {
          console.warn('user fields hydrate:', resp.error);
          return;
        }
        var byId = {};
        (resp.data || []).forEach(function (u) { byId[u.id] = u; });
        (Store._data.users || []).forEach(function (u) {
          var extra = byId[u.id];
          if (!extra) return;
          u.tg_chat_id = extra.tg_chat_id;
          u.tg_username = extra.tg_username;
          u.onboarding_steps = extra.onboarding_steps || {};
          u.onboarding_completed_at = extra.onboarding_completed_at;
          u.push_subscription = extra.push_subscription;
        });
        if (window.DEBUG) console.log('%cDreamCar HQ User fields %c· hydrated', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
      } catch (e) { console.warn('user fields hydrate exception:', e); }
    };
    Store._loadFromBackend.__userFieldsPatched = true;
    return true;
  }

  // Patch одразу + retry поки Store не зʼявиться
  if (!patchLoad()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (patchLoad() || tries++ > 20) clearInterval(iv);
    }, 250);
  }

  // Якщо Store уже завантажений — викликаємо hydrate один раз
  setTimeout(async function () {
    if (!window.Store || !Store._loadFromBackend || !window.HQ_BACKEND) return;
    if (Store._data && Array.isArray(Store._data.users) && Store._data.users.length > 0) {
      try {
        var sb = window.supabase;
        if (!sb) return;
        var resp = await sb.from('users').select('id, tg_chat_id, tg_username, onboarding_steps, onboarding_completed_at, push_subscription');
        if (resp.error) { console.warn('initial hydrate:', resp.error); return; }
        var byId = {};
        (resp.data || []).forEach(function (u) { byId[u.id] = u; });
        Store._data.users.forEach(function (u) {
          var extra = byId[u.id];
          if (!extra) return;
          u.tg_chat_id = extra.tg_chat_id;
          u.tg_username = extra.tg_username;
          u.onboarding_steps = extra.onboarding_steps || {};
          u.onboarding_completed_at = extra.onboarding_completed_at;
          u.push_subscription = extra.push_subscription;
        });
        // Якщо ми на Settings — переререндерити
        if ((location.hash || '').slice(1).split('/')[0] === 'settings') {
          if (typeof window.navigate === 'function') window.navigate();
        }
      } catch (e) { console.warn('initial hydrate threw:', e); }
    }
  }, 2000);

  if (window.DEBUG) console.log('%cDreamCar HQ User-fields fix %c· installed', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
})();
