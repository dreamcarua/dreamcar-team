// === HQ Overview Modal (v4) ===
// Best-practice: спершу read-only огляд із quick actions, edit — окремо за кнопкою.
// Monkey-patch над window.openCard(): existing → overview, 'new' → real edit.
(function () {
  if (window.__hqOverviewInstalled) return;
  window.__hqOverviewInstalled = true;

  const css = `
  .ov-modal { display: flex; flex-direction: column; max-height: 92vh; }
  .ov-head {
    padding: 18px 24px; border-bottom: 1px solid var(--line, #2A2A2A);
    display: flex; align-items: flex-start; gap: 14px;
  }
  .ov-head .ov-title-wrap { flex: 1; min-width: 0; }
  .ov-head h2 {
    margin: 0 0 8px; font-family: 'Oswald', 'Bebas Neue', sans-serif;
    font-size: 24px; line-height: 1.15; word-wrap: break-word;
  }
  .ov-badges { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .ov-badge {
    font-family: 'JetBrains Mono', monospace; font-size: 10px;
    letter-spacing: 0.15em; text-transform: uppercase;
    padding: 4px 10px; border-radius: 999px;
    background: rgba(255,255,255,0.06); color: var(--white, #fff);
    border: 1px solid var(--line, #2A2A2A);
  }
  .ov-badge.status-draft     { background: #3a3a3a; }
  .ov-badge.status-in_work   { background: #2563eb; }
  .ov-badge.status-review    { background: #d97706; }
  .ov-badge.status-rework    { background: #b45309; }
  .ov-badge.status-approved  { background: #16a34a; }
  .ov-badge.status-published { background: #4338ca; }
  .ov-badge.due-soon { color: #fbbf24; border-color: #fbbf24; }
  .ov-badge.due-over { color: #ef4444; border-color: #ef4444; }
  .ov-close { background: transparent; border: none; color: var(--ash, #888); font-size: 24px; cursor: pointer; padding: 0 6px; flex-shrink: 0; }
  .ov-close:hover { color: var(--white, #fff); }
  .ov-body { padding: 18px 24px; overflow-y: auto; flex: 1; }
  .ov-section { margin-bottom: 18px; }
  .ov-section-title {
    font-family: 'JetBrains Mono', monospace; font-size: 10px;
    color: var(--red, #E30613); letter-spacing: 0.2em;
    text-transform: uppercase; margin-bottom: 8px;
  }
  .ov-text {
    background: rgba(255,255,255,0.03); border-left: 2px solid var(--line, #2A2A2A);
    padding: 12px 14px; font-size: 13px; line-height: 1.55;
    color: var(--bone, #ddd); white-space: pre-wrap; word-wrap: break-word;
    max-height: 240px; overflow-y: auto;
  }
  .ov-tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .ov-tag {
    background: rgba(227,6,19,0.08); color: var(--red, #E30613);
    padding: 3px 9px; border-radius: 999px;
    font-family: 'JetBrains Mono', monospace; font-size: 11px;
  }`;

  const cssMore = `
  .ov-creatives { display: flex; flex-wrap: wrap; gap: 8px; }
  .ov-cr-thumb {
    width: 90px; height: 90px; border-radius: 6px; overflow: hidden;
    background: rgba(255,255,255,0.04); border: 1px solid var(--line, #2A2A2A);
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; position: relative;
  }
  .ov-cr-thumb img, .ov-cr-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ov-cr-thumb .ov-cr-kind {
    position: absolute; top: 4px; right: 4px;
    background: rgba(0,0,0,0.7); color: #fff;
    font-size: 9px; padding: 2px 4px; border-radius: 3px;
    font-family: 'JetBrains Mono', monospace;
  }
  .ov-people { display: flex; flex-wrap: wrap; gap: 6px; }
  .ov-chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 999px; font-size: 12px;
    background: rgba(255,255,255,0.04); border: 1px solid var(--line, #2A2A2A);
  }
  .ov-chip.approved { border-color: #16a34a; color: #4ade80; }
  .ov-chip.pending { border-color: #d97706; color: #fbbf24; }
  .ov-chip .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .ov-comments { display: flex; flex-direction: column; gap: 8px; }
  .ov-comment {
    background: rgba(255,255,255,0.03); padding: 10px 12px;
    border-radius: 6px; border-left: 2px solid var(--line, #2A2A2A);
    font-size: 13px; line-height: 1.5;
  }
  .ov-comment-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px; }
  .ov-comment-author { font-weight: 700; color: var(--white, #fff); font-size: 12px; }
  .ov-comment-time { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--ash, #888); }
  .ov-comment-body { color: var(--bone, #ddd); white-space: pre-wrap; }
  .ov-empty { font-size: 12px; color: var(--ash, #888); font-style: italic; }
  .ov-foot {
    padding: 14px 24px; border-top: 1px solid var(--line, #2A2A2A);
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    background: rgba(0,0,0,0.2);
  }
  .ov-foot .ov-foot-spacer { flex: 1; }
  .ov-btn {
    padding: 8px 14px; border-radius: 6px; border: 1px solid var(--line, #2A2A2A);
    background: rgba(255,255,255,0.04); color: var(--white, #fff);
    font-size: 13px; cursor: pointer; transition: background 120ms;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .ov-btn:hover { background: rgba(255,255,255,0.08); border-color: var(--red, #E30613); }
  .ov-btn.primary { background: var(--red, #E30613); border-color: var(--red, #E30613); color: #fff; }
  .ov-btn.primary:hover { background: var(--red-deep, #B8050F); }
  .ov-btn.success { background: #16a34a; border-color: #16a34a; color: #fff; }
  .ov-btn.success:hover { background: #15803d; }
  .ov-btn.warn { background: #d97706; border-color: #d97706; color: #fff; }
  .ov-btn.warn:hover { background: #b45309; }
  .ov-btn.danger { color: #ef4444; border-color: #ef4444; }
  .ov-btn.danger:hover { background: #ef4444; color: #fff; }
  /* 09.06.2026 #194 — Quick-status chip-row для CEO/COO */
  .qs-row {
    display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 24px;
    border-top: 1px solid var(--line, #2A2A2A);
    background: rgba(255,255,255,0.02);
  }
  .qs-chip {
    padding: 5px 10px; font-family: 'JetBrains Mono', monospace;
    font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase;
    border: 1px solid var(--line, #2A2A2A); background: transparent;
    color: var(--bone, #ddd); cursor: pointer; border-radius: 14px;
    transition: all 120ms;
  }
  .qs-chip:hover:not(:disabled) {
    border-color: var(--red, #E30613); color: #fff;
    background: rgba(227,6,19,0.08);
  }
  .qs-chip.active {
    border-color: var(--red, #E30613); color: var(--red, #E30613);
    background: rgba(227,6,19,0.12); cursor: default;
    font-family: 'Archivo Black', sans-serif;
  }
  .qs-chip:disabled { opacity: 0.85; }
  @media (max-width: 640px) {
    .ov-modal { max-height: 95vh; }
    .ov-head, .ov-body, .ov-foot { padding-left: 16px; padding-right: 16px; }
    .ov-head h2 { font-size: 20px; }
    .ov-foot { flex-direction: column; align-items: stretch; }
    .ov-foot .ov-btn { justify-content: center; }
    .ov-foot .ov-foot-spacer { display: none; }
  }`;
  const styleEl = document.createElement('style');
  styleEl.id = 'hq-overview-styles';
  styleEl.textContent = css + cssMore;
  document.head.appendChild(styleEl);

  // ───── HELPERS ─────
  function fmtDT(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } catch { return iso; }
  }
  function fmtD(iso) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
    } catch { return iso; }
  }
  function fmtRel(iso) {
    if (!iso) return '';
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'щойно';
    if (m < 60) return m + ' хв тому';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' год тому';
    const d = Math.floor(h / 24);
    return d < 7 ? d + ' дн тому' : fmtD(iso);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  // #257: TG HTML format — parse дозволені TG теги. Те ж що app-views.js tgFormatToHtml.
  function tgFmt(raw) {
    if (!raw) return '';
    let s = String(raw).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tags = ['b','strong','i','em','u','s','strike','del','code','pre','tg-spoiler','blockquote','br'];
    tags.forEach(t => {
      s = s.replace(new RegExp(`&lt;${t}&gt;`, 'gi'), `<${t}>`)
           .replace(new RegExp(`&lt;\\/${t}&gt;`, 'gi'), `</${t}>`);
    });
    s = s.replace(/&lt;a\s+href=&quot;([^&]+)&quot;&gt;([\s\S]*?)&lt;\/a&gt;/gi,
      (_, url, txt) => `<a href="${url.replace(/"/g,'&quot;')}" target="_blank" rel="noopener" style="color:#3390ec;">${txt}</a>`);
    s = s.replace(/&lt;&lt;&lt;([\s\S]+?)&gt;&gt;&gt;/g, '<tg-spoiler>$1</tg-spoiler>');
    return s.replace(/\n/g, '<br>');
  }
  function sLabel(s) { return (typeof STATUS_BY_ID !== 'undefined' && STATUS_BY_ID[s]?.label) || s || '—'; }
  function dueCls(p) {
    if (!p.deadline) return '';
    const dl = new Date(p.deadline + 'T23:59:59').getTime();
    if (Date.now() > dl) return 'due-over';
    if (dl - Date.now() < 24 * 3600 * 1000) return 'due-soon';
    return '';
  }
  function uName(id) {
    const u = (Store.users() || []).find(x => x.id === id);
    return u?.name || u?.email || id;
  }
  function platRow(p) {
    if (!p.platforms?.length) return '<span class="ov-empty">не вказано</span>';
    const PL = (typeof PLATFORMS !== 'undefined') ? PLATFORMS : [];
    return p.platforms.map(pid => {
      const pl = PL.find(x => x.id === pid);
      return `<span class="ov-tag">${pl?.icon || ''} ${esc(pl?.name || pid)}</span>`;
    }).join('');
  }
  function crRow(p) {
    const items = p.creatives || [];
    if (!items.length) return '<span class="ov-empty">креативів немає</span>';
    // p.creatives — массив UUID-ів. Підіймаємо обʼєкти зі Store.
    return items.slice(0, 8).map(item => {
      const c = (typeof item === 'string')
        ? (Store.creative ? Store.creative(item) : null)
        : item;
      if (!c) return `<div class="ov-cr-thumb">📦</div>`;
      const url = c.compressed_url || c.thumbnail_url || c.url || c.thumb_url || c.drive_file_id || '';
      const isVideo = c.type === 'video' || (c.kind === 'video') || /\.(mp4|mov|webm)$/i.test(url);
      if (isVideo) {
        // #225 (Олександр: 'видно на долю сек при reload'): додав poster з thumbnail_url щоб preview frame показав ВІДРАЗУ. preload=metadata не вантажить кадр без poster. Click → відкриває fullscreen video у новій вкладці.
        const poster = c.thumbnail_url || c.thumb_url || '';
        const mediaUrl = c.compressed_url || c.compressed_url_hevc || url;
        if (poster) {
          return `<div class="ov-cr-thumb" title="${esc(c.name || 'video')}" data-video-url="${esc(mediaUrl)}" style="cursor:pointer;"><img src="${esc(poster)}" alt="" loading="lazy"><span class="ov-cr-kind">▶ VIDEO</span></div>`;
        }
        return `<div class="ov-cr-thumb" title="${esc(c.name || 'video')}">${mediaUrl ? `<video src="${esc(mediaUrl)}" muted preload="metadata"></video>` : '🎬'}<span class="ov-cr-kind">VIDEO</span></div>`;
      }
      return `<div class="ov-cr-thumb" title="${esc(c.name || 'image')}">${url ? `<img src="${esc(url)}" alt="" loading="lazy">` : (c.preview || '🖼')}</div>`;
    }).join('') + (items.length > 8 ? `<div class="ov-cr-thumb">+${items.length-8}</div>` : '');
  }
  function apprRow(p) {
    if (!p.approvers?.length) return '<span class="ov-empty">не вказані</span>';
    const approved = new Set(p.approvedBy || p.approved_by || []);
    return p.approvers.map(id => {
      const cls = approved.has(id) ? 'approved' : 'pending';
      const ic = approved.has(id) ? '✓' : '◐';
      return `<span class="ov-chip ${cls}"><span class="dot"></span>${ic} ${esc(uName(id))}</span>`;
    }).join('');
  }
  function respRow(p) {
    if (!p.responsibles?.length) return '<span class="ov-empty">не вказано</span>';
    return p.responsibles.map(id => `<span class="ov-chip">${esc(uName(id))}</span>`).join('');
  }
  function commRow(p) {
    const cs = (p.comments || []).slice(-3).reverse();
    if (!cs.length) return '<span class="ov-empty">коментарів немає</span>';
    return `<div class="ov-comments">${cs.map(c => `
      <div class="ov-comment">
        <div class="ov-comment-head">
          <span class="ov-comment-author">${esc(uName(c.author || c.user_id))}</span>
          <span class="ov-comment-time">${esc(fmtRel(c.at || c.created_at))}</span>
        </div>
        <div class="ov-comment-body">${esc(c.body || c.text || '')}</div>
      </div>`).join('')}</div>`;
  }

  function qActs(p, me) {
    const acts = [];
    const isResp = (p.responsibles || []).includes(me.id) || me.role === 'lead';
    const isAppr = (p.approvers || []).includes(me.id);
    if (p.status === 'draft' && isResp) acts.push({ to: 'in_work', label: '▶ Взяти в роботу', cls: 'ov-btn primary' });
    if (p.status === 'in_work' && isResp) acts.push({ to: 'review', label: '→ На погодження', cls: 'ov-btn primary' });
    if (p.status === 'review' && isAppr) {
      acts.push({ to: 'approved', label: '✓ Погодити', cls: 'ov-btn success' });
      acts.push({ to: 'rework', label: '↩ Повернути', cls: 'ov-btn warn' });
    }
    if (p.status === 'rework' && isResp) acts.push({ to: 'review', label: '→ На погодження', cls: 'ov-btn primary' });
    if (p.status === 'approved' && (isResp || isAppr)) acts.push({ to: 'published', label: '🚀 Опублікована', cls: 'ov-btn success' });
    return acts;
  }

  // 09.06.2026 #194 — Quick-status chip-row для CEO/COO (Давид прохав миттєвий перехід)
  const PUB_STATUSES = [
    { v:'draft',     lbl:'📝 Draft' },
    { v:'in_work',   lbl:'▶ В роботі' },
    { v:'review',    lbl:'👀 Review' },
    { v:'approved',  lbl:'✅ Approved' },
    { v:'published', lbl:'🚀 Published' },
    { v:'rework',    lbl:'↩ Rework' }
  ];
  function quickStatusRow(p, me) {
    if (!me || !['ceo','coo'].includes(me.role)) return '';
    const chips = PUB_STATUSES.map(s =>
      `<button class="qs-chip ${s.v===p.status?'active':''}" data-qs-pub="${s.v}" ${s.v===p.status?'disabled':''}>${s.lbl}</button>`
    ).join('');
    return `<div class="qs-row" title="CEO/COO: миттєвий перехід">${chips}</div>`;
  }

  function render(p) {
    const me = Store.currentUser();
    const acts = qActs(p, me);
    const dCls = dueCls(p);
    const canDelete = ['lead','ceo','coo'].includes(me.role) || (p.responsibles||[]).includes(me.id);
    return `
      <div class="ov-modal">
        <div class="ov-head">
          <div class="ov-title-wrap">
            <h2>${tgFmt(p.title || '(без назви)')}</h2>
            <div class="ov-badges">
              <span class="ov-badge status-${p.status}">${esc(sLabel(p.status))}</span>
              ${p.dateTime ? `<span class="ov-badge">${esc(fmtDT(p.dateTime))}</span>` : ''}
              ${p.deadline ? `<span class="ov-badge ${dCls}">⏱ дедлайн ${esc(fmtD(p.deadline))}</span>` : ''}
              ${p.contentType ? `<span class="ov-badge">${esc(p.contentType)}</span>` : ''}
              ${p.rubric ? `<span class="ov-badge">${esc(p.rubric)}</span>` : ''}
            </div>
          </div>
          <button class="ov-close" onclick="Modal.close()" title="Закрити (Esc)">×</button>
        </div>
        <div class="ov-body">
          <!-- #369 (12.06.2026 Vadym): повноцінні platform preview cards замість окремих Майданчики/Текст/Креативи -->
          <div class="ov-section">
            <div class="ov-section-title">Прев'ю по майданчиках</div>
            ${typeof window.renderPreviewSection === 'function' ? window.renderPreviewSection(p) : `<div class="ov-tags">${platRow(p)}</div><div class="ov-text" style="margin-top:8px;">${tgFmt(p.text || '(порожньо)')}</div><div class="ov-creatives" style="margin-top:8px;">${crRow(p)}</div>`}
          </div>
          <div class="ov-section"><div class="ov-section-title">Відповідальні</div><div class="ov-people">${respRow(p)}</div></div>
          <div class="ov-section"><div class="ov-section-title">Погоджувачі</div><div class="ov-people">${apprRow(p)}</div></div>
          <div class="ov-section"><div class="ov-section-title">Останні коментарі</div>${commRow(p)}</div>
        </div>
        ${quickStatusRow(p, me)}
        <div class="ov-foot">
          ${acts.map(a => `<button class="${a.cls}" data-ov-action="${a.to}">${a.label}</button>`).join('')}
          <button class="ov-btn" data-ov-comment>💬 Коментар</button>
          <span class="ov-foot-spacer"></span>
          <button class="ov-btn" data-ov-duplicate title="Створити копію публікації з такими ж креативами">📋 Дублювати</button>
          <button class="ov-btn" data-ov-edit>✏ Редагувати</button>
          ${canDelete ? `<button class="ov-btn danger" data-ov-delete>🗑 Видалити</button>` : ''}
        </div>
      </div>`;
  }

  async function showOverview(id) {
    const p = Store.pub(id);
    if (!p) {
      if (typeof toast === 'function') toast('Публікацію не знайдено', 'error');
      location.hash = '#calendar';
      return;
    }
    Modal.open(render(p));
    window.__hqCurrentPub = p;

    document.querySelectorAll('[data-ov-action]').forEach(btn => {
      btn.onclick = async () => {
        const to = btn.dataset.ovAction;
        if (typeof transitionStatus === 'function') {
          await transitionStatus(p, to, btn);
        }
      };
    });

    // #227: video lightbox — клік на video thumb → fullscreen player зі звуком
    document.querySelectorAll('[data-video-url]').forEach(thumb => {
      thumb.onclick = (e) => {
        e.stopPropagation();
        const url = thumb.dataset.videoUrl;
        if (!url) return;
        // Створюємо overlay поверх існуючого modal
        const lb = document.createElement('div');
        lb.id = 'dc-video-lightbox';
        lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
        lb.innerHTML = `
          <button style="position:absolute;top:20px;right:20px;background:rgba(0,0,0,0.5);border:1px solid #fff;color:#fff;width:40px;height:40px;border-radius:50%;font-size:18px;cursor:pointer;z-index:1;" title="Закрити (Esc)">✕</button>
          <video src="${url.replace(/"/g, '&quot;')}" controls autoplay playsinline style="max-width:92vw;max-height:92vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.7);"></video>
        `;
        const close = () => { lb.remove(); document.removeEventListener('keydown', escHandler); };
        const escHandler = (ev) => { if (ev.key === 'Escape') close(); };
        lb.onclick = (ev) => { if (ev.target === lb || ev.target.tagName === 'BUTTON') close(); };
        document.addEventListener('keydown', escHandler);
        document.body.appendChild(lb);
      };
    });

    // 09.06.2026 #194 — Quick-status chip clicks (CEO/COO only)
    document.querySelectorAll('[data-qs-pub]').forEach(chip => {
      chip.onclick = async () => {
        const to = chip.dataset.qsPub;
        if (!to || to === p.status) return;
        chip.disabled = true;
        // Re-use transitionStatus якщо є; інакше — прямий update
        if (typeof transitionStatus === 'function') {
          await transitionStatus(p, to, chip);
        } else {
          const sb = window.supabase;
          if (!sb) { chip.disabled = false; return; }
          const { error } = await sb.from('publications').update({ status: to, updated_at: new Date().toISOString() }).eq('id', p.id);
          if (error) {
            chip.disabled = false;
            if (typeof toast === 'function') toast(error.message, 'error');
            return;
          }
          if (typeof toast === 'function') toast(`Статус → ${sLabel(to)}`, 'success');
          Modal.close();
        }
      };
    });

    const editBtn = document.querySelector('[data-ov-edit]');
    if (editBtn) editBtn.onclick = () => {
      window.__hqDirectEdit = true;
      try {
        if (typeof window._origOpenCard === 'function') window._origOpenCard(id);
      } finally {
        window.__hqDirectEdit = false;
      }
    };

    const cmtBtn = document.querySelector('[data-ov-comment]');
    if (cmtBtn) cmtBtn.onclick = async () => {
      const body = prompt('Коментар:', '');
      if (!body || !body.trim()) return;
      try {
        if (Store.addComment) await Store.addComment(p.id, body.trim());
        if (typeof toast === 'function') toast('Коментар додано', 'success');
        showOverview(id);
      } catch (err) {
        console.error(err);
        if (typeof toast === 'function') toast('Помилка', 'error', err.message || '');
      }
    };

    const dupBtn = document.querySelector('[data-ov-duplicate]');
    if (dupBtn) dupBtn.onclick = async () => {
      // 09.06.2026 #208: повертаємо функціонал який жив у app-extras.js але прив'язаний до старого .modal-foot
      try {
        if (typeof window.duplicatePub === 'function') {
          window.duplicatePub(id);
          Modal.close();
        } else if (typeof toast === 'function') {
          toast('Функція дублювання тимчасово недоступна', 'error');
        }
      } catch (err) {
        console.error('[ov-duplicate]', err);
        if (typeof toast === 'function') toast('Помилка дублювання: ' + (err.message || err), 'error');
      }
    };

    const delBtn = document.querySelector('[data-ov-delete]');
    if (delBtn) delBtn.onclick = async () => {
      if (!confirm('Видалити публікацію «' + (p.title || 'без назви') + '»?')) return;
      try {
        if (Store.deletePub) await Store.deletePub(p.id);
        else if (Store.removePub) await Store.removePub(p.id);
        if (typeof toast === 'function') toast('Видалено', 'success');
        Modal.close();
        if (typeof navigate === 'function') navigate();
      } catch (err) {
        if (typeof toast === 'function') toast('Помилка', 'error', err.message || '');
      }
    };
  }

  // Monkey-patch openCard
  function installPatch() {
    if (typeof window.openCard !== 'function') {
      setTimeout(installPatch, 100);
      return;
    }
    if (window._origOpenCard) return; // already patched
    window._origOpenCard = window.openCard;
    window.openCard = function (id) {
      if (id === 'new' || window.__hqDirectEdit) {
        return window._origOpenCard(id);
      }
      const p = Store && Store.pub ? Store.pub(id) : null;
      if (!p) return window._origOpenCard(id);
      // FIX (28.05.2026): свіжо створена «порожня» публікація — одразу edit,
      // НЕ overview. Інакше користувач не міг наповнити нову пуб контентом.
      const isEmpty = !p.title
        && (!p.text || !p.text.trim())
        && (!p.platforms || !p.platforms.length)
        && (!p.creatives || !p.creatives.length);
      if (isEmpty) return window._origOpenCard(id);
      return showOverview(id);
    };
    if (window.DEBUG) console.log('[hq] overview-modal v4.1 installed (empty-pub direct-edit)');
  }
  installPatch();
})();
