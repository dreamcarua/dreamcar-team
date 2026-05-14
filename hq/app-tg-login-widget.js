/* ============================================================
   DreamCar HQ — Telegram Login Widget injection
   ============================================================ */
// Авто-інжект TG Login Widget на login screen якщо HQ_CONFIG.TG_BOT_USERNAME
// задано і BotFather має /setdomain для dreamcarua.github.io.
//
// Callback onTgAuth уже існує у app-tg-login.js — він приймає TG user object,
// викликає tg-login-verify Edge Function і ставить Supabase session.

(function () {
  if (window.__hqTgWidgetLoaded) return;
  window.__hqTgWidgetLoaded = true;

  function getBotUsername() {
    var cfg = window.HQ_CONFIG || {};
    return cfg.TG_LOGIN_BOT || cfg.TG_BOT_USERNAME || '';
  }

  function injectWidget() {
    var bot = getBotUsername();
    if (!bot) {
      console.log('TG Login Widget: TG_BOT_USERNAME не задано — пропускаю');
      return false;
    }
    var holder = document.getElementById('authTgWidget');
    var wrap = document.getElementById('authTgWrap');
    if (!holder || !wrap) return false;
    // Не перезавантажувати якщо вже є
    if (holder.querySelector('iframe, script[data-telegram-login]')) return true;

    // Очистити placeholder
    holder.innerHTML = '';

    // Telegram widget script — рендериться як кнопка/iframe
    // Параметри:
    //   data-telegram-login — bot username (без @)
    //   data-size — large | medium | small
    //   data-onauth — JS-функція що приймає user-object
    //   data-request-access — "write" якщо хочеш дозвіл на DM (опційно)
    //   data-userpic — false щоб приховати фото
    //   data-radius — radius кнопки
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', bot);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-onauth', 'onTgAuth(user)');
    s.setAttribute('data-request-access', 'write');
    s.setAttribute('data-radius', '10');
    holder.appendChild(s);

    // Показати блок
    wrap.style.display = 'block';

    // Info: якщо помилка з доменом, користувач побачить TG помилку у iframe
    setTimeout(function () {
      // Якщо через 4с TG iframe ще не з'явився — імовірно проблема з /setdomain
      if (!holder.querySelector('iframe')) {
        var hint = document.createElement('div');
        hint.style.cssText = 'margin-top:10px;font-size:11px;color:var(--grey);line-height:1.5;';
        hint.innerHTML = 'Якщо кнопка не з\'являється — переконайся що у <a href="https://t.me/BotFather" target="_blank" style="color:var(--red-soft);">@BotFather</a> виконана команда <code>/setdomain</code> → <b>dreamcarua.github.io</b> для бота <code>@' + bot + '</code>.';
        holder.appendChild(hint);
      }
    }, 4000);

    console.log('%cDreamCar HQ TG Login Widget %c· injected for @' + bot,
      'color:#0088cc;font-weight:700;', 'color:#888;');
    return true;
  }

  function tryInject() {
    if (injectWidget()) return;
    // Якщо login screen ще не показано — спробуємо коли він з'явиться
    var screen = document.getElementById('authScreen');
    if (screen && screen.classList.contains('shown')) {
      // Already shown but injection failed — try later
      setTimeout(tryInject, 800);
      return;
    }
    // Спостерігач на показ login screen
    if ('MutationObserver' in window && screen) {
      var mo = new MutationObserver(function () {
        if (screen.classList.contains('shown')) {
          setTimeout(injectWidget, 100);
        }
      });
      mo.observe(screen, { attributes: true, attributeFilter: ['class'] });
    }
  }

  // Запуск
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryInject);
  } else {
    tryInject();
  }
  // Retry safeguard
  [400, 1500, 3500].forEach(function (ms) { setTimeout(tryInject, ms); });

  console.log('%cDreamCar HQ TG Login Widget %c· installer ready',
    'color:#0088cc;font-weight:700;', 'color:#888;');
})();
