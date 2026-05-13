/* ============================================================
   DreamCar HQ — Onboarding checklist (#9)
   ============================================================ */
// Новачок бачить banner у топі «Заверши онбординг (X/8)» з кнопкою.
// Окремий екран #onboarding з 8 кроками з auto-check логікою.

(function () {
  if (window.__hqOnbLoaded) return;
  window.__hqOnbLoaded = true;

  function getStore() { try { return Store; } catch (_) { return null; } }
  function getMe() {
    var s = getStore();
    if (!s || typeof s.currentUser !== 'function') return null;
    try { return s.currentUser() || null; } catch (_) { return null; }
  }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  (function () {
    if (document.getElementById('hq-onb-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-onb-css';
    css.textContent =
      '.hq-onb-banner { background: linear-gradient(90deg, rgba(216,0,4,0.15), rgba(255,106,31,0.05)); border-bottom: 1px solid var(--red); padding: 10px 28px; display: flex; align-items: center; gap: 12px; font-size: 13px; color: #fff; }' +
      '.hq-onb-banner .hob-icon { font-size: 18px; }' +
      '.hq-onb-banner .hob-progress { flex: 1; background: rgba(255,255,255,0.1); height: 8px; border-radius: 4px; overflow: hidden; max-width: 220px; margin-left: auto; }' +
      '.hq-onb-banner .hob-progress-fill { height: 100%; background: var(--brand-grad); border-radius: 4px; transition: width 0.3s; }' +
      '.hq-onb-banner a, .hq-onb-banner button { color: #fff; background: var(--red); border: none; padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; text-decoration: none; cursor: pointer; }' +
      '.hq-onb-banner button.dismiss { background: transparent; color: var(--grey); padding: 5px 8px; }' +
      '.hq-onb-wrap { padding: 28px 32px; max-width: 720px; margin: 0 auto; }' +
      '.hq-onb-wrap h1 { font-size: 26px; font-weight: 900; color: #fff; margin-bottom: 8px; text-transform: uppercase; letter-spacing: -0.01em; }' +
      '.hq-onb-wrap .sub { color: var(--grey); font-size: 14px; margin-bottom: 24px; }' +
      '.hq-onb-step { display: flex; align-items: flex-start; gap: 14px; padding: 16px 18px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; transition: border-color 0.15s; }' +
      '.hq-onb-step.done { border-color: var(--green); background: linear-gradient(135deg, rgba(74,222,128,0.05), transparent); }' +
      '.hq-onb-step .check { flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%; border: 2px solid var(--border-2); display: flex; align-items: center; justify-content: center; font-size: 14px; }' +
      '.hq-onb-step.done .check { background: var(--green); border-color: var(--green); color: #042814; font-weight: 800; }' +
      '.hq-onb-step .body { flex: 1; }' +
      '.hq-onb-step .title { color: #fff; font-weight: 700; margin-bottom: 4px; font-size: 14px; }' +
      '.hq-onb-step .desc { color: var(--grey); font-size: 12px; line-height: 1.5; margin-bottom: 8px; }' +
      '.hq-onb-step .desc a { color: var(--red-soft); }' +
      '.hq-onb-step .actions { display: flex; gap: 8px; flex-wrap: wrap; }' +
      '.hq-onb-step .actions button, .hq-onb-step .actions a { padding: 5px 10px; font-size: 11px; background: var(--bg-3); color: #ddd; border: 1px solid var(--border); border-radius: 5px; cursor: pointer; text-decoration: none; }' +
      '.hq-onb-step .actions button.primary { background: var(--red); color: #fff; border-color: var(--red); }' +
      '.hq-onb-summary { padding: 18px 22px; background: linear-gradient(135deg, rgba(216,0,4,0.08), transparent); border: 1px solid rgba(216,0,4,0.3); border-radius: 12px; margin-bottom: 20px; }' +
      '.hq-onb-summary .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--grey); margin-bottom: 6px; }' +
      '.hq-onb-summary .pct { font-size: 32px; font-weight: 900; color: var(--red-soft); }';
    document.head.appendChild(css);
  })();

  var STEPS = [
    { key: 'login', title: '👋 Залогінений через Google', desc: 'Це готово — ти тут.', auto: function () { return true; } },
    { key: 'tg', title: '📱 Привʼязати Telegram', desc: 'Щоб отримувати інлайн-кнопки погодження прямо в TG і не пропускати дедлайни. Йди у <a href="#settings">Налаштування</a> → блок «Швидка прив\'язка через бот».', auto: function (me) { return !!(me && me.tg_chat_id); } },
    { key: 'brand', title: '🎨 Прочитай DreamCar brand voice', desc: 'Що писати і що НЕ писати про DreamCar. ЗАБОРОНЕНІ слова: лотерея, розіграш, приз, шанс. Замість них: учасники, AI-токени, спільнота, нагорода.', actionLabel: '✓ Готово, прочитав', manual: true },
    { key: 'templates', title: '📋 Подивись 4 готових шаблони', desc: 'У будь-якій картці публікації є кнопка «📋 З шаблону». Тиць → 80% полів заповнюється автоматично. Спробуй.', actionLabel: '✓ Спробував', manual: true },
    { key: 'ai', title: '✨ Спробуй AI копірайт', desc: 'У картці публікації біля поля «Текст» є фіолетова кнопка «✨ AI». Claude генерує пост з нашого brief\'у з урахуванням brand voice. Економить 80% часу на тексті.', actionLabel: '✓ Спробував', manual: true },
    { key: 'firstpost', title: '✍ Створи свою першу публікацію', desc: 'Не обовʼязково ідеальну — просто пройди весь шлях: «+ Нова публікація» → заповни → збережи.', auto: function (me) {
      var s = getStore();
      if (!s || !me) return false;
      var pubs = (s.pubs && s.pubs()) || [];
      return pubs.some(function (p) { return p && (p.createdBy === me.id || (p.responsibles || []).indexOf(me.id) >= 0); });
    } },
    { key: 'workflow', title: '🔄 Зрозумій workflow погодження', desc: 'Чернетка → В роботі → На погодженні → Погоджено / Доопрацювання → Опубліковано. У review CEO/COO отримують TG-пуш з inline-кнопками ✓ / ↩.', actionLabel: '✓ Зрозумів', manual: true },
    { key: 'overview', title: '🗺 Освой основні розділи', desc: '<b>Календар</b> — план постів. <b>Дошка</b> — що на погодженні. <b>Бібліотека</b> — креативи. <b>Аналітика</b> — KPI. <b>Налаштування</b> — твій профіль.', actionLabel: '✓ Подивився', manual: true },
  ];

  function getProgress(me) {
    if (!me) return { steps: {}, done: 0, total: STEPS.length };
    var stored = (me.onboarding_steps || {});
    var done = 0;
    STEPS.forEach(function (st) {
      if (st.auto && st.auto(me)) { stored[st.key] = true; done++; }
      else if (stored[st.key]) { done++; }
    });
    return { steps: stored, done: done, total: STEPS.length };
  }

  async function markStep(key) {
    var me = getMe();
    if (!me) return;
    var stored = me.onboarding_steps || {};
    stored[key] = true;
    me.onboarding_steps = stored;
    if (window.HQ_BACKEND && window.supabase) {
      try {
        await window.supabase.from('users').update({
          onboarding_steps: stored,
          onboarding_completed_at: getProgress(me).done === STEPS.length ? new Date().toISOString() : null,
        }).eq('id', me.id);
      } catch (e) { console.warn('onb save err:', e); }
    }
  }

  function renderBanner() {
    var me = getMe();
    if (!me) return;
    var prog = getProgress(me);
    if (prog.done === prog.total) {
      var existing = document.querySelector('.hq-onb-banner');
      if (existing) existing.remove();
      return;
    }
    if (document.querySelector('.hq-onb-banner')) return;
    var topbar = document.querySelector('.topbar');
    if (!topbar) return;

    var pct = Math.round((prog.done / prog.total) * 100);
    var banner = document.createElement('div');
    banner.className = 'hq-onb-banner';
    banner.innerHTML =
      '<span class="hob-icon">🚀</span>' +
      '<span><b>Заверши онбординг</b> · ' + prog.done + ' з ' + prog.total + ' (' + pct + '%)</span>' +
      '<div class="hob-progress"><div class="hob-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<a href="#onboarding">Відкрити</a>' +
      '<button class="dismiss" title="Сховати на сьогодні">✕</button>';
    topbar.parentNode.insertBefore(banner, topbar.nextSibling);

    banner.querySelector('button.dismiss').onclick = function () {
      banner.remove();
      try { localStorage.setItem('hq-onb-dismissed', String(Date.now())); } catch (_) {}
    };
  }

  function maybeRenderBanner() {
    try {
      var dismissed = parseInt(localStorage.getItem('hq-onb-dismissed') || '0', 10);
      if (dismissed && (Date.now() - dismissed) < 12 * 3600 * 1000) return;
    } catch (_) {}
    renderBanner();
  }

  function renderOnboarding(root) {
    var me = getMe();
    var prog = getProgress(me);
    var pct = Math.round((prog.done / prog.total) * 100);

    root.innerHTML =
      '<div class="view-header"><h1>🚀 Онбординг</h1><span class="view-meta">· ' + prog.done + ' з ' + prog.total + ' кроків</span></div>' +
      '<div class="hq-onb-wrap">' +
        '<div class="hq-onb-summary">' +
          '<div class="label">Прогрес</div>' +
          '<div class="pct">' + pct + '%</div>' +
          '<div style="margin-top:10px;background:rgba(255,255,255,0.06);height:8px;border-radius:4px;overflow:hidden;">' +
            '<div style="height:100%;background:var(--brand-grad);width:' + pct + '%;transition:width 0.3s;"></div>' +
          '</div>' +
        '</div>' +
        STEPS.map(function (st, idx) {
          var done = prog.steps[st.key];
          return '<div class="hq-onb-step ' + (done ? 'done' : '') + '" data-key="' + st.key + '">' +
            '<div class="check">' + (done ? '✓' : (idx + 1)) + '</div>' +
            '<div class="body">' +
              '<div class="title">' + st.title + '</div>' +
              '<div class="desc">' + st.desc + '</div>' +
              (st.manual && !done ? '<div class="actions"><button class="primary" data-mark="' + st.key + '">' + escapeHtml(st.actionLabel || '✓ Готово') + '</button></div>' : '') +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';

    root.querySelectorAll('button[data-mark]').forEach(function (btn) {
      btn.onclick = async function () {
        await markStep(btn.dataset.mark);
        renderOnboarding(root);
        renderBanner();
      };
    });
  }
  window.renderOnboarding = renderOnboarding;

  function injectSidebar() {
    if (document.querySelector('.sidebar a[data-route="onboarding"]')) return;
    var me = getMe();
    if (!me) return;
    var prog = getProgress(me);
    if (prog.done === prog.total) return;
    var settings = document.querySelector('.sidebar a[data-route="settings"]');
    if (!settings) return;
    var a = document.createElement('a');
    a.className = 'nav-item';
    a.dataset.route = 'onboarding';
    a.href = '#onboarding';
    a.innerHTML = '<span class="ico">🚀</span><span class="label">Онбординг</span><span class="count" style="background:var(--red);">' + prog.done + '/' + prog.total + '</span>';
    settings.parentNode.insertBefore(a, settings);
  }
  [400, 1200, 2800].forEach(function (ms) { setTimeout(injectSidebar, ms); });
  [400, 1200, 2800].forEach(function (ms) { setTimeout(maybeRenderBanner, ms); });

  function maybeRoute() {
    var route = (location.hash || '').slice(1).split('/')[0];
    if (route !== 'onboarding') return;
    var main = document.getElementById('main');
    if (!main) return;
    document.querySelectorAll('.sidebar a.nav-item').forEach(function (x) { x.classList.remove('active'); });
    var lnk = document.querySelector('.sidebar a[data-route="onboarding"]');
    if (lnk) lnk.classList.add('active');
    var bc = document.getElementById('breadcrumb');
    if (bc) bc.innerHTML = 'Стіл SMM · <b>Онбординг</b>';
    renderOnboarding(main);
  }
  window.addEventListener('hashchange', maybeRoute);
  [500, 1800].forEach(function (ms) { setTimeout(maybeRoute, ms); });

  console.log('%cDreamCar HQ Onboarding %c· checklist ready', 'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
