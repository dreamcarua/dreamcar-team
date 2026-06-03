/* ============================================================
   DreamCar HQ — Next Action Pipeline (Олександр+Артем 03.06.2026)
   ============================================================
   Питання Олександра: «Як Артем зрозуміє що ВІДЕО від нього?»
   Рішення: окреме поле next_action_user_id + kind. TG-нотіф 
   назначеному. Кнопка «Готово · передати далі».
   ============================================================ */
(function () {
  if (window.__nextActionLoaded) return;
  window.__nextActionLoaded = true;

  var KIND_META = {
    script:  { emoji: '✍️', label: 'Сценарій' },
    video:   { emoji: '🎬', label: 'Відео' },
    design:  { emoji: '🎨', label: 'Дизайн' },
    copy:    { emoji: '📝', label: 'Текст' },
    review:  { emoji: '👀', label: 'Перевірка' },
    revise:  { emoji: '↩️', label: 'Доопрацювання' },
    approve: { emoji: '✅', label: 'Погодження' },
    other:   { emoji: '🔗', label: 'Інше' },
  };

  /* ===== CSS ===== */
  var css = document.createElement('style');
  css.id = 'next-action-css';
  css.textContent = [
    '.na-block { background: linear-gradient(135deg, rgba(227,6,19,0.08), rgba(13,13,31,0.5)); border: 1px solid rgba(227,6,19,0.4); border-left: 4px solid var(--red, #E30613); border-radius: 8px; padding: 12px 14px; margin: 12px 0; }',
    '.na-block.empty { border-left-color: var(--steel, #444); background: rgba(40,40,52,0.3); }',
    '.na-head { font-family: "JetBrains Mono", monospace; font-size: 10px; color: var(--red, #E30613); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 8px; }',
    '.na-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
    '.na-who { font-family: "Oswald", sans-serif; font-size: 16px; color: #fff; font-weight: 600; text-transform: uppercase; }',
    '.na-kind { font-size: 13px; color: var(--bone, #ddd); padding: 3px 8px; background: rgba(255,255,255,0.06); border-radius: 4px; }',
    '.na-note { font-size: 12px; color: var(--ash, #aaa); margin-top: 6px; line-height: 1.5; padding-left: 2px; }',
    '.na-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }',
    '.na-btn { padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; border: 1px solid var(--border, #2a2a2a); background: var(--bg-3, #1f1f1f); color: #fff; transition: all .12s; font-family: "JetBrains Mono", monospace; }',
    '.na-btn:hover { border-color: var(--red, #E30613); }',
    '.na-btn.primary { background: var(--red, #E30613); border-color: var(--red); }',
    '.na-btn.primary:hover { background: #ff1a2b; }',
    /* Modal для assign-next */
    '.na-modal { position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; padding: 20px; }',
    '.na-modal-box { background: var(--bg-2, #141414); border: 1px solid var(--red, #E30613); border-radius: 10px; padding: 22px 26px; max-width: 460px; width: 100%; }',
    '.na-modal-box h3 { font-family: "Oswald", sans-serif; font-size: 18px; text-transform: uppercase; margin-bottom: 16px; color: #fff; }',
    '.na-modal-box .field { margin-bottom: 14px; }',
    '.na-modal-box label { display: block; font-family: "JetBrains Mono", monospace; font-size: 10px; color: var(--ash, #aaa); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6px; }',
    '.na-modal-box select, .na-modal-box textarea, .na-modal-box input { width: 100%; background: var(--bg, #0a0a0a); border: 1px solid var(--border, #2a2a2a); color: #fff; padding: 8px 10px; border-radius: 6px; font-size: 13px; font-family: inherit; }',
    '.na-modal-box textarea { min-height: 60px; resize: vertical; }',
    '.na-modal-box .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }',
    '.na-kind-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 4px; }',
    '.na-kind-grid label { background: var(--bg-3, #1f1f1f); border: 1px solid var(--border, #2a2a2a); border-radius: 6px; padding: 8px 6px; text-align: center; cursor: pointer; font-size: 11px; color: var(--bone, #ddd); margin: 0; letter-spacing: 0; text-transform: none; transition: all .12s; }',
    '.na-kind-grid label:hover { border-color: var(--red, #E30613); color: #fff; }',
    '.na-kind-grid input { display: none; }',
    '.na-kind-grid input:checked + span { color: var(--red, #E30613); font-weight: 700; }',
    '.na-kind-grid label:has(input:checked) { background: rgba(227,6,19,0.15); border-color: var(--red, #E30613); }',
  ].join('\n');
  document.head.appendChild(css);

  /* ===== Render NA block у edit-modal ===== */
  async function renderNAblock(pub) {
    if (!pub) return;
    var modalBody = document.querySelector('#modal .modal-body, #modal .pub-form');
    if (!modalBody) return;
    var existing = modalBody.querySelector('.na-block');
    if (existing) existing.remove();

    var box = document.createElement('div');
    box.className = 'na-block' + (pub.next_action_user_id ? '' : ' empty');
    var users = (window.Store && Store.users && Store.users()) || [];
    var who = pub.next_action_user_id ? users.find(function (u) { return u.id === pub.next_action_user_id; }) : null;
    var kind = pub.next_action_kind ? KIND_META[pub.next_action_kind] : null;

    if (who && kind) {
      box.innerHTML =
        '<div class="na-head">⏳ Зараз хід:</div>' +
        '<div class="na-row">' +
        '<span class="na-who">' + escapeHtml(who.name || who.email) + '</span>' +
        '<span class="na-kind">' + kind.emoji + ' ' + kind.label + '</span>' +
        '</div>' +
        (pub.next_action_note ? '<div class="na-note">📝 ' + escapeHtml(pub.next_action_note) + '</div>' : '') +
        '<div class="na-actions">' +
        '<button class="na-btn primary" data-na="done">✓ Готово · передати далі</button>' +
        '<button class="na-btn" data-na="clear">🚫 Зняти next-action</button>' +
        '<button class="na-btn" data-na="reassign">✏️ Змінити</button>' +
        '</div>';
    } else {
      box.innerHTML =
        '<div class="na-head">⏳ Next Action</div>' +
        '<div style="font-size:12px;color:var(--ash,#aaa);margin-bottom:8px;">Нічого не очікують. Призначити наступного виконавця?</div>' +
        '<div class="na-actions"><button class="na-btn primary" data-na="assign">+ Призначити next-action</button></div>';
    }
    // insert ABOVE existing first child (вгорі модалки видно одразу)
    modalBody.insertBefore(box, modalBody.firstChild);

    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-na]'); if (!btn) return;
      var act = btn.dataset.na;
      if (act === 'clear') return clearNA(pub);
      if (act === 'done' || act === 'reassign' || act === 'assign') return openAssignModal(pub);
    });
  }

  function escapeHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ===== Clear NA ===== */
  async function clearNA(pub) {
    if (!confirm('Зняти next-action? Ніхто не отримуватиме нагадування.')) return;
    var sb = window.supabase; if (!sb) return;
    var { error } = await sb.from('publications').update({
      next_action_user_id: null, next_action_kind: null, next_action_note: null
    }).eq('id', pub.id);
    if (error) { window.toast && toast('Помилка: ' + error.message, 'error'); return; }
    pub.next_action_user_id = null; pub.next_action_kind = null; pub.next_action_note = null;
    window.toast && toast('Next-action знято', 'info');
    renderNAblock(pub);
  }

  /* ===== Assign modal ===== */
  function openAssignModal(pub) {
    var users = (window.Store && Store.users && Store.users()) || [];
    var me = window.Store && Store.currentUser && Store.currentUser();
    var wrap = document.createElement('div');
    wrap.className = 'na-modal';
    wrap.innerHTML =
      '<div class="na-modal-box">' +
      '<h3>⏳ Передати далі</h3>' +
      '<div class="field"><label>Кому</label><select id="na-user">' +
      '<option value="">— оберіть —</option>' +
      users.map(function (u) { return '<option value="' + u.id + '">' + escapeHtml(u.name || u.email) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label>Тип роботи</label><div class="na-kind-grid">' +
      Object.keys(KIND_META).map(function (k) {
        return '<label><input type="radio" name="na-kind" value="' + k + '"><span>' + KIND_META[k].emoji + ' ' + KIND_META[k].label + '</span></label>';
      }).join('') +
      '</div></div>' +
      '<div class="field"><label>Примітка (опц.)</label><textarea id="na-note" placeholder="Що саме потрібно зробити… (показано виконавцю у TG)"></textarea></div>' +
      '<div class="actions">' +
      '<button class="na-btn" data-act="cancel">Скасувати</button>' +
      '<button class="na-btn primary" data-act="save">Передати ✓</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', async function (e) {
      var act = e.target && e.target.dataset && e.target.dataset.act;
      if (e.target === wrap) { wrap.remove(); return; }
      if (act === 'cancel') { wrap.remove(); return; }
      if (act === 'save') {
        var uid = wrap.querySelector('#na-user').value;
        var kindEl = wrap.querySelector('input[name="na-kind"]:checked');
        var note = wrap.querySelector('#na-note').value.trim() || null;
        if (!uid) { window.toast && toast('Оберіть кому', 'error'); return; }
        if (!kindEl) { window.toast && toast('Оберіть тип роботи', 'error'); return; }
        var sb = window.supabase; if (!sb) return;
        var update = {
          next_action_user_id: uid,
          next_action_kind: kindEl.value,
          next_action_note: note,
          next_action_set_at: new Date().toISOString(),
          next_action_set_by: me ? me.id : null
        };
        var { error } = await sb.from('publications').update(update).eq('id', pub.id);
        if (error) { window.toast && toast('Помилка: ' + error.message, 'error'); return; }
        Object.assign(pub, update);
        wrap.remove();
        window.toast && toast('Передано → ' + (users.find(function (u) { return u.id === uid; }) || {}).name, 'success');
        renderNAblock(pub);
      }
    });
  }

  /* ===== Observer щоб реагувати на open edit-modal ===== */
  var lastPubId = null;
  var mo = new MutationObserver(function () {
    if (!location.hash.startsWith('#publication/')) { lastPubId = null; return; }
    var idMatch = location.hash.match(/^#publication\/(.+)$/);
    var id = idMatch && idMatch[1];
    if (!id || id === lastPubId) return;
    lastPubId = id;
    setTimeout(function () {
      var pub = null; try { pub = Store.pub(id); } catch (_) {}
      if (!pub) return;
      renderNAblock(pub);
    }, 200);
  });

  function init() {
    var modal = document.getElementById('modal');
    if (modal) mo.observe(modal, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  setTimeout(init, 1500);

  window.addEventListener('hashchange', function () {
    if (location.hash.startsWith('#publication/')) {
      var id = location.hash.split('/')[1];
      if (id !== lastPubId) {
        lastPubId = null;
        setTimeout(function () {
          var pub = null; try { pub = Store.pub(id); } catch (_) {}
          if (pub) renderNAblock(pub);
        }, 300);
      }
    }
  });
})();
