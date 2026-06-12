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
  route: 'all',
  loading: false,
  selected: null,
  // 06.06.2026 — повна parity з SMM календарем
  calView: 'month',           // month | week | day | list | board
  calDate: new Date(),        // anchor date для navigation
  search: '',
  channelFilter: new Set(),   // filter chips
  statusFilter: new Set(),
};

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
    const [msgs, users, projects, approvers, responsibles] = await Promise.all([
      supabase.from('retention_messages').select('*').is('deleted_at', null).order('publish_at', { ascending: false }).limit(500),
      // 08.06.2026 Vira fix: users.deleted_at НЕ ІСНУЄ → запит повертав null → dropdowns approvers/responsibles порожні.
      supabase.from('users').select('id,name,email,role').eq('is_active', true).order('name'),
      // 08.06.2026 Vira fix: launches не має deleted_at і starts_at (а тільки starts_on).
      supabase.from('launches').select('id,name,status').order('starts_on', { ascending: false }).limit(100),
      supabase.from('retention_message_approvers').select('*'),
      supabase.from('retention_message_responsibles').select('*'),
    ]);
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
  renderMain();
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
  const items = Store.messages.filter(getRouteFilter());
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
    return `
      <div class="msg-row" data-id="${m.id}">
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
  const items = Store.messages.filter(f);
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
            return `
              <div class="msg-card" data-id="${m.id}" style="background:var(--bg-3); border:1px solid var(--line); border-radius:6px; padding:10px; cursor:pointer;">
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
    if (q && !((m.title||'').toLowerCase().includes(q) || (m.body||'').toLowerCase().includes(q) || (m.preview_text||'').toLowerCase().includes(q))) return false;
    return true;
  });
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
  const ch = CH_LABELS[m.channel] || CH_LABELS.other;
  const st = ST_LABELS[m.status] || ST_LABELS.draft;
  const dt = new Date(m.publish_at);
  const hh = String(dt.getHours()).padStart(2,'0');
  const mm = String(dt.getMinutes()).padStart(2,'0');
  const title = (m.title || '(без назви)');
  if (size === 'short') {
    // #350 Vira UX: час перед назвою у Month view (раніше було тільки ch.ic + title)
    return `<div class="cal-item" data-id="${m.id}" title="${hh}:${mm} · ${escHtml(title)}" style="cursor:pointer; font-size:10px; padding:3px 5px; background:var(--bg-3); border-radius:3px; border-left:3px solid var(--red); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ch.ic} <span style="color:#fff; font-weight:700; font-variant-numeric:tabular-nums;">${hh}:${mm}</span> <span style="color:var(--ash);">·</span> ${escHtml(title).slice(0, 18)}</div>`;
  }
  if (size === 'medium') {
    // #350: жирний час як префікс title для консистентності з Month
    return `<div class="cal-item" data-id="${m.id}" style="cursor:pointer; padding:6px 8px; background:var(--bg-3); border-radius:5px; border-left:3px solid var(--red);">
      <div style="font-size:10px; color:var(--ash);">${ch.ic} ${st.name ? '· ' + escHtml(st.name) : ''}</div>
      <div style="font-size:11px; color:#fff; margin-top:2px;"><span style="color:#fff; font-weight:700; font-variant-numeric:tabular-nums;">${hh}:${mm}</span> <span style="color:var(--ash);">·</span> ${escHtml(title).slice(0, 50)}</div>
      <span class="chip ${st.cls}" style="margin-top:4px;">${escHtml(st.name)}</span>
    </div>`;
  }
  return `<div class="cal-item" data-id="${m.id}" style="cursor:pointer; padding:10px 12px; background:var(--bg-3); border-radius:6px; border-left:4px solid var(--red); display:flex; gap:10px; align-items:center;">
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
      return `<div class="msg-row" data-id="${m.id}">
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
          <span style="font-size:11px; color:var(--ash); display:block; margin-bottom:4px;">ТІЛО РОЗСИЛКИ * (HTML/Markdown/Plain)</span>
          <textarea name="body" required rows="10" placeholder="Вміст розсилки..." style="width:100%; padding:10px; background:var(--bg-3); border:1px solid var(--steel); color:#fff; border-radius:6px; font-family:inherit; resize:vertical;">${escHtml(m.body || '')}</textarea>
        </label>
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
  // #217 (Vira UX): backdrop click більше НЕ закриває modal без save — захист від втрати даних
  overlay.onclick = (e) => {
    if (e.target !== overlay) return;
    const dirty = overlay.dataset.dirty === '1';
    if (dirty) {
      window.toast && window.toast('Не закриваю — є незбережені зміни. Натисни ✕ якщо точно хочеш вийти', 'warn');
      return;
    }
    overlay.remove();
  };
  document.getElementById('closeDetail').onclick = () => {
    const dirty = overlay.dataset.dirty === '1';
    if (dirty && !confirm('Є незбережені зміни. Точно закрити без збереження?')) return;
    overlay.remove();
  };

  document.getElementById('msgForm').onsubmit = (e) => { e.preventDefault(); saveForm(e.target, isNew ? null : m.id, overlay); };

  // #217 (Vira UX): AUTOSAVE при кожній зміні form (тільки для існуючого draft, не для нової)
  if (!isNew) {
    const form = document.getElementById('msgForm');
    const ind = document.getElementById('msgAutosaveInd');
    let saveTimer = null;
    const markDirty = () => { overlay.dataset.dirty = '1'; if (ind) { ind.textContent = '⏳ Збереження…'; ind.style.color = 'var(--amber, #f59e0b)'; } };
    const markSaved = () => { overlay.dataset.dirty = '0'; if (ind) { ind.textContent = '✓ збережено ' + new Date().toLocaleTimeString('uk-UA', { hour:'2-digit', minute:'2-digit' }); ind.style.color = 'var(--green, #10b981)'; } };
    const markErr  = (msg) => { if (ind) { ind.textContent = '⚠ ' + (msg || 'помилка'); ind.style.color = 'var(--red-soft, #ef4444)'; } };
    const doAutosave = async () => {
      try {
        await saveForm(form, m.id, null, { silent: true });
        markSaved();
      } catch(e) { markErr(e && e.message); }
    };
    const scheduleAutosave = () => {
      markDirty();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(doAutosave, 800);
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
    if (form) saveForm(form, isNew ? null : m.id, overlay, { andSubmit: true });
  };

  // 08.06.2026 Vira: PREVIEW тільки для email; toggle при зміні channel
  const channelSel = document.querySelector('select[name="channel"]');
  if (channelSel) channelSel.addEventListener('change', () => {
    const lbl = document.getElementById('lblPreviewText');
    if (lbl) lbl.style.display = channelSel.value === 'tg' ? 'none' : '';
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
    if (p) p.textContent = c == null ? 'не вдалось оцінити' : `~${c} підписників (Phase 1: вся база)`;
  };
  if (!isNew) loadHistory(m.id);
  const spBtn = document.getElementById('loadSpBooks');
  if (spBtn) spBtn.onclick = () => loadSendPulseBooks(spBtn);
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
  // Phase 1: повертаємо приблизну оцінку через RPC або mock.
  // Поки нема SendPulse — рахуємо з public.users якщо є тариф/статус.
  const supabase = window.supabase;
  if (!supabase) return null;
  try {
    let q = supabase.from('users').select('id', { count: 'exact', head: true }).is('deleted_at', null);
    // tariff/user_status — це поля яких ще нема у public.users; для real audience треба окрема таблиця учасників.
    // Тимчасово: повертаємо count всієї бази як hint.
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

async function saveForm(form, id, overlay, opts){
  const supabase = window.supabase;
  if (!supabase) return;
  const me = window.retState && window.retState.publicUser;
  if (!me) { alert('Профіль не знайдено'); return; }
  const fd = new FormData(form);
  const audience_filter = {};
  if (fd.get('filter_tariff')) audience_filter.tariff = fd.get('filter_tariff');
  if (fd.get('filter_status')) audience_filter.user_status = fd.get('filter_status');
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
    return;
  }
  if (overlay) overlay.remove();
  window.toast && window.toast('Збережено', 'success');
  await loadAll();
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
