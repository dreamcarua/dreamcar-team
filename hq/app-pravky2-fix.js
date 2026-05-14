/* ============================================================
   DreamCar HQ — Pravky-2 ALL-IN-ONE (SW bypass bootstrap)
   ============================================================ */

(function () {
  if (window.__hqPravky2) return;
  window.__hqPravky2 = true;

  (function () {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      window.__hqAudioCtxPersist = new AC();
      console.log('%cDreamCar HQ Audio %c· eager init, state=' + window.__hqAudioCtxPersist.state,
        'color:#fbbf24;font-weight:700;', 'color:#888;');
    } catch (e) { console.warn('audio init:', e); }
  })();

  function getSoundsEnabled() {
    try { return localStorage.getItem('hq-sounds') !== '0'; } catch (_) { return true; }
  }

  function playTone(freq, dur) {
    if (!getSoundsEnabled()) return;
    var ctx = window.__hqAudioCtxPersist;
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
    try {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq || 880; osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (dur || 0.2));
      osc.start(); osc.stop(ctx.currentTime + (dur || 0.2));
    } catch (e) { console.warn('playTone:', e); }
  }

  window.HQ_playDing = playTone;
  window.HQ_playEvent = function (type) {
    if (type === 'comment') playTone(660, 0.18);
    else if (type === 'review') playTone(880, 0.3);
    else if (type === 'send') { playTone(440, 0.06); setTimeout(function () { playTone(880, 0.08); }, 60); }
    else if (type === 'mention') { playTone(990, 0.12); setTimeout(function () { playTone(1320, 0.12); }, 120); }
    else if (type === 'approved') { playTone(1320, 0.12); setTimeout(function () { playTone(1760, 0.18); }, 100); }
    else playTone(880, 0.2);
  };
  window.HQ_playSend = function () { window.HQ_playEvent('send'); };

  function resumeAudio() {
    var ctx = window.__hqAudioCtxPersist;
    if (!ctx) return;
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) {} }
  }
  document.addEventListener('click', resumeAudio, true);
  document.addEventListener('keydown', resumeAudio, true);
  document.addEventListener('touchstart', resumeAudio, true);
  document.addEventListener('pointerdown', resumeAudio, true);

  function subscribeSoundsRealtime() {
    var sb = window.supabase;
    if (!sb || !sb.channel) return;
    if (window.__hqSoundsRtChan) return;
    var me = Store.currentUser && Store.currentUser();
    if (!me) { setTimeout(subscribeSoundsRealtime, 2000); return; }
    var chan = sb.channel('hq-sounds-allinone')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, function (payload) {
        var newC = payload.new;
        if (!newC) return;
        if (newC.author_id !== me.id) window.HQ_playEvent('comment');
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'publications' }, function (payload) {
        if (payload.old?.status !== payload.new?.status) {
          if (payload.new?.status === 'review') window.HQ_playEvent('review');
          else if (payload.new?.status === 'approved') window.HQ_playEvent('approved');
        }
      })
      .subscribe();
    window.__hqSoundsRtChan = chan;
    console.log('%cDreamCar HQ Sounds RT %c· subscribed (all-in-one)',
      'color:#fbbf24;font-weight:700;', 'color:#888;');
  }
  setTimeout(subscribeSoundsRealtime, 2500);
  setTimeout(subscribeSoundsRealtime, 6000);

  function patchAddComment() {
    if (!window.Store || typeof Store.addComment !== 'function') return false;
    if (Store.addComment.__sendSound) return true;
    var _orig = Store.addComment.bind(Store);
    Store.addComment = function (pubId, body) {
      var p = _orig(pubId, body);
      try { window.HQ_playEvent('send'); } catch (_) {}
      return p;
    };
    Store.addComment.__sendSound = true;
    return true;
  }
  if (!patchAddComment()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (patchAddComment() || tries++ > 20) clearInterval(iv);
    }, 250);
  }

  function rollbackPerPlatform() {
    if (!window.Store) return false;
    if (Store.pubs.__perPlatExpanded) {
      Store.pubs = function () {
        return (this._data && this._data.publications) ? this._data.publications.filter(function (p) { return !p._trashed; }) : [];
      };
      console.log('%cDreamCar HQ %c· rolled back per-platform expansion',
        'color:#ff6577;font-weight:700;', 'color:#888;');
      if (typeof window.navigate === 'function') { try { window.navigate(); } catch (_) {} }
    }
    return true;
  }
  setTimeout(rollbackPerPlatform, 1500);
  setTimeout(rollbackPerPlatform, 4000);

  function patchActiveUsers() {
    if (!window.Store || typeof Store.activeUsers !== 'function') return false;
    if (Store.activeUsers.__patched99) return true;
    Store.activeUsers = function () {
      var all = (this._data && this._data.users) || [];
      return all.filter(function (u) { return u && u.is_active !== false; });
    };
    Store.activeUsers.__patched99 = true;
    return true;
  }
  if (!patchActiveUsers()) {
    var t1 = 0;
    var iv1 = setInterval(function () {
      if (patchActiveUsers() || t1++ > 20) clearInterval(iv1);
    }, 250);
  }

  function rerenderApprovers() {
    var chipRow = document.getElementById('f_appr');
    if (!chipRow) return false;
    var pub = window.__hqCurrentPub;
    if (!pub) {
      var hash = (location.hash || '').slice(1);
      if (hash.indexOf('publication/') === 0) {
        var pubId = hash.split('/')[1];
        pub = (window.Store && Store.pub && Store.pub(pubId));
        if (pub) window.__hqCurrentPub = pub;
      }
    }
    if (!pub) return false;
    var currentApprovers = Array.isArray(pub.approvers) ? pub.approvers : [];
    var users = (window.Store && Store.users && Store.users()) || [];
    users = users.filter(function (u) { return u && u.is_active !== false; });
    if (users.length === 0) return false;
    var existing = chipRow.querySelectorAll('.chip');
    var existingIds = Array.from(existing).map(function (c) { return c.dataset.user; }).filter(Boolean);
    var allPresent = users.every(function (u) { return existingIds.indexOf(u.id) >= 0; });
    if (allPresent && existing.length === users.length) return true;
    chipRow.innerHTML = users.map(function (u) {
      var on = currentApprovers.indexOf(u.id) >= 0;
      return '<div class="chip ' + (on ? 'on' : '') + '" data-user="' + u.id + '">' +
        (u.initial || (u.name || '?')[0]) + ' · ' + (u.name || '?') + '</div>';
    }).join('');
    chipRow.querySelectorAll('.chip').forEach(function (chip) {
      chip.onclick = function () {
        var uid = chip.dataset.user;
        if (!Array.isArray(pub.approvers)) pub.approvers = [];
        var ix = pub.approvers.indexOf(uid);
        if (ix >= 0) pub.approvers.splice(ix, 1);
        else pub.approvers.push(uid);
        chip.classList.toggle('on');
        if (typeof window.autosave === 'function') { try { window.autosave(pub); } catch (_) {} }
      };
    });
    return true;
  }

  if ('MutationObserver' in window) {
    var bodyMo = new MutationObserver(function () {
      if (document.getElementById('f_appr')) {
        clearTimeout(window.__hqApprTimer);
        window.__hqApprTimer = setTimeout(rerenderApprovers, 100);
      }
    });
    bodyMo.observe(document.body, { childList: true, subtree: true });
  }
  setInterval(function () {
    if (document.getElementById('f_appr')) rerenderApprovers();
  }, 1500);

  async function rescueAndRender() {
    try {
      var sb = window.supabase;
      if (!sb || !Store || !Store._data || !Store._data.creatives) return;
      var missing = Store._data.creatives.filter(function (c) { return !c.url && !c.thumbnail_url; });
      var needForceRender = missing.length > 0 || Store._data.creatives.some(function (c) { return !c.thumbnail_url; });
      if (!needForceRender) return;
      var resp = await sb.from('creatives').select('id, thumbnail_url, drive_file_id').is('deleted_at', null);
      if (resp.error) return;
      var byId = {};
      (resp.data || []).forEach(function (c) { byId[c.id] = c; });
      var updated = 0;
      Store._data.creatives.forEach(function (c) {
        var e = byId[c.id];
        if (!e) return;
        if (!c.thumbnail_url && e.thumbnail_url) { c.thumbnail_url = e.thumbnail_url; updated++; }
        if (!c.url && e.thumbnail_url) { c.url = e.thumbnail_url; updated++; }
        if (!c.drive_file_id && e.drive_file_id) c.drive_file_id = e.drive_file_id;
      });
      if (updated > 0) {
        console.log('%cDreamCar HQ Rescue %c· ' + updated + ' creatives + force navigate',
          'color:#7ab0ff;font-weight:700;', 'color:#888;');
        if (typeof window.navigate === 'function') { try { window.navigate(); } catch (_) {} }
      }
    } catch (e) { console.warn('rescue:', e); }
  }
  setTimeout(rescueAndRender, 1500);
  setTimeout(rescueAndRender, 4000);
  setTimeout(rescueAndRender, 8000);
  window.addEventListener('hashchange', function () {
    [400, 1500].forEach(function (ms) { setTimeout(rescueAndRender, ms); });
  });

  var nextPatches = [
    'app-library-delete.js',
    'app-pravky2b-fix.js',
    'app-pravky2c-fix.js',
    'app-pravky2d-fix.js',
    'app-pravky2e-fix.js',
    'app-pravky2f-fix.js',
    'app-send-sound.js',
    'app-theme-polish.js',
    'app-dragdrop-fix.js',
    'app-char-counter.js',
    'app-calendar-dots.js',
    'app-preview-tabs.js',
    'app-duplicate-to.js',
    'app-library-bulk.js',
  ];
  nextPatches.forEach(function (name) {
    if (document.querySelector('script[src*="' + name + '"]')) return;
    var s = document.createElement('script');
    s.src = name + '?v=' + Date.now();
    s.defer = true;
    document.head.appendChild(s);
  });

  console.log('%cDreamCar HQ Pravky-2 ALL-IN-ONE %c· loaded + bootstrapping additional patches',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
