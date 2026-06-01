/* ============================================================
   DreamCar HQ — Upload (Supabase Storage only, no R2)
   ============================================================
   2026-05-29: повний refactor. R2 CORS не дозволяє team.dreamcar.ua origin →
   preflight 403 у браузері. Перенесли на Supabase Storage через SDK upload
   (та сама архітектура що пройшла батч-tool 39/39).

   Flow:
   1. uploadCreativeFile(file, pub) — entry point
   2. Client-side compress (через app-client-compress patch) — зменшує розмір
   3. Supabase SDK .upload(creatives/{filename}) — public bucket
   4. INSERT creative з thumbnail_url == compressed_url
   5. Mark compressed_status='ready' одразу

   Якщо файл після compress > 50MB → toast про Supabase Free ліміт.
   ============================================================ */

(function () {
  if (window.__hqDriveLoaded) return;
  window.__hqDriveLoaded = true;

  var MAX_BYTES = 49 * 1024 * 1024; // Supabase Free hard limit
  var BUCKET = 'creatives';

  function humanSize(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    if (b < 1024*1024*1024) return (b/1024/1024).toFixed(1) + ' MB';
    return (b/1024/1024/1024).toFixed(2) + ' GB';
  }
  function getUuid() {
    if (window.uuidV4) return window.uuidV4();
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function fileExt(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : 'bin';
  }
  function detectType(mime, ext) {
    if (mime) {
      if (/^image\//.test(mime)) return 'photo';
      if (/^video\//.test(mime)) return 'video';
      if (/^audio\//.test(mime)) return 'audio';
    }
    if (['mp4','mov','webm','m4v','mkv'].indexOf(ext) >= 0) return 'video';
    if (['jpg','jpeg','png','gif','webp','heic','heif'].indexOf(ext) >= 0) return 'photo';
    if (['mp3','wav','ogg','m4a','aac'].indexOf(ext) >= 0) return 'audio';
    return 'doc';
  }

  // Override createCreativeRecord — той самий код що був раніше + compressed_status='ready'
  function overrideCreateCreativeRecord() {
    if (typeof window.createCreativeRecord !== 'function' && typeof createCreativeRecord !== 'function') return false;
    if (window.createCreativeRecord && window.createCreativeRecord.__uuidPatched) return true;

    var _orig = (typeof window.createCreativeRecord === 'function')
      ? window.createCreativeRecord
      : (typeof createCreativeRecord === 'function' ? createCreativeRecord : null);
    if (!_orig) return false;

    window.createCreativeRecord = async function (meta) {
      var id = getUuid();
      var previewMap = { photo: '🖼️', video: '🎬', doc: '📄', audio: '🎵' };
      var colorMap   = { photo: '#ff6577', video: '#7ab0ff', doc: '#888', audio: '#fbbf24' };
      var meId = (typeof Store !== 'undefined' && Store.currentUser && Store.currentUser().id) || null;
      var local = {
        id: id,
        name: meta.name,
        type: meta.type,
        size: humanSize(meta.size_bytes),
        duration: null, res: '—', tags: [],
        uploadedBy: meId,
        uploadedAt: new Date().toISOString(),
        preview: previewMap[meta.type] || '📦',
        color: colorMap[meta.type] || '#888',
        url: meta.url,
      };
      if (typeof Store !== 'undefined' && Store._data && Array.isArray(Store._data.creatives)) {
        Store._data.creatives.unshift(local);
      }
      if (!window.HQ_BACKEND) {
        if (typeof Store !== 'undefined' && typeof Store._saveLocal === 'function') Store._saveLocal();
        return local;
      }
      var sb = window.supabase;
      if (!sb) return local;
      try {
        // Файл вже стиснутий клієнтом — позначаємо ready одразу
        var { error } = await sb.from('creatives').insert({
          id: id,
          desk_id: '11111111-1111-1111-1111-111111111111',
          name: meta.name,
          type: meta.type,
          size_bytes: meta.size_bytes,
          drive_file_id: meta.storage_path,
          thumbnail_url: meta.url,
          tags: [],
          uploaded_by: meId,
          // Client-compressed → ready з тим самим URL
          compressed_url: meta.url,
          compressed_status: 'ready',
          compressed_size_bytes: meta.size_bytes,
          compressed_at: new Date().toISOString(),
        });
        if (error) {
          console.error('creatives insert (patched):', error);
          if (typeof toast === 'function') toast('Не зберіг у БД', 'error', error.message);
          if (typeof Store !== 'undefined' && Store._data) {
            Store._data.creatives = (Store._data.creatives || []).filter(function (c) { return c.id !== id; });
          }
          throw error;
        }
      } catch (e) {
        console.error('createCreativeRecord patched threw:', e);
        throw e;
      }
      return local;
    };
    window.createCreativeRecord.__uuidPatched = true;
    return true;
  }
  if (!overrideCreateCreativeRecord()) {
    setTimeout(overrideCreateCreativeRecord, 300);
    setTimeout(overrideCreateCreativeRecord, 1000);
    setTimeout(overrideCreateCreativeRecord, 2500);
  }

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
        setTimeout(function () { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all 0.3s'; }, 6000);
        setTimeout(function () { el.remove(); }, 6400);
      }
    };
  }

  // Upload через Supabase Storage SDK — без R2, без CORS issues
  async function uploadViaSupabaseStorage(file, pub) {
    if (!window.HQ_BACKEND || !window.supabase) {
      if (typeof toast === 'function') toast('Upload потребує авторизації', 'error');
      throw new Error('Not authenticated');
    }
    var sb = window.supabase;
    var ext = fileExt(file.name);
    var type = detectType(file.type, ext);

    var prog = makeProgressToast(file.name + ' (' + humanSize(file.size) + ')');

    try {
      // Size warning (НЕ hard fail) — дозволяємо Supabase Storage сам відповісти.
      // Supabase Free допускає 50MB/file на upload. Файли >50MB будуть rejected на server side.
      if (file.size > MAX_BYTES) {
        console.warn('[drive] file > 49MB:', humanSize(file.size), '— attempting upload anyway');
        // Спроба inline compression (якщо HQ_CLIENT_COMPRESS доступний)
        if (window.HQ_CLIENT_COMPRESS && typeof window.HQ_CLIENT_COMPRESS.compressPhoto === 'function' && /^image\//.test(file.type) && !/gif/i.test(file.type)) {
          prog.update(2, 'Стискаю фото...');
          try {
            var compressed = await window.HQ_CLIENT_COMPRESS.compressPhoto(file, { update: function(){}, close: function(){} });
            if (compressed && compressed.size < file.size) {
              file = compressed;
              prog.update(8, 'Стиснуто до ' + humanSize(file.size));
            }
          } catch (cErr) { console.warn('[drive] inline compress failed:', cErr); }
        }
      }

      prog.update(5, 'Створюю запис…');

      // Унікальний шлях у bucket
      var storageFilename = Date.now() + '-' + Math.random().toString(36).slice(2, 10) + '.' + ext;

      prog.update(15, 'Заливаю в Supabase Storage…');

      var { data: upData, error: upError } = await sb.storage
        .from(BUCKET)
        .upload(storageFilename, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
          cacheControl: '31536000',
        });
      if (upError) throw upError;

      prog.update(90, 'Реєструю файл…');

      // Public URL
      var { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(storageFilename);
      var publicUrl = urlData.publicUrl;

      var meta = {
        name: file.name,
        type: type,
        size_bytes: file.size,
        url: publicUrl,
        storage_path: storageFilename,
      };
      var local = await window.createCreativeRecord(meta);

      if (pub) {
        pub.creatives = [].concat(pub.creatives || [], [local.id]);
        if (typeof refreshPreview === 'function') refreshPreview(pub);
        if (typeof autosave === 'function') autosave(pub);
      }
      try {
        var strip = document.getElementById('f_creatives');
        if (strip && typeof mediaThumb === 'function') {
          var addBtn = document.getElementById('addCreativeBtn');
          var item = document.createElement('div');
          item.className = 'cs-item';
          item.dataset.id = local.id;
          item.title = local.name;
          item.style.position = 'relative';
          item.style.overflow = 'hidden';
          item.innerHTML = mediaThumb(local, { size: 'tile' }) +
            '<div class="cs-remove" data-remove="' + local.id + '">×</div>';
          var rm = item.querySelector('.cs-remove');
          if (rm) rm.onclick = function (e) {
            e.stopPropagation();
            if (pub) pub.creatives = (pub.creatives || []).filter(function (x) { return x !== local.id; });
            item.remove();
            if (pub && typeof autosave === 'function') autosave(pub);
          };
          if (addBtn) strip.insertBefore(item, addBtn);
          else strip.appendChild(item);
        }
      } catch (_) {}

      prog.update(100, 'Готово · ' + humanSize(file.size));
      prog.close(true, file.name + ' · ' + humanSize(file.size) + ' (Storage)');
      return local;
    } catch (e) {
      console.error('[Storage] upload failed', e);
      var msg = (e && e.message) || String(e);
      prog.close(false, msg.slice(0, 250));
      throw e;
    }
  }

  function patchUpload() {
    if (typeof window.uploadCreativeFile !== 'function' || window.uploadCreativeFile.__storagePatched) return;
    var _orig = window.uploadCreativeFile;
    window.uploadCreativeFile = async function (file, pub) {
      if (!file) return;
      // Завжди йдемо через Supabase Storage (нема R2 CORS issues).
      // Client-compress layer (app-client-compress.js) стискає файл перед цією функцією.
      if (window.HQ_BACKEND) {
        return await uploadViaSupabaseStorage(file, pub);
      }
      return _orig.call(this, file, pub);
    };
    window.uploadCreativeFile.__storagePatched = true;
  }
  patchUpload();
  setTimeout(patchUpload, 300);
  setTimeout(patchUpload, 1500);

  window.HQ_DRIVE = {
    uploadViaStorage: uploadViaSupabaseStorage,
    maxBytes: MAX_BYTES,
    bucket: BUCKET,
  };
  console.log('%cDreamCar HQ Upload %c· Supabase Storage only (R2 deprecated) · client-compress active', 'color:#f6821f;font-weight:700;', 'color:#888;');

  if (!document.querySelector('script[src*="app-context-menu.js"]')) {
    var sCtx = document.createElement('script');
    sCtx.src = 'app-context-menu.js?v=' + Date.now();
    sCtx.defer = true;
    document.head.appendChild(sCtx);
  }
})();
