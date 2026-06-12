/* DreamCar СКЛАД — app logic
   #345 12.06.2026 — Vadym BIG request
   Stack: vanilla JS modules, Supabase client (window.supabase встановлюється з index.html)
   HARD RULES: Europe/Kyiv dates · inline onclick для critical buttons · ASCII в коді
*/
(function(){
  'use strict';

  // ============================ helpers ============================
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#39;'}[c]));
  const fmtDt = (iso) => {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(iso));
    } catch(_) { return iso; }
  };
  const sb = () => window.supabase;
  const me = () => window.invState && window.invState.publicUser;
  const canWrite = () => { const u = me(); return u && ['ceo','coo','lead'].includes(u.role); };
  const toast = (msg, type) => window.toast && window.toast(msg, type);

  // ============================ Store ============================
  const Store = {
    items: [],          // {item_id, name, category, notes, photo_url, archived, created_at, updated_at, variants:[{id,label,attrs,sku,low_stock_threshold,archived,qty}], total_qty, any_low}
    movements: [],      // {id,performed_at,variant_id,variant_label,item_id,item_name,type,qty,reason,reference_url,performed_by,performed_by_name}
    async loadItems() {
      const { data, error } = await sb().rpc('inventory_list_items', { p_include_archived: true });
      if (error) { console.error('[inv] loadItems', error); toast('Помилка завантаження: ' + (error.message||error), 'error'); return; }
      this.items = data || [];
      updateCounts();
    },
    async loadMovements(limit) {
      const { data, error } = await sb().rpc('inventory_list_movements', { p_limit: limit || 200 });
      if (error) { console.error('[inv] loadMovements', error); return; }
      this.movements = data || [];
      const el = document.getElementById('cnt-mv'); if (el) el.textContent = String(this.movements.length);
    },
    findVariant(variantId) {
      for (const it of this.items) {
        const v = (it.variants||[]).find(v=>v.id===variantId);
        if (v) return { item: it, variant: v };
      }
      return null;
    },
    async move(variantId, type, qty, reason, ref) {
      const { data, error } = await sb().rpc('inventory_move', { p_variant_id: variantId, p_type: type, p_qty: qty, p_reason: reason || null, p_reference_url: ref || null });
      if (error) throw error;
      return data;
    },
    async upsertItem(payload) {
      // payload: { id?, name, category, notes, photo_url, archived }
      const me_ = me();
      const row = { name: payload.name, category: payload.category, notes: payload.notes || null, photo_url: payload.photo_url || null, archived: !!payload.archived };
      if (payload.id) {
        const { error } = await sb().from('inventory_items').update(row).eq('id', payload.id);
        if (error) throw error; return payload.id;
      } else {
        row.created_by = me_ && me_.id || null;
        const { data, error } = await sb().from('inventory_items').insert(row).select('id').single();
        if (error) throw error; return data.id;
      }
    },
    async upsertVariant(payload) {
      // payload: { id?, item_id, label, attrs, sku, low_stock_threshold, archived }
      const row = { item_id: payload.item_id, label: payload.label, attrs: payload.attrs || {}, sku: payload.sku || null, low_stock_threshold: parseInt(payload.low_stock_threshold||0,10)||0, archived: !!payload.archived };
      if (payload.id) {
        const { error } = await sb().from('inventory_variants').update(row).eq('id', payload.id);
        if (error) throw error; return payload.id;
      } else {
        const { data, error } = await sb().from('inventory_variants').insert(row).select('id').single();
        if (error) throw error; return data.id;
      }
    }
  };
  window.invStore = Store;

  // ============================ counts ============================
  function updateCounts() {
    const active = Store.items.filter(i=>!i.archived);
    document.getElementById('cnt-items').textContent = String(active.length);
    document.getElementById('cnt-low').textContent = String(active.filter(i=>i.any_low).length);
    document.getElementById('cnt-arch').textContent = String(Store.items.filter(i=>i.archived).length);
  }

  // ============================ Modal ============================
  function openModal(html) {
    const root = document.getElementById('modalRoot');
    const back = document.getElementById('modalBackdrop');
    root.innerHTML = html;
    back.classList.add('open');
  }
  function closeModal() {
    document.getElementById('modalBackdrop').classList.remove('open');
    document.getElementById('modalRoot').innerHTML = '';
  }
  window.invCloseModal = closeModal;
  // backdrop click NOT closing (autosave guard pattern) — close через X кнопку лише
  document.getElementById('modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') { /* no-op щоб не закривати випадково */ } });

  // ============================ Move modals (Прийняти/Видати/Списати/Коригувати) ============================
  // Inline onclick + global window fn — HARD RULE (memory feedback_inline_onclick_for_critical_buttons)
  window.invDoMove = async function(){
    const btn = document.getElementById('mvSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Зберігаю…'; }
    try {
      const vid = document.getElementById('mvVariantId').value;
      const type = document.getElementById('mvType').value;
      const qty = parseInt(document.getElementById('mvQty').value, 10);
      const reason = document.getElementById('mvReason').value.trim();
      const ref = document.getElementById('mvRef').value.trim();
      if (!vid || !type || !qty || qty<=0) throw new Error('Заповни кількість > 0');
      if (!reason && type !== 'intake') throw new Error('Вкажи причину видачі/списання');
      await Store.move(vid, type, qty, reason, ref || null);
      toast('Збережено ✓', 'success');
      closeModal();
      await Promise.all([Store.loadItems(), Store.loadMovements()]);
      render();
    } catch (e) {
      console.error('[inv] move err', e);
      toast('Помилка: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Зберегти'; }
    }
  };

  function openMoveModal(itemId, variantId, type) {
    const found = Store.findVariant(variantId);
    if (!found) return;
    const { item, variant } = found;
    const cur = variant.qty || 0;
    const labels = { intake: 'Прийняти на склад', release: 'Видати зі складу', writeoff: 'Списати (брак / втрата)' };
    const colors = { intake: 'success', release: 'primary', writeoff: 'danger' };
    const reasonPlaceholder = type === 'intake' ? 'Постачання від виробника / закупка' : type === 'release' ? 'Зйомка iPhone 17 PRO MAX / роздача переможцям / промо' : 'Брак при отриманні / втрата / зіпсовано';
    openModal(`
      <div class="modal-head">
        <h2>${esc(labels[type] || type)}</h2>
        <button class="x-btn" onclick="invCloseModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="hint">${esc(item.name)} · <strong>${esc(variant.label)}</strong> · поточний залишок: <strong>${cur}</strong></div>
        <input type="hidden" id="mvVariantId" value="${esc(variantId)}">
        <input type="hidden" id="mvType" value="${esc(type)}">
        <div class="field">
          <label>Кількість *</label>
          <input id="mvQty" type="number" min="1" step="1" value="1" autofocus>
          ${type !== 'intake' ? `<div class="hint">Доступно: ${cur}</div>` : ''}
        </div>
        <div class="field">
          <label>Причина ${type === 'intake' ? '' : '*'}</label>
          <input id="mvReason" type="text" placeholder="${esc(reasonPlaceholder)}">
          <div class="hint">Хто отримав / куди витрачено / звідки прийшло</div>
        </div>
        <div class="field">
          <label>Посилання (опційно)</label>
          <input id="mvRef" type="text" placeholder="https://team.dreamcar.ua/tasks/#task=...">
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" onclick="invCloseModal()">Скасувати</button>
        <button class="btn ${colors[type]}" id="mvSaveBtn" onclick="invDoMove()">Зберегти</button>
      </div>
    `);
    setTimeout(()=>{ const q=document.getElementById('mvQty'); if(q) q.focus(); }, 30);
  }
  window.invOpenMoveModal = openMoveModal;

  // Коригування — adjust_to target qty
  window.invDoAdjust = async function(){
    const btn = document.getElementById('adjSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Зберігаю…'; }
    try {
      const vid = document.getElementById('adjVariantId').value;
      const target = parseInt(document.getElementById('adjTarget').value, 10);
      const reason = document.getElementById('adjReason').value.trim();
      if (isNaN(target) || target < 0) throw new Error('Цільова кількість >= 0');
      if (!reason) throw new Error('Вкажи причину коригування (інвентаризація / помилка обліку / тощо)');
      await Store.move(vid, 'adjust_to', target, 'Коригування: ' + reason, null);
      toast('Скориговано ✓', 'success'); closeModal();
      await Promise.all([Store.loadItems(), Store.loadMovements()]); render();
    } catch (e) {
      console.error('[inv] adjust err', e);
      toast('Помилка: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Зберегти'; }
    }
  };
  function openAdjustModal(itemId, variantId){
    const found = Store.findVariant(variantId);
    if (!found) return;
    const { item, variant } = found;
    openModal(`
      <div class="modal-head">
        <h2>Коригування залишку</h2>
        <button class="x-btn" onclick="invCloseModal()">×</button>
      </div>
      <div class="modal-body">
        <div class="hint">${esc(item.name)} · <strong>${esc(variant.label)}</strong> · поточний: <strong>${variant.qty||0}</strong></div>
        <input type="hidden" id="adjVariantId" value="${esc(variantId)}">
        <div class="field">
          <label>Цільовий залишок *</label>
          <input id="adjTarget" type="number" min="0" step="1" value="${variant.qty||0}" autofocus>
          <div class="hint">Система автоматично запише прийомку або видачу на різницю.</div>
        </div>
        <div class="field">
          <label>Причина *</label>
          <input id="adjReason" type="text" placeholder="Інвентаризація 12.06.2026 / помилка обліку / знайдено в коробці">
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" onclick="invCloseModal()">Скасувати</button>
        <button class="btn warn" id="adjSaveBtn" onclick="invDoAdjust()">Зберегти</button>
      </div>
    `);
  }
  window.invOpenAdjustModal = openAdjustModal;

  // ============================ Item + Variant CRUD modals ============================
  window.invDoSaveItem = async function(){
    const btn = document.getElementById('itSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Зберігаю…'; }
    try {
      const id = document.getElementById('itId').value || null;
      const name = document.getElementById('itName').value.trim();
      const category = document.getElementById('itCat').value;
      const notes = document.getElementById('itNotes').value.trim();
      const photo_url = document.getElementById('itPhoto').value.trim();
      const archived = document.getElementById('itArchived').checked;
      if (!name) throw new Error('Назва обовʼязкова');
      await Store.upsertItem({ id, name, category, notes, photo_url, archived });
      toast('Збережено ✓', 'success'); closeModal();
      await Store.loadItems(); render();
    } catch (e) {
      toast('Помилка: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Зберегти'; }
    }
  };
  function openItemModal(item){
    const isNew = !item;
    openModal(`
      <div class="modal-head">
        <h2>${isNew ? 'Новий товар' : 'Редагування товару'}</h2>
        <button class="x-btn" onclick="invCloseModal()">×</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="itId" value="${isNew?'':esc(item.item_id)}">
        <div class="field"><label>Назва *</label><input id="itName" type="text" value="${isNew?'':esc(item.name)}" placeholder="Футболка DreamCar / Кепка / Наклейка" autofocus></div>
        <div class="field"><label>Категорія</label>
          <select id="itCat">
            <option value="apparel" ${!isNew && item.category==='apparel'?'selected':''}>Одяг</option>
            <option value="print" ${!isNew && item.category==='print'?'selected':''}>Друк (постери / банери)</option>
            <option value="sticker" ${!isNew && item.category==='sticker'?'selected':''}>Наклейки</option>
            <option value="accessory" ${!isNew && item.category==='accessory'?'selected':''}>Аксесуари</option>
            <option value="other" ${!isNew && item.category==='other'?'selected':''}>Інше</option>
          </select>
        </div>
        <div class="field"><label>Опис / нотатки</label><textarea id="itNotes" rows="3" placeholder="Фірмова футболка чорна з логотипом DreamCar, бавовна 100%">${isNew?'':esc(item.notes||'')}</textarea></div>
        <div class="field"><label>Фото URL (опційно)</label><input id="itPhoto" type="url" value="${isNew?'':esc(item.photo_url||'')}" placeholder="https://..."></div>
        <div class="field"><label><input id="itArchived" type="checkbox" ${!isNew && item.archived?'checked':''}> Архівований (приховати зі списку)</label></div>
        ${isNew ? '<div class="hint">Після збереження товару — додай варіанти (розміри / кольори).</div>' : ''}
      </div>
      <div class="modal-foot">
        <button class="btn ghost" onclick="invCloseModal()">Скасувати</button>
        <button class="btn primary" id="itSaveBtn" onclick="invDoSaveItem()">Зберегти</button>
      </div>
    `);
  }
  window.invOpenItemModal = openItemModal;
  window.invOpenItemModalById = (id) => {
    const it = Store.items.find(x=>x.item_id===id);
    if (it) openItemModal(it);
  };

  // Variant modal
  window.invDoSaveVariant = async function(){
    const btn = document.getElementById('vrSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Зберігаю…'; }
    try {
      const id = document.getElementById('vrId').value || null;
      const item_id = document.getElementById('vrItemId').value;
      const label = document.getElementById('vrLabel').value.trim();
      const size = document.getElementById('vrSize').value.trim();
      const color = document.getElementById('vrColor').value.trim();
      const sku = document.getElementById('vrSku').value.trim();
      const low_stock_threshold = parseInt(document.getElementById('vrLow').value, 10) || 0;
      const archived = document.getElementById('vrArchived').checked;
      if (!label) throw new Error('Назва варіанту обовʼязкова');
      const attrs = {};
      if (size) attrs.size = size;
      if (color) attrs.color = color;
      await Store.upsertVariant({ id, item_id, label, attrs, sku, low_stock_threshold, archived });
      toast('Збережено ✓', 'success'); closeModal();
      await Store.loadItems(); render();
    } catch (e) {
      toast('Помилка: ' + (e.message || e), 'error');
      if (btn) { btn.disabled = false; btn.textContent = 'Зберегти'; }
    }
  };
  function openVariantModal(itemId, variant){
    const isNew = !variant;
    const it = Store.items.find(x=>x.item_id===itemId);
    openModal(`
      <div class="modal-head">
        <h2>${isNew ? 'Новий варіант' : 'Редагування варіанту'}</h2>
        <button class="x-btn" onclick="invCloseModal()">×</button>
      </div>
      <div class="modal-body">
        <input type="hidden" id="vrId" value="${isNew?'':esc(variant.id)}">
        <input type="hidden" id="vrItemId" value="${esc(itemId)}">
        <div class="hint">${esc(it && it.name || '')}</div>
        <div class="field"><label>Назва варіанту *</label><input id="vrLabel" type="text" value="${isNew?'':esc(variant.label)}" placeholder="M — чорна" autofocus></div>
        <div class="field-row">
          <div class="field"><label>Розмір</label><input id="vrSize" type="text" value="${isNew?'':esc((variant.attrs&&variant.attrs.size)||'')}" placeholder="S / M / L / XL"></div>
          <div class="field"><label>Колір</label><input id="vrColor" type="text" value="${isNew?'':esc((variant.attrs&&variant.attrs.color)||'')}" placeholder="чорна / біла"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>SKU (опційно)</label><input id="vrSku" type="text" value="${isNew?'':esc(variant.sku||'')}" placeholder="DC-TS-M-BLK"></div>
          <div class="field"><label>Мін. залишок (alert)</label><input id="vrLow" type="number" min="0" step="1" value="${isNew?3:esc(variant.low_stock_threshold||0)}"></div>
        </div>
        <div class="field"><label><input id="vrArchived" type="checkbox" ${!isNew && variant.archived?'checked':''}> Архівований</label></div>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" onclick="invCloseModal()">Скасувати</button>
        <button class="btn primary" id="vrSaveBtn" onclick="invDoSaveVariant()">Зберегти</button>
      </div>
    `);
  }
  window.invOpenVariantModal = openVariantModal;
  window.invOpenVariantModalById = (itemId, variantId) => {
    const it = Store.items.find(x=>x.item_id===itemId); if (!it) return;
    const v = (it.variants||[]).find(x=>x.id===variantId);
    openVariantModal(itemId, v);
  };

  // ============================ Views ============================
  function viewFilter(route) {
    // повертає функцію фільтру по route
    if (route === 'low')          return (i)=> !i.archived && i.any_low;
    if (route === 'archive')      return (i)=> i.archived;
    if (route && route.indexOf('cat-')===0) {
      const cat = route.slice(4);
      return (i)=> !i.archived && i.category === cat;
    }
    // default: stock — всі активні
    return (i)=> !i.archived;
  }

  function renderStock(route){
    const filter = viewFilter(route);
    const list = Store.items.filter(filter);
    const head = `
      <div class="section-head">
        <h1>${route==='low'?'⚠️ Низький залишок':route==='archive'?'🗃 Архів':'📦 Склад'}</h1>
        <div class="actions">
          ${canWrite() ? '<button class="btn primary" onclick="invOpenItemModal(null)">+ НОВИЙ ТОВАР</button>' : '<span class="hint">Тільки перегляд (CEO/COO/Heads — рух)</span>'}
        </div>
      </div>`;
    if (!list.length) {
      return head + `<div class="empty">Порожньо. ${canWrite()? 'Створи перший товар →' : ''}</div>`;
    }
    const cardsHtml = list.map(it => renderItemCard(it)).join('');
    return head + `<div class="items-grid">${cardsHtml}</div>`;
  }

  function renderItemCard(it) {
    const cls = ['item-card'];
    if (it.archived) cls.push('archived');
    if (it.any_low) cls.push('low');
    const totalCls = it.any_low ? 'total low' : 'total';
    const variants = (it.variants||[]).filter(v=>!v.archived || true); // показуємо всі
    const w = canWrite();
    const varsHtml = variants.map(v => {
      const vcls = ['variant-row'];
      const isLow = v.low_stock_threshold > 0 && v.qty <= v.low_stock_threshold && !v.archived;
      const isZero = v.qty <= 0;
      if (v.archived) vcls.push('zero');
      else if (isLow) vcls.push('low');
      else if (isZero) vcls.push('zero');
      const qtyCls = ['variant-qty']; if (isLow) qtyCls.push('low'); else if (isZero) qtyCls.push('zero');
      const sub = v.archived ? '🗃 архів' : (isLow ? `⚠ нижче ${v.low_stock_threshold}` : '');
      return `
        <div class="${vcls.join(' ')}">
          <div>
            <div class="variant-label">${esc(v.label)}</div>
            ${sub ? `<div class="variant-sub">${esc(sub)}</div>` : ''}
          </div>
          <div class="${qtyCls.join(' ')}">${v.qty}</div>
          <div class="variant-actions">
            ${w ? `
              <button class="va-btn green" title="Прийняти" onclick="invOpenMoveModal('${esc(it.item_id)}','${esc(v.id)}','intake')">+</button>
              <button class="va-btn red" title="Видати" ${v.qty<=0?'disabled':''} onclick="invOpenMoveModal('${esc(it.item_id)}','${esc(v.id)}','release')">−</button>
              <button class="va-btn gold" title="Списати / Коригувати" onclick="invOpenAdjustModal('${esc(it.item_id)}','${esc(v.id)}')">±</button>
              <button class="va-btn" title="Редагувати варіант" onclick="invOpenVariantModalById('${esc(it.item_id)}','${esc(v.id)}')">✏</button>
            ` : ''}
          </div>
        </div>`;
    }).join('');
    return `
      <article class="${cls.join(' ')}">
        <div class="item-head">
          <div>
            <h3>${esc(it.name)}</h3>
            <div class="item-meta"><span class="cat-chip">${esc(catLabel(it.category))}</span><span>${(it.variants||[]).length} варіант(и)</span></div>
          </div>
          <div class="${totalCls}" title="Всього на складі">${it.total_qty}</div>
        </div>
        <div class="variants">
          ${varsHtml || '<div class="hint">Немає варіантів. Додай нижче →</div>'}
        </div>
        <div class="item-footer">
          <span>${esc(it.notes||'').slice(0,80)}${(it.notes||'').length>80?'…':''}</span>
          <span class="ops">
            ${w ? `
              <button class="btn small" onclick="invOpenVariantModal('${esc(it.item_id)}', null)">+ ВАРІАНТ</button>
              <button class="btn small ghost" onclick="invOpenItemModalById('${esc(it.item_id)}')">✏</button>
            ` : ''}
          </span>
        </div>
      </article>`;
  }
  function catLabel(c){ return ({apparel:'Одяг',print:'Друк',sticker:'Наклейки',accessory:'Аксесуари',other:'Інше'})[c]||c; }

  function renderMovements(){
    const head = `<div class="section-head"><h1>📒 Журнал руху</h1><div class="actions"><span class="hint">останні ${Store.movements.length}</span></div></div>`;
    if (!Store.movements.length) return head + '<div class="empty">Поки немає рухів.</div>';
    const rows = Store.movements.map(m => {
      const sign = (m.type==='intake') ? '+' : '−';
      const cls = (m.type==='intake') ? 'pos' : 'neg';
      const ref = m.reference_url ? `<a href="${esc(m.reference_url)}" target="_blank" style="color:var(--blue);text-decoration:none;">↗</a>` : '';
      return `
        <tr>
          <td>${fmtDt(m.performed_at)}</td>
          <td><span class="mv-type ${m.type}">${typeLabel(m.type)}</span></td>
          <td>${esc(m.item_name)} <span class="variant-sub">/ ${esc(m.variant_label)}</span></td>
          <td class="mv-qty ${cls}">${sign}${m.qty}</td>
          <td>${esc(m.reason||'—')}</td>
          <td>${esc(m.performed_by_name || '—')}</td>
          <td>${ref}</td>
        </tr>`;
    }).join('');
    return head + `
      <div style="overflow-x:auto;">
        <table class="mv-table">
          <thead><tr><th>Час</th><th>Тип</th><th>Товар / варіант</th><th>К-сть</th><th>Причина</th><th>Виконавець</th><th>Реф</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
  function typeLabel(t){ return ({intake:'Прийомка',release:'Видача',writeoff:'Списання',adjust:'Коригування'})[t]||t; }

  function renderAnalytics(){
    const head = `<div class="section-head"><h1>📊 Аналітика складу</h1></div>`;
    const active = Store.items.filter(i=>!i.archived);
    const totalQty = active.reduce((a,i)=>a+(i.total_qty||0),0);
    const lowCount = active.filter(i=>i.any_low).length;
    const zeroVariants = active.reduce((a,i)=>a+(i.variants||[]).filter(v=>!v.archived && v.qty<=0).length, 0);
    // топ по сумарних видачах (release) за 30 днів
    const cutoff = Date.now() - 30*24*60*60*1000;
    const byItem = {};
    Store.movements.forEach(m => {
      if (m.type !== 'release') return;
      const t = new Date(m.performed_at).getTime();
      if (t < cutoff) return;
      byItem[m.item_name] = (byItem[m.item_name]||0) + m.qty;
    });
    const topReleased = Object.entries(byItem).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const topHtml = topReleased.length ? topReleased.map(([name,qty])=>`<div class="an-row"><span>${esc(name)}</span><span class="v">${qty} шт</span></div>`).join('') : '<div class="hint">Поки немає видач за 30 днів.</div>';
    return head + `
      <div class="an-grid">
        <div class="an-card"><h4>Всього на складі</h4><div class="an-num">${totalQty}</div></div>
        <div class="an-card"><h4>Товарних позицій</h4><div class="an-num">${active.length}</div></div>
        <div class="an-card"><h4>З низьким залишком</h4><div class="an-num" style="color:var(--amber);">${lowCount}</div></div>
        <div class="an-card"><h4>Закінчилось (0)</h4><div class="an-num" style="color:var(--red-soft);">${zeroVariants}</div></div>
        <div class="an-card" style="grid-column:1/-1;"><h4>Топ-10 видач (останні 30 днів)</h4>${topHtml}</div>
      </div>`;
  }

  // ============================ Router ============================
  function route() {
    const r = (location.hash || '#stock').replace(/^#/, '').split('?')[0];
    return r || 'stock';
  }
  function render(){
    const r = route();
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === r);
    });
    const main = document.getElementById('appMain');
    if (!main) return;
    let html = '';
    if (r === 'movements') html = renderMovements();
    else if (r === 'analytics') html = renderAnalytics();
    else html = renderStock(r);
    main.innerHTML = html;
  }
  window.addEventListener('hashchange', render);

  // ============================ Init ============================
  async function init(){
    if (!sb()) { console.warn('[inv] supabase not ready, retrying…'); setTimeout(init, 200); return; }
    // topbar btn
    const newBtn = document.getElementById('btnNewItemTop');
    if (newBtn) newBtn.onclick = () => { if (canWrite()) openItemModal(null); else toast('Потрібна роль CEO/COO/lead', 'error'); };
    await Promise.all([Store.loadItems(), Store.loadMovements()]);
    render();
    console.log('[inv] ready — items:', Store.items.length, '· movements:', Store.movements.length);
  }
  window.addEventListener('inv-ready', init);
  // якщо ev вже відбувся
  if (window.invState && window.invState.publicUser) init();

})();
