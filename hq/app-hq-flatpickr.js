/* ============================================================
   DreamCar HQ — flatpickr для datetime/date inputs
   ============================================================
   Давид feedback: клік на нативний <input type="datetime-local">
   відкриває picker на будь-який клік. Користувачі хочуть щоб
   picker з'являвся ТІЛЬКИ при кліку на іконку 📅.

   Заміняємо нативні inputs на flatpickr (як у Tasks).
   ============================================================ */
(function () {
  if (window.__hqFlatpickrLoaded) return;
  window.__hqFlatpickrLoaded = true;

  var FP_CSS = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.css';
  var FP_DARK = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/themes/dark.css';
  var FP_JS = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/flatpickr.min.js';
  var FP_UK = 'https://cdn.jsdelivr.net/npm/flatpickr@4.6.13/dist/l10n/uk.js';

  function ensureFp(cb) {
    if (window.flatpickr) return cb();
    if (!document.getElementById('hq-flatpickr-css')) {
      var l1 = document.createElement('link'); l1.id = 'hq-flatpickr-css'; l1.rel = 'stylesheet'; l1.href = FP_CSS; document.head.appendChild(l1);
      var l2 = document.createElement('link'); l2.rel = 'stylesheet'; l2.href = FP_DARK; document.head.appendChild(l2);
    }
    var s = document.createElement('script'); s.src = FP_JS;
    s.onload = function () {
      var u = document.createElement('script'); u.src = FP_UK; u.onload = cb; document.head.appendChild(u);
    };
    document.head.appendChild(s);
  }

  function bindOne(inp, isDateTime) {
    if (!inp || inp.__fpBound) return;
    inp.__fpBound = true;
    try {
      inp.type = 'text';
      if (isDateTime) {
        inp.placeholder = 'дд.мм.рррр гг:хх';
        inp._fp = window.flatpickr(inp, {
          enableTime: true, time_24hr: true, minuteIncrement: 5,
          dateFormat: 'Y-m-d\\TH:i:00', altInput: true, altFormat: 'd.m.Y H:i',
          locale: window.flatpickr.l10ns && window.flatpickr.l10ns.uk,
          allowInput: true, disableMobile: false
        });
      } else {
        inp.placeholder = 'дд.мм.рррр';
        inp._fp = window.flatpickr(inp, {
          dateFormat: 'Y-m-d', altInput: true, altFormat: 'd.m.Y',
          locale: window.flatpickr.l10ns && window.flatpickr.l10ns.uk,
          allowInput: true, disableMobile: false
        });
      }
    } catch (e) { console.warn('[hq-flatpickr]', inp.id, e); }
  }

  function bindAll() {
    ensureFp(function () {
      // f_dateTime у pub modal — datetime-local
      bindOne(document.getElementById('f_dateTime'), true);
      // f_deadline у pub modal — date
      bindOne(document.getElementById('f_deadline'), false);
      // platform-schedule datetime-local inputs (data-ps-input)
      document.querySelectorAll('input[data-ps-input], .hq-prev-time').forEach(function (i) {
        if (i.type === 'datetime-local' || i.getAttribute('type') === 'datetime-local') bindOne(i, true);
      });
      // Launch CRUD lnf_from/lnf_to — date
      bindOne(document.getElementById('lnf_from'), false);
      bindOne(document.getElementById('lnf_to'), false);
      // Vacation hv_from/hv_to — date
      bindOne(document.getElementById('hv_from'), false);
      bindOne(document.getElementById('hv_to'), false);
    });
  }

  function init() {
    bindAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Re-bind після відкриття модалок (динамічний DOM)
  var mo = new MutationObserver(function () { bindAll(); });
  setTimeout(function () { mo.observe(document.body, { childList: true, subtree: true }); }, 1500);
})();
