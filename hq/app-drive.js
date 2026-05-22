/* ============================================================
   DreamCar HQ — TUS Resumable Upload через Supabase Storage
   ============================================================
   Замість Google Drive Edge Functions (не задеплоєні) використовуємо
   нативний TUS protocol Supabase Storage: /storage/v1/upload/resumable.
   - ≤6MB → звичайний Storage upload (швидко)
   - >6MB → TUS chunked (обходить 50MB platform cap, до 5GB)
   ============================================================ */

(function () {
  if (window.__hqDriveLoaded) return;
  window.__hqDriveLoaded = true;

  var BUCKET = 'creatives';
  var CHUNK_SIZE = 6 * 1024 * 1024;        // 6MB — Supabase TUS recommendation
  var TUS_THRESHOLD = 6 * 1024 * 1024;     // >6MB → TUS resumable
  var TUS_CLIENT_URL = 'https://cdn.jsdelivr.net/npm/tus-js-client@4.1.0/dist/tus.min.js';

  // ---- Load tus-js-client lazily ----
  var tusPromise = null;
  function loadTus() {
    if (window.tus) return Promise.resolve(window.tus);
    if (tusPromise) return tusPromise;
    tusPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = TUS_CLIENT_URL;
      s.onload = function () { resolve(window.tus); };
      s.onerror = function () { reject(new Error('Failed to load tus-js-client')); };
      document.head.appendChild(s);
    });
    return tusPromise;
  }

  // ---- Helpers ----
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
  function publicUrl(bucket, path) {
    var base = (window.HQ_CONFIG && window.HQ_CONFIG.SUPABASE_URL) || '';
    return base.replace(/\/$/, '') + '/storage/v1/object/public/' + bucket + '/' + path;
  }

  // ============================================================
  // FIX: createCreativeRecord — id має бути UUID, а не "cr_xxx"
  // ============================================================
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

  // ============================================================
  // Прогрес-toast
  // ============================================================
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

  // ============================================================
  // TUS Resumable Upload через Supabase Storage
  // ============================================================
  async function uploadViaTus(file, pub) {
    if (!window.HQ_BACKEND || !window.supabase) {
      if (typeof toast === 'function') toast('Upload потребує авторизації', 'error');
      throw new Error('Not authenticated');
    }
    var jwt = await getAccessJwt();
    if (!jwt) throw new Error('No auth session');

    var anonKey = (window.HQ_CONFIG && window.HQ_CONFIG.SUPABASE_ANON_KEY) || '';
    var supaUrl = (window.HQ_CONFIG && window.HQ_CONFIG.SUPABASE_URL) || '';
    var tusEndpoint = supaUrl.replace(/\/$/, '') + '/storage/v1/upload/resumable';

    var ext = fileExt(file.name);
    var type = detectType(file.type, ext);
    var objectName = type + '/' + Date.now() + '_' + getUuid() + '.' + ext;

    var prog = makeProgressToast(file.name + ' (' + humanSize(file.size) + ')');

    var tus = await loadTus();

    return new Promise(function (resolve, reject) {
      var upload = new tus.Upload(file, {
        endpoint: tusEndpoint,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        chunkSize: CHUNK_SIZE,
        headers: {
          authorization: 'Bearer ' + jwt,
          'x-upsert': 'true',
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: BUCKET,
          objectName: objectName,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600',
        },
        onError: function (err) {
          console.error('TUS upload error:', err);
          var msg = err && err.message || String(err);
          prog.close(false, 'Помилка: ' + msg);
          reject(err);
        },
        onProgress: function (sent, total) {
          var pct = (sent / total) * 95;
          prog.update(pct, 'Завантажую ' + humanSize(sent) + ' / ' + humanSize(total));
        },
        onSuccess: async function () {
          try {
            prog.update(97, 'Реєструю файл…');
            var url = publicUrl(BUCKET, objectName);
            var meta = {
              name: file.name,
              type: type,
              size_bytes: file.size,
              url: url,
              storage_path: BUCKET + '/' + objectName,
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

            prog.update(100, '✓ ' + humanSize(file.size));
            prog.close(true, file.name + ' · ' + humanSize(file.size));
            resolve(local);
          } catch (e) {
            console.error('TUS post-success failed', e);
            prog.close(false, 'Помилка реєстрації: ' + (e.message || e));
            reject(e);
          }
        },
      });

      // Resume previous interrupted upload if any
      upload.findPreviousUploads().then(function (previous) {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }).catch(function (e) {
        console.warn('TUS findPreviousUploads error, starting fresh:', e);
        upload.start();
      });
    });
  }

  // ---- Patch window.uploadCreativeFile ----
  function patchUpload() {
    if (typeof window.uploadCreativeFile !== 'function' || window.uploadCreativeFile.__tusPatched) return;
    var _orig = window.uploadCreativeFile;
    window.uploadCreativeFile = async function (file, pub) {
      if (!file) return;
      if (file.size > TUS_THRESHOLD && window.HQ_BACKEND) {
        try {
          return await uploadViaTus(file, pub);
        } catch (e) {
          console.error('TUS failed, falling back to original:', e);
          if (typeof toast === 'function') toast('TUS впав, пробую звичайний upload…', 'warn');
          return _orig.call(this, file, pub);
        }
      }
      return _orig.call(this, file, pub);
    };
    window.uploadCreativeFile.__tusPatched = true;
  }
  patchUpload();
  setTimeout(patchUpload, 300);
  setTimeout(patchUpload, 1500);

  window.HQ_DRIVE = {
    uploadViaTus: uploadViaTus,
    threshold: TUS_THRESHOLD,
    chunkSize: CHUNK_SIZE,
  };
  console.log('%cDreamCar HQ Upload %c· TUS resumable >6MB · bucket=creatives 300MB · UUID creative-id fix active', 'color:#10b981;font-weight:700;', 'color:#888;');

  // ============================================================
  // LOADER CHAIN — підвантажуємо app-context-menu.js
  // ============================================================
  if (!document.querySelector('script[src*="app-context-menu.js"]')) {
    var sCtx = document.createElement('script');
    sCtx.src = 'app-context-menu.js?v=' + Date.now();
    sCtx.defer = true;
    document.head.appendChild(sCtx);
  }

  // Preload tus-js-client (so the first big upload doesn't pay the script load latency)
  loadTus().catch(function (e) { console.warn('Preload tus failed:', e); });
})();
