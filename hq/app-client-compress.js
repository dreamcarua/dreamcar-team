/* ============================================================
   DreamCar HQ — Client-side Compression
   ============================================================
   Стискає файли у БРАУЗЕРІ перед upload. Замість GH Actions worker.
   FREE, миттєво, без черг, без апт-гет, без HEIC проблем.

   PHOTO:
   - HEIC/HEIF → heic2any (CDN) → JPEG q95
   - JPEG/PNG/WebP → browser-image-compression (max 2000px, q90)
   - GIF — пропускаємо (animated не зачіпаємо)

   VIDEO:
   - ffmpeg.wasm 0.12 (lazy load on first video upload)
   - CRF 26, max 1920px longest side, AAC 128k stereo
   - Якщо browser не підтримує SharedArrayBuffer — fallback на original

   POST-UPLOAD:
   - app-drive.js v2 (refactor R2 → Supabase Storage) уже ставить
     compressed_url + status='ready' у INSERT. Тут більше нічого додавати.
   ============================================================ */
(function(){
  if (window.__hqClientCompressLoaded) return;
  window.__hqClientCompressLoaded = true;

  var CDN_BIC = 'https://cdn.jsdelivr.net/npm/browser-image-compression@2.0.2/dist/browser-image-compression.js';
  var CDN_HEIC2ANY = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
  // ffmpeg.wasm 0.12 — окремий module loader
  var CDN_FFMPEG_CORE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js';
  var CDN_FFMPEG_UMD = 'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js';
  var CDN_FFMPEG_UTIL = 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js';

  var PHOTO_MAX_MB = 9.5; // TG sendPhoto ≤10MB
  var PHOTO_MAX_SIDE = 2000; // Vadym 30.07.2026: ліміт 2000px по більшій стороні (було 2560)
  var VIDEO_MAX_MB = 49; // TG sendVideo ≤50MB
  var VIDEO_MAX_SIDE = 1920;

  // ---------------------- helpers ----------------------
  function humanSize(b){
    if (b < 1024) return b + ' B';
    if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
    if (b < 1024*1024*1024) return (b/1024/1024).toFixed(1) + ' MB';
    return (b/1024/1024/1024).toFixed(2) + ' GB';
  }
  function fileExt(name){
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function isHeic(file){
    var t = (file.type || '').toLowerCase();
    if (t === 'image/heic' || t === 'image/heif') return true;
    var ext = fileExt(file.name);
    return ext === 'heic' || ext === 'heif';
  }
  function isPhoto(file){
    if (/^image\//i.test(file.type)) return true;
    if (/^(jpg|jpeg|png|gif|webp|heic|heif|bmp)$/i.test(fileExt(file.name))) return true;
    return false;
  }
  function isVideo(file){
    if (/^video\//i.test(file.type)) return true;
    if (/^(mp4|mov|webm|m4v|mkv|avi)$/i.test(fileExt(file.name))) return true;
    return false;
  }
  function isGif(file){
    return (file.type || '').toLowerCase() === 'image/gif' || fileExt(file.name) === 'gif';
  }

  function loadScript(src){
    return new Promise(function(resolve, reject){
      var existing = document.querySelector('script[data-cc-src="' + src + '"]');
      if (existing) {
        if (existing.dataset.ccLoaded === '1') return resolve();
        existing.addEventListener('load', function(){ resolve(); });
        existing.addEventListener('error', function(){ reject(new Error('script load failed: ' + src)); });
        return;
      }
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.dataset.ccSrc = src;
      s.onload = function(){ s.dataset.ccLoaded = '1'; resolve(); };
      s.onerror = function(){ reject(new Error('script load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function makeToast(initMsg){
    var stack = document.getElementById('toastStack');
    if (!stack) return { update: function(){}, close: function(){} };
    var el = document.createElement('div');
    el.className = 'toast info';
    el.innerHTML = '<b>Стискаю…</b><div class="toast-body">' + initMsg + '</div>' +
      '<div style="margin-top:6px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">' +
        '<div class="cc-prog-bar" style="height:100%;width:0%;background:var(--blue-soft,#7ab0ff);transition:width 0.3s;"></div>' +
      '</div>';
    stack.appendChild(el);
    return {
      update: function(pct, body){
        var bar = el.querySelector('.cc-prog-bar');
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
        if (body){
          var bd = el.querySelector('.toast-body');
          if (bd) bd.textContent = body;
        }
      },
      close: function(success, finalBody){
        el.classList.remove('info');
        el.classList.add(success ? 'success' : 'warn');
        var bd = el.querySelector('.toast-body');
        if (bd && finalBody) bd.textContent = finalBody;
        setTimeout(function(){ el.style.opacity = '0'; el.style.transition = 'all 0.3s'; }, 4000);
        setTimeout(function(){ el.remove(); }, 4400);
      }
    };
  }

  // ---------------------- PHOTO compress ----------------------
  var bicReady = null;
  function ensureBic(){
    if (bicReady) return bicReady;
    bicReady = loadScript(CDN_BIC).then(function(){
      var fn = window.imageCompression;
      if (typeof fn !== 'function' && fn && typeof fn.default === 'function') fn = fn.default;
      if (typeof fn !== 'function') throw new Error('browser-image-compression not exposed');
      return fn;
    });
    return bicReady;
  }
  var heicReady = null;
  function ensureHeic(){
    if (heicReady) return heicReady;
    heicReady = loadScript(CDN_HEIC2ANY).then(function(){
      var fn = window.heic2any;
      if (typeof fn !== 'function') throw new Error('heic2any not exposed');
      return fn;
    });
    return heicReady;
  }

  async function compressPhoto(file, toast){
    if (isGif(file)) return file;
    var input = file;
    if (isHeic(file)) {
      toast.update(10, 'Конвертую HEIC → JPEG…');
      var heic = await ensureHeic();
      try {
        var blob = await heic({ blob: file, toType: 'image/jpeg', quality: 0.95 });
        if (Array.isArray(blob)) blob = blob[0];
        var newName = file.name.replace(/\.(heic|heif)$/i, '.jpg');
        input = new File([blob], newName, { type: 'image/jpeg' });
        toast.update(30, 'HEIC конвертовано: ' + humanSize(input.size));
      } catch(e){
        console.warn('[CC] heic2any failed, leaving as-is:', e);
        return file;
      }
    }
    toast.update(40, 'Стискаю фото…');
    var bic = await ensureBic();
    var opts = {
      maxSizeMB: PHOTO_MAX_MB,
      maxWidthOrHeight: PHOTO_MAX_SIDE,
      useWebWorker: true,
      initialQuality: 0.9,
      fileType: 'image/jpeg',
      onProgress: function(pct){
        toast.update(40 + (pct * 0.5), 'Стискаю фото… ' + Math.round(pct) + '%');
      }
    };
    try {
      var compressed = await bic(input, opts);
      if (!(compressed instanceof File)) {
        compressed = new File([compressed], input.name, { type: compressed.type || 'image/jpeg' });
      }
      toast.update(95, 'Готово: ' + humanSize(file.size) + ' → ' + humanSize(compressed.size));
      if (compressed.size >= input.size && !isHeic(file)) return input;
      return compressed;
    } catch(e){
      console.warn('[CC] photo compression failed:', e);
      return input;
    }
  }

  // ---------------------- VIDEO compress ----------------------
  var ffmpegReady = null;
  function ensureFfmpeg(){
    if (ffmpegReady) return ffmpegReady;
    // Single-threaded ffmpeg працює БЕЗ SharedArrayBuffer (повільніше, але всюди).
    // Якщо SharedArrayBuffer є — буде multi-threaded auto.
    if (typeof SharedArrayBuffer === 'undefined') {
      console.warn('[CC] SharedArrayBuffer недоступний — використовую single-threaded ffmpeg (повільніше)');
    }
    ffmpegReady = Promise.all([
      loadScript(CDN_FFMPEG_UMD),
      loadScript(CDN_FFMPEG_UTIL),
    ]).then(async function(){
      var FFmpegCtor = window.FFmpegWASM && window.FFmpegWASM.FFmpeg;
      if (!FFmpegCtor) throw new Error('FFmpegWASM.FFmpeg not found');
      var util = window.FFmpegUtil || {};
      var ffmpeg = new FFmpegCtor();
      await ffmpeg.load({ coreURL: CDN_FFMPEG_CORE });
      return { ffmpeg: ffmpeg, util: util };
    }).catch(function(e){
      console.warn('[CC] ffmpeg.wasm load failed:', e);
      ffmpegReady = null;
      throw e;
    });
    return ffmpegReady;
  }

  async function compressVideo(file, toast){
    var inst;
    try { inst = await ensureFfmpeg(); }
    catch(e){
      console.warn('[CC] video compression skipped, leaving as-is');
      return file;
    }
    var ffmpeg = inst.ffmpeg;
    var util = inst.util;
    var fetchFile = util.fetchFile || (window.FFmpegUtil && window.FFmpegUtil.fetchFile);
    if (!fetchFile) {
      console.warn('[CC] fetchFile util missing');
      return file;
    }
    var inputName = 'input.' + (fileExt(file.name) || 'mp4');
    var outputName = 'output.mp4';
    try {
      var _mb = Math.round(file.size / 1024 / 1024);
      // #SMM 02.07.2026: для великого відео читання у памʼять застрягає на 10% без прогресу
      // (fetchFile+writeFile не дають callback) → виглядало як заморозка. Явний текст.
      toast.update(8, _mb > 80 ? ('Читаю велике відео ' + _mb + ' МБ у памʼять… (може зайняти до хвилини)') : 'Завантажую в worker…');
      await ffmpeg.writeFile(inputName, await fetchFile(file));
      toast.update(12, 'Готую до кодування…');
      ffmpeg.on('progress', function(ev){
        var pct = 10 + (ev.progress * 80);
        toast.update(pct, 'Кодую відео: ' + Math.round(ev.progress * 100) + '%');
      });
      toast.update(15, 'Стискаю відео…');
      var args = [
        '-i', inputName,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
        '-vf', "scale='if(gt(iw,ih),min(" + VIDEO_MAX_SIDE + ",iw),-2)':'if(gt(ih,iw),min(" + VIDEO_MAX_SIDE + ",ih),-2)':flags=lanczos",
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        '-y', outputName,
      ];
      await ffmpeg.exec(args);
      var data = await ffmpeg.readFile(outputName);
      try { await ffmpeg.deleteFile(inputName); } catch(_){}
      try { await ffmpeg.deleteFile(outputName); } catch(_){}
      var blob = new Blob([data.buffer], { type: 'video/mp4' });
      var newName = file.name.replace(/\.[^.]+$/, '') + '.mp4';
      var out = new File([blob], newName, { type: 'video/mp4' });
      toast.update(95, humanSize(file.size) + ' → ' + humanSize(out.size));
      if (out.size >= file.size) return file;
      return out;
    } catch(e){
      console.warn('[CC] video compression failed:', e);
      return file;
    }
  }

  // ---------------------- main wrapper ----------------------
  async function compressFileIfPossible(file){
    if (!file || file.size === 0) return file;
    var toast = makeToast(file.name + ' · ' + humanSize(file.size));
    try {
      var out = file;
      if (isPhoto(file) && !isGif(file)) {
        out = await compressPhoto(file, toast);
      } else if (isVideo(file)) {
        // #SMM 02.07.2026: НЕ стискаємо відео у браузері. Серверний worker
        // (compress-creative-worker.sh, cron */3) робить це коректно — з setsar=1,
        // rotation-fix (#260) і HDR tone-mapping (#256). Браузерний ffmpeg.wasm filter був
        // примітивний (без setsar/rotation) → СПОТВОРЮВАВ aspect («сжате по вертикалі», 02.07).
        // Тому відео заливаємо як є → server worker стисне до CRF18 ≤50МБ правильно.
        toast.close(true, 'Відео стисне сервер (якісніше) — заливаю оригінал');
        return file;
      } else {
        toast.close(true, 'Не фото/відео — як є');
        return file;
      }
      var pct = Math.round((1 - out.size / file.size) * 100);
      toast.close(true, 'Стиснуто ' + (pct > 0 ? '−' + pct + '%' : '0%') + ' · ' + humanSize(out.size));
      return out;
    } catch(e){
      console.error('[CC] compressFileIfPossible threw:', e);
      toast.close(false, 'Помилка стиснення — заливаю оригінал');
      return file;
    }
  }

  function patchUpload(){
    if (typeof window.uploadCreativeFile !== 'function') return false;
    if (window.uploadCreativeFile.__clientCompressPatched) return true;

    var _orig = window.uploadCreativeFile;
    window.uploadCreativeFile = async function(file, pub){
      if (!file) return;
      var compressed = await compressFileIfPossible(file);
      // Відео: compressed === оригінал (браузер його не чіпає) → серверний worker стисне ≤50МБ.
      // Фото: стиснуте BIC/heic2any. app-drive.js (Storage) виставить compressed_url/status.
      return await _orig.call(this, compressed, pub);
    };
    window.uploadCreativeFile.__clientCompressPatched = true;
    if (window.DEBUG) console.log('%cDreamCar HQ Client-Compress %c· photo (BIC + heic2any) + video (ffmpeg.wasm) · FREE, no server worker', 'color:#10b981;font-weight:700;', 'color:#888;');
    return true;
  }

  // Чекаємо коли app-drive.js перепатчить uploadCreativeFile (там Storage layer)
  // А потім ми поверх. Порядок: orig → drive-patch → client-compress-patch.
  if (!patchUpload()) {
    var retries = 0;
    var iv = setInterval(function(){
      retries++;
      if (patchUpload() || retries > 20) clearInterval(iv);
    }, 250);
  }

  // Експортуємо для batch tool
  window.HQ_CLIENT_COMPRESS = {
    compressPhoto: compressPhoto,
    compressVideo: compressVideo,
    compressFileIfPossible: compressFileIfPossible,
  };
})();
