/* ============================================================
   DreamCar HQ — Per-Platform PIXEL-PERFECT Preview (#328)
   ============================================================
   Замінює дефолтний рендер з app-preview-tabs.js на повноцінний
   UI кожної платформи: TG channel / IG feed / TikTok / Threads / YT Shorts / FB.

   Brand: avatar = brand.dreamcar.ua/assets/logo/dreamcar-avatar-circle.svg
   Account name: "DreamCar.ua"
   Tagline: "мрія за ціною чашки кави"

   Підключається після app-preview-tabs.js — перевизначає
   window.__hqRenderPlatform та триггерить rerender.
   ============================================================ */
(function () {
  if (window.__hqPlatformPreviewV2) return;
  window.__hqPlatformPreviewV2 = true;

  var BRAND = {
    avatar: 'https://brand.dreamcar.ua/assets/logo/dreamcar-avatar-circle.svg',
    name: 'DreamCar.ua',
    bio: 'мрія за ціною чашки кави ☕',
    site: 'dreamcar.ua',
    handles: {
      ig: 'dreamcar.ua',
      tg: 'DreamCar.ua',
      tt: 'dreamcar.ua',
      fb: 'DreamCar.ua',
      yt: '@dreamcar',
      th: 'dreamcar.ua'
    }
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  // TG-style HTML парсер (b/i/u/s/code/pre/spoiler/blockquote/a)
  function tgFmt(raw) {
    if (!raw) return '';
    var s = esc(raw);
    ['b','strong','i','em','u','s','strike','del','code','pre','tg-spoiler','blockquote','br'].forEach(function(t){
      s = s.replace(new RegExp('&lt;' + t + '&gt;', 'gi'), '<' + t + '>')
           .replace(new RegExp('&lt;\\/' + t + '&gt;', 'gi'), '</' + t + '>');
    });
    s = s.replace(/&lt;a\s+href=&quot;([^&]+)&quot;&gt;([\s\S]*?)&lt;\/a&gt;/gi, function(_, url, txt){
      return '<a href="' + url.replace(/"/g,'&quot;') + '" target="_blank" rel="noopener">' + txt + '</a>';
    });
    s = s.replace(/&lt;&lt;&lt;([\s\S]+?)&gt;&gt;&gt;/g, '<tg-spoiler>$1</tg-spoiler>');
    return s;
  }
  // Простий лінефід → <br/>
  function nl2br(s) { return String(s || '').replace(/\n/g, '<br/>'); }

  // Truncate без обрізки HTML тегів
  function truncatePlain(s, len) {
    var raw = String(s || '');
    if (raw.length <= len) return raw;
    return raw.slice(0, len).replace(/\s+\S*$/, '') + '…';
  }

  function timeAgo(iso) {
    if (!iso) return 'щойно';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'щойно';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'щойно';
    if (diff < 3600) return Math.floor(diff/60) + ' хв';
    if (diff < 86400) return Math.floor(diff/3600) + ' год';
    if (diff < 86400*7) return Math.floor(diff/86400) + ' дн';
    return d.toLocaleDateString('uk-UA');
  }
  function tgTime(iso) {
    var d = new Date(iso || Date.now());
    if (isNaN(d.getTime())) return new Date().toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'});
    return d.toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'});
  }

  // Чи рядок схожий на URL?
  function isUrl(s) {
    if (!s) return false;
    s = String(s);
    return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('blob:') || s.startsWith('data:');
  }
  // Збираємо media (фото/відео) у формат {kind, src, name, emoji, color}
  function collectMedia(p) {
    var ids = p.creatives || [];
    var out = [];
    ids.forEach(function(id){
      var c;
      try { c = Store.creative(id); } catch(_){}
      if (!c) return;
      var kind = c.type === 'video' ? 'video' : 'photo';
      // Шукаємо реальний URL — НЕ preview emoji
      var src = '';
      if (isUrl(c.thumbnail_url)) src = c.thumbnail_url;
      else if (isUrl(c.compressed_url)) src = c.compressed_url;
      else if (isUrl(c.compressed_url_hevc)) src = c.compressed_url_hevc;
      // Drive file id — будуємо URL якщо є
      else if (c.drive_file_id) src = 'https://drive.google.com/thumbnail?id=' + c.drive_file_id + '&sz=w800';
      // preview може бути URL АБО emoji — використовуємо тільки якщо URL
      else if (isUrl(c.preview)) src = c.preview;

      // Emoji-only preview (типу 🖼️ / 🎬) — fallback для placeholder
      var emoji = null;
      if (!src && c.preview && !isUrl(c.preview)) {
        emoji = c.preview;
      }
      if (!src && !emoji) {
        // Compress ще не закінчив? Показуємо kind-based icon
        emoji = kind === 'video' ? '🎬' : '🖼️';
      }
      out.push({
        kind: kind,
        src: src,
        name: c.name || '',
        emoji: emoji,
        color: c.color || (kind === 'video' ? '#7c3aed' : '#0ea5e9'),
        status: c.compressed_status || 'ready'
      });
    });
    return out;
  }
  // Рендер одного media тіла (img або video або emoji placeholder)
  function mediaTile(m, opts) {
    opts = opts || {};
    var aspect = opts.aspect || '1/1';
    var radius = opts.radius == null ? 0 : opts.radius;
    var bg = m.color || '#0e0e0e';
    // Має URL — показуємо реальну картинку/превʼю відео
    if (m.src) {
      if (m.kind === 'video') {
        return '<div class="dcpv-media-video" style="aspect-ratio:' + aspect + ';border-radius:' + radius + 'px;background:#000 url(' + JSON.stringify(m.src) + ') center/cover no-repeat;">' +
          '<div class="dcpv-play">▶</div></div>';
      }
      return '<div class="dcpv-media-img" style="aspect-ratio:' + aspect + ';border-radius:' + radius + 'px;background:#0e0e0e url(' + JSON.stringify(m.src) + ') center/cover no-repeat;"></div>';
    }
    // URL відсутній — показуємо placeholder з emoji + назвою файлу + статусом
    var statusText = m.status === 'pending' || m.status === 'processing'
      ? 'компресується…'
      : m.status === 'error' ? 'помилка компресії' : 'без прев\'ю';
    var name = m.name ? esc(m.name).slice(0, 40) : (m.kind === 'video' ? 'Відео' : 'Зображення');
    return '<div class="dcpv-media-empty" style="aspect-ratio:' + aspect + ';border-radius:' + radius + 'px;background:linear-gradient(135deg,' + bg + '55,#0a0a0a 70%);flex-direction:column;gap:8px;color:#fff;padding:16px;text-align:center;">' +
      '<div style="font-size:54px;line-height:1;">' + (m.emoji || '🖼️') + '</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,0.9);font-weight:600;word-break:break-word;">' + name + '</div>' +
      '<div style="font-size:10px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.1em;">' + statusText + '</div>' +
      '</div>';
  }


  /* ============ TELEGRAM channel post ============ */
  function renderTG(p) {
    var media = collectMedia(p);
    var buttons = Array.isArray(p.tg_buttons) ? p.tg_buttons : [];
    var caption = tgFmt(p.text || '').replace(/(#[\p{L}\p{N}_]+)/gu,'<span class="dcpv-tg-link">$1</span>');
    var hashLine = (p.hashtags || []).map(function(h){ return h.startsWith('#') ? h : '#' + h; }).join(' ');
    if (hashLine) caption += '<br/><span class="dcpv-tg-link">' + esc(hashLine) + '</span>';

    var mediaHtml = '';
    if (media.length === 1) {
      mediaHtml = '<div class="dcpv-tg-single">' + mediaTile(media[0], {aspect: media[0].kind === 'video' ? '9/16' : '4/5'}) + '</div>';
    } else if (media.length >= 2) {
      var rows = media.slice(0,10).map(function(m){ return '<div class="dcpv-tg-album-cell">' + mediaTile(m, {aspect:'1/1'}) + '</div>'; }).join('');
      var cls = media.length === 2 ? 'cols-2' : media.length === 3 ? 'cols-2' : media.length === 4 ? 'cols-2' : 'cols-3';
      mediaHtml = '<div class="dcpv-tg-album ' + cls + '">' + rows + '</div>';
    }

    var btnHtml = '';
    if (buttons.length) {
      btnHtml = '<div class="dcpv-tg-buttons">' +
        buttons.slice(0,8).map(function(b){
          var label = esc((b.text || 'Button').slice(0,64));
          return '<button class="dcpv-tg-btn">' + label + '</button>';
        }).join('') + '</div>';
    }

    return '<div class="dcpv dcpv-tg">' +
      '<div class="dcpv-tg-shell">' +
        '<div class="dcpv-tg-head">' +
          '<img src="' + BRAND.avatar + '" class="dcpv-tg-avatar"/>' +
          '<div class="dcpv-tg-name">' + esc(BRAND.name) + ' — ' + esc(BRAND.bio) + '</div>' +
          '<div class="dcpv-tg-menu">⋮</div>' +
        '</div>' +
        '<div class="dcpv-tg-body">' +
          '<div class="dcpv-tg-bubble">' +
            mediaHtml +
            (caption ? '<div class="dcpv-tg-caption">' + caption + '</div>' : '') +
            btnHtml +
            '<div class="dcpv-tg-footmeta">' +
              '<span class="views">👁 1.2K</span>' +
              '<span class="reacts">❤️ 24 🔥 8</span>' +
              '<span class="time">' + tgTime(p.dateTime) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ============ INSTAGRAM feed post ============ */
  function renderIG(p) {
    var media = collectMedia(p);
    var hashLine = (p.hashtags || []).map(function(h){ return h.startsWith('#') ? h : '#' + h; }).join(' ');
    var captionRaw = (p.text || '').trim();
    var captionFirstLine = captionRaw.split('\n')[0] || '';
    var truncated = truncatePlain(captionFirstLine, 95);
    var captionMore = captionFirstLine.length > 95 || captionRaw.includes('\n');
    var hashHtml = hashLine ? ' <span class="dcpv-ig-hash">' + esc(hashLine) + '</span>' : '';

    var mediaHtml = '';
    var isCarousel = media.length > 1;
    if (media.length === 0) {
      mediaHtml = mediaTile({kind:'photo', src:'', color:'#222'}, {aspect:'1/1'});
    } else {
      mediaHtml = mediaTile(media[0], {aspect:'1/1'});
    }

    return '<div class="dcpv dcpv-ig">' +
      '<div class="dcpv-ig-shell">' +
        '<div class="dcpv-ig-head">' +
          '<img src="' + BRAND.avatar + '" class="dcpv-ig-avatar"/>' +
          '<div class="dcpv-ig-username">' + esc(BRAND.handles.ig) + ' <span class="dcpv-ig-verified">✓</span></div>' +
          '<div class="dcpv-ig-menu">⋯</div>' +
        '</div>' +
        '<div class="dcpv-ig-media">' +
          mediaHtml +
          (isCarousel ? '<div class="dcpv-ig-carousel">1/' + media.length + '</div>' : '') +
        '</div>' +
        '<div class="dcpv-ig-actions">' +
          '<span class="ico">♡</span><span class="ico">💬</span><span class="ico">↗</span>' +
          '<span class="ico right">🔖</span>' +
        '</div>' +
        '<div class="dcpv-ig-likes">Подобається <b>artem_dreamcar</b> та <b>ще 1 247</b></div>' +
        '<div class="dcpv-ig-caption">' +
          '<b>' + esc(BRAND.handles.ig) + '</b> ' + esc(truncated) +
          (captionMore ? ' <span class="dcpv-ig-more">… ще</span>' : '') +
          hashHtml +
        '</div>' +
        '<div class="dcpv-ig-comments">Переглянути всі коментарі (48)</div>' +
        '<div class="dcpv-ig-time">' + timeAgo(p.dateTime).toUpperCase() + ' ТОМУ</div>' +
      '</div>' +
    '</div>';
  }


  /* ============ TIKTOK 9:16 vertical ============ */
  function renderTT(p) {
    var media = collectMedia(p);
    var hashLine = (p.hashtags || []).map(function(h){ return h.startsWith('#') ? h : '#' + h; }).join(' ');
    var captionRaw = (p.text || '').trim();
    var captionShort = truncatePlain(captionRaw, 80);
    var first = media[0] || {kind:'video', src:'', color:'#000'};
    var mediaBg = first.src ? 'url(' + JSON.stringify(first.src) + ') center/cover no-repeat, #000' : 'linear-gradient(135deg,#fe2c55,#222)';

    return '<div class="dcpv dcpv-tt">' +
      '<div class="dcpv-tt-shell" style="background:' + mediaBg + ';">' +
        '<div class="dcpv-tt-top">' +
          '<span>Підписки</span>' +
          '<span class="active">Для тебе</span>' +
          '<span class="ico">🔍</span>' +
        '</div>' +
        '<div class="dcpv-tt-sidebar">' +
          '<div class="dcpv-tt-avatar-wrap">' +
            '<img src="' + BRAND.avatar + '" class="dcpv-tt-avatar"/>' +
            '<div class="dcpv-tt-plus">+</div>' +
          '</div>' +
          '<div class="dcpv-tt-action"><div class="ico">❤️</div><div>28.4K</div></div>' +
          '<div class="dcpv-tt-action"><div class="ico">💬</div><div>432</div></div>' +
          '<div class="dcpv-tt-action"><div class="ico">🔖</div><div>1.2K</div></div>' +
          '<div class="dcpv-tt-action"><div class="ico">↗</div><div>Поділитись</div></div>' +
          '<div class="dcpv-tt-disc"><img src="' + BRAND.avatar + '"/></div>' +
        '</div>' +
        '<div class="dcpv-tt-bottom">' +
          '<div class="dcpv-tt-handle">@' + esc(BRAND.handles.tt) + ' · <b>Підписатися</b></div>' +
          '<div class="dcpv-tt-caption">' + esc(captionShort) + (hashLine ? ' <span class="dcpv-tt-hash">' + esc(hashLine) + '</span>' : '') + '</div>' +
          '<div class="dcpv-tt-sound">🎵 оригінальний звук · ' + esc(BRAND.handles.tt) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ============ THREADS feed (Twitter-like) ============ */
  function renderTH(p) {
    var media = collectMedia(p);
    var hashLine = (p.hashtags || []).map(function(h){ return h.startsWith('#') ? h : '#' + h; }).join(' ');
    var captionRaw = (p.text || '').trim();
    var captionHtml = nl2br(esc(captionRaw));
    if (hashLine) captionHtml += '<br/><span class="dcpv-th-hash">' + esc(hashLine) + '</span>';

    var mediaHtml = '';
    if (media.length === 1) {
      mediaHtml = '<div class="dcpv-th-media-wrap">' + mediaTile(media[0], {aspect:'1/1', radius:14}) + '</div>';
    } else if (media.length >= 2) {
      mediaHtml = '<div class="dcpv-th-media-row">' + media.slice(0,4).map(function(m){
        return '<div class="dcpv-th-media-cell">' + mediaTile(m, {aspect:'1/1', radius:14}) + '</div>';
      }).join('') + '</div>';
    }

    return '<div class="dcpv dcpv-th">' +
      '<div class="dcpv-th-shell">' +
        '<div class="dcpv-th-row">' +
          '<img src="' + BRAND.avatar + '" class="dcpv-th-avatar"/>' +
          '<div class="dcpv-th-content">' +
            '<div class="dcpv-th-head">' +
              '<b class="dcpv-th-name">' + esc(BRAND.handles.th) + '</b>' +
              '<span class="dcpv-th-verified">✓</span>' +
              '<span class="dcpv-th-time">· ' + timeAgo(p.dateTime) + '</span>' +
              '<span class="dcpv-th-menu">⋯</span>' +
            '</div>' +
            '<div class="dcpv-th-text">' + captionHtml + '</div>' +
            mediaHtml +
            '<div class="dcpv-th-actions">' +
              '<span class="ico">💬</span>' +
              '<span class="ico">↻</span>' +
              '<span class="ico">♡</span>' +
              '<span class="ico">✈️</span>' +
            '</div>' +
            '<div class="dcpv-th-stats">14 відповідей · 312 вподобань</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ============ YOUTUBE SHORTS 9:16 ============ */
  function renderYT(p) {
    var media = collectMedia(p);
    var captionRaw = (p.text || '').trim();
    var titleShort = truncatePlain(captionRaw.split('\n')[0] || '', 60);
    var first = media[0] || {kind:'video', src:'', color:'#000'};
    var mediaBg = first.src ? 'url(' + JSON.stringify(first.src) + ') center/cover no-repeat, #000' : 'linear-gradient(135deg,#ff0000,#220)';

    return '<div class="dcpv dcpv-yt">' +
      '<div class="dcpv-yt-shell" style="background:' + mediaBg + ';">' +
        '<div class="dcpv-yt-top">' +
          '<span class="ico">✕</span>' +
          '<span>Shorts</span>' +
          '<span class="ico">🔍</span>' +
        '</div>' +
        '<div class="dcpv-yt-sidebar">' +
          '<div class="dcpv-yt-action"><div class="ico-big">👍</div><div>4.2K</div></div>' +
          '<div class="dcpv-yt-action"><div class="ico-big">👎</div><div>Дизлайк</div></div>' +
          '<div class="dcpv-yt-action"><div class="ico-big">💬</div><div>187</div></div>' +
          '<div class="dcpv-yt-action"><div class="ico-big">↗</div><div>Поділ.</div></div>' +
          '<div class="dcpv-yt-action"><div class="ico-big">🎵</div><div>Звук</div></div>' +
          '<div class="dcpv-yt-disc"><img src="' + BRAND.avatar + '"/></div>' +
        '</div>' +
        '<div class="dcpv-yt-bottom">' +
          '<div class="dcpv-yt-channel-row">' +
            '<img src="' + BRAND.avatar + '" class="dcpv-yt-avatar"/>' +
            '<div class="dcpv-yt-handle">' + esc(BRAND.handles.yt) + '</div>' +
            '<button class="dcpv-yt-sub">Підписатися</button>' +
          '</div>' +
          '<div class="dcpv-yt-title">' + esc(titleShort) + ' <span class="dcpv-yt-tag">#shorts</span></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ============ FACEBOOK feed post ============ */
  function renderFB(p) {
    var media = collectMedia(p);
    var hashLine = (p.hashtags || []).map(function(h){ return h.startsWith('#') ? h : '#' + h; }).join(' ');
    var captionRaw = (p.text || '').trim();
    var truncated = truncatePlain(captionRaw, 180);
    var hasMore = captionRaw.length > 180;
    var captionHtml = nl2br(esc(truncated));
    if (hasMore) captionHtml += ' <span class="dcpv-fb-more">…ще</span>';
    if (hashLine) captionHtml += '<br/><span class="dcpv-fb-hash">' + esc(hashLine) + '</span>';

    var mediaHtml = '';
    if (media.length === 1) {
      mediaHtml = '<div class="dcpv-fb-media-1">' + mediaTile(media[0], {aspect:'4/5'}) + '</div>';
    } else if (media.length === 2) {
      mediaHtml = '<div class="dcpv-fb-media-2">' +
        media.slice(0,2).map(function(m){ return '<div>' + mediaTile(m, {aspect:'1/1'}) + '</div>'; }).join('') + '</div>';
    } else if (media.length >= 3) {
      mediaHtml = '<div class="dcpv-fb-media-3">' +
        '<div class="big">' + mediaTile(media[0], {aspect:'1/1'}) + '</div>' +
        '<div class="side">' +
          '<div>' + mediaTile(media[1], {aspect:'1/1'}) + '</div>' +
          '<div class="last">' + mediaTile(media[2], {aspect:'1/1'}) +
          (media.length > 3 ? '<div class="dcpv-fb-more-count">+' + (media.length - 3) + '</div>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }

    return '<div class="dcpv dcpv-fb">' +
      '<div class="dcpv-fb-shell">' +
        '<div class="dcpv-fb-head">' +
          '<img src="' + BRAND.avatar + '" class="dcpv-fb-avatar"/>' +
          '<div>' +
            '<div class="dcpv-fb-name">' + esc(BRAND.handles.fb) + ' <span class="dcpv-fb-verified">✓</span></div>' +
            '<div class="dcpv-fb-time">' + timeAgo(p.dateTime) + ' · 🌍</div>' +
          '</div>' +
          '<div class="dcpv-fb-menu">⋯</div>' +
        '</div>' +
        '<div class="dcpv-fb-text">' + captionHtml + '</div>' +
        mediaHtml +
        '<div class="dcpv-fb-stats">' +
          '<span class="reactions">👍❤️🔥</span> <span>2.4K</span>' +
          '<span class="right">87 коментарів · 12 поширень</span>' +
        '</div>' +
        '<div class="dcpv-fb-actions">' +
          '<button>👍 Подобається</button>' +
          '<button>💬 Коментар</button>' +
          '<button>↗ Поділитись</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }


  /* ============ STYLES ============ */
  var CSS = [
    '.dcpv { max-width: 420px; margin: 0 auto; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; }',
    '.dcpv * { box-sizing: border-box; }',
    '.dcpv-media-empty, .dcpv-media-img, .dcpv-media-video { width: 100%; display: flex; align-items: center; justify-content: center; color: #555; font-size: 11px; overflow: hidden; }',
    '.dcpv-media-video { position: relative; }',
    '.dcpv-play { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.25); color: rgba(255,255,255,0.95); font-size: 42px; text-shadow: 0 2px 12px rgba(0,0,0,0.6); pointer-events: none; }',

    /* ===== TELEGRAM ===== */
    '.dcpv-tg { color: #fff; }',
    '.dcpv-tg-shell { background: #17212B; border-radius: 12px; overflow: hidden; border: 1px solid #232E3C; }',
    '.dcpv-tg-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #17212B; border-bottom: 1px solid #232E3C; }',
    '.dcpv-tg-avatar { width: 36px; height: 36px; border-radius: 50%; background: #000; }',
    '.dcpv-tg-name { font-weight: 600; font-size: 14px; flex: 1; line-height: 1.2; }',
    '.dcpv-tg-menu { color: #6c7883; font-size: 18px; }',
    '.dcpv-tg-body { padding: 14px 12px; background: #0E1621; }',
    '.dcpv-tg-bubble { background: #182533; border-radius: 10px; padding: 0; overflow: hidden; }',
    '.dcpv-tg-single, .dcpv-tg-album { width: 100%; }',
    '.dcpv-tg-album { display: grid; gap: 2px; }',
    '.dcpv-tg-album.cols-2 { grid-template-columns: 1fr 1fr; }',
    '.dcpv-tg-album.cols-3 { grid-template-columns: 1fr 1fr 1fr; }',
    '.dcpv-tg-album-cell { background: #000; }',
    '.dcpv-tg-caption { padding: 8px 12px 6px; font-size: 14px; line-height: 1.35; color: #fff; word-wrap: break-word; }',
    '.dcpv-tg-caption tg-spoiler { background: #6c7883; border-radius: 3px; padding: 0 4px; color: #6c7883; }',
    '.dcpv-tg-link { color: #6AB6F0; }',
    '.dcpv-tg-buttons { display: grid; gap: 4px; padding: 4px 8px 8px; }',
    '.dcpv-tg-btn { background: #2B5278; color: #fff; border: 0; padding: 8px 12px; font-size: 13px; border-radius: 6px; font-weight: 500; cursor: default; text-align: center; }',
    '.dcpv-tg-footmeta { display: flex; gap: 10px; padding: 4px 12px 8px; color: #6c7883; font-size: 11px; align-items: center; }',
    '.dcpv-tg-footmeta .reacts { color: #fff; background: #2B5278; padding: 2px 6px; border-radius: 10px; font-size: 11px; }',
    '.dcpv-tg-footmeta .time { margin-left: auto; }',

    /* ===== INSTAGRAM ===== */
    '.dcpv-ig-shell { background: #000; color: #fff; border: 1px solid #262626; border-radius: 0; overflow: hidden; }',
    '.dcpv-ig-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid #262626; }',
    '.dcpv-ig-avatar { width: 32px; height: 32px; border-radius: 50%; background: #000; outline: 2px solid #000; box-shadow: 0 0 0 2px transparent; padding: 2px; background: linear-gradient(45deg,#feda75,#fa7e1e,#d62976,#962fbf,#4f5bd5); }',
    '.dcpv-ig-username { flex: 1; font-weight: 600; font-size: 14px; }',
    '.dcpv-ig-verified { color: #1DA1F2; font-size: 11px; background: #1DA1F2; color: #fff; border-radius: 50%; padding: 0 4px; }',
    '.dcpv-ig-menu { color: #fff; font-size: 18px; }',
    '.dcpv-ig-media { position: relative; }',
    '.dcpv-ig-carousel { position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.6); color: #fff; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }',
    '.dcpv-ig-actions { display: flex; gap: 12px; padding: 10px 14px 6px; font-size: 22px; }',
    '.dcpv-ig-actions .right { margin-left: auto; }',
    '.dcpv-ig-likes { padding: 0 14px 4px; font-size: 14px; }',
    '.dcpv-ig-caption { padding: 0 14px 4px; font-size: 14px; line-height: 1.35; }',
    '.dcpv-ig-hash { color: #00376b; }',
    '.dcpv-ig-more { color: #8e8e8e; }',
    '.dcpv-ig-comments { padding: 4px 14px; color: #8e8e8e; font-size: 14px; }',
    '.dcpv-ig-time { padding: 6px 14px 12px; color: #8e8e8e; font-size: 10px; letter-spacing: 0.5px; }',

    /* ===== TIKTOK ===== */
    '.dcpv-tt-shell { aspect-ratio: 9/16; max-width: 360px; margin: 0 auto; border-radius: 12px; position: relative; overflow: hidden; color: #fff; }',
    '.dcpv-tt-top { position: absolute; top: 0; left: 0; right: 0; padding: 14px; display: flex; gap: 18px; justify-content: center; align-items: center; font-size: 15px; color: rgba(255,255,255,0.7); font-weight: 600; background: linear-gradient(180deg, rgba(0,0,0,0.5), transparent); z-index: 2; }',
    '.dcpv-tt-top .active { color: #fff; border-bottom: 2px solid #fff; padding-bottom: 2px; }',
    '.dcpv-tt-top .ico { margin-left: auto; }',
    '.dcpv-tt-sidebar { position: absolute; right: 8px; bottom: 110px; display: flex; flex-direction: column; gap: 18px; align-items: center; z-index: 2; }',
    '.dcpv-tt-avatar-wrap { position: relative; }',
    '.dcpv-tt-avatar { width: 48px; height: 48px; border-radius: 50%; border: 2px solid #fff; background: #000; }',
    '.dcpv-tt-plus { position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); background: #fe2c55; color: #fff; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 700; }',
    '.dcpv-tt-action { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 11px; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }',
    '.dcpv-tt-action .ico { font-size: 30px; }',
    '.dcpv-tt-disc { width: 40px; height: 40px; border-radius: 50%; background: #000; border: 2px solid #333; overflow: hidden; animation: dcpvSpin 6s linear infinite; }',
    '.dcpv-tt-disc img { width: 100%; height: 100%; object-fit: cover; }',
    '@keyframes dcpvSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }',
    '.dcpv-tt-bottom { position: absolute; left: 0; right: 60px; bottom: 0; padding: 16px; background: linear-gradient(0deg, rgba(0,0,0,0.5), transparent); z-index: 2; }',
    '.dcpv-tt-handle { font-weight: 700; font-size: 15px; margin-bottom: 6px; }',
    '.dcpv-tt-caption { font-size: 13px; line-height: 1.35; margin-bottom: 6px; }',
    '.dcpv-tt-hash { color: #fff; }',
    '.dcpv-tt-sound { font-size: 12px; opacity: 0.9; }',

    /* ===== THREADS ===== */
    '.dcpv-th-shell { background: #000; color: #fff; border: 1px solid #1a1a1a; border-radius: 0; padding: 16px 14px 0; }',
    '.dcpv-th-row { display: flex; gap: 12px; }',
    '.dcpv-th-avatar { width: 36px; height: 36px; border-radius: 50%; background: #000; flex-shrink: 0; }',
    '.dcpv-th-content { flex: 1; min-width: 0; }',
    '.dcpv-th-head { display: flex; align-items: center; gap: 5px; font-size: 14px; }',
    '.dcpv-th-name { color: #fff; }',
    '.dcpv-th-verified { color: #fff; background: #1DA1F2; border-radius: 50%; font-size: 10px; padding: 0 4px; }',
    '.dcpv-th-time { color: #7a7a7a; font-size: 13px; }',
    '.dcpv-th-menu { margin-left: auto; color: #7a7a7a; }',
    '.dcpv-th-text { padding: 4px 0; font-size: 15px; line-height: 1.35; word-wrap: break-word; }',
    '.dcpv-th-hash { color: #2864e5; }',
    '.dcpv-th-media-wrap, .dcpv-th-media-row { margin: 8px 0; }',
    '.dcpv-th-media-row { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }',
    '.dcpv-th-actions { display: flex; gap: 18px; padding: 8px 0 4px; font-size: 18px; color: #fff; }',
    '.dcpv-th-stats { padding: 4px 0 14px; color: #7a7a7a; font-size: 13px; border-bottom: 1px solid #1a1a1a; }',

    /* ===== YOUTUBE SHORTS ===== */
    '.dcpv-yt-shell { aspect-ratio: 9/16; max-width: 360px; margin: 0 auto; border-radius: 12px; position: relative; overflow: hidden; color: #fff; }',
    '.dcpv-yt-top { position: absolute; top: 0; left: 0; right: 0; padding: 14px; display: flex; justify-content: space-between; align-items: center; font-size: 16px; font-weight: 600; background: linear-gradient(180deg, rgba(0,0,0,0.4), transparent); z-index: 2; }',
    '.dcpv-yt-sidebar { position: absolute; right: 8px; bottom: 110px; display: flex; flex-direction: column; gap: 16px; align-items: center; z-index: 2; }',
    '.dcpv-yt-action { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 11px; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }',
    '.dcpv-yt-action .ico-big { font-size: 28px; }',
    '.dcpv-yt-disc { width: 36px; height: 36px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.3); }',
    '.dcpv-yt-disc img { width: 100%; height: 100%; object-fit: cover; }',
    '.dcpv-yt-bottom { position: absolute; left: 0; right: 56px; bottom: 0; padding: 16px; background: linear-gradient(0deg, rgba(0,0,0,0.6), transparent); z-index: 2; }',
    '.dcpv-yt-channel-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }',
    '.dcpv-yt-avatar { width: 32px; height: 32px; border-radius: 50%; background: #000; }',
    '.dcpv-yt-handle { font-weight: 600; font-size: 14px; flex: 1; }',
    '.dcpv-yt-sub { background: #fff; color: #000; border: 0; padding: 8px 14px; border-radius: 20px; font-weight: 600; font-size: 13px; }',
    '.dcpv-yt-title { font-size: 14px; line-height: 1.3; }',
    '.dcpv-yt-tag { color: #fff; opacity: 0.8; }',

    /* ===== FACEBOOK ===== */
    '.dcpv-fb-shell { background: #1B1F23; color: #E4E6EB; border: 1px solid #3A3B3C; border-radius: 10px; overflow: hidden; }',
    '.dcpv-fb-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px 8px; }',
    '.dcpv-fb-avatar { width: 40px; height: 40px; border-radius: 50%; background: #000; }',
    '.dcpv-fb-name { font-weight: 600; font-size: 15px; }',
    '.dcpv-fb-verified { color: #fff; background: #1DA1F2; border-radius: 50%; font-size: 10px; padding: 0 4px; }',
    '.dcpv-fb-time { font-size: 12px; color: #B0B3B8; }',
    '.dcpv-fb-menu { margin-left: auto; color: #B0B3B8; font-size: 22px; }',
    '.dcpv-fb-text { padding: 4px 14px 12px; font-size: 15px; line-height: 1.4; }',
    '.dcpv-fb-more { color: #B0B3B8; }',
    '.dcpv-fb-hash { color: #2374E1; }',
    '.dcpv-fb-media-1 { background: #000; }',
    '.dcpv-fb-media-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; background: #000; }',
    '.dcpv-fb-media-3 { display: grid; grid-template-columns: 2fr 1fr; gap: 2px; background: #000; }',
    '.dcpv-fb-media-3 .side { display: grid; grid-template-rows: 1fr 1fr; gap: 2px; }',
    '.dcpv-fb-media-3 .last { position: relative; }',
    '.dcpv-fb-more-count { position: absolute; inset: 0; background: rgba(0,0,0,0.55); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 600; }',
    '.dcpv-fb-stats { display: flex; align-items: center; padding: 10px 14px 8px; font-size: 13px; color: #B0B3B8; border-bottom: 1px solid #3A3B3C; }',
    '.dcpv-fb-stats .reactions { font-size: 14px; margin-right: 4px; }',
    '.dcpv-fb-stats .right { margin-left: auto; }',
    '.dcpv-fb-actions { display: flex; padding: 4px 8px; }',
    '.dcpv-fb-actions button { flex: 1; background: transparent; border: 0; color: #B0B3B8; padding: 10px 0; font-size: 14px; font-weight: 600; cursor: default; border-radius: 4px; }',
    '.dcpv-fb-actions button:hover { background: #2C2D2E; }',

    /* Спільне: коли preview-картка — додаємо тінь */
    '.dcpv { filter: drop-shadow(0 8px 30px rgba(0,0,0,0.4)); }',
  ].join('\n');

  var styleEl = document.createElement('style');
  styleEl.id = 'dcpv-styles';
  styleEl.textContent = CSS;
  document.head.appendChild(styleEl);

  /* ============ ROUTER ============ */
  var RENDERERS = { tg: renderTG, ig: renderIG, tt: renderTT, fb: renderFB, yt: renderYT, th: renderTH };

  // Експозиція для app-preview-tabs.js
  window.__hqRenderPlatformV2 = function(p, plat) {
    var fn = RENDERERS[plat];
    if (!fn) return '';
    try { return fn(p); }
    catch (e) {
      console.warn('[dcpv] render', plat, e);
      return '<div class="dcpv">Помилка рендерингу превью: ' + esc(e.message) + '</div>';
    }
  };

  console.log('%cDreamCar HQ Preview v2 %c· pixel-perfect TG/IG/TT/TH/YT/FB (#328)',
    'color:#10b981;font-weight:700;', 'color:#888;');
})();
