/* ============================================================
   DreamCar HQ — Orphan Drafts + UX fixes (Олександр 03.06.2026)
   ============================================================
   1) Не персистимо Untitled чорнетки у БД доки немає title
   2) При reload — default route #calendar (не залишатися на #publication/uuid)
   3) Показуємо «Створив: …» у overview / cardHead
   4) «📋 Зберегти як шаблон» — швидко зберегти поточну pub як шаблон
   ============================================================ */
(function () {
  if (window.__orphanDraftsFixLoaded) return;
  window.__orphanDraftsFixLoaded = true;

  /* ===== 1. Skip persistence для empty new drafts ===== */
  function wrapUpsertPub() {
    if (!window.Store || typeof Store.upsertPub !== 'function') { setTimeout(wrapUpsertPub, 300); return; }
    if (Store.upsertPub.__orphanGuard) return;
    var orig = Store.upsertPub.bind(Store);
    Store.upsertPub = function (pub) {
      // Skip backend persist for empty _isNew drafts
      if (pub && pub._isNew && (!pub.title || !pub.title.trim())) {
        // Тільки localStorage cache, не БД
        var ix = Store._data.publications.findIndex(function (p) { return p.id === pub.id; });
        if (ix >= 0) Store._data.publications[ix] = pub;
        else Store._data.publications.push(pub);
        return Promise.resolve();
      }
      return orig(pub);
    };
    Store.upsertPub.__orphanGuard = true;
  }

  /* ===== 2. Default route reset ТІЛЬКИ при reload (не при external link) ===== */
  // 🛡 FIX 03.06.2026 (Daniel login loop): раніше reset'или ЗАВЖДИ → клік з TG/закладки на #publication/uuid
  // перекидало на #calendar, а потім /tasks login → Google → SMM → знову #publication → loop.
  // Тепер: reset тільки якщо це reload (F5) і документ.referrer пустий.
  (function () {
    if (!location.hash || !location.hash.startsWith('#publication/')) return;
    var navEntry = (performance.getEntriesByType && performance.getEntriesByType('navigation') || [])[0];
    var isReload = navEntry && navEntry.type === 'reload';
    // Якщо це reload АБО навігація з історії (back/forward) — reset; інакше зовнішній клік → лишаємо
    if (isReload) {
      console.log('[orphan-drafts] reload detected on #publication — reset to #calendar');
      history.replaceState(null, '', location.pathname + location.search + '#calendar');
    }
  })();

  /* ===== 3. Cleanup orphan _isNew без title при переході на #calendar ===== */
  function cleanupOrphans() {
    if (!window.Store || !Store._data) return;
    var before = Store._data.publications.length;
    Store._data.publications = Store._data.publications.filter(function (p) {
      return !(p._isNew && (!p.title || !p.title.trim()));
    });
    var removed = before - Store._data.publications.length;
    if (removed > 0) {
      console.log('[orphan-cleanup] removed', removed, 'empty drafts from memory');
      try { Store._saveLocal && Store._saveLocal(); } catch (_) {}
    }
  }
  window.addEventListener('hashchange', function () {
    if (location.hash === '#calendar' || location.hash === '' || location.hash === '#') {
      cleanupOrphans();
    }
  });

  /* ===== 4. Created-by badge у overview/card header ===== */
  function injectCreatedByBadge() {
    var modal = document.getElementById('modal');
    if (!modal) return;
    var titleBar = modal.querySelector('.modal-head, .card-head, .pub-head, [data-card-head]');
    if (!titleBar) return;
    var idMatch = location.hash.match(/^#publication\/(.+)$/);
    if (!idMatch) return;
    if (titleBar.querySelector('.cb-created-by')) return;
    var pub = null;
    try { pub = Store.pub(idMatch[1]); } catch (_) {}
    if (!pub || !pub.history || !pub.history.length) return;
    var creator = (pub.history.find(function (h) { return h.action === 'create'; }) || {}).author;
    if (!creator) return;
    var u = (Store.users() || []).find(function (x) { return x.id === creator; });
    if (!u) return;
    var span = document.createElement('span');
    span.className = 'cb-created-by';
    span.style.cssText = 'font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--grey);letter-spacing:.05em;margin-left:12px;';
    span.textContent = 'Створив: ' + (u.name || u.email);
    titleBar.appendChild(span);
  }

  /* ===== 5. «Зберегти як шаблон» quick action ===== */
  function injectSaveAsTemplateBtn() {
    var modal = document.getElementById('modal');
    if (!modal) return;
    var actionsBar = modal.querySelector('.modal-actions, .card-actions, [data-actions]');
    if (!actionsBar) {
      // спробуємо знайти куди вставити — поряд з #btnDelete
      var del = modal.querySelector('#btnDelete');
      if (!del) return;
      actionsBar = del.parentNode;
    }
    if (actionsBar.querySelector('.btn-save-as-template')) return;
    var idMatch = location.hash.match(/^#publication\/(.+)$/);
    if (!idMatch) return;
    var btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-save-as-template';
    btn.style.cssText = 'background:transparent;border:1px solid var(--border);color:#fff;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;margin-right:8px;';
    btn.innerHTML = '📋 Зберегти як шаблон';
    btn.onclick = async function () {
      var p = null;
      try { p = Store.pub(idMatch[1]); } catch (_) {}
      if (!p) { window.toast && toast('Публікація не знайдена', 'error'); return; }
      if (!p.title) { window.toast && toast('Назва порожня — додай перш ніж зберігати шаблон', 'warn'); return; }
      var tplName = prompt('Назва шаблону:', p.title);
      if (!tplName) return;
      var tpl = {
        id: 'tpl_' + Date.now(),
        name: tplName,
        title: p.title,
        text: p.text || '',
        contentType: p.contentType,
        platforms: p.platforms || [],
        rubric: p.rubric || null,
        launch: p.launch || null,
        approverPolicy: p.approverPolicy || 'all',
        approvers: p.approvers || [],
      };
      // Зберігаємо у localStorage hq-templates (sync з app-templates.js якщо є)
      try {
        var raw = localStorage.getItem('hq-templates');
        var arr = raw ? JSON.parse(raw) : [];
        arr.push(tpl);
        localStorage.setItem('hq-templates', JSON.stringify(arr));
        // Якщо є supabase templates table — теж insert
        if (window.supabase && window.HQ_BACKEND) {
          try {
            await window.supabase.from('publication_templates').insert({
              name: tpl.name,
              title: tpl.title,
              text_body: tpl.text,
              content_type: tpl.contentType,
              platforms: tpl.platforms,
              rubric_id: tpl.rubric,
              created_by: Store._data.currentUserId
            });
          } catch (e) { console.warn('[template-save backend skipped]', e.message); }
        }
        window.toast && toast('Шаблон збережено: ' + tpl.name, 'success');
      } catch (e) {
        console.error('[save-as-template]', e);
        window.toast && toast('Помилка: ' + e.message, 'error');
      }
    };
    actionsBar.insertBefore(btn, actionsBar.firstChild);
  }

  /* ===== Observer щоб реагувати на open modal ===== */
  var observer = new MutationObserver(function () {
    if (location.hash.startsWith('#publication/')) {
      setTimeout(function () {
        injectCreatedByBadge();
        injectSaveAsTemplateBtn();
      }, 80);
    }
  });

  function init() {
    wrapUpsertPub();
    cleanupOrphans();
    var m = document.getElementById('modal');
    if (m) observer.observe(m, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(init, 800);
  setTimeout(init, 2500);

  // Періодичний cleanup кожні 30 сек — safety net
  setInterval(cleanupOrphans, 30000);
})();
