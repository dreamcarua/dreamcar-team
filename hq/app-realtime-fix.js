/* ============================================================
   DreamCar HQ — Real-time updates без F5
   ============================================================ */
// 1) Onboarding markStep → одразу renderBanner + injectSidebar
// 2) publications UPDATE → якщо відкрита картка цього pub → оновити status у header
// 3) comments INSERT → додати у відкриту картку

(function () {
  if (window.__hqRealtimeFix) return;
  window.__hqRealtimeFix = true;

  function getModalIsOpen() {
    return document.getElementById('modalBackdrop')?.classList.contains('open');
  }

  // ---- 1. Patch _refreshAfterChange щоб НЕ скіпати коли модалка відкрита ----
  // Замість skip — робити incremental update для відкритої картки.
  function patchRefreshAfterChange() {
    if (!window.Store || typeof Store._refreshAfterChange !== 'function') return false;
    if (Store._refreshAfterChange.__rtFix) return true;
    var _orig = Store._refreshAfterChange.bind(Store);
    Store._refreshAfterChange = function () {
      // Debounce ту саму як було, але allow run навіть при open modal
      clearTimeout(this._refreshTimer);
      this._refreshTimer = setTimeout(async () => {
        var modalOpen = getModalIsOpen();
        await this._loadFromBackend();

        if (modalOpen && window.__hqCurrentPub) {
          // Особлива логіка: оновити поточну відкриту картку
          var fresh = Store.pub(window.__hqCurrentPub.id);
          if (fresh) {
            // Update поля у __hqCurrentPub без reset усього UI
            try {
              window.__hqCurrentPub.status = fresh.status;
              window.__hqCurrentPub.approved_by = fresh.approved_by;
              window.__hqCurrentPub.text = fresh.text;
              window.__hqCurrentPub.title = fresh.title;
              window.__hqCurrentPub.dateTime = fresh.dateTime;
              window.__hqCurrentPub.comments = fresh.comments;
            } catch (_) {}
            updateOpenCardStatus(fresh);
            updateOpenCardComments(fresh);
          }
        } else {
          // Звичайний flow — повний rerender
          if (typeof window.navigate === 'function') {
            try { window.navigate(); } catch (_) {}
          }
          if (typeof window.renderSidebarFilters === 'function') {
            try { window.renderSidebarFilters(); } catch (_) {}
          }
        }
        // Bell badge у будь-якому випадку
        if (typeof window.updateBellBadge === 'function') {
          try { window.updateBellBadge(); } catch (_) {}
        }
        if (typeof window.updateNavCounts === 'function') {
          try { window.updateNavCounts(); } catch (_) {}
        }
      }, 1000); // швидше за стандартні 1500
    };
    Store._refreshAfterChange.__rtFix = true;
    return true;
  }

  function updateOpenCardStatus(pub) {
    if (!pub) return;
    // У картці зазвичай рендериться <span class="status xxxxx">Label</span> у header
    var modal = document.getElementById('modal');
    if (!modal) return;
    var statusSpans = modal.querySelectorAll('.status, .modal-head .modal-meta');
    var STATUS_BY_ID = window.STATUS_BY_ID || {};
    var label = (STATUS_BY_ID[pub.status] && STATUS_BY_ID[pub.status].label) || pub.status;
    statusSpans.forEach(function (sp) {
      if (sp.classList.contains('status')) {
        // Заміняємо клас і текст
        sp.className = 'status ' + pub.status;
        sp.textContent = label;
      }
    });
    // Якщо була кнопка "Відправити на погодження" і pub.status вже approved — приховуємо
    var sendBtn = modal.querySelector('[data-action="send-review"], #send-to-review');
    if (sendBtn && (pub.status === 'approved' || pub.status === 'published')) {
      sendBtn.style.display = 'none';
    }
    // Toast про оновлення
    if (typeof toast === 'function') {
      toast('Статус оновлено', 'info', label);
    }
  }

  function updateOpenCardComments(pub) {
    if (!pub || !Array.isArray(pub.comments)) return;
    var modal = document.getElementById('modal');
    if (!modal) return;
    // Шукаємо контейнер коментарів
    var commentsArea = modal.querySelector('#commentsList, .comments-list, .comments-area');
    if (!commentsArea) return;
    // Знайдемо нові: ті які не у DOM по data-comment-id
    var existingIds = new Set(Array.from(commentsArea.querySelectorAll('[data-comment-id]'))
      .map(function (el) { return el.dataset.commentId; }));
    var newOnes = pub.comments.filter(function (c) { return !existingIds.has(c.id); });
    if (newOnes.length === 0) return;
    newOnes.forEach(function (c) {
      var user = (window.Store && Store.user && Store.user(c.author)) || {};
      var div = document.createElement('div');
      div.className = 'comment';
      div.dataset.commentId = c.id;
      var time = new Date(c.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
      div.innerHTML = '<div class="c-head"><span class="c-author">' + escapeHtmlSafe(user.name || '?') +
        '</span> <span class="c-time">' + time + '</span></div>' +
        '<div class="c-body">' + escapeHtmlSafe(c.body) + '</div>';
      commentsArea.appendChild(div);
    });
    if (typeof toast === 'function' && newOnes.length > 0) {
      toast('Новий коментар', 'info', newOnes[0].body.slice(0, 60));
    }
  }

  function escapeHtmlSafe(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }

  // ---- 2. Onboarding instant update ----
  // Перехоплюємо markStep — після нього викликаємо renderBanner + injectSidebar
  function patchOnboardingMarkStep() {
    // app-onboarding.js має внутрішню markStep але не export-ить її
    // Перехоплюємо клік на data-mark та data-unmark — після успіху викликаємо update.
    document.addEventListener('click', function (e) {
      var markBtn = e.target && e.target.closest && e.target.closest('[data-mark], [data-unmark]');
      if (!markBtn) return;
      // Чекаємо щоб оригінальний handler виконався, потім запускаємо update
      setTimeout(function () {
        try {
          // 1) Перерахуємо банер
          var banner = document.querySelector('.hq-onb-banner');
          if (banner) banner.remove();
          // 2) Перерахуємо sidebar
          var sidebarLink = document.querySelector('.sidebar a[data-route="onboarding"]');
          if (sidebarLink) {
            // Оновити count у sidebar
            var me = Store.currentUser && Store.currentUser();
            if (me && me.onboarding_steps) {
              var steps = Object.keys(me.onboarding_steps).filter(function (k) { return me.onboarding_steps[k]; });
              var STEP_TOTAL = 8;
              var count = sidebarLink.querySelector('.count');
              if (count) count.textContent = steps.length + '/' + STEP_TOTAL;
              if (steps.length === STEP_TOTAL) sidebarLink.remove();
            }
          }
        } catch (e) { console.warn('onboarding instant update:', e); }
      }, 600);
    }, true);
  }

  // ---- 3. Bell badge real-time refresh ----
  // Прив'язуємо до Supabase realtime — щоб counter оновився одразу при review
  function subscribeBellRefresh() {
    var sb = window.supabase;
    if (!sb || !sb.channel) return;
    if (window.__hqRtBellChan) return;
    var chan = sb.channel('hq-bell-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'publications' }, function () {
        setTimeout(function () {
          if (typeof window.updateBellBadge === 'function') updateBellBadge();
        }, 200);
      })
      .subscribe();
    window.__hqRtBellChan = chan;
  }

  // ---- Init з retry ----
  if (!patchRefreshAfterChange()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (patchRefreshAfterChange() || tries++ > 20) clearInterval(iv);
    }, 250);
  }

  patchOnboardingMarkStep();

  setTimeout(subscribeBellRefresh, 2000);
  setTimeout(subscribeBellRefresh, 5000);

  console.log('%cDreamCar HQ Real-time fix %c· refresh без F5 active',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
