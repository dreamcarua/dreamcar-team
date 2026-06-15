/* ============================================================
   DreamCar HQ — Autopost Status Indicator (#143)
   ============================================================ */
// Додає бейдж у картку публікації що показує стан автопостингу:
//   ⏳ В черзі / 🚀 Постимо / ✅ Опубліковано авто / ❌ Помилка
// + малий лічильник у sidebar "Проєкти": скільки pending у черзі

(function () {
  if (window.__hqAutopostStatus) return;
  window.__hqAutopostStatus = true;

  function safeStore() {
    try { return typeof Store !== 'undefined' ? Store : window.Store; }
    catch (_) { return window.Store; }
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  // Status presentation
  var STATUS_VIEW = {
    'pending':    { icon: '⏳', label: 'В черзі автопостингу',     color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
    'processing': { icon: '🚀', label: 'Постимо у TG…',            color: '#5a8fb8', bg: 'rgba(90,143,184,0.15)' },
    'done':       { icon: '✅', label: 'Опубліковано автоматично', color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
    'failed':     { icon: '❌', label: 'Помилка автопостингу',      color: '#E30613', bg: 'rgba(216,0,4,0.15)' },
    'skipped':    { icon: '⏭', label: 'Автопост пропущено',        color: '#888',    bg: 'rgba(255,255,255,0.05)' },
  };

  function renderBadge(status, error) {
    if (!status || !STATUS_VIEW[status]) return '';
    var v = STATUS_VIEW[status];
    var html =
      '<div id="hq-autopost-badge" style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:8px;background:' + v.bg + ';border:1px solid ' + v.color + '40;font-size:12px;color:' + v.color + ';font-weight:600;margin:8px 0;">' +
        '<span style="font-size:14px;">' + v.icon + '</span>' +
        '<span>' + v.label + '</span>' +
      '</div>';
    if (status === 'failed' && error) {
      html += '<div style="font-size:11px;color:#E30613;padding:4px 10px;margin-top:4px;background:rgba(216,0,4,0.08);border-radius:6px;font-family:JetBrains Mono,monospace;">⚠️ ' + escHtml(String(error).slice(0, 200)) + '</div>';
    }
    return html;
  }

  async function fetchAutopostState(pubId) {
    var sb = window.supabase;
    if (!sb || !pubId) return null;
    try {
      var { data, error } = await sb
        .from('publications')
        .select('autopost_status, autopost_error, tg_message_id')
        .eq('id', pubId)
        .maybeSingle();
      if (error) return null;
      return data;
    } catch (e) { return null; }
  }

  function locateMountPoint(modalEl) {
    // Шукаємо вгорі картки під заголовком/статусом — найкраще після першої вкладки чи статус-індикатора
    var statusRow = modalEl.querySelector('.status-bar, .pub-status, [data-pub-status]');
    if (statusRow && statusRow.parentNode) return { el: statusRow.parentNode, after: statusRow };
    // Інакше — перший .modal-body чи .modal-content
    var body = modalEl.querySelector('.modal-body, .pub-card-body');
    if (body) return { el: body, prepend: true };
    return null;
  }

  async function refreshBadge(modalEl, pubId) {
    var state = await fetchAutopostState(pubId);
    if (!state) return;

    var existing = modalEl.querySelector('#hq-autopost-badge-wrap');
    if (existing) existing.remove();

    if (!state.autopost_status) return; // Нема даних → не показуємо

    var wrap = document.createElement('div');
    wrap.id = 'hq-autopost-badge-wrap';
    wrap.innerHTML = renderBadge(state.autopost_status, state.autopost_error);

    // Якщо done + є tg_message_id — додаємо посилання
    if (state.autopost_status === 'done' && state.tg_message_id) {
      try {
        var t = typeof state.tg_message_id === 'string' ? JSON.parse(state.tg_message_id) : state.tg_message_id;
        var chatId = String(t.chat_id || '').replace('-100', '');
        var msgId = t.message_id;
        if (chatId && msgId) {
          var link = document.createElement('a');
          link.href = 'https://t.me/c/' + chatId + '/' + msgId;
          link.target = '_blank';
          link.style.cssText = 'display:inline-block;margin-left:10px;color:#22c55e;font-size:11px;text-decoration:underline;font-weight:600;';
          link.textContent = '→ Відкрити пост у TG';
          wrap.firstChild.appendChild(link);
        }
      } catch (_) {}
    }

    var mount = locateMountPoint(modalEl);
    if (!mount) return;
    if (mount.prepend) {
      mount.el.insertBefore(wrap, mount.el.firstChild);
    } else if (mount.after) {
      mount.after.parentNode.insertBefore(wrap, mount.after.nextSibling);
    } else {
      mount.el.appendChild(wrap);
    }
  }

  function getCurrentPubId() {
    var hash = (location.hash || '').slice(1);
    if (hash.indexOf('publication/') === 0) {
      return hash.split('/')[1];
    }
    if (window.__hqCurrentPub && window.__hqCurrentPub.id) {
      return window.__hqCurrentPub.id;
    }
    return null;
  }

  function watchModal() {
    var modalEl = document.querySelector('.modal-open, .pub-modal, [role="dialog"][aria-modal="true"]');
    if (!modalEl) return;

    var pubId = getCurrentPubId();
    if (!pubId) return;

    // Initial render
    refreshBadge(modalEl, pubId);

    // Poll every 10s якщо є autopost_status, інакше тільки 1 раз
    if (modalEl.__autopostInterval) return;
    modalEl.__autopostInterval = setInterval(function () {
      if (!document.body.contains(modalEl)) {
        clearInterval(modalEl.__autopostInterval);
        return;
      }
      refreshBadge(modalEl, pubId);
    }, 10000);
  }

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      clearTimeout(window.__hqAutopostMoTimer);
      window.__hqAutopostMoTimer = setTimeout(watchModal, 300);
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('hashchange', function () {
    setTimeout(watchModal, 500);
  });

  setTimeout(watchModal, 1000);
  setTimeout(watchModal, 3000);

  // Realtime subscription для оновлення status у відкритій картці
  function subscribeAutopostRT() {
    var sb = window.supabase;
    if (!sb || !sb.channel) { setTimeout(subscribeAutopostRT, 2000); return; }
    if (window.__hqAutopostRtChan) return;
    var chan = sb.channel('hq-autopost-status')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'publications' }, function (payload) {
        var newP = payload.new;
        if (!newP) return;
        if (newP.autopost_status !== (payload.old && payload.old.autopost_status)) {
          var pubId = getCurrentPubId();
          if (pubId === newP.id) {
            var modalEl = document.querySelector('.modal-open, .pub-modal, [role="dialog"][aria-modal="true"]');
            if (modalEl) refreshBadge(modalEl, pubId);
          }
        }
      })
      .subscribe();
    window.__hqAutopostRtChan = chan;
  }
  setTimeout(subscribeAutopostRT, 3000);

  console.log('%cDreamCar HQ Autopost Status %c· #143 polling + realtime',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
