/* ============================================================
   DreamCar HQ — Send sound для власних коментарів
   ============================================================ */
// Коли я (юзер) натискаю «Надіслати» — програється короткий "swoosh"
// звук одразу, не чекаючи realtime echo. Інші юзери чують 'comment' beep.

(function () {
  if (window.__hqSendSound) return;
  window.__hqSendSound = true;

  // Add 'send' event у HQ_playEvent — це okремий swoosh
  function playSend() {
    if (typeof window.HQ_playDing !== 'function') return;
    // Двотоновий swoosh: 440Hz → 880Hz за 120мс
    window.HQ_playDing(440, 0.06);
    setTimeout(function () { window.HQ_playDing(880, 0.08); }, 60);
  }
  window.HQ_playSend = playSend;

  // Розширюємо HQ_playEvent
  setTimeout(function () {
    if (typeof window.HQ_playEvent !== 'function') return;
    if (window.HQ_playEvent.__sendExtended) return;
    var _orig = window.HQ_playEvent;
    window.HQ_playEvent = function (type) {
      if (type === 'send') { playSend(); return; }
      return _orig(type);
    };
    window.HQ_playEvent.__sendExtended = true;
  }, 1500);

  // Перехоплюємо Store.addComment
  function patchAddComment() {
    if (!window.Store || typeof Store.addComment !== 'function') return false;
    if (Store.addComment.__sendSound) return true;
    var _orig = Store.addComment.bind(Store);
    Store.addComment = function (pubId, body) {
      var p = _orig(pubId, body);
      // Play send sound — навіть якщо promise повернеться з помилкою, beep ОК
      try { playSend(); } catch (_) {}
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

  // Backup: click на кнопку Надіслати у comment-input
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    var btn = e.target.closest('.comment-input button, [data-action="send-comment"]');
    if (!btn) return;
    // Чи це справді send button (не cancel etc)
    var txt = (btn.textContent || '').toLowerCase();
    if (txt.indexOf('надісл') >= 0 || txt.indexOf('send') >= 0 || txt.indexOf('відправ') >= 0) {
      setTimeout(playSend, 50);
    }
  }, true);

  if (window.DEBUG) console.log('%cDreamCar HQ Send sound %c· active for own comments',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
