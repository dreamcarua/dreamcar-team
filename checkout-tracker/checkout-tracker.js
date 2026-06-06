/* ============================================================
   DreamCar Checkout Tracker — A/B/C testing library
   06.06.2026 v1.0
   ============================================================
   Usage:
     <script src="https://team.dreamcar.ua/checkout-tracker/checkout-tracker.js" defer></script>
     <script>
       window.dcTrackerConfig = {
         experimentId: 'upsell_window_1',
         apiUrl: 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/track-checkout',
         apiKey: '<SUPABASE_ANON_KEY>'  // публичный, у нас RLS service
       };
     </script>

     На каждом шаге:
     dcMarkStepArrival('phone', 1);
     dcTrack({step:'phone', outcome:'next'});         // → следующий шаг
     dcTrack({step:'upsell_window_1', outcome:'took', amount_offered:4999});
     dcTrack({step:'success', outcome:'next', amount_final:4999, tariff_final:'gold'});
============================================================ */
(function() {
  'use strict';
  if (window.dcTrack) return; // уже подключён

  const config = window.dcTrackerConfig || {};
  const API_URL = config.apiUrl || 'https://wotghlaehnvxyeacznvv.supabase.co/functions/v1/track-checkout';
  const API_KEY = config.apiKey || '';
  const EXPERIMENT_ID = config.experimentId || 'upsell_window_1';
  const VERSION = '1.0.0';
  const BATCH_SIZE = 5;
  const FLUSH_INTERVAL_MS = 2000;
  const INACTIVITY_MS = 5 * 60 * 1000;

  let queue = [];
  let flushTimer = null;
  let stepArrivedAt = Date.now();
  let inactivityTimer = null;

  // ===== Sticky session =====
  function getSessionId() {
    const m = document.cookie.match(/__dc_sess=([^;]+)/);
    if (m) return m[1];
    const sid = 'sess_' + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toUTCString();
    document.cookie = `__dc_sess=${sid}; path=/; expires=${expires}; SameSite=Lax`;
    return sid;
  }

  function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }

  // ===== Sticky variant assignment =====
  function getVariant() {
    const cacheKey = `__dc_variant_${EXPERIMENT_ID}`;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) return cached;
    } catch (_) {}
    const sid = getSessionId();
    const hash = simpleHash(sid + EXPERIMENT_ID);
    const bucket = hash % 100;
    let variant;
    if (bucket < 20) variant = 'control';
    else if (bucket < 60) variant = 'A';
    else variant = 'B';
    try { sessionStorage.setItem(cacheKey, variant); } catch (_) {}
    return variant;
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
    const variant = input.variant || getVariant();
    const eventId = 'evt_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '_' + Math.random().toString(36).slice(2));
    return {
      event_id: eventId,
      session_id: sid,
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

  window.dcGetVariant = function() {
    return getVariant();
  };

  window.dcGetSessionId = function() {
    return getSessionId();
  };

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

  console.log('[dcTrack] initialized v' + VERSION + ' · variant=' + getVariant() + ' · session=' + getSessionId().slice(0, 16));
})();
