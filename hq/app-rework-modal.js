/* ============================================================
   DreamCar HQ — Structured Rework Feedback Modal (#122)
   ============================================================ */
// Замість browser prompt() — повноцінна модалка з checkbox-ами причин +
// textarea для деталей. Зберігається у history.detail як JSON, у comments
// як текст (backward compat). Render історії показує structured rework.

(function () {
  if (window.__hqReworkModal) return;
  window.__hqReworkModal = true;

  // ---- 9 категорій причин ----
  var REASONS = [
    { id: 'bad_text',     label: 'Поганий текст',           icon: '📝' },
    { id: 'bad_creative', label: 'Поганий креатив',         icon: '🖼️' },
    { id: 'wrong_time',   label: 'Неправильний час',        icon: '🕐' },
    { id: 'wrong_tone',   label: 'Не той бренд/тон',        icon: '🎯' },
    { id: 'missing_info', label: 'Не вистачає інформації',  icon: '📋' },
    { id: 'legal',        label: 'Юридичні питання',        icon: '⚖️' },
    { id: 'seo',          label: 'SEO/хештеги',             icon: '#️⃣' },
    { id: 'technical',    label: 'Технічне',                icon: '⚙️' },
    { id: 'other',        label: 'Інше',                    icon: '❓' },
  ];

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function safeStore() {
    try { return typeof Store !== 'undefined' ? Store : window.Store; }
    catch (_) { return window.Store; }
  }

  // ---- Build structured feedback → text для коментаря ----
  function buildFeedbackText(feedback) {
    var lines = [];
    if (feedback.reasons && feedback.reasons.length) {
      var labels = feedback.reasons.map(function (rid) {
        var r = REASONS.find(function (x) { return x.id === rid; });
        return r ? (r.icon + ' ' + r.label) : rid;
      });
      lines.push('Причини: ' + labels.join(' · '));
    }
    if (feedback.comment) lines.push('Деталі: ' + feedback.comment);
    return lines.join('\n\n') || 'Без коментаря';
  }

  // ---- Render structured feedback у HTML (для історії та коментарів) ----
  function renderFeedbackHtml(feedback) {
    var html = '';
    if (feedback.reasons && feedback.reasons.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0;">';
      feedback.reasons.forEach(function (rid) {
        var r = REASONS.find(function (x) { return x.id === rid; });
        html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:rgba(216,0,4,0.12);color:#ff8e8e;border:1px solid rgba(216,0,4,0.35);border-radius:4px;font-size:11px;font-weight:600;">' +
          (r ? (r.icon + ' ' + escHtml(r.label)) : escHtml(rid)) +
          '</span>';
      });
      html += '</div>';
    }
    if (feedback.comment) {
      html += '<div style="margin-top:6px;color:var(--bone,#dddddd);font-size:12px;line-height:1.5;background:rgba(255,255,255,0.03);padding:8px 10px;border-radius:6px;border-left:2px solid rgba(216,0,4,0.5);">💬 ' +
        escHtml(feedback.comment) +
        '</div>';
    }
    return html || '<span style="color:var(--grey);">Без причин</span>';
  }

  // ---- Open модалка ----
  window.HQ_openReworkModal = function (pub, callback) {
    // Cleanup existing
    var existing = document.getElementById('hq-rework-modal-backdrop');
    if (existing) existing.remove();

    var backdrop = document.createElement('div');
    backdrop.id = 'hq-rework-modal-backdrop';
    backdrop.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);' +
      'z-index:300;display:flex;align-items:center;justify-content:center;padding:20px;' +
      'animation:hq-rework-fade-in 0.15s ease;';

    // Add keyframes once
    if (!document.getElementById('hq-rework-keyframes')) {
      var kf = document.createElement('style');
      kf.id = 'hq-rework-keyframes';
      kf.textContent = '@keyframes hq-rework-fade-in{from{opacity:0}to{opacity:1}}' +
        '.hq-rework-reason-card{transition:all 0.15s;}' +
        '.hq-rework-reason-card:hover{border-color:#E30613 !important;background:rgba(216,0,4,0.05) !important;}' +
        '.hq-rework-reason-card input:checked + span{color:#fff;font-weight:700;}' +
        '.hq-rework-reason-card:has(input:checked){background:rgba(216,0,4,0.12) !important;border-color:#E30613 !important;}';
      document.head.appendChild(kf);
    }

    var reasonsHtml = REASONS.map(function (r) {
      return '<label class="hq-rework-reason-card" style="display:flex;align-items:center;gap:10px;padding:11px 13px;background:var(--bg,#0a0a12);border:1px solid var(--border,#232338);border-radius:8px;cursor:pointer;font-size:13px;color:#e8e8f0;">' +
        '<input type="checkbox" value="' + r.id + '" style="accent-color:#E30613;width:16px;height:16px;cursor:pointer;flex-shrink:0;"/>' +
        '<span style="line-height:1.3;">' + r.icon + ' ' + r.label + '</span>' +
      '</label>';
    }).join('');

    backdrop.innerHTML =
      '<div style="background:var(--bg-2,#11111a);border:1px solid var(--border,#232338);border-radius:14px;max-width:560px;width:100%;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 8px 24px rgba(0,0,0,0.4);">' +
        // Header
        '<div style="padding:20px 26px;border-bottom:1px solid var(--border,#232338);display:flex;align-items:center;gap:14px;flex-shrink:0;">' +
          '<h2 style="font-size:17px;font-weight:700;color:#fff;margin:0;">↩ Повернути на доопрацювання</h2>' +
          '<button id="hq-rework-close" style="margin-left:auto;background:transparent;border:1px solid var(--border,#232338);width:32px;height:32px;border-radius:8px;color:var(--grey,#8a8a99);font-size:18px;cursor:pointer;line-height:1;">×</button>' +
        '</div>' +
        // Body
        '<div style="padding:22px 26px;overflow-y:auto;flex:1;">' +
          '<div style="font-size:13px;color:var(--bone,#dddddd);margin-bottom:4px;">Пост: <strong style="color:#fff;">' + escHtml(pub.title || 'Без назви') + '</strong></div>' +
          '<div style="font-size:12px;color:var(--grey,#8a8a99);margin-bottom:18px;">Обери що саме треба переробити (можна декілька):</div>' +
          '<div id="hq-rework-reasons" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:22px;">' +
            reasonsHtml +
          '</div>' +
          '<div class="field">' +
            '<label style="display:block;font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey,#8a8a99);margin-bottom:8px;font-weight:700;">Деталі (опційно)</label>' +
            '<textarea id="hq-rework-comment" placeholder="Конкретно що переробити... Наприклад: «Фото в студії, треба emotion-фото у дорозі. Текст занадто формальний — додати драйв.»" style="width:100%;background:var(--bg,#0a0a12);border:1px solid var(--border,#232338);color:#fff;padding:11px 14px;border-radius:8px;font-size:13px;min-height:90px;font-family:inherit;resize:vertical;line-height:1.5;"></textarea>' +
            '<div id="hq-rework-hint" style="font-size:11px;color:var(--grey,#8a8a99);margin-top:6px;">Має бути обрана хоча б 1 причина <strong>або</strong> вказані деталі.</div>' +
          '</div>' +
        '</div>' +
        // Footer
        '<div style="padding:14px 26px;border-top:1px solid var(--border,#232338);display:flex;justify-content:flex-end;gap:8px;background:var(--bg,#0a0a12);flex-shrink:0;">' +
          '<button id="hq-rework-cancel" class="btn">Скасувати</button>' +
          '<button id="hq-rework-submit" class="btn btn-warn" disabled style="opacity:0.4;cursor:not-allowed;">↩ Повернути</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(backdrop);

    var submit = backdrop.querySelector('#hq-rework-submit');
    var cancel = backdrop.querySelector('#hq-rework-cancel');
    var closeBtn = backdrop.querySelector('#hq-rework-close');
    var comment = backdrop.querySelector('#hq-rework-comment');
    var hint = backdrop.querySelector('#hq-rework-hint');
    var checkboxes = backdrop.querySelectorAll('#hq-rework-reasons input[type="checkbox"]');

    function getCheckedReasons() {
      return Array.from(checkboxes).filter(function (cb) { return cb.checked; }).map(function (cb) { return cb.value; });
    }

    function updateSubmitState() {
      var reasons = getCheckedReasons();
      var commentText = comment.value.trim();
      var canSubmit = reasons.length > 0 || commentText.length > 0;
      submit.disabled = !canSubmit;
      submit.style.opacity = canSubmit ? '1' : '0.4';
      submit.style.cursor = canSubmit ? 'pointer' : 'not-allowed';
      // Hint update
      if (reasons.length > 0 && !commentText) {
        hint.innerHTML = '<span style="color:#6ee7b7;">✓ Обрано ' + reasons.length + ' причин(и). Деталі — опційно.</span>';
      } else if (commentText && reasons.length === 0) {
        hint.innerHTML = '<span style="color:#fbbf24;">⚠️ Деталі є, але без причин. Краще обери хоча б 1 категорію — це допоможе SMM-нику швидше зрозуміти.</span>';
      } else if (reasons.length > 0 && commentText) {
        hint.innerHTML = '<span style="color:#6ee7b7;">✓ ' + reasons.length + ' причин(и) + деталі. Ідеально.</span>';
      } else {
        hint.innerHTML = 'Має бути обрана хоча б 1 причина <strong>або</strong> вказані деталі.';
      }
    }

    checkboxes.forEach(function (cb) {
      cb.addEventListener('change', updateSubmitState);
    });
    comment.addEventListener('input', updateSubmitState);

    function close() { backdrop.remove(); }
    cancel.onclick = close;
    closeBtn.onclick = close;
    backdrop.onclick = function (e) { if (e.target === backdrop) close(); };

    // ESC щоб закрити
    function onKey(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    }
    document.addEventListener('keydown', onKey);

    submit.onclick = function () {
      if (submit.disabled) return;
      var feedback = {
        reasons: getCheckedReasons(),
        comment: comment.value.trim(),
        at: new Date().toISOString(),
      };
      close();
      document.removeEventListener('keydown', onKey);
      if (typeof callback === 'function') callback(feedback);
    };

    // Focus перший checkbox
    setTimeout(function () { if (checkboxes[0]) checkboxes[0].focus(); }, 100);
  };

  // Експортуємо helpers
  window.HQ_REWORK_REASONS = REASONS;
  window.HQ_buildReworkText = buildFeedbackText;
  window.HQ_renderReworkHtml = renderFeedbackHtml;

  // ---- Lock щоб запобігти подвійному submit ----
  var inFlight = false;

  // ---- Intercept clicks: rework у board та card ----
  document.addEventListener('click', function (e) {
    var rejectBtn = e.target && e.target.closest && e.target.closest('[data-action="reject"]');
    var reworkBtn = e.target && e.target.closest && e.target.closest('[data-transition="rework"]');
    var btn = rejectBtn || reworkBtn;
    if (!btn) return;

    if (inFlight) {
      if (typeof toast === 'function') toast('Зачекай', 'warn', 'Попередня дія ще зберігається');
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    var pubId;
    if (rejectBtn) {
      pubId = btn.dataset.id || (btn.closest('[data-id]') && btn.closest('[data-id]').dataset.id);
    } else if (reworkBtn) {
      var hash = (location.hash || '').slice(1);
      if (hash.indexOf('publication/') === 0) pubId = hash.split('/')[1];
      else if (window.__hqCurrentPub && window.__hqCurrentPub.id) pubId = window.__hqCurrentPub.id;
    }
    if (!pubId) return;

    var S = safeStore();
    var p = S && S.pub && S.pub(pubId);
    if (!p) return;

    // Permission check
    var me = S.currentUser && S.currentUser();
    if (!me) return;
    if (!(p.approvers || []).includes(me.id)) {
      if (typeof toast === 'function') toast('Доступ', 'error', 'Тільки погоджувач може повернути');
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    // Status check
    if (p.status !== 'review') {
      if (typeof toast === 'function') toast('Статус', 'warn', 'Можна повертати лише пости у статусі «На погодженні»');
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    // Перехоплюємо
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    window.HQ_openReworkModal(p, async function (feedback) {
      inFlight = true;
      var origBtnText = btn.textContent;
      if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Зберігаю...';
      }

      try {
        var feedbackText = buildFeedbackText(feedback);
        var feedbackJson = JSON.stringify(feedback);

        // Update pub status
        p.status = 'rework';
        p.updatedAt = new Date().toISOString();
        await S.upsertPub(p);

        // History — structured JSON у detail
        try {
          if (S.addHistory) await S.addHistory(p.id, 'reject', feedbackJson);
        } catch (err) { console.warn('addHistory:', err); }

        // Comment — текстова версія для backward compat
        try {
          if (S.addComment) await S.addComment(p.id, feedbackText);
        } catch (err) { console.warn('addComment:', err); }

        if (typeof toast === 'function') {
          toast('Повернено на доопрацювання', 'warn', p.title);
        }

        // Close current card modal якщо відкрита
        if (window.Modal && typeof window.Modal.close === 'function' && reworkBtn) {
          try { window.Modal.close(); } catch (_) {}
        }

        // Re-render board / current view
        setTimeout(function () {
          if (typeof window.navigate === 'function') {
            try { window.navigate(); } catch (_) {}
          }
        }, 200);
      } catch (err) {
        console.error('rework submit:', err);
        if (typeof toast === 'function') toast('Помилка', 'error', String(err.message || err));
      } finally {
        inFlight = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = origBtnText;
        }
      }
    });
  }, true);

  // ---- Patch renderHistoryTab — structured render для action=reject з JSON ----
  function patchHistoryRender() {
    if (typeof window.renderHistoryTab !== 'function') return false;
    if (window.renderHistoryTab.__hqStructured) return true;
    var _orig = window.renderHistoryTab;
    window.renderHistoryTab = function (p) {
      var html = _orig.call(this, p);
      try {
        var tmp = document.createElement('div');
        tmp.innerHTML = html;
        tmp.querySelectorAll('.history-item').forEach(function (item) {
          var detailEl = item.querySelector('.h-detail');
          if (!detailEl) return;
          var text = detailEl.textContent || '';
          // Якщо це JSON з reasons → structured render
          if (text.trim().startsWith('{') && text.indexOf('"reasons"') >= 0) {
            try {
              var fb = JSON.parse(text);
              if (fb && (Array.isArray(fb.reasons) || fb.comment)) {
                detailEl.innerHTML = renderFeedbackHtml(fb);
                detailEl.style.cssText = 'display:block;margin-top:6px;flex-basis:100%;';
              }
            } catch (_) {}
          }
        });
        return tmp.innerHTML;
      } catch (_) {
        return html;
      }
    };
    window.renderHistoryTab.__hqStructured = true;
    return true;
  }

  if (!patchHistoryRender()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (patchHistoryRender() || tries++ > 40) clearInterval(iv);
    }, 300);
  }

  if (window.DEBUG) console.log('%cDreamCar HQ Rework Modal %c· #122 structured feedback (9 reasons + details)',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
