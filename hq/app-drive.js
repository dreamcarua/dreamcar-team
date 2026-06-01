/* ============================================================
   DreamCar HQ — R2 direct upload (>49MB) + Supabase Storage (≤49MB)
   ============================================================
   Логіка:
   - Файли ≤ 49MB        → стандартний Supabase Storage upload (legacy)
   - Файли > 49MB         → R2 path:
       1. POST /functions/v1/r2-sign-upload → отримуємо presigned PUT URL
       2. Direct PUT файлу в R2 (XHR з прогресом)
       3. INSERT creative з R2 publicUrl
   Бо Supabase Free має 50MB platform cap. R2 — необмежений.
   tg-autopost-worker.sh без змін: завантажує з будь-якого URL.
   ============================================================ */

(function () {
  if (window.__hqDriveLoaded) return;
  window.__hqDriveLoaded = true;

  // Поріг — файли більші за нього йдуть через R2.
  // Залишаємо 49MB запас перед Supabase Free 50MB cap.
  var R2_THRESHOLD_BYTES = 49 * 1024 * 1024;

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

  // ============================================================
  // FIX: createCreativeRecord — id має бути UUID
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
  // R2 Direct Upload (browser → presigned URL → R2)
  // ============================================================
  async function uploadViaR2(file, pub) {
    if (!window.HQ_BACKEND || !window.supabase) {
      if (typeof toast === 'function') toast('Upload потребує авторизації', 'error');
      throw new Error('Not authenticated');
    }
    var jwt = await getAccessJwt();
    if (!jwt) throw new Error('No auth session');

    var anonKey = (window.HQ_CONFIG && window.HQ_CONFIG.SUPABASE_ANON_KEY) || '';
    var supaUrl = (window.HQ_CONFIG && window.HQ_CONFIG.SUPABASE_URL) || '';
    var signUrl = supaUrl.replace(/\/$/, '') + '/functions/v1/r2-sign-upload';

    var ext = fileExt(file.name);
    var type = detectType(file.type, ext);

    var prog = makeProgressToast(file.name + ' (' + humanSize(file.size) + ')');

    try {
      prog.update(1, 'Створюю Cloudflare R2 сесію…');

      // Step 1: ask edge function for presigned PUT URL
      var signResp = await fetch(signUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + jwt,
          'apikey': anonKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
          type: type,
        }),
      });
      if (!signResp.ok) {
        var errText = await signResp.text();
        throw new Error('sign fail ' + signResp.status + ': ' + errText);
      }
      var signData = await signResp.json();
      var uploadUrl = signData.uploadUrl;
      var publicUrl = signData.publicUrl;
      if (!uploadUrl || !publicUrl) throw new Error('sign returned no urls');

      // Step 2: PUT file directly to R2 with progress
      prog.update(2, 'Завантажую в Cloudflare R2…');
      await new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        // Don't set Content-Type header - presigned URL doesn't include it in canonical (we used UNSIGNED-PAYLOAD)
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            var pct = 2 + (e.loaded / e.total) * 93;
            prog.update(pct, 'Завантажую ' + humanSize(e.loaded) + ' / ' + humanSize(e.total));
          }
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error('R2 PUT failed ' + xhr.status + ': ' + xhr.responseText.slice(0, 200)));
        };
        xhr.onerror = function () { reject(new Error('R2 PUT network error')); };
        xhr.ontimeout = function () { reject(new Error('R2 PUT timeout')); };
        xhr.send(file);
      });

      // Step 3: register creative in DB
      prog.update(96, 'Реєструю файл…');
      var meta = {
        name: file.name,
        type: type,
        size_bytes: file.size,
        url: publicUrl,
        storage_path: 'r2:' + (signData.bucket || 'dreamcar-creatives') + '/' + signData.objectKey,
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

      prog.update(100, '✓ R2 · ' + humanSize(file.size));
      prog.close(true, file.name + ' · ' + humanSize(file.size) + ' (R2)');
      return local;
    } catch (e) {
      console.error('uploadViaR2 failed', e);
      prog.close(false, 'Помилка: ' + (e.message || e));
      throw e;
    }
  }

  // ---- Patch window.uploadCreativeFile ----
  function patchUpload() {
    if (typeof window.uploadCreativeFile !== 'function' || window.uploadCreativeFile.__r2Patched) return;
    var _orig = window.uploadCreativeFile;
    window.uploadCreativeFile = async function (file, pub) {
      if (!file) return;
      if (file.size > R2_THRESHOLD_BYTES && window.HQ_BACKEND) {
        try {
          return await uploadViaR2(file, pub);
        } catch (e) {
          console.error('R2 path failed:', e);
          if (typeof toast === 'function') toast('R2 не вдалося. Спробуй меньший файл або повтори.', 'error');
          throw e;
        }
      }
      return _orig.call(this, file, pub);
    };
    window.uploadCreativeFile.__r2Patched = true;
  }
  patchUpload();
  setTimeout(patchUpload, 300);
  setTimeout(patchUpload, 1500);

  window.HQ_DRIVE = {
    uploadViaR2: uploadViaR2,
    threshold: R2_THRESHOLD_BYTES,
  };
  console.log('%cDreamCar HQ Upload %c· R2 direct for >49MB · Supabase Storage for ≤49MB · UUID creative-id fix active', 'color:#f6821f;font-weight:700;', 'color:#888;');

  // ============================================================
  // LOADER CHAIN — підвантажуємо app-context-menu.js
  // ============================================================
  if (!document.querySelector('script[src*="app-context-menu.js"]')) {
    var sCtx = document.createElement('script');
    sCtx.src = 'app-context-menu.js?v=' + Date.now();
    sCtx.defer = true;
    document.head.appendChild(sCtx);
  }
})();
