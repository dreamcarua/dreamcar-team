// =====================================================================
// app-dispatch-hooks.js — миттєвий тригер GH workflows
// =====================================================================
// Замість чекати cron, фронтенд викликає Edge Function dispatch-workflow
// одразу при значимій події:
//
//   • Upload відео → trigger 'compress' workflow (≤2 секунди до старту)
//   • Pub approved → trigger 'autopost' workflow (≤2 секунди до старту)
//
// Інтегрується глобально через моніторинг supabase insert events або
// hook у Store.create/update.
// =====================================================================

(function() {
  'use strict';

  if (window.HQ_dispatch) return; // single-init

  async function dispatchWorkflow(workflow) {
    const cfg = window.HQ_CONFIG;
    if (!cfg?.SUPABASE_URL) {
      console.warn('[dispatch] no SUPABASE_URL, skip');
      return { ok: false, reason: 'no-config' };
    }
    // Беремо access_token поточного юзера (для Bearer)
    let token = cfg.SUPABASE_ANON_KEY;
    if (window.supabase) {
      const { data } = await window.supabase.auth.getSession();
      if (data?.session?.access_token) token = data.session.access_token;
    }
    try {
      const r = await fetch(`${cfg.SUPABASE_URL}/functions/v1/dispatch-workflow`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ workflow }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.warn('[dispatch] failed', r.status, j);
        return { ok: false, status: r.status, body: j };
      }
      console.log('[dispatch] ✓', workflow, j);
      return { ok: true, body: j };
    } catch (e) {
      console.warn('[dispatch] error', e);
      return { ok: false, reason: 'fetch-error', error: String(e) };
    }
  }

  // ── Hook A: спостерігаємо за створенням video creatives ──
  // Викликається через supabase realtime channel на INSERT
  function watchCreativeInserts() {
    if (!window.supabase || !window.HQ_BACKEND) return;
    window.supabase
      .channel('hq-dispatch-creatives')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'creatives' },
        (payload) => {
          const c = payload.new || {};
          if (c.type === 'video' && c.compressed_status === 'pending') {
            console.log('[dispatch] New video creative — triggering compress', c.id);
            dispatchWorkflow('compress');
          }
        })
      .subscribe();
  }

  // ── Hook B: спостерігаємо за створенням autopost queue rows ──
  function watchAutopostQueueInserts() {
    if (!window.supabase || !window.HQ_BACKEND) return;
    window.supabase
      .channel('hq-dispatch-autopost')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'tg_autopost_queue' },
        (payload) => {
          const q = payload.new || {};
          if (q.status === 'pending') {
            console.log('[dispatch] New autopost queue — triggering autopost', q.id);
            // 5-секундний debounce — даємо DB врегулюватись
            setTimeout(() => dispatchWorkflow('autopost'), 5000);
          }
        })
      .subscribe();
  }

  // ── Init ──
  function init() {
    if (!window.HQ_BACKEND) {
      console.log('[dispatch] demo mode — skip realtime hooks');
      return;
    }
    watchCreativeInserts();
    watchAutopostQueueInserts();
    console.log('[dispatch] ✓ Realtime hooks armed');
  }

  // Public API — можна викликати вручну
  window.HQ_dispatch = {
    compress: () => dispatchWorkflow('compress'),
    autopost: () => dispatchWorkflow('autopost'),
  };

  // Auto-init після завантаження
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 1000); // wait for supabase client
  }
})();
