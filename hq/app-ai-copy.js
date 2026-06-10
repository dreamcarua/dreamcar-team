/* ============================================================
   DreamCar HQ — AI Copy Assistant (A2) — simplified
   ============================================================ */
// Спрощений варіант: бренд завжди DreamCar (інші — на майбутнє,
// коли стіл буде у іншого проєкту). ЦА — Claude знає з brand voice.

(function () {
  if (window.__hqAiCopyLoaded) return;
  window.__hqAiCopyLoaded = true;

  function fnUrl(name) {
    var base = (window.HQ_CONFIG && window.HQ_CONFIG.SUPABASE_URL) || '';
    return base.replace(/\/$/, '') + '/functions/v1/' + name;
  }
  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  (function () {
    if (document.getElementById('hq-ai-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-ai-css';
    css.textContent =
      '.hq-ai-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border: none; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; margin-left: 8px; transition: opacity 0.15s; }' +
      '.hq-ai-btn:hover { opacity: 0.9; }' +
      '.hq-ai-btn:disabled { opacity: 0.5; cursor: not-allowed; }' +
      '.hq-ai-modal { position: fixed; inset: 0; background: rgba(0,0,0,0.7); backdrop-filter: blur(4px); z-index: 300; display: flex; align-items: center; justify-content: center; padding: 20px; }' +
      '.hq-ai-card { background: var(--bg-2); border: 1px solid var(--border); border-radius: 12px; padding: 22px 24px; max-width: 540px; width: 100%; box-shadow: var(--shadow); }' +
      '.hq-ai-card h2 { font-size: 16px; color: #fff; margin-bottom: 14px; font-weight: 800; display: flex; align-items: center; gap: 8px; }' +
      '.hq-ai-grid { display: grid; gap: 10px; }' +
      '.hq-ai-row { display: grid; gap: 10px; grid-template-columns: 1fr 1fr 1fr; }' +
      '.hq-ai-card label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--grey); margin-bottom: 4px; font-weight: 700; }' +
      '.hq-ai-card input, .hq-ai-card textarea, .hq-ai-card select { width: 100%; background: var(--bg); border: 1px solid var(--border); color: #fff; padding: 8px 11px; border-radius: 6px; font-size: 12px; font-family: inherit; }' +
      '.hq-ai-card textarea { min-height: 80px; resize: vertical; }' +
      '.hq-ai-card .actions { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }' +
      '.hq-ai-result { margin-top: 14px; padding: 12px; background: var(--bg); border-left: 3px solid #8b5cf6; border-radius: 6px; }' +
      '.hq-ai-result .body { color: #fff; font-size: 13px; line-height: 1.6; white-space: pre-wrap; max-height: 240px; overflow-y: auto; }' +
      '.hq-ai-result .tags { margin-top: 8px; font-size: 11px; color: #93c5fd; }' +
      '.hq-ai-result .meta { margin-top: 6px; font-size: 10px; color: var(--grey-2); }' +
      '.hq-ai-spin { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: hq-ai-spin 0.8s linear infinite; }' +
      '@keyframes hq-ai-spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(css);
  })();

  function getPubFromCard() {
    var hash = (location.hash || '').slice(1);
    var parts = hash.split('/');
    if (parts[0] === 'publication' && parts[1]) {
      try { return window.Store && Store.pub ? Store.pub(parts[1]) : null; } catch (_) { return null; }
    }
    return null;
  }

  async function callAi(payload) {
    var headers = { 'Content-Type': 'application/json' };
    var sec = window.HQ_CONFIG && window.HQ_CONFIG.HQ_AI_SECRET;
    if (sec) headers['x-hq-ai-secret'] = sec;
    var resp = await fetch(fnUrl('ai-copy-assistant'), {
      method: 'POST', headers: headers, body: JSON.stringify(payload),
    });
    var data;
    try { data = await resp.json(); } catch (_) { data = null; }
    if (!resp.ok || !data || !data.ok) {
      throw new Error((data && data.error) || ('HTTP ' + resp.status));
    }
    return data;
  }

  function showModal(pub) {
    if (document.querySelector('.hq-ai-modal')) return;
    var platforms = (pub && pub.platforms) || ['ig'];
    var firstPlatform = platforms[0] || 'ig';

    var sc = document.createElement('div');
    sc.className = 'hq-ai-modal';
    sc.innerHTML =
      '<div class="hq-ai-card">' +
        '<h2>✨ AI копірайт <span style="font-size:11px;color:var(--grey);font-weight:400;">· Claude Sonnet · DreamCar</span></h2>' +
        '<div class="hq-ai-grid">' +
          '<div>' +
            '<label>Brief (про що пост)</label>' +
            '<textarea id="hq_ai_brief" placeholder="напр.: новий запуск Audi Q5 — спільнота 1500 учасників, переможець завтра">' + escapeHtml(pub && pub.title ? pub.title : '') + '</textarea>' +
          '</div>' +
          '<div class="hq-ai-row">' +
            '<div>' +
              '<label>Платформа</label>' +
              '<select id="hq_ai_platform">' +
                '<option value="ig"' + (firstPlatform === 'ig' ? ' selected' : '') + '>Instagram</option>' +
                '<option value="tg"' + (firstPlatform === 'tg' ? ' selected' : '') + '>Telegram</option>' +
                '<option value="tt"' + (firstPlatform === 'tt' ? ' selected' : '') + '>TikTok</option>' +
                '<option value="yt"' + (firstPlatform === 'yt' ? ' selected' : '') + '>YT Shorts</option>' +
                '<option value="fb"' + (firstPlatform === 'fb' ? ' selected' : '') + '>Facebook</option>' +
                '<option value="th"' + (firstPlatform === 'th' ? ' selected' : '') + '>Threads</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label>Тон</label>' +
              '<select id="hq_ai_tone">' +
                '<option value="casual" selected>Невимушено</option>' +
                '<option value="expert">Експертно</option>' +
                '<option value="playful">Грайливо</option>' +
                '<option value="salesy">Продажно</option>' +
              '</select>' +
            '</div>' +
            '<div>' +
              '<label>Довжина</label>' +
              '<select id="hq_ai_length">' +
                '<option value="short">Коротко</option>' +
                '<option value="medium" selected>Середньо</option>' +
                '<option value="long">Довго</option>' +
              '</select>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="actions">' +
          '<button class="btn" id="hq_ai_cancel">Скасувати</button>' +
          '<button class="btn btn-primary" id="hq_ai_go">✨ Згенерувати</button>' +
        '</div>' +
        '<div id="hq_ai_result_container"></div>' +
      '</div>';
    document.body.appendChild(sc);

    sc.querySelector('#hq_ai_cancel').onclick = function () { sc.remove(); };
    sc.onclick = function (e) { if (e.target === sc) sc.remove(); };

    sc.querySelector('#hq_ai_go').onclick = async function () {
      var btn = this;
      var brief = sc.querySelector('#hq_ai_brief').value.trim();
      if (!brief) {
        if (typeof toast === 'function') toast('AI', 'warn', 'Введи brief');
        return;
      }
      var payload = {
        brand: 'dreamcar',
        platform: sc.querySelector('#hq_ai_platform').value,
        brief: brief,
        title: pub && pub.title || '',
        tone: sc.querySelector('#hq_ai_tone').value,
        length: sc.querySelector('#hq_ai_length').value,
      };
      btn.disabled = true;
      btn.innerHTML = '<span class="hq-ai-spin"></span> Генерую…';
      try {
        var data = await callAi(payload);
        var container = sc.querySelector('#hq_ai_result_container');
        container.innerHTML =
          '<div class="hq-ai-result">' +
            '<div class="body">' + escapeHtml(data.text) + '</div>' +
            (data.hashtags && data.hashtags.length ? '<div class="tags">' + data.hashtags.map(escapeHtml).join(' ') + '</div>' : '') +
            (data.cta ? '<div class="tags" style="color:var(--gold);">CTA: ' + escapeHtml(data.cta) + '</div>' : '') +
            '<div class="meta">' + data.model + ' · in:' + data.tokens_in + ' / out:' + data.tokens_out + '</div>' +
            '<div class="actions">' +
              '<button class="btn" id="hq_ai_regen">↻ Регенерувати</button>' +
              '<button class="btn btn-primary" id="hq_ai_apply">✓ Вставити у поле</button>' +
            '</div>' +
          '</div>';
        btn.disabled = false;
        btn.textContent = '✨ Згенерувати';

        container.querySelector('#hq_ai_regen').onclick = function () { sc.querySelector('#hq_ai_go').click(); };
        container.querySelector('#hq_ai_apply').onclick = function () {
          insertIntoCard(data);
          sc.remove();
        };
      } catch (e) {
        if (typeof toast === 'function') toast('AI помилка', 'error', String(e.message || e));
        btn.disabled = false;
        btn.textContent = '✨ Згенерувати';
      }
    };
  }

  function insertIntoCard(aiData) {
    var textArea = document.getElementById('f_text');
    if (textArea) {
      var combined = aiData.text;
      if (aiData.hashtags && aiData.hashtags.length) {
        combined += '\n\n' + aiData.hashtags.join(' ');
      }
      textArea.value = combined;
      textArea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    var tagsInput = document.getElementById('f_hashtags');
    if (tagsInput && aiData.hashtags && aiData.hashtags.length) {
      tagsInput.value = aiData.hashtags.map(function (t) { return String(t).replace(/^#/, ''); }).join(', ');
      tagsInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (typeof toast === 'function') toast('AI', 'success', 'Текст вставлено в поле');
  }

  // #296: defensive button binding — unique ID, dual onclick+addEventListener,
  // re-injection if label was recreated, console.log for debug, body delegation fallback.
  function bindAiHandler(btn) {
    var handler = function (e) {
      console.log('[#296 hq-ai-btn click]', e && e.type);
      if (e) { e.preventDefault(); e.stopPropagation(); }
      try { showModal(getPubFromCard()); } catch (err) {
        console.error('[#296 AI showModal err]', err);
        if (typeof toast === 'function') toast('AI', 'error', String(err.message || err));
      }
    };
    btn.onclick = handler;
    btn.addEventListener('click', handler);
    btn.__hqAiBound = true;
  }

  function injectButton() {
    var textArea = document.getElementById('f_text');
    if (!textArea) return;
    var fieldEl = textArea.closest('.field');
    var label = fieldEl && fieldEl.querySelector('label');
    if (!label) return;
    var existing = label.querySelector('#hq_ai_btn');
    if (existing) {
      if (!existing.__hqAiBound) bindAiHandler(existing);
      return;
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'hq_ai_btn';
    btn.className = 'hq-ai-btn';
    btn.innerHTML = '✨ AI';
    btn.title = 'Згенерувати текст за допомогою Claude';
    bindAiHandler(btn);
    label.appendChild(btn);
  }

  var observer = new MutationObserver(function () {
    if (document.getElementById('f_text')) injectButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  [400, 1500, 3500].forEach(function (ms) { setTimeout(injectButton, ms); });

  // #296: ultimate fallback — body-level delegated click handler.
  // Catches click on .hq-ai-btn або #hq_ai_btn навіть якщо onclick десь обнулено.
  if (!window.__hqAiDelegated) {
    window.__hqAiDelegated = true;
    document.body.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('#hq_ai_btn, .hq-ai-btn');
      if (!btn) return;
      if (btn.__hqAiHandledAt && (Date.now() - btn.__hqAiHandledAt) < 500) return;
      btn.__hqAiHandledAt = Date.now();
      console.log('[#296 hq-ai-btn delegated click]');
      e.preventDefault();
      e.stopPropagation();
      try { showModal(getPubFromCard()); } catch (err) { console.error(err); }
    }, false);
  }

  console.log('%cDreamCar HQ AI Copy %c· Claude assistant wired (DreamCar-only)', 'color:#8b5cf6;font-weight:700;', 'color:#888;');
})();
