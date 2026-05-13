/* ============================================================
   DreamCar HQ — Drive Resumable Upload (для файлів > 50 MB)
   Завантажується через loader chain (app-locks.js).
   ============================================================ */

(function () {
  if (window.__hqDriveLoaded) return;
  window.__hqDriveLoaded = true;

  var DRIVE_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB
  var CHUNK_SIZE = 8 * 1024 * 1024;             // 8 MB

  function fnUrl(name) {
    var base = (window.HQ_CONFIG && window.HQ_CONFIG.SUPABASE_URL) || '';
    return base.replace(/\/$/, '') + '/functions/v1/' + name;
  }

  async function getAccessJwt() {
    if (!window.supabase) return null;
    var { data } = await window.supabase.auth.getSession();
    return data && data.session && data.session.access_token || null;
  }

  function humanSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    if (b < 1024*1024*1024) return (b/1024/1024).toFixed(1) + ' MB';
    return (b/1024/1024/1024).toFixed(2) + ' GB';
  }

  // Прогрес-toast (живий, оновлюється)
  function makeProgressToast(initMsg) {
    var stack = document.getElementById('toastStack');
    if (!stack) return { update: function(){}, close: function(){} };
    var el = document.createElement('div');
    el.className = 'toast info';
    el.innerHTML = '<b>Завантажую…</b><div class="toast-body">' + initMsg + '</div>' +
      '<div style="margin-top:6px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">' +
        '<div class="hq-prog-bar" style="height:100%;width:0%;background:var(--blue-soft);transition:width 0.3s;"></div>' +
      '</div>';
    stack.appendChild(el);
    return {
      update: function (pct, body) {
        var bar = el.querySelector('.hq-prog-bar');
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (body) {
          var bd = el.querySelector('.toast-body');
          if (bd) bd.textContent = body;
        }
      },
      close: function (success, finalBody) {
        if (success) { el.classList.remove('info'); el.classList.add('success'); }
        else { el.classList.remove('info'); el.classList.add('error'); }
        var bd = el.querySelector('.toast-body');
        if (bd && finalBody) bd.textContent = finalBody;
        setTimeout(function () { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all 0.3s'; }, 2000);
        setTimeout(function () { el.remove(); }, 2400);
      }
    };
  }

  async function uploadViaDrive(file, pub) {
    if (!window.HQ_BACKEND || !window.supabase) {
      if (typeof toast === 'function') toast('Drive потребує авторизації', 'error');
      throw new Error('Not authenticated');
    }
    var jwt = await getAccessJwt();
    if (!jwt) throw new Error('No auth session');
    var anonKey = window.HQ_CONFIG && window.HQ_CONFIG.SUPABASE_ANON_KEY;

    var prog = makeProgressToast(file.name + ' (' + humanSize(file.size) + ')');

    try {
      // 1. Init resumable
      prog.update(1, 'Створюю Drive-сесію…');
      var initResp = await fetch(fnUrl('drive-init-upload'), {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + jwt,
          'apikey': anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream', size: file.size }),
      });
      if (!initResp.ok) throw new Error('init fail ' + initResp.status + ': ' + await initResp.text());
      var initData = await initResp.json();
      var uploadUrl = initData.uploadUrl;
      var chunkSize = initData.maxChunkSize || CHUNK_SIZE;

      // 2. Chunked upload
      var offset = 0;
      var driveFileId = null;
      while (offset < file.size) {
        var end = Math.min(offset + chunkSize, file.size);
        var chunk = file.slice(offset, end);
        var rangeHeader = 'bytes ' + offset + '-' + (end - 1) + '/' + file.size;
        prog.update((offset / file.size) * 95, 'Завантажую ' + humanSize(end) + ' / ' + humanSize(file.size));

        var putResp = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Range': rangeHeader },
          body: chunk,
        });
        if (putResp.status === 308) {
          // Resume — Range header у відповіді каже скільки прийняли
          var rangeRcv = putResp.headers.get('range') || '';
          var m = rangeRcv.match(/bytes=0-(\d+)/);
          offset = m ? parseInt(m[1], 10) + 1 : end;
          continue;
        }
        if (putResp.status === 200 || putResp.status === 201) {
          // Завершено — у тілі file metadata з id
          var meta = await putResp.json();
          driveFileId = meta.id;
          break;
        }
        // Будь-який інший — помилка
        var errText = await putResp.text();
        throw new Error('upload chunk fail ' + putResp.status + ': ' + errText);
      }
      if (!driveFileId) throw new Error('No file id from Drive after upload');

      // 3. Finalize: зробити публічним + запис у creatives
      prog.update(97, 'Реєструю файл…');
      var finResp = await fetch(fnUrl('drive-finalize-upload'), {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + jwt,
          'apikey': anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          driveFileId: driveFileId,
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
        }),
      });
      if (!finResp.ok) throw new Error('finalize fail ' + finResp.status + ': ' + await finResp.text());
      var finData = await finResp.json();
      var creative = finData.creative;

      // 4. Додати у локальний Store + у pub.creatives
      var previewMap = { photo: '🖼️', video: '🎬', doc: '📄', audio: '🎵' };
      var colorMap   = { photo: '#ff6577', video: '#7ab0ff', doc: '#888', audio: '#fbbf24' };
      var local = {
        id: creative.id,
        name: creative.name,
        type: creative.type,
        size: humanSize(creative.size_bytes || file.size),
        duration: null,
        res: '—',
        tags: [],
        uploadedBy: (typeof Store !== 'undefined' && Store.currentUser && Store.currentUser().id) || null,
        uploadedAt: new Date().toISOString(),
        preview: previewMap[creative.type] || '📦',
        color: colorMap[creative.type] || '#888',
        url: creative.url,
        thumbnail_url: creative.thumbnail_url,
      };
      if (typeof Store !== 'undefined' && Store._data && Array.isArray(Store._data.creatives)) {
        Store._data.creatives.unshift(local);
      }
      if (pub) {
        pub.creatives = [].concat(pub.creatives || [], [creative.id]);
        if (typeof refreshPreview === 'function') refreshPreview(pub);
        if (typeof autosave === 'function') autosave(pub);
      }
      // Re-render creative-strip
      try {
        var strip = document.getElementById('f_creatives');
        if (strip && typeof mediaThumb === 'function') {
          var addBtn = document.getElementById('addCreativeBtn');
          var item = document.createElement('div');
          item.className = 'cs-item';
          item.dataset.id = creative.id;
          item.title = creative.name;
          item.style.position = 'relative';
          item.style.overflow = 'hidden';
          item.innerHTML = mediaThumb(local, { size: 'tile' }) +
            '<div class="cs-remove" data-remove="' + creative.id + '">×</div>';
          item.querySelector('.cs-remove').onclick = function (e) {
            e.stopPropagation();
            if (pub) pub.creatives = (pub.creatives || []).filter(function (x) { return x !== creative.id; });
            item.remove();
            if (pub && typeof autosave === 'function') autosave(pub);
          };
          if (addBtn) strip.insertBefore(item, addBtn);
          else strip.appendChild(item);
        }
      } catch (_) {}

      prog.update(100, '✓ Drive · ' + humanSize(file.size));
      prog.close(true, file.name + ' · ' + humanSize(file.size) + ' через Drive');
      return local;
    } catch (e) {
      console.error('uploadViaDrive failed', e);
      prog.close(false, 'Помилка: ' + (e.message || e));
      throw e;
    }
  }

  // ---- Patch window.uploadCreativeFile ----
  function patchUpload() {
    if (typeof window.uploadCreativeFile !== 'function' || window.uploadCreativeFile.__drivePatched) return;
    var _orig = window.uploadCreativeFile;
    window.uploadCreativeFile = async function (file, pub) {
      if (!file) return;
      // Якщо файл >50MB і ми у backend-режимі — через Drive
      if (file.size > DRIVE_THRESHOLD_BYTES && window.HQ_BACKEND) {
        try {
          return await uploadViaDrive(file, pub);
        } catch (e) {
          // Fallback на оригінал тільки якщо файл уміщається у Supabase Storage limit
          if (file.size <= 100 * 1024 * 1024) {
            if (typeof toast === 'function') toast('Drive впав, пробую Storage…', 'warn');
            return _orig.call(this, file, pub);
          }
          throw e;
        }
      }
      // Інакше — стандартний flow
      return _orig.call(this, file, pub);
    };
    window.uploadCreativeFile.__drivePatched = true;
  }
  patchUpload();
  setTimeout(patchUpload, 300);
  setTimeout(patchUpload, 1500);

  window.HQ_DRIVE = {
    uploadViaDrive: uploadViaDrive,
    threshold: DRIVE_THRESHOLD_BYTES,
    chunkSize: CHUNK_SIZE,
  };
  console.log('%cDreamCar HQ Drive %c· upload >50MB через Google Drive active', 'color:#4285F4;font-weight:700;', 'color:#888;');
})();
