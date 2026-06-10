/* ============================================================
   DreamCar HQ — Per-Platform Preview Tabs (#119)
   ============================================================ */
// Заміна #previewSection на UI з табами для кожної обраної платформи.
// Кожен таб:
//   • Свій preview-card з відповідним брендингом
//   • Свій datetime picker (зберігається у p.platformDates[platformId])
// Якщо різного часу не задано — використовується основний p.dateTime.
//
// УВАГА: для персистентності p.platformDates потрібна міграція 013
// (publications.platform_dates jsonb). Без неї часи зберігаються у пам'яті
// до перезавантаження, далі — повертаються до основного p.dateTime.

(function () {
  if (window.__hqPreviewTabs) return;
  window.__hqPreviewTabs = true;

  var PLATFORMS = [
    { id: 'ig', name: 'Instagram', icon: '📷', color: '#E1306C', handle: '@dreamcar.ua' },
    { id: 'tg', name: 'Telegram',  icon: '✈️', color: '#0088cc', handle: '@dreamcar_ua' },
    { id: 'tt', name: 'TikTok',    icon: '🎵', color: '#fe2c55', handle: '@dreamcar.ua' },
    { id: 'fb', name: 'Facebook',  icon: '📘', color: '#1877f2', handle: 'DreamCar.ua' },
    { id: 'yt', name: 'YT Shorts', icon: '▶️', color: '#ff0000', handle: '@dreamcar' },
    { id: 'th', name: 'Threads',   icon: '🧵', color: '#666',    handle: '@dreamcar.ua' },
  ];

  function escapeText(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  // #258: TG HTML format parser — дозволені TG-теги розпарсуємо, все інше escape
  function tgFmt(raw) {
    if (!raw) return '';
    var s = String(raw).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    var tags = ['b','strong','i','em','u','s','strike','del','code','pre','tg-spoiler','blockquote','br'];
    tags.forEach(function(t){
      s = s.replace(new RegExp('&lt;' + t + '&gt;', 'gi'), '<' + t + '>')
           .replace(new RegExp('&lt;\\/' + t + '&gt;', 'gi'), '</' + t + '>');
    });
    s = s.replace(/&lt;a\s+href=&quot;([^&]+)&quot;&gt;([\s\S]*?)&lt;\/a&gt;/gi, function(_, url, txt){
      return '<a href="' + url.replace(/"/g,'&quot;') + '" target="_blank" rel="noopener" style="color:#3390ec;">' + txt + '</a>';
    });
    s = s.replace(/&lt;&lt;&lt;([\s\S]+?)&gt;&gt;&gt;/g, '<tg-spoiler>$1</tg-spoiler>');
    return s;
  }

  function getCurrentPub() {
    if (window.__hqCurrentPub) return window.__hqCurrentPub;
    var hash = (location.hash || '').slice(1);
    if (hash.indexOf('publication/') === 0) {
      var pubId = hash.split('/')[1];
      try { return Store.pub(pubId); } catch (_) {}
    }
    return null;
  }

  function platformDateISO(p, plat) {
    if (p.platformDates && p.platformDates[plat]) return p.platformDates[plat];
    if (p.platform_dates && p.platform_dates[plat]) return p.platform_dates[plat];
    return p.dateTime;
  }
  function platformDateLocalInput(p, plat) {
    var iso = platformDateISO(p, plat);
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + 'T' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function renderTabsHtml(p, activePlatform) {
    var selected = Array.isArray(p.platforms) ? p.platforms : [];
    if (selected.length === 0) return '';
    return '<div class="hq-prev-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;border-bottom:1px solid var(--border);padding-bottom:10px;">' +
      selected.map(function (plat) {
        var pdef = PLATFORMS.find(function (x) { return x.id === plat; });
        if (!pdef) return '';
        var on = plat === activePlatform;
        return '<button class="hq-prev-tab' + (on ? ' on' : '') + '" data-plat="' + plat + '" ' +
          'style="background:' + (on ? pdef.color : 'transparent') + ';' +
          'color:' + (on ? '#fff' : 'var(--grey)') + ';' +
          'border:1px solid ' + (on ? pdef.color : 'var(--border)') + ';' +
          'padding:7px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600;' +
          (on ? 'box-shadow:0 2px 8px ' + pdef.color + '55;' : '') +
          '">' + pdef.icon + ' ' + pdef.name + '</button>';
      }).join('') + '</div>';
  }

  function renderPlatformPreview(p, plat) {
    var pdef = PLATFORMS.find(function (x) { return x.id === plat; });
    if (!pdef) return '';

    var dtVal = platformDateLocalInput(p, plat);
    var dtPicker = '<div style="margin-bottom:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<label style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--grey);font-weight:700;">⏰ Час для ' + pdef.name + ':</label>' +
      '<input type="datetime-local" class="hq-prev-time" data-plat="' + plat + '" value="' + dtVal + '" ' +
      'style="background:var(--bg);border:1px solid var(--border);color:#fff;padding:6px 10px;border-radius:6px;font-size:12px;"/>' +
      '<button class="hq-prev-time-reset" data-plat="' + plat + '" title="Як у основній даті" ' +
      'style="background:transparent;border:1px solid var(--border);color:var(--grey);padding:5px 10px;border-radius:6px;font-size:11px;cursor:pointer;">⟲ як основна</button>' +
      '</div>';

    // #328: pixel-perfect per-platform render з app-preview-platforms.js
    if (typeof window.__hqRenderPlatformV2 === 'function') {
      var v2 = window.__hqRenderPlatformV2(p, plat);
      if (v2) return dtPicker + v2;
    }

    // Fallback (старий generic render) — якщо v2 ще не загрузився
    var cr = (p.creatives || []).map(function (id) {
      try { return Store.creative(id); } catch (_) { return null; }
    }).filter(Boolean);
    var firstMedia = cr[0] ? cr[0].preview : pdef.icon;
    var firstColor = cr[0] ? (cr[0].color || pdef.color) : pdef.color;
    var txt = tgFmt(p.text || '').replace(/(#[\p{L}\p{N}_]+)/gu, '<span class="pv-hash">$1</span>');
    var hashLine = (p.hashtags || []).map(function (h) { return h.startsWith('#') ? h : '#' + h; }).join(' ');
    var hashHtml = hashLine
      ? '<div style="margin-top:6px;color:var(--blue-soft);font-size:11px;">' + escapeText(hashLine).replace(/(#\S+)/g, '<span class="pv-hash">$1</span>') + '</div>'
      : '';
    var isVertical = plat === 'tg' || plat === 'yt';
    var card = '<div class="preview-card ' + plat + '" style="max-width:380px;margin:0 auto;">' +
      '<div class="pv-head" style="background:linear-gradient(180deg,' + pdef.color + '20,transparent);">' +
      '<div class="pv-avatar" style="background:linear-gradient(135deg,' + pdef.color + ',' + pdef.color + 'aa)">DC</div>' +
      '<div><div class="pv-name">DreamCar</div><div class="pv-handle">' + pdef.icon + ' ' + pdef.handle + '</div></div>' +
      '</div>' +
      '<div class="pv-media' + (isVertical ? ' tg' : '') + '" style="background: linear-gradient(135deg, ' + firstColor + '33, var(--bg-2))">' + firstMedia + '</div>' +
      '<div class="pv-actions">♥ &nbsp; 💬 &nbsp; ↗ &nbsp; <span style="margin-left:auto">🔖</span></div>' +
      '<div class="pv-text"><b>' + pdef.handle + '</b> ' + (txt || '<i style="color:var(--grey)">(пусто)</i>') + hashHtml + '</div>' +
      '</div>';

    return dtPicker + card;
  }

  function bindHandlers(section, p, activePlatform, rerender) {
    // Tab clicks
    section.querySelectorAll('.hq-prev-tab').forEach(function (btn) {
      btn.onclick = function () {
        rerender(btn.dataset.plat);
      };
    });
    // Datetime input
    var dtInput = section.querySelector('.hq-prev-time');
    if (dtInput) {
      dtInput.onchange = function () {
        var plat = dtInput.dataset.plat;
        if (!p.platformDates) p.platformDates = {};
        try {
          var iso = new Date(dtInput.value).toISOString();
          p.platformDates[plat] = iso;
          if (typeof window.autosave === 'function') window.autosave(p);
          if (typeof window.toast === 'function') {
            var pdef = PLATFORMS.find(function (x) { return x.id === plat; });
            window.toast('Час для ' + (pdef ? pdef.name : plat), 'success',
              new Date(iso).toLocaleString('uk-UA'));
          }
        } catch (e) { console.warn('platform date set:', e); }
      };
    }
    // Reset button
    var rstBtn = section.querySelector('.hq-prev-time-reset');
    if (rstBtn) {
      rstBtn.onclick = function () {
        var plat = rstBtn.dataset.plat;
        if (p.platformDates && p.platformDates[plat]) {
          delete p.platformDates[plat];
          if (typeof window.autosave === 'function') window.autosave(p);
          rerender(activePlatform);
        }
      };
    }
  }

  // Зберігаємо вибраний таб у data-атрибуті section, щоб не скидати при оновленнях
  function getActivePlatform(section, p) {
    var saved = section.dataset.activePlat;
    var selected = Array.isArray(p.platforms) ? p.platforms : [];
    if (saved && selected.indexOf(saved) >= 0) return saved;
    return selected[0] || null;
  }

  function installTabs() {
    var section = document.getElementById('previewSection');
    if (!section) return;
    var p = getCurrentPub();
    if (!p) return;
    var selected = Array.isArray(p.platforms) ? p.platforms : [];

    // Якщо немає вибраних платформ — нічого не робимо, нехай оригінал показує fallback
    if (selected.length === 0) {
      delete section.dataset.activePlat;
      return;
    }

    // Якщо вже наші таби на місці і activePlat ще валідний — нічого не робимо
    var hasTabs = section.querySelector('.hq-prev-tabs');
    if (hasTabs) {
      var curActive = getActivePlatform(section, p);
      // Якщо набір платформ змінився — перерисувати
      var rendered = Array.from(section.querySelectorAll('.hq-prev-tab')).map(function (t) { return t.dataset.plat; });
      var same = rendered.length === selected.length && rendered.every(function (x) { return selected.indexOf(x) >= 0; });
      if (same) return;
    }

    var active = getActivePlatform(section, p);
    if (!active) return;
    section.dataset.activePlat = active;

    function rerender(newActive) {
      if (newActive) section.dataset.activePlat = newActive;
      active = section.dataset.activePlat;
      section.innerHTML = renderTabsHtml(p, active) + renderPlatformPreview(p, active);
      bindHandlers(section, p, active, rerender);
    }

    rerender(active);
  }

  // Watch DOM changes — pre-render section отримує новий вміст
  if ('MutationObserver' in window) {
    var mo = new MutationObserver(function () {
      if (document.getElementById('previewSection')) {
        clearTimeout(window.__hqPTTimer);
        window.__hqPTTimer = setTimeout(installTabs, 30);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  setTimeout(installTabs, 500);
  setTimeout(installTabs, 1500);
  setTimeout(installTabs, 4000);

  console.log('%cDreamCar HQ Preview Tabs %c· per-platform tabs + datetime (#119)',
    'color:#fbbf24;font-weight:700;', 'color:#888;');
})();
