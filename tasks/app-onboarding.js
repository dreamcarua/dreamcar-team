/* ============================================================
   DreamCar Tasks — Onboarding checklist v1 (05.06.2026)
   ============================================================
   Інлайн флоу як у HQ #onboarding. STEPS специфічні для Tasks:
   workflow, watchers, корзина, календар, сортування, тема, TG.
   ============================================================ */
(function () {
  if (window.__tasksOnbLoaded) return;
  window.__tasksOnbLoaded = true;

  function getMe() { try { return (window.state && window.state.publicUser) || null; } catch (_) { return null; } }
  function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ===== CSS =====
  (function () {
    if (document.getElementById('tasks-onb-css')) return;
    var css = document.createElement('style');
    css.id = 'tasks-onb-css';
    css.textContent =
      '.tonb-banner { position:fixed; top:0; left:0; right:0; background: linear-gradient(90deg, rgba(227,6,19,0.18), rgba(245,158,11,0.06)); border-bottom: 1px solid var(--red,#E30613); padding: 8px 24px; display: flex; align-items: center; gap: 12px; font-size: 13px; color: #fff; z-index: 5000; }' +
      '@media (max-width: 900px) { .tonb-banner { display: none !important; } }' +
      '.tonb-banner .ico { font-size: 18px; }' +
      '.tonb-banner .prog { flex: 1; background: rgba(255,255,255,0.1); height: 8px; border-radius: 4px; overflow: hidden; max-width: 220px; margin-left: auto; }' +
      '.tonb-banner .prog-fill { height: 100%; background: linear-gradient(90deg,#E30613,#F59E0B); border-radius: 4px; transition: width 0.3s; }' +
      '.tonb-banner a { color: #fff; background: var(--red,#E30613); border: none; padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; text-decoration: none; cursor: pointer; }' +
      '.tonb-banner button.dismiss { background: transparent; color: var(--ash,#888); padding: 5px 8px; border: none; cursor: pointer; }' +
      '.tonb-view { padding: 28px 32px; max-width: 820px; margin: 0 auto; color:#ddd; }' +
      '.tonb-view h1 { font-family:Oswald,sans-serif; font-size: 28px; color: #fff; margin-bottom: 6px; letter-spacing: .02em; }' +
      '.tonb-view .meta { color: var(--ash,#888); font-size: 13px; margin-bottom: 24px; }' +
      '.tonb-summary { padding: 22px 26px; background: linear-gradient(135deg, rgba(227,6,19,0.08), transparent); border: 1px solid rgba(227,6,19,0.3); border-radius: 14px; margin-bottom: 22px; }' +
      '.tonb-summary .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--ash,#888); margin-bottom: 6px; }' +
      '.tonb-summary .pct { font-size: 38px; font-weight: 900; color: #FF6A7A; }' +
      '.tonb-summary p { color: var(--ash,#888); font-size: 12px; margin-top: 10px; line-height: 1.5; }' +
      '.tonb-step { padding: 20px 22px; background: var(--coal,#141414); border: 1px solid var(--steel,#2a2a2a); border-radius: 12px; margin-bottom: 14px; transition: border-color 0.15s; }' +
      '.tonb-step.done { border-color: #10B981; background: linear-gradient(135deg, rgba(16,185,129,0.04), transparent); }' +
      '.tonb-step .head { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }' +
      '.tonb-step .check { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--steel,#2a2a2a); display: flex; align-items: center; justify-content: center; font-size: 14px; color: #888; }' +
      '.tonb-step.done .check { background: #10B981; border-color: #10B981; color: #042814; font-weight: 800; }' +
      '.tonb-step .title { color: #fff; font-weight: 700; font-size: 15px; flex: 1; }' +
      '.tonb-step .desc { color: #ccc; font-size: 13px; line-height: 1.65; padding-left: 42px; }' +
      '.tonb-step .desc p { margin: 0 0 10px 0; }' +
      '.tonb-step .desc ul, .tonb-step .desc ol { margin: 0 0 10px 22px; padding: 0; color: #bbb; }' +
      '.tonb-step .desc ul li, .tonb-step .desc ol li { margin-bottom: 4px; }' +
      '.tonb-step .desc a { color: #FF6A7A; border-bottom: 1px dashed #E30613; }' +
      '.tonb-step .desc code { background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; font-size: 12px; color: #FBBF24; font-family: JetBrains Mono, monospace; }' +
      '.tonb-step .desc .why { background: rgba(227,6,19,0.06); border-left: 3px solid #E30613; padding: 8px 12px; border-radius: 0 6px 6px 0; margin-bottom: 12px; font-size: 12px; color: #ddd; }' +
      '.tonb-step .desc .tip { background: rgba(16,185,129,0.06); border-left: 3px solid #10B981; padding: 8px 12px; border-radius: 0 6px 6px 0; margin-top: 10px; font-size: 12px; color: #ddd; }' +
      '.tonb-step .desc .warn { background: rgba(245,158,11,0.08); border-left: 3px solid #F59E0B; padding: 8px 12px; border-radius: 0 6px 6px 0; margin-top: 10px; font-size: 12px; color: #ddd; }' +
      '.tonb-step .actions { display: flex; gap: 8px; flex-wrap: wrap; padding-left: 42px; margin-top: 14px; }' +
      '.tonb-step .actions button, .tonb-step .actions a { padding: 8px 14px; font-size: 12px; background: var(--coal,#141414); color: #ddd; border: 1px solid var(--steel,#2a2a2a); border-radius: 6px; cursor: pointer; text-decoration: none; font-weight: 600; }' +
      '.tonb-step .actions button.primary { background: var(--red,#E30613); color: #fff; border-color: var(--red,#E30613); }';
    document.head.appendChild(css);
  })();

  // ===== STEPS =====
  var STEPS = [
    {
      key: 'login',
      title: '👋 Залогінений у Tasks',
      desc:
        '<div class="why">✓ <b>Готово.</b> Якщо ти бачиш цю сторінку — доступ є. Tasks використовує ту саму сесію що HQ (single sign-on через Supabase Auth).</div>' +
        '<p>Tasks — це <b>не email-style inbox</b>, а структурована система: кожна задача має дедлайн, пріоритет, виконавця і чек-лист. Все що "просто слідкувати" — у watchers, все що "треба зробити" — у assignee.</p>',
      auto: function () { return true; },
    },

    {
      key: 'tg_bind',
      title: '📱 Привʼязати Telegram (критично)',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Без TG ти НЕ будеш отримувати сповіщення про нові задачі, нагадування про дедлайни, @mentions у коментарях. Tasks стане "молчазним" — і ти просто пропустиш роботу.</div>' +
        '<p>Що тобі прилетить через TG після bind:</p>' +
        '<ul>' +
          '<li>📌 <b>Призначено задачу</b> — одразу, з кнопками ✅ Готово / ▶ В роботу / 👀 Відкрити</li>' +
          '<li>⏰ <b>Нагадування</b> — за 24 год до дедлайну (приходить о 09:00)</li>' +
          '<li>🔥 <b>Прострочено</b> — щоранку поки не зробиш</li>' +
          '<li>💬 <b>Коментар з @твоє_імʼя</b> — DM з текстом + кнопкою «Відповісти»</li>' +
          '<li>📊 <b>Щоденний digest</b> о 9:00 (опціонально, можна вимкнути)</li>' +
        '</ul>' +
        '<p><b>Як привʼязати:</b></p>' +
        '<ol>' +
          '<li>Відкрий <a href="https://t.me/dreamcar_team_bot" target="_blank">@dreamcar_team_bot</a> у Telegram</li>' +
          '<li>Напиши <code>/start</code></li>' +
          '<li>Авторизуйся (бот видасть deep-link)</li>' +
          '<li>Поверни у HQ → Settings → перевір що з\'явився ✅ Telegram bound</li>' +
        '</ol>' +
        '<div class="tip">💡 <b>Не хочеш digest о 9:00?</b> Settings → 🔕 Daily digest → вимкнути. Інші типи (assignment / deadline / @mention) залишаться.</div>',
      action: { label: '📱 Відкрити @dreamcar_team_bot', href: 'https://t.me/dreamcar_team_bot', external: true },
      actionLabel: '✓ Привʼязав TG',
      manual: true,
      auto: function (me) { return !!(me && me.tg_chat_id); },
    },

    {
      key: 'workflow',
      title: '🔄 Як живе задача (4 статуси)',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Кожен статус має свою роль і людину. Якщо плутаєш — задача залишає без відповідального і тоне.</div>' +
        '<p><b>4 статуси у Tasks (Kanban колонки):</b></p>' +
        '<ul>' +
          '<li>📥 <b>Inbox</b> — щойно створена, ще не взято в роботу. Виконавець вирішує: брати чи делегувати назад.</li>' +
          '<li>⚙ <b>Doing</b> — взято в роботу. Виконавець відповідає за прогрес.</li>' +
          '<li>👀 <b>Review</b> — зроблено, треба перевірка лідом або CEO/COO. Тут чекає не виконавець, а інша людина.</li>' +
          '<li>✅ <b>Done</b> — закрито. Recurring задачі автоматично створюють наступну.</li>' +
        '</ul>' +
        '<p><b>Додатковий стан:</b> 🚧 <b>Blocked</b> — задача активна але чекає чогось зовнішнього (партнер не відповів, доступ не дали). НЕ враховується у "прострочені".</p>' +
        '<p><b>Як змінити статус:</b></p>' +
        '<ul>' +
          '<li><b>Drag-drop</b> картки між колонками</li>' +
          '<li>Або клік на картку → Overview → кнопки «Розпочати» / «На перевірку» / «Завершити»</li>' +
          '<li>Або з TG нотифікації — кнопки ✅ Готово / ▶ В роботу прямо у DM</li>' +
        '</ul>' +
        '<div class="tip">💡 <b>Рekурентні задачі</b> (recurrence): «Щотижневий звіт» — закриваєш one → наступна автоматично з\'являється у Inbox з due_date +7 днів.</div>',
      actionLabel: '✓ Знаю 4 статуси',
      manual: true,
    },

    {
      key: 'sort_filters',
      title: '🔥 Сортування + фільтри (Сьогодні / Прострочено)',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Якщо у тебе 30+ задач — потрібно швидко бачити що горить, а не шукати руками.</div>' +
        '<p><b>Автоматичне сортування</b> у кожній колонці (найгарячіше зверху):</p>' +
        '<ol>' +
          '<li><b>Прострочене</b> (overdue) — зверху, червоним</li>' +
          '<li><b>Сьогодні</b></li>' +
          '<li><b>Завтра</b> (+1 день), через 2 дні…</li>' +
          '<li><b>Без дедлайну</b> — внизу, сортовано по priority (P1 вище P4)</li>' +
        '</ol>' +
        '<p>Більше не треба думати "що першим зробити" — система вже відсортувала.</p>' +
        '<p><b>Фільтр chips</b> у меню зверху:</p>' +
        '<ul>' +
          '<li><b>ВСІ</b> — повний список</li>' +
          '<li><b>МОЇ</b> — assignee=я</li>' +
          '<li><b>P1+P2</b> — критичні</li>' +
          '<li><b>СЬОГОДНІ</b> — due_date=сьогодні</li>' +
          '<li><b>ПРОСТРОЧЕНІ</b> — due_date<сьогодні і status≠done/blocked</li>' +
          '<li><b>ЗАСТРЯГЛИ</b> — у doing >7 днів без updated_at change</li>' +
          '<li><b>@МЕНЕ</b> — задачі де я згаданий у коментарях</li>' +
          '<li><b>СТЕЖУ</b> — watchers містить мене</li>' +
          '<li><b>Я СТВОРИВ</b> — created_by=я</li>' +
        '</ul>' +
        '<div class="tip">💡 <b>Priority logic:</b> P1=термiново сьогодні · P2=цього тижня · P3=стандарт · P4=без поспіху. Якщо ти Lead/COO — НЕ ставь P1 на все підряд, бо втратиш сигнал.</div>',
      actionLabel: '✓ Знаю фільтри і сортування',
      manual: true,
    },

    {
      key: 'first_task',
      title: '✍️ Створи першу задачу (без страху)',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Tasks ПОЛЯГАЄ на якісних задачах. Якщо створиш "зробити Х" без дедлайну — нічого не станеться. Якщо створиш "Підготувати рев\'ю проекту Volvo до 19:00 п\'ятниці, prio P2" — система працює.</div>' +
        '<p><b>Що ввести у формі:</b></p>' +
        '<ul>' +
          '<li><b>Назва (дія):</b> "Зробити Х" або "Перевірити Y" — починай з дієслова</li>' +
          '<li><b>Опис:</b> контекст ("чому це треба", "де файли"), посилання</li>' +
          '<li><b>Статус:</b> Inbox (якщо ще не береш у роботу) або Doing (якщо одразу делать)</li>' +
          '<li><b>Пріоритет:</b> P3 за замовчуванням. P1+P2 тільки якщо реально горить</li>' +
          '<li><b>Виконавець:</b> ОДИН — той хто буде робити. Не "вся команда".</li>' +
          '<li><b>Дедлайн:</b> реалістичний (не «вчора»)</li>' +
          '<li><b>Чек-лист (subtasks):</b> якщо задача велика — розбий на 3-5 підпунктів. Видно прогрес N/M.</li>' +
          '<li><b>Мітки:</b> теги для пошуку — <code>hq</code>, <code>brand</code>, <code>volvo</code>, <code>buget</code>...</li>' +
          '<li><b>Спостерігачі:</b> хто хоче бачити прогрес але НЕ робить (PM, Lead). Отримають усі нотифікації про зміни.</li>' +
        '</ul>' +
        '<p><b>Як створити:</b></p>' +
        '<ol>' +
          '<li>Натисни <b>«+ ЗАВДАННЯ»</b> у chip-меню зверху</li>' +
          '<li>Або клавіша <code>N</code> з будь-якої сторінки</li>' +
          '<li>Або FAB кнопка <b>+</b> справа знизу на мобілці</li>' +
          '<li>Заповни форму → <b>Cmd+S</b> (Mac) / <b>Ctrl+S</b> (Win) → збережено</li>' +
        '</ol>' +
        '<div class="tip">💡 Tasks автозбережає у пам\'ять. Якщо випадково закрив модалку (Esc) — попередить "Закрити без збереження? Введені дані втратяться".</div>',
      actionLabel: '✓ Створив першу задачу',
      manual: true,
    },

    {
      key: 'watchers',
      title: '🤝 Виконавець vs Спостерігачі',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Якщо плутаєш — або задача без відповідального (ВСІ — це НІХТО), або ти отримуєш сповіщення про все що тебе не торкається.</div>' +
        '<p><b>Різниця:</b></p>' +
        '<ul>' +
          '<li>👤 <b>ВИКОНАВЕЦЬ</b> (assignee) — <b>одна людина</b>. Той хто РОБИТЬ. Несе відповідальність.</li>' +
          '<li>👀 <b>СПОСТЕРІГАЧІ</b> (watchers) — <b>багато людей</b>. Хочуть бачити прогрес, але НЕ роблять. Тимлід, PM, зацікавлені.</li>' +
        '</ul>' +
        '<p><b>Як заповнити:</b></p>' +
        '<ul>' +
          '<li>Виконавець — звичайний <code>&lt;select&gt;</code> "ВИКОНАВЕЦЬ" → обери ОДНУ людину</li>' +
          '<li>Спостерігачі — інший <code>&lt;select&gt;</code> "СПОСТЕРІГАЧІ" → обираєш → з\'являється chip "Артем · member ✕". Можеш додавати кількох — обираєш по одному, кожного разу chip + select повертається до placeholder.</li>' +
        '</ul>' +
        '<p><b>Хто отримує сповіщення:</b></p>' +
        '<ul>' +
          '<li>Виконавець — всі (assignment, reminders, comments, status changes)</li>' +
          '<li>Спостерігачі — всі КРІМ assignment (вони і так були додані вручну)</li>' +
          '<li>Mentions <code>@імʼя</code> у коментарі — той хто згаданий, окремо</li>' +
        '</ul>' +
        '<div class="tip">💡 <b>Не додавай watchers "про всяк випадок"</b> — це спам. Краще: коли потрібно — людина сама підпишеться (Watch checkbox на картці).</div>',
      actionLabel: '✓ Знаю різницю Виконавець vs Спостерігачі',
      manual: true,
    },

    {
      key: 'calendar',
      title: '📅 Календарний вид',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Список карточок добре для "що зараз робити". Календар — для "що буде через тиждень" і "коли поставити дедлайн без перевантаження команди".</div>' +
        '<p><b>Як відкрити:</b> chip <b>📅 КАЛЕНДАР</b> у меню фільтрів.</p>' +
        '<p><b>Що бачиш:</b></p>' +
        '<ul>' +
          '<li><b>Місячна сітка</b> 7 днів (ПН-НД). Сьогодні підсвічена червоним.</li>' +
          '<li><b>Кожна задача</b> — кольоровий pill: ініціал виконавця + назва. <span style="color:#DC2626">P1 червоний</span> · <span style="color:#F59E0B">P2 жовтий</span> · <span style="color:#3B82F6">P3 синій</span> · <span style="color:#888">P4 сірий</span>.</li>' +
          '<li><b>Прострочені</b> — текст червоний</li>' +
          '<li><b>До 4 задач на день</b>, потім "+N ще"</li>' +
        '</ul>' +
        '<p><b>Інтерактив:</b></p>' +
        '<ul>' +
          '<li>Клік на pill → відкрити задачу у Overview</li>' +
          '<li>Клік на день → нова задача з prefilled <code>due_date</code></li>' +
          '<li>Чекбокс <b>«тільки мої»</b> — assignee=я</li>' +
          '<li>← Місяць / Місяць → / Сьогодні — навігація</li>' +
        '</ul>' +
        '<p><b>Як вийти:</b> клік на будь-який фільтр chip (Всі/Мої/Сьогодні) → автоматично закриває календар + повертає на board з обраним фільтром. Або кнопка <code>← На дошку</code>.</p>' +
        '<div class="tip">💡 Перед постановкою нових дедлайнів — глянь календар на тиждень. Якщо у понеділка вже 8 задач — не клади ще одну, а попроси людину спочатку розгрести.</div>',
      actionLabel: '✓ Дивився календар',
      manual: true,
    },

    {
      key: 'trash',
      title: '🗑 Корзина — 30 днів захисту',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Раніше Delete означало "втрачено навіки". Тепер — 30 днів на роздуми. Якщо хтось видалив твою задачу і сказав "не було" — можеш відновити з корзини.</div>' +
        '<p><b>Хто може видалити задачу:</b></p>' +
        '<ul>' +
          '<li><b>Автор</b> (хто створив задачу) — завжди</li>' +
          '<li><b>CEO / COO</b> — може все, включно з чужими</li>' +
          '<li><b>Інші ролі</b> — НЕ можуть видаляти чужі задачі. Toast "Видалити може тільки автор або CEO/COO"</li>' +
        '</ul>' +
        '<p><b>Як видалити:</b> у Tasks → відкрий задачу → 🗑 → з\'явиться модалка з 3 кнопками:</p>' +
        '<ul>' +
          '<li style="list-style:none;color:#FF6A7A;">🗑 <b>ВИДАЛИТИ НАЗАВЖДИ</b> — тільки CEO/COO. Корзини НЕ буде. Двоступенева підтвердження.</li>' +
          '<li style="list-style:none;color:#FBBF24;">📦 <b>ПЕРЕМІСТИТИ В КОРЗИНУ</b> — 30 днів, можна відновити</li>' +
          '<li style="list-style:none;">✕ <b>СКАСУВАТИ</b> — Esc теж закриває</li>' +
        '</ul>' +
        '<p><b>Де знайти:</b> chip <b>🗑 КОРЗИНА (N)</b> у меню фільтрів. Число = скільки задач у корзині.</p>' +
        '<p><b>У корзині бачиш:</b> назва, автор, <b>хто видалив</b>, дата, <b>залишилось N днів</b> (≤3 — червоний, ≤7 — жовтий), кнопки ↩ Відновити / 🗑 Purge.</p>' +
        '<div class="tip">💡 <b>CEO/COO бачать ВСІ</b> видалені задачі команди — контроль хто що видаляє. Інші ролі — лише свої.</div>' +
        '<div class="warn">⚠️ Через 30 днів — hard delete через cron. Без відновлення.</div>',
      actionLabel: '✓ Знаю як відновити з корзини',
      manual: true,
    },

    {
      key: 'tg_buttons',
      title: '🔘 TG inline кнопки — мінус 80% кліків',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Якщо у тебе мобільний — не треба відкривати браузер, заходити у Tasks, шукати задачу, тиснути Done. Все робиться 1 кліком у DM.</div>' +
        '<p><b>Під task notification у TG:</b></p>' +
        '<ul>' +
          '<li>✅ <b>Готово</b> — статус → done. У повідомленні з\'явиться "✅ Виконано · {твоє ім\'я} · 15:35"</li>' +
          '<li>▶ <b>В роботу</b> — статус → doing. Те саме mark.</li>' +
          '<li>👀 <b>Відкрити у браузері</b> — <b>1 клік</b> відкриває браузер з задачею. Раніше показувало URL текстом, треба було копіювати.</li>' +
        '</ul>' +
        '<p><b>Команди боту</b> (надсилай у DM @dreamcar_team_bot):</p>' +
        '<ul>' +
          '<li><code>/start</code> — привʼязати TG</li>' +
          '<li><code>/today</code> — що заплановано сьогодні</li>' +
          '<li><code>/late</code> — прострочені</li>' +
          '<li><code>/my</code> — що чекає від мене</li>' +
          '<li><code>/tasks</code> — active задачі з Done/Comment</li>' +
          '<li><code>/help</code> — список усіх команд</li>' +
        '</ul>' +
        '<div class="tip">💡 <b>Дедуплікація:</b> якщо хтось reload-ить Tasks — повторна нотифікація НЕ прилетить (5-хв guard). Без спаму.</div>',
      actionLabel: '✓ Знаю про TG inline',
      manual: true,
    },

    {
      key: 'theme',
      title: '🎨 Світла / темна тема',
      desc:
        '<p>Якщо тобі важко працювати у темному режимі — клацни іконку <b>🌙 / ☀️</b> у топбарі.</p>' +
        '<ul>' +
          '<li>Тема <b>зберігається у браузері</b> — не треба перемикати кожного разу</li>' +
          '<li><b>Синхронізується між Tasks + HQ + Dashboard</b> — обираєш у одному, інші теж стають світлими/темними</li>' +
          '<li><b>Синхронізується між вкладками</b> — відкрив Tasks + HQ паралельно → перемкнув → обидва оновились</li>' +
        '</ul>',
      actionLabel: '✓ Знаю де перемкнути тему',
      manual: true,
    },
  ];

  // ===== Progress =====
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
    if (!me || !window.supabase) return;
    var stored = me.onboarding_steps || {};
    stored[key] = true;
    me.onboarding_steps = stored;
    try {
      await window.supabase.from('users').update({
        onboarding_steps: stored,
        onboarding_completed_at: getProgress(me).done === STEPS.length ? new Date().toISOString() : null,
      }).eq('id', me.id);
    } catch (e) { console.warn('[tasks onb save]', e); }
  }

  async function unmarkStep(key) {
    var me = getMe();
    if (!me || !window.supabase) return;
    var stored = me.onboarding_steps || {};
    delete stored[key];
    me.onboarding_steps = stored;
    try {
      await window.supabase.from('users').update({ onboarding_steps: stored, onboarding_completed_at: null }).eq('id', me.id);
    } catch (e) { console.warn('[tasks onb unmark]', e); }
  }

  // ===== Banner у топбарі =====
  function renderBanner() {
    var me = getMe();
    if (!me) return;
    var prog = getProgress(me);
    if (prog.done === prog.total) {
      var existing = document.querySelector('.tonb-banner');
      if (existing) existing.remove();
      return;
    }
    if (document.querySelector('.tonb-banner')) return;
    var pct = Math.round((prog.done / prog.total) * 100);
    var banner = document.createElement('div');
    banner.className = 'tonb-banner';
    banner.innerHTML =
      '<span class="ico">🚀</span>' +
      '<span><b>Заверши онбординг Tasks</b> · ' + prog.done + ' з ' + prog.total + ' (' + pct + '%)</span>' +
      '<div class="prog"><div class="prog-fill" style="width:' + pct + '%"></div></div>' +
      '<a href="#onboarding">Відкрити</a>' +
      '<button class="dismiss" title="Сховати на 12 год">✕</button>';
    document.body.insertBefore(banner, document.body.firstChild);
    // Зрушити сторінку щоб banner не перекривав топбар
    document.body.style.paddingTop = (parseInt(document.body.style.paddingTop || '0', 10) + 38) + 'px';

    banner.querySelector('button.dismiss').onclick = function () {
      banner.remove();
      document.body.style.paddingTop = '';
      try { localStorage.setItem('tasks-onb-dismissed', String(Date.now())); } catch (_) {}
    };
  }

  function maybeRenderBanner() {
    try {
      var dismissed = parseInt(localStorage.getItem('tasks-onb-dismissed') || '0', 10);
      if (dismissed && (Date.now() - dismissed) < 12 * 3600 * 1000) return;
    } catch (_) {}
    renderBanner();
  }

  // ===== Render onboarding view =====
  function renderOnboarding() {
    var me = getMe();
    if (!me) return;
    var prog = getProgress(me);
    var pct = Math.round((prog.done / prog.total) * 100);

    // Сховати board, показати onboarding view
    var board = document.querySelector('.kanban');
    if (board) board.style.display = 'none';
    var trashV = document.getElementById('trashView'); if (trashV) trashV.style.display = 'none';
    var calV = document.getElementById('calendarView'); if (calV) calV.style.display = 'none';

    var existing = document.getElementById('tonbView');
    if (existing) existing.remove();
    var root = document.createElement('div');
    root.id = 'tonbView';

    var stepsHtml = STEPS.map(function (st, idx) {
      var done = prog.steps[st.key];
      var btns = [];
      if (st.action) {
        var ext = st.action.external ? ' target="_blank" rel="noopener"' : '';
        btns.push('<a href="' + st.action.href + '"' + ext + '>' + escapeHtml(st.action.label) + (st.action.external ? ' ↗' : '') + '</a>');
      }
      if (st.manual && !done) {
        btns.push('<button class="primary" data-mark="' + st.key + '">' + escapeHtml(st.actionLabel || '✓ Готово') + '</button>');
      }
      if (st.manual && done) {
        btns.push('<button data-unmark="' + st.key + '" style="background:transparent;color:#888;">↶ Скинути</button>');
      }
      var actionsHtml = btns.length ? '<div class="actions">' + btns.join('') + '</div>' : '';
      return '<div class="tonb-step ' + (done ? 'done' : '') + '" data-key="' + st.key + '">' +
        '<div class="head">' +
          '<div class="check">' + (done ? '✓' : (idx + 1)) + '</div>' +
          '<div class="title">' + st.title + '</div>' +
        '</div>' +
        '<div class="desc">' + st.desc + '</div>' +
        actionsHtml +
      '</div>';
    }).join('');

    root.innerHTML =
      '<div class="tonb-view">' +
        '<h1>🚀 ОНБОРДИНГ TASKS</h1>' +
        '<div class="meta">· ' + prog.done + ' з ' + prog.total + ' кроків</div>' +
        '<div class="tonb-summary">' +
          '<div class="label">Прогрес навчання</div>' +
          '<div class="pct">' + pct + '%</div>' +
          '<div style="margin-top:10px;background:rgba(255,255,255,0.06);height:10px;border-radius:5px;overflow:hidden;">' +
            '<div style="height:100%;background:linear-gradient(90deg,#E30613,#F59E0B);width:' + pct + '%;transition:width 0.3s;"></div>' +
          '</div>' +
          '<p>Tasks — не просто список todo, а робоча система команди. Кожен крок — міні-лекція з прикладами. Витрать 20-25 хв тут — і потім заощадиш години на роботі. Питай у тимліда або у чаті команди якщо щось незрозуміло.</p>' +
        '</div>' +
        stepsHtml +
        '<div style="margin-top:24px;padding:18px 22px;background:#141414;border:1px solid #2a2a2a;border-radius:12px;font-size:12px;color:#888;">' +
          '<b style="color:#fff;">📞 Кому писати якщо застряг:</b><br>' +
          '• <b>Технічні питання</b> (баг у Tasks) → <a href="mailto:vg@abrisart.com" style="color:#FF6A7A;">vg@abrisart.com</a> або у TG-групі команди<br>' +
          '• <b>Hot keys + повний список команд бота</b> → у Tasks натисни <code>?</code> або відкрий <a href="https://team.dreamcar.ua/onboarding.html" target="_blank" style="color:#FF6A7A;">team.dreamcar.ua/onboarding.html</a><br>' +
          '• <b>HQ онбординг</b> (публікації, погодження) → <a href="https://team.dreamcar.ua/hq/#onboarding" target="_blank" style="color:#FF6A7A;">team.dreamcar.ua/hq/#onboarding</a>' +
        '</div>' +
      '</div>';

    document.body.appendChild(root);

    root.querySelectorAll('button[data-mark]').forEach(function (btn) {
      btn.onclick = async function () { await markStep(btn.dataset.mark); renderOnboarding(); renderBanner(); };
    });
    root.querySelectorAll('button[data-unmark]').forEach(function (btn) {
      btn.onclick = async function () { await unmarkStep(btn.dataset.unmark); renderOnboarding(); renderBanner(); };
    });
  }

  function hideOnboarding() {
    var view = document.getElementById('tonbView');
    if (view) view.remove();
    var board = document.querySelector('.kanban');
    if (board) board.style.display = '';
  }

  // ===== Route handler =====
  // 05.06.2026: aggressive retry бо state.publicUser може ще не бути готовим
  function maybeRoute() {
    if (location.hash === '#onboarding') {
      // Спробуй негайно, якщо me ще null — retry до 30 разів (9 сек)
      var tries = 0;
      function tryRender() {
        var me = getMe();
        if (me) { renderOnboarding(); return; }
        if (tries++ < 30) setTimeout(tryRender, 300);
        else {
          // Показуємо повідомлення помилки після 9 сек
          var board = document.querySelector('.kanban');
          if (board) board.style.display = 'none';
          var existing = document.getElementById('tonbView');
          if (existing) existing.remove();
          var root = document.createElement('div');
          root.id = 'tonbView';
          root.innerHTML = '<div class="tonb-view"><h1>⏳ Завантаження сесії…</h1><p style="color:#ccc;">Якщо це триває довше 10 сек — Cmd+Shift+R і залогінься знов через TG.</p></div>';
          document.body.appendChild(root);
        }
      }
      tryRender();
    } else {
      var view = document.getElementById('tonbView');
      if (view) view.remove();
      // Показати kanban знов
      var board = document.querySelector('.kanban');
      if (board) board.style.display = '';
    }
  }
  window.addEventListener('hashchange', maybeRoute);
  // Запустити одразу якщо #onboarding (на load сторінки з прямим лінком)
  if (location.hash === '#onboarding') setTimeout(maybeRoute, 100);

  // Додати chip у TOPBAR біля 📊 ANALYTICS (як HQ, окремо від фільтрів задач)
  // НЕ чекаємо auth — chip показуємо одразу як топбар є, прогрес update later
  function injectChip() {
    var topbarActions = document.getElementById('topbarActions');
    if (!topbarActions) return false;
    if (document.getElementById('onbBtn')) return true; // вже інжектований
    var me = getMe();
    var prog = me ? getProgress(me) : { done: 0, total: STEPS.length };
    var pctLabel = prog.done === prog.total && me ? '✓' : '(' + prog.done + '/' + prog.total + ')';

    // Desktop кнопка — поряд з ANALYTICS
    var btn = document.createElement('a');
    btn.id = 'onbBtn';
    btn.href = '#onboarding';
    btn.className = 'filter-btn desktop-only';
    btn.title = 'Онбординг Tasks — як користуватися системою';
    btn.style.cssText = 'border-color:#F59E0B;color:#FBBF24;font-weight:700;';
    btn.innerHTML = '🚀 ОНБОРДИНГ <span style="opacity:.7;font-weight:400;">' + pctLabel + '</span>';
    btn.addEventListener('click', function (e) { e.preventDefault(); location.hash = '#onboarding'; });

    // Вставити перед ANALYTICS
    var analyticsBtn = topbarActions.querySelector('a[href="/tasks/analytics.html"]');
    if (analyticsBtn) topbarActions.insertBefore(btn, analyticsBtn);
    else topbarActions.insertBefore(btn, topbarActions.firstChild);

    // Mobile drawer — додати пункт онбордінгу
    var drawer = document.getElementById('taskDrawer');
    if (drawer && !document.getElementById('drOnb')) {
      var drAnalytics = drawer.querySelector('a[href="/tasks/analytics.html"]');
      if (drAnalytics) {
        var drOnb = document.createElement('a');
        drOnb.id = 'drOnb';
        drOnb.className = 'dr-item';
        drOnb.href = '#onboarding';
        drOnb.innerHTML = '<span class="ico">🚀</span>Онбординг <span style="opacity:.6;margin-left:auto;font-size:11px;">' + pctLabel + '</span>';
        drAnalytics.parentNode.insertBefore(drOnb, drAnalytics);
      }
    }
    console.log('[tasks-onb] chip injected. me:', !!me, '· progress:', prog.done + '/' + prog.total);
    return true;
  }

  // Оновити label chip коли auth догрузиться (без re-injection)
  function refreshChipLabel() {
    var btn = document.getElementById('onbBtn');
    if (!btn) return;
    var me = getMe();
    if (!me) return;
    var prog = getProgress(me);
    var pctLabel = prog.done === prog.total ? '✓' : '(' + prog.done + '/' + prog.total + ')';
    btn.innerHTML = '🚀 ОНБОРДИНГ <span style="opacity:.7;font-weight:400;">' + pctLabel + '</span>';
  }

  // Aggressive retry — чекаємо ТІЛЬКИ topbar (НЕ me!), бо chip показуємо одразу
  var _initAttempts = 0;
  function init() {
    _initAttempts++;
    var topbar = document.getElementById('topbarActions');
    var hasChip = !!document.getElementById('onbBtn');
    console.log('[tasks-onb] init attempt', _initAttempts, '· topbar:', !!topbar, '· chip:', hasChip);
    if (topbar && !hasChip) {
      injectChip();
      maybeRenderBanner();
      if (location.hash === '#onboarding') renderOnboarding();
    } else if (hasChip) {
      refreshChipLabel(); // auth могла догрузитись, оновити прогрес
      maybeRenderBanner();
    }
    if (_initAttempts < 30) setTimeout(init, 1000); // продовжуємо щоб ловити refresh label
  }
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
  setTimeout(init, 500);
  setTimeout(init, 1500);
  setTimeout(init, 3000);

  // MutationObserver — якщо хтось видалив chip з topbar, інжектимо знову
  (function watchTopbar() {
    var topbar = document.getElementById('topbarActions');
    if (!topbar) { setTimeout(watchTopbar, 500); return; }
    var obs = new MutationObserver(function () {
      if (!document.getElementById('onbBtn')) injectChip();
    });
    obs.observe(topbar, { childList: true });
  })();

  // Hash route handler — окремо, гарантовано спрацьовує
  window.addEventListener('hashchange', function () {
    if (location.hash === '#onboarding') {
      var tries = 0;
      function tryRender() {
        if (getMe()) renderOnboarding();
        else if (tries++ < 20) setTimeout(tryRender, 300);
      }
      tryRender();
    } else {
      var view = document.getElementById('tonbView');
      if (view) view.remove();
      var board = document.querySelector('.kanban');
      if (board) board.style.display = '';
    }
  });

  window.renderTasksOnboarding = renderOnboarding;
  window.showTasksOnboarding = function () { location.hash = '#onboarding'; };
  console.log('%cDreamCar Tasks Onboarding v1.1 %c· 10 steps loaded · retry до 30 сек', 'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
