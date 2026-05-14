/* ============================================================
   DreamCar HQ — Pravky-2 fixes
   ============================================================ */
// #98 Media persist після reload (додатковий rescue)
// #99 Артем у approvers — activeUsers без auth_id фільтра
// #100 @mention autocomplete — Вадим у списку + flip-up
// #101 Sound unlock — audioCtx.resume() при першому user gesture
// #102 Comments real-time — INSERT у відкриту картку

(function () {
  if (window.__hqPravky2) return;
  window.__hqPravky2 = true;

  // =================================================================
  // #99 — activeUsers() повертає ВСІХ active незалежно від auth_id
  // =================================================================
  function patchActiveUsers() {
    if (!window.Store || typeof Store.activeUsers !== 'function') return false;
    if (Store.activeUsers.__patched99) return true;
    Store.activeUsers = function () {
      var all = (this._data && this._data.users) || [];
      // is_active !== false → all real users (включно з тими хто ще не залогінився)
      return all.filter(function (u) {
        return u && u.is_active !== false;
      });
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

  // =================================================================
  // #98 — Media rescue: hydrate creatives ВСІМИ полями якщо нема url
  // =================================================================
  async function rescueCreatives() {
    try {
      var sb = window.supabase;
      if (!sb || !window.Store || !Store._data || !Array.isArray(Store._data.creatives)) return;
      // Якщо вже всі мають url — skip
      var allHaveUrl = Store._data.creatives.every(function (c) { return c.url || c.thumbnail_url; });
      if (allHaveUrl) return;
      var resp = await sb.from('creatives')
        .select('id, thumbnail_url, drive_file_id, width_px, height_px')
        .is('deleted_at', null);
      if (resp.error) return;
      var byId = {};
      (resp.data || []).forEach(function (c) { byId[c.id] = c; });
      var updated = 0;
      Store._data.creatives.forEach(function (c) {
        var e = byId[c.id];
        if (!e) return;
        if (!c.thumbnail_url) c.thumbnail_url = e.thumbnail_url || null;
        if (!c.drive_file_id) c.drive_file_id = e.drive_file_id || null;
        if (!c.url && e.thumbnail_url) { c.url = e.thumbnail_url; updated++; }
      });
      if (updated > 0) {
        console.log('%cDreamCar HQ Media Rescue %c· hydrated ' + updated + ' creatives',
          'color:#7ab0ff;font-weight:700;', 'color:#888;');
        // Force re-render якщо відкрита модалка
        if (typeof window.refreshPreview === 'function' && window.__hqCurrentPub) {
          try { window.refreshPreview(window.__hqCurrentPub); } catch (_) {}
        }
      }
    } catch (e) { console.warn('rescueCreatives:', e); }
  }
  setTimeout(rescueCreatives, 1500);
  setTimeout(rescueCreatives, 4000);
  setTimeout(rescueCreatives, 8000);
  // Trigger rescue при відкритті картки
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && (e.target.closest('.cal-card, .week-card, .board-card, .list-table tr'))) {
      setTimeout(rescueCreatives, 400);
    }
  }, true);

  // =================================================================
  // #100 — @mention autocomplete: всіх юзерів + flip-up
  // =================================================================
  function patchMentionPopup() {
    // Override showPopup всередині app-mentions.js — це не експортовано,
    // тому ми просто додамо MutationObserver на popup поява і виправимо position.
    if (window.__hqMentionFlip) return;
    window.__hqMentionFlip = true;
    if (!('MutationObserver' in window)) return;
    var mo = new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (!(node instanceof Element)) return;
          if (!node.classList.contains('hq-mention-popup')) return;
          // Flip-up якщо знизу мало місця
          setTimeout(function () {
            var rect = node.getBoundingClientRect();
            var viewportH = window.innerHeight;
            if (rect.bottom > viewportH - 20) {
              // Flip up
              var inp = document.activeElement;
              if (inp && inp.tagName && (inp.tagName === 'INPUT' || inp.tagName === 'TEXTAREA')) {
                var inpRect = inp.getBoundingClientRect();
                node.style.top = (inpRect.top - node.offsetHeight - 4) + 'px';
              }
            }
            // Зробити більш видимим
            node.style.minWidth = '240px';
            node.style.maxHeight = '300px';
          }, 50);
        });
      });
    });
    mo.observe(document.body, { childList: true });
  }
  patchMentionPopup();

  // =================================================================
  // #101 — Sound unlock через user gesture
  // =================================================================
  function unlockAudio() {
    try {
      if (typeof window.HQ_playDing !== 'function') return;
      // Викликаємо тестовий ding на нульовій гучності щоб unlock context
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!window.__hqAudioCtxPersist) {
        window.__hqAudioCtxPersist = new AC();
      }
      var ctx = window.__hqAudioCtxPersist;
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().then(function () {
          console.log('%cDreamCar HQ Audio %c· unlocked', 'color:#fbbf24;font-weight:700;', 'color:#888;');
        }).catch(function (e) { console.warn('audio resume err:', e); });
      }
    } catch (e) { console.warn('unlockAudio:', e); }
  }
  // Single-shot unlock на першому click або keydown
  function onFirstGesture() {
    unlockAudio();
    document.removeEventListener('click', onFirstGesture, true);
    document.removeEventListener('keydown', onFirstGesture, true);
    document.removeEventListener('touchstart', onFirstGesture, true);
  }
  document.addEventListener('click', onFirstGesture, true);
  document.addEventListener('keydown', onFirstGesture, true);
  document.addEventListener('touchstart', onFirstGesture, true);

  // Override HQ_playDing щоб використовувати persisted ctx
  setTimeout(function () {
    if (typeof window.HQ_playDing !== 'function') return;
    if (window.HQ_playDing.__persistPatched) return;
    var _orig = window.HQ_playDing;
    window.HQ_playDing = function (freq, dur) {
      try {
        var ctx = window.__hqAudioCtxPersist;
        if (!ctx) { return _orig(freq, dur); }
        if (ctx.state === 'suspended') {
          try { ctx.resume(); } catch (_) {}
        }
        // Inline play (не звертатись до original який має свій ctx)
        var soundsOn = (function () { try { return localStorage.getItem('hq-sounds') !== '0'; } catch (_) { return true; } })();
        if (!soundsOn) return;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq || 880;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (dur || 0.2));
        osc.start();
        osc.stop(ctx.currentTime + (dur || 0.2));
      } catch (e) { console.warn('playDing patched:', e); }
    };
    window.HQ_playDing.__persistPatched = true;
  }, 1500);

  // =================================================================
  // #102 — Comments real-time у відкритій картці
  // =================================================================
  function subscribeCommentsRealtime() {
    var sb = window.supabase;
    if (!sb || !sb.channel) return;
    if (window.__hqCommentsRtChan) return;
    var chan = sb.channel('hq-comments-card-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, function (payload) {
        var newComment = payload.new;
        if (!newComment) return;
        // Якщо це коментар до поточної відкритої картки — додати
        if (window.__hqCurrentPub && window.__hqCurrentPub.id === newComment.publication_id) {
          // Append до Store
          try {
            var pub = window.__hqCurrentPub;
            if (!Array.isArray(pub.comments)) pub.comments = [];
            // Перевірити що нема дубля
            var exists = pub.comments.some(function (c) { return c.id === newComment.id; });
            if (exists) return;
            pub.comments.push({
              id: newComment.id,
              at: newComment.created_at,
              author: newComment.author_id,
              body: newComment.body,
            });
            // Render у DOM
            renderNewCommentInDOM(newComment);
          } catch (e) { console.warn('comment rt:', e); }
        }
      })
      .subscribe();
    window.__hqCommentsRtChan = chan;
    console.log('%cDreamCar HQ Comments RT %c· subscribed',
      'color:#7ab0ff;font-weight:700;', 'color:#888;');
  }

  function renderNewCommentInDOM(c) {
    var modal = document.getElementById('modal');
    if (!modal) return;
    // Шукаємо можливі контейнери коментарів
    var area = modal.querySelector('#commentsList, .comments-list, .comments-area, [data-section="comments"]');
    if (!area) {
      // Fallback — шукаємо за наявністю інших коментарів
      var anyComment = modal.querySelector('.comment');
      if (anyComment && anyComment.parentNode) area = anyComment.parentNode;
    }
    if (!area) return;
    // Не додавати якщо вже є
    if (area.querySelector('[data-comment-id="' + c.id + '"]')) return;

    var user = (window.Store && Store.user && Store.user(c.author_id)) || {};
    var time = new Date(c.created_at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    var div = document.createElement('div');
    div.className = 'comment';
    div.dataset.commentId = c.id;
    div.innerHTML =
      '<div class="c-head">' +
        '<span class="c-author">' + escapeHtml(user.name || '?') + '</span> ' +
        '<span class="c-time">' + time + '</span>' +
      '</div>' +
      '<div class="c-body">' + escapeHtml(c.body || '') + '</div>';
    area.appendChild(div);

    // Sound + scroll
    if (typeof window.HQ_playEvent === 'function') {
      try { window.HQ_playEvent('comment'); } catch (_) {}
    }
    if (typeof toast === 'function') {
      toast('Новий коментар', 'info', (user.name || '?') + ': ' + (c.body || '').slice(0, 60));
    }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  setTimeout(subscribeCommentsRealtime, 2000);
  setTimeout(subscribeCommentsRealtime, 5000);

  console.log('%cDreamCar HQ Pravky-2 %c· all 5 fixes active',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
