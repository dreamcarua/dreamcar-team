/* ============================================================
   DreamCar HQ — Onboarding layout repair
   ============================================================ */
// BUG: у brand step (#3) HTML мав typo </div> замість </p>, що
// передчасно закривало .hq-onb-wrap. Через це кроки 4+ рендерилися
// як siblings #main замість дітей wrap'у і займали повну ширину.
// FIX: після рендеру переносимо стрей steps назад у .hq-onb-wrap.

(function () {
  if (window.__hqOnbLayoutFix) return;
  window.__hqOnbLayoutFix = true;

  function repair() {
    var main = document.getElementById('main');
    var wrap = main && main.querySelector('.hq-onb-wrap');
    if (!main || !wrap) return false;

    // Шукаємо siblings які мали б бути всередині wrap
    var moved = 0;
    var node = wrap.nextElementSibling;
    while (node) {
      var next = node.nextElementSibling;
      // .hq-onb-step або .hq-onb-links — все це має лежати у wrap
      if (node.classList && (node.classList.contains('hq-onb-step') || node.classList.contains('hq-onb-links') || (node.tagName === 'DIV' && /Кому писати/i.test(node.textContent || '')))) {
        wrap.appendChild(node);
        moved++;
      }
      node = next;
    }

    // Якщо є стрей .actions блок одразу після .desc у будь-якому step — перенесемо у середину
    wrap.querySelectorAll('.hq-onb-step').forEach(function (step) {
      var desc = step.querySelector(':scope > .desc');
      // Збираємо stray вузли між .desc та .actions (вони мали бути у .desc)
      if (!desc) return;
      var stray = [];
      var n = desc.nextElementSibling;
      while (n) {
        if (n.classList && n.classList.contains('actions')) break;
        stray.push(n);
        n = n.nextElementSibling;
      }
      // Якщо stray непорожній — повертаємо назад у .desc
      stray.forEach(function (el) { desc.appendChild(el); });
    });

    if (moved > 0) {
      console.log('%cDreamCar HQ Onb layout fix %c· repaired ' + moved + ' stray nodes', 'color:#fbbf24;font-weight:700;', 'color:#888;');
    }
    return moved > 0;
  }

  function maybeRepair() {
    var route = (location.hash || '').slice(1).split('/')[0];
    if (route !== 'onboarding') return;
    // Затримка щоб дочекатись renderOnboarding
    setTimeout(repair, 100);
    setTimeout(repair, 600);
    setTimeout(repair, 1500);
  }

  window.addEventListener('hashchange', maybeRepair);
  [600, 1500, 3000].forEach(function (ms) { setTimeout(maybeRepair, ms); });

  // Спостерігач за DOM — якщо onboarding перерендериться, виконуємо repair
  var mainEl = document.getElementById('main');
  if (mainEl && 'MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      var route = (location.hash || '').slice(1).split('/')[0];
      if (route === 'onboarding') {
        clearTimeout(window.__hqOnbRepairTimer);
        window.__hqOnbRepairTimer = setTimeout(repair, 80);
      }
    });
    mo.observe(mainEl, { childList: true, subtree: false });
  } else {
    setTimeout(function () {
      var me = document.getElementById('main');
      if (me && 'MutationObserver' in window) {
        var mo2 = new MutationObserver(function () {
          var route = (location.hash || '').slice(1).split('/')[0];
          if (route === 'onboarding') {
            clearTimeout(window.__hqOnbRepairTimer);
            window.__hqOnbRepairTimer = setTimeout(repair, 80);
          }
        });
        mo2.observe(me, { childList: true, subtree: false });
      }
    }, 1500);
  }

  console.log('%cDreamCar HQ Onb layout repair %c· installed', 'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
