/* ========================================================================
   HQ Bulk Drag-Drop Upload — multi-file у Бібліотеку креативів
   Перетворює .library-wrap у дроп-зону + показує прогрес-бар на кожен файл.
   Використовує window.uploadCreativeFile() з app-drive.js.
   ======================================================================== */
(function () {
  if (window.__hqBulkUpload) return;
  window.__hqBulkUpload = true;

  const STYLES = `
    .lib-dropzone-overlay {
      position: fixed; inset: 0; z-index: 9000; pointer-events: none;
      background: rgba(227,6,19,0.10); border: 4px dashed #E30613;
      display: none; align-items: center; justify-content: center;
      font-family: 'Oswald', sans-serif; font-size: 38px; color: #fff;
      letter-spacing: 0.05em; text-shadow: 0 2px 12px rgba(0,0,0,0.8);
    }
    .lib-dropzone-overlay.show { display: flex; }
    .lib-bulk-progress {
      position: fixed; bottom: 24px; right: 24px; z-index: 8000;
      background: #141414; border: 1px solid #2A2A2A; border-radius: 10px;
      padding: 16px 18px; min-width: 320px; max-width: 420px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.6);
      font-family: 'Manrope', sans-serif; color: #fff;
      max-height: 60vh; overflow-y: auto;
    }
    .lib-bulk-progress.hidden { display: none; }
    .lib-bulk-head {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #2A2A2A;
    }
    .lib-bulk-title { font-family: 'Oswald', sans-serif; font-size: 16px; letter-spacing: 0.02em; }
    .lib-bulk-close {
      background: transparent; border: none; color: #888; cursor: pointer;
      font-size: 18px;
    }
    .lib-bulk-item {
      padding: 8px 0; border-bottom: 1px solid #2A2A2A; font-size: 12px;
      display: flex; justify-content: space-between; gap: 10px; align-items: center;
    }
    .lib-bulk-item:last-child { border-bottom: none; }
    .lib-bulk-name {
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .lib-bulk-state {
      font-family: 'JetBrains Mono', monospace; font-size: 10px;
      letter-spacing: 0.08em; color: #888; flex-shrink: 0;
    }
    .lib-bulk-state.ok { color: #10B981; }
    .lib-bulk-state.err { color: #DC2626; }
    .lib-bulk-state.up { color: #3B82F6; }
  `;
  const s = document.createElement('style');
  s.textContent = STYLES;
  document.head.appendChild(s);

  const overlay = document.createElement('div');
  overlay.className = 'lib-dropzone-overlay';
  overlay.textContent = '⬇ Кидай файли сюди';
  document.body.appendChild(overlay);

  let dragCounter = 0;
  function showOverlay() { overlay.classList.add('show'); }
  function hideOverlay() { overlay.classList.remove('show'); }

  window.addEventListener('dragenter', (e) => {
    if (e.dataTransfer?.types?.includes('Files')) {
      dragCounter++;
      showOverlay();
    }
  });
  window.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; hideOverlay(); }
  });
  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    hideOverlay();
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length) return;
    // Працюємо тільки коли користувач у бібліотеці
    if (location.hash && !location.hash.startsWith('#library') && !location.hash.startsWith('#publication')) {
      // Авто-навігація у бібліотеку
      if (!confirm(`Завантажити ${files.length} файлів у Бібліотеку?`)) return;
      location.hash = '#library';
    }
    await bulkUpload(files);
  });

  async function bulkUpload(files) {
    let panel = document.getElementById('lib-bulk-progress');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'lib-bulk-progress';
      panel.className = 'lib-bulk-progress';
      panel.innerHTML = `
        <div class="lib-bulk-head">
          <span class="lib-bulk-title">📤 Завантаження ${files.length} файлів</span>
          <button class="lib-bulk-close" onclick="this.parentElement.parentElement.classList.add('hidden')">×</button>
        </div>
        <div id="lib-bulk-items"></div>
      `;
      document.body.appendChild(panel);
    } else {
      panel.classList.remove('hidden');
    }
    const itemsBox = panel.querySelector('#lib-bulk-items');

    if (typeof window.uploadCreativeFile !== 'function') {
      itemsBox.innerHTML = '<div class="lib-bulk-item"><span>❌ uploadCreativeFile() не доступна — оновіть сторінку</span></div>';
      return;
    }

    let okCount = 0, errCount = 0;
    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'lib-bulk-item';
      const nameEl = document.createElement('span');
      nameEl.className = 'lib-bulk-name';
      nameEl.textContent = file.name + ' (' + humanSize(file.size) + ')';
      const stateEl = document.createElement('span');
      stateEl.className = 'lib-bulk-state up';
      stateEl.textContent = 'UPLOAD…';
      row.appendChild(nameEl);
      row.appendChild(stateEl);
      itemsBox.appendChild(row);

      try {
        await window.uploadCreativeFile(file, null);
        stateEl.className = 'lib-bulk-state ok';
        stateEl.textContent = '✓ DONE';
        okCount++;
      } catch (e) {
        stateEl.className = 'lib-bulk-state err';
        stateEl.textContent = '✕ ' + (e.message || 'error').slice(0, 30);
        errCount++;
      }
    }

    panel.querySelector('.lib-bulk-title').textContent =
      `📤 Готово: ${okCount}/${files.length}${errCount ? ' (' + errCount + ' помилок)' : ''}`;

    // Оновити Library після завантаження
    if (typeof renderLibrary === 'function' && location.hash.startsWith('#library')) {
      setTimeout(() => renderLibrary(document.getElementById('main')), 1000);
    }
  }

  function humanSize(b) {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return b.toFixed(b < 10 ? 1 : 0) + ' ' + u[i];
  }

  if (window.DEBUG) console.log('[hq-bulk-upload] ✓ drag-drop ready (anywhere on page)');
})();
