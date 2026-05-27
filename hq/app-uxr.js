/* ============================================================
   DreamCar HQ — UX Round (Olexandr feedback)
   ============================================================ */
// Об'єднано 5 фіксів з feedback Олександра (18.05.2026):
// #132: після transition→review/rework — навігація на #board
// #133: hover '+' affordance на пустих cal-day cells
// #134: більше повітря (padding, line-height) у картці публікації
// #135: thumbnail у IG-preview підтягується з creative.thumbnail_url
// #136: IG feed 3×3 grid поряд з preview-tabs

(function () {
  if (window.__hqUxr) return;
  window.__hqUxr = true;

  // =================================================================
  // #134 — Більше повітря у картці публікації (CSS injection)
  // =================================================================
  (function injectSpacing() {
    if (document.getElementById('hq-uxr-spacing')) return;
    var css = document.createElement('style');
    css.id = 'hq-uxr-spacing';
    css.textContent =
      '.modal-body { padding: 32px 40px !important; }' +
      '.modal-head { padding: 22px 40px !important; }' +
      '.modal-foot { padding: 18px 40px !important; }' +
      '.pub-section { margin-bottom: 28px !important; }' +
      '.pub-section h4 { margin-bottom: 14px !important; font-size: 11px !important; letter-spacing: 1.8px !important; }' +
      '.field { margin-bottom: 18px !important; }' +
      '.field label { margin-bottom: 8px !important; font-size: 11px !important; letter-spacing: 1.5px !important; }' +
      '.field input, .field textarea, .field select { padding: 11px 14px !important; line-height: 1.5 !important; }' +
      '.field textarea { min-height: 120px !important; line-height: 1.65 !important; }' +
      '.field .hint { font-size: 12px !important; margin-top: 6px !important; line-height: 1.5 !important; }' +
      '.form-row { gap: 20px !important; margin-bottom: 18px !important; }' +
      '.chip-row { gap: 8px !important; }' +
      '.chip { padding: 7px 12px !important; font-size: 12px !important; }' +
      '.meta-list { gap: 18px !important; }' +
      '.meta-item .ml-label { margin-bottom: 6px !important; letter-spacing: 1.5px !important; }' +
      '.meta-item .ml-value { font-size: 14px !important; line-height: 1.5 !important; }' +
      '.tabs { margin-bottom: 18px !important; }' +
      '.tab { padding: 10px 16px !important; font-size: 13px !important; }' +
      '.comment { padding: 12px 14px !important; margin-bottom: 10px !important; }' +
      '.comment .c-body { line-height: 1.6 !important; }' +
      '.pub-card-layout { gap: 32px !important; }' +
      // Mobile — менше padding щоб не вийти за viewport
      '@media (max-width: 700px) {' +
        '.modal-body, .modal-head, .modal-foot { padding-left: 20px !important; padding-right: 20px !important; }' +
        '.pub-card-layout { gap: 20px !important; }' +
      '}';
    document.head.appendChild(css);
    console.log('%cHQ UXR %c· #134 spacing injected', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
  })();

  // =================================================================
  // #133 — Hover '+' affordance на cal-day cells
  // =================================================================
  (function injectCalendarAffordance() {
    if (document.getElementById('hq-uxr-calendar')) return;
    var css = document.createElement('style');
    css.id = 'hq-uxr-calendar';
    css.textContent =
      // Position relative щоб + позиціонувався відносно клітинки
      '.cal-day { position: relative; }' +
      // '+' icon (показуємо ЗАВЖДИ для пустих клітинок, ярче на hover)
      '.cal-day::after {' +
        'content: "+";' +
        'position: absolute;' +
        'bottom: 6px;' +
        'right: 8px;' +
        'width: 22px;' +
        'height: 22px;' +
        'border-radius: 50%;' +
        'background: rgba(216, 0, 4, 0.0);' +
        'color: rgba(255, 255, 255, 0.0);' +
        'display: flex;' +
        'align-items: center;' +
        'justify-content: center;' +
        'font-size: 16px;' +
        'font-weight: 700;' +
        'line-height: 1;' +
        'transition: all 0.15s;' +
        'pointer-events: none;' +
        'z-index: 1;' +
      '}' +
      '.cal-day:hover::after {' +
        'background: linear-gradient(135deg, #E30613, #b8050f);' +
        'color: #fff;' +
        'box-shadow: 0 2px 8px rgba(216, 0, 4, 0.4);' +
      '}' +
      // На пустих клітинках — додатково ghost-плейсхолдер посередині
      '.cal-day:not(:has(.cal-card)):not(:has(.more)) {' +
        'cursor: pointer;' +
      '}' +
      '.cal-day:not(:has(.cal-card)):not(:has(.more))::before {' +
        'content: "+ Нова";' +
        'position: absolute;' +
        'top: 50%;' +
        'left: 50%;' +
        'transform: translate(-50%, -50%);' +
        'font-family: "JetBrains Mono", monospace;' +
        'font-size: 11px;' +
        'letter-spacing: 1px;' +
        'color: rgba(255, 255, 255, 0.0);' +
        'transition: color 0.15s;' +
        'pointer-events: none;' +
        'text-transform: uppercase;' +
        'font-weight: 600;' +
      '}' +
      '.cal-day:not(:has(.cal-card)):not(:has(.more)):hover::before {' +
        'color: rgba(255, 106, 106, 0.6);' +
      '}' +
      '.cal-day.other-month::before, .cal-day.other-month::after { display: none !important; }' +
      // Light theme override
      'body.hq-light .cal-day:not(:has(.cal-card)):not(:has(.more)):hover::before { color: rgba(216,0,4,0.6); }';
    document.head.appendChild(css);
    console.log('%cHQ UXR %c· #133 calendar affordance injected', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
  })();

  // =================================================================
  // #132 — Після transition→review/rework navigate to #board
  // =================================================================
  (function patchTransitionFlow() {
    function tryPatch() {
      if (typeof window.transitionStatus !== 'function') return false;
      if (window.transitionStatus.__hqFlowPatched) return true;
      var _orig = window.transitionStatus;
      window.transitionStatus = async function (p, to, sourceBtn) {
        var result = await _orig.call(this, p, to, sourceBtn);
        // Після успішного переходу — навігація залежно від нового статусу
        setTimeout(function () {
          try {
            if (to === 'review' || to === 'rework') {
              if (typeof window.Modal !== 'undefined' && window.Modal.isOpen === false) {
                // Modal вже закрита — переходимо на дошку
                if (location.hash !== '#board') location.hash = '#board';
              }
            }
          } catch (_) {}
        }, 200);
        return result;
      };
      window.transitionStatus.__hqFlowPatched = true;
      return true;
    }
    if (!tryPatch()) {
      var tries = 0;
      var iv = setInterval(function () {
        if (tryPatch() || tries++ > 30) clearInterval(iv);
      }, 300);
    }
    console.log('%cHQ UXR %c· #132 transition flow patched', 'color:#7ab0ff;font-weight:700;', 'color:#888;');
  })();

  // =================================================================
  // #135 — Thumbnail у preview-card підтягується з creative.thumbnail_url
  // =================================================================
  // Це обробляється у app-preview-tabs.js через c.preview. Якщо c.preview
  // це emoji — пробуємо взяти c.thumbnail_url. Patch виправляє render.
  function patchPreviewThumbnail() {
    // Знайти всі preview-card .pv-media і замінити вміст на <img> якщо є thumbnail
    document.querySelectorAll('.preview-card .pv-media').forEach(function (media) {
      if (media.__hqThumbFixed) return;
      // Спробувати визначити креатив з найближчого parent що має __hqCurrentPub
      var pub = window.__hqCurrentPub;
      if (!pub || !Array.isArray(pub.creatives) || pub.creatives.length === 0) return;
      var cid = pub.creatives[0];
      var creative = null;
      try { creative = (typeof Store !== 'undefined' ? Store : window.Store).creative(cid); } catch (_) {}
      if (!creative) return;
      var thumbUrl = creative.thumbnail_url || creative.url;
      if (!thumbUrl) return;
      // Замінити вміст на img
      media.innerHTML = '<img src="' + thumbUrl + '" alt="' + (creative.name || 'creative') + '" ' +
        'style="width:100%;height:100%;object-fit:cover;display:block;" ' +
        'onerror="this.style.display=\'none\';this.parentElement.textContent=\'' + (creative.preview || '🚗').replace(/'/g, "\\'") + '\';"/>';
      media.__hqThumbFixed = true;
    });
  }

  // =================================================================
  // #136 — Instagram feed 3×3 preview
  // =================================================================
  function buildFeedGrid(pub) {
    var S;
    try { S = (typeof Store !== 'undefined' ? Store : window.Store); } catch (_) { return ''; }
    if (!S || typeof S.pubs !== 'function') return '';

    // Останні 8 опублікованих IG-постів + поточний посередині (9-ий)
    var published = S.pubs()
      .filter(function (p) {
        return p.status === 'published'
          && Array.isArray(p.platforms)
          && p.platforms.indexOf('ig') >= 0
          && !p._trashed
          && p.id !== pub.id;
      })
      .sort(function (a, b) { return new Date(b.dateTime) - new Date(a.dateTime); })
      .slice(0, 8);

    // Поточний пост у grid позиція 0 (top-left, найновіший)
    var allItems = [pub].concat(published);
    while (allItems.length < 9) allItems.push(null);

    var cells = allItems.slice(0, 9).map(function (p, idx) {
      var isCurrent = (idx === 0);
      if (!p) {
        return '<div class="hq-feed-cell hq-feed-empty" style="background:var(--bg-3);"></div>';
      }
      var thumb = null;
      try {
        var cid = (p.creatives || [])[0];
        if (cid) {
          var cr = S.creative(cid);
          thumb = cr && (cr.thumbnail_url || cr.url);
        }
      } catch (_) {}
      var bgStyle = thumb
        ? 'background:url("' + thumb + '") center/cover no-repeat;'
        : 'background:linear-gradient(135deg,var(--bg-3),var(--bg-2));';
      var borderStyle = isCurrent
        ? 'box-shadow:inset 0 0 0 3px #E30613;'
        : '';
      var icon = (p.contentType === 'Reels' ? '▶️' : p.contentType === 'Сторис' ? '🎬' : '');
      return '<div class="hq-feed-cell" style="' + bgStyle + borderStyle + 'position:relative;aspect-ratio:1;cursor:pointer;" ' +
        'data-pub="' + p.id + '" title="' + (p.title || '').replace(/"/g, '&quot;') + '">' +
        (icon ? '<span style="position:absolute;top:4px;right:4px;font-size:14px;text-shadow:0 1px 2px rgba(0,0,0,0.6);">' + icon + '</span>' : '') +
        (isCurrent ? '<span style="position:absolute;bottom:4px;left:4px;background:#E30613;color:#fff;font-size:9px;padding:2px 6px;border-radius:3px;font-family:\'JetBrains Mono\',monospace;letter-spacing:1px;font-weight:700;">NEW</span>' : '') +
        '</div>';
    }).join('');

    return '<div class="hq-feed-preview" style="margin-top:18px;">' +
      '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:var(--grey);letter-spacing:1.5px;margin-bottom:10px;text-transform:uppercase;font-weight:600;">/// IG ФІД — ЯК ВПИШЕТЬСЯ</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:2px;background:var(--border);border:1px solid var(--border);">' +
      cells +
      '</div>' +
      '<div style="font-size:11px;color:var(--grey);margin-top:8px;line-height:1.5;">Новий пост (з міткою <strong style="color:#E30613;">NEW</strong>) — як він стане у верхній лівий кут @dreamcar.ua. ' +
      'Реальний порядок залежить від часу публікації.</div>' +
      '</div>';
  }

  function injectFeedGrid() {
    var section = document.getElementById('previewSection');
    if (!section) return;
    if (section.querySelector('.hq-feed-preview')) return; // вже є
    var pub = window.__hqCurrentPub;
    if (!pub) return;
    if (!Array.isArray(pub.platforms) || pub.platforms.indexOf('ig') < 0) return; // тільки якщо IG обраний

    var grid = buildFeedGrid(pub);
    if (!grid) return;

    var wrapper = document.createElement('div');
    wrapper.innerHTML = grid;
    section.appendChild(wrapper.firstChild);

    // Bind clicks на cells
    section.querySelectorAll('.hq-feed-cell[data-pub]').forEach(function (cell) {
      cell.onclick = function () {
        var pid = cell.dataset.pub;
        if (pid && pid !== pub.id) location.hash = '#publication/' + pid;
      };
    });
  }

  // =================================================================
  // MutationObserver — re-apply на кожен render картки
  // =================================================================
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.getElementById('previewSection')) {
        clearTimeout(window.__hqUxrTimer);
        window.__hqUxrTimer = setTimeout(function () {
          patchPreviewThumbnail();
          injectFeedGrid();
        }, 80);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(function () { patchPreviewThumbnail(); injectFeedGrid(); }, 500);
  setTimeout(function () { patchPreviewThumbnail(); injectFeedGrid(); }, 1500);
  setTimeout(function () { patchPreviewThumbnail(); injectFeedGrid(); }, 4000);

  console.log('%cDreamCar HQ UXR %c· #132-#136 завантажено (5 фіксів)',
    'color:#7ab0ff;font-weight:700;', 'color:#888;');
})();
