/* ============================================================
   DreamCar HQ — Vacation Mode (G5a: §14.2 risk «forgetting» mitigation)
   ============================================================ */
// Додає у Settings секцію «Відпустка / Делегування»:
//   • Поля: from_date, to_date, deputy_id
//   • Список твоїх запланованих відпусток + Delete
// Backend: user_vacations таблиця (вже у schema). RLS: own or lead+.

(function () {
  if (window.__hqVacationLoaded) return;
  window.__hqVacationLoaded = true;

  function getStore() { try { return Store; } catch (_) { return null; } }
  function getCurrentUser() {
    var s = getStore();
    if (!s || typeof s.currentUser !== 'function') return null;
    try { return s.currentUser() || null; } catch (_) { return null; }
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- CSS ----
  (function () {
    if (document.getElementById('hq-vac-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-vac-css';
    css.textContent =
      '.hq-vac-block { background: linear-gradient(135deg, rgba(251,191,36,0.08), transparent); border: 1px solid rgba(251,191,36,0.3); border-radius: 8px; padding: 14px; margin-top: 12px; }' +
      '.hq-vac-block .hv-title { font-weight: 700; color: #fff; margin-bottom: 8px; font-size: 13px; }' +
      '.hq-vac-block .hv-desc { font-size: 12px; color: var(--grey); margin-bottom: 10px; line-height: 1.5; }' +
      '.hq-vac-form { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 8px; align-items: end; margin-bottom: 10px; }' +
      '.hq-vac-form .field label { font-size: 10px; }' +
      '.hq-vac-list { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }' +
      '.hq-vac-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; background: var(--bg-3); border-radius: 6px; font-size: 12px; }' +
      '.hq-vac-row .hv-meta { color: #fff; }' +
      '.hq-vac-row .hv-deputy { color: var(--gold); font-weight: 600; }' +
      '.hq-vac-row button { background: transparent; border: 1px solid var(--border); color: var(--red-soft); padding: 3px 8px; border-radius: 4px; font-size: 11px; cursor: pointer; }' +
      '.hq-vac-row button:hover { background: var(--red-dim); }';
    document.head.appendChild(css);
  })();

  async function loadVacations(userId) {
    if (!window.HQ_BACKEND || !window.supabase) return [];
    var resp = await window.supabase.from('user_vacations')
      .select('id, from_date, to_date, deputy_id, reason')
      .eq('user_id', userId)
      .order('from_date', { ascending: false });
    return resp.data || [];
  }

  async function addVacation(userId, fromDate, toDate, deputyId, reason) {
    if (!window.HQ_BACKEND || !window.supabase) {
      if (typeof toast === 'function') toast('Backend required', 'error');
      return null;
    }
    var resp = await window.supabase.from('user_vacations').insert({
      user_id: userId,
      from_date: fromDate,
      to_date: toDate,
      deputy_id: deputyId || null,
      reason: reason || null,
    }).select().single();
    if (resp.error) {
      if (typeof toast === 'function') toast('Помилка', 'error', resp.error.message);
      return null;
    }
    return resp.data;
  }

  async function deleteVacation(vacId) {
    if (!window.HQ_BACKEND || !window.supabase) return;
    await window.supabase.from('user_vacations').delete().eq('id', vacId);
  }

  function userOptions() {
    var s = getStore();
    var me = getCurrentUser();
    if (!s) return '';
    var users = (s.users && s.users()) || [];
    return users
      .filter(function (u) { return u && u.id && (!me || u.id !== me.id); })
      .map(function (u) { return '<option value="' + u.id + '">' + escapeHtml(u.name || u.email) + '</option>'; })
      .join('');
  }

  function fmt(d) {
    if (!d) return '—';
    var parts = String(d).split('-');
    return parts.length === 3 ? parts[2] + '.' + parts[1] + '.' + parts[0] : d;
  }

  async function refreshList(container, userId) {
    var list = await loadVacations(userId);
    var listEl = container.querySelector('.hq-vac-list');
    if (!listEl) return;
    var s = getStore();
    if (list.length === 0) {
      listEl.innerHTML = '<div style="font-size:11px;color:var(--grey-2);padding:6px 0;">Немає запланованих відпусток</div>';
      return;
    }
    listEl.innerHTML = list.map(function (v) {
      var deputy = v.deputy_id && s ? (s.user && s.user(v.deputy_id)) : null;
      var deputyName = deputy ? escapeHtml(deputy.name || deputy.email) : '—';
      return '<div class="hq-vac-row" data-id="' + v.id + '">' +
        '<div>' +
          '<span class="hv-meta">' + fmt(v.from_date) + ' → ' + fmt(v.to_date) + '</span>' +
          ' · <span class="hv-deputy">→ ' + deputyName + '</span>' +
          (v.reason ? ' <span style="color:var(--grey)">(' + escapeHtml(v.reason) + ')</span>' : '') +
        '</div>' +
        '<button data-del="' + v.id + '">Скасувати</button>' +
        '</div>';
    }).join('');
    listEl.querySelectorAll('button[data-del]').forEach(function (btn) {
      btn.onclick = async function () {
        if (!confirm('Скасувати цю відпустку?')) return;
        await deleteVacation(btn.dataset.del);
        if (typeof toast === 'function') toast('Скасовано', 'success');
        refreshList(container, userId);
      };
    });
  }

  async function enhanceSettingsVacationBlock() {
    var me = getCurrentUser();
    if (!me || !me.id) return;
    if (document.querySelector('.hq-vac-block')) return;
    var settingsRoot = document.querySelector('#main') || document.body;
    var input = document.getElementById('set_tg_chat_id');
    var anchor = input && input.closest('div[style*="background:var(--bg-2)"]') || settingsRoot;
    if (!anchor) return;

    var block = document.createElement('div');
    block.className = 'hq-vac-block';
    block.innerHTML =
      '<div class="hv-title">🌴 Відпустка / Auto-delegation</div>' +
      '<div class="hv-desc">Поки ти у відпустці, всі публікації, де ти відповідальний/погоджувач, автоматично адресуються замісникові. Time-based нагадування теж їдуть до нього.</div>' +
      '<div class="hq-vac-form">' +
        '<div class="field"><label>З</label><input type="date" id="hv_from" /></div>' +
        '<div class="field"><label>До</label><input type="date" id="hv_to" /></div>' +
        '<div class="field"><label>Замісник</label><select id="hv_deputy"><option value="">— оберіть —</option>' + userOptions() + '</select></div>' +
        '<button class="btn btn-primary" id="hv_save">Додати</button>' +
      '</div>' +
      '<div class="field" style="margin-bottom:8px;"><label>Причина (опційно)</label><input type="text" id="hv_reason" placeholder="напр. літня відпустка" /></div>' +
      '<div class="hq-vac-list"></div>';
    anchor.appendChild(block);

    block.querySelector('#hv_save').onclick = async function () {
      var from = block.querySelector('#hv_from').value;
      var to = block.querySelector('#hv_to').value;
      var deputy = block.querySelector('#hv_deputy').value;
      var reason = block.querySelector('#hv_reason').value;
      if (!from || !to) {
        if (typeof toast === 'function') toast('Потрібні обидві дати', 'warn');
        return;
      }
      if (from > to) {
        if (typeof toast === 'function') toast('Дата "З" має бути ≤ "До"', 'warn');
        return;
      }
      var res = await addVacation(me.id, from, to, deputy || null, reason || null);
      if (res) {
        if (typeof toast === 'function') toast('Відпустку заплановано', 'success', fmt(from) + ' → ' + fmt(to));
        block.querySelector('#hv_from').value = '';
        block.querySelector('#hv_to').value = '';
        block.querySelector('#hv_deputy').value = '';
        block.querySelector('#hv_reason').value = '';
        refreshList(block, me.id);
      }
    };

    refreshList(block, me.id);
  }
  window.enhanceSettingsVacationBlock = enhanceSettingsVacationBlock;

  function maybeRun() {
    if ((location.hash || '').slice(1).split('/')[0] !== 'settings') return;
    [200, 800, 1800, 3500].forEach(function (ms) { setTimeout(enhanceSettingsVacationBlock, ms); });
  }
  window.addEventListener('hashchange', maybeRun);
  maybeRun();

  console.log('%cDreamCar HQ Vacation %c· Auto-delegation ready', 'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
