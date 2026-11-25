/* DreamCar HQ — тип TG-поста: «Звичайний / альбом (сітка)» або «Карусель (свайп)» (25.11.2026).
   Ліміти ті самі, що у supabase/functions/tg-post-send. */
(function () {
  var L = { min: 2, max: 50, text: 32768, photo: 10 * 1048576, video: 40 * 1048576, total: 40 * 1048576 };

  function isCarousel(p) {
    return !!p && p.tg_post_type === 'carousel' && (p.platforms || []).indexOf('tg') >= 0;
  }

  function problems(p) {
    if (!isCarousel(p)) return [];
    var out = [];
    var ids = Array.from(new Set((p.creatives || []).filter(Boolean)));
    if (ids.length < L.min) out.push('потрібно від ' + L.min + ' медіа (зараз ' + ids.length + ')');
    if (ids.length > L.max) out.push('максимум ' + L.max + ' медіа (зараз ' + ids.length + ')');
    var total = 0;
    ids.forEach(function (id, i) {
      var c = typeof Store !== 'undefined' && Store.creative(id); // Store оголошено через const, у window його немає
      if (!c) return;
      var n = '№' + (i + 1) + ' «' + (c.name || '') + '»';
      if (c.type !== 'photo' && c.type !== 'video') { out.push(n + ': у каруселі можуть бути лише фото та відео'); return; }
      // відео відправляється стиснутим файлом; поки він не готовий, розмір перевірить відправка
      var size = Number(c.type === 'video' ? c.compressed_size_bytes : c.size_bytes) || 0;
      var max = c.type === 'video' ? L.video : L.photo;
      if (size > max) out.push(n + ': ' + (size / 1048576).toFixed(1) + ' МБ, ліміт ' + (max / 1048576) + ' МБ');
      total += size;
    });
    if (total > L.total) out.push('медіа разом понад ' + (L.total / 1048576) + ' МБ');
    var len = String(p.text || '').length + (p.hashtags || []).join(' #').length;
    if (len > L.text) out.push('текст довший за ' + L.text + ' символів');
    return out;
  }

  function warnHtml(p) {
    var list = problems(p);
    if (!list.length) return '';
    return '⚠ Карусель поки не можна погодити: ' + list.map(function (x) {
      return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }).join('; ');
  }

  function blockHtml(p) {
    var cur = p.tg_post_type === 'carousel' ? 'carousel' : 'standard';
    var opt = function (v, label) {
      return '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:6px 10px;border-radius:6px;border:1px solid ' +
        (cur === v ? 'var(--blue,#3b82f6);background:rgba(59,130,246,0.15)' : 'var(--border)') + ';">' +
        '<input type="radio" name="f_tg_post_type" value="' + v + '"' + (cur === v ? ' checked' : '') + '/><span>' + label + '</span></label>';
    };
    return '<div style="margin-bottom:14px;padding:10px;background:var(--bg-3);border-radius:6px;border:1px solid var(--border);">' +
      '<div style="font-size:10px;color:var(--grey);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🧩 Тип поста</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;font-size:12px;">' + opt('standard', 'Звичайний / альбом (сітка)') + opt('carousel', '🎠 Карусель (свайп)') + '</div>' +
      (cur === 'carousel' ? '<div style="font-size:10px;color:var(--grey);margin-top:6px;line-height:1.5;">Від 2 до 50 фото/відео в порядку картки, усі разом до 40 МБ, кнопки під постом. Одна спроба відправки без автоповтору. Вигляд на старих версіях Telegram не гарантований. Лічильник {{countdown}} після публікації в каруселі не оновлюється.</div>' : '') +
      '<div id="tgCarouselWarn" style="font-size:12px;color:#fca5a5;margin-top:6px;">' + warnHtml(p) + '</div>' +
      '</div>';
  }

  window.tgIsCarousel = isCarousel;
  window.tgCarouselProblems = problems;
  window.tgPostTypeBlockHtml = blockHtml;
  window.tgRefreshCarouselWarn = function (p) {
    var el = document.getElementById('tgCarouselWarn');
    if (el) el.innerHTML = warnHtml(p);
  };
})();
