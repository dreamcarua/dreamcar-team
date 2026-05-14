/* ============================================================
   DreamCar HQ — Multi-approver AND logic
   ============================================================ */
// Перехоплює клік на data-action="approve" (board view) ТА
// data-transition="approved" (card modal) і викликає Postgres RPC
// `register_approval` яка:
//  - додає юзера у approved_by[]
//  - якщо policy='all' і всі approvers погодили → status='approved'
//  - якщо policy='any' і хоч один → status='approved'
//  - інакше залишає 'review' і повертає прогрес X/Y.

(function () {
  if (window.__hqMultiApprover) return;
  window.__hqMultiApprover = true;

  async function registerApproval(pubId) {
    if (!window.HQ_BACKEND || !window.supabase) {
      if (typeof toast === 'function') toast('Backend off', 'warn', 'У demo-режимі multi-approver не активний');
      return null;
    }
    var me = Store.currentUser && Store.currentUser();
    if (!me || !me.id) {
      if (typeof toast === 'function') toast('Не визначено користувача', 'error');
      return null;
    }
    try {
      var resp = await window.supabase.rpc('register_approval', {
        pub_id: pubId, by_user: me.id,
      });
      if (resp.error) {
        console.error('register_approval err:', resp.error);
        if (typeof toast === 'function') toast('Помилка', 'error', resp.error.message || 'RPC failed');
        return null;
      }
      var data = resp.data || {};
      if (!data.ok) {
        if (typeof toast === 'function') toast('Не пройшло', 'warn', data.error || 'невідома помилка');
        return data;
      }
      // Update local Store optimistically
      try {
        var p = Store.pub(pubId);
        if (p) {
          p.approved_by = data.approved_by || [];
          p.status = data.status;
        }
      } catch (_) {}

      if (data.all_approved) {
        if (typeof toast === 'function') toast('Погоджено!', 'success',
          'Усі ' + data.required_count + ' погоджувачів підтвердили — статус: Погоджено');
      } else {
        var remaining = (data.required_count || 0) - (data.approved_count || 0);
        if (typeof toast === 'function') toast('Голос враховано', 'success',
          'Чекаємо ще ' + remaining + ' з ' + data.required_count + ' (зараз ' + data.approved_count + '/' + data.required_count + ')');
      }
      return data;
    } catch (e) {
      console.error('registerApproval exception:', e);
      if (typeof toast === 'function') toast('Помилка', 'error', String(e.message || e));
      return null;
    }
  }

  // Перехоплюємо кліки на approve у обох місцях:
  //  1) Board view — data-action="approve"
  //  2) Card modal — data-transition="approved"
  document.addEventListener('click', async function (e) {
    var boardBtn = e.target && e.target.closest && e.target.closest('[data-action="approve"]');
    var cardBtn = e.target && e.target.closest && e.target.closest('[data-transition="approved"]');
    var btn = boardBtn || cardBtn;
    if (!btn) return;

    var pubId;
    if (boardBtn) {
      pubId = btn.dataset.id || (btn.closest('[data-id]') && btn.closest('[data-id]').dataset.id);
    } else if (cardBtn) {
      // Картка — pubId беремо з URL (#publication/...) або з window.__hqCurrentPub
      var hash = (location.hash || '').slice(1);
      if (hash.indexOf('publication/') === 0) {
        pubId = hash.split('/')[1];
      } else if (window.__hqCurrentPub && window.__hqCurrentPub.id) {
        pubId = window.__hqCurrentPub.id;
      }
    }
    if (!pubId) return;

    var p = Store.pub && Store.pub(pubId);
    if (!p) return;
    var approvers = (p.approvers || []);
    if (approvers.length === 0) {
      // Старий fallback: пряма зміна статусу — дозволяємо оригіналу виконатись
      return;
    }

    // Перехоплюємо
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();

    var orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳…';

    // Якщо це card modal — спочатку запитаємо коментар (як робить transitionStatus)
    var comment = null;
    if (cardBtn) {
      comment = prompt('Коментар (опційно):', '') || '';
    }

    var result = await registerApproval(pubId);

    btn.disabled = false;
    btn.textContent = orig;

    if (result && result.ok && comment && comment.trim()) {
      // Додаємо коментар окремо, бо RPC не приймає його
      try {
        if (typeof Store.addComment === 'function') await Store.addComment(pubId, comment);
      } catch (_) {}
    }

    if (result && result.ok) {
      // Закриваємо модалку якщо це card
      if (cardBtn && window.Modal && typeof window.Modal.close === 'function') {
        try { window.Modal.close(); } catch (_) {}
      }
      // Ререндер
      if (typeof window.navigate === 'function') {
        setTimeout(window.navigate, 300);
      }
      if (typeof window.updateNavCounts === 'function') {
        setTimeout(window.updateNavCounts, 400);
      }
    }
  }, true);

  // Також — rework через card modal має скидати approved_by[] (це робить SQL trigger
  // trg_reset_approvals on update). Тут нічого додатково не треба — статус='rework'
  // через transitionStatus → upsertPub → DB UPDATE → trigger → approved_by=[].

  window.HQ_registerApproval = registerApproval;

  console.log('%cDreamCar HQ Multi-approver %c· AND logic у board + card modal',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
