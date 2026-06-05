/* ============================================================
   DreamCar HQ — Onboarding checklist (#9) v2 — Full training
   ============================================================ */
// Кожен крок — повноцінна міні-лекція з прикладами і посиланнями.

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
      '.hq-onb-banner { background: linear-gradient(90deg, rgba(216,0,4,0.15), rgba(255,106,31,0.05)); border-bottom: 1px solid var(--red); padding: 10px 28px; display: flex; align-items: center; gap: 12px; font-size: 13px; color: #fff; grid-column: 1 / -1; position: relative; z-index: 5; }' +
      '@media (max-width: 900px) { .hq-onb-banner { display: none !important; } }' +
      '.hq-onb-banner .hob-icon { font-size: 18px; }' +
      '.hq-onb-banner .hob-progress { flex: 1; background: rgba(255,255,255,0.1); height: 8px; border-radius: 4px; overflow: hidden; max-width: 220px; margin-left: auto; }' +
      '.hq-onb-banner .hob-progress-fill { height: 100%; background: var(--brand-grad); border-radius: 4px; transition: width 0.3s; }' +
      '.hq-onb-banner a, .hq-onb-banner button { color: #fff; background: var(--red); border: none; padding: 5px 12px; border-radius: 6px; font-size: 12px; font-weight: 700; text-decoration: none; cursor: pointer; }' +
      '.hq-onb-banner button.dismiss { background: transparent; color: var(--grey); padding: 5px 8px; }' +
      '.hq-onb-wrap { padding: 28px 32px; max-width: 820px; margin: 0 auto; }' +
      '.hq-onb-wrap h1 { font-size: 26px; font-weight: 900; color: #fff; margin-bottom: 8px; text-transform: uppercase; letter-spacing: -0.01em; }' +
      '.hq-onb-step { padding: 20px 22px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 14px; transition: border-color 0.15s; }' +
      '.hq-onb-step.done { border-color: var(--green); background: linear-gradient(135deg, rgba(74,222,128,0.04), transparent); }' +
      '.hq-onb-step .head { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }' +
      '.hq-onb-step .check { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--border-2); display: flex; align-items: center; justify-content: center; font-size: 14px; }' +
      '.hq-onb-step.done .check { background: var(--green); border-color: var(--green); color: #042814; font-weight: 800; }' +
      '.hq-onb-step .title { color: #fff; font-weight: 800; font-size: 15px; flex: 1; }' +
      '.hq-onb-step .desc { color: #ccc; font-size: 13px; line-height: 1.65; padding-left: 42px; }' +
      '.hq-onb-step .desc p { margin: 0 0 10px 0; }' +
      '.hq-onb-step .desc ul, .hq-onb-step .desc ol { margin: 0 0 10px 22px; padding: 0; color: #bbb; }' +
      '.hq-onb-step .desc ul li, .hq-onb-step .desc ol li { margin-bottom: 4px; }' +
      '.hq-onb-step .desc a { color: var(--red-soft); border-bottom: 1px dashed var(--red); }' +
      '.hq-onb-step .desc code { background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; font-size: 12px; color: var(--gold); font-family: ui-monospace, monospace; }' +
      '.hq-onb-step .desc .good { color: var(--green-soft); }' +
      '.hq-onb-step .desc .bad { color: var(--red-soft); }' +
      '.hq-onb-step .desc .why { background: rgba(216,0,4,0.06); border-left: 3px solid var(--red); padding: 8px 12px; border-radius: 0 6px 6px 0; margin-bottom: 12px; font-size: 12px; color: #ddd; }' +
      '.hq-onb-step .desc .tip { background: rgba(74,222,128,0.06); border-left: 3px solid var(--green); padding: 8px 12px; border-radius: 0 6px 6px 0; margin-top: 10px; font-size: 12px; color: #ddd; }' +
      '.hq-onb-step .desc .warning { background: rgba(251,191,36,0.08); border-left: 3px solid var(--gold); padding: 8px 12px; border-radius: 0 6px 6px 0; margin-top: 10px; font-size: 12px; color: #ddd; }' +
      '.hq-onb-step .actions { display: flex; gap: 8px; flex-wrap: wrap; padding-left: 42px; margin-top: 14px; }' +
      '.hq-onb-step .actions button, .hq-onb-step .actions a { padding: 8px 14px; font-size: 12px; background: var(--bg-3); color: #ddd; border: 1px solid var(--border); border-radius: 6px; cursor: pointer; text-decoration: none; font-weight: 600; }' +
      '.hq-onb-step .actions button.primary { background: var(--red); color: #fff; border-color: var(--red); }' +
      '.hq-onb-step .actions a.outline { background: transparent; }' +
      '.hq-onb-summary { padding: 22px 26px; background: linear-gradient(135deg, rgba(216,0,4,0.08), transparent); border: 1px solid rgba(216,0,4,0.3); border-radius: 14px; margin-bottom: 22px; }' +
      '.hq-onb-summary .label { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--grey); margin-bottom: 6px; }' +
      '.hq-onb-summary .pct { font-size: 38px; font-weight: 900; color: var(--red-soft); }' +
      '.hq-onb-summary p { color: var(--grey); font-size: 12px; margin-top: 10px; line-height: 1.5; }' +
      '.hq-onb-links { padding: 18px 22px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 12px; margin-top: 20px; }' +
      '.hq-onb-links h3 { color: #fff; font-size: 13px; font-weight: 800; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 1px; }' +
      '.hq-onb-links a { display: block; padding: 8px 10px; color: #ddd; text-decoration: none; border-radius: 6px; font-size: 13px; }' +
      '.hq-onb-links a:hover { background: var(--bg-3); color: var(--red-soft); }' +
      '.hq-onb-links a b { color: #fff; }';
    document.head.appendChild(css);
  })();

  var STEPS = [
    {
      key: 'login',
      title: '👋 Залогінений через Google',
      desc:
        '<div class="why">✓ <b>Готово.</b> Якщо ти бачиш цю сторінку — у тебе вже є доступ. У HQ працює Google OAuth з whitelist: тільки члени команди можуть зайти. Service-role JWT тут ніхто не зберігає — все через Row-Level Security в Postgres.</div>' +
        '<p>Якщо хтось з команди не може залогінитись — порадь йому натиснути «Запросити доступ» на сторінці логіну. Засновники отримають заявку у TG.</p>',
      auto: function () { return true; },
    },

    {
      key: 'tg',
      title: '📱 Привʼязати Telegram (критично)',
      desc:
        '<div class="why"><b>Чому це КРИТИЧНО:</b> 80% активної роботи у HQ — через TG-бот. Без привʼязки ти не отримаєш сповіщень, не зможеш одним кліком погоджувати, не отримаєш ранкові digest.</div>' +
        '<p><b>Що ти отримаєш після привʼязки:</b></p>' +
        '<ul>' +
          '<li>📲 <b>Inline-кнопки</b> у груповому чаті — погоджуєш постом одним тапом, не відкриваючи HQ</li>' +
          '<li>☀️ <b>Особистий digest</b> щоранку о 08:00 Kyiv — твої active, queue на погодження, дедлайни</li>' +
          '<li>🔥 <b>Time-based нагадування</b> — за 2 дні до публікації, якщо текст/креатив не готові; через 24 год review — re-ping; через 48 год — ескалація іншому засновнику</li>' +
          '<li>📤 <b>Завантаження файлів у DM боту</b> — кидаєш фото/відео у <a href="https://t.me/dreamcar_team_bot" target="_blank">@dreamcar_team_bot</a> і воно автоматично потрапляє у Бібліотеку креативів</li>' +
          '<li>⚙️ <b>Команди</b>: <code>/today</code> <code>/queue</code> <code>/late</code> <code>/my</code> <code>/approve</code></li>' +
        '</ul>' +
        '<p><b>Як привʼязати (30 секунд):</b></p>' +
        '<ol>' +
          '<li>Перейди у <a href="#settings">⚙️ Налаштування</a></li>' +
          '<li>Знайди блок <b>«✈️ Швидка привʼязка через бот»</b></li>' +
          '<li>Натисни кнопку → відкриється @dreamcar_team_bot з готовим deep-link</li>' +
          '<li>У боті натисни <b>Start</b> → chat_id привʼяжеться автоматично</li>' +
        '</ol>' +
        '<div class="tip"><b>💡 Перевірка:</b> Коли привʼязка успішна — побачиш у <a href="#settings">Налаштуваннях</a> заповнене поле <code>tg_chat_id</code> і отримаєш від бота повідомлення «Привʼязка успішна».</div>',
      auto: function (me) { return !!(me && me.tg_chat_id); },
      action: { label: '⚙ Перейти в Налаштування', href: '#settings' },
    },

    {
      key: 'brand',
      title: '🎨 DreamCar Brand Voice — ОБОВʼЯЗКОВО',
      desc:
        '<div class="why"><b>Чому це найважливіше:</b> DreamCar — юридично делікатна сфера. Одне неправильне слово у пості → ризик претензій від ДПС/Мінфіну. SMM — перша лінія захисту бренду і компанії.</div>' +
        '<p><b>📖 Повна brand bible:</b> <a href="https://brand.dreamcar.ua" target="_blank"><b>brand.dreamcar.ua</b></a> — відкрий <u>зараз</u> у новій вкладці і прочитай від першої до останньої сторінки. Це 20-30 хвилин. Без цього неможливо писати пости.</div>' +
        '<p><b>🚫 СУВОРО ЗАБОРОНЕНІ слова</b> (юридичний ризик):</p>' +
        '<ul>' +
          '<li class="bad"><s>лотерея</s>, <s>розіграш</s>, <s>приз</s>, <s>квиток</s> — це юридичні терміни, які прирівнюють нас до lottery operator (потрібна ліцензія, якої у нас немає)</li>' +
          '<li class="bad"><s>шанс</s>, <s>виграти</s>, <s>виграш</s> — імплікація випадкового виграшу, юридично проблемно</li>' +
          '<li class="bad"><s>гарантуємо</s>, <s>точно отримаєш</s>, <s>зобовʼязуємось</s> — обіцянки результату заборонені (consumer protection)</li>' +
          '<li class="bad"><s>акція</s> у значенні «купи і отримай авто» — стандарт «безкоштовний приз при покупці» теж під ризиком</li>' +
        '</ul>' +
        '<p><b>✓ ВЗАМІН — наша офіційна термінологія:</b></p>' +
        '<ul>' +
          '<li class="good"><b>«учасники DreamCar»</b> — люди, що купили AI-токени і користуються сервісом</li>' +
          '<li class="good"><b>«AI-токени»</b>, <b>«AI-сервіс»</b> — це ПРОДУКТ, який вони реально купляють</li>' +
          '<li class="good"><b>«спільнота DreamCar»</b> — наш community</li>' +
          '<li class="good"><b>«отримати авто»</b>, <b>«стати власником»</b>, <b>«авто переїхало до...»</b> — результат для одного з активних учасників</li>' +
          '<li class="good"><b>«нагорода»</b>, <b>«бонус за активність»</b> — допустимо у м\'яких контекстах</li>' +
          '<li class="good"><b>«серед активних учасників знаходиться той, хто...»</b> — стандартна нейтральна формула</li>' +
        '</ul>' +
        '<p><b>📝 Приклади постів — порівняй:</b></p>' +
        '<p class="good">✓ <b>«Audi e-tron уже в гаражі переможця цього сезону. Спільнота +1500 учасників за квартал. Дякуємо що з нами.»</b></p>' +
        '<p class="good">✓ <b>«100 грн = 50 AI-токенів + можливість отримати авто. Інтегруй розум у щоденну роботу, а DreamCar пам\'ятає про найактивніших.»</b></p>' +
        '<p class="bad">✗ <b>«Виграй Audi! Приз чекає тебе! Купляй квитки лотереї!»</b> — НІЯКОЛИ так не пиши.</p>' +
        '<p class="bad">✗ <b>«Гарантуємо що серед 100 переможців ти точно...»</b> — НІ.</p>' +
        '<p><b>📐 Тональні стандарти:</b></p>' +
        '<ul>' +
          '<li>Тон: натхненний, людяний, без hype. Говоримо про мрію, спільноту, реальність нагороди.</li>' +
          '<li>Звертання — на <b>«ти»</b>, не на «ви». Це спільнота, не корпорація.</li>' +
          '<li>Українська мова. Уникай канцеляризмів. Короткі речення.</li>' +
          '<li>Емодзі — помірно (1-3 на пост), не зловживай.</li>' +
          '<li>Хештеги: <code>#DreamCar</code>, <code>#СпільнотаDreamCar</code>, <code>#AIсервіс</code>, <code>#АвтоМрії</code></li>' +
        '</ul>' +
        '<div class="tip"><b>💡 Tip:</b> AI копірайтер (кнопка ✨ AI у картці) вже знає всі ці правила. Якщо AI відмовляється написати «продажніше» — він стримує тон свідомо, бо інакше порушив би brand rules.</div>' +
        '<div class="warning"><b>⚠️ Контрольний список перед публікацією:</b> Чи немає заборонених слів? Чи звертаюсь на «ти»? Чи є фокус на AI-токени/спільноту, а не на «приз»? Чи нема обіцянок гарантії?</div>',
      actionLabel: '✓ Прочитав brand.dreamcar.ua і запамʼятав правила',
      manual: true,
      action: { label: '📖 Відкрити brand.dreamcar.ua', href: 'https://brand.dreamcar.ua', external: true },
    },

    {
      key: 'templates',
      title: '📋 Шаблони публікацій — економлять години',
      desc:
        '<div class="why"><b>Чому це працює:</b> 80% постів повторюються структурно (анонс переможця, новий запуск, експертний пост, UGC). Замість заповнювати 8 полів картки щоразу — натискаєш «📋 З шаблону» → 80% полів автоматично.</div>' +
        '<p><b>4 готових шаблони (керівники команди можуть додавати свої у Налаштуваннях):</b></p>' +
        '<ul>' +
          '<li>🏆 <b>Анонс переможця</b> — IG+TG+FB о 20:00, тон playful, hashtags <code>#Переможець</code></li>' +
          '<li>🚗 <b>Новий запуск авто</b> — IG+TG+FB+TT о 12:00, тон salesy, contentType=carousel</li>' +
          '<li>🤖 <b>Експертний пост про AI</b> — TG+Threads о 14:00, тон expert, length=long</li>' +
          '<li>📸 <b>Сторіз — UGC</b> — IG only, тон casual, length=short, contentType=story</li>' +
        '</ul>' +
        '<p><b>Як використовувати:</b></p>' +
        '<ol>' +
          '<li>У <a href="#calendar">Календарі</a> натисни <b>«+ Нова публікація»</b> (або просто клацни на день)</li>' +
          '<li>У картці біля поля <b>«Назва»</b> побачиш кнопку <b>«📋 З шаблону»</b></li>' +
          '<li>Тиць → modal з 4 шаблонами → клацни на потрібний</li>' +
          '<li>Платформи, час, тон, hashtags, contentType — все заповниться</li>' +
          '<li>Тобі залишається тільки: написати <b>назву поста</b> та <b>текст</b> (або одразу натиснути <b>✨ AI</b>)</li>' +
        '</ol>' +
        '<div class="tip"><b>💡 Tip:</b> Шаблон — це <b>стартова точка</b>, не догма. Завжди можеш змінити час, додати/прибрати платформу, поправити hashtags після застосування.</div>' +
        '<p><b>Якщо ти лід команди:</b> у <a href="#settings">Налаштуваннях</a> можеш створити кастомний шаблон (напр. «Колаборація з партнером», «Вітання з днем народження учасника») і поділитися з командою.</p>',
      actionLabel: '✓ Спробував шаблон у новій публікації',
      manual: true,
      action: { label: '📅 Перейти у Календар', href: '#calendar' },
    },

    {
      key: 'ai',
      title: '✨ AI копірайт (Claude Sonnet) — твій новий копірайтер',
      desc:
        '<div class="why"><b>Чому це гра-чейнджер:</b> ~80% часу SMM витрачає на текст. AI генерує draft за 5 секунд із вже вшитим brand voice DreamCar + ЦА з опитування 999 учасників. Кошт: ~$0.01 за пост (≈₴0.30).</div>' +
        '<p><b>Що AI вже знає (без додаткових налаштувань):</b></p>' +
        '<ul>' +
          '<li>Заборонені слова (лотерея, розіграш, приз...) — НІКОЛИ не використає</li>' +
          '<li>Brand tone DreamCar — натхненний, на «ти», людяний</li>' +
          '<li>ЦА: чоловіки 28-45, цікавляться авто/AI/тех, з опитування 999 учасників</li>' +
          '<li>Платформа-специфіку (IG — 5-10 hashtags, TG — HTML-розмітка, TikTok — короткий хук)</li>' +
        '</ul>' +
        '<p><b>Як користуватись:</b></p>' +
        '<ol>' +
          '<li>Відкрий будь-яку публікацію (або створи нову)</li>' +
          '<li>Біля поля <b>«Текст»</b> побачиш фіолетову кнопку <b>«✨ AI»</b></li>' +
          '<li>Modal: напиши <b>brief</b> (про що пост), обери платформу/тон/довжину</li>' +
          '<li>Натисни <b>«Згенерувати»</b> → за 3-7 сек отримаєш текст + хештеги + CTA</li>' +
          '<li>Якщо не сподобалось → <b>«↻ Регенерувати»</b>. Якщо ок → <b>«✓ Вставити у поле»</b></li>' +
        '</ol>' +
        '<p><b>Приклади brief (короткі):</b></p>' +
        '<ul>' +
          '<li><i>«Сьогодні переможець Audi e-tron поїхав додому. Спільнота +1500 за сезон.»</i></li>' +
          '<li><i>«Новий сезон стартує — авто Porsche Cayman, ціна входу 100 грн.»</i></li>' +
          '<li><i>«Інтерв\'ю з переможцем 16-го сезону — хто він, що сказав, як використовує AI.»</i></li>' +
        '</ul>' +
        '<div class="tip"><b>💡 Tips:</b><br>• Тон <b>«грайливо»</b> — для UGC і community-постів<br>• Тон <b>«експертно»</b> — для постів про AI на TG/Threads<br>• Тон <b>«продажно»</b> — для launch і retention постів<br>• Довжина <b>«коротко»</b> для TikTok/Stories, <b>«довго»</b> для TG-каналу</div>' +
        '<div class="warning"><b>⚠️ Що залишається людині:</b> AI пише draft, але <b>фінальний штрих — твій</b>. Перевір факти (числа, дати, імена). Додай специфічну деталь що AI не знав. Особливо уважно з посиланнями — AI може вигадати неіснуючий URL.</div>',
      actionLabel: '✓ Згенерував пост через AI і подивився результат',
      manual: true,
      action: { label: '📅 Створити публікацію + спробувати AI', href: '#calendar' },
    },

    {
      key: 'firstpost',
      title: '✍️ Створи першу публікацію (без страху)',
      desc:
        '<div class="why"><b>Не страшно:</b> у HQ є undo (7 секунд після видалення), soft-delete (30 днів у кошику), auto-save кожні 700ms — нічого не зникне.</div>' +
        '<p><b>Покроковий workflow:</b></p>' +
        '<ol>' +
          '<li>У <a href="#calendar">Календарі</a> клацни на будь-який день <b>або</b> натисни <b>«+ Нова публікація»</b> у топі</li>' +
          '<li>Відкриється картка з порожніми полями. Натисни <b>«📋 З шаблону»</b> щоб одразу 80% заповнити</li>' +
          '<li>Або заповни вручну: <b>Назва</b> (для внутрішнього контексту), <b>Дата і час</b>, <b>Платформи</b> (chips), <b>Текст</b> (тут <b>✨ AI</b> допоможе)</li>' +
          '<li>Натисни <b>Зберегти</b> — статус автоматично стане <b>Чернетка</b></li>' +
          '<li>Працюй над постом ітеративно — auto-save увімкнено, побачиш «💾 Збережено» зверху</li>' +
        '</ol>' +
        '<p><b>Корисні фічі при роботі з карткою:</b></p>' +
        '<ul>' +
          '<li><b>Drag-drop креатив</b> прямо з папки → потрапляє у Бібліотеку і прикріплюється до публікації</li>' +
          '<li><b>Прев\'ю</b> справа — побачиш як пост виглядатиме на IG, TG, TikTok, YT, FB, Threads</li>' +
          '<li><b>Дублювати</b> (📋 у footer) — копія публікації для серії постів</li>' +
          '<li><b>Коментарі</b> унизу — обговорюй з командою прямо у картці</li>' +
          '<li><b>Авто-дедлайн</b> ставиться за 2 дні до публікації</li>' +
        '</ul>' +
        '<div class="tip"><b>💡 Перевірка:</b> Після збереження побачиш свою публікацію у календарі. Цей крок чек-листа сам автоматично закриється.</div>',
      auto: function (me) {
        var s = getStore();
        if (!s || !me) return false;
        var pubs = (s.pubs && s.pubs()) || [];
        return pubs.some(function (p) { return p && (p.createdBy === me.id || (p.responsibles || []).indexOf(me.id) >= 0); });
      },
    },

    {
      key: 'workflow',
      title: '🔄 Workflow погодження (хто що робить)',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Без розуміння статусів — пости застрягають. Тимлід/CEO повинні точно знати що від них треба і коли.</div>' +
        '<p><b>6 статусів публікації:</b></p>' +
        '<ul>' +
          '<li>📝 <b>Чернетка</b> — щойно створено, доступ тільки автору. Текст і креативи редагуються.</li>' +
          '<li>⚙️ <b>В роботі</b> — копірайтер/дизайнер працюють. Видимий усій команді.</li>' +
          '<li>👀 <b>На погодженні</b> — чекає на ✓ від CEO/COO. <b>SLA = 24 год</b>, після якого піде нагадування погоджувачам. У дошці погоджень видно <b>таймер</b>.</li>' +
          '<li>✅ <b>Погоджено</b> — готово до публікації. Контент заморожено від змін без зміни статусу назад.</li>' +
          '<li>↩️ <b>Доопрацювання</b> — повернуто з коментарем. Автор виправляє і повертає у «На погодженні».</li>' +
          '<li>🚀 <b>Опубліковано</b> — після фактичної публікації у соцмережах SMM ставить вручну.</li>' +
        '</ul>' +
        '<p><b>Хто що може:</b></p>' +
        '<table style="width:100%;font-size:12px;border-collapse:collapse;margin:8px 0;">' +
          '<tr style="border-bottom:1px solid var(--border);color:var(--grey);"><th style="text-align:left;padding:6px;">Дія</th><th style="padding:6px;">SMM</th><th style="padding:6px;">Lead</th><th style="padding:6px;">CEO/COO</th></tr>' +
          '<tr><td style="padding:6px;">Створити чернетку</td><td style="text-align:center;">✓</td><td style="text-align:center;">✓</td><td style="text-align:center;">✓</td></tr>' +
          '<tr><td style="padding:6px;">Відправити на погодження</td><td style="text-align:center;">✓</td><td style="text-align:center;">✓</td><td style="text-align:center;">✓</td></tr>' +
          '<tr><td style="padding:6px;">Погодити (review→approved)</td><td style="text-align:center;">—</td><td style="text-align:center;">—</td><td style="text-align:center;color:var(--green);">✓</td></tr>' +
          '<tr><td style="padding:6px;">Повернути на доопрац.</td><td style="text-align:center;">—</td><td style="text-align:center;">—</td><td style="text-align:center;color:var(--orange);">✓</td></tr>' +
          '<tr><td style="padding:6px;">Видалити чужі пости</td><td style="text-align:center;">—</td><td style="text-align:center;">✓</td><td style="text-align:center;">✓</td></tr>' +
        '</table>' +
        '<p><b>Як швидко погодити (для CEO/COO):</b></p>' +
        '<ul>' +
          '<li>Коли пост іде у «На погодженні» — ти отримуєш <b>TG-повідомлення з 2 кнопками</b>: ✓ Погодити / ↩ Повернути</li>' +
          '<li>Тапнув ✓ → статус автоматично оновлюється у HQ + appears у dashboard</li>' +
          '<li>Без необхідності відкривати HQ — економить 1-2 хв на пост</li>' +
        '</ul>' +
        '<p><b>SLA таймер:</b> Кожна публікація у <a href="#board">Дошці погоджень</a> показує <b>«⏱ N год»</b>: до 12 год — сірий, 12-24 год — жовтий, &gt;24 — червоний з пульсацією. Якщо &gt;48 год — приходить ескалація іншому засновнику.</p>',
      actionLabel: '✓ Зрозумів workflow і ролі',
      manual: true,
      action: { label: '✅ Глянути дошку погоджень', href: '#board' },
    },

    {
      key: 'overview',
      title: '🗺 Орієнтація по розділах',
      desc:
        '<p><b>📅 Календар</b> — головний робочий простір. Тут весь контент-план.</p>' +
        '<ul>' +
          '<li>4 режими: <b>Місяць</b> (огляд), <b>Тиждень</b>, <b>День</b>, <b>Список</b> (для bulk-операцій)</li>' +
          '<li>Hot keys: <code>1</code> Місяць · <code>2</code> Тиждень · <code>3</code> День · <code>4</code> Список</li>' +
          '<li>Drag-drop публікацій між днями</li>' +
          '<li>Правий клік на дні → контекстне меню з пресетами часу</li>' +
          '<li>Фільтри зліва (статус, платформа) і зверху (chips платформ)</li>' +
        '</ul>' +
        '<p><b>✅ Дошка погоджень</b> — все що чекає на твоє рішення.</p>' +
        '<ul>' +
          '<li>3 колонки: «На моє погодження», «Я відправив», «Повернуто»</li>' +
          '<li>SLA таймер на кожній картці (червоне = SLA порушено)</li>' +
          '<li>Дії: ✓ Погодити, ↩ Повернути (з обовʼязковим коментарем)</li>' +
        '</ul>' +
        '<p><b>🖼 Бібліотека креативів</b> — усі фото/відео/документи команди.</p>' +
        '<ul>' +
          '<li>Drag-drop файлів у будь-яке місце сторінки → завантажує у Supabase Storage</li>' +
          '<li>Файли &gt;50 MB → автоматично через Google Drive (resumable upload)</li>' +
          '<li>Lightbox для перегляду, фільтри по типу, пошук по тегах</li>' +
          '<li>Прикріплення креатива до публікації — drag-drop або через picker</li>' +
        '</ul>' +
        '<p><b>📊 Аналітика</b> — KPI команди.</p>' +
        '<ul>' +
          '<li>7 cards: Всього публікацій, Через HQ, Погоджено, Пропущено, Avg time-to-approve, На погодженні, Креативи</li>' +
          '<li>Графік: публікації × платформа × місяць (останні 6 міс)</li>' +
          '<li>Топ виконавців</li>' +
          '<li>Метрики пілота за <a href="https://github.com/dreamcarua/dreamcar-team/blob/main/hq-smm.html#s13" target="_blank">ТЗ §13.2</a></li>' +
        '</ul>' +
        '<p><b>🚀 Запуски</b> — групування публікацій по проєктах (BMW X5, Audi e-tron, тощо).</p>' +
        '<p><b>⚙️ Налаштування</b> — твій профіль.</p>' +
        '<ul>' +
          '<li>TG привʼязка (deep-link)</li>' +
          '<li>🌴 Vacation mode (auto-delegation коли ти у відпустці)</li>' +
          '<li>📋 Шаблони (для CEO/COO/lead)</li>' +
          '<li>Push-нотифікації (Phase 2)</li>' +
        '</ul>' +
        '<p><b>🔥 Корисні гарячі клавіші</b> — натисни <code>?</code> для повного списку.</p>' +
        '<ul>' +
          '<li><code>C</code> — створити нову публікацію</li>' +
          '<li><code>/</code> — фокус на глобальний пошук</li>' +
          '<li><code>Esc</code> — закрити модалку</li>' +
        '</ul>' +
        '<div class="tip"><b>💡 Tip:</b> У глобальному пошуку (зверху) ти можеш шукати по <b>тексту публікацій, hashtags, навіть коментарях</b> — через Postgres tsvector + GIN. Швидко навіть на 1000+ постів.</div>',
      actionLabel: '✓ Подивився всі розділи',
      manual: true,
      action: { label: '📅 Почати з Календаря', href: '#calendar' },
    },

    {
      key: 'next_action',
      title: '👀 «Зараз хід» — як передавати роботу',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Щоб не було «хто наступний?» і пост не висів між сценаристом і дизайнером 2 дні. Кожна публікація має одну поточну дію і одну відповідальну людину.</div>' +
        '<p>У картці публікації блок <b>«Зараз хід»</b> показує:</p>' +
        '<ul>' +
          '<li><b>Хто наступний</b> — аватарка з ім\'ям</li>' +
          '<li><b>Тип роботи</b> з emoji (8 варіантів): ✍️ Сценарій · 🎬 Відео · 🎨 Дизайн · 📝 Копі · 👀 Перегляд · ✏️ Доопрацювати · ✅ Погодити · 🔄 Інше</li>' +
          '<li><b>Опціональна нотатка</b> від попереднього виконавця</li>' +
        '</ul>' +
        '<p><b>Як передати:</b></p>' +
        '<ol>' +
          '<li>Закінчив свою частину (сценарій / дизайн / копірайт)</li>' +
          '<li>Клацни кнопку <b>«🤝 Передати»</b> у блоці «Зараз хід»</li>' +
          '<li>Обери виконавця зі списку команди</li>' +
          '<li>Обери тип роботи (з 8 emoji)</li>' +
          '<li>Опціонально — нотатка («Уточни шрифти», «Перевір факти», «Зменши до 280 симв.»)</li>' +
          '<li>Save → виконавець одразу отримує TG DM з твоєю нотаткою</li>' +
        '</ol>' +
        '<p><b>TG нотифікація:</b> «{Ім\'я} передав тобі {🎨 Дизайн}: {Назва pub}<br>"{Твоя нотатка}"<br>[👀 Відкрити у HQ]»</p>' +
        '<div class="tip">💡 Це <b>НЕ заміна approvers</b> — це передача роботи всередині workflow до того як піде на погодження. Approvers все ще ставлять ✅/↩ окремо.</div>' +
        '<div class="warn">⚠️ Дедуп: якщо хтось reload-ить HQ — повторне сповіщення НЕ прилетить (5-хв guard).</div>',
      actionLabel: '✓ Зрозумів як передавати',
      manual: true,
    },

    {
      key: 'trash',
      title: '🗑 Корзина — 30 днів на роздуми',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Якщо випадково видалив публікацію або хтось видалив твою без причини — можна повернути протягом 30 днів. Більше не "видалив = втратив".</div>' +
        '<p><b>Хто може видалити публікацію:</b></p>' +
        '<ul>' +
          '<li><b>Автор</b> (хто створив) — завжди</li>' +
          '<li><b>CEO / COO</b> — може все, включно з чужими</li>' +
          '<li><b>Member / Lead</b> — НЕ можуть видаляти чужі публікації. Toast "Видалити може тільки автор або CEO/COO"</li>' +
        '</ul>' +
        '<p><b>Як видалити:</b> у HQ → відкрий публікацію → 🗑 кнопка → з\'явиться модалка з 3 кнопками:</p>' +
        '<ul>' +
          '<li style="list-style:none;color:#FF6A7A;">🗑 <b>ВИДАЛИТИ НАЗАВЖДИ</b> — тільки CEO/COO. Корзини НЕ буде. Двоступенева підтвердження «точно?»</li>' +
          '<li style="list-style:none;color:#FBBF24;">📦 <b>ПЕРЕМІСТИТИ В КОРЗИНУ</b> — 30 днів, можна відновити</li>' +
          '<li style="list-style:none;">✕ <b>СКАСУВАТИ</b> — Esc теж закриває</li>' +
        '</ul>' +
        '<p><b>Де знайти корзину:</b> у sidebar посилання <b>🗑 Корзина (N)</b> (число — скільки публікацій у корзині).</p>' +
        '<p><b>У корзині бачиш:</b></p>' +
        '<ul>' +
          '<li><b>Назва</b> публікації</li>' +
          '<li><b>Хто видалив</b> (кожен бачить — щоб не сваритись хто прибрав чужу роботу)</li>' +
          '<li><b>Коли</b> та <b>скільки днів залишилось</b> до автоматичного hard-видалення (≤3 дні — червоний, ≤7 — жовтий, >7 — сірий)</li>' +
          '<li><b>↩ Відновити</b> — повертає на board (тільки автор/CEO/COO/той хто видалив)</li>' +
          '<li><b>🗑</b> — purge назавжди (тільки автор/CEO/COO)</li>' +
        '</ul>' +
        '<div class="tip">💡 <b>CEO/COO бачать ВСІ</b> видалені публікації команди — щоб контролювати хто видаляє чужу роботу. Інші ролі — лише свої.</div>' +
        '<div class="warn">⚠️ Через 30 днів — hard delete через cron job. Без можливості відновлення.</div>' +
        '<p><b>Те ж саме у Tasks</b> — chip <code>🗑 КОРЗИНА (N)</code> у меню фільтрів задач. Логіка прав ідентична.</p>',
      actionLabel: '✓ Знаю де корзина і як відновити',
      manual: true,
    },

    {
      key: 'theme',
      title: '🎨 Світла / темна тема',
      desc:
        '<p>Якщо тобі важко працювати у темному режимі — клацни іконку <b>🌙 / ☀️</b> у топбарі.</p>' +
        '<ul>' +
          '<li>Тема <b>зберігається у браузері</b> — не треба перемикати кожного разу</li>' +
          '<li><b>Синхронізується між HQ + Tasks + Dashboard</b> — обираєш у одному, інші теж стають світлими/темними</li>' +
          '<li><b>Синхронізується між вкладками</b> — відкрив HQ + Tasks паралельно → перемкнув → обидва оновились</li>' +
        '</ul>' +
        '<p>Так само на <a href="https://team.dreamcar.ua/tasks" target="_blank">Tasks</a> і <a href="https://dashboard.dreamcar.ua" target="_blank">Dashboard</a>.</p>',
      actionLabel: '✓ Знаю де перемкнути тему',
      manual: true,
    },

    {
      key: 'tg_buttons',
      title: '🔘 TG бот — inline кнопки під сповіщеннями',
      desc:
        '<div class="why"><b>Чому це важливо:</b> Не треба відкривати HQ щоб погодити пост або позначити задачу — все робиться 1 кліком у Telegram прямо під повідомленням.</div>' +
        '<p><b>Під задачею</b> (Tasks):</p>' +
        '<ul>' +
          '<li>✅ <b>Готово</b> — статус → done. У повідомленні з\'явиться «✅ Виконано · {Твоє ім\'я} · 15:35»</li>' +
          '<li>▶ <b>В роботу</b> — статус → doing</li>' +
          '<li>👀 <b>Відкрити у браузері</b> — <b>1 клік</b> відкриває задачу. Раніше показувало URL текстом, треба було копіювати-вставити</li>' +
        '</ul>' +
        '<p><b>Під публікацією на погодженні</b> (HQ):</p>' +
        '<ul>' +
          '<li>✅ <b>Погодити</b> — одразу approved</li>' +
          '<li>↩ <b>Повернути</b> — двокроковий: причина → confirm. SMM отримує DM з причиною. У Tasks автоматично створюється rework задача.</li>' +
          '<li>💬 <b>Коментар</b> — додати коментар без зміни статусу</li>' +
          '<li>👀 <b>Відкрити у HQ</b> — 1 клік → браузер</li>' +
        '</ul>' +
        '<p><b>Під передачею роботи</b> (Next Action):</p>' +
        '<ul>' +
          '<li>👀 <b>Відкрити у HQ</b> — побачиш всю публікацію + нотатку від попереднього виконавця</li>' +
        '</ul>' +
        '<div class="tip">💡 <b>Дедуплікація:</b> якщо хтось reload-ить HQ — ти НЕ отримаєш повторне сповіщення на той самий статус. Server-side throttle 5 хв на одну публікацію.</div>',
      actionLabel: '✓ Знаю про inline кнопки',
      manual: true,
    },
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

    var stepsHtml = STEPS.map(function (st, idx) {
      var done = prog.steps[st.key];
      var actionsHtml = '';
      var btns = [];
      if (st.action) {
        if (st.action.external) {
          btns.push('<a href="' + st.action.href + '" target="_blank" rel="noopener">' + escapeHtml(st.action.label) + ' ↗</a>');
        } else {
          btns.push('<a href="' + st.action.href + '">' + escapeHtml(st.action.label) + '</a>');
        }
      }
      if (st.manual && !done) {
        btns.push('<button class="primary" data-mark="' + st.key + '">' + escapeHtml(st.actionLabel || '✓ Готово') + '</button>');
      }
      if (st.manual && done) {
        btns.push('<button data-unmark="' + st.key + '" style="background:transparent;color:var(--grey);">↶ Скинути</button>');
      }
      if (btns.length) actionsHtml = '<div class="actions">' + btns.join('') + '</div>';

      return '<div class="hq-onb-step ' + (done ? 'done' : '') + '" data-key="' + st.key + '">' +
        '<div class="head">' +
          '<div class="check">' + (done ? '✓' : (idx + 1)) + '</div>' +
          '<div class="title">' + st.title + '</div>' +
        '</div>' +
        '<div class="desc">' + st.desc + '</div>' +
        actionsHtml +
      '</div>';
    }).join('');

    root.innerHTML =
      '<div class="view-header"><h1>🚀 Онбординг</h1><span class="view-meta">· ' + prog.done + ' з ' + prog.total + ' кроків</span></div>' +
      '<div class="hq-onb-wrap">' +
        '<div class="hq-onb-summary">' +
          '<div class="label">Прогрес навчання</div>' +
          '<div class="pct">' + pct + '%</div>' +
          '<div style="margin-top:10px;background:rgba(255,255,255,0.06);height:10px;border-radius:5px;overflow:hidden;">' +
            '<div style="height:100%;background:var(--brand-grad);width:' + pct + '%;transition:width 0.3s;"></div>' +
          '</div>' +
          '<p>Це не формальність — це навчання. Кожен крок це міні-лекція з прикладами і посиланнями. Витрать 30-40 хв тут — і потім будеш заощаджувати години на роботі. Якщо щось незрозуміло — питай у тимліда або у чаті команди.</p>' +
        '</div>' +
        stepsHtml +
        '<div class="hq-onb-links">' +
          '<h3>📚 Корисні посилання</h3>' +
          '<a href="https://brand.dreamcar.ua" target="_blank"><b>brand.dreamcar.ua</b> — повний DreamCar brand bible ↗</a>' +
          '<a href="https://dreamcar.ua" target="_blank"><b>dreamcar.ua</b> — основний сайт продукту ↗</a>' +
          '<a href="https://etron.dreamcar.ua" target="_blank"><b>etron.dreamcar.ua</b> — поточний сезон Audi e-tron #18 ↗</a>' +
          '<a href="https://t.me/dreamcar_team_bot" target="_blank"><b>@dreamcar_team_bot</b> — наш TG-бот ↗</a>' +
          '<a href="https://github.com/dreamcarua/dreamcar-team/blob/main/hq-smm.html" target="_blank"><b>ТЗ HQ v1.1</b> — повне технічне завдання ↗</a>' +
          '<a href="https://github.com/dreamcarua/dreamcar-team/blob/main/hq/AUDIT.md" target="_blank"><b>AUDIT.md</b> — статус реалізації фіч ↗</a>' +
        '</div>' +
        '<div style="margin-top:24px;padding:18px 22px;background:var(--bg-2);border:1px solid var(--border);border-radius:12px;font-size:12px;color:var(--grey);">' +
          '<b style="color:#fff;">📞 Кому писати якщо застряг:</b><br>' +
          '• <b>Технічні питання</b> (баг у HQ, не працює фіча) → <a href="mailto:vg@dreamcar.ua">vg@dreamcar.ua</a> або у TG-групі команди<br>' +
          '• <b>Питання по контенту і brand</b> → <a href="mailto:vg@abrisart.com">Vadym</a> (CEO) або тимлід SMM<br>' +
          '• <b>Доступ до додаткових інструментів</b> (Canva, Figma, OBS) → тимлід SMM' +
        '</div>' +
      '</div>';

    root.querySelectorAll('button[data-mark]').forEach(function (btn) {
      btn.onclick = async function () {
        await markStep(btn.dataset.mark);
        renderOnboarding(root);
        renderBanner();
      };
    });
    root.querySelectorAll('button[data-unmark]').forEach(function (btn) {
      btn.onclick = async function () {
        var me = getMe();
        if (!me) return;
        var stored = me.onboarding_steps || {};
        delete stored[btn.dataset.unmark];
        me.onboarding_steps = stored;
        if (window.HQ_BACKEND && window.supabase) {
          try {
            await window.supabase.from('users').update({
              onboarding_steps: stored,
              onboarding_completed_at: null,
            }).eq('id', me.id);
          } catch (e) { console.warn('onb unmark err:', e); }
        }
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

  console.log('%cDreamCar HQ Onboarding v2 %c· full training ready', 'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
