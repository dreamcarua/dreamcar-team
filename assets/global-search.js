/* ========================================================================
   DreamCar Global Search (Cmd+K / Ctrl+K)
   Підключити: <script src="/assets/global-search.js" defer></script>
   Працює коли window.supabase already set (тобто після auth-guard).
   ======================================================================== */
(function () {
  if (window.__dcGlobalSearch) return;
  window.__dcGlobalSearch = true;

  const STYLES = `
    #dc-gs-backdrop {
      position: fixed; inset: 0; z-index: 99998;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      display: none; align-items: flex-start; justify-content: center;
      padding: 80px 20px 20px;
    }
    #dc-gs-backdrop.show { display: flex; }
    .dc-gs-modal {
      background: #141414; border: 1px solid #2A2A2A;
      border-radius: 12px; width: 100%; max-width: 640px;
      max-height: 70vh; display: flex; flex-direction: column;
      box-shadow: 0 30px 80px -20px rgba(0,0,0,0.8);
      font-family: 'Manrope', sans-serif; color: #fff;
    }
    .dc-gs-input-wrap {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 18px; border-bottom: 1px solid #2A2A2A;
    }
    .dc-gs-icon { color: #888; font-size: 18px; }
    .dc-gs-input {
      flex: 1; background: transparent; border: none; outline: none;
      color: #fff; font-size: 16px; padding: 6px 0;
      font-family: 'Manrope', sans-serif;
    }
    .dc-gs-kbd {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #888; background: #2A2A2A; padding: 3px 6px;
      border-radius: 3px; letter-spacing: 0.1em;
    }
    .dc-gs-results { overflow-y: auto; flex: 1; padding: 8px 4px; }
    .dc-gs-group-title {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      color: #E30613; letter-spacing: 0.18em; text-transform: uppercase;
      padding: 10px 18px 6px;
    }
    .dc-gs-item {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 18px; cursor: pointer; text-decoration: none;
      color: inherit; border-radius: 6px; margin: 0 8px;
      transition: background 80ms;
    }
    .dc-gs-item:hover, .dc-gs-item.active { background: rgba(227,6,19,0.12); }
    .dc-gs-item .ico {
      width: 32px; height: 32px; border-radius: 6px;
      background: #2A2A2A; display: flex; align-items: center; justify-content: center;
      font-size: 14px; flex-shrink: 0;
    }
    .dc-gs-item .meta { flex: 1; min-width: 0; }
    .dc-gs-item .title {
      font-size: 14px; font-weight: 600; color: #fff;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .dc-gs-item .sub {
      font-size: 11px; color: #888; margin-top: 2px;
      font-family: 'JetBrains Mono', monospace;
    }
    .dc-gs-empty {
      padding: 32px 18px; text-align: center; color: #888; font-size: 13px;
    }
    .dc-gs-footer {
      padding: 10px 18px; border-top: 1px solid #2A2A2A;
      display: flex; gap: 16px; font-family: 'JetBrains Mono', monospace;
      font-size: 10px; color: #888; letter-spacing: 0.1em;
    }
  `;
  const s = document.createElement('style');
  s.textContent = STYLES;
  document.head.appendChild(s);

  const overlay = document.createElement('div');
  overlay.id = 'dc-gs-backdrop';
  overlay.innerHTML = `
    <div class="dc-gs-modal" role="dialog" aria-label="Global search">
      <div class="dc-gs-input-wrap">
        <span class="dc-gs-icon">⌕</span>
        <input class="dc-gs-input" id="dc-gs-q" placeholder="Шукати публікації, задачі, креативи, людей…" autocomplete="off">
        <span class="dc-gs-kbd">ESC</span>
      </div>
      <div class="dc-gs-results" id="dc-gs-res"></div>
      <div class="dc-gs-footer">
        <span><span class="dc-gs-kbd">↑↓</span> навігація</span>
        <span><span class="dc-gs-kbd">⏎</span> відкрити</span>
        <span><span class="dc-gs-kbd">⌘K</span> переключити</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const inp = overlay.querySelector('#dc-gs-q');
  const res = overlay.querySelector('#dc-gs-res');
  let activeIdx = 0;
  let results = [];

  function open() {
    overlay.classList.add('show');
    inp.value = '';
    res.innerHTML = '<div class="dc-gs-empty">Почни вводити для пошуку…</div>';
    setTimeout(() => inp.focus(), 50);
  }
  function close() { overlay.classList.remove('show'); }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      overlay.classList.contains('show') ? close() : open();
    } else if (e.key === 'Escape' && overlay.classList.contains('show')) {
      close();
    }
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  let searchTimer;
  inp.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = inp.value.trim();
    if (!q || q.length < 2) {
      res.innerHTML = '<div class="dc-gs-empty">Почни вводити (мін. 2 символи)…</div>';
      return;
    }
    searchTimer = setTimeout(() => doSearch(q), 250);
  });

  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, results.length - 1); renderActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderActive(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[activeIdx];
      if (item) { window.location.href = item.url; close(); }
    }
  });

  function renderActive() {
    res.querySelectorAll('.dc-gs-item').forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    const active = res.querySelector('.dc-gs-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  async function doSearch(q) {
    if (!window.supabase) {
      res.innerHTML = '<div class="dc-gs-empty">Supabase не завантажено. Спробуй пізніше.</div>';
      return;
    }
    res.innerHTML = '<div class="dc-gs-empty">⏳ Пошук…</div>';
    const sb = window.supabase;
    const ql = `%${q}%`;
    try {
      const [pubs, tasks, cre, users] = await Promise.all([
        sb.from('publications').select('id,title,status').is('deleted_at', null).ilike('title', ql).limit(5),
        // 14.08.2026 (аудит): бракувало .is('deleted_at', null) — глобальний пошук
        // показував видалені задачі нарівні з живими.
        sb.from('team_tasks').select('id,title,status,priority').is('deleted_at', null).ilike('title', ql).limit(5),
        sb.from('creatives').select('id,name,type').is('deleted_at', null).ilike('name', ql).limit(5),
        sb.from('users').select('id,name,email,role').or(`name.ilike.${ql},email.ilike.${ql}`).limit(5),
      ]);
      const groups = [];
      if (pubs.data?.length) groups.push({ title: '✏ ПУБЛІКАЦІЇ', items: pubs.data.map(p => ({
        ico: '✏', title: p.title, sub: p.status, url: '/hq/#publication/' + p.id })) });
      if (tasks.data?.length) groups.push({ title: '✅ ЗАДАЧІ', items: tasks.data.map(t => ({
        ico: t.priority?.toUpperCase() || '✅', title: t.title, sub: t.status, url: '/tasks/#task=' + t.id })) });
      if (cre.data?.length) groups.push({ title: '🖼 КРЕАТИВИ', items: cre.data.map(c => ({
        ico: c.type === 'video' ? '🎬' : '🖼', title: c.name || '(без назви)', sub: c.type, url: '/hq/#library' })) });
      if (users.data?.length) groups.push({ title: '👥 ЛЮДИ', items: users.data.map(u => ({
        ico: '👤', title: u.name || u.email, sub: u.role, url: '/hq/#settings' })) });

      results = groups.flatMap(g => g.items);
      activeIdx = 0;

      if (!groups.length) {
        res.innerHTML = '<div class="dc-gs-empty">Нічого не знайдено.</div>';
        return;
      }
      res.innerHTML = groups.map(g => `
        <div class="dc-gs-group-title">${g.title}</div>
        ${g.items.map(it => `
          <a class="dc-gs-item" href="${it.url}">
            <div class="ico">${it.ico}</div>
            <div class="meta">
              <div class="title">${escape(it.title)}</div>
              <div class="sub">${escape(it.sub || '')}</div>
            </div>
          </a>`).join('')}
      `).join('');
      renderActive();
    } catch (e) {
      res.innerHTML = `<div class="dc-gs-empty">Помилка: ${escape(e.message)}</div>`;
    }
  }

  function escape(s) {
    return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Прибрати loading при початку
  console.log('[dc-gs] global search loaded — ⌘K to open');
})();
