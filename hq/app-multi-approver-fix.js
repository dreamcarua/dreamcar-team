/* ============================================================
   DreamCar HQ — Multi-approver AND logic
   ============================================================ */
// Перехоплює клік на data-action="approve" у Board (та аналогічні точки
// активації) і викликає Postgres RPC `register_approval` яка:
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

  // Перехоплюємо клік на approve buttons на дошці погоджень
  document.addEventListener('click', async function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-action="approve"]');
    if (!btn) return;
    var pubId = btn.dataset.id || (btn.closest('[data-id]') && btn.closest('[data-id]').dataset.id);
    if (!pubId) return;
    // Перевірити чи це multi-approver case
    var p = Store.pub && Store.pub(pubId);
    if (!p) return;
    var approvers = (p.approvers || []);
    var policy = p.approverPolicy || p.approver_policy || 'all';
    // Якщо single-approver і policy='any' — стара логіка ОК, але робимо RPC однаково для консистентності
    if (approvers.length === 0) {
      // Старий fallback: пряма зміна статусу
      return; // дозволяємо оригінальному handler виконатись
    }
    // Перехоплюємо click — викликаємо нашу RPC
    e.preventDefault();
    e.stopImmediatePropagation();

    // Відключити кнопку щоб не натиснули двічі
    var orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳…';

    var result = await registerApproval(pubId);

    btn.disabled = false;
    btn.textContent = orig;

    // Якщо успіх — ререндер сторінки
    if (result && result.ok) {
      if (typeof window.navigate === 'function') {
        setTimeout(window.navigate, 300);
      }
      if (typeof window.updateNavCounts === 'function') {
        setTimeout(window.updateNavCounts, 400);
      }
    }
  }, true);

  // Експортуємо для зовнішнього використання (TG-bot або скрипти)
  window.HQ_registerApproval = registerApproval;

  console.log('%cDreamCar HQ Multi-approver %c· AND logic via register_approval RPC',
    'color:#6ee7b7;font-weight:700;', 'color:#888;');
})();
