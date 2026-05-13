/* ============================================================
   DreamCar HQ — Extras
   • Дублювання публікації
   • Експорт у .ics (календар)
   • Keyboard shortcuts help (?)
   Завантажується через app-locks.js (loader chain).
   ============================================================ */

(function () {
  if (window.__hqExtrasLoaded) return;
  window.__hqExtrasLoaded = true;

  // ---- CSS ----
  (function () {
    if (document.getElementById('hq-extras-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-extras-css';
    css.textContent =
      '.kbd-help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 300; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.2s ease; }' +
      '.kbd-help-card { background: var(--bg-2); border: 1px solid var(--border); border-radius: 14px; padding: 28px 32px; max-width: 520px; width: 100%; box-shadow: var(--shadow); }' +
      '.kbd-help-card h2 { font-size: 18px; color: #fff; margin-bottom: 16px; font-weight: 800; }' +
      '.kbd-help-card .kbd-row { display: flex; align-items: center; gap: 14px; padding: 7px 0; border-bottom: 1px solid var(--border); }' +
      '.kbd-help-card .kbd-row:last-child { border-bottom: none; }' +
      '.kbd-help-card .kbd-key { background: var(--bg-3); border: 1px solid var(--border); border-bottom: 2px solid var(--border-2); border-radius: 5px; padding: 3px 9px; font-family: ui-monospace, "Courier New", monospace; font-size: 11px; color: var(--gold); font-weight: 700; min-width: 22px; text-align: center; }' +
      '.kbd-help-card .kbd-desc { color: #ddd; font-size: 13px; }' +
      '.kbd-help-card .kbd-foot { margin-top: 16px; font-size: 11px; color: var(--grey); text-align: center; }';
    document.head.appendChild(css);
  })();

  // ============================================================
  // DUPLICATE PUBLICATION
  // ============================================================
  function duplicatePub(srcId) {
    if (!window.Store) return;
    var src = Store.pub(srcId);
    if (!src) return;
    var clone = JSON.parse(JSON.stringify(src));
    clone.id = (window.uuidV4 && window.uuidV4()) ||
      (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'p_' + Math.random().toString(36).slice(2, 10));
    clone.title = (src.title || 'Без назви') + ' (копія)';
    clone.status = 'draft';
    // Дату публікації змістимо на +1 день
    try {
      var d = new Date(src.dateTime);
      d.setDate(d.getDate() + 1);
      clone.dateTime = d.toISOString();
      // Дедлайн теж змістимо (якщо був авто)
      if (src.deadline && typeof deadlineFromDate === 'function') {
        clone.deadline = deadlineFromDate(clone.dateTime);
      }
    } catch (_) {}
    clone.comments = [];
    clone.history = [{
      id: (window.uuidV4 && window.uuidV4()) || Math.random().toString(36).slice(2,10),
      at: new Date().toISOString(),
      author: Store.currentUser && Store.currentUser().id,
      action: 'create',
      detail: 'дубль публікації ' + src.id.slice(0,8),
    }];
    clone.createdAt = new Date().toISOString();
    clone.updatedAt = new Date().toISOString();
    delete clone._trashed;
    delete clone._trashedAt;
    delete clone._isNew;

    // Зберігаємо й переходимо у нову картку
    var r = Store.upsertPub(clone);
    if (r && typeof r.then === 'function') {
      r.then(function () {
        if (typeof toast === 'function') toast('Створено копію', 'success', clone.title);
        location.hash = '#publication/' + clone.id;
      });
    } else {
      if (typeof toast === 'function') toast('Створено копію', 'success', clone.title);
      location.hash = '#publication/' + clone.id;
    }
  }
  window.duplicatePub = duplicatePub;

  // Додати кнопку «📋 Дублювати» у footer відкритої картки публікації
  function addDuplicateButton(p) {
    var foot = document.querySelector('.modal-foot');
    if (!foot || !p || !p.id) return;
    if (foot.querySelector('[data-action="dup"]')) return;
    var leftDiv = foot.querySelector('.left');
    var btn = document.createElement('button');
    btn.className = 'btn';
    btn.dataset.action = 'dup';
    btn.innerHTML = '📋 Дублювати';
    btn.onclick = function () { duplicatePub(p.id); };
    if (leftDiv) leftDiv.appendChild(btn);
    else foot.insertBefore(btn, foot.firstChild);
  }

  // Хук на openCard
  function patchOpenCardForExtras() {
    if (typeof window.openCard !== 'function' || window.openCard.__extrasPatched) return;
    var _orig = window.openCard;
    window.openCard = function (id) {
      _orig.call(this, id);
      var p = id === 'new' ? null : (Store.pub && Store.pub(id));
      if (p) setTimeout(function () { addDuplicateButton(p); }, 100);
    };
    window.openCard.__extrasPatched = true;
  }
  patchOpenCardForExtras();
  setTimeout(patchOpenCardForExtras, 300);
  setTimeout(patchOpenCardForExtras, 1500);

  // ============================================================
  // ICS EXPORT
  // ============================================================
  function exportIcs() {
    if (!window.Store) return;
    var pubs = Store.pubs ? Store.pubs() : [];
    if (!pubs.length) {
      if (typeof toast === 'function') toast('Нічого експортувати', 'warn');
      return;
    }
    var lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//DreamCar//HQ Calendar//UK');
    lines.push('CALSCALE:GREGORIAN');
    function ics(dt) {
      var d = new Date(dt); if (isNaN(d.getTime())) return '';
      // YYYYMMDDTHHMMSSZ
      var pad = function (n) { return String(n).padStart(2, '0'); };
      return d.getUTCFullYear() + pad(d.getUTCMonth()+1) + pad(d.getUTCDate()) + 'T' +
        pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00Z';
    }
    function escIcs(s) {
      return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    }
    var STATUS_LABELS = { draft: 'Чернетка', in_work: 'В роботі', review: 'На погодженні', approved: 'Погоджено', published: 'Опубліковано', rework: 'Доопрацювання' };
    pubs.forEach(function (p) {
      if (p._trashed) return;
      var start = ics(p.dateTime);
      if (!start) return;
      // duration ~30хв
      var endDt = new Date(p.dateTime); endDt.setMinutes(endDt.getMinutes() + 30);
      var end = ics(endDt.toISOString());
      var platforms = (p.platforms || []).join(',');
      var desc = 'Статус: ' + (STATUS_LABELS[p.status] || p.status) +
                 '\\nПлатформи: ' + (platforms || '—') +
                 '\\n\\n' + (p.text || '');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + p.id + '@dreamcar-hq');
      lines.push('DTSTAMP:' + ics(new Date().toISOString()));
      lines.push('DTSTART:' + start);
      lines.push('DTEND:' + end);
      lines.push('SUMMARY:' + escIcs(p.title || 'Без назви'));
      lines.push('DESCRIPTION:' + escIcs(desc));
      lines.push('URL:https://dreamcarua.github.io/dreamcar-team/hq/#publication/' + p.id);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'dreamcar-hq-calendar.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    if (typeof toast === 'function') toast('Експорт', 'success', 'dreamcar-hq-calendar.ics завантажено');
  }
  window.exportIcs = exportIcs;

  // ============================================================
  // KEYBOARD HELP OVERLAY
  // ============================================================
  function showKbdHelp() {
    if (document.querySelector('.kbd-help-overlay')) return;
    var overlay = document.createElement('div');
    overlay.className = 'kbd-help-overlay';
    overlay.innerHTML =
      '<div class="kbd-help-card">' +
        '<h2>⌨️ Гарячі клавіші</h2>' +
        '<div class="kbd-row"><span class="kbd-key">C</span><span class="kbd-desc">Створити нову публікацію</span></div>' +
        '<div class="kbd-row"><span class="kbd-key">/</span><span class="kbd-desc">Фокус на пошук</span></div>' +
        '<div class="kbd-row"><span class="kbd-key">1</span><span class="kbd-desc">Календар: режим «Місяць»</span></div>' +
        '<div class="kbd-row"><span class="kbd-key">2</span><span class="kbd-desc">Календар: режим «Тиждень»</span></div>' +
        '<div class="kbd-row"><span class="kbd-key">3</span><span class="kbd-desc">Календар: режим «День»</span></div>' +
        '<div class="kbd-row"><span class="kbd-key">4</span><span class="kbd-desc">Календар: режим «Список»</span></div>' +
        '<div class="kbd-row"><span class="kbd-key">?</span><span class="kbd-desc">Ця підказка</span></div>' +
        '<div class="kbd-row"><span class="kbd-key">Esc</span><span class="kbd-desc">Закрити модалку</span></div>' +
        '<div class="kbd-foot">DreamCar HQ · v0.3 · Натисни Esc щоб закрити</div>' +
      '</div>';
    overlay.onclick = function (e) { if (e.target === overlay) overlay.remove(); };
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
    });
    document.body.appendChild(overlay);
  }
  window.showKbdHelp = showKbdHelp;

  // Listen for ? key
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable]')) return;
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      showKbdHelp();
    }
  });

  console.log('%cDreamCar HQ Extras %c· duplicate + ICS + kbd-help active', 'color:#a78bfa;font-weight:700;', 'color:#888;');
})();
