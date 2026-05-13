/* ============================================================
   DreamCar HQ — SLA timer у дошці погоджень (C3)
   ============================================================ */
// На кожній board-card у режимі review показує:
//   • Pill з віком «у review N годин» (grey < 12h, gold < 24h, red ≥ 24h)
//   • Анімований pulse при перевищенні SLA (24 год)

(function () {
  if (window.__hqSlaLoaded) return;
  window.__hqSlaLoaded = true;

  var SLA_HOURS = 24;
  var WARN_HOURS = 12;

  (function () {
    if (document.getElementById('hq-sla-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-sla-css';
    css.textContent =
      '.hq-sla-pill { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; margin-left: auto; white-space: nowrap; }' +
      '.hq-sla-pill.ok    { background: rgba(255,255,255,0.06); color: var(--grey); border: 1px solid rgba(255,255,255,0.1); }' +
      '.hq-sla-pill.warn  { background: rgba(251,191,36,0.15); color: var(--gold); border: 1px solid rgba(251,191,36,0.4); }' +
      '.hq-sla-pill.over  { background: rgba(216,0,4,0.2); color: var(--red-soft); border: 1px solid var(--red); animation: hq-sla-pulse 1.4s ease-in-out infinite; }' +
      '@keyframes hq-sla-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(216,0,4,0.5); } 50% { box-shadow: 0 0 0 4px rgba(216,0,4,0); } }' +
      '.board-card.hq-sla-over { border-left-color: var(--red) !important; box-shadow: 0 0 16px -4px rgba(216,0,4,0.4); }' +
      '.board-card .bc-head { position: relative; }';
    document.head.appendChild(css);
  })();

  function getPubById(id) {
    try { return window.Store && Store.pub ? Store.pub(id) : null; } catch (_) { return null; }
  }

  function hoursSince(iso) {
    if (!iso) return 0;
    var t = new Date(iso).getTime();
    if (isNaN(t)) return 0;
    return (Date.now() - t) / 3600000;
  }

  function getReviewSince(pub) {
    var hist = pub.history || [];
    for (var i = hist.length - 1; i >= 0; i--) {
      var h = hist[i];
      if (h.action === 'status' && /review/i.test(h.detail || '')) {
        return h.at;
      }
    }
    return pub.updatedAt || pub.updated_at || pub.createdAt;
  }

  function fmtAge(hrs) {
    if (hrs < 1) return Math.round(hrs * 60) + ' хв';
    if (hrs < 48) return Math.round(hrs) + ' год';
    return Math.round(hrs / 24) + ' дн';
  }

  function decorateCard(cardEl) {
    if (cardEl.dataset.slaDecorated) return;
    var pubId = cardEl.dataset.id;
    if (!pubId) return;
    var pub = getPubById(pubId);
    if (!pub || pub.status !== 'review') return;
    cardEl.dataset.slaDecorated = '1';

    var reviewSince = getReviewSince(pub);
    var hrs = hoursSince(reviewSince);
    var cls = hrs >= SLA_HOURS ? 'over' : (hrs >= WARN_HOURS ? 'warn' : 'ok');
    var label = '⏱ ' + fmtAge(hrs);
    if (cls === 'over') label = '🔥 ' + fmtAge(hrs) + ' > SLA';

    var pill = document.createElement('span');
    pill.className = 'hq-sla-pill ' + cls;
    pill.textContent = label;
    pill.title = 'У review з ' + new Date(reviewSince).toLocaleString('uk-UA');

    var bcHead = cardEl.querySelector('.bc-head');
    var bcMeta = cardEl.querySelector('.bc-meta');
    if (bcMeta) {
      bcMeta.appendChild(pill);
    } else if (bcHead) {
      bcHead.appendChild(pill);
    } else {
      cardEl.appendChild(pill);
    }

    if (cls === 'over') cardEl.classList.add('hq-sla-over');
  }

  function decorateAll() {
    document.querySelectorAll('.board-card[data-id]').forEach(decorateCard);
  }

  function refreshAges() {
    document.querySelectorAll('.board-card[data-id]').forEach(function (card) {
      if (!card.dataset.slaDecorated) return;
      var oldPill = card.querySelector('.hq-sla-pill');
      if (oldPill) oldPill.remove();
      card.removeAttribute('data-sla-decorated');
      card.classList.remove('hq-sla-over');
      decorateCard(card);
    });
  }

  var obs = new MutationObserver(function (muts) {
    var should = false;
    muts.forEach(function (m) {
      m.addedNodes && m.addedNodes.forEach(function (n) {
        if (n.nodeType === 1 && ((n.classList && n.classList.contains('board-card')) || (n.querySelector && n.querySelector('.board-card')))) {
          should = true;
        }
      });
    });
    if (should) decorateAll();
  });
  obs.observe(document.body, { childList: true, subtree: true });

  [400, 1500, 3500].forEach(function (ms) { setTimeout(decorateAll, ms); });
  setInterval(refreshAges, 60000);

  console.log('%cDreamCar HQ SLA %c· review timer ready', 'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
