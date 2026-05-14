/* ============================================================
   DreamCar HQ — UI Extras (sidebar collapse + light theme + sounds + pending approvers)
   ============================================================ */
// #J: згортання sidebar до 60px (іконки) ↔ 220px (повний)
// #D: світла/темна тема toggle у topbar
// #K: системні beep звуки на події у HQ
// #C: показ pending approvers у відкритій картці публікації

(function () {
  if (window.__hqUiExtras) return;
  window.__hqUiExtras = true;

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  // =================================================================
  // CSS injection
  // =================================================================
  (function injectCss() {
    if (document.getElementById('hq-ui-extras-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-ui-extras-css';
    css.textContent =
      // --- Sidebar collapse ---
      'body.hq-sidebar-collapsed .app { grid-template-columns: 60px 1fr !important; }' +
      'body.hq-sidebar-collapsed .sidebar .nav-item .label, ' +
      'body.hq-sidebar-collapsed .sidebar .nav-section, ' +
      'body.hq-sidebar-collapsed .sidebar .filters, ' +
      'body.hq-sidebar-collapsed .sidebar .nav-item .count { display: none !important; }' +
      'body.hq-sidebar-collapsed .sidebar .nav-item { justify-content: center; padding: 9px 6px; }' +
      'body.hq-sidebar-collapsed .logo-text { display: none !important; }' +
      // --- Topbar icon buttons ---
      '.hq-topbar-icon { background: var(--bg-3); border: 1px solid var(--border); width: 36px; height: 36px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 16px; cursor: pointer; margin-right: 6px; transition: background 0.15s; }' +
      '.hq-topbar-icon:hover { background: var(--bg-hover); }' +
      '.hq-topbar-icon.on { color: var(--red-soft); border-color: var(--red); }' +
      // --- Light theme overrides ---
      'body.hq-light { background: #f5f5f7; }' +
      'body.hq-light .app, body.hq-light .topbar, body.hq-light .sidebar, body.hq-light .logo { background: #ffffff !important; color: #1a1a1f; border-color: #e0e0e6 !important; }' +
      'body.hq-light .main { background: #f5f5f7; color: #1a1a1f; }' +
      'body.hq-light .view-header { background: #ffffff; border-color: #e0e0e6; }' +
      'body.hq-light .view-header h1 { color: #1a1a1f; }' +
      'body.hq-light .topbar .breadcrumb b, body.hq-light .topbar .role-name { color: #1a1a1f; }' +
      'body.hq-light .topbar .breadcrumb, body.hq-light .topbar .role-tag, body.hq-light .view-meta { color: #6b6b75; }' +
      'body.hq-light .topbar .search input, body.hq-light .field input, body.hq-light .field textarea, body.hq-light .field select { background: #ffffff; color: #1a1a1f; border-color: #d0d0d6; }' +
      'body.hq-light .field label { color: #6b6b75; }' +
      'body.hq-light .sidebar a.nav-item { color: #4a4a55; }' +
      'body.hq-light .sidebar a.nav-item:hover { background: #f0f0f5; color: #1a1a1f; }' +
      'body.hq-light .sidebar a.nav-item.active { background: rgba(204,0,0,0.08); color: var(--red); }' +
      'body.hq-light .sidebar a.nav-item .count { background: #e0e0e6; color: #1a1a1f; }' +
      'body.hq-light .cal-day, body.hq-light .week-col, body.hq-light .lib-tile, body.hq-light .board-card, body.hq-light .board-col, body.hq-light .modal, body.hq-light .list-table { background: #ffffff !important; color: #1a1a1f; border-color: #e0e0e6; }' +
      'body.hq-light .cal-card, body.hq-light .week-card { background: #f5f5f7; }' +
      'body.hq-light .cal-day.other-month { background: #fafafa; opacity: 0.6; }' +
      'body.hq-light .cal-weekday { background: #f0f0f5; color: #6b6b75; }' +
      'body.hq-light .modal-body, body.hq-light .modal-head, body.hq-light .modal-foot { background: #ffffff; color: #1a1a1f; border-color: #e0e0e6; }' +
      'body.hq-light .hq-tpl-card, body.hq-light .hq-onb-step, body.hq-light .hq-tpl-section, body.hq-light .hq-onb-summary, body.hq-light .hq-onb-links { background: #ffffff; color: #1a1a1f; border-color: #e0e0e6; }' +
      'body.hq-light .toast { background: #ffffff; color: #1a1a1f; border-color: #d0d0d6; }' +
      'body.hq-light .toast b { color: #1a1a1f; }' +
      'body.hq-light .toast .toast-body { color: #6b6b75; }' +
      // --- Pending approvers panel ---
      '.hq-approvers-panel { margin: 12px 0; padding: 12px 14px; background: var(--bg-3); border: 1px solid var(--border); border-radius: 8px; }' +
      '.hq-approvers-panel .hap-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--grey); margin-bottom: 8px; font-weight: 700; }' +
      '.hq-approvers-panel .hap-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border); }' +
      '.hq-approvers-panel .hap-row:last-child { border-bottom: none; }' +
      '.hq-approvers-panel .hap-icon { width: 22px; text-align: center; font-size: 14px; }' +
      '.hq-approvers-panel .hap-name { flex: 1; color: #fff; font-weight: 600; font-size: 13px; }' +
      'body.hq-light .hq-approvers-panel .hap-name { color: #1a1a1f; }' +
      '.hq-approvers-panel .hap-status { font-size: 11px; color: var(--grey); }' +
      '.hq-approvers-panel .hap-ping { background: var(--red); color: #fff; border: none; padding: 5px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; }' +
      '.hq-approvers-panel .hap-ping:hover { filter: brightness(1.1); }' +
      '.hq-approvers-panel .hap-ping:disabled { opacity: 0.4; cursor: default; }';
    document.head.appendChild(css);
  })();

  // =================================================================
  // #J — Sidebar collapse
  // =================================================================
  function getSidebarState() {
    try { return localStorage.getItem('hq-sidebar-collapsed') === '1'; }
    catch (_) { return false; }
  }
  function setSidebarState(collapsed) {
    try { localStorage.setItem('hq-sidebar-collapsed', collapsed ? '1' : '0'); } catch (_) {}
    document.body.classList.toggle('hq-sidebar-collapsed', collapsed);
    var btn = document.getElementById('hq-sidebar-toggle');
    if (btn) {
      btn.textContent = collapsed ? '☰' : '◀';
      btn.title = collapsed ? 'Розгорнути sidebar' : 'Згорнути sidebar';
    }
  }

  // =================================================================
  // #D — Light theme toggle
  // =================================================================
  function getThemeState() {
    try { return localStorage.getItem('hq-theme') || 'dark'; }
    catch (_) { return 'dark'; }
  }
  function setThemeState(theme) {
    try { localStorage.setItem('hq-theme', theme); } catch (_) {}
    document.body.classList.toggle('hq-light', theme === 'light');
    var btn = document.getElementById('hq-theme-toggle');
    if (btn) {
      btn.textContent = theme === 'light' ? '☀️' : '🌙';
      btn.title = theme === 'light' ? 'Перемкнути на темну тему' : 'Перемкнути на світлу тему';
    }
  }

  // =================================================================
  // #K — Sound system (Web Audio API beep)
  // =================================================================
  function getSoundsEnabled() {
    try { return localStorage.getItem('hq-sounds') !== '0'; }
    catch (_) { return true; }
  }
  function setSoundsEnabled(on) {
    try { localStorage.setItem('hq-sounds', on ? '1' : '0'); } catch (_) {}
    var btn = document.getElementById('hq-sound-toggle');
    if (btn) {
      // Динамік замість дзвіночка (щоб не плутати з bell)
      btn.textContent = on ? '🔊' : '🔇';
      btn.title = on ? 'Вимкнути звуки' : 'Увімкнути звуки';
    }
  }

  var audioCtx = null;
  function playDing(freq, dur) {
    if (!getSoundsEnabled()) return;
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        audioCtx = new AC();
      }
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = freq || 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + (dur || 0.2));
      osc.start();
      osc.stop(audioCtx.currentTime + (dur || 0.2));
    } catch (e) { console.warn('playDing failed:', e); }
  }

  window.HQ_playDing = playDing;
  window.HQ_playEvent = function (type) {
    if (type === 'comment') playDing(660, 0.18);
    else if (type === 'review') playDing(880, 0.3);
    else if (type === 'mention') { playDing(990, 0.12); setTimeout(function () { playDing(1320, 0.12); }, 120); }
    else if (type === 'approved') { playDing(1320, 0.12); setTimeout(function () { playDing(1760, 0.18); }, 100); }
    else playDing(880, 0.2);
  };

  // =================================================================
  // Inject topbar buttons
  // =================================================================
  function injectTopbarButtons() {
    var topbar = document.querySelector('.topbar .actions');
    if (!topbar) return false;
    if (topbar.querySelector('#hq-sidebar-toggle')) return true;

    // Sidebar toggle
    var sidebarBtn = document.createElement('button');
    sidebarBtn.className = 'hq-topbar-icon';
    sidebarBtn.id = 'hq-sidebar-toggle';
    sidebarBtn.onclick = function () {
      setSidebarState(!getSidebarState());
    };

    // Theme toggle
    var themeBtn = document.createElement('button');
    themeBtn.className = 'hq-topbar-icon';
    themeBtn.id = 'hq-theme-toggle';
    themeBtn.onclick = function () {
      var cur = getThemeState();
      setThemeState(cur === 'dark' ? 'light' : 'dark');
    };

    // Sound toggle
    var soundBtn = document.createElement('button');
    soundBtn.className = 'hq-topbar-icon';
    soundBtn.id = 'hq-sound-toggle';
    soundBtn.onclick = function () {
      setSoundsEnabled(!getSoundsEnabled());
      // Beep як confirmation
      if (getSoundsEnabled()) setTimeout(function () { playDing(880, 0.15); }, 50);
    };

    // Insert перед bell
    var bell = topbar.querySelector('.bell');
    if (bell) {
      topbar.insertBefore(sidebarBtn, bell);
      topbar.insertBefore(themeBtn, bell);
      topbar.insertBefore(soundBtn, bell);
    } else {
      topbar.appendChild(sidebarBtn);
      topbar.appendChild(themeBtn);
      topbar.appendChild(soundBtn);
    }

    // Restore state
    setSidebarState(getSidebarState());
    setThemeState(getThemeState());
    setSoundsEnabled(getSoundsEnabled());

    return true;
  }

  [400, 1500, 3500].forEach(function (ms) { setTimeout(injectTopbarButtons, ms); });

  // =================================================================
  // #C — Pending approvers panel у відкритій картці
  // =================================================================
  function renderPendingApprovers(pub) {
    if (!pub) return;
    if (!Array.isArray(pub.approvers) || pub.approvers.length === 0) return;
    if (pub.status !== 'review') return;

    var modal = document.getElementById('modal');
    if (!modal) return;

    var existing = modal.querySelector('.hq-approvers-panel');
    if (existing) existing.remove();

    var anchor = modal.querySelector('#f_approvers, [data-section="approvers"]') ||
                 modal.querySelector('.comments-area, #commentsList') ||
                 modal.querySelector('.modal-body');
    if (!anchor) return;

    var approvedBy = Array.isArray(pub.approved_by) ? pub.approved_by : [];

    var rowsHtml = pub.approvers.map(function (uid) {
      var u = Store.user(uid) || { name: '?', initial: '?' };
      var hasApproved = approvedBy.indexOf(uid) >= 0;
      var icon = hasApproved ? '✅' : '⏳';
      var statusText = hasApproved ? 'Погоджено' : 'Чекаємо';
      var pingBtn = hasApproved ? '' :
        '<button class="hap-ping" data-ping-uid="' + escapeHtml(uid) + '">📲 Нагадати</button>';
      return '<div class="hap-row">' +
        '<div class="hap-icon">' + icon + '</div>' +
        '<div class="hap-name">' + escapeHtml(u.name || '?') + '</div>' +
        '<div class="hap-status">' + statusText + '</div>' +
        pingBtn +
      '</div>';
    }).join('');

    var panel = document.createElement('div');
    panel.className = 'hq-approvers-panel';
    panel.innerHTML = '<div class="hap-title">👥 Погоджувачі (' + approvedBy.length + '/' + pub.approvers.length + ')</div>' + rowsHtml;
    anchor.parentNode.insertBefore(panel, anchor);

    panel.querySelectorAll('[data-ping-uid]').forEach(function (btn) {
      btn.onclick = function (e) {
        e.preventDefault();
        pingApprover(pub, btn.dataset.pingUid, btn);
      };
    });
  }

  async function pingApprover(pub, userId, btn) {
    var u = Store.user(userId);
    if (!u) return;
    btn.disabled = true;
    btn.textContent = '⏳…';
    try {
      var uname = String(u.name || '').toLowerCase().replace(/[^a-zа-яёіїєґ0-9_]/gi, '');
      var me = Store.currentUser && Store.currentUser();
      var meName = me?.name || 'SMM';
      var msg = '🔔 ' + meName + ' нагадує @' + uname + ': публікація чекає твого погодження';

      if (typeof Store.addComment === 'function') {
        await Store.addComment(pub.id, msg);
      }
      btn.textContent = '✓ Надіслано';
      setTimeout(function () {
        btn.disabled = false;
        btn.textContent = '📲 Нагадати';
      }, 5000);
      if (typeof toast === 'function') toast('Нагадування', 'success', 'Коментар з @ створено — TG-сповіщення відправиться автоматично');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '📲 Нагадати';
      if (typeof toast === 'function') toast('Помилка', 'error', String(e.message || e));
    }
  }

  function patchOpenCard() {
    if (typeof window.openCard !== 'function' || window.openCard.__approversPanel) return false;
    var _orig = window.openCard;
    window.openCard = function (id) {
      var r = _orig.call(this, id);
      setTimeout(function () {
        if (window.__hqCurrentPub) {
          renderPendingApprovers(window.__hqCurrentPub);
        }
      }, 300);
      return r;
    };
    window.openCard.__approversPanel = true;
    return true;
  }
  patchOpenCard();
  setTimeout(patchOpenCard, 500);
  setTimeout(patchOpenCard, 1500);

  // =================================================================
  // Sound triggers через Supabase realtime
  // =================================================================
  function subscribeSounds() {
    var sb = window.supabase;
    if (!sb || !sb.channel) return;
    if (window.__hqSoundsChan) return;
    var me = Store.currentUser && Store.currentUser();
    if (!me) {
      setTimeout(subscribeSounds, 2000);
      return;
    }
    var chan = sb.channel('hq-sounds-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, function (payload) {
        if (payload.new && payload.new.author_id !== me.id) {
          window.HQ_playEvent('comment');
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'publications' }, function (payload) {
        var oldRec = payload.old || {};
        var newRec = payload.new || {};
        if (oldRec.status !== newRec.status) {
          if (newRec.status === 'review') window.HQ_playEvent('review');
          else if (newRec.status === 'approved') window.HQ_playEvent('approved');
        }
      })
      .subscribe();
    window.__hqSoundsChan = chan;
    console.log('%cDreamCar HQ Sounds %c· realtime subscribed',
      'color:#fbbf24;font-weight:700;', 'color:#888;');
  }
  setTimeout(subscribeSounds, 2500);
  setTimeout(subscribeSounds, 6000);

  console.log('%cDreamCar HQ UI Extras %c· sidebar+theme+sounds+pending-approvers',
    'color:#93c5fd;font-weight:700;', 'color:#888;');
})();
