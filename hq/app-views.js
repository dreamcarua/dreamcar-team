/* ============ BOARD (Approvals) ============ */
function renderBoard(root) {
  const me = Store.currentUser();
  const pubs = Store.pubs();
  const col1 = pubs.filter(p => p.status === 'review' && (p.approvers||[]).includes(me.id));
  const col2 = pubs.filter(p => p.status === 'review' && (p.responsibles||[]).includes(me.id));
  const col3 = pubs.filter(p => p.status === 'rework' && (p.responsibles||[]).includes(me.id));
  const sort = (a,b) => new Date(a.dateTime) - new Date(b.dateTime);
  col1.sort(sort); col2.sort(sort); col3.sort(sort);

  root.innerHTML = `
    <div class="view-header">
      <h1>Дошка погоджень</h1>
      <span class="view-meta">· ${col1.length+col2.length+col3.length} карток</span>
      <div class="actions"></div>
    </div>
    <div class="board-wrap">
      <div class="board-cols">
        <div class="board-col ${col1.length>0?'urgent':''}">
          <div class="col-head">
            <h3>На моє погодження</h3>
            <span class="cnt">${col1.length}</span>
          </div>
          <div class="col-body">${col1.length?col1.map(boardCard).join(''):'<div class="board-empty">🌿 Тут чисто. Гарна робота.</div>'}</div>
        </div>
        <div class="board-col">
          <div class="col-head">
            <h3>Я відправив, чекають мене</h3>
            <span class="cnt">${col2.length}</span>
          </div>
          <div class="col-body">${col2.length?col2.map(boardCard).join(''):'<div class="board-empty">Нічого не на чужому погодженні.</div>'}</div>
        </div>
        <div class="board-col">
          <div class="col-head">
            <h3>Повернуто на доопрацювання</h3>
            <span class="cnt">${col3.length}</span>
          </div>
          <div class="col-body">${col3.length?col3.map(boardCard).join(''):'<div class="board-empty">Жодних повернень.</div>'}</div>
        </div>
      </div>
    </div>
  `;
  attachBoardHandlers();
}
function boardCard(p) {
  const cr = (p.creatives||[]).map(id => Store.creative(id)).filter(Boolean);
  const thumb = cr[0] ? cr[0].preview : '📝';
  const urgency = urgencyClass(p);
  const dueLabel = (() => {
    const diff = daysBetween(new Date(), p.dateTime);
    if (diff < 0) return { txt: 'Пропущено: ' + fmtDate(p.dateTime), cls: 'due-now' };
    if (diff === 0) return { txt: 'Сьогодні о ' + fmtTime(p.dateTime), cls: 'due-now' };
    if (diff === 1) return { txt: 'Завтра ' + fmtTime(p.dateTime), cls: 'due-soon' };
    if (diff <= 3) return { txt: 'Через ' + diff + ' дні · ' + fmtDate(p.dateTime), cls: 'due-soon' };
    return { txt: fmtDate(p.dateTime) + ' · ' + fmtTime(p.dateTime), cls: '' };
  })();
  const respNames = (p.responsibles||[]).map(id => Store.user(id)?.name).filter(Boolean).join(', ');
  return `<div class="board-card ${urgency}" data-id="${p.id}">
    <div class="bc-head">
      <div class="bc-thumb">${thumb}</div>
      <div class="bc-body">
        <div class="bc-title">${escapeHtml(p.title)}</div>
        <div class="bc-meta">${platformIcons(p.platforms)} · ${p.contentType} · ${respNames}</div>
      </div>
    </div>
    <div class="bc-date ${dueLabel.cls}" style="margin-top:8px;">📅 ${dueLabel.txt}</div>
    <div class="bc-actions">
      <button class="btn btn-success btn-sm" data-action="approve" data-id="${p.id}">✓ Погодити</button>
      <button class="btn btn-warn btn-sm" data-action="reject" data-id="${p.id}">↩ Повернути</button>
      <button class="btn btn-sm" data-action="open" data-id="${p.id}">Відкрити</button>
    </div>
  </div>`;
}
function attachBoardHandlers() {
  document.querySelectorAll('.board-card').forEach(el => {
    el.onclick = (e) => {
      if (e.target.closest('button')) return;
      location.hash = '#publication/' + el.dataset.id;
    };
  });
  document.querySelectorAll('.board-card [data-action]').forEach(b => {
    b.onclick = (e) => {
      e.stopPropagation();
      const action = b.dataset.action;
      const id = b.dataset.id;
      if (action === 'open') location.hash = '#publication/' + id;
      else if (action === 'approve') approvePub(id, b);
      else if (action === 'reject') rejectPub(id, b);
    };
  });
}
// Глобальний lock-флаг щоб запобігти повторним натисканням і UI hang.
let _workflowInFlight = false;
function setBtnBusy(btn, on, busyText = 'Зачекай…') {
  if (!btn) return;
  if (on) {
    btn._originalHtml = btn._originalHtml || btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:spin 0.7s linear infinite;margin-right:6px;vertical-align:-2px;"></span>${busyText}`;
  } else {
    btn.disabled = false;
    if (btn._originalHtml) { btn.innerHTML = btn._originalHtml; btn._originalHtml = null; }
  }
}

async function approvePub(id, sourceBtn) {
  if (_workflowInFlight) { toast('Зачекай завершення попередньої дії', 'warn'); return; }
  const p = Store.pub(id); if (!p) return;
  const me = Store.currentUser();
  if (!(p.approvers||[]).includes(me.id)) { toast('Тільки погоджувач може затвердити', 'error'); return; }
  const comment = prompt('Коментар (опційно):', '');
  _workflowInFlight = true;
  setBtnBusy(sourceBtn, true, 'Погоджую…');
  try {
    p.status = 'approved';
    p.updatedAt = new Date().toISOString();
    await Store.upsertPub(p);
    await Store.addHistory(id, 'approve', comment || '');
    if (comment) await Store.addComment(id, comment);
    toast('Погоджено', 'success', p.title);
    navigate();
  } catch (err) {
    console.error('approvePub failed:', err);
    if (BACKEND_MODE) { try { await Store._loadFromBackend(); navigate(); } catch(_){} }
    toast('Помилка', 'error', err.message || 'не вдалось зберегти');
  } finally {
    _workflowInFlight = false;
    setBtnBusy(sourceBtn, false);
  }
}
async function rejectPub(id, sourceBtn) {
  if (_workflowInFlight) { toast('Зачекай завершення попередньої дії', 'warn'); return; }
  const p = Store.pub(id); if (!p) return;
  const me = Store.currentUser();
  if (!(p.approvers||[]).includes(me.id)) { toast('Тільки погоджувач може повернути', 'error'); return; }
  const comment = prompt('Чому повертаєш? (обов\'язково)', '');
  if (!comment || !comment.trim()) { toast('Коментар обов\'язковий', 'warn'); return; }
  _workflowInFlight = true;
  setBtnBusy(sourceBtn, true, 'Повертаю…');
  try {
    p.status = 'rework';
    p.updatedAt = new Date().toISOString();
    await Store.upsertPub(p);
    await Store.addHistory(id, 'reject', comment);
    await Store.addComment(id, comment);
    toast('Повернено на доопрацювання', 'warn', p.title);
    navigate();
  } catch (err) {
    console.error('rejectPub failed:', err);
    if (BACKEND_MODE) { try { await Store._loadFromBackend(); navigate(); } catch(_){} }
    toast('Помилка', 'error', err.message || 'не вдалось зберегти');
  } finally {
    _workflowInFlight = false;
    setBtnBusy(sourceBtn, false);
  }
}

