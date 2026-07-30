// retention/app-retention.js — DreamCar Ретеншн стіл
// 05.06.2026 — Phase 1: clone SMM structure for newsletter/TG broadcast planning

(function(){
'use strict';

const CH_LABELS = {
  email: { ic: '📧', name: 'Email', cls: 'chip-channel-email' },
  tg:    { ic: '📨', name: 'Telegram', cls: 'chip-channel-tg' },
  push:  { ic: '🔔', name: 'Push', cls: 'chip-channel-push' },
  sms:   { ic: '💬', name: 'SMS', cls: 'chip-channel-sms' },
  viber: { ic: '📱', name: 'Viber', cls: 'chip-channel-viber' },
  other: { ic: '📤', name: 'Інше', cls: 'chip-channel-other' },
};
const ST_LABELS = {
  draft:     { name: 'Чернетка',       cls: 'chip-status-draft' },
  review:    { name: 'На погодженні',  cls: 'chip-status-review' },
  approved:  { name: 'Погоджено',      cls: 'chip-status-approved' },
  scheduled: { name: 'У черзі',        cls: 'chip-status-scheduled' },
  sending:   { name: 'Відправляється', cls: 'chip-status-sending' },
  sent:      { name: 'Відправлено',    cls: 'chip-status-sent' },
  failed:    { name: 'Помилка',        cls: 'chip-status-failed' },
  rework:    { name: 'На доопрацюванні',cls: 'chip-status-rework' },
  archived:  { name: 'Архів',          cls: 'chip-status-archived' },
};

const ALL_CHANNELS = Object.keys(CH_LABELS);
const ALL_STATUSES = Object.keys(ST_LABELS);

const Store = window.retStore = {
  messages: [],
  byId: new Map(),
  users: [],
  projects: [],
  // #547 14.06: рубрики для border-left на card (синхронно зі SMM Store.rubrics)
  rubrics: [],
  rubricsById: new Map(),
  route: 'all',
  loading: false,
  selected: null,
  // 06.06.2026 — повна parity з SMM календарем
  calView: 'month',           // month | week | day | list | board
  calDate: new Date(),        // anchor date для navigation
  search: '',
  channelFilter: new Set(),   // filter chips
  statusFilter: new Set(),
  // #547 29.06.2026 — Davyd UX: фільтр по рубриках (продажний/експертний/розважальний/новинний/партнерський)
  rubricFilter: new Set(),
};

// #547: helper для кольору border-left по rubric_id
function rubricColor(rubricId){
  if (!rubricId) return '#666';
  const r = Store.rubricsById.get(rubricId);
  return (r && r.color) ? r.color : '#666';
}

function ymd(d){ const dd = new Date(d); const y=dd.getFullYear(); const m=String(dd.getMonth()+1).padStart(2,'0'); const day=String(dd.getDate()).padStart(2,'0'); return `${y}-${m}-${day}`; }
function addDays(d, n){ const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function startOfWeek(d){ const r = new Date(d); const dow = (r.getDay() + 6) % 7; r.setDate(r.getDate()-dow); r.setHours(0,0,0,0); return r; }
function startOfMonth(d){ const r = new Date(d); r.setDate(1); r.setHours(0,0,0,0); return r; }

function tg(role){ return window.retState && window.retState.publicUser && window.retState.publicUser.role === role; }
function isPriv(){ return window.retState && window.retState.publicUser && ['ceo','coo','lead'].includes(window.retState.publicUser.role); }
// 09.06.2026 #194 — Quick-status chip-row для CEO/COO (миттєвий перехід без submit)
function isCeoCoo(){ return window.retState && window.retState.publicUser && ['ceo','coo'].includes(window.retState.publicUser.role); }
const RET_QS_STATUSES = [
  { v:'draft',     lbl:'📝 Draft' },
  { v:'review',    lbl:'👀 Review' },
  { v:'approved',  lbl:'✅ Approved' },
  { v:'scheduled', lbl:'⏰ Scheduled' },
  { v:'sending',   lbl:'📡 Sending' },
  { v:'sent',      lbl:'📤 Sent' },
  { v:'failed',    lbl:'❌ Failed' },
  { v:'rework',    lbl:'↩ Rework' },
  { v:'archived',  lbl:'🗄 Archived' }
];

async function loadAll(){
  Store.loading = true;
  const supabase = window.supabase;
  if (!supabase) return;
  try {
    // #421: окрім своїх — підвантажуємо SMM ghost-події для cross-system візуалізації
    const ghostFrom = new Date(); ghostFrom.setMonth(ghostFrom.getMonth() - 2);
    const ghostTo = new Date(); ghostTo.setMonth(ghostTo.getMonth() + 6);
    const [msgs, users, projects, approvers, responsibles, ghostSmm, rubrics] = await Promise.all([
      supabase.from('retention_messages').select('*').is('deleted_at', null).order('publish_at', { ascending: false }).limit(500),
      // 08.06.2026 Vira fix: users.deleted_at НЕ ІСНУЄ → запит повертав null → dropdowns approvers/responsibles порожні.
      supabase.from('users').select('id,name,email,role').eq('is_active', true).order('name'),
      // 08.06.2026 Vira fix: launches не має deleted_at і starts_at (а тільки starts_on).
      supabase.from('launches').select('id,name,status').order('starts_on', { ascending: false }).limit(100),
      supabase.from('retention_message_approvers').select('*'),
      supabase.from('retention_message_responsibles').select('*'),
      supabase.rpc('ghost_calendar_events', { p_source: 'smm', p_from: ghostFrom.toISOString(), p_to: ghostTo.toISOString() }),
      // #547: rubrics для border-left card-кольору
      supabase.from('rubrics').select('id,name,color').order('sort_order'),
    ]);
    Store.rubrics = (rubrics && !rubrics.error) ? (rubrics.data || []) : [];
    Store.rubricsById = new Map(Store.rubrics.map(r => [r.id, r]));
    Store.ghostSmm = (ghostSmm && !ghostSmm.error) ? (ghostSmm.data || []) : [];
    if (msgs.error) throw msgs.error;
    const aMap = new Map();
    const rMap = new Map();
    (approvers.data || []).forEach(a => {
      if (!aMap.has(a.message_id)) aMap.set(a.message_id, []);
      aMap.get(a.message_id).push(a);
    });
    (responsibles.data || []).forEach(r => {
      if (!rMap.has(r.message_id)) rMap.set(r.message_id, []);
      rMap.get(r.message_id).push(r);
    });
    Store.messages = (msgs.data || []).map(m => ({
      ...m,
      _approvers: aMap.get(m.id) || [],
      _responsibles: rMap.get(m.id) || [],
    }));
    Store.byId = new Map(Store.messages.map(m => [m.id, m]));
    Store.users = users.data || [];
    Store.projects = projects.data || [];
    renderAll();
  } catch (e) {
    console.error('[ret/load]', e);
    if (window.toast) window.toast('Не вдалось завантажити: ' + e.message, 'error');
  } finally {
    Store.loading = false;
  }
}

function getRouteFilter(){
  const r = Store.route || 'all';
  if (r === 'all') return m => true;
  if (r === 'board') return m => ['draft','review','approved'].includes(m.status);
  if (r === 'calendar') return m => true;
  if (r === 'templates') return m => m.status === 'archived' && m.notes && m.notes.includes('#template');
  if (r.startsWith('ch-')) {
    const ch = r.slice(3);
    return m => m.channel === ch;
  }
  if (r.startsWith('st-')) {
    const st = r.slice(3);
    return m => m.status === st;
  }
  return m => true;
}

function updateCounters(){
  const all = Store.messages.length;
  const board = Store.messages.filter(m => ['draft','review','approved'].includes(m.status)).length;
  const cal = Store.messages.length;
  setCount('cnt-all', all);
  setCount('cnt-board', board);
  setCount('cnt-cal', cal);
  ALL_CHANNELS.forEach(ch => {
    setCount('cnt-' + ch, Store.messages.filter(m => m.channel === ch).length);
  });
  ALL_STATUSES.forEach(st => {
    setCount('cnt-' + st, Store.messages.filter(m => m.status === st).length);
  });
}
function setCount(id, n){ const e = document.getElementById(id); if (e) e.textContent = n; }

function renderAll(){
  updateCounters();
  highlightRoute();
  renderRubricSidebar();
  renderMain();
}

// #547 29.06.2026 — Davyd UX: рендер блоку "Рубрика" у sidebar (multi-select chips)
function renderRubricSidebar(){
  const host = document.getElementById('retSidebarRubric');
  if (!host) return;
  const rubrics = Store.rubrics || [];
  if (!rubrics.length) {
    host.innerHTML = '<div style="color:var(--ash); font-size:11px; padding:4px 0;">— немає рубрик —</div>';
    return;
  }
  host.innerHTML = rubrics.map(r => {
    const cnt = Store.messages.filter(m => m.rubric_id === r.id).length;
    const on = Store.rubricFilter && Store.rubricFilter.has(r.id);
    const color = r.color || '#666';
    const name = String(r.name || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    return `<div class="ret-filter-chip ${on ? 'on' : ''}" data-rub="${r.id}">
      <span class="ret-dot" style="background:${color}"></span>
      <span>${name}</span>
      <span class="ret-cnt">${cnt}</span>
    </div>`;
  }).join('');
  host.querySelectorAll('.ret-filter-chip').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.rub;
      if (!Store.rubricFilter) Store.rubricFilter = new Set();
      if (Store.rubricFilter.has(id)) Store.rubricFilter.delete(id);
      else Store.rubricFilter.add(id);
      renderRubricSidebar();
      renderMain();
    };
  });
}

function highlightRoute(){
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const cur = document.querySelector(`.nav-item[data-route="${Store.route}"]`);
  if (cur) cur.classList.add('active');
}

function renderMain(){
  const main = document.getElementById('appMain');
  if (!main) return;
  const r = Store.route || 'all';
  if (r === 'calendar') return renderCalendar(main);
  if (r === 'board') return renderBoard(main);
  if (r === 'templates') return renderTemplates(main);
  return renderList(main);
}

function escHtml(s){ return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmtDate(s){
  if (!s) return '—';
  try {
    const d = new Date(s);
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${dd}.${mm}.${yy} ${hh}:${mi}`;
  } catch(_) { return s; }
}

function getRouteLabel(){
  const r = Store.route;
  if (r === 'all') return 'Всі розсилки';
  if (r === 'board') return 'Дошка погоджень';
  if (r === 'calendar') return 'Календар розсилок';
  if (r === 'templates') return 'Шаблони';
  if (r.startsWith('ch-')) return 'Канал · ' + (CH_LABELS[r.slice(3)]?.name || r.slice(3));
  if (r.startsWith('st-')) return 'Статус · ' + (ST_LABELS[r.slice(3)]?.name || r.slice(3));
  return r;
}

function renderList(main){
  // #547 29.06.2026 — Davyd UX: + фільтр по рубриках
  const items = applyRubricFilter(Store.messages.filter(getRouteFilter()));
  const headHtml = `
    <div class="section-head">
      <h1>📬 ${escHtml(getRouteLabel())} <span style="color:var(--ash); font-size:14px; margin-left:8px;">(${items.length})</span></h1>
      <div class="actions">
        <button class="btn" id="btnRefresh">🔄 ОНОВИТИ</button>
        <button class="btn primary" id="btnNew">+ НОВА РОЗСИЛКА</button>
      </div>
    </div>
  `;
  if (!items.length) {
    main.innerHTML = headHtml + `
      <div class="empty">
        <div style="font-size:48px; margin-bottom:14px;">📭</div>
        <div>Тут поки порожньо.</div>
        <div style="margin-top:10px; font-size:12px;">Натисни <b>+ НОВА РОЗСИЛКА</b> щоб створити першу.</div>
      </div>
    `;
    bindHeadActions();
    return;
  }
  const rows = items.map(m => {
    const ch = CH_LABELS[m.channel] || CH_LABELS.other;
    const st = ST_LABELS[m.status] || ST_LABELS.draft;
    const proj = m.project_id ? (Store.projects.find(p => p.id === m.project_id)?.name || '—') : '—';
    // #547: border-left=рубрика-колір
    const rc = rubricColor(m.rubric_id);
    return `
      <div class="msg-row" data-id="${m.id}" style="border-left:4px solid ${rc};">
        <span class="chip ${ch.cls}">${ch.ic} ${escHtml(ch.name)}</span>
        <span class="chip ${st.cls}">${escHtml(st.name)}</span>
        <div>
          <div class="msg-row-title">${escHtml(m.title || '(без назви)')}</div>
          <div class="msg-row-meta">${escHtml(m.preview_text || (m.body || '').replace(/<[^>]+>/g,'').slice(0,120) || '—')}</div>
        </div>
        <div class="msg-row-meta">📅 ${fmtDate(m.publish_at)}</div>
        <div class="msg-row-meta">📁 ${escHtml(proj)}</div>
        <div class="msg-row-meta">${m.audience_count != null ? '👥 ' + m.audience_count : '—'}</div>
      </div>
    `;
  }).join('');
  main.innerHTML = headHtml + `<div class="list">${rows}</div>`;
  bindHeadActions();
  main.querySelectorAll('.msg-row').forEach(r => {
    r.onclick = () => openMessageDetail(r.dataset.id);
  });
}

function renderBoard(main){
  const cols = ['draft','review','approved','scheduled','sent','failed'];
  const f = getRouteFilter();
  // #547 29.06.2026 — Davyd UX: + фільтр по рубриках
  const items = applyRubricFilter(Store.messages.filter(f));
  const groups = {};
  cols.forEach(c => groups[c] = []);
  items.forEach(m => { if (groups[m.status]) groups[m.status].push(m); });
  const colHtml = cols.map(c => {
    const st = ST_LABELS[c];
    return `
      <div style="background:var(--bg-2); border:1px solid var(--steel); border-radius:10px; padding:14px; min-height:300px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <span class="chip ${st.cls}">${escHtml(st.name)}</span>
          <span style="color:var(--ash); font-size:11px;">${groups[c].length}</span>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          ${groups[c].map(m => {
            const ch = CH_LABELS[m.channel] || CH_LABELS.other;
            // #547: border-left=рубрика-колір
            const rc = rubricColor(m.rubric_id);
            return `
              <div class="msg-card" data-id="${m.id}" style="background:var(--bg-3); border:1px solid var(--line); border-left:4px solid ${rc}; border-radius:6px; padding:10px; cursor:pointer;">
                <div style="display:flex; gap:6px; margin-bottom:6px;">
                  <span class="chip ${ch.cls}">${ch.ic}</span>
                </div>
                <div style="font-size:13px; color:#fff; font-weight:700;">${escHtml(m.title || '(без назви)').slice(0, 60)}</div>
                <div style="font-size:11px; color:var(--ash); margin-top:4px;">📅 ${fmtDate(m.publish_at)}</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
  main.innerHTML = `
    <div class="section-head">
      <h1>✅ Дошка погоджень <span style="color:var(--ash); font-size:14px; margin-left:8px;">(${items.length})</span></h1>
      <div class="actions">
        <button class="btn" id="btnRefresh">🔄 ОНОВИТИ</button>
        <button class="btn primary" id="btnNew">+ НОВА РОЗСИЛКА</button>
      </div>
    </div>
    <div style="padding:20px 24px; display:grid; grid-template-columns:repeat(${cols.length}, 1fr); gap:14px;">${colHtml}</div>
  `;
  bindHeadActions();
  main.querySelectorAll('.msg-card').forEach(r => r.onclick = () => openMessageDetail(r.dataset.id));
}

// ============================================================
// CALENDAR — повна parity з SMM (Місяць/Тиждень/День/Список/Дошка)
// ============================================================

function filteredMessages(){
  const q = (Store.search || '').toLowerCase().trim();
  return Store.messages.filter(m => {
    if (Store.channelFilter.size && !Store.channelFilter.has(m.channel)) return false;
    if (Store.statusFilter.size && !Store.statusFilter.has(m.status)) return false;
    // #547 29.06.2026 — Davyd UX: фільтр по рубриках
    if (Store.rubricFilter && Store.rubricFilter.size && (!m.rubric_id || !Store.rubricFilter.has(m.rubric_id))) return false;
    if (q && !((m.title||'').toLowerCase().includes(q) || (m.body||'').toLowerCase().includes(q) || (m.preview_text||'').toLowerCase().includes(q))) return false;
    return true;
  });
}

// #547 29.06.2026 — Davyd UX: helper для фільтру по рубриках, який застосовується
// поверх getRouteFilter() (для renderList/renderBoard).
function applyRubricFilter(items){
  if (!Store.rubricFilter || !Store.rubricFilter.size) return items;
  return items.filter(m => m.rubric_id && Store.rubricFilter.has(m.rubric_id));
}

function calRangeLabel(){
  const d = Store.calDate;
  const months = ['січень','лютий','березень','квітень','травень','червень','липень','серпень','вересень','жовтень','листопад','грудень'];
  if (Store.calView === 'month') return `${months[d.getMonth()]} ${d.getFullYear()} р.`;
  if (Store.calView === 'week') {
    const ws = startOfWeek(d);
    const we = addDays(ws, 6);
    return `${ws.getDate()} ${months[ws.getMonth()].slice(0,3)} — ${we.getDate()} ${months[we.getMonth()].slice(0,3)} ${we.getFullYear()}`;
  }
  if (Store.calView === 'day') {
    const dow = ['неділя','понеділок','вівторок','середа','четвер','пʼятниця','субота'];
    return `${dow[d.getDay()]} · ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  }
  return 'Всі розсилки';
}

function shiftCalDate(direction){
  const d = new Date(Store.calDate);
  if (Store.calView === 'month') d.setMonth(d.getMonth() + direction);
  else if (Store.calView === 'week') d.setDate(d.getDate() + 7*direction);
  else d.setDate(d.getDate() + direction);
  Store.calDate = d;
  renderMain();
}

function renderCalendarHeader(){
  const items = filteredMessages();
  return `
    <div class="section-head">
      <h1>📅 Календар розсилок <span style="color:var(--ash); font-size:14px; margin-left:8px;">· ${items.length} ${items.length === 1 ? 'розсилка' : 'розсилок'}</span></h1>
      <div class="actions" style="flex-wrap:wrap;">
        <div style="display:flex; gap:4px; background:var(--bg-3); padding:3px; border-radius:6px;">
          ${/* #226: прибрав 'list' і 'board' — дублюють sidebar (Vadym UX) */ ['month','week','day'].map(v => `<button class="btn" data-view="${v}" style="padding:7px 12px; font-size:10px; ${Store.calView===v?'background:var(--red); border-color:var(--red); color:#fff;':'background:transparent; border:none; color:#ccc;'}">${{month:'МІСЯЦЬ',week:'ТИЖДЕНЬ',day:'ДЕНЬ'}[v]}</button>`).join('')}
        </div>
        <button class="btn" id="btnRefresh">🔄</button>
        <button class="btn primary" id="btnNew">+ НОВА РОЗСИЛКА</button>
      </div>
    </div>
    <div style="padding:14px 24px; display:flex; gap:10px; align-items:center; flex-wrap:wrap; border-bottom:1px solid var(--line); background:var(--bg-2);">
      <button class="btn" id="navPrev" style="padding:8px 12px;">←</button>
      <div style="font-family:'Oswald',sans-serif; font-size:16px; min-width:200px; text-align:center;">${escHtml(calRangeLabel())}</div>
      <button class="btn" id="navNext" style="padding:8px 12px;">→</button>
      <button class="btn" id="navToday">СЬОГОДНІ</button>
      <input id="calSearch" type="search" placeholder="🔍 Пошук розсилки…" value="${escHtml(Store.search)}" style="flex:1 1 200px; min-width:140px; padding:8px 12px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px; font-family:inherit; font-size:12px;">
      <div style="display:flex; gap:4px; flex-wrap:wrap;">
        ${ALL_CHANNELS.map(c => {
          const on = Store.channelFilter.has(c);
          const lbl = CH_LABELS[c];
          return `<button class="btn cal-ch" data-ch="${c}" style="padding:6px 10px; font-size:10px; ${on?'background:'+(lbl.cls.includes('blue')?'#60A5FA':lbl.cls.includes('purple')?'#a5b4fc':'var(--red)')+';border-color:transparent;color:#000;':'background:var(--bg-3);'}">${lbl.ic} ${lbl.name}</button>`;
        }).join('')}
      </div>
    </div>
  `;
}

function bindCalControls(){
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = (e) => { Store.calView = b.dataset.view; renderMain(); });
  const np = document.getElementById('navPrev'); if (np) np.onclick = () => shiftCalDate(-1);
  const nn = document.getElementById('navNext'); if (nn) nn.onclick = () => shiftCalDate(1);
  const nt = document.getElementById('navToday'); if (nt) nt.onclick = () => { Store.calDate = new Date(); renderMain(); };
  const s = document.getElementById('calSearch');
  if (s) {
    let t = null;
    s.oninput = () => { clearTimeout(t); t = setTimeout(() => { Store.search = s.value; renderMain(); s.focus(); }, 300); };
  }
  document.querySelectorAll('.cal-ch').forEach(b => b.onclick = () => {
    const c = b.dataset.ch;
    if (Store.channelFilter.has(c)) Store.channelFilter.delete(c); else Store.channelFilter.add(c);
    renderMain();
  });
  bindHeadActions();
}

function renderCalendar(main){
  const v = Store.calView;
  const items = filteredMessages().filter(m => m.publish_at);
  const byDay = {};
  items.forEach(m => {
    const k = ymd(m.publish_at);
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(m);
  });
  // #421 Ghost events з SMM: показуємо як приглушені нашого календаря
  // #423 fix: RPC ghost_calendar_events повертає `scheduled_at`, не `publish_at`
  (Store.ghostSmm || []).forEach(g => {
    const ts = g.scheduled_at || g.publish_at;
    if (!ts) return;
    const k = ymd(ts);
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push({ ...g, _ghost: 'smm', publish_at: ts });
  });
  Object.values(byDay).forEach(arr => arr.sort((a,b) => new Date(a.publish_at) - new Date(b.publish_at)));

  if (v === 'list')  return renderCalList(main, items);
  if (v === 'board') return renderBoard(main);

  let bodyHtml = '';
  if (v === 'month') bodyHtml = renderMonthGrid(byDay);
  else if (v === 'week') bodyHtml = renderWeekView(byDay);
  else if (v === 'day') bodyHtml = renderDayView(byDay);

  main.innerHTML = renderCalendarHeader() + `<div style="padding:18px 24px;">${bodyHtml}</div>`;
  bindCalControls();
  main.querySelectorAll('.cal-item').forEach(r => r.onclick = (e) => { e.stopPropagation(); openMessageDetail(r.dataset.id); });
  main.querySelectorAll('.cal-cell-add').forEach(c => c.onclick = (e) => {
    if (e.target.classList.contains('cal-item')) return;
    Store._prefillDate = c.dataset.date;
    openMessageDetail(null);
  });
}

function renderMonthGrid(byDay){
  const d = Store.calDate;
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const dow = (first.getDay() + 6) % 7;
  const gridStart = addDays(first, -dow);
  const today = ymd(new Date());
  const cellsHtml = [];
  for (let i = 0; i < 42; i++) {
    const cd = addDays(gridStart, i);
    const k = ymd(cd);
    const inMonth = cd.getMonth() === d.getMonth();
    const isToday = k === today;
    const dayItems = byDay[k] || [];
    cellsHtml.push(`
      <div class="cal-cell-add" data-date="${k}" style="background:${inMonth ? 'var(--bg-2)' : 'var(--bg)'}; border:1px solid ${isToday ? 'var(--red)' : 'var(--line)'}; padding:8px; min-height:110px; border-radius:6px; opacity:${inMonth ? 1 : 0.45}; cursor:pointer;">
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <span style="font-size:12px; color:${isToday ? 'var(--red)' : 'var(--ash)'}; font-weight:700;">${cd.getDate()}</span>
          ${dayItems.length ? `<span style="font-size:9px; color:var(--ash);">${dayItems.length}</span>` : ''}
        </div>
        <div style="display:flex; flex-direction:column; gap:3px; margin-top:5px;">
          ${dayItems.slice(0, 4).map(m => calItem(m, 'short')).join('')}
          ${dayItems.length > 4 ? `<div style="font-size:9px; color:var(--ash);">+${dayItems.length - 4}…</div>` : ''}
        </div>
      </div>
    `);
  }
  return `
    <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:4px; font-size:10px; color:var(--ash); margin-bottom:6px; padding:0 8px; font-weight:700;">
      <div>ПН</div><div>ВТ</div><div>СР</div><div>ЧТ</div><div>ПТ</div><div>СБ</div><div>НД</div>
    </div>
    <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:4px;">${cellsHtml.join('')}</div>
  `;
}

function renderWeekView(byDay){
  const ws = startOfWeek(Store.calDate);
  const today = ymd(new Date());
  const cols = [];
  const dowLabels = ['ПОНЕДІЛОК','ВІВТОРОК','СЕРЕДА','ЧЕТВЕР','ПʼЯТНИЦЯ','СУБОТА','НЕДІЛЯ'];
  for (let i = 0; i < 7; i++) {
    const cd = addDays(ws, i);
    const k = ymd(cd);
    const items = byDay[k] || [];
    const isToday = k === today;
    cols.push(`
      <div class="cal-cell-add" data-date="${k}" style="background:var(--bg-2); border:1px solid ${isToday ? 'var(--red)' : 'var(--line)'}; padding:10px; min-height:400px; border-radius:6px; cursor:pointer;">
        <div style="font-size:10px; color:${isToday ? 'var(--red)' : 'var(--ash)'}; font-weight:700; margin-bottom:4px;">${dowLabels[i]}</div>
        <div style="font-size:18px; font-family:'Oswald',sans-serif; color:${isToday ? 'var(--red)' : '#fff'}; margin-bottom:10px;">${cd.getDate()}</div>
        <div style="display:flex; flex-direction:column; gap:5px;">${items.map(m => calItem(m, 'medium')).join('')}</div>
      </div>
    `);
  }
  return `<div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:6px;">${cols.join('')}</div>`;
}

function renderDayView(byDay){
  const k = ymd(Store.calDate);
  const items = byDay[k] || [];
  if (!items.length) {
    return `<div class="empty">
      <div style="font-size:48px;">📅</div>
      <div>На цей день — жодної розсилки.</div>
      <button class="btn primary cal-cell-add" data-date="${k}" style="margin-top:14px;">+ Створити на цей день</button>
    </div>`;
  }
  const hourSlots = {};
  items.forEach(m => {
    const dt = new Date(m.publish_at);
    const h = dt.getHours();
    if (!hourSlots[h]) hourSlots[h] = [];
    hourSlots[h].push(m);
  });
  const rows = [];
  for (let h = 0; h < 24; h++) {
    const slot = hourSlots[h] || [];
    if (!slot.length && h < 6) continue;
    rows.push(`
      <div style="display:grid; grid-template-columns:60px 1fr; gap:14px; padding:10px 0; border-bottom:1px solid var(--line);">
        <div style="color:var(--ash); font-size:12px; font-family:'JetBrains Mono',monospace;">${String(h).padStart(2,'0')}:00</div>
        <div style="display:flex; flex-direction:column; gap:5px;">${slot.length ? slot.map(m => calItem(m, 'full')).join('') : '<span style="color:#444; font-size:11px;">—</span>'}</div>
      </div>
    `);
  }
  return `<div>${rows.join('')}</div>`;
}

function calItem(m, size){
  // #421 Ghost SMM event — приглушений, неклікабельний, з 📢 префіксом
  if (m._ghost === 'smm') {
    const dt = new Date(m.publish_at);
    const hh = String(dt.getHours()).padStart(2,'0');
    const mm = String(dt.getMinutes()).padStart(2,'0');
    const title = (m.title || '(SMM)');
    const channels = (m.channels || []).map(c => c === 'tg' ? '📢' : c === 'ig' ? '📷' : c === 'fb' ? 'ⓕ' : '').join('');
    const tip = `SMM · ${channels || 'канал'} · ${hh}:${mm} · ${title.replace(/"/g,'')}`;
    if (size === 'short') {
      return `<div class="cal-item-ghost" title="${escHtml(tip)}" style="cursor:default; font-size:10px; padding:3px 5px; background:rgba(59,130,246,0.10); border-radius:3px; border-left:3px solid rgba(59,130,246,0.55); color:rgba(255,255,255,0.50); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:0.7;">${channels || '📢'} <span style="font-weight:700; font-variant-numeric:tabular-nums;">${hh}:${mm}</span> <span style="opacity:.7;">· SMM</span></div>`;
    }
    return `<div class="cal-item-ghost" title="${escHtml(tip)}" style="cursor:default; padding:5px 7px; background:rgba(59,130,246,0.10); border-radius:5px; border-left:3px solid rgba(59,130,246,0.55); color:rgba(255,255,255,0.55); opacity:0.7;"><div style="font-size:10px;">${channels || '📢'} · SMM</div><div style="font-size:11px; margin-top:2px;"><span style="font-weight:700;">${hh}:${mm}</span> · ${escHtml(title).slice(0, 35)}</div></div>`;
  }
  const ch = CH_LABELS[m.channel] || CH_LABELS.other;
  const st = ST_LABELS[m.status] || ST_LABELS.draft;
  const dt = new Date(m.publish_at);
  const hh = String(dt.getHours()).padStart(2,'0');
  const mm = String(dt.getMinutes()).padStart(2,'0');
  const title = (m.title || '(без назви)');
  // #547: border-left=рубрика-колір (fallback var(--red))
  const rc = m.rubric_id ? rubricColor(m.rubric_id) : 'var(--red)';
  if (size === 'short') {
    // #350 Vira UX: час перед назвою у Month view (раніше було тільки ch.ic + title)
    return `<div class="cal-item" data-id="${m.id}" title="${hh}:${mm} · ${escHtml(title)}" style="cursor:pointer; font-size:10px; padding:3px 5px; background:var(--bg-3); border-radius:3px; border-left:3px solid ${rc}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ch.ic} <span style="color:#fff; font-weight:700; font-variant-numeric:tabular-nums;">${hh}:${mm}</span> <span style="color:var(--ash);">·</span> ${escHtml(title).slice(0, 18)}</div>`;
  }
  if (size === 'medium') {
    // #350: жирний час як префікс title для консистентності з Month
    return `<div class="cal-item" data-id="${m.id}" style="cursor:pointer; padding:6px 8px; background:var(--bg-3); border-radius:5px; border-left:3px solid ${rc};">
      <div style="font-size:10px; color:var(--ash);">${ch.ic} ${st.name ? '· ' + escHtml(st.name) : ''}</div>
      <div style="font-size:11px; color:#fff; margin-top:2px;"><span style="color:#fff; font-weight:700; font-variant-numeric:tabular-nums;">${hh}:${mm}</span> <span style="color:var(--ash);">·</span> ${escHtml(title).slice(0, 50)}</div>
      <span class="chip ${st.cls}" style="margin-top:4px;">${escHtml(st.name)}</span>
    </div>`;
  }
  return `<div class="cal-item" data-id="${m.id}" style="cursor:pointer; padding:10px 12px; background:var(--bg-3); border-radius:6px; border-left:4px solid ${rc}; display:flex; gap:10px; align-items:center;">
    <span class="chip ${ch.cls}">${ch.ic} ${ch.name}</span>
    <div style="flex:1;">
      <div style="color:#fff; font-weight:700;">${escHtml(title)}</div>
      <div style="font-size:11px; color:var(--ash); margin-top:2px;">${escHtml(m.preview_text || '').slice(0,80) || '—'}</div>
    </div>
    <span class="chip ${st.cls}">${escHtml(st.name)}</span>
    <span style="color:var(--ash); font-size:11px;">${hh}:${mm}</span>
  </div>`;
}

function renderCalList(main, items){
  const sorted = items.slice().sort((a,b) => new Date(a.publish_at) - new Date(b.publish_at));
  main.innerHTML = renderCalendarHeader() + `<div class="list">${
    sorted.length ? sorted.map(m => {
      const ch = CH_LABELS[m.channel] || CH_LABELS.other;
      const st = ST_LABELS[m.status] || ST_LABELS.draft;
      // #547: border-left=рубрика-колір
      const rc = rubricColor(m.rubric_id);
      return `<div class="msg-row" data-id="${m.id}" style="border-left:4px solid ${rc};">
        <span class="chip ${ch.cls}">${ch.ic} ${escHtml(ch.name)}</span>
        <span class="chip ${st.cls}">${escHtml(st.name)}</span>
        <div>
          <div class="msg-row-title">${escHtml(m.title || '(без назви)')}</div>
          <div class="msg-row-meta">${escHtml(m.preview_text || '').slice(0,120) || '—'}</div>
        </div>
        <div class="msg-row-meta">📅 ${fmtDate(m.publish_at)}</div>
        <div class="msg-row-meta">${m.audience_count != null ? '👥 ' + m.audience_count : '—'}</div>
        <div class="msg-row-meta">${m.sent_count != null ? '✓ ' + m.sent_count : '—'}</div>
      </div>`;
    }).join('') : '<div class="empty">Нічого не знайдено за фільтрами.</div>'
  }</div>`;
  bindCalControls();
  main.querySelectorAll('.msg-row').forEach(r => r.onclick = () => openMessageDetail(r.dataset.id));
}

function renderTemplates(main){
  main.innerHTML = `
    <div class="section-head">
      <h1>📝 Шаблони <span style="color:var(--ash); font-size:14px; margin-left:8px;">(Phase 2)</span></h1>
    </div>
    <div class="empty">
      <div style="font-size:48px; margin-bottom:14px;">🚧</div>
      <div>Шаблони з'являться у наступному релізі.</div>
      <div style="margin-top:10px; font-size:12px;">Зараз: можна зберігати ranks типових повідомлень як архівні з тегом <code>#template</code> у notes.</div>
    </div>
  `;
}

function bindHeadActions(){
  const r = document.getElementById('btnRefresh');
  if (r) r.onclick = () => loadAll();
  const n = document.getElementById('btnNew');
  if (n) n.onclick = () => openMessageDetail(null);
}

// ============================================================
// DETAIL / EDITOR MODAL
// ============================================================
function openMessageDetail(id){
  const msg = id ? Store.byId.get(id) : null;
  const isNew = !msg;
  // #351 Vadym UX: default = поточний момент (раніше було +24h → показувало "завтра").
  let defaultPublish = new Date();
  if (isNew && Store._prefillDate) {
    const [yy,mm,dd] = Store._prefillDate.split('-').map(Number);
    // якщо юзер клікнув на конкретний день у календарі — на цей день, о ПОТОЧНІЙ годині
    const now = new Date();
    defaultPublish = new Date(yy, mm-1, dd, now.getHours(), now.getMinutes(), 0);
    Store._prefillDate = null;
  }
  const m = msg || {
    // 08.06.2026 Vira feedback: Telegram by default (раніше email)
    channel: 'tg',
    title: '',
    preview_text: '',
    body: '',
    status: 'draft',
    publish_at: defaultPublish.toISOString(),
    audience_filter: {},
    audience_list_id: '',
    project_id: null,
    notes: '',
  };

  const overlay = document.createElement('div');
  overlay.id = 'detailOverlay';
  overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:1000; display:flex; align-items:center; justify-content:center; padding:20px;';
  overlay.innerHTML = `
    <div style="background:var(--bg-2); border:1px solid var(--steel); border-radius:14px; max-width:760px; width:100%; max-height:90vh; overflow-y:auto; padding:24px; font-family:'JetBrains Mono', monospace;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:18px;">
        <h2 style="font-family:'Oswald',sans-serif; font-size:20px; letter-spacing:0.05em;">${isNew ? '➕ НОВА РОЗСИЛКА' : '✏️ РОЗСИЛКА'}</h2>
        <div style="display:flex; gap:10px; align-items:center;">
          <span id="msgAutosaveInd" style="font-size:11px; color:var(--ash); min-width:120px; text-align:right;">${isNew ? '⚪ нова — натисни Зберегти' : '✓ збережено'}</span>
          <button class="btn" id="closeDetail" title="Закрити (всі зміни вже збережено через автосейв)">✕</button>
        </div>
      </div>
      <form id="msgForm" style="display:flex; flex-direction:column; gap:14px;">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <label>
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">КАНАЛ *</span>
            <select name="channel" required style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;">
              ${ALL_CHANNELS.map(c => `<option value="${c}" ${m.channel === c ? 'selected' : ''}>${CH_LABELS[c].ic} ${CH_LABELS[c].name}</option>`).join('')}
            </select>
          </label>
          <label>
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">СТАТУС</span>
            <select name="status" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;" ${isNew ? 'disabled' : ''}>
              ${ALL_STATUSES.map(s => `<option value="${s}" ${m.status === s ? 'selected' : ''}>${ST_LABELS[s].name}</option>`).join('')}
            </select>
          </label>
        </div>
        <label>
          <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ЗАГОЛОВОК / SUBJECT *</span>
          <input name="title" required value="${escHtml(m.title)}" placeholder="Subject email або заголовок TG broadcast" style="width:100%; padding:10px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;">
        </label>
        <label id="lblPreviewText" style="${m.channel === 'tg' ? 'display:none;' : ''}">
          <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">PREVIEW (email preheader)</span>
          <input name="preview_text" value="${escHtml(m.preview_text || '')}" placeholder="Короткий preview що відображається після subject" style="width:100%; padding:10px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;">
        </label>
        <label>
          <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ТІЛО РОЗСИЛКИ *</span>
          <!-- Vira 30.07: редактор форматування Telegram -->
          <div id="ret-fmt-toolbar" style="display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:var(--bg-2);border:1px solid var(--steel);border-bottom:none;border-radius:6px 6px 0 0;">
            <button type="button" class="ret-fmt" data-fmt="b" title="Жирний (Ctrl+B)" style="font-weight:800;">B</button>
            <button type="button" class="ret-fmt" data-fmt="i" title="Курсив (Ctrl+I)" style="font-style:italic;">I</button>
            <button type="button" class="ret-fmt" data-fmt="u" title="Підкреслення (Ctrl+U)" style="text-decoration:underline;">U</button>
            <button type="button" class="ret-fmt" data-fmt="s" title="Закреслення" style="text-decoration:line-through;">S</button>
            <span style="width:1px;background:var(--steel);margin:2px 3px;"></span>
            <button type="button" class="ret-fmt" data-fmt="spoiler" title="Спойлер — текст під розмиттям, клікають щоб відкрити">🫥 Спойлер</button>
            <button type="button" class="ret-fmt" data-fmt="quote" title="Цитата — виділений блок з лінією">❝ Цитата</button>
            <button type="button" class="ret-fmt" data-fmt="quote-exp" title="Розгортувана цитата — довгий текст ховається під «розгорнути»">⌄ Цитата+</button>
            <span style="width:1px;background:var(--steel);margin:2px 3px;"></span>
            <button type="button" class="ret-fmt" data-fmt="code" title="Моноширинний">&lt;/&gt;</button>
            <button type="button" class="ret-fmt" data-fmt="link" title="Посилання (Ctrl+K)">🔗 Лінк</button>
            <span style="width:1px;background:var(--steel);margin:2px 3px;"></span>
            <button type="button" class="ret-fmt" data-emoji="🚗">🚗</button>
            <button type="button" class="ret-fmt" data-emoji="🔥">🔥</button>
            <button type="button" class="ret-fmt" data-emoji="🎁">🎁</button>
            <button type="button" class="ret-fmt" data-emoji="⚡">⚡</button>
            <button type="button" class="ret-fmt" data-emoji="✅">✅</button>
            <button type="button" class="ret-fmt" data-emoji="👉">👉</button>
            <span style="flex:1;"></span>
            <button type="button" class="ret-fmt" id="ret-fmt-clear" title="Прибрати все форматування">🧹 Очистити</button>
          </div>
          <textarea name="body" id="ret-body-ta" required rows="8" placeholder="Вміст розсилки… Виділи текст і тисни кнопку форматування." style="width:100%; padding:10px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:0 0 6px 6px; font-family:inherit; resize:vertical;">${escHtml(m.body || '')}</textarea>
        </label>
        <!-- Vira 30.07: живий прев'ю одразу під текстом -->
        <div id="ret-preview-wrap" style="margin-top:-4px; ${m.channel === 'tg' ? '' : 'display:none;'}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;">
            <span style="font-size:11px;color:var(--ash);">👁 ПРЕВ'Ю — як побачить підписник</span>
            <span id="ret-len-badge" style="font-size:10px;color:var(--ash);font-variant-numeric:tabular-nums;"></span>
          </div>
          <div id="ret-tg-preview" style="background:#1b2733;border:1px solid var(--steel);border-radius:10px;padding:12px 14px;font-size:13.5px;line-height:1.55;color:#e9edf0;word-break:break-word;min-height:44px;"></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <label>
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ДАТА І ЧАС ВІДПРАВКИ *</span>
            <input type="datetime-local" name="publish_at" required value="${toLocalDt(m.publish_at)}" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;">
          </label>
          <label>
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ПРОЄКТ</span>
            <select name="project_id" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;">
              <option value="">— Без проєкту —</option>
              ${Store.projects.map(p => `<option value="${p.id}" ${m.project_id === p.id ? 'selected' : ''}>${escHtml(p.name)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
          <label>
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ID СПИСКУ / ЧАТУ <button type="button" id="loadSpBooks" style="padding:2px 6px; font-size:9px; background:var(--bg-2); border:1px solid var(--steel); color:#ccc; border-radius:3px; cursor:pointer; margin-left:6px;">↻ SP</button></span>
            <input name="audience_list_id" list="spBooksList" value="${escHtml(m.audience_list_id || '')}" placeholder="SendPulse book ID, TG chat_id, або обери" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;">
            <datalist id="spBooksList"></datalist>
          </label>
          <label>
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ФІЛЬТР ТАРИФУ</span>
            <select name="filter_tariff" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;">
              <option value="">— Всі —</option>
              <option value="bronze" ${(m.audience_filter?.tariff || '') === 'bronze' ? 'selected' : ''}>Бронза (249-999)</option>
              <option value="silver" ${(m.audience_filter?.tariff || '') === 'silver' ? 'selected' : ''}>Срібло (1499-2999)</option>
              <option value="gold"   ${(m.audience_filter?.tariff || '') === 'gold'   ? 'selected' : ''}>Золото (4999+)</option>
              <option value="platinum" ${(m.audience_filter?.tariff || '') === 'platinum' ? 'selected' : ''}>Платина (9999)</option>
            </select>
          </label>
          <label>
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ФІЛЬТР СТАТУСУ</span>
            <select name="filter_status" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;">
              <option value="">— Всі —</option>
              <option value="active" ${(m.audience_filter?.user_status || '') === 'active' ? 'selected' : ''}>Активні</option>
              <option value="prospect" ${(m.audience_filter?.user_status || '') === 'prospect' ? 'selected' : ''}>Потенційні</option>
              <option value="churn" ${(m.audience_filter?.user_status || '') === 'churn' ? 'selected' : ''}>Відтік</option>
              <option value="winner" ${(m.audience_filter?.user_status || '') === 'winner' ? 'selected' : ''}>Переможці</option>
            </select>
          </label>
        </div>
        <label>
          <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">НОТАТКИ</span>
          <textarea name="notes" rows="2" placeholder="Внутрішні нотатки (не йде підписникам)" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px; font-family:inherit;">${escHtml(m.notes || '')}</textarea>
        </label>

        <!-- #417 Креативи (картинки/відео) -->
        <div id="ret-creatives-block" style="margin:10px 0; padding:12px; background:var(--bg-3); border:1px solid var(--steel); border-radius:8px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
            <span style="font-size:11px; color:var(--ash); font-weight:600; letter-spacing:.5px;">📸 КРЕАТИВИ (картинки / відео)</span>
            <div style="display:flex; gap:6px;">
              <button type="button" id="ret-pick-from-library" style="background:var(--bg-2); border:1px solid var(--steel); color:#fff; padding:6px 12px; border-radius:6px; cursor:pointer; font-size:12px;">🖼 З бібліотеки</button>
              <a href="/hq/#library" target="_blank" rel="noopener" style="background:var(--bg-2); border:1px solid var(--steel); color:#fff; padding:6px 12px; border-radius:6px; text-decoration:none; font-size:12px;">📤 Завантажити нові →</a>
            </div>
          </div>
          <div id="ret-creatives-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(90px, 1fr)); gap:6px; min-height:60px;">
            <div class="ret-creatives-empty" style="grid-column:1/-1; padding:18px; text-align:center; color:var(--ash); font-size:12px; border:1px dashed var(--steel); border-radius:6px;">
              Креативи не прикріплені. Завантаж нові у бібліотеку або обери з існуючих.
            </div>
          </div>
        </div>

        <!-- Vira 29.07: TG-опції розсилки (кнопки/відеозамітка/форматування/DM-only) -->
        <div id="ret-tg-options" style="${m.channel === 'tg' ? '' : 'display:none;'} margin:10px 0; padding:12px; background:var(--bg-3); border:1px solid var(--steel); border-radius:8px;">
          <div style="font-size:11px; color:var(--ash); font-weight:600; letter-spacing:.5px; margin-bottom:10px;">📨 TG-ОПЦІЇ РОЗСИЛКИ</div>

          <label style="display:flex; align-items:flex-start; gap:8px; cursor:pointer; margin-bottom:12px; padding:8px 10px; background:rgba(227,6,19,.06); border:1px solid rgba(227,6,19,.25); border-radius:6px;">
            <input type="checkbox" name="dm_only" ${m.dm_only === false ? '' : 'checked'} style="width:16px;height:16px;margin-top:1px;accent-color:var(--red,#E30613);cursor:pointer;flex:none;">
            <span style="font-size:12px;color:#ddd;line-height:1.4;"><b>🔒 Лише DM-підписникам бота</b><br><span style="color:var(--ash);font-size:11px;">Групи та канали виключені. Знімай лише якщо свідомо шлеш у конкретний чат/канал (ID списку/чату вище).</span></span>
          </label>


          <label style="display:block;margin-bottom:12px;">
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">🎥 ВІДЕОЗАМІТКА (кружечок) — окреме кругле відео перед постом</span>
            <select name="video_note_creative_id" id="ret-vnote-select" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px;">
              <option value="">— немає —</option>
            </select>
            <small style="color:var(--ash);font-size:10px;">Обери відео з прикріплених креативів вище. TG покаже його кружечком (без підпису/кнопок).</small>
          </label>

          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:11px; color:var(--ash);">🔘 КНОПКИ під постом (inline)</span>
              <button type="button" id="ret-add-button" style="background:var(--bg-2);border:1px solid var(--steel);color:#fff;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:11px;">+ Кнопка</button>
            </div>
            <div id="ret-buttons-list" style="display:flex;flex-direction:column;gap:6px;"></div>
          </div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <label>
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ПОГОДЖУЮТЬ (multi)</span>
            <select name="approvers" multiple size="4" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px; font-family:inherit;">
              ${Store.users.map(u => {
                const sel = (m._approvers || []).some(a => a.user_id === u.id) ? 'selected' : '';
                const ico = (m._approvers || []).find(a => a.user_id === u.id);
                const mark = ico ? (ico.is_approved === true ? ' ✅' : ico.is_approved === false ? ' ❌' : ' ⏳') : '';
                return `<option value="${u.id}" ${sel}>${escHtml(u.name || u.email)} · ${u.role}${mark}</option>`;
              }).join('')}
            </select>
            <small style="color:var(--ash); font-size:10px;">Ctrl+click для кількох</small>
          </label>
          <label>
            <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ВІДПОВІДАЛЬНІ</span>
            <select name="responsibles" multiple size="4" style="width:100%; padding:9px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px; font-family:inherit;">
              ${Store.users.map(u => {
                const sel = (m._responsibles || []).some(r => r.user_id === u.id) ? 'selected' : '';
                return `<option value="${u.id}" ${sel}>${escHtml(u.name || u.email)} · ${u.role}</option>`;
              }).join('')}
            </select>
            <small style="color:var(--ash); font-size:10px;">Хто виконує — отримує сповіщення</small>
          </label>
        </div>

        <div style="display:flex; gap:8px; align-items:center; padding:10px; background:var(--bg-3); border-radius:6px; font-size:12px;">
          <span style="color:var(--ash);">📊 АУДИТОРІЯ:</span>
          <span id="audPreview" style="color:var(--gold); font-weight:700;">${m.audience_count != null ? m.audience_count + ' підписників' : '— оцінка не виконана —'}</span>
          <button type="button" class="btn" id="btnAudiencePreview" style="padding:4px 10px; font-size:10px;">↻ ОЦІНИТИ</button>
        </div>

        ${!isNew ? renderHistorySection(m) : ''}

        ${!isNew && isCeoCoo() ? `
        <div class="qs-row-ret" title="CEO/COO: миттєвий перехід у будь-який статус">
          ${RET_QS_STATUSES.map(s =>
            `<button type="button" class="qs-chip-ret ${s.v===m.status?'active':''}" data-qs-ret="${s.v}" ${s.v===m.status?'disabled':''}>${s.lbl}</button>`
          ).join('')}
        </div>
        ` : ''}

        <div style="display:flex; gap:10px; justify-content:space-between; align-items:center; margin-top:10px; flex-wrap:wrap;">
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${!isNew && isPriv() ? `<button type="button" class="btn" id="btnDelete" style="border-color:var(--red); color:var(--red-soft);">🗑 ВИДАЛИТИ</button>` : ''}
            ${!isNew && m.status === 'draft' ? `<button type="button" class="btn" id="btnSubmitReview">📤 НА ПОГОДЖЕННЯ</button>` : ''}
            ${!isNew && m.status === 'review' && isPriv() ? `<button type="button" class="btn" id="btnApprove" style="border-color:var(--green); color:var(--green);">✅ APPROVE</button>` : ''}
            ${!isNew && m.status === 'review' && isPriv() ? `<button type="button" class="btn" id="btnReject" style="border-color:var(--red); color:var(--red-soft);">↩ НА ДООПРАЦЮВАННЯ</button>` : ''}
            ${!isNew && m.status === 'approved' ? `<button type="button" class="btn" id="btnSchedule" style="border-color:var(--blue); color:var(--blue);">⏰ ПОСТАВИТИ У ЧЕРГУ</button>` : ''}
          </div>
          <div style="display:flex; gap:8px;">
            <button type="submit" class="btn">💾 ЗБЕРЕГТИ ЯК ЧЕРНЕТКУ</button>
            ${(isNew || m.status === 'draft' || m.status === 'rework') ? `<button type="button" class="btn primary" id="btnSaveAndReview" title="Зберегти і одразу відправити approvers'ам на погодження">🚀 ЗБЕРЕГТИ + НА ПОГОДЖЕННЯ</button>` : ''}
          </div>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
  if (!isNew) overlay.dataset.msgId = m.id;
  // #417 Init creatives block
  (async () => {
    try {
      window.retState = window.retState || {};
      window.retState.modalCreatives = [];
      const grid = overlay.querySelector('#ret-creatives-grid');
      const renderGrid = () => {
        if (!grid) return;
        const ids = window.retState.modalCreatives || [];
        if (!ids.length) {
          grid.innerHTML = '<div class="ret-creatives-empty" style="grid-column:1/-1; padding:18px; text-align:center; color:var(--ash); font-size:12px; border:1px dashed var(--steel); border-radius:6px;">Креативи не прикріплені. Завантаж нові у бібліотеку або обери з існуючих.</div>';
          return;
        }
        const cache = window.retState._creativesCache || {};
        grid.innerHTML = ids.map(cid => {
          const c = cache[cid] || {};
          const thumb = c.thumbnail_url || c.compressed_url || (c.drive_file_id ? `https://lh3.googleusercontent.com/d/${c.drive_file_id}=s256` : '');
          const isVideo = c.type === 'video';
          return `<div data-cid="${cid}" style="position:relative; aspect-ratio:1/1; background:var(--bg-2); border:1px solid var(--steel); border-radius:6px; overflow:hidden;">
            ${thumb ? `<img src="${thumb}" style="width:100%; height:100%; object-fit:cover;" loading="lazy" onerror="this.style.display='none'">` : `<div style="display:flex; align-items:center; justify-content:center; height:100%; font-size:24px;">${isVideo ? '🎬' : '🖼'}</div>`}
            ${isVideo ? '<div style="position:absolute; bottom:4px; left:4px; background:rgba(0,0,0,0.7); padding:2px 6px; border-radius:3px; font-size:10px; color:#fff;">▶ VIDEO</div>' : ''}
            <button type="button" data-remove="${cid}" title="Прибрати" style="position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.7); color:#fff; border:none; border-radius:3px; width:20px; height:20px; cursor:pointer; font-size:14px; line-height:1;">×</button>
          </div>`;
        }).join('');
        grid.querySelectorAll('[data-remove]').forEach(btn => {
          btn.onclick = (e) => {
            e.stopPropagation();
            const cid = btn.dataset.remove;
            window.retState.modalCreatives = (window.retState.modalCreatives || []).filter(x => x !== cid);
            renderGrid();
            overlay.dataset.dirty = '1';
          };
        });
        // Vira 29.07: наповнити селект відеозамітки з прикріплених ВІДЕО-креативів
        const vsel = overlay.querySelector('#ret-vnote-select');
        if (vsel) {
          const cur = vsel.value || m.video_note_creative_id || '';
          const cc = window.retState._creativesCache || {};
          const vids = (window.retState.modalCreatives || []).filter(cid => (cc[cid] || {}).type === 'video');
          vsel.innerHTML = '<option value="">— немає —</option>' + vids.map(cid => {
            const c = cc[cid] || {};
            return `<option value="${cid}" ${cur === cid ? 'selected' : ''}>${escHtml((c.name || cid).toString().slice(0, 40))}</option>`;
          }).join('');
        }
        // ліміт caption залежить від наявності медіа (1024 з медіа / 4096 без) — оновити лічильник
        if (typeof window.__retRefreshPreview === 'function') window.__retRefreshPreview();
      };
      // Load existing creatives for this message
      if (!isNew && m.id) {
        const { data } = await window.supabase
          .from('creative_retention_messages')
          .select('creative_id, sort_order, creatives:creative_id(id, name, type, thumbnail_url, compressed_url, drive_file_id, poster_url)')
          .eq('retention_message_id', m.id)
          .order('sort_order', { ascending: true });
        const ids = []; const cache = window.retState._creativesCache || {};
        (data || []).forEach(r => { if (r.creatives) { cache[r.creative_id] = r.creatives; ids.push(r.creative_id); } });
        window.retState._creativesCache = cache;
        window.retState.modalCreatives = ids;
      }
      renderGrid();
      // Picker — відкрити бібліотеку
      const pickBtn = overlay.querySelector('#ret-pick-from-library');
      if (pickBtn) pickBtn.onclick = async () => {
        const [creRes, useRes] = await Promise.all([
          window.supabase.from('creatives')
            .select('id, name, type, thumbnail_url, compressed_url, drive_file_id, scopes')
            .is('deleted_at', null).order('uploaded_at', { ascending: false }).limit(200),
          window.supabase.from('v_creative_usages')
            .select('creative_id, source, ref_title, ref_at, channels'),
        ]);
        const items = creRes.data || [];
        const usagesByCid = {};
        (useRes.data || []).forEach(u => {
          if (!usagesByCid[u.creative_id]) usagesByCid[u.creative_id] = [];
          usagesByCid[u.creative_id].push(u);
        });
        window.retState._creativeUsages = usagesByCid;
        const cache = window.retState._creativesCache || {};
        items.forEach(c => { cache[c.id] = c; });
        window.retState._creativesCache = cache;
        const picker = document.createElement('div');
        picker.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:1500; display:flex; align-items:center; justify-content:center; padding:20px;';
        picker.innerHTML = `<div style="background:var(--bg-1, #1a1a1a); border:1px solid var(--steel); border-radius:8px; max-width:900px; width:100%; max-height:85vh; display:flex; flex-direction:column;">
          <div style="flex:0 0 auto; padding:14px 18px 12px; border-bottom:1px solid var(--steel); display:flex; justify-content:space-between; align-items:center; background:var(--bg-1, #1a1a1a); border-radius:8px 8px 0 0;">
            <h3 style="margin:0; color:#fff; font-size:16px;">🖼 Обери з бібліотеки</h3>
            <div style="display:flex; gap:8px; align-items:center;">
              <span id="ret-picker-counter" style="color:var(--ash); font-size:12px;"></span>
              <button id="ret-picker-done" style="background:var(--red, #E30613); color:#fff; border:none; padding:8px 16px; border-radius:6px; cursor:pointer; font-weight:600; font-size:13px;">✓ Готово</button>
              <button id="ret-picker-close" title="Закрити без збереження" style="background:transparent; border:1px solid var(--steel); color:#fff; padding:7px 12px; border-radius:6px; cursor:pointer;">✕</button>
            </div>
          </div>
          <div style="flex:1 1 auto; overflow:auto; padding:14px 18px;">
            <div style="margin-bottom:10px; color:var(--ash); font-size:12px;">Клікни щоб додати. Доданий креатив підсвічується. Натисни ще раз — прибрати.</div>
            <div id="ret-picker-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(120px, 1fr)); gap:8px;"></div>
          </div>
        </div>`;
        document.body.appendChild(picker);
        const pickerGrid = picker.querySelector('#ret-picker-grid');
        const renderPicker = () => {
          const sel = new Set(window.retState.modalCreatives || []);
          // #419 fix: для video НЕ використовуємо compressed_url як <img> src (це сам mp4).
          // Якщо thumbnail_url/poster_url немає → одразу emoji fallback. Якщо image без thumb → ОК, compressed_url можна.
          const thumbOf = (c) => {
            if (c.type === 'video') {
              return c.thumbnail_url || c.poster_url || '';
            }
            return c.thumbnail_url || c.compressed_url || (c.drive_file_id ? `https://lh3.googleusercontent.com/d/${c.drive_file_id}=s256` : '');
          };
          const usagesByCid = window.retState._creativeUsages || {};
          pickerGrid.innerHTML = items.map(c => {
            const thumb = thumbOf(c);
            const isSel = sel.has(c.id);
            const safeName = (c.name || '').replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]));
            const emojiIcon = c.type === 'video' ? '🎬' : '🖼';
            // #422 used-бейдж
            const uses = usagesByCid[c.id] || [];
            let usedBadge = '';
            if (uses.length) {
              const tipLines = uses.slice(0, 8).map(u => {
                const ic = u.source === 'smm' ? '📢 SMM' : '🤖 Ret';
                const dt = u.ref_at ? new Date(u.ref_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'short' }) : '';
                return `${ic} · ${(u.ref_title || '').slice(0, 30)} · ${dt}`;
              }).join('\n') + (uses.length > 8 ? `\n+ще ${uses.length - 8}` : '');
              usedBadge = `<div style="position:absolute; top:4px; left:4px; background:rgba(168,85,247,0.85); color:#fff; border-radius:10px; padding:1px 6px; font-size:10px; font-weight:700; z-index:2; cursor:help;" title="${tipLines.replace(/[<>&"]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[ch]))}">🔗 ${uses.length}</div>`;
            }
            return `<div data-cid="${c.id}" style="position:relative; aspect-ratio:1/1; background:var(--bg-2); border:2px solid ${isSel ? 'var(--red, #E30613)' : 'var(--steel)'}; border-radius:6px; overflow:hidden; cursor:pointer;" title="${safeName}">
              ${thumb ? `<img src="${thumb}" style="width:100%; height:100%; object-fit:cover;" loading="lazy">` : ''}
              <div class="cre-emoji-fallback" style="position:absolute; inset:0; display:${thumb ? 'none' : 'flex'}; flex-direction:column; align-items:center; justify-content:center; font-size:32px; gap:4px; pointer-events:none; background:var(--bg-2);"><span>${emojiIcon}</span><span style="font-size:9px; color:var(--ash); padding:0 6px; text-align:center; word-break:break-all; line-height:1.2;">${safeName.slice(0, 20)}</span></div>
              ${usedBadge}
              ${isSel ? '<div style="position:absolute; top:4px; right:4px; background:var(--red, #E30613); color:#fff; border-radius:50%; width:22px; height:22px; display:flex; align-items:center; justify-content:center; font-size:12px; z-index:2;">✓</div>' : ''}
              ${c.type === 'video' ? '<div style="position:absolute; bottom:4px; left:4px; background:rgba(0,0,0,0.7); padding:2px 6px; border-radius:3px; font-size:10px; color:#fff; z-index:2;">▶ VIDEO</div>' : ''}
            </div>`;
          }).join('');
          // Після рендеру — bind img onerror через JS (без HTML attribute escape проблем)
          pickerGrid.querySelectorAll('img').forEach(img => {
            img.onerror = () => {
              img.style.display = 'none';
              const fb = img.parentNode.querySelector('.cre-emoji-fallback');
              if (fb) fb.style.display = 'flex';
            };
          });
          pickerGrid.querySelectorAll('[data-cid]').forEach(el => {
            el.onclick = () => {
              const cid = el.dataset.cid;
              const cur = window.retState.modalCreatives || [];
              window.retState.modalCreatives = cur.includes(cid) ? cur.filter(x => x !== cid) : [...cur, cid];
              renderPicker();
              updateCounter();
            };
          });
        };
        renderPicker();
        const counter = picker.querySelector('#ret-picker-counter');
        const updateCounter = () => {
          const n = (window.retState.modalCreatives || []).length;
          if (counter) counter.textContent = n > 0 ? `Обрано: ${n}` : '';
        };
        updateCounter();
        picker.querySelector('#ret-picker-close').onclick = () => picker.remove();
        picker.querySelector('#ret-picker-done').onclick = () => { picker.remove(); renderGrid(); overlay.dataset.dirty = '1'; };
      };
    } catch(e) { console.warn('[creatives init]', e); }
  })();
  // #367 (12.06.2026 Vadym): 3-кнопковий dirty-confirm dialog як у Tasks app-tasks-fixes.js.
  // Назад редагувати / Видалити чернетку / Зберегти зараз — замість silent autosave.
  ensureRetDirtyConfirmCss();
  const showDirtyConfirm = (onSave, onDiscard, onCancel) => {
    const wrap = document.createElement('div');
    wrap.className = 'ret-dirty-confirm';
    wrap.innerHTML =
      '<div class="box">' +
      '<h3>Закрити без збереження?</h3>' +
      '<p>У повідомленні є незбережені зміни. Що зробити?</p>' +
      '<div class="actions">' +
      '<button data-act="cancel">← Назад редагувати</button>' +
      '<button class="danger" data-act="discard">Видалити чернетку</button>' +
      '<button class="primary" data-act="save">Зберегти зараз</button>' +
      '</div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => {
      const act = e.target && e.target.dataset && e.target.dataset.act;
      if (!act) return;
      wrap.remove();
      if (act === 'save') onSave();
      else if (act === 'discard') onDiscard();
      else if (act === 'cancel' && typeof onCancel === 'function') onCancel();
    });
  };
  const safeClose = async () => {
    // Якщо немає змін — просто закриваємо
    if (overlay.dataset.dirty !== '1' && !overlay.dataset.msgId) { overlay.remove(); return; }
    if (overlay.dataset.dirty !== '1') { overlay.remove(); return; }
    showDirtyConfirm(
      // Save: flush autosave і закриваємо
      async () => {
        if (typeof overlay._flushSave === 'function') {
          try { await overlay._flushSave(); } catch(_) {}
        }
        overlay.remove();
        window.toast && window.toast('Збережено', 'success');
        await loadAll();
      },
      // Discard: якщо це новий draft який створив autosave — DELETE його
      async () => {
        const liveId = overlay.dataset.msgId;
        if (liveId && isNew) {
          // Soft delete новостворений draft (його тут не повинно бути у списку)
          try {
            await window.supabase.from('retention_messages').update({
              deleted_at: new Date().toISOString(),
              deleted_reason: 'cancelled_draft'
            }).eq('id', liveId);
          } catch(_) {}
        }
        overlay.remove();
        window.toast && window.toast('Чернетка видалена', 'info');
        await loadAll();
      },
      // Cancel: повертаємось у редагування — нічого не робимо
      null
    );
  };
  overlay.onclick = (e) => { if (e.target === overlay) safeClose(); };
  document.getElementById('closeDetail').onclick = () => { safeClose(); };

  // #363 fix: брати msgId з overlay.dataset (може бути виставлений autosave для нового)
  document.getElementById('msgForm').onsubmit = (e) => {
    e.preventDefault();
    const liveId = overlay.dataset.msgId || (isNew ? null : m.id);
    saveForm(e.target, liveId, overlay);
  };

  // #363 (12.06.2026 Давид): AUTOSAVE працює для ВСІХ — і для нової теж створює draft автоматично.
  {
    const form = document.getElementById('msgForm');
    const ind = document.getElementById('msgAutosaveInd');
    let saveTimer = null;
    const markDirty  = () => { overlay.dataset.dirty = '1'; if (ind) { ind.textContent = '⏳ Збереження…'; ind.style.color = 'var(--amber, #f59e0b)'; } };
    const markSaved  = () => { overlay.dataset.dirty = '0'; if (ind) { ind.textContent = '✓ чернетка ' + new Date().toLocaleTimeString('uk-UA', { hour:'2-digit', minute:'2-digit' }); ind.style.color = 'var(--green, #10b981)'; } };
    const markErr    = (msg) => { if (ind) { ind.textContent = '⚠ ' + (msg || 'помилка'); ind.style.color = 'var(--red-soft, #ef4444)'; } };
    const doAutosave = async () => {
      overlay.dataset.saving = '1';
      try {
        // Якщо у dataset вже є msgId — UPDATE існуючий, інакше INSERT новий
        const currentId = overlay.dataset.msgId || null;
        const result = await saveForm(form, currentId, null, { silent: true });
        // saveForm повертає msgId (для нових — це новостворений UUID)
        if (result && typeof result === 'string' && !overlay.dataset.msgId) {
          overlay.dataset.msgId = result;
        }
        markSaved();
      } catch(e) { markErr(e && e.message); }
      finally { overlay.dataset.saving = '0'; }
    };
    const scheduleAutosave = () => {
      markDirty();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(doAutosave, 800);
    };
    // _flushSave — викликає safeClose() для immediate flush без debounce timer
    overlay._flushSave = async () => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      await doAutosave();
    };
    // Усі input/select/textarea у формі
    form.querySelectorAll('input, select, textarea').forEach(el => {
      el.addEventListener('input', scheduleAutosave);
      el.addEventListener('change', scheduleAutosave);
    });
  }

  // #215 (Vira UX): Зберегти + одразу на погодження одним кліком
  const saveAndReviewBtn = document.getElementById('btnSaveAndReview');
  if (saveAndReviewBtn) saveAndReviewBtn.onclick = () => {
    const form = document.getElementById('msgForm');
    // #363 fix: брати msgId з overlay.dataset (може бути виставлений autosave для нового)
    const liveId = overlay.dataset.msgId || (isNew ? null : m.id);
    if (form) saveForm(form, liveId, overlay, { andSubmit: true });
  };

  // 08.06.2026 Vira: PREVIEW тільки для email; toggle при зміні channel
  const channelSel = document.querySelector('select[name="channel"]');
  if (channelSel) channelSel.addEventListener('change', () => {
    const lbl = document.getElementById('lblPreviewText');
    if (lbl) lbl.style.display = channelSel.value === 'tg' ? 'none' : '';
    const tgOpts = document.getElementById('ret-tg-options');
    if (tgOpts) tgOpts.style.display = channelSel.value === 'tg' ? '' : 'none';
    const pw = document.getElementById('ret-preview-wrap');
    if (pw) pw.style.display = channelSel.value === 'tg' ? '' : 'none';
  });

  // 08.06.2026 Vira: якщо Store.users порожній (race / RLS / network) — попередження
  if (!Store.users.length) {
    const warn = document.createElement('div');
    warn.style.cssText = 'background:rgba(245,158,11,0.12);border-left:3px solid #f59e0b;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#fbbf24;';
    warn.innerHTML = '⚠ Користувачі ще не завантажені. Якщо ПОГОДЖУЮТЬ/ВІДПОВІДАЛЬНІ порожні — закрий модал і відкрий знову (через 2 сек).';
    const form = document.getElementById('msgForm');
    if (form) form.insertBefore(warn, form.firstChild);
  }
  // 09.06.2026 #194 — Quick-status chip clicks (CEO/COO only)
  document.querySelectorAll('[data-qs-ret]').forEach(chip => {
    chip.onclick = async () => {
      const to = chip.dataset.qsRet;
      if (!to || to === m.status) return;
      chip.disabled = true;
      await transitionStatus(m.id, to, overlay);
    };
  });

  const dBtn = document.getElementById('btnDelete');
  if (dBtn) dBtn.onclick = () => deleteMsg(m.id, overlay);
  const srBtn = document.getElementById('btnSubmitReview');
  if (srBtn) srBtn.onclick = () => transitionStatus(m.id, 'review', overlay);
  const apBtn = document.getElementById('btnApprove');
  if (apBtn) apBtn.onclick = () => approveMsg(m.id, overlay);
  const rjBtn = document.getElementById('btnReject');
  if (rjBtn) rjBtn.onclick = () => rejectMsg(m.id, overlay);
  const scBtn = document.getElementById('btnSchedule');
  if (scBtn) scBtn.onclick = () => transitionStatus(m.id, 'scheduled', overlay);
  const aBtn = document.getElementById('btnAudiencePreview');
  if (aBtn) aBtn.onclick = async () => {
    aBtn.textContent = '…';
    const c = await previewAudience(
      overlay.querySelector('[name=filter_tariff]')?.value,
      overlay.querySelector('[name=filter_status]')?.value,
      overlay.querySelector('[name=audience_list_id]')?.value
    );
    aBtn.textContent = '↻ ОЦІНИТИ';
    const p = document.getElementById('audPreview');
    if (p) p.textContent = c == null ? 'не вдалось оцінити' : `${c} активних DM-підписників бота`;
  };
  if (!isNew) loadHistory(m.id);
  const spBtn = document.getElementById('loadSpBooks');
  if (spBtn) spBtn.onclick = () => loadSendPulseBooks(spBtn);

  // Vira 30.07: редактор форматування Telegram + живий прев'ю
  (function(){
    const ta = document.getElementById('ret-body-ta');
    const bar = document.getElementById('ret-fmt-toolbar');
    const prev = document.getElementById('ret-tg-preview');
    const badge = document.getElementById('ret-len-badge');
    if (!ta) return;
    ensureRetFmtCss();

    const WRAPS = {
      b: ['<b>', '</b>'], i: ['<i>', '</i>'], u: ['<u>', '</u>'], s: ['<s>', '</s>'],
      code: ['<code>', '</code>'],
      spoiler: ['<tg-spoiler>', '</tg-spoiler>'],
      quote: ['<blockquote>', '</blockquote>'],
      'quote-exp': ['<blockquote expandable>', '</blockquote>'],
    };
    function wrap(before, after, placeholder){
      const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
      const sel = v.slice(s, e) || (placeholder || 'текст');
      ta.value = v.slice(0, s) + before + sel + after + v.slice(e);
      ta.focus();
      ta.selectionStart = s + before.length;
      ta.selectionEnd = s + before.length + sel.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function insert(txt){
      const s = ta.selectionStart, v = ta.value;
      ta.value = v.slice(0, s) + txt + v.slice(ta.selectionEnd);
      ta.focus(); ta.selectionStart = ta.selectionEnd = s + txt.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (bar) bar.addEventListener('click', (ev) => {
      const btn = ev.target.closest('button'); if (!btn) return;
      ev.preventDefault();
      if (btn.dataset.emoji) return insert(btn.dataset.emoji);
      if (btn.id === 'ret-fmt-clear') {
        if (!confirm('Прибрати ВСЕ форматування з тексту?')) return;
        ta.value = ta.value.replace(/<\/?(b|i|u|s|code|pre|a|tg-spoiler|blockquote)[^>]*>/gi, '');
        ta.dispatchEvent(new Event('input', { bubbles: true })); return;
      }
      const f = btn.dataset.fmt;
      if (f === 'link') {
        const url = prompt('Посилання (URL):', 'https://');
        if (!url) return;
        return wrap(`<a href="${url.replace(/"/g, '&quot;')}">`, '</a>', 'текст посилання');
      }
      const w = WRAPS[f]; if (w) wrap(w[0], w[1]);
    });
    // гарячі клавіші
    ta.addEventListener('keydown', (ev) => {
      if (!(ev.ctrlKey || ev.metaKey)) return;
      const k = ev.key.toLowerCase();
      if (k === 'b') { ev.preventDefault(); wrap('<b>', '</b>'); }
      else if (k === 'i') { ev.preventDefault(); wrap('<i>', '</i>'); }
      else if (k === 'u') { ev.preventDefault(); wrap('<u>', '</u>'); }
      else if (k === 'k') { ev.preventDefault(); const u = prompt('Посилання (URL):', 'https://'); if (u) wrap(`<a href="${u.replace(/"/g,'&quot;')}">`, '</a>', 'текст посилання'); }
    });
    // живий прев'ю + лічильник
    function refresh(){
      const title = (document.querySelector('[name=title]')?.value || '').trim();
      const body = ta.value || '';
      const raw = (title ? `<b>${escHtml(title)}</b>\n\n` : '') + body;
      if (prev) prev.innerHTML = tgToHtml(raw) || '<span style="color:#7c8b99;">— порожньо —</span>';
      if (badge) {
        const hasMedia = ((window.retState && window.retState.modalCreatives) || []).length > 0;
        const limit = hasMedia ? 1024 : 4096;
        const plain = raw.replace(/<[^>]+>/g, '').length;
        const over = plain > limit;
        badge.textContent = `${plain}/${limit}` + (hasMedia ? ' (з медіа)' : '');
        badge.style.color = over ? '#ff5f6d' : (plain > limit * 0.9 ? '#f59e0b' : 'var(--ash)');
        badge.title = over ? 'Перевищено ліміт Telegram — текст обріжеться!' : '';
      }
      // спойлери в прев'ю розкриваються кліком
      prev && prev.querySelectorAll('.tgp-spoiler').forEach(el => el.onclick = () => el.classList.toggle('open'));
    }
    ta.addEventListener('input', refresh);
    document.querySelector('[name=title]')?.addEventListener('input', refresh);
    window.__retRefreshPreview = refresh;
    refresh();
  })();

  // Vira 29.07: конструктор inline-кнопок
  (function(){
    const list = document.getElementById('ret-buttons-list');
    const addBtn = document.getElementById('ret-add-button');
    if (!list) return;
    const flat = [];
    const raw = m.tg_buttons;
    if (Array.isArray(raw)) raw.forEach(row => {
      if (Array.isArray(row)) row.forEach(x => x && flat.push({ text: x.text || '', url: x.url || '' }));
      else if (row && typeof row === 'object') flat.push({ text: row.text || '', url: row.url || '' });
    });
    const syncFromDom = () => {
      Array.from(list.querySelectorAll('.ret-btn-row')).forEach((r, i) => {
        if (!flat[i]) flat[i] = { text: '', url: '' };
        flat[i].text = r.querySelector('.ret-btn-text')?.value || '';
        flat[i].url = r.querySelector('.ret-btn-url')?.value || '';
      });
    };
    const render = () => {
      list.innerHTML = flat.length ? flat.map((b, i) => `
        <div class="ret-btn-row" style="display:flex;gap:6px;align-items:center;">
          <input class="ret-btn-text" value="${escHtml(b.text)}" placeholder="Текст кнопки" style="flex:1;padding:7px 9px;background:var(--bg-2);border:1px solid var(--steel);color:#fff;border-radius:5px;font-size:12px;">
          <input class="ret-btn-url" value="${escHtml(b.url)}" placeholder="https://..." style="flex:1.4;padding:7px 9px;background:var(--bg-2);border:1px solid var(--steel);color:#fff;border-radius:5px;font-size:12px;">
          <button type="button" data-bi="${i}" title="Прибрати" style="background:rgba(0,0,0,.4);border:1px solid var(--steel);color:#fff;border-radius:5px;width:28px;height:28px;cursor:pointer;flex:none;">×</button>
        </div>`).join('') : '<div style="color:var(--ash);font-size:11px;padding:4px 0;">Кнопок немає. «+ Кнопка» щоб додати.</div>';
      list.querySelectorAll('[data-bi]').forEach(btn => btn.onclick = () => { syncFromDom(); flat.splice(+btn.dataset.bi, 1); render(); });
    };
    if (addBtn) addBtn.onclick = () => { syncFromDom(); flat.push({ text: '', url: '' }); render(); };
    render();
  })();
}

// Vira 30.07: рендер TG-розмітки у HTML для прев'ю (безпечно: спершу екрануємо, потім вмикаємо дозволені теги)
function tgToHtml(src){
  if (!src) return '';
  let s = String(src).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // дозволені теги назад
  s = s
    .replace(/&lt;(\/?)(b|strong)&gt;/gi, '<$1b>')
    .replace(/&lt;(\/?)(i|em)&gt;/gi, '<$1i>')
    .replace(/&lt;(\/?)u&gt;/gi, '<$1u>')
    .replace(/&lt;(\/?)(s|strike|del)&gt;/gi, '<$1s>')
    .replace(/&lt;(\/?)code&gt;/gi, '<$1code>')
    .replace(/&lt;(\/?)pre&gt;/gi, '<$1pre>')
    .replace(/&lt;tg-spoiler&gt;/gi, '<span class="tgp-spoiler">')
    .replace(/&lt;\/tg-spoiler&gt;/gi, '</span>')
    .replace(/&lt;blockquote expandable&gt;/gi, '<blockquote class="tgp-quote tgp-exp">')
    .replace(/&lt;blockquote&gt;/gi, '<blockquote class="tgp-quote">')
    .replace(/&lt;\/blockquote&gt;/gi, '</blockquote>')
    .replace(/&lt;a href=(?:&quot;|")([^"&]+)(?:&quot;|")&gt;/gi, '<a class="tgp-link" href="$1" target="_blank" rel="noopener">')
    .replace(/&lt;\/a&gt;/gi, '</a>');
  return s.replace(/\n/g, '<br>');
}
function ensureRetFmtCss(){
  if (document.getElementById('ret-fmt-css')) return;
  const st = document.createElement('style');
  st.id = 'ret-fmt-css';
  st.textContent = [
    '#ret-fmt-toolbar button.ret-fmt{background:var(--bg-3,#1a1a1a);border:1px solid var(--steel,#2a2a2a);color:#ddd;border-radius:5px;padding:4px 8px;font-size:12px;cursor:pointer;line-height:1.3;transition:all .12s;}',
    '#ret-fmt-toolbar button.ret-fmt:hover{border-color:var(--red,#E30613);color:#fff;background:rgba(227,6,19,.10);}',
    '#ret-fmt-toolbar button.ret-fmt:active{transform:translateY(1px);}',
    '#ret-tg-preview .tgp-spoiler{background:rgba(255,255,255,.14);border-radius:3px;color:transparent;cursor:pointer;text-shadow:0 0 8px rgba(255,255,255,.55);transition:all .18s;}',
    '#ret-tg-preview .tgp-spoiler.open{background:transparent;color:inherit;text-shadow:none;}',
    '#ret-tg-preview .tgp-quote{border-left:3px solid #62a9e8;background:rgba(98,169,232,.09);margin:6px 0;padding:6px 10px;border-radius:0 6px 6px 0;}',
    '#ret-tg-preview .tgp-quote.tgp-exp::after{content:"⌄ розгорнути";display:block;margin-top:4px;font-size:11px;color:#62a9e8;}',
    '#ret-tg-preview .tgp-link{color:#62a9e8;text-decoration:none;}',
    '#ret-tg-preview code{background:rgba(255,255,255,.10);padding:1px 5px;border-radius:4px;font-family:"JetBrains Mono",monospace;font-size:12.5px;}',
    '#ret-tg-preview pre{background:rgba(0,0,0,.35);padding:8px 10px;border-radius:6px;overflow-x:auto;font-size:12.5px;}',
  ].join('\n');
  document.head.appendChild(st);
}

async function loadSendPulseBooks(btn){
  if (btn) btn.textContent = '…';
  try {
    const supabase = window.supabase;
    const SUPABASE_URL = 'https://wotghlaehnvxyeacznvv.supabase.co';
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/sendpulse-books-list?op=list&limit=100`, {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    const dl = document.getElementById('spBooksList');
    if (!dl) return;
    if (!Array.isArray(j)) {
      window.toast && window.toast('SP: ' + JSON.stringify(j).slice(0, 80), 'error');
      return;
    }
    dl.innerHTML = j.map(b => `<option value="${b.id}">${escHtml(b.name)} · ${b.all_email_qty || 0} emails</option>`).join('');
    window.toast && window.toast(`SP: завантажено ${j.length} списків`, 'success');
  } catch(e) {
    window.toast && window.toast('SP not configured: ' + e.message.slice(0, 80), 'error');
  } finally {
    if (btn) btn.textContent = '↻ SP';
  }
}

function renderApproverSection(m){
  const apps = m._approvers || [];
  if (!apps.length && m.status === 'draft') return '';
  const html = apps.map(a => {
    const u = Store.users.find(x => x.id === a.user_id);
    const name = u ? (u.name || u.email) : a.user_id.slice(0,8);
    const icon = a.is_approved === true ? '✅' : a.is_approved === false ? '❌' : '⏳';
    return `<span class="chip chip-status-draft" style="margin-right:6px;">${icon} ${escHtml(name)}</span>`;
  }).join('');
  return `
    <div style="background:var(--bg-3); padding:10px; border-radius:6px;">
      <div style="font-size:11px; color:var(--ash); margin-bottom:8px;">ПОГОДЖУЮТЬ:</div>
      <div>${html || '<span style="color:var(--ash); font-size:12px;">— Ніхто ще не призначений —</span>'}</div>
    </div>
  `;
}

function renderHistorySection(m){
  return `
    <details style="background:var(--bg-3); padding:10px; border-radius:6px;">
      <summary style="cursor:pointer; font-size:11px; color:var(--ash); letter-spacing:0.1em;">📜 ІСТОРІЯ ПОДІЙ</summary>
      <div id="histList" style="margin-top:10px; font-size:11px; color:#ccc;">Завантажується…</div>
    </details>
  `;
}

async function loadHistory(messageId){
  const supabase = window.supabase;
  if (!supabase) return;
  const { data } = await supabase.from('retention_message_history').select('*').eq('message_id', messageId).order('at', { ascending: false }).limit(50);
  const el = document.getElementById('histList');
  if (!el) return;
  if (!data || !data.length) { el.innerHTML = '<span style="color:var(--ash);">— Подій ще немає —</span>'; return; }
  el.innerHTML = data.map(h => {
    const u = Store.users.find(x => x.id === h.actor_id);
    return `<div style="border-bottom:1px solid var(--line); padding:6px 0;">
      <span style="color:var(--gold);">${escHtml(h.action)}</span>
      ${h.detail ? '· ' + escHtml(h.detail) : ''}
      <span style="float:right; color:var(--ash); font-size:10px;">${fmtDate(h.at)} · ${u ? escHtml(u.name || u.email) : '—'}</span>
    </div>`;
  }).join('');
}

async function previewAudience(filterTariff, filterStatus, audienceListId){
  // Реальна аудиторія DM-розсилки = активні bot_subscribers (sync з SendPulse).
  // tariff/user_status поки не змаплені з SendPulse-змінних (Phase 2) — фільтр по них дасть 0.
  const supabase = window.supabase;
  if (!supabase) return null;
  try {
    let q = supabase.from('bot_subscribers').select('id', { count: 'exact', head: true }).eq('is_active', true);
    if (filterTariff) q = q.eq('tariff', filterTariff);
    if (filterStatus) q = q.eq('user_status', filterStatus);
    const { count, error } = await q;
    if (error) throw error;
    return count;
  } catch(e) {
    console.warn('[audience]', e);
    return null;
  }
}

function toLocalDt(iso){
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const off = d.getTimezoneOffset();
    const local = new Date(d.getTime() - off*60000);
    return local.toISOString().slice(0,16);
  } catch(_) { return ''; }
}

// #367 (12.06.2026 Vadym): 3-кнопковий dirty-confirm dialog як у Tasks
function ensureRetDirtyConfirmCss(){
  if (document.getElementById('ret-dirty-confirm-css')) return;
  const css = [
    '.ret-dirty-confirm { position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,.85); display:flex; align-items:center; justify-content:center; padding:24px; }',
    '.ret-dirty-confirm .box { background:var(--coal, #141414); border:1px solid var(--red, #E30613); border-radius:10px; padding:24px 28px; max-width:480px; width:100%; font-family:"Manrope",sans-serif; color:#fff; }',
    '.ret-dirty-confirm h3 { font-family:"Oswald",sans-serif; font-size:18px; margin-bottom:12px; text-transform:uppercase; }',
    '.ret-dirty-confirm p { font-size:13px; color:var(--ash,#bbb); margin-bottom:18px; line-height:1.6; }',
    '.ret-dirty-confirm .actions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; }',
    '.ret-dirty-confirm button { padding:9px 14px; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; border:1px solid #2a2a2a; background:transparent; color:#fff; }',
    '.ret-dirty-confirm button.primary { background:var(--red,#E30613); border-color:var(--red); }',
    '.ret-dirty-confirm button.danger { color:#F59E0B; border-color:#F59E0B; }',
    '@media (max-width:480px) { .ret-dirty-confirm .actions { flex-direction:column-reverse; } .ret-dirty-confirm button { width:100%; padding:11px; } }',
  ].join('');
  const st = document.createElement('style');
  st.id = 'ret-dirty-confirm-css';
  st.textContent = css;
  document.head.appendChild(st);
}

async function saveForm(form, id, overlay, opts){
  const supabase = window.supabase;
  if (!supabase) return;
  const me = window.retState && window.retState.publicUser;
  if (!me) { alert('Профіль не знайдено'); return; }
  const fd = new FormData(form);
  const audience_filter = {};
  if (fd.get('filter_tariff')) audience_filter.tariff = fd.get('filter_tariff');
  if (fd.get('filter_status')) audience_filter.user_status = fd.get('filter_status');
  // Vira 29.07: TG-композер — кнопки/відеозамітка/dm_only
  const tgButtons = Array.from(form.querySelectorAll('.ret-btn-row')).map(r => ({
    text: (r.querySelector('.ret-btn-text')?.value || '').trim(),
    url: (r.querySelector('.ret-btn-url')?.value || '').trim(),
  })).filter(b => b.text && b.url);
  const dmOnly = fd.get('dm_only') === 'on';
  const payload = {
    channel: fd.get('channel'),
    title: (fd.get('title') || '').trim(),
    preview_text: (fd.get('preview_text') || '').trim(),
    body: fd.get('body') || '',
    publish_at: new Date(fd.get('publish_at')).toISOString(),
    project_id: fd.get('project_id') || null,
    audience_list_id: (fd.get('audience_list_id') || '').trim() || null,
    audience_filter,
    notes: (fd.get('notes') || '').trim(),
    tg_buttons: tgButtons,
    dm_only: dmOnly,
    send_mode: dmOnly ? 'dm_broadcast' : 'single_chat',
    video_note_creative_id: fd.get('video_note_creative_id') || null,
  };
  let msgId = id;
  if (id) {
    payload.status = fd.get('status') || undefined;
    const { error } = await supabase.from('retention_messages').update(payload).eq('id', id);
    if (error) { alert('Save failed: ' + error.message); return; }
    await logHistory(id, 'updated', null);
  } else {
    payload.created_by = me.id;
    payload.status = 'draft';
    const { data, error } = await supabase.from('retention_messages').insert(payload).select().single();
    if (error) { alert('Insert failed: ' + error.message); return; }
    msgId = data.id;
    await logHistory(msgId, 'created', null);
  }
  // Sync approvers
  try {
    const wantedApp = Array.from(form.querySelectorAll('select[name="approvers"] option:checked')).map(o => o.value);
    const { data: oldApp } = await supabase.from('retention_message_approvers').select('user_id').eq('message_id', msgId);
    const oldSet = new Set((oldApp || []).map(x => x.user_id));
    const newSet = new Set(wantedApp);
    const toAdd = wantedApp.filter(u => !oldSet.has(u));
    const toDel = [...oldSet].filter(u => !newSet.has(u));
    if (toAdd.length) {
      await supabase.from('retention_message_approvers').insert(toAdd.map(uid => ({ message_id: msgId, user_id: uid })));
    }
    if (toDel.length) {
      await supabase.from('retention_message_approvers').delete().eq('message_id', msgId).in('user_id', toDel);
    }
  } catch(e) { console.warn('[approvers sync]', e); }
  // Sync responsibles
  try {
    const wantedResp = Array.from(form.querySelectorAll('select[name="responsibles"] option:checked')).map(o => o.value);
    const { data: oldResp } = await supabase.from('retention_message_responsibles').select('user_id').eq('message_id', msgId);
    const oldSet = new Set((oldResp || []).map(x => x.user_id));
    const newSet = new Set(wantedResp);
    const toAdd = wantedResp.filter(u => !oldSet.has(u));
    const toDel = [...oldSet].filter(u => !newSet.has(u));
    if (toAdd.length) {
      await supabase.from('retention_message_responsibles').insert(toAdd.map(uid => ({ message_id: msgId, user_id: uid })));
    }
    if (toDel.length) {
      await supabase.from('retention_message_responsibles').delete().eq('message_id', msgId).in('user_id', toDel);
    }
  } catch(e) { console.warn('[responsibles sync]', e); }
  // #417 Sync creatives — pivot creative_retention_messages
  try {
    const selected = (window.retState && window.retState.modalCreatives) || [];
    await supabase.from('creative_retention_messages').delete().eq('retention_message_id', msgId);
    if (selected.length) {
      const rows = selected.map((cid, i) => ({ retention_message_id: msgId, creative_id: cid, sort_order: i }));
      const { error: cErr } = await supabase.from('creative_retention_messages').insert(rows);
      if (cErr) console.warn('[creatives insert]', cErr);
    }
  } catch(e) { console.warn('[creatives sync]', e); }
  // #215 (Vira UX): andSubmit → переводимо у status='review' тим самим запитом
  if (opts && opts.andSubmit) {
    try {
      // Перевірка approvers перед transition
      const apprCount = Array.from(form.querySelectorAll('select[name="approvers"] option:checked')).length;
      if (!apprCount) {
        window.toast && window.toast('Збережено, але approvers порожні — не можу відправити на погодження', 'warn');
      } else {
        const { error: errReview } = await supabase.from('retention_messages').update({ status: 'review' }).eq('id', msgId);
        if (errReview) {
          window.toast && window.toast('Збережено, але transition не вдався: ' + errReview.message, 'warn');
        } else {
          await logHistory(msgId, 'status_changed', 'draft → review (one-click)');
          window.toast && window.toast('✓ Збережено і відправлено на погодження', 'success');
          if (overlay) overlay.remove();
          await loadAll();
          return;
        }
      }
    } catch(e) { console.warn('[andSubmit transition]', e); }
  }
  // #217: silent autosave — не закриваємо overlay і не toast
  if (opts && opts.silent) {
    return msgId;  // #363: повертаємо id щоб caller знав про новий created msg
  }
  if (overlay) overlay.remove();
  window.toast && window.toast('Збережено', 'success');
  await loadAll();
  return msgId;
}

async function deleteMsg(id, overlay){
  if (!confirm('Видалити цю розсилку? (soft delete)')) return;
  const supabase = window.supabase;
  const me = window.retState.publicUser;
  const { error } = await supabase.from('retention_messages').update({ deleted_at: new Date().toISOString(), deleted_by: me?.id || null }).eq('id', id);
  if (error) { alert('Delete failed: ' + error.message); return; }
  if (overlay) overlay.remove();
  window.toast && window.toast('Видалено', 'success');
  await loadAll();
}

async function transitionStatus(id, newStatus, overlay){
  const supabase = window.supabase;
  const { error } = await supabase.from('retention_messages').update({ status: newStatus }).eq('id', id);
  if (error) { alert('Status update failed: ' + error.message); return; }
  await logHistory(id, 'status_' + newStatus, null);
  if (overlay) overlay.remove();
  window.toast && window.toast('Статус: ' + (ST_LABELS[newStatus]?.name || newStatus), 'success');
  await loadAll();
}

async function approveMsg(id, overlay){
  const supabase = window.supabase;
  const me = window.retState.publicUser;
  if (!me) return;
  // mark approver record
  const { error: e1 } = await supabase.from('retention_message_approvers').upsert({ message_id: id, user_id: me.id, is_approved: true, decided_at: new Date().toISOString() });
  if (e1) { console.warn(e1); }
  // приймаємо рішення про статус — якщо всі approvers схвалили → approved
  const { data: apps } = await supabase.from('retention_message_approvers').select('*').eq('message_id', id);
  const allApproved = (apps || []).length > 0 && apps.every(a => a.is_approved === true);
  const newSt = allApproved ? 'approved' : 'review';
  const { error: e2 } = await supabase.from('retention_messages').update({ status: newSt }).eq('id', id);
  if (e2) { alert('Approve update failed: ' + e2.message); return; }
  await logHistory(id, 'approved_by_' + me.id, null);
  if (overlay) overlay.remove();
  window.toast && window.toast(allApproved ? '✅ Погоджено всіма' : '⏳ Один голос за', 'success');
  await loadAll();
}

async function rejectMsg(id, overlay){
  const reason = prompt('Причина:');
  if (!reason) return;
  const supabase = window.supabase;
  const me = window.retState.publicUser;
  await supabase.from('retention_message_approvers').upsert({ message_id: id, user_id: me.id, is_approved: false, decided_at: new Date().toISOString() });
  const { error } = await supabase.from('retention_messages').update({ status: 'rework', notes: '↩ ' + reason }).eq('id', id);
  if (error) { alert(error.message); return; }
  await logHistory(id, 'rejected', reason);
  if (overlay) overlay.remove();
  window.toast && window.toast('Повернено на доопрацювання', 'success');
  await loadAll();
}

async function logHistory(messageId, action, detail){
  const supabase = window.supabase;
  const me = window.retState && window.retState.publicUser;
  try {
    await supabase.from('retention_message_history').insert({ message_id: messageId, action, detail, actor_id: me?.id || null });
  } catch(e) { console.warn('[history]', e); }
}

// ============================================================
// ROUTING
// ============================================================
function parseRoute(){
  const h = (location.hash || '').replace(/^#/, '');
  return h || 'all';
}
function maybeRoute(){
  Store.route = parseRoute();
  renderAll();
}
window.addEventListener('hashchange', maybeRoute);
document.addEventListener('click', (e) => {
  const a = e.target.closest('.nav-item[data-route]');
  if (a) {
    e.preventDefault();
    Store.route = a.dataset.route;
    history.replaceState(null, '', '#' + Store.route);
    renderAll();
  }
});

window.addEventListener('ret-ready', async () => {
  Store.route = parseRoute();
  await loadAll();
  setupRealtime();
  const topNew = document.getElementById('btnNewTop');
  if (topNew) topNew.onclick = () => openMessageDetail(null);
});

function setupRealtime(){
  const supabase = window.supabase;
  if (!supabase) return;
  try {
    supabase.channel('rm-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'retention_messages' }, () => loadAll())
      .subscribe();
  } catch(e) { console.warn('[realtime]', e); }
}

})();
