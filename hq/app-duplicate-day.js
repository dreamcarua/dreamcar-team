/* ============================================================
   DreamCar HQ — Duplicate Day (29.09.2026, запит Олександра)
   ============================================================
   Кнопка «⧉ Дублювати день» у шапці Календаря. Копіює ВСІ події
   обраного дня як ШАБЛОН на інший день:
     • каркас БЕЗ медіа (creatives не копіюються),
     • статус = чернетка (draft) → без TG-нотифікацій/автопосту (тригери
       спрацьовують лише на review/approved/rework/published),
     • час доби зберігається, дата зсувається на цільовий день,
     • якщо в цільовому дні вже є події — ДОДАЄМО (не чистимо).
   Робиться повністю на клієнті через Store.upsertPub (як app-duplicate-to.js) —
   RPC не потрібен. HQ rule: критична кнопка = inline onclick + global window fn.
   ============================================================ */
(function () {
  if (window.__hqDuplicateDay) return;
  window.__hqDuplicateDay = true;

  function S() { return (typeof Store !== 'undefined' ? Store : window.Store); }
  function A() { return (typeof App !== 'undefined' ? App : window.App); }

  // локальний YMD за ЛОКАЛЬНИМ часом (як cal-day data-date у app-core ymdLocal)
  function ymd(dt) {
    var d = (dt instanceof Date) ? dt : new Date(dt);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function fmt(ymdStr) {
    var p = String(ymdStr).split('-');
    return p.length === 3 ? (p[2] + '.' + p[1] + '.' + p[0]) : ymdStr;
  }
  // зберегти час доби джерела, замінити дату на цільову
  function shiftToDay(iso, ymdStr) {
    var s = new Date(iso);
    var p = String(ymdStr).split('-');
    var d = new Date(s.getTime());
    d.setFullYear(+p[0], (+p[1]) - 1, +p[2]);
    return d.toISOString();
  }
  function dayPubs(fromStr) {
    var st = S(); if (!st) return [];
    return (st.pubs() || []).filter(function (p) {
      return p && !p._trashed && p.dateTime && ymd(p.dateTime) === fromStr;
    }).sort(function (a, b) { return new Date(a.dateTime) - new Date(b.dateTime); });
  }

  // ---- Модалка ----
  window.__hqDupDayOpen = function () {
    if (typeof Modal === 'undefined' || !Modal.open) return;
    var a = A();
    var fromDefault = ymd(a && a.calendarDate ? a.calendarDate : new Date());
    var toD = new Date((a && a.calendarDate ? a.calendarDate : new Date()).valueOf());
    toD.setDate(toD.getDate() + 1);
    var toDefault = ymd(toD);
    var inp = 'style="width:100%;padding:9px 10px;margin-top:6px;background:var(--bg-3,#1b1b1b);color:#fff;border:1px solid var(--border,#333);border-radius:8px;font-size:14px;"';
    Modal.open(
      '<div class="modal-head"><h2>⧉ Дублювати день</h2>' +
      '<span class="modal-meta">Копіює всі події дня як чернетки-шаблон (каркас без медіа)</span>' +
      '<button class="close" onclick="Modal.close()">×</button></div>' +
      '<div class="modal-body" style="padding:16px;display:flex;flex-direction:column;gap:14px;">' +
        '<label style="font-size:12px;color:var(--grey,#aaa);">Звідки (день з подіями)' +
          '<input type="date" id="dupFrom" value="' + fromDefault + '" ' + inp + '></label>' +
        '<div id="dupCount" style="font-size:12px;color:var(--grey,#aaa);"></div>' +
        '<label style="font-size:12px;color:var(--grey,#aaa);">Куди (цільовий день)' +
          '<input type="date" id="dupTo" value="' + toDefault + '" ' + inp + '></label>' +
        '<div style="font-size:11.5px;color:var(--grey,#888);line-height:1.5;">Скопіюються: заголовок, текст, платформи, відповідальні, погоджувачі, рубрика, запуск, час доби, TG-налаштування — як <b>чернетки</b>. Медіа НЕ копіюється (додаси потрібне вручну). Якщо в цільовому дні вже є події — нові <b>додаються</b> до них.</div>' +
      '</div>' +
      '<div class="modal-foot">' +
        '<button class="btn btn-primary" id="dupRunBtn" onclick="window.__hqDupDayRun()">Дублювати</button>' +
        '<button class="btn" onclick="Modal.close()">Скасувати</button>' +
      '</div>',
      'modal-sm'
    );
    var upd = function () {
      var f = document.getElementById('dupFrom');
      var box = document.getElementById('dupCount');
      if (!f || !box) return;
      var n = dayPubs(f.value).length;
      box.innerHTML = n
        ? ('Знайдено подій у цьому дні: <b style="color:#fff;">' + n + '</b>')
        : '<span style="color:#e0a030;">У цьому дні немає подій</span>';
    };
    var f = document.getElementById('dupFrom');
    if (f) f.addEventListener('change', upd);
    upd();
  };

  // ---- Виконання ----
  window.__hqDupDayRun = function () {
    if (window.__hqDupDayBusy) return;
    var st = S();
    if (!st || typeof newPubObject !== 'function') {
      if (typeof toast === 'function') toast('Помилка', 'error', 'Store не готовий — онови сторінку (F5)');
      return;
    }
    var fEl = document.getElementById('dupFrom');
    var tEl = document.getElementById('dupTo');
    var fromStr = fEl && fEl.value;
    var toStr = tEl && tEl.value;
    if (!fromStr || !toStr) { if (typeof toast === 'function') toast('Обери дати', 'warn'); return; }
    var src = dayPubs(fromStr);
    if (!src.length) { if (typeof toast === 'function') toast('Немає подій', 'warn', 'У обраному дні немає публікацій'); return; }

    var btn = document.getElementById('dupRunBtn');
    window.__hqDupDayBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Дублюю…'; }

    (async function () {
      var made = 0;
      for (var i = 0; i < src.length; i++) {
        var s = src[i];
        try {
          var base = newPubObject(new Date(toStr + 'T12:00:00'));
          base.title = s.title || '';
          base.contentType = s.contentType;
          base.text = s.text || '';
          base.hashtags = (s.hashtags || []).slice();
          base.rubric = s.rubric;
          base.launch = s.launch;
          base.platforms = (s.platforms || []).slice();
          base.responsibles = (s.responsibles || []).slice();
          base.approvers = (s.approvers || []).slice();
          base.approverPolicy = s.approverPolicy || 'all';
          base.creatives = [];                 // каркас без медіа
          base.slotReserved = false;
          base.workStatus = '';
          base.status = 'draft';
          base.dateTime = shiftToDay(s.dateTime, toStr);
          // TG-каркас (без countdown — він прив'язаний до конкретного часу/офера)
          base.tg_buttons = Array.isArray(s.tg_buttons) ? JSON.parse(JSON.stringify(s.tg_buttons)) : [];
          base.tg_pin = !!s.tg_pin;
          base.tg_silent = !!s.tg_silent;
          base.tg_disable_preview = !!s.tg_disable_preview;
          base.tg_channel_id = s.tg_channel_id || null;
          base.tg_countdown_until = null;
          delete base._isNew; delete base._autoDeadline; delete base._autoLaunch;
          await st.upsertPub(base);
          made++;
        } catch (e) { console.error('[dup-day] upsert failed', e); }
      }
      window.__hqDupDayBusy = false;
      if (typeof Modal !== 'undefined' && Modal.close) { try { Modal.close(); } catch (_) {} }
      if (typeof toast === 'function') {
        if (made === src.length) toast('Продубльовано', 'success', made + ' подій → ' + fmt(toStr) + ' (чернетки)');
        else toast('Частково', 'warn', made + ' з ' + src.length + ' → ' + fmt(toStr));
      }
      try {
        var a = A();
        if (a) a.calendarDate = new Date(toStr + 'T12:00:00');
        if (typeof renderCalendar === 'function') renderCalendar(document.getElementById('main'));
        else if (typeof navigate === 'function') navigate();
      } catch (_) {}
    })();
  };

  // ---- Кнопка у шапці Календаря (поряд з «+ Нова публікація») ----
  function injectBtn() {
    var add = document.getElementById('addPubBtn');
    if (!add) return;                       // тільки на view Календаря
    if (document.getElementById('dupDayBtn')) return;
    var b = document.createElement('button');
    b.id = 'dupDayBtn';
    b.className = 'btn';
    b.type = 'button';
    b.textContent = '⧉ Дублювати день';
    b.setAttribute('onclick', 'window.__hqDupDayOpen()');
    b.style.marginLeft = '6px';
    add.parentNode.insertBefore(b, add.nextSibling);
  }
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.getElementById('addPubBtn')) injectBtn();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }
  setTimeout(injectBtn, 800);
  setTimeout(injectBtn, 2500);

  if (window.DEBUG) console.log('%cDreamCar HQ Duplicate Day %c· ready', 'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
