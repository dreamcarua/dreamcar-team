/* ============================================================
   DreamCar HQ — Defensive TG chat_id save
   ============================================================ */
// PROBLEM: app-patches.js saveTgChatId() робить:
//   sb.from('users').update({tg_chat_id}).eq('id', me.id)
// Якщо RLS silently дропне рядок (auth_id != auth.uid()), error === null
// але оновлення не відбулося. Юзер бачить "✓ Збережено" - але потім refresh
// показує porожнечу. Це і є кейс Давида.
// FIX: робимо .update().select() щоб отримати реальну кількість оновлених
// рядків. Якщо 0 — показуємо чітку помилку. Якщо 1 — hydrate Store.

(function () {
  if (window.__hqTgSaveFix) return;
  window.__hqTgSaveFix = true;

  async function saveTgChatIdSafe() {
    var inp = document.getElementById('set_tg_chat_id');
    var status = document.getElementById('set_tg_status');
    if (!inp || !status) return;

    var v = (inp.value || '').trim();
    var num = v === '' ? null : parseInt(v, 10);
    if (v !== '' && (isNaN(num) || Math.abs(num) < 1000)) {
      status.textContent = '⚠ chat_id має бути числом (мін. 4 цифри).';
      status.style.color = 'var(--red-soft)';
      return;
    }

    if (!window.HQ_BACKEND) {
      status.textContent = 'У demo-режимі chat_id збережено локально.';
      status.style.color = 'var(--grey)';
      var meLocal = Store.currentUser && Store.currentUser();
      if (meLocal) {
        meLocal.tg_chat_id = num;
        if (typeof Store._saveLocal === 'function') Store._saveLocal();
      }
      return;
    }

    var sb = window.supabase;
    if (!sb) {
      status.textContent = '⚠ Supabase клієнт недоступний.';
      status.style.color = 'var(--red-soft)';
      return;
    }

    status.textContent = 'Зберігаю…';
    status.style.color = 'var(--gold)';

    try {
      var me = Store.currentUser();
      if (!me || !me.id) {
        status.textContent = '⚠ Не вдалося визначити поточного користувача.';
        status.style.color = 'var(--red-soft)';
        return;
      }

      // .update().select() — щоб отримати реальний набір оновлених рядків.
      // Якщо RLS не пропускає, повертається [] без error.
      var resp = await sb
        .from('users')
        .update({ tg_chat_id: num })
        .eq('id', me.id)
        .select('id, tg_chat_id');

      if (resp.error) throw resp.error;

      var rows = resp.data || [];
      if (rows.length === 0) {
        // RLS silently dropped the row
        status.innerHTML =
          '⚠ Збереження заблоковане (RLS). Перевір що ти увійшов через ' +
          'Google під своїм email (' + escapeHtmlSafe(me.email) + ').<br>' +
          'Якщо все OK — напиши Вадиму, треба полагодити auth_id linkage.';
        status.style.color = 'var(--red-soft)';
        console.error('TG save RLS reject: 0 rows updated. user.id:', me.id, 'auth_id:', me.auth_id);
        if (typeof toast === 'function') {
          toast('Збереження не пройшло', 'error', 'RLS заблокувала. Деталі — у Settings.');
        }
        return;
      }

      // Оновити локальний об'єкт + всі екземпляри у Store
      var updated = rows[0];
      me.tg_chat_id = updated.tg_chat_id;
      try {
        (Store._data.users || []).forEach(function (u) {
          if (u.id === me.id) u.tg_chat_id = updated.tg_chat_id;
        });
      } catch (_) {}

      status.textContent = '✓ Збережено: ' + (updated.tg_chat_id || 'порожньо');
      status.style.color = 'var(--green-soft)';
      if (typeof toast === 'function') toast('Збережено', 'success', 'TG chat_id оновлено у БД');

      // Перевірити онбординг — крок tg_bind може зробитись зеленим
      if (typeof window.HQ_Onboarding === 'object' && typeof window.HQ_Onboarding.refresh === 'function') {
        window.HQ_Onboarding.refresh();
      }
    } catch (e) {
      console.error('saveTgChatIdSafe err:', e);
      status.textContent = '⚠ Помилка: ' + (e.message || e);
      status.style.color = 'var(--red-soft)';
    }
  }

  function escapeHtmlSafe(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(String(s || ''));
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // Перехоплюємо клік на #set_tg_save — наша версія замість оригіналу
  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('#set_tg_save');
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    saveTgChatIdSafe();
  }, true);

  // Замінити глобальну функцію якщо доступна
  window.saveTgChatId = saveTgChatIdSafe;

  if (window.DEBUG) console.log('%cDreamCar HQ TG save fix %c· defensive save with row-count check installed', 'color:#0088cc;font-weight:700;', 'color:#888;');
})();
