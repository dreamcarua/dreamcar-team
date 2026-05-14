/* ============================================================
   DreamCar HQ — Telegram Login Widget wire-up (#27)
   ============================================================ */

(function () {
  if (window.__hqTgLoginLoaded) return;
  window.__hqTgLoginLoaded = true;

  function fnUrl(name) {
    var base = (window.HQ_CONFIG && window.HQ_CONFIG.SUPABASE_URL) || '';
    return base.replace(/\/$/, '') + '/functions/v1/' + name;
  }

  window.onTgAuth = async function (user) {
    if (!user || !user.hash) {
      if (typeof toast === 'function') toast('TG Login', 'error', 'Невалідні дані з Telegram');
      return;
    }
    if (!window.HQ_CONFIG || !window.HQ_CONFIG.SUPABASE_URL) {
      if (typeof toast === 'function') toast('TG Login', 'error', 'Backend не налаштований');
      return;
    }
    if (!window.supabase) {
      if (typeof toast === 'function') toast('TG Login', 'error', 'Supabase SDK не завантажений');
      return;
    }

    if (typeof toast === 'function') toast('TG Login', 'info', 'Перевіряю підпис…');

    try {
      var resp = await fetch(fnUrl('tg-login-verify'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
      var data;
      try { data = await resp.json(); } catch (_) { data = null; }

      if (!resp.ok || !data || !data.ok) {
        var msg = (data && data.error) || ('HTTP ' + resp.status);
        if (typeof toast === 'function') toast('TG Login помилка', 'error', msg);
        console.error('tg-login-verify failed:', resp.status, data);
        return;
      }

      var setResult = await window.supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });
      if (setResult.error) {
        if (typeof toast === 'function') toast('TG Login', 'error', 'setSession: ' + setResult.error.message);
        return;
      }
      if (typeof toast === 'function') toast('Вхід через Telegram', 'success', 'Перезавантажую…');
      setTimeout(function () { location.reload(); }, 600);
    } catch (e) {
      console.error('onTgAuth network err:', e);
      if (typeof toast === 'function') toast('TG Login', 'error', String(e.message || e));
    }
  };

  console.log('%cDreamCar HQ TG Login %c· onTgAuth wired to tg-login-verify', 'color:#0088cc;font-weight:700;', 'color:#888;');

  // ============================================================
  // LOADER CHAIN — підвантажуємо нові модулі
  // ============================================================
  var chain = [
    'app-user-fields-fix.js',         // FIX: hydrate tg_chat_id, onboarding_steps
    'app-tg-save-fix.js',             // FIX: defensive TG save with row-count verification
    'app-creative-fields-fix.js',     // FIX: hydrate thumbnail_url для creatives (preview media)
    'app-tg-login-widget.js',         // FEAT: TG Login Widget injection (#27)
    'app-brand.js',                   // Visual identity
    'app-access-request.js',          // G1
    'app-vacation.js',                // G5a
    'app-fts-search.js',              // G6
    'app-analytics.js',               // C2 + G7
    'app-ai-copy.js',                 // A2
    'app-no-hashtags.js',             // FEAT E: hashtags removal (must load AFTER ai-copy)
    'app-templates.js',               // B3
    'app-templates-crud-fix.js',      // FEAT: templates create/edit for admin
    'app-sla.js',                     // #8 SLA timer
    'app-onboarding.js',              // #9 Onboarding checklist
    'app-onb-layout-fix.js',          // FIX: onboarding stray steps DOM repair
    'app-multi-approver-fix.js',      // FEAT: multi-approver AND logic via RPC
    'app-realtime-fix.js',            // FEAT A: real-time updates без F5
    'app-calendar-per-platform.js',   // FEAT F: дублювати пост на платформу
    'app-mentions.js',                // FEAT L: @mentions у коментарях
    'app-reapprove-on-edit.js',       // FEAT H: auto-revert у review при >10 chars edit
    'app-ui-extras.js',               // FEAT C+D+J+K: pending approvers + theme + sidebar + sounds
    'app-pwa.js',                     // #10 PWA install
  ];
  chain.forEach(function (name) {
    if (document.querySelector('script[src*="' + name + '"]')) return;
    var s = document.createElement('script');
    s.src = name + '?v=' + Date.now();
    s.defer = true;
    document.head.appendChild(s);
  });
})();