/* ============ LIBRARY ============ */
function renderLibrary(root) {
  root.innerHTML = `
    <div class="view-header">
      <h1>Бібліотека креативів</h1>
      <span class="view-meta">· ${Store.creatives().length} файлів</span>
      <div class="actions">
        <button class="btn" id="libUpload">📁 Завантажити</button>
      </div>
    </div>
    <div class="library-wrap">
      <div class="library-toolbar">
        <div class="segmented" id="libType">
          <button class="btn-segmented on" data-type="all">Усі</button>
          <button class="btn-segmented" data-type="photo">Фото</button>
          <button class="btn-segmented" data-type="video">Відео</button>
          <button class="btn-segmented" data-type="doc">Документи</button>
        </div>
        <input id="libSearch" placeholder="Пошук по назві, тегах…" style="background:var(--bg-3);border:1px solid var(--border);color:#fff;padding:7px 12px;border-radius:8px;font-size:13px;flex:1;max-width:300px;"/>
      </div>
      <div class="library-grid" id="libGrid"></div>
    </div>
  `;
  document.getElementById('libUpload').onclick = () => {
    if (typeof window.uploadCreativeFile !== 'function') {
      toast('Upload не готовий', 'warn', 'app-drive.js не завантажився. Спробуй F5');
      return;
    }
    var fi = document.createElement('input');
    fi.type = 'file';
    fi.multiple = true;
    fi.accept = 'image/*,video/*,application/pdf';
    fi.onchange = async function(){
      var files = Array.from(fi.files || []);
      for (var f of files) {
        try { await window.uploadCreativeFile(f, null); } catch(e){ console.warn('[lib upload]', f.name, e); }
      }
      if (typeof renderLibrary === 'function') renderLibrary(document.getElementById('main'));
    };
    fi.click();
  };
  document.querySelectorAll('#libType .btn-segmented').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#libType .btn-segmented').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      renderLibGrid(b.dataset.type, document.getElementById('libSearch').value);
    };
  });
  document.getElementById('libSearch').oninput = (e) => {
    const t = document.querySelector('#libType .btn-segmented.on').dataset.type;
    renderLibGrid(t, e.target.value);
  };
  renderLibGrid('all', '');
}
function renderLibGrid(type, q) {
  let cr = Store.creatives();
  if (type !== 'all') cr = cr.filter(c => c.type === type);
  if (q) {
    const Q = q.toLowerCase();
    cr = cr.filter(c => (c.name + ' ' + (c.tags||[]).join(' ')).toLowerCase().includes(Q));
  }
  const grid = document.getElementById('libGrid');
  if (!cr.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1;"><div class="empty-icon">📦</div><div class="empty-title">Нічого не знайдено</div></div>'; return; }
  grid.innerHTML = cr.map(c => {
    const u = Store.user(c.uploadedBy);
    const dur = c.duration ? `<div class="lt-dur">${formatDur(c.duration)}</div>` : '';
    return `<div class="lib-tile" data-id="${c.id}">
      <div class="lt-preview" style="background:linear-gradient(135deg, ${c.color}33, transparent)">
        ${c.preview}
        <div class="lt-type-badge">${c.type}</div>
        ${dur}
      </div>
      <div class="lt-info">
        <div class="lt-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</div>
        <div class="lt-meta">${c.size} · ${c.res}</div>
        <div class="lt-tags">${(c.tags||[]).slice(0,3).map(t => `<span class="lt-tag">#${escapeHtml(t)}</span>`).join('')}</div>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('.lib-tile').forEach(el => {
    el.onclick = () => openCreative(el.dataset.id);
  });
}
function formatDur(s) {
  const m = Math.floor(s/60), ss = s % 60;
  return `${m}:${String(ss).padStart(2,'0')}`;
}
function openCreative(id) {
  const c = Store.creative(id); if (!c) return;
  const usedIn = Store.pubs().filter(p => (p.creatives||[]).includes(id));
  Modal.open(`
    <div class="modal-head">
      <h2>${escapeHtml(c.name)}</h2>
      <span class="modal-meta">${c.type} · ${c.size} · ${c.res}${c.duration?' · '+formatDur(c.duration):''}</span>
      <button class="close" onclick="Modal.close()">×</button>
    </div>
    <div class="modal-body">
      <div style="background:linear-gradient(135deg, ${c.color}33, transparent);border:1px solid var(--border);border-radius:10px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;font-size:72px;color:#fff;margin-bottom:18px;">${c.preview}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;">
        <div>
          <h4 style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey);margin-bottom:8px;font-weight:700;">Інформація</h4>
          <div style="display:grid;gap:8px;font-size:13px;">
            <div>📁 <b style="color:#fff">${escapeHtml(c.name)}</b></div>
            <div>📦 ${c.size}, ${c.res}${c.duration?', '+formatDur(c.duration):''}</div>
            <div>👤 Завантажив: <b style="color:#fff">${Store.user(c.uploadedBy)?.name||'—'}</b></div>
            <div>📅 ${fmtDateTime(c.uploadedAt)}</div>
            <div>🏷️ ${(c.tags||[]).map(t=>'#'+t).join(' ') || '—'}</div>
          </div>
        </div>
        <div>
          <h4 style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey);margin-bottom:8px;font-weight:700;">Використовується в публікаціях</h4>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${usedIn.length?usedIn.map(p=>`<a href="#publication/${p.id}" style="background:var(--bg-3);border:1px solid var(--border);border-radius:6px;padding:8px 12px;font-size:12px;color:#fff;text-decoration:none;display:block;" onclick="Modal.close()">${escapeHtml(p.title)} <small style="color:var(--grey)">· ${fmtDate(p.dateTime)}</small></a>`).join(''):'<div style="color:var(--grey);font-size:12px;padding:8px 0;">Не використовується.</div>'}
          </div>
        </div>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn" onclick="(function(){ var url=document.querySelector('#__crModalUrl')?.value; if(url){ var a=document.createElement('a'); a.href=url; a.download=''; a.click(); } else { toast('Завантаження', 'warn', 'URL креативу недоступний'); } })()">⬇ Завантажити оригінал</button>
      <button class="btn btn-danger" onclick="Modal.close()">Закрити</button>
    </div>
  `);
}

/* ============ LAUNCHES ============ */
function renderLaunches(root) {
  root.innerHTML = `
    <div class="view-header">
      <h1>Запуски</h1>
      <span class="view-meta">· ${Store.launches().length} активних</span>
    </div>
    <div class="library-wrap">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;">
      ${Store.launches().map(l => {
        const pubs = Store.pubs().filter(p => p.launch === l.id);
        const byStatus = STATUSES.map(s => ({ s, n: pubs.filter(p=>p.status===s.id).length }));
        return `<div style="background:var(--bg-2);border:1px solid var(--border);border-left:4px solid ${l.color};border-radius:10px;padding:18px 20px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <h3 style="font-size:16px;font-weight:700;color:#fff;">${escapeHtml(l.name)}</h3>
            <span style="font-size:11px;color:var(--grey);">${fmtDate(l.from,{short:true})} — ${fmtDate(l.to,{short:true})}</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">
            ${byStatus.filter(x=>x.n>0).map(x => `<span class="status ${x.s.id}">${x.s.label}: ${x.n}</span>`).join('')}
          </div>
          <div style="font-size:12px;color:var(--grey);">Усього публікацій: <b style="color:#fff">${pubs.length}</b></div>
        </div>`;
      }).join('')}
      </div>
    </div>
  `;
}

/* ============ PUBLICATION CARD ============ */
let cardAutosaveTimer = null;
function openCard(id) {
  let p = id === 'new' ? newPubObject() : Store.pub(id);
  if (!p) { toast('Публікацію не знайдено', 'error'); location.hash = '#calendar'; return; }
  const me = Store.currentUser();

  Modal.open(`
    <div class="modal-head">
      <h2 id="cardTitle">${escapeHtml(p.title || 'Нова публікація')}</h2>
      <span class="status ${p.status}" id="cardStatusBadge">${STATUS_BY_ID[p.status].label}</span>
      <div class="autosave saved" id="autosaveInd"><div class="dot"></div><span id="autosaveText">Збережено</span></div>
      <button class="close" onclick="Modal.close()">×</button>
    </div>
    <div class="modal-body" id="cardBody">${renderCardBody(p)}</div>
    <div class="modal-foot">
      <div class="left">
        <button class="btn btn-danger" id="btnDelete">🗑 Видалити</button>
      </div>
      ${renderCardWorkflowButtons(p, me)}
    </div>
  `);
  attachCardHandlers(p);
  Modal.onClose = () => { if (cardAutosaveTimer) clearTimeout(cardAutosaveTimer); };
}
function deadlineFromDate(dt) {
  const d = new Date(dt);
  d.setDate(d.getDate() - 2);
  return d.toISOString().slice(0, 10);
}
function activeLaunchFor(dt) {
  const day = new Date(dt).toISOString().slice(0, 10);
  const candidates = (Store.launches() || []).filter(l => {
    const f = l.from || l.starts_on, t = l.to || l.ends_on;
    return f && t && f <= day && day <= t;
  });
  candidates.sort((a, b) => (b.from || '').localeCompare(a.from || ''));
  return candidates[0]?.id || null;
}

function newPubObject(forDate) {
  const dt = forDate ? new Date(forDate) : new Date();
  dt.setHours(12, 0, 0, 0);
  const ceoUser = Store.users().find(u => u.role === 'ceo');
  return {
    id: 'p_' + uid(),
    title: '',
    dateTime: dt.toISOString(),
    platforms: [],
    rubric: '',
    contentType: 'Пост',
    text: '',
    hashtags: [],
    creatives: [],
    responsibles: [Store.currentUser().id],
    deadline: deadlineFromDate(dt),
    approvers: ceoUser ? [ceoUser.id] : [Store.currentUser().id],
    approverPolicy: 'all',
    status: 'draft',
    launch: activeLaunchFor(dt),
    comments: [],
    history: [{ id: uid(), at: new Date().toISOString(), author: Store.currentUser().id, action: 'create', detail: '' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    _isNew: true,
    _autoDeadline: true,
    _autoLaunch: true,
  };
}
function renderCardBody(p) {
  const dt = new Date(p.dateTime);
  const dtLocal = dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0') + 'T' + String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
  return `
    <div class="pub-card-layout">
      <div>
        <div class="field" style="margin-bottom:14px;">
          <label>Назва <span class="req">*</span></label>
          <input type="text" id="f_title" maxlength="120" value="${escapeHtml(p.title)}" placeholder="Audi E-tron — тест-драйв" />
        </div>
        <div class="form-row" style="margin-bottom:14px;">
          <div class="field">
            <label>Дата і час <span class="req">*</span></label>
            <input type="datetime-local" id="f_dateTime" value="${dtLocal}"/>
          </div>
          <div class="field">
            <label>Тип контенту <span class="req">*</span></label>
            <select id="f_contentType">${CONTENT_TYPES.map(t=>`<option ${p.contentType===t?'selected':''}>${t}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field" style="margin-bottom:14px;">
          <label>Майданчики <span class="req">*</span></label>
          <div class="chip-row" id="f_platforms">
            ${PLATFORMS.map(pl => `<div class="chip ${p.platforms.includes(pl.id)?'on':''}" data-platform="${pl.id}">${pl.icon} ${pl.name}</div>`).join('')}
          </div>
        </div>
        <div class="field" style="margin-bottom:14px;">
          <label>Текст публікації <span class="req">*</span></label>
          <textarea id="f_text" maxlength="5000" placeholder="Текст поста…">${escapeHtml(p.text||'')}</textarea>
          <div class="hint"><span id="f_textCount">${(p.text||'').length}</span>/5000 символів</div>
        </div>
        <div class="field" style="margin-bottom:14px;">
          <label>Хештеги</label>
          <input type="text" id="f_hashtags" value="${(p.hashtags||[]).join(' ')}" placeholder="#dreamcar #автомрії"/>
          <div class="hint">Розділяй пробілами. Хештеги — для SEO та пошуку, ліміту немає.</div>
        </div>
        <div class="pub-section">
          <h4>Креативи</h4>
          <div class="creative-strip" id="f_creatives">
            ${(p.creatives||[]).map(cid => {
              const c = Store.creative(cid); if (!c) return '';
              return `<div class="cs-item" data-id="${cid}" title="${escapeHtml(c.name)}">${c.preview}<div class="cs-remove" data-remove="${cid}">×</div></div>`;
            }).join('')}
            <div class="cs-add" id="addCreativeBtn">+</div>
          </div>
        </div>

        <div class="pub-section">
          <h4>Прев'ю</h4>
          <div id="previewSection">${renderPreviewSection(p)}</div>
        </div>

        <div class="tabs" id="cardTabs">
          <div class="tab active" data-tab="comments">💬 Коментарі <span style="font-size:10px;color:var(--grey);">(${(p.comments||[]).length})</span></div>
          <div class="tab" data-tab="history">📜 Історія</div>
        </div>
        <div id="tabContent">${renderCommentsTab(p)}</div>
      </div>

      <div>
        <div class="meta-list">
          <div class="meta-item">
            <span class="ml-label">Рубрика <span class="req">*</span></span>
            <select id="f_rubric" class="ml-value" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:7px 10px;border-radius:6px;font-size:13px;">
              <option value="">— Обрати —</option>
              ${Store.rubrics().map(r => `<option value="${r.id}" ${p.rubric===r.id?'selected':''}>${r.name}</option>`).join('')}
            </select>
          </div>
          <div class="meta-item">
            <span class="ml-label">Відповідальні <span class="req">*</span></span>
            <div class="chip-row" id="f_resp">
              ${Store.activeUsers().map(u => `<div class="chip ${p.responsibles.includes(u.id)?'on':''}" data-user="${u.id}">${u.initial} · ${escapeHtml(u.name)}</div>`).join('')}
            </div>
          </div>
          <div class="meta-item">
            <span class="ml-label">Дедлайн матеріалу</span>
            <input type="date" id="f_deadline" value="${p.deadline||''}" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:7px 10px;border-radius:6px;font-size:13px;"/>
          </div>
          <div class="meta-item">
            <span class="ml-label">Погоджувачі</span>
            <div class="chip-row" id="f_appr">
              ${Store.activeUsers().filter(u=>['ceo','coo','lead'].includes(u.role)).map(u => `<div class="chip ${p.approvers.includes(u.id)?'on':''}" data-user="${u.id}">${u.initial} · ${escapeHtml(u.name)}</div>`).join('')}
            </div>
          </div>
          <div class="meta-item">
            <span class="ml-label">Зв'язаний із запуском</span>
            <select id="f_launch" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:7px 10px;border-radius:6px;font-size:13px;">
              <option value="">— Немає —</option>
              ${Store.launches().map(l => `<option value="${l.id}" ${p.launch===l.id?'selected':''}>${escapeHtml(l.name)}</option>`).join('')}
            </select>
          </div>
          <div class="meta-item">
            <span class="ml-label">Статус виконання</span>
            <select id="f_workStatus" style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:7px 10px;border-radius:6px;font-size:13px;">
              <option value="" ${!p.workStatus?'selected':''}>— Не вказано —</option>
              <option value="script"  ${p.workStatus==='script'?'selected':''}>✍️ Пишу сценарій</option>
              <option value="design"  ${p.workStatus==='design'?'selected':''}>🎨 Роблю дизайн</option>
              <option value="editing" ${p.workStatus==='editing'?'selected':''}>🎬 Роблю монтаж</option>
              <option value="done"    ${p.workStatus==='done'?'selected':''}>✅ Зробив</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  `;
}
function renderPreviewSection(p) {
  const cr = (p.creatives || []).map(id => Store.creative(id)).filter(Boolean);
  const firstMedia = cr[0]?.preview || '🚗';
  const firstColor = cr[0]?.color || '#E30613';
  const txt = escapeHtml(p.text || '').replace(/(#[\p{L}\p{N}_]+)/gu, '<span class="pv-hash">$1</span>');
  const hashLine = (p.hashtags || []).map(h => h.startsWith('#') ? h : '#' + h).join(' ');
  const hashHtml = hashLine ? `<div style="margin-top:6px;color:var(--blue-soft);font-size:11px;">${escapeHtml(hashLine).replace(/(#\S+)/g, '<span class="pv-hash">$1</span>')}</div>` : '';

  const showIg = p.platforms.includes('ig');
  const showTg = p.platforms.includes('tg');
  if (!showIg && !showTg) {
    return `<div style="color:var(--grey);font-size:12px;padding:8px 0;">Оберіть Instagram або Telegram у майданчиках — побачите прев'ю.</div>`;
  }

  const igCard = !showIg ? '' : `
    <div class="preview-card ig">
      <div class="pv-head">
        <div class="pv-avatar">DC</div>
        <div><div class="pv-name">dreamcar.ua</div><div class="pv-handle">Sponsored</div></div>
      </div>
      <div class="pv-media" style="background: linear-gradient(135deg, ${firstColor}33, var(--bg-2))">${firstMedia}</div>
      <div class="pv-actions">♥ &nbsp; 💬 &nbsp; ↗ &nbsp; <span style="margin-left:auto">🔖</span></div>
      <div class="pv-text"><b>dreamcar.ua</b> ${txt || '<i style="color:var(--grey)">(пусто)</i>'}${hashHtml}</div>
    </div>`;
  const tgCard = !showTg ? '' : `
    <div class="preview-card tg">
      <div class="pv-head">
        <div class="pv-avatar">DC</div>
        <div><div class="pv-name">Dream Car</div><div class="pv-handle">@dreamcar_ua · ${fmtDate(new Date())} ${fmtTime(p.dateTime)}</div></div>
      </div>
      <div class="pv-media tg" style="background: linear-gradient(135deg, ${firstColor}33, var(--bg-2))">${firstMedia}</div>
      <div class="pv-text">${txt || '<i style="color:var(--grey)">(пусто)</i>'}${hashHtml}</div>
    </div>`;

  return `<div class="preview-row">${igCard}${tgCard}</div>`;
}
function refreshPreview(p) {
  const wrap = document.getElementById('previewSection');
  if (wrap) wrap.innerHTML = renderPreviewSection(p);
}

function renderCommentsTab(p) {
  const list = (p.comments||[]).map(c => {
    const u = Store.user(c.author);
    return `<div class="comment">
      <div class="c-head"><span class="c-author">${u?.name||'?'}</span><span class="c-time">${fmtDateTime(c.at)}</span></div>
      <div class="c-body">${escapeHtml(c.body)}</div>
    </div>`;
  }).join('') || '<div style="color:var(--grey);font-size:12px;padding:8px 0;">Немає коментарів.</div>';
  return `<div id="commentsList">${list}</div>
    <div class="comment-input">
      <input id="newComment" placeholder="Додати коментар…"/>
      <button class="btn btn-primary btn-sm" id="addCommentBtn">Надіслати</button>
    </div>`;
}
function renderHistoryTab(p) {
  const items = (p.history||[]).slice().reverse().map(h => {
    const u = Store.user(h.author);
    const actionMap = { create:'створив(ла) публікацію', status:'змінив(ла) статус →', approve:'погодив(ла)', reject:'повернув(ла) на доопрацювання', move:'переніс(ла) дату', edit:'відредагував(ла)' };
    return `<div class="history-item">
      <span class="h-time">${fmtDateTime(h.at)}</span>
      <span class="h-author">${u?.name||'?'}</span>
      <span class="h-action">${actionMap[h.action]||h.action}</span>
      ${h.detail?'<span class="h-detail">'+escapeHtml(h.detail)+'</span>':''}
    </div>`;
  }).join('') || '<div style="color:var(--grey);font-size:12px;padding:8px 0;">Історія порожня.</div>';
  return items;
}
function renderCardWorkflowButtons(p, me) {
  const transitions = [];
  const isResp = (p.responsibles||[]).includes(me.id) || me.role === 'lead';
  const isAppr = (p.approvers||[]).includes(me.id);
  if (p.status === 'draft' && isResp) transitions.push({ to:'in_work', label:'Взяти в роботу', cls:'btn' });
  if (p.status === 'in_work' && isResp) transitions.push({ to:'review', label:'→ На погодження', cls:'btn-primary' });
  if (p.status === 'review' && isAppr) {
    transitions.push({ to:'approved', label:'✓ Погодити', cls:'btn-success' });
    transitions.push({ to:'rework', label:'↩ Повернути', cls:'btn-warn' });
  }
  if (p.status === 'rework' && isResp) transitions.push({ to:'review', label:'→ На погодження', cls:'btn-primary' });
  if (p.status === 'approved' && (isResp || isAppr)) transitions.push({ to:'published', label:'🚀 Позначити опублікованою', cls:'btn-success' });
  return `<button class="btn" onclick="Modal.close()">Закрити</button>` +
    transitions.map(t => `<button class="btn ${t.cls}" data-transition="${t.to}">${t.label}</button>`).join('');
}
function attachCardHandlers(p) {
  document.querySelectorAll('#f_platforms .chip').forEach(c => {
    c.onclick = () => {
      const id = c.dataset.platform;
      const ix = p.platforms.indexOf(id);
      if (ix >= 0) p.platforms.splice(ix, 1);
      else p.platforms.push(id);
      c.classList.toggle('on');
      autosave(p);
    };
  });
  document.querySelectorAll('#f_resp .chip').forEach(c => {
    c.onclick = () => {
      const id = c.dataset.user;
      const ix = p.responsibles.indexOf(id);
      if (ix >= 0) p.responsibles.splice(ix, 1);
      else p.responsibles.push(id);
      c.classList.toggle('on');
      autosave(p);
    };
  });
  document.querySelectorAll('#f_appr .chip').forEach(c => {
    c.onclick = () => {
      const id = c.dataset.user;
      const ix = p.approvers.indexOf(id);
      if (ix >= 0) p.approvers.splice(ix, 1);
      else p.approvers.push(id);
      c.classList.toggle('on');
      autosave(p);
    };
  });
  const fields = [
    ['f_title','title','text'],['f_text','text','text'],['f_rubric','rubric','select'],
    ['f_contentType','contentType','select'],['f_deadline','deadline','date'],
    ['f_launch','launch','select'],
    ['f_workStatus','workStatus','select'],
  ];
  fields.forEach(([fid, key]) => {
    const el = document.getElementById(fid);
    if (!el) return;
    el.oninput = () => { p[key] = el.value; autosave(p); };
    el.onchange = () => {
      p[key] = el.value;
      if (fid === 'f_deadline') p._autoDeadline = false;
      if (fid === 'f_launch')   p._autoLaunch = false;
      autosave(p);
    };
  });
  const dtEl = document.getElementById('f_dateTime');
  if (dtEl) dtEl.onchange = () => {
    p.dateTime = new Date(dtEl.value).toISOString();
    if (p._autoDeadline !== false) {
      p.deadline = deadlineFromDate(p.dateTime);
      const dlEl = document.getElementById('f_deadline');
      if (dlEl) dlEl.value = p.deadline;
    }
    if (p._autoLaunch !== false) {
      const newLaunch = activeLaunchFor(p.dateTime);
      if (newLaunch !== p.launch) {
        p.launch = newLaunch;
        const lEl = document.getElementById('f_launch');
        if (lEl) lEl.value = newLaunch || '';
      }
    }
    autosave(p);
  };
  const hashEl = document.getElementById('f_hashtags');
  if (hashEl) hashEl.oninput = () => {
    p.hashtags = hashEl.value.split(/\s+/).filter(Boolean);
    autosave(p);
  };
  const textCount = () => {
    const el = document.getElementById('f_textCount');
    if (el) el.textContent = (document.getElementById('f_text').value||'').length;
  };
  document.getElementById('f_text').oninput = () => { p.text = document.getElementById('f_text').value; textCount(); autosave(p); };

  document.querySelectorAll('#f_creatives .cs-remove').forEach(rb => {
    rb.onclick = (e) => {
      e.stopPropagation();
      const cid = rb.dataset.remove;
      p.creatives = (p.creatives||[]).filter(x => x !== cid);
      rb.closest('.cs-item').remove();
      autosave(p);
    };
  });
  document.getElementById('addCreativeBtn').onclick = () => {
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.multiple = true;
    fi.accept = 'image/*,video/*,application/pdf';
    fi.style.display = 'none';
    document.body.appendChild(fi);
    fi.onchange = async () => {
      for (const f of fi.files) await uploadCreativeFile(f, p);
      fi.remove();
    };
    fi.click();
  };
  const stripEl = document.getElementById('f_creatives');
  if (stripEl) {
    let dragCount = 0;
    stripEl.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault(); dragCount++;
      stripEl.style.outline = '2px dashed var(--green)';
      stripEl.style.outlineOffset = '4px';
    });
    stripEl.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    stripEl.addEventListener('dragleave', () => {
      dragCount--;
      if (dragCount <= 0) { dragCount = 0; stripEl.style.outline = ''; }
    });
    stripEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCount = 0;
      stripEl.style.outline = '';
      const files = Array.from(e.dataTransfer?.files || []);
      for (const f of files) await uploadCreativeFile(f, p);
    });
  }
  document.getElementById('addCreativeBtn').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openCreativePicker(p);
  });
  document.getElementById('addCreativeBtn').title = 'Клік — завантажити файли · ПКМ — обрати з бібліотеки · drag-drop теж працює';

  document.querySelectorAll('#cardTabs .tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('#cardTabs .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const cont = document.getElementById('tabContent');
      if (t.dataset.tab === 'comments') {
        cont.innerHTML = renderCommentsTab(p);
        bindComments(p);
      } else {
        cont.innerHTML = renderHistoryTab(p);
      }
    };
  });
  bindComments(p);

  document.querySelectorAll('[data-transition]').forEach(b => {
    b.onclick = () => transitionStatus(p, b.dataset.transition, b);
  });

  document.getElementById('btnDelete').onclick = () => {
    if (!confirm('Видалити публікацію «' + p.title + '»? Це необоротно.')) return;
    if (!p._isNew) Store.deletePub(p.id);
    Modal.close();
    toast('Видалено', 'warn');
    location.hash = '#calendar';
  };
}
function bindComments(p) {
  const btn = document.getElementById('addCommentBtn');
  const inp = document.getElementById('newComment');
  if (!btn || !inp) return;
  const submit = () => {
    const v = inp.value.trim();
    if (!v) return;
    Store.addComment(p.id, v);
    inp.value = '';
    const cont = document.getElementById('tabContent');
    cont.innerHTML = renderCommentsTab(p);
    bindComments(p);
    toast('Коментар додано', 'success');
  };
  btn.onclick = submit;
  inp.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
}
function openCreativePicker(p) {
  const used = new Set(p.creatives||[]);
  Modal.open(`
    <div class="modal-head">
      <h2>Обрати креатив</h2>
      <button class="close" onclick="reopenCard('${p.id}')">×</button>
    </div>
    <div class="modal-body">
      <div class="library-grid">
        ${Store.creatives().map(c => `
          <div class="lib-tile" data-pick="${c.id}" style="${used.has(c.id)?'opacity:0.5;outline:2px solid var(--green);':''}">
            <div class="lt-preview" style="background:linear-gradient(135deg, ${c.color}33, transparent)">${c.preview}<div class="lt-type-badge">${c.type}</div></div>
            <div class="lt-info">
              <div class="lt-name">${escapeHtml(c.name)}</div>
              <div class="lt-meta">${c.size}${c.duration?' · '+formatDur(c.duration):''}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="reopenCard('${p.id}')">Готово</button></div>
  `, 'modal-md');
  document.querySelectorAll('.lib-tile[data-pick]').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.pick;
      if (used.has(id)) {
        p.creatives = (p.creatives||[]).filter(x => x !== id);
        used.delete(id);
        el.style.opacity = '1';
        el.style.outline = '';
      } else {
        p.creatives = [...(p.creatives||[]), id];
        used.add(id);
        el.style.outline = '2px solid var(--green)';
        el.style.opacity = '0.7';
      }
      autosave(p);
    };
  });
}
function reopenCard(id) { Modal.close(); setTimeout(()=>openCard(id), 100); }

function autosave(p) {
  const ind = document.getElementById('autosaveInd');
  const txt = document.getElementById('autosaveText');
  if (ind) { ind.className = 'autosave saving'; txt.textContent = 'Зберігаю…'; }
  refreshPreview(p);
  if (cardAutosaveTimer) clearTimeout(cardAutosaveTimer);
  cardAutosaveTimer = setTimeout(() => {
    p.updatedAt = new Date().toISOString();
    if (p._isNew) { delete p._isNew; }
    Store.upsertPub(p);
    if (ind) { ind.className = 'autosave saved'; txt.textContent = 'Збережено о ' + fmtTime(new Date()); }
    const ct = document.getElementById('cardTitle');
    if (ct) ct.textContent = p.title || 'Нова публікація';
  }, 700);
}

async function transitionStatus(p, to, sourceBtn) {
  if (_workflowInFlight) { toast('Зачекай завершення попередньої дії', 'warn'); return; }
  if (to === 'review') {
    const missing = [];
    if (!p.title) missing.push('Назва');
    if (!p.platforms.length) missing.push('Майданчики');
    if (!p.rubric) missing.push('Рубрика');
    if (!p.text) missing.push('Текст');
    if (p.contentType !== 'Лонгрід' && (!p.creatives || !p.creatives.length)) missing.push('Креативи');
    if (missing.length) { toast('Не вистачає полів', 'error', missing.join(', ')); return; }
  }
  if (to === 'rework' || to === 'approved') {
    const me = Store.currentUser();
    if (!p.approvers.includes(me.id)) { toast('Тільки погоджувач може це робити', 'error'); return; }
  }
  let comment = '';
  if (to === 'rework') {
    comment = prompt('Чому повертаєш? (обов\'язково)', '');
    if (!comment || !comment.trim()) { toast('Коментар обов\'язковий', 'warn'); return; }
  } else if (to === 'approved') {
    comment = prompt('Коментар (опційно):', '') || '';
  }

  _workflowInFlight = true;
  setBtnBusy(sourceBtn, true, 'Зберігаю…');
  const oldStatus = p.status;
  try {
    p.status = to;
    p.updatedAt = new Date().toISOString();
    await Store.upsertPub(p);
    if (to === 'rework') {
      await Store.addComment(p.id, comment);
      await Store.addHistory(p.id, 'reject', comment);
    } else if (to === 'approved') {
      if (comment) await Store.addComment(p.id, comment);
      await Store.addHistory(p.id, 'approve', comment);
    } else {
      await Store.addHistory(p.id, 'status', `${STATUS_BY_ID[oldStatus].label} → ${STATUS_BY_ID[to].label}`);
    }
    toast('Статус: ' + STATUS_BY_ID[to].label, 'success');
    Modal.close();
    navigate();
  } catch (err) {
    console.error('transitionStatus failed:', err);
    p.status = oldStatus;
    if (BACKEND_MODE) { try { await Store._loadFromBackend(); navigate(); } catch(_){} }
    toast('Помилка', 'error', err.message || 'не вдалось зберегти');
  } finally {
    _workflowInFlight = false;
    setBtnBusy(sourceBtn, false);
  }
}

function createPub(date) {
  // 🛡 ORPHAN DRAFT FIX 03.06.2026: НЕ персистимо у БД доки юзер не введе title.
  // Раніше: відкриття модалки = Untitled draft у DB. Закрив без вводу → orphan.
  // Тепер: тримаємо у memory (Store._data.publications) тільки. Persist при першому save (handleSavePub).
  const p = newPubObject(date || new Date());
  // Локальний optimistic insert без _persistPub
  const ix = Store._data.publications.findIndex(x => x.id === p.id);
  if (ix >= 0) Store._data.publications[ix] = p; else Store._data.publications.push(p);
  // _isNew залишаємо — при close без save видалимо локально
  location.hash = '#publication/' + p.id;
}

/* ============ Role switch / Bell / Search / Shortcuts ============ */
function renderRoleBadge() {
  const me = Store.currentUser();
  if (!me) return;
  document.getElementById('roleAvatar').textContent = me.initial;
  document.getElementById('roleName').textContent = me.name;
  document.getElementById('roleTag').textContent = ROLES.find(r=>r.id===me.role)?.tag || me.role;
}

document.getElementById('roleSwitch').onclick = () => {
  if (BACKEND_MODE) {
    const me = Store.currentUser();
    Modal.open(`
      <div class="modal-head">
        <h2>${escapeHtml(me?.name || '—')}</h2>
        <span class="modal-meta">${escapeHtml(me?.email || '')} · ${ROLES.find(r=>r.id===me?.role)?.tag || me?.role || ''}</span>
        <button class="close" onclick="Modal.close()">×</button>
      </div>
      <div class="modal-body" style="padding:8px;">
        <div class="dropdown-item" onclick="toast('Профіль', 'info', 'Налаштування у наступній ітерації')">👤 Профіль</div>
        <div class="dropdown-item" onclick="toast('Сповіщення', 'info', 'Налаштування у наступній ітерації')">🔔 Налаштування сповіщень</div>
        <div class="dropdown-divider"></div>
        <div class="dropdown-item danger" onclick="HQ.signOut()">↪ Вийти</div>
      </div>
    `, 'modal-sm');
    return;
  }
  const me = Store.currentUser();
  const users = Store.users();
  const items = users.map(u => `<div class="dropdown-item" data-user="${u.id}">${avatarHtml(u.id, 22)} ${escapeHtml(u.name)} <span style="margin-left:auto;color:var(--grey);font-size:10px;text-transform:uppercase;">${ROLES.find(r=>r.id===u.role)?.tag}</span></div>`).join('');
  const w = `
    <div class="modal-head">
      <h2>Перемкнути роль (демо)</h2>
      <span class="modal-meta">Без реальної авторизації</span>
      <button class="close" onclick="Modal.close()">×</button>
    </div>
    <div class="modal-body" style="padding:8px;">${items}</div>
  `;
  Modal.open(w, 'modal-sm');
  document.querySelectorAll('.dropdown-item[data-user]').forEach(el => {
    el.onclick = () => {
      Store.setCurrentUser(el.dataset.user);
      renderRoleBadge();
      navigate();
      Modal.close();
      toast('Роль перемкнено', 'info', Store.currentUser().name);
    };
  });
};

document.getElementById('bellBtn').onclick = () => {
  const me = Store.currentUser();
  const board = Store.pubs().filter(p => p.status === 'review' && (p.approvers||[]).includes(me.id));
  const missed = Store.pubs().filter(p => urgencyClass(p) === 'missed');
  const urgent = Store.pubs().filter(p => urgencyClass(p) === 'urgent-red');
  const items = [];
  for (const p of board) items.push({ icon:'✅', title:'Чекає твого погодження', body:p.title, link:'#publication/'+p.id });
  for (const p of urgent) items.push({ icon:'🔥', title:'Горить, статус не «Погоджено»', body:p.title, link:'#publication/'+p.id });
  for (const p of missed) items.push({ icon:'⚠️', title:'Пропущена публікація', body:p.title, link:'#publication/'+p.id });
  if (!items.length) items.push({ icon:'🌿', title:'Усе тихо', body:'Жодних нових сповіщень', link:null });
  Modal.open(`
    <div class="modal-head"><h2>Сповіщення</h2><span class="modal-meta">${items.length} активних</span><button class="close" onclick="Modal.close()">×</button></div>
    <div class="modal-body" style="padding:8px;">
      ${items.map(i => `<div class="dropdown-item" ${i.link?`onclick="location.hash='${i.link}'; Modal.close()"`:''}>
        <div style="font-size:18px">${i.icon}</div>
        <div><div style="font-weight:600;color:#fff">${escapeHtml(i.title)}</div><div style="font-size:11px;color:var(--grey)">${escapeHtml(i.body)}</div></div>
      </div>`).join('')}
    </div>
  `, 'modal-sm');
};

document.getElementById('globalSearch').oninput = (e) => {
  App.searchQuery = e.target.value;
  if (['calendar','board','library'].includes(App.view)) navigate();
};

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'c' || e.key === 'C') { createPub(new Date()); }
  else if (e.key === '/') { e.preventDefault(); document.getElementById('globalSearch').focus(); }
  else if (e.key === '1') { App.calendarMode = 'month'; renderCalendar(document.getElementById('main')); }
  else if (e.key === '2') { App.calendarMode = 'week'; renderCalendar(document.getElementById('main')); }
  else if (e.key === '3') { App.calendarMode = 'day'; renderCalendar(document.getElementById('main')); }
  else if (e.key === '4') { App.calendarMode = 'list'; renderCalendar(document.getElementById('main')); }
});

/* ============ Auth flow ============ */
const Auth = {
  async checkSession() {
    if (!window.HQ_BACKEND) return null;
    const { data: { session } } = await window.supabase.auth.getSession();
    return session;
  },

  async loadCurrentUser(session) {
    const sb = window.supabase;
    const { data: existing, error: e1 } = await sb.from('users').select('*').eq('auth_id', session.user.id).maybeSingle();
    if (e1) console.warn('Load user:', e1);
    if (existing) return existing;
    const email = session.user.email;
    const { data: byEmail } = await sb.from('users').select('*').eq('email', email).maybeSingle();
    if (byEmail) {
      await sb.from('users').update({ auth_id: session.user.id }).eq('id', byEmail.id);
      return byEmail;
    }
    const meta = session.user.user_metadata || {};
    const { data: created, error: e2 } = await sb.from('users').insert({
      auth_id: session.user.id,
      email,
      name: meta.full_name || meta.name || email.split('@')[0],
      role: 'member',
    }).select().single();
    if (e2) { console.error('Create user:', e2); throw e2; }
    return created;
  },

  async signInGoogle() {
    const { error } = await window.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + location.pathname }
    });
    if (error) showAuthError(error.message);
  },

  async signOut() {
    if (!window.HQ_BACKEND) return;
    await window.supabase.auth.signOut();
    location.reload();
  },
};

function showAuthScreen(opts = {}) {
  const sc = document.getElementById('authScreen');
  sc.classList.add('shown');
  document.getElementById('authContent').style.display = opts.loading ? 'none' : 'block';
  document.getElementById('authLoading').style.display = opts.loading ? 'flex' : 'none';
  if (window.HQ_CONFIG?.TG_LOGIN_BOT) {
    document.getElementById('authTgWrap').style.display = 'block';
    initTgLoginWidget();
  }
  if (window.HQ_CONFIG?.ALLOW_DEMO_FALLBACK !== false) {
    document.getElementById('authDemoLink').style.display = 'inline-block';
  }
}
function hideAuthScreen() {
  document.getElementById('authScreen').classList.remove('shown');
}
function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('shown');
}
function initTgLoginWidget() {
  const wrap = document.getElementById('authTgWidget');
  if (wrap.dataset.inited) return;
  wrap.dataset.inited = '1';
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://telegram.org/js/telegram-widget.js?22';
  s.setAttribute('data-telegram-login', window.HQ_CONFIG.TG_LOGIN_BOT);
  s.setAttribute('data-size', 'large');
  s.setAttribute('data-onauth', 'onTgAuth(user)');
  s.setAttribute('data-request-access', 'write');
  wrap.appendChild(s);
}
window.onTgAuth = async function(user) {
  toast('TG Login приймає авторизацію', 'info', 'Перевірка hash буде на Edge Function пізніше');
};

/* ============ Bootstrap (async) ============ */
async function boot() {
  if (typeof window.HQ_BACKEND === 'undefined') {
    await new Promise(r => window.addEventListener('hq-loader-ready', r, { once: true }));
  }

  const ind = document.getElementById('backendIndicator');
  if (window.HQ_BACKEND) {
    showAuthScreen({ loading: true });
    try {
      // SAFETY: timeout 12s + auto-recover з stale tokens (Invalid Refresh Token etc)
      let session = null;
      try {
        const sessionPromise = Auth.checkSession();
        session = await Promise.race([
          sessionPromise,
          new Promise((_, rej) => setTimeout(() => rej(new Error('Session check timeout')), 12000))
        ]);
      } catch (toErr) {
        console.warn('[boot] session check failed — clearing stale auth state:', toErr.message);
        // Stale token (Invalid Refresh Token / expired) — clean localStorage + show login
        try {
          Object.keys(localStorage).filter(k => k.startsWith('sb-') || k.includes('supabase')).forEach(k => localStorage.removeItem(k));
          if (window.supabase?.auth) { await window.supabase.auth.signOut().catch(()=>{}); }
        } catch(_) {}
        session = null;
      }
      if (!session) {
        showAuthScreen({ loading: false });
        ind.className = 'backend-indicator demo';
        document.getElementById('backendIndicatorLabel').textContent = 'Не залогінений';
        ind.style.display = 'flex';
        return;
      }
      const me = await Auth.loadCurrentUser(session);
      SUPABASE_USER_ID = session.user.id;
      // 🛡 SESSION BLEED FIX 03.06.2026: якщо localStorage містить ДАНІ ІНШОГО юзера —
      // повністю його скидаємо ПЕРЕД Store.init() щоб не показати previous user state.
      try {
        var rawCached = localStorage.getItem(STORE_KEY);
        if (rawCached) {
          var parsed = JSON.parse(rawCached);
          if (parsed && parsed.currentUserId && parsed.currentUserId !== me.id) {
            console.warn('[session-bleed-guard] localStorage user mismatch (' + parsed.currentUserId + ' → ' + me.id + ') → drop cached state');
            localStorage.removeItem(STORE_KEY);
            // Also wipe SW caches — щоб старі responses від попередньої сесії не повернулись
            if (window.caches && caches.keys) {
              caches.keys().then(function (keys) { keys.forEach(function (k) { caches.delete(k); }); });
            }
          }
        }
      } catch (_) {}
      await Store.init();
      Store._data.currentUserId = me.id;
      // Перезаписуємо localStorage із правильним currentUserId
      try { if (typeof Store._saveLocal === 'function') Store._saveLocal(); } catch (_) {}
      hideAuthScreen();
      ind.className = 'backend-indicator live';
      document.getElementById('backendIndicatorLabel').textContent = 'Live · ' + me.name;
      ind.style.display = 'flex';
      // 03.06.2026: ?next=... redirect для Tasks→HQ і Dashboard→HQ login bridge
      try {
        var qs = new URLSearchParams(location.search);
        var nextParam = qs.get('next');
        var isDashboard = qs.get('dashboard') === '1';
        if (isDashboard) {
          // Redirect на dashboard.dreamcar.ua з оригінальним path
          var dashUrl = 'https://dashboard.dreamcar.ua' + (nextParam && /^\/[\w/#-]*$/.test(nextParam) ? nextParam : '/');
          console.log('[auth] login complete → dashboard:', dashUrl);
          setTimeout(function () { window.location.href = dashUrl; }, 200);
        } else if (nextParam && /^\/[a-z0-9_-]+\/?$/i.test(nextParam)) {
          console.log('[auth] login complete → redirect to', nextParam);
          setTimeout(function () { window.location.href = nextParam; }, 200);
        }
      } catch (_) {}
      // Підпис на auth change — ТІЛЬКИ SIGNED_OUT тригерить reload (інакше TOKEN_REFRESHED викликав loop)
      // Disabled 03.06.2026 (Давид: login loop між HQ↔Tasks). Init-time mismatch check вище достатньо.
      try {
        window.supabase.auth.onAuthStateChange(function (evt, sess) {
          // Тільки явний SIGNED_OUT (інакше TOKEN_REFRESHED / INITIAL_SESSION з Tasks tab тригерить reload)
          if (evt === 'SIGNED_OUT') {
            console.warn('[session-guard] explicit SIGNED_OUT → cleanup local state');
            try { localStorage.removeItem(STORE_KEY); } catch (_) {}
            // Не reload автоматично — нехай UI покаже login screen природно через showAuthScreen
          }
        });
      } catch (_) {}
    } catch (e) {
      console.error('Boot error:', e);
      showAuthError(e.message || 'Помилка завантаження');
      showAuthScreen({ loading: false });
      return;
    }
  } else {
    await Store.init();
    ind.className = 'backend-indicator demo';
    document.getElementById('backendIndicatorLabel').textContent = 'Demo (localStorage)';
    ind.style.display = 'flex';
  }

  renderRoleBadge();
  renderSidebarFilters();
  if (!location.hash) location.hash = '#calendar';
  navigate();
}

document.getElementById('authGoogle').onclick = () => Auth.signInGoogle();
document.getElementById('authDemoLink').onclick = () => {
  window.HQ_BACKEND = false;
  hideAuthScreen();
  boot();
};

window.HQ = {
  reset() { Store.reset(); location.reload(); },
  seed: SEED,
  store: Store,
  auth: Auth,
  signOut: () => Auth.signOut(),
};

console.log('%cDreamCar HQ %cv0.2 (Supabase-aware)', 'color:#E30613;font-weight:800;font-size:14px;', 'color:#888;');
console.log('Команди: HQ.reset() — скинути demo дані. HQ.signOut() — вийти. HQ.store — інспектор.');

boot();
