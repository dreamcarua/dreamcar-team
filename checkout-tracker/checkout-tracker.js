/* ============================================================
   DreamCar Checkout Tracker — A/B/C testing library
   06.06.2026
   v2.0 — variant приходит снаружи (от сайта)
   v2.1 — backward-compat fallback на auto-hash variant
   v2.2 — dcSetSessionId() + dcSetUser() для merge с utm-tracker
   ============================================================
   Usage:
     <script src="https://team.dreamcar.ua/checkout-tracker/checkout-tracker.js" defer></script>
     <script>
       window.dcTrackerConfig = {
         experimentId: 'upsell_window_1',
         apiKey: '<SUPABASE_ANON_KEY>'
       };
     </script>

   Public API:
     dcSetVariant('A'|'B'|'control')    // сайт сам решил какой показать
     dcGetVariant()                      // вернёт текущий или null до dcSetVariant
     dcSetSessionId('your_visitor_id')   // merge с своим cookie (например dc_visitor_id)
     dcGetSessionId()                    // вернёт текущий sticky id
     dcSetUser('user_id')                // для авторизованных юзеров
     dcGetUser()
     dcMarkStepArrival('phone')          // на mount каждого шага
     dcTrack({step, outcome, ...})       // на любой пользовательский переход

   Sticky:
     - session_id: cookie __dc_sess (30 дней)
     - variant: sessionStorage (до закрытия таба)
     - user_id: in-memory (до перезагрузки)
============================================================ */
(function() {
  'use strict';
  if (window.dcTrack) return; // уже подключён

  const config = window.dcTrackerConfig || {};
  const API_URL = config.apiUrl || 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/track-checkout';
  const API_KEY = config.apiKey || '';
  const EXPERIMENT_ID = config.experimentId || 'upsell_window_1';
  const VERSION = '2.2.0';
  const BATCH_SIZE = 5;
  const FLUSH_INTERVAL_MS = 2000;
  const INACTIVITY_MS = 5 * 60 * 1000;
  const VALID_VARIANTS = ['control', 'A', 'B', 'C', 'D', 'E'];

  let queue = [];
  let flushTimer = null;
  let stepArrivedAt = Date.now();
  let inactivityTimer = null;

  // ===== Sticky session =====
  // v2.2: приоритет источника:
  //   1) явно установленный через dcSetSessionId() — сохраняется в cookie + window
  //   2) существующий cookie __dc_sess
  //   3) auto-generate новый sess_<uuid>
  let __customSessionId = null;
  function getSessionId() {
    if (__customSessionId) return __customSessionId;
    const m = document.cookie.match(/__dc_sess=([^;]+)/);
    if (m) return m[1];
    const sid = 'sess_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toUTCString();
    document.cookie = `__dc_sess=${sid}; path=/; expires=${expires}; SameSite=Lax`;
    return sid;
  }

  function setSessionId(id) {
    if (!id || typeof id !== 'string') {
      console.warn('[dcTrack] dcSetSessionId: invalid id', id);
      return false;
    }
    __customSessionId = id;
    // Также пишем в cookie чтобы было sticky при F5 даже без повторного вызова
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toUTCString();
    document.cookie = `__dc_sess=${id}; path=/; expires=${expires}; SameSite=Lax`;
    return true;
  }

  // User ID (для авторизованных юзеров — после login на сайте)
  let __userId = null;
  function setUserId(id) {
    if (!id) { __userId = null; return true; }
    __userId = String(id);
    return true;
  }
  function getUserId() { return __userId; }

  // ===== Variant — приоритет: dcSetVariant() от сайта; fallback: auto-hash =====
  // v2.1: backward-compatible. Если сайт уже вызвал dcSetVariant — используем его.
  // Если не вызвал — fallback на auto-расчёт по хешу session_id (как было в v1.0).
  // Это гарантирует что события не теряются если сайт не обновил интеграцию.

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  function autoComputeVariant() {
    // Fallback: детерминированный hash от session_id
    const sid = getSessionId();
    const hash = simpleHash(sid + EXPERIMENT_ID);
    const bucket = hash % 100;
    if (bucket < 20) return 'control';
    if (bucket < 60) return 'A';
    return 'B';
  }

  function getVariant() {
    const cacheKey = `__dc_variant_${EXPERIMENT_ID}`;
    const setKey = `__dc_variant_set_${EXPERIMENT_ID}`;
    try {
      // Если сайт явно вызвал dcSetVariant — берём его
      const explicitlySet = sessionStorage.getItem(setKey) === '1';
      const cached = sessionStorage.getItem(cacheKey);
      if (cached && VALID_VARIANTS.indexOf(cached) >= 0) return cached;
      if (explicitlySet) return null; // явно установили null/неверное — не угадывать
    } catch (_) {}
    // Fallback: автоматический расчёт
    const auto = autoComputeVariant();
    try { sessionStorage.setItem(cacheKey, auto); } catch (_) {}
    return auto;
  }

  function setVariant(variant) {
    if (!variant || VALID_VARIANTS.indexOf(variant) < 0) {
      console.warn('[dcTrack] dcSetVariant: invalid variant "' + variant + '", expected one of: ' + VALID_VARIANTS.join(', '));
      return false;
    }
    const cacheKey = `__dc_variant_${EXPERIMENT_ID}`;
    const setKey = `__dc_variant_set_${EXPERIMENT_ID}`;
    try {
      sessionStorage.setItem(cacheKey, variant);
      sessionStorage.setItem(setKey, '1');
    } catch (e) {
      console.warn('[dcTrack] sessionStorage недоступен:', e);
    }
    return true;
  }

  // ===== Device detection =====
  function detectDevice() {
    const ua = navigator.userAgent || '';
    if (/iPad|Tablet/i.test(ua)) return 'tablet';
    if (/Mobile|Android|iPhone/i.test(ua)) return 'mobile';
    return 'desktop';
  }

  // ===== UTM persistence =====
  function getUtm() {
    const params = new URLSearchParams(window.location.search);
    const utm = {};
    ['source', 'medium', 'campaign', 'content', 'term'].forEach(k => {
      const v = params.get(`utm_${k}`);
      if (v) utm[`utm_${k}`] = v;
    });
    if (Object.keys(utm).length) {
      try { sessionStorage.setItem('__dc_utm', JSON.stringify(utm)); } catch (_) {}
      return utm;
    }
    try {
      return JSON.parse(sessionStorage.getItem('__dc_utm') || '{}');
    } catch (_) {
      return {};
    }
  }

  // ===== Visitor info =====
  function getVisitor() {
    let firstVisit, visitCount;
    try {
      firstVisit = localStorage.getItem('__dc_first_visit');
      visitCount = parseInt(localStorage.getItem('__dc_visit_count') || '0') + 1;
      if (!firstVisit) {
        firstVisit = new Date().toISOString();
        localStorage.setItem('__dc_first_visit', firstVisit);
      }
      localStorage.setItem('__dc_visit_count', String(visitCount));
    } catch (_) {
      visitCount = 1;
    }
    const isRepeat = !!firstVisit && visitCount > 1;
    const days = firstVisit
      ? Math.floor((Date.now() - new Date(firstVisit).getTime()) / (24 * 3600 * 1000))
      : 0;
    return {
      is_repeat_visitor: isRepeat,
      visit_count: visitCount,
      days_since_first_visit: days
    };
  }

  // ===== Step index map =====
  const STEP_INDEX = {
    phone: 1, data_confirm: 2, tariff_pick: 3,
    upsell_window_1: 4, upsell_window_2: 5,
    payment: 6, success: 7, failure: 7
  };

  // ===== Build event =====
  function buildEvent(input) {
    const visitor = getVisitor();
    const utm = getUtm();
    const sid = getSessionId();
    // Variant: либо явно передан в input, либо берём из storage (установлен через dcSetVariant)
    const variant = input.variant || getVariant();
    const eventId = 'evt_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2));
    return {
      event_id: eventId,
      session_id: sid,
      user_id: __userId || input.user_id || null,
      ts: new Date().toISOString(),
      experiment_id: input.experiment_id || EXPERIMENT_ID,
      variant: variant,
      step: input.step,
      step_index: input.step_index || STEP_INDEX[input.step] || null,
      outcome: input.outcome,
      drop_reason: input.drop_reason || null,
      time_on_step_ms: input.time_on_step_ms != null ? input.time_on_step_ms : (Date.now() - stepArrivedAt),
      step_arrived_at: input.step_arrived_at || new Date(stepArrivedAt).toISOString(),
      step_left_at: new Date().toISOString(),
      tariff_base: input.tariff_base || null,
      amount_base: input.amount_base || null,
      qty_base: input.qty_base || null,
      tariff_offered: input.tariff_offered || null,
      amount_offered: input.amount_offered || null,
      qty_offered: input.qty_offered || null,
      discount_offered_pct: input.discount_offered_pct || null,
      tariff_final: input.tariff_final || null,
      amount_final: input.amount_final || null,
      qty_final: input.qty_final || null,
      device: detectDevice(),
      user_agent: (navigator.userAgent || '').slice(0, 200),
      referrer: document.referrer || null,
      page_url: window.location.href,
      page_path: window.location.pathname,
      app_version: window.__APP_VERSION__ || null,
      ab_engine_version: VERSION,
      ...visitor,
      ...utm,
      meta: input.meta || {}
    };
  }

  // ===== Public API =====
  window.dcTrack = function(input) {
    if (!input || !input.step || !input.outcome) {
      console.warn('[dcTrack] step и outcome обязательны');
      return;
    }
    const ev = buildEvent(input);
    if (!ev.variant) {
      // getVariant() уже делает fallback на auto-расчёт, так что null значит только
      // что explicit dcSetVariant был вызван с невалидным значением. Пропускаем.
      console.warn('[dcTrack] variant=null после fallback (вероятно dcSetVariant вызван с невалидным значением). Event пропущен.');
      return null;
    }
    queue.push(ev);
    if (queue.length >= BATCH_SIZE) flush();
    else scheduleFlush();
    return ev.event_id;
  };

  window.dcMarkStepArrival = function(step, stepIndex) {
    stepArrivedAt = Date.now();
    window.__currentStep = step;
    window.__currentStepIndex = stepIndex || STEP_INDEX[step] || null;
    resetInactivity();
  };

  // ⭐ Новый API v2: сайт сам устанавливает вариант
  window.dcSetVariant = function(variant) {
    const ok = setVariant(variant);
    if (ok) console.log('[dcTrack] variant set to "' + variant + '"');
    return ok;
  };

  window.dcGetVariant = function() {
    return getVariant();
  };

  window.dcGetSessionId = function() {
    return getSessionId();
  };

  // ⭐ v2.2: позволяет сайту мерджить свой visitor_id (из utm-tracker) с нашим session_id
  // Чтобы не плодить разные id. Если сайт не вызвал — fallback на наш sess_<uuid> как раньше.
  window.dcSetSessionId = function(id) {
    const ok = setSessionId(id);
    if (ok) console.log('[dcTrack] session_id set to "' + id + '"');
    return ok;
  };

  // ⭐ v2.2: для авторизованных юзеров — привязать user_id к событиям
  window.dcSetUser = function(id) {
    const ok = setUserId(id);
    if (ok && id) console.log('[dcTrack] user_id set to "' + id + '"');
    return ok;
  };
  window.dcGetUser = function() { return getUserId(); };

  // ===== Flush mechanism =====
  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
  }

  function flush(useBeacon) {
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    const payload = JSON.stringify({ events: batch });
    if (useBeacon && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(API_URL, blob);
      return;
    }
    fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'apikey': API_KEY,
        'authorization': 'Bearer ' + API_KEY
      },
      body: payload,
      keepalive: true
    }).catch(err => {
      console.warn('[dcTrack] failed', err);
      queue = batch.concat(queue);
    });
  }

  // ===== Inactivity timer =====
  function resetInactivity() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      if (window.__currentStep && window.__currentStep !== 'success') {
        window.dcTrack({
          step: window.__currentStep,
          outcome: 'dropped',
          drop_reason: 'inactive_5min'
        });
      }
    }, INACTIVITY_MS);
  }
  ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach(ev => {
    document.addEventListener(ev, resetInactivity, { passive: true });
  });

  // ===== Beforeunload / pagehide =====
  function unloadHandler() {
    if (queue.length) flush(true);
    if (window.__currentStep && window.__currentStep !== 'success' && window.__currentStep !== 'failure') {
      const e = buildEvent({
        step: window.__currentStep,
        outcome: 'dropped',
        drop_reason: 'tab_close'
      });
      if (!e.variant) return; // нет варианта — нет события
      const payload = JSON.stringify({ events: [e] });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(API_URL, new Blob([payload], { type: 'application/json' }));
      }
    }
  }
  window.addEventListener('beforeunload', unloadHandler);
  window.addEventListener('pagehide', unloadHandler);

  // ===== Browser back button =====
  window.addEventListener('popstate', () => {
    if (window.__currentStep && window.__currentStep !== 'success') {
      window.dcTrack({
        step: window.__currentStep,
        outcome: 'dropped',
        drop_reason: 'back_btn'
      });
    }
  });

  const initVariant = getVariant();
  console.log('[dcTrack] initialized v' + VERSION + ' · variant=' + (initVariant || '(не установлен — жду dcSetVariant)') + ' · session=' + getSessionId().slice(0, 16));
})();
