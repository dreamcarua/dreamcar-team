// =====================================================================
// app-compress-admin.js — Admin dashboard для compress queue
// =====================================================================
// Інтегрується у HQ як секція "Compress Queue".
// Показує: pending / processing / ready / failed creatives
// Дії: Re-compress (reset до pending), View error log, Refresh.
//
// Підвантажується після app-core.js і app-views.js.
// Доступ: CEO/COO/lead тільки.
// =====================================================================

(function() {
  'use strict';

  const REFRESH_INTERVAL_MS = 15_000; // 15s autorefresh

  function isAdminRole() {
    const me = window.HQ_STATE?.currentUser;
    if (!me) return false;
    return ['ceo', 'coo', 'lead'].includes(me.role);
  }

  async function fetchCreativesQueue() {
    const cfg = window.HQ_CONFIG;
    if (!cfg) return [];
    const sb = window.HQ_supabase;
    if (!sb) return [];
    // Тягнемо ВСІ video-creatives для повного огляду
    const { data, error } = await sb
      .from('creatives')
      .select('id, name, type, size_bytes, thumbnail_url, compressed_url, compressed_url_hevc, compressed_status, compressed_size_bytes, compressed_hevc_size_bytes, compressed_at, compress_attempts, compress_error, compress_started_at, uploaded_at, uploaded_by')
      .eq('type', 'video')
      .is('deleted_at', null)
      .order('uploaded_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('[compress-admin] fetch error', error);
      return [];
    }
    return data || [];
  }

  function fmtSize(b) {
    if (!b) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
    return (b / 1024 / 1024).toFixed(1) + ' MB';
  }

  function fmtAgo(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const sec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (sec < 60) return sec + 's';
    if (sec < 3600) return Math.floor(sec / 60) + 'm';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h';
    return Math.floor(sec / 86400) + 'd';
  }

  function statusBadge(st) {
    const colors = {
      'pending':    { bg: '#fef3c7', fg: '#92400e', label: '⏳ Pending' },
      'processing': { bg: '#dbeafe', fg: '#1e40af', label: '⚙ Processing' },
      'ready':      { bg: '#d1fae5', fg: '#065f46', label: '✓ Ready' },
      'failed':     { bg: '#fee2e2', fg: '#991b1b', label: '✕ Failed' },
      'n/a':        { bg: '#f3f4f6', fg: '#6b7280', label: '—' },
    };
    const c = colors[st] || colors['n/a'];
    return `<span style="background:${c.bg};color:${c.fg};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${c.label}</span>`;
  }

  async function reCompress(creId) {
    if (!confirm('Поставити цей креатив на повторне стискання?')) return;
    const sb = window.HQ_supabase;
    const { error } = await sb
      .from('creatives')
      .update({
        compressed_status: 'pending',
        compressed_url: null,
        compressed_size_bytes: null,
        compressed_at: null,
        compress_attempts: 0,
        compress_error: null,
        compress_started_at: null,
      })
      .eq('id', creId);
    if (error) {
      alert('Помилка: ' + error.message);
    } else {
      window.HQ_toast?.('Поставлено у чергу. Cron запустить за ≤3 хв.', 'success');
      await renderQueue();
    }
  }

  async function recompressAll(status) {
    if (!confirm(`Поставити ВСІ "${status}" креативи на повторне стискання?`)) return;
    const sb = window.HQ_supabase;
    const { error } = await sb
      .from('creatives')
      .update({
        compressed_status: 'pending',
        compressed_url: null,
        compressed_size_bytes: null,
        compressed_at: null,
        compress_attempts: 0,
        compress_error: null,
        compress_started_at: null,
      })
      .eq('compressed_status', status)
      .eq('type', 'video')
      .is('deleted_at', null);
    if (error) {
      alert('Помилка: ' + error.message);
    } else {
      window.HQ_toast?.('Готово. Cron запустить за ≤3 хв.', 'success');
      await renderQueue();
    }
  }

  function rowHtml(c) {
    const sz = fmtSize(c.size_bytes);
    const compSz = fmtSize(c.compressed_size_bytes);
    const hevcSz = fmtSize(c.compressed_hevc_size_bytes);
    const ratio = c.size_bytes && c.compressed_size_bytes
      ? `(${Math.round(c.compressed_size_bytes / c.size_bytes * 100)}%)`
      : '';
    const error = c.compress_error
      ? `<div style="font-size:11px;color:#b91c1c;margin-top:2px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${c.compress_error.replace(/"/g,'&quot;')}">⚠ ${c.compress_error.slice(0,80)}</div>`
      : '';
    const thumb = c.thumbnail_url
      ? `<img src="${c.thumbnail_url}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;background:#000;" loading="lazy">`
      : '<div style="width:48px;height:48px;background:#e5e7eb;border-radius:4px;"></div>';
    const reCompBtn = `<button onclick="window.HQ_compressAdmin.reCompress('${c.id}')" style="padding:4px 10px;font-size:11px;border:1px solid #d1d5db;background:#fff;border-radius:4px;cursor:pointer;">↻ Перестиснути</button>`;
    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:8px;">${thumb}</td>
        <td style="padding:8px;">
          <div style="font-weight:600;font-size:13px;">${c.name || '—'}</div>
          <div style="font-size:11px;color:#6b7280;">${c.id.slice(0,8)}… · ${fmtAgo(c.uploaded_at)} тому</div>
          ${error}
        </td>
        <td style="padding:8px;text-align:center;">${statusBadge(c.compressed_status)}</td>
        <td style="padding:8px;text-align:center;font-size:12px;">${c.compress_attempts || 0}</td>
        <td style="padding:8px;font-size:12px;">
          <div>Orig: ${sz}</div>
          <div>H.264: ${compSz} ${ratio}</div>
          ${hevcSz !== '—' ? `<div>HEVC: ${hevcSz}</div>` : ''}
        </td>
        <td style="padding:8px;text-align:right;">${reCompBtn}</td>
      </tr>
    `;
  }

  function statsHtml(rows) {
    const counts = { pending: 0, processing: 0, ready: 0, failed: 0 };
    rows.forEach(r => { if (counts[r.compressed_status] !== undefined) counts[r.compressed_status]++; });
    const total = rows.length;
    return `
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <div style="flex:1;background:#fef3c7;padding:12px;border-radius:8px;">
          <div style="font-size:24px;font-weight:700;color:#92400e;">${counts.pending}</div>
          <div style="font-size:12px;color:#92400e;">⏳ Очікують</div>
        </div>
        <div style="flex:1;background:#dbeafe;padding:12px;border-radius:8px;">
          <div style="font-size:24px;font-weight:700;color:#1e40af;">${counts.processing}</div>
          <div style="font-size:12px;color:#1e40af;">⚙ Обробка</div>
        </div>
        <div style="flex:1;background:#d1fae5;padding:12px;border-radius:8px;">
          <div style="font-size:24px;font-weight:700;color:#065f46;">${counts.ready}</div>
          <div style="font-size:12px;color:#065f46;">✓ Готово</div>
        </div>
        <div style="flex:1;background:#fee2e2;padding:12px;border-radius:8px;cursor:${counts.failed>0?'pointer':'default'};"
             ${counts.failed>0?'onclick="window.HQ_compressAdmin.recompressAll(\'failed\')"':''}>
          <div style="font-size:24px;font-weight:700;color:#991b1b;">${counts.failed}</div>
          <div style="font-size:12px;color:#991b1b;">✕ Помилка ${counts.failed>0?'(натисніть щоб повторити все)':''}</div>
        </div>
        <div style="flex:1;background:#f3f4f6;padding:12px;border-radius:8px;">
          <div style="font-size:24px;font-weight:700;color:#374151;">${total}</div>
          <div style="font-size:12px;color:#374151;">Усього відео</div>
        </div>
      </div>
    `;
  }

  async function renderQueue() {
    const container = document.getElementById('hq-compress-queue');
    if (!container) return;
    container.innerHTML = '<div style="padding:20px;color:#6b7280;">Завантаження…</div>';
    const rows = await fetchCreativesQueue();
    container.innerHTML = `
      ${statsHtml(rows)}
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead style="background:#f9fafb;font-size:11px;text-transform:uppercase;color:#6b7280;">
            <tr>
              <th style="padding:8px;text-align:left;">Прев'ю</th>
              <th style="padding:8px;text-align:left;">Назва / ID</th>
              <th style="padding:8px;text-align:center;">Статус</th>
              <th style="padding:8px;text-align:center;">Спроби</th>
              <th style="padding:8px;text-align:left;">Розміри</th>
              <th style="padding:8px;text-align:right;">Дія</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length === 0
              ? '<tr><td colspan="6" style="padding:24px;text-align:center;color:#9ca3af;">Нема відео-креативів</td></tr>'
              : rows.map(rowHtml).join('')
            }
          </tbody>
        </table>
      </div>
      <div style="text-align:right;margin-top:8px;font-size:11px;color:#9ca3af;">
        Авто-оновлення кожні 15с. Стиснення запускається кожні 3 хв. Останнє оновлення: ${new Date().toLocaleTimeString()}
      </div>
    `;
  }

  function ensureSection() {
    // Додаємо menu item у sidebar якщо є HQ_addMenuItem
    if (typeof window.HQ_addMenuItem === 'function' && isAdminRole()) {
      window.HQ_addMenuItem({
        id: 'compress-queue',
        label: '🎬 Черга стиснення',
        section: 'admin',
        onClick: openSection,
      });
    }
    // Слот для відображення
    let section = document.getElementById('hq-section-compress');
    if (!section) {
      section = document.createElement('div');
      section.id = 'hq-section-compress';
      section.style.display = 'none';
      section.style.padding = '20px';
      section.innerHTML = `
        <h2 style="margin:0 0 16px 0;font-size:20px;">🎬 Черга стиснення</h2>
        <div id="hq-compress-queue"></div>
      `;
      document.body.appendChild(section);
    }
  }

  function openSection() {
    if (!isAdminRole()) {
      alert('Доступ тільки для CEO/COO/lead');
      return;
    }
    // Hide intialization placeholders
    document.querySelectorAll('[data-hq-section]').forEach(el => el.style.display = 'none');
    const section = document.getElementById('hq-section-compress');
    if (section) section.style.display = 'block';
    renderQueue();
  }

  // Public API
  window.HQ_compressAdmin = {
    open: openSection,
    refresh: renderQueue,
    reCompress,
    recompressAll,
  };

  // Auto-init після завантаження HQ_STATE
  function tryInit(retries = 20) {
    if (window.HQ_STATE?.currentUser) {
      ensureSection();
      // Auto-refresh while section is visible
      setInterval(() => {
        const section = document.getElementById('hq-section-compress');
        if (section && section.style.display !== 'none') renderQueue();
      }, REFRESH_INTERVAL_MS);
    } else if (retries > 0) {
      setTimeout(() => tryInit(retries - 1), 500);
    }
  }
  tryInit();
})();
