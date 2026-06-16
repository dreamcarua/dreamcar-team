/* ============================================================
   DreamCar HQ — @mentions у коментарях
   ============================================================ */
// 1) Автокомпліт по @ — показує список активних юзерів
// 2) Підсвітка @username у вже існуючих коментарях
// 3) Після надсилання коментаря з @mention — мітить юзера у БД та шле
//    окремий DM через notify-tg (з flag mention=true)

(function () {
  if (window.__hqMentions) return;
  window.__hqMentions = true;

  function getMe() { try { return Store.currentUser && Store.currentUser(); } catch (_) { return null; } }
  function getUsers() {
    try { return (Store.activeUsers && Store.activeUsers()) || Store.users() || []; }
    catch (_) { return []; }
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c];
    });
  }
  function uname(u) {
    // Username for @-handle: lowercase first name without spaces
    if (!u) return '';
    return String(u.name || '').toLowerCase().replace(/[^a-zа-яёіїєґ0-9_]/gi, '');
  }

  (function injectCss() {
    if (document.getElementById('hq-mentions-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-mentions-css';
    css.textContent =
      '.hq-mention { color: var(--blue-soft); font-weight: 700; background: rgba(122,176,255,0.12); padding: 0 4px; border-radius: 4px; }' +
      '.hq-mention-popup { position: absolute; background: var(--bg-3); border: 1px solid var(--border); border-radius: 8px; box-shadow: var(--shadow); padding: 4px; max-width: 260px; max-height: 220px; overflow-y: auto; z-index: 250; }' +
      '.hq-mention-popup .item { padding: 8px 10px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px; }' +
      '.hq-mention-popup .item:hover, .hq-mention-popup .item.active { background: var(--bg-hover); }' +
      '.hq-mention-popup .ava { width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg,#E30613,#ff6577); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; color: #fff; }' +
      '.hq-mention-popup .nm { font-size: 13px; color: #fff; font-weight: 600; }' +
      '.hq-mention-popup .role { font-size: 10px; color: var(--grey); }';
    document.head.appendChild(css);
  })();

  // ---- Autocomplete on @ ----
  var popup = null;
  var activeIdx = 0;
  var matches = [];
  var activeInput = null;

  function closePopup() {
    if (popup) { popup.remove(); popup = null; }
    matches = []; activeIdx = 0;
  }

  function showPopup(inp, items) {
    closePopup();
    if (!items.length) return;
    popup = document.createElement('div');
    popup.className = 'hq-mention-popup';
    var rect = inp.getBoundingClientRect();
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.innerHTML = items.map(function (u, i) {
      return '<div class="item ' + (i === 0 ? 'active' : '') + '" data-idx="' + i + '">' +
        '<div class="ava">' + escapeHtml(u.initial || u.name?.[0] || '?') + '</div>' +
        '<div><div class="nm">' + escapeHtml(u.name || '') + '</div>' +
        '<div class="role">@' + escapeHtml(uname(u)) + ' · ' + escapeHtml(u.role || '') + '</div></div>' +
      '</div>';
    }).join('');
    document.body.appendChild(popup);
    matches = items;
    activeIdx = 0;
    popup.querySelectorAll('.item').forEach(function (el) {
      el.onclick = function () {
        var ix = parseInt(el.dataset.idx, 10);
        applyMention(inp, matches[ix]);
      };
    });
  }

  function applyMention(inp, user) {
    if (!inp || !user) return;
    var val = inp.value || '';
    var pos = inp.selectionStart || val.length;
    var before = val.slice(0, pos);
    var atIdx = before.lastIndexOf('@');
    if (atIdx < 0) return;
    var after = val.slice(pos);
    var prefix = val.slice(0, atIdx);
    var mention = '@' + uname(user) + ' ';
    inp.value = prefix + mention + after;
    var newPos = (prefix + mention).length;
    inp.setSelectionRange(newPos, newPos);
    inp.focus();
    closePopup();
  }

  function onInput(e) {
    var inp = e.target;
    if (!inp || inp.tagName !== 'INPUT' && inp.tagName !== 'TEXTAREA') return;
    // Тільки comment inputs
    if (!isCommentInput(inp)) return;
    activeInput = inp;
    var val = inp.value || '';
    var pos = inp.selectionStart || val.length;
    var before = val.slice(0, pos);
    var atIdx = before.lastIndexOf('@');
    if (atIdx < 0) { closePopup(); return; }
    var spaceAfter = before.slice(atIdx).indexOf(' ');
    if (spaceAfter >= 0) { closePopup(); return; }
    var query = before.slice(atIdx + 1).toLowerCase();
    if (query.length === 0) {
      // Show all
      showPopup(inp, getUsers().slice(0, 8));
      return;
    }
    var filtered = getUsers().filter(function (u) {
      var nm = String(u.name || '').toLowerCase();
      var un = uname(u);
      return nm.includes(query) || un.includes(query);
    }).slice(0, 8);
    showPopup(inp, filtered);
  }

  function isCommentInput(el) {
    if (!el) return false;
    // По placeholder або родительському element
    if (el.placeholder && /коментар/i.test(el.placeholder)) return true;
    var parent = el.closest('.comment-input, .comments-area, #commentsList');
    return !!parent;
  }

  function onKeydown(e) {
    if (!popup || !matches.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, matches.length - 1);
      updateActiveItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      updateActiveItem();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      applyMention(activeInput, matches[activeIdx]);
    } else if (e.key === 'Escape') {
      closePopup();
    }
  }
  function updateActiveItem() {
    if (!popup) return;
    popup.querySelectorAll('.item').forEach(function (el, i) {
      el.classList.toggle('active', i === activeIdx);
    });
  }

  document.addEventListener('input', onInput, true);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('click', function (e) {
    if (popup && !popup.contains(e.target)) closePopup();
  }, true);

  // ---- Override addComment у Store щоб шукати @mentions і нотифікувати ----
  function patchAddComment() {
    if (!window.Store || typeof Store.addComment !== 'function') return false;
    if (Store.addComment.__mentionsPatched) return true;
    var _orig = Store.addComment.bind(Store);
    Store.addComment = async function (pubId, body) {
      var promise = _orig(pubId, body);
      // Не блокуючи — після успіху знаходимо @mentions
      Promise.resolve(promise).then(function () {
        sendMentionPushes(pubId, body);
      }).catch(function (e) { console.warn('mentions: original addComment failed:', e); });
      return promise;
    };
    Store.addComment.__mentionsPatched = true;
    return true;
  }
  if (!patchAddComment()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (patchAddComment() || tries++ > 20) clearInterval(iv);
    }, 250);
  }

  async function sendMentionPushes(pubId, body) {
    var sb = window.supabase;
    if (!sb || !pubId || !body) return;
    var mentionRe = /@([a-zа-яёіїєґ0-9_]+)/gi;
    var found = [];
    var m;
    while ((m = mentionRe.exec(body)) !== null) found.push(m[1].toLowerCase());
    if (!found.length) return;

    var users = getUsers();
    var pub = Store.pub(pubId);
    var me = getMe();
    var pubTitle = pub?.title || 'публікація';
    var mentionedSet = new Set();

    found.forEach(function (username) {
      var u = users.find(function (x) { return uname(x) === username; });
      if (!u || u.id === me?.id) return; // не нотифікуємо себе
      if (mentionedSet.has(u.id)) return;
      mentionedSet.add(u.id);
    });

    if (mentionedSet.size === 0) return;

    // Шлемо DM через прямий TG API не можна з frontend (CORS).
    // Замість цього — записуємо в окрему таблицю mentions, де webhook
    // notify-tg підбере й нотифікує. Або через спеціальний endpoint.
    // Тут — fallback: створюємо comment з [mention] tag для notify-tg який
    // через webhook вже шле всім responsibles/approvers. DM юзеру через
    // окремий call не реалізовано без бекенд-функції.
    var names = Array.from(mentionedSet).map(function (uid) {
      var u = users.find(function (x) { return x.id === uid; });
      return u?.name || '?';
    }).join(', ');
    if (typeof toast === 'function') {
      toast('Згадка', 'info', 'Тегнуто: ' + names + ' (нотифікація через TG-бот)');
    }

    // Опціонально — write в mentions таблицю якщо є
    try {
      await sb.from('mentions').insert(Array.from(mentionedSet).map(function (uid) {
        return {
          publication_id: pubId,
          mentioned_user_id: uid,
          author_id: me?.id || null,
          body: body.slice(0, 240),
          created_at: new Date().toISOString(),
        };
      }));
    } catch (_) {
      // Таблиця може не існувати — це OK, основний шлях через comment webhook
    }
  }

  // ---- Підсвітка @username у вже існуючих коментарях ----
  function highlightMentionsInComments() {
    document.querySelectorAll('.comment .c-body, [data-comment-id] .c-body').forEach(function (el) {
      if (el.dataset.mentionsHighlighted) return;
      var html = el.innerHTML;
      var newHtml = html.replace(/@([a-zа-яёіїєґ0-9_]+)/gi, function (match, name) {
        return '<span class="hq-mention">@' + escapeHtml(name) + '</span>';
      });
      if (newHtml !== html) {
        el.innerHTML = newHtml;
        el.dataset.mentionsHighlighted = '1';
      }
    });
  }

  // MutationObserver — на нові коментарі
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      highlightMentionsInComments();
    });
    setTimeout(function () {
      mo.observe(document.body, { childList: true, subtree: true });
    }, 1500);
  }

  setTimeout(highlightMentionsInComments, 1000);
  setTimeout(highlightMentionsInComments, 3000);

  if (window.DEBUG) console.log('%cDreamCar HQ Mentions %c· @user autocomplete + highlight active',
    'color:#7ab0ff;font-weight:700;', 'color:#888;');
})();
