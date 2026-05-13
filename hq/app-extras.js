/* ============================================================
   DreamCar HQ — Extras v2
   • Duplicate, ICS, kbd-help, settings-route-fix
   • Deep-link "Прив'язати через бот" (з retry)
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
      '.kbd-help-card .kbd-foot { margin-top: 16px; font-size: 11px; color: var(--grey); text-align: center; }' +
      '.tg-bind-block { background: linear-gradient(135deg, rgba(0,136,204,0.1), transparent); border: 1px solid rgba(0,136,204,0.3); border-radius: 8px; padding: 14px; margin-bottom: 12px; }' +
      '.tg-bind-block .tb-title { font-weight: 700; color: #fff; margin-bottom: 6px; font-size: 13px; }' +
      '.tg-bind-block .tb-desc { font-size: 12px; color: var(--grey); line-height: 1.5; margin-bottom: 10px; }' +
      '.tg-bind-block a.tb-cta { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; background: #0088cc; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 13px; transition: background 0.15s; }' +
      '.tg-bind-block a.tb-cta:hover { background: #0099e0; }';
    document.head.appendChild(css);
  })();

  // ============================================================
  // Settings route fix + auto bind-block
  // ============================================================
  function maybeRenderSettings() {
    var hash = (location.hash || '').slice(1);
    var route = hash.split('/')[0];
    if (route !== 'settings') return;
    if (typeof window.renderSettings !== 'function') return;
    var main = document.getElementById('main');
    if (!main) return;
    document.querySelectorAll('.sidebar a.nav-item').forEach(function (a) { a.classList.remove('active'); });
    var settingsLink = document.querySelector('.sidebar a[data-route="settings"]');
    if (settingsLink) settingsLink.classList.add('active');
    var bc = document.getElementById('breadcrumb');
    if (bc) bc.innerHTML = 'Стіл SMM · <b>Налаштування</b>';
    window.renderSettings(main);
    // Після рендеру — retry-ланцюг для bind-block
    [80, 300, 1000, 2500].forEach(function (ms) { setTimeout(enhanceTgBindBlock, ms); });
  }
  window.addEventListener('hashchange', maybeRenderSettings);
  [200, 1000].forEach(function (ms) { setTimeout(maybeRenderSettings, ms); });

  // ---- TG bind block (з retry) ----
  function enhanceTgBindBlock() {
    var input = document.getElementById('set_tg_chat_id');
    if (!input) return;
    var section = input.closest('div[style*="background:var(--bg-2)"]') || input.parentElement;
    if (!section) return;

    var me = window.Store && Store.currentUser && Store.currentUser();
    var userId = me && me.id;
    var botUsername = (window.HQ_CONFIG && (window.HQ_CONFIG.TG_BOT_USERNAME || window.HQ_CONFIG.TG_LOGIN_BOT)) || '';

    // Якщо це новий блок або існуючий ще "недоступно" — видаляємо існуючий перед перерендером.
    // Якщо вже HAS deep-link cta → не чіпаємо.
    var existing = section.querySelector('.tg-bind-block');
    if (existing) {
      var hasCta = !!existing.querySelector('a.tb-cta');
      if (hasCta) return; // уже OK, не чіпаємо
      existing.remove();
    }

    // Якщо userId ще не доступний — НЕ робимо fallback, чекаємо наступного retry
    if (botUsername && !userId) {
      // Не вставляємо порожній блок; retry через setTimeout у maybeRenderSettings подбає.
      return;
    }

    var block = document.createElement('div');
    block.className = 'tg-bind-block';
    if (botUsername && userId) {
      var url = 'https://t.me/' + botUsername.replace(/^@/, '') + '?start=hq_' + encodeURIComponent(userId);
      block.innerHTML =
        '<div class="tb-title">✈️ Швидка прив\'язка через бот</div>' +
        '<div class="tb-desc">Натисни кнопку — відкриється Telegram з ботом. Тисни <b>«Start»</b> у боті — і chat_id привʼяжеться автоматично, без копіювання чисел.</div>' +
        '<a class="tb-cta" href="' + url + '" target="_blank" rel="noopener">🔗 Прив\'язати через @' + (botUsername.replace(/^@/, '')) + '</a>';
    } else {
      // Нема botUsername — fallback
      block.innerHTML =
        '<div class="tb-title">✈️ Швидка прив\'язка через бот</div>' +
        '<div class="tb-desc">Поки що недоступно — адмін не задав <code>TG_BOT_USERNAME</code> у <code>config.js</code>. Зараз — введи <code>chat_id</code> вручну нижче.</div>';
    }
    var inputRow = input.closest('div[style*="display:flex"]') || input.parentElement;
    if (inputRow && inputRow.parentNode) inputRow.parentNode.insertBefore(block, inputRow);
  }
  window.enhanceTgBindBlock = enhanceTgBindBlock;

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
    try {
      var d = new Date(src.dateTime);
      d.setDate(d.getDate() + 1);
      clone.dateTime = d.toISOString();
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
  [300, 1500].forEach(function (ms) { setTimeout(patchOpenCardForExtras, ms); });

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
    lines.push('BEGIN:VCALENDAR'); lines.push('VERSION:2.0');
    lines.push('PRODID:-//DreamCar//HQ Calendar//UK'); lines.push('CALSCALE:GREGORIAN');
    function ics(dt) {
      var d = new Date(dt); if (isNaN(d.getTime())) return '';
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
      var start = ics(p.dateTime); if (!start) return;
      var endDt = new Date(p.dateTime); endDt.setMinutes(endDt.getMinutes() + 30);
      var end = ics(endDt.toISOString());
      var platforms = (p.platforms || []).join(',');
      var desc = 'Статус: ' + (STATUS_LABELS[p.status] || p.status) +
                 '\\nПлатформи: ' + (platforms || '—') +
                 '\\n\\n' + (p.text || '');
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + p.id + '@dreamcar-hq');
      lines.push('DTSTAMP:' + ics(new Date().toISOString()));
      lines.push('DTSTART:' + start); lines.push('DTEND:' + end);
      lines.push('SUMMARY:' + escIcs(p.title || 'Без назви'));
      lines.push('DESCRIPTION:' + escIcs(desc));
      lines.push('URL:https://dreamcarua.github.io/dreamcar-team/hq/#publication/' + p.id);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    var blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'dreamcar-hq-calendar.ics';
    document.body.appendChild(a); a.click(); a.remove();
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

  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable]')) return;
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      showKbdHelp();
    }
  });

  console.log('%cDreamCar HQ Extras v2 %c· bind-block retry-loop active', 'color:#a78bfa;font-weight:700;', 'color:#888;');
})();
