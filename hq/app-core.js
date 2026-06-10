/* ====================================================================
   DreamCar HQ — Стіл SMM (Пілот)
   MVP як SPA: HTML + ванільний JS + localStorage
   Архітектура: hash-router → views (Calendar/Board/Library/Launches)
                Store wrapper над localStorage
                Seed-дані при першому старті
   ==================================================================== */

const PLATFORMS = [
  { id: 'ig', name: 'Instagram', icon: '📷', color: '#E1306C' },
  { id: 'tg', name: 'Telegram', icon: '✈️', color: '#0088cc' },
  { id: 'tt', name: 'TikTok', icon: '🎵', color: '#fe2c55' },
  { id: 'th', name: 'Threads', icon: '🧵', color: '#888' },
  { id: 'yt', name: 'YT Shorts', icon: '▶️', color: '#ff0000' },
  { id: 'fb', name: 'Facebook', icon: '📘', color: '#1877f2' },
];
const PLATFORM_BY_ID = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));

const STATUSES = [
  { id: 'draft', label: 'Чернетка', color: 'var(--grey)' },
  { id: 'in_work', label: 'В роботі', color: 'var(--blue)' },
  { id: 'review', label: 'На погодженні', color: 'var(--gold)' },
  { id: 'approved', label: 'Погоджено', color: 'var(--green-soft)' },
  { id: 'published', label: 'Опубліковано', color: 'var(--green)' },
  { id: 'rework', label: 'На доопрацюванні', color: 'var(--orange)' },
];
const STATUS_BY_ID = Object.fromEntries(STATUSES.map(s => [s.id, s]));

const CONTENT_TYPES = ['Пост', 'Reels', 'Сторис', 'Карусель', 'Лонгрід'];
const ROLES = [
  { id: 'ceo',    label: 'CEO',         tag: 'CEO' },
  { id: 'coo',    label: 'COO',         tag: 'COO' },
  { id: 'lead',   label: 'Тимлід SMM',  tag: 'Тимлід' },
  { id: 'member', label: 'SMM-учасник', tag: 'Учасник' },
];

/* ============ Store (hybrid: Supabase + localStorage) ============
   - SYNC reads: from in-memory cache (_data)
   - ASYNC writes: optimistic to cache + persist to backend
   - Realtime: backend pushes updates → re-render
   Mode is determined by window.HQ_BACKEND flag (set in <head> loader).
   ===================================================================== */
const STORE_KEY = 'dreamcar_hq_v1';
let BACKEND_MODE = false;          // set after init()
let SUPABASE_USER_ID = null;        // auth.uid()

const Store = {
  _data: null,
  _subscriptions: [],

  async init() {
    BACKEND_MODE = !!window.HQ_BACKEND && !!SUPABASE_USER_ID;
    if (BACKEND_MODE) {
      await this._loadFromBackend();
      this._subscribeRealtime();
    } else {
      // Demo mode: localStorage with seed
      this._loadFromLocal();
    }
  },

  _loadFromLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      this._data = raw ? JSON.parse(raw) : null;
    } catch(e) { this._data = null; }
    if (!this._data) { this._data = SEED(); this._saveLocal(); }
  },
  _saveLocal() {
    if (BACKEND_MODE) return; // not used in backend mode
    localStorage.setItem(STORE_KEY, JSON.stringify(this._data));
  },

  async _loadFromBackend() {
    const sb = window.supabase;
    // Fetch all in parallel
    const [users, rubrics, launches, creatives, pubs, platforms, resp, apr, crePubs, comments, history] = await Promise.all([
      sb.from('users').select('*'),
      sb.from('rubrics').select('*').order('sort_order'),
      sb.from('launches').select('*').eq('is_active', true),
      sb.from('creatives').select('*').is('deleted_at', null).order('uploaded_at', { ascending: false }),
      sb.from('publications').select('*').order('publish_at'),
      sb.from('publication_platforms').select('*'),
      sb.from('publication_responsibles').select('*'),
      sb.from('publication_approvers').select('*'),
      sb.from('creative_publications').select('*'),
      sb.from('comments').select('*').is('deleted_at', null).order('created_at'),
      sb.from('publication_history').select('*').order('at'),
    ]);
    // Map publications with nested arrays (frontend shape compatible with old JS)
    const platformsByPub = groupBy(platforms.data, 'publication_id');
    const respByPub = groupBy(resp.data, 'publication_id');
    const aprByPub = groupBy(apr.data, 'publication_id');
    const crByPub = groupBy(crePubs.data, 'publication_id');
    const commentsByPub = groupBy(comments.data, 'publication_id');
    const historyByPub = groupBy(history.data, 'publication_id');

    const mappedPubs = (pubs.data || []).map(p => ({
      id: p.id,
      title: p.title,
      dateTime: p.publish_at,
      contentType: contentTypeFromDb(p.content_type),
      text: p.text_body,
      hashtags: p.hashtags || [],
      rubric: p.rubric_id,
      launch: p.launch_id,
      workStatus: p.work_status || '',
      status: p.status,
      approverPolicy: p.approver_policy,
      deadline: p.deadline_on,
      platforms: (platformsByPub[p.id] || []).map(x => x.platform),
      responsibles: (respByPub[p.id] || []).map(x => x.user_id),
      approvers: (aprByPub[p.id] || []).map(x => x.user_id),
      creatives: (crByPub[p.id] || []).sort((a,b)=>a.sort_order-b.sort_order).map(x => x.creative_id),
      comments: (commentsByPub[p.id] || []).map(c => ({ id: c.id, at: c.created_at, author: c.author_id, body: c.body })),
      history: (historyByPub[p.id] || []).map(h => ({ id: h.id, at: h.at, author: h.actor_id, action: h.action, detail: h.detail })),
      createdAt: p.created_at,
      updatedAt: p.updated_at,
      // #233.7 TG Autopost v2 fields
      tg_buttons: p.tg_buttons || [],
      tg_pin: p.tg_pin || false,
      tg_silent: p.tg_silent || false,
      tg_disable_preview: p.tg_disable_preview || false,
      tg_channel_id: p.tg_channel_id || null,
      tg_countdown_until: p.tg_countdown_until || null,
      tg_message_id: p.tg_message_id || null,
      tg_published_channel_id: p.tg_published_channel_id || null,
      tg_test_log: p.tg_test_log || [],
    }));

    this._data = {
      version: 1,
      currentUserId: (users.data || []).find(u => u.auth_id === SUPABASE_USER_ID)?.id || null,
      users:    (users.data || []).map(u => ({ ...u, is_active: u.is_active !== false })),
      rubrics:  rubrics.data || [],
      launches: (launches.data || []).map(l => ({ id: l.id, name: l.name, from: l.starts_on, to: l.ends_on, color: l.color })),
      creatives: (creatives.data || []).map(c => ({
        id: c.id, name: c.name, type: c.type,
        size: humanSize(c.size_bytes), duration: c.duration_sec,
        res: c.width_px && c.height_px ? `${c.width_px}×${c.height_px}` : '—',
        tags: c.tags || [], uploadedBy: c.uploaded_by, uploadedAt: c.uploaded_at,
        preview: previewFor(c.type), color: previewColor(c.type),
        // 09.06.2026 #209a: thumbnail_url/compressed_url були відсутні у Store.creative(id)
        // → overview-modal crRow() показував emoji-fallback замість реальної картинки.
        // Давид: "Не отображают креативи".
        thumbnail_url: c.thumbnail_url,
        compressed_url: c.compressed_url,
        compressed_url_hevc: c.compressed_url_hevc,
        drive_file_id: c.drive_file_id,
        compressed_status: c.compressed_status,
      })),
      publications: mappedPubs,
    };
  },

  _subscribeRealtime() {
    const sb = window.supabase;
    const chan = sb.channel('hq-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'publications' }, () => this._refreshAfterChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'publication_history' }, () => this._refreshAfterChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => this._refreshAfterChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'publication_platforms' }, () => this._refreshAfterChange())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'creatives' }, () => this._refreshAfterChange())
      .subscribe();
    this._subscriptions.push(chan);
  },

  async _refreshAfterChange() {
    // Debounce: коли купа змін летить разом, перезавантажуємо раз.
    // 1500ms - щоб дочекати поки серія запитів (upsert+delete+insert relations)
    // повністю завершиться, тоді один _loadFromBackend замість 5-7 пар.
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(async () => {
      // Не реrender під час відкритої модалки картки (auto-save в процесі)
      if (document.getElementById('modalBackdrop')?.classList.contains('open')) return;
      await this._loadFromBackend();
      if (typeof navigate === 'function') {
        navigate();
        renderSidebarFilters?.();
      }
    }, 1500);
  },

  reset() {
    if (BACKEND_MODE) {
      toast('Reset недоступний у backend-режимі', 'warn', 'Видаляй через Supabase Dashboard.');
      return;
    }
    localStorage.removeItem(STORE_KEY); this._data = null; this._loadFromLocal();
  },
  data() { return this._data; },

  // ---- Sync reads (з кешу) ----
  pubs() { return this._data?.publications || []; },
  pub(id) { return this._data?.publications.find(p => p.id === id); },
  creatives() { return this._data?.creatives || []; },
  creative(id) { return this._data?.creatives.find(c => c.id === id); },

  // #297 (10.06.2026): Forced fresh fetch для конкретних creatives — патчимо Store cache.
  // Потрібно тому що _refreshAfterChange skip-ається коли modal open (рядок ~173).
  // Викликається з openCard() щоб гарантувати свіжі thumbnail_url/compressed_url
  // навіть якщо compress worker дописав їх у DB після того як юзер відкрив modal.
  // Returns Promise<boolean> — true якщо хоч одне поле змінилось у cache.
  async refreshCreatives(ids) {
    if (!BACKEND_MODE || !window.supabase || !Array.isArray(ids) || ids.length === 0) return false;
    try {
      const { data, error } = await window.supabase
        .from('creatives')
        .select('id, thumbnail_url, compressed_url, compressed_url_hevc, compressed_status, drive_file_id, width_px, height_px, size_bytes, duration_sec, name, type')
        .in('id', ids)
        .is('deleted_at', null);
      if (error) { console.warn('[refreshCreatives]', error); return false; }
      if (!Array.isArray(data) || !data.length) return false;
      let changed = false;
      const cache = this._data?.creatives || [];
      data.forEach(fresh => {
        const c = cache.find(x => x.id === fresh.id);
        if (!c) return;
        // Тільки thumb/compress поля + базові — НЕ перезаписуємо обчислені (size human, res, color, preview).
        const fields = ['thumbnail_url', 'compressed_url', 'compressed_url_hevc', 'compressed_status', 'drive_file_id', 'name', 'type', 'width_px', 'height_px'];
        fields.forEach(f => {
          if (fresh[f] !== undefined && fresh[f] !== c[f]) {
            c[f] = fresh[f];
            changed = true;
          }
        });
        // Перерахунок res якщо width/height оновились
        if (fresh.width_px && fresh.height_px) c.res = `${fresh.width_px}×${fresh.height_px}`;
      });
      return changed;
    } catch (e) { console.warn('[refreshCreatives] exception', e); return false; }
  },
  users() { return this._data?.users || []; },
  // У backend-режимі — тільки ті хто реально залогінився (мають auth_id) + поточний користувач.
  // У demo-режимі — всі seed-юзери для тестування.
  activeUsers() {
    const all = this._data?.users || [];
    if (!BACKEND_MODE) return all.filter(u => u.is_active !== false);
    const meId = this._data?.currentUserId;
    return all.filter(u => u.is_active !== false && (u.auth_id || u.id === meId));
  },
  user(id) { return this._data?.users.find(u => u.id === id); },
  rubrics() { return this._data?.rubrics || []; },
  launches() { return this._data?.launches || []; },
  currentUser() { return this.user(this._data?.currentUserId); },

  setCurrentUser(id) {
    if (BACKEND_MODE) {
      toast('Перемикач ролей працює лише в demo-режимі', 'warn');
      return;
    }
    this._data.currentUserId = id;
    this._saveLocal();
  },

  // ---- Async writes (optimistic + persist; returns Promise) ----
  upsertPub(pub) {
    // Optimistic cache update
    const ix = this._data.publications.findIndex(p => p.id === pub.id);
    if (ix >= 0) this._data.publications[ix] = pub;
    else this._data.publications.push(pub);

    if (BACKEND_MODE) {
      return this._persistPub(pub).catch(err => {
        // 05.06.2026: розширена діагностика — toast + alert щоб user точно побачив
        console.error('[persistPub] Persist failed:', err);
        console.error('[persistPub] Pub data:', { id: pub.id, title: pub.title, rubric_id: pub.rubric, status: pub.status });
        var detail = err.message || err.code || 'мережа';
        var hint = '';
        if (err.code === '23503') hint = ' (FK constraint — невалідний rubric/launch/desk)';
        else if (err.code === '42501') hint = ' (RLS блокує — auth_id/desk_members)';
        else if (err.code === '23505') hint = ' (duplicate id)';
        toast('Помилка збереження: ' + detail + hint, 'error');
        alert('⚠ Публікація НЕ збережена!\n\nПомилка: ' + detail + hint + '\n\nДеталі у консолі (F12). Скрін → Вадиму.');
        throw err;
      });
    } else {
      this._saveLocal();
      return Promise.resolve();
    }
  },

  async _persistPub(pub) {
    const sb = window.supabase;
    // 05.06.2026: pre-validation — pub.id має бути валідний UUID
    var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!pub.id || !uuidRe.test(pub.id)) {
      console.error('[persistPub] невалідний pub.id:', pub.id);
      throw new Error('Невалідний UUID публікації: ' + pub.id);
    }
    // 09.06.2026 #206: BEFORE trigger publications_check_platforms_before_status кидає
    // якщо status переходить у review/approved/published а у publication_platforms 0 рядків.
    // Раніше upsert(...status=review) виконувався ДО insert platforms → trigger fail → решта операцій не виконувалися.
    // Тепер: спочатку upsert БЕЗ зміни status (зберігаємо existing), потім insert platforms, потім UPDATE status.
    const targetStatus = pub.status || 'draft';
    const existing = this.pub(pub.id);
    const safeStatus = (existing && existing.status) ? existing.status : 'draft';

    // 1. main row — БЕЗ зміни статусу (тримаємо safeStatus поки не вставимо platforms)
    const row = {
      id: pub.id,
      desk_id: '11111111-1111-1111-1111-111111111111',
      title: pub.title || 'Untitled',
      publish_at: pub.dateTime,
      content_type: contentTypeToDb(pub.contentType),
      text_body: pub.text || '',
      hashtags: pub.hashtags || [],
      rubric_id: pub.rubric || null,
      launch_id: pub.launch || null,
      work_status: pub.workStatus || null,
      status: safeStatus,
      approver_policy: pub.approverPolicy || 'all',
      deadline_on: pub.deadline || null,
      created_by: this._data.currentUserId,
      // #233.7 TG Autopost v2 persistence
      tg_buttons: Array.isArray(pub.tg_buttons) ? pub.tg_buttons : [],
      tg_pin: !!pub.tg_pin,
      tg_silent: !!pub.tg_silent,
      tg_disable_preview: !!pub.tg_disable_preview,
      tg_channel_id: pub.tg_channel_id || null,
      tg_countdown_until: pub.tg_countdown_until || null,
    };
    const { error: e1 } = await sb.from('publications').upsert(row);
    if (e1) throw e1;

    // 2. platforms ПЕРШИМИ — trigger перевіряє цю таблицю при transition.
    // 09.06.2026 #207 fix: pkey = (publication_id, platform); race-condition при double-click save
    // або дублікати у pub.platforms array → unique violation. Використовуємо upsert з onConflict
    // + dedupe через Set. upsert ідемпотентний — повторні saves не падають.
    const uniqPlatforms = [...new Set((pub.platforms || []).filter(Boolean))];
    await sb.from('publication_platforms').delete().eq('publication_id', pub.id);
    if (uniqPlatforms.length) {
      const { error: ep } = await sb.from('publication_platforms').upsert(
        uniqPlatforms.map(p => ({ publication_id: pub.id, platform: p })),
        { onConflict: 'publication_id,platform', ignoreDuplicates: true }
      );
      if (ep) throw ep;
    }

    // 3. ТЕПЕР безпечно змінити status (trigger знайде platforms)
    if (targetStatus !== safeStatus) {
      const { error: es } = await sb.from('publications').update({ status: targetStatus }).eq('id', pub.id);
      if (es) throw es;
    }

    // 4. решта relations (також dedupe + upsert де є composite pkey)
    const uniqResp = [...new Set((pub.responsibles || []).filter(Boolean))];
    await sb.from('publication_responsibles').delete().eq('publication_id', pub.id);
    if (uniqResp.length) {
      await sb.from('publication_responsibles').upsert(
        uniqResp.map(u => ({ publication_id: pub.id, user_id: u, role: 'generic' })),
        { onConflict: 'publication_id,user_id', ignoreDuplicates: true }
      );
    }
    const uniqAppr = [...new Set((pub.approvers || []).filter(Boolean))];
    await sb.from('publication_approvers').delete().eq('publication_id', pub.id);
    if (uniqAppr.length) {
      await sb.from('publication_approvers').upsert(
        uniqAppr.map(u => ({ publication_id: pub.id, user_id: u })),
        { onConflict: 'publication_id,user_id', ignoreDuplicates: true }
      );
    }
    const uniqCreatives = [...new Set((pub.creatives || []).filter(Boolean))];
    await sb.from('creative_publications').delete().eq('publication_id', pub.id);
    if (uniqCreatives.length) {
      await sb.from('creative_publications').upsert(
        uniqCreatives.map((c, i) => ({ publication_id: pub.id, creative_id: c, sort_order: i })),
        { onConflict: 'publication_id,creative_id', ignoreDuplicates: true }
      );
    }
  },

  deletePub(id) {
    this._data.publications = this._data.publications.filter(p => p.id !== id);
    if (BACKEND_MODE) {
      window.supabase.from('publications').delete().eq('id', id).then(({ error }) => {
        if (error) { console.error(error); toast('Помилка видалення', 'error'); }
      });
    } else {
      this._saveLocal();
    }
  },

  // History (append-only; returns Promise)
  addHistory(pubId, action, detail = '') {
    const pub = this.pub(pubId);
    if (!pub) return Promise.resolve();
    if (!pub.history) pub.history = [];
    const entry = {
      id: uid(),
      at: new Date().toISOString(),
      author: this._data.currentUserId,
      action,
      detail
    };
    pub.history.push(entry);
    if (BACKEND_MODE) {
      return window.supabase.from('publication_history').insert({
        publication_id: pubId,
        actor_id: this._data.currentUserId,
        action,
        detail: detail || null,
      }).then(({ error }) => {
        if (error) { console.error('History insert:', error); throw error; }
      });
    } else {
      this._saveLocal();
      return Promise.resolve();
    }
  },

  // Comments (returns Promise)
  addComment(pubId, body) {
    const pub = this.pub(pubId);
    if (!pub) return Promise.resolve();
    if (!pub.comments) pub.comments = [];
    const c = {
      id: uid(),
      at: new Date().toISOString(),
      author: this._data.currentUserId,
      body
    };
    pub.comments.push(c);
    if (BACKEND_MODE) {
      return window.supabase.from('comments').insert({
        publication_id: pubId,
        author_id: this._data.currentUserId,
        body,
      }).then(({ error }) => {
        if (error) { console.error('Comment insert:', error); throw error; }
      });
    } else {
      this._saveLocal();
      return Promise.resolve();
    }
  },
};

/* Helpers */
function groupBy(arr, key) {
  const m = {};
  for (const x of arr || []) { (m[x[key]] = m[x[key]] || []).push(x); }
  return m;
}
function humanSize(bytes) {
  if (!bytes) return '—';
  const k = 1024; const u = ['B','KB','MB','GB'];
  let i = 0; let n = bytes;
  while (n >= k && i < u.length-1) { n /= k; i++; }
  return `${n.toFixed(n>=10?0:1)} ${u[i]}`;
}
function previewFor(t) { return { photo: '🖼️', video: '🎬', doc: '📄', audio: '🎵' }[t] || '📦'; }
function previewColor(t) { return { photo: '#ff6577', video: '#7ab0ff', doc: '#888', audio: '#fbbf24' }[t] || '#888'; }
function contentTypeToDb(t) {
  return { 'Пост':'post', 'Reels':'reels', 'Сторис':'stories', 'Карусель':'carousel', 'Лонгрід':'longread' }[t] || 'post';
}
function contentTypeFromDb(t) {
  return { post:'Пост', reels:'Reels', stories:'Сторис', carousel:'Карусель', longread:'Лонгрід' }[t] || t;
}

function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

/* ============ Storage abstraction ============
   На MVP: Supabase Storage bucket "creatives".
   У майбутньому: додати driver 'r2' (Cloudflare) — заміна без зміни callsite.
   У demo-режимі: вшиваємо DataURL у локальний creative (працює оффлайн).
   ===================================================================== */
const STORAGE_BUCKET = 'creatives';
async function storageUpload(file, pub) {
  if (!BACKEND_MODE) {
    // demo: read as DataURL і вшити в creative.preview
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    return { url: dataUrl, path: file.name };
  }
  const sb = window.supabase;
  const ext = (file.name.split('.').pop() || '').toLowerCase().slice(0, 8) || 'bin';
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(key, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) {
    // Якщо bucket не існує — дамо корисний hint
    if (/bucket/i.test(error.message)) {
      throw new Error(`Створи bucket "${STORAGE_BUCKET}" у Supabase Storage (Public). Помилка: ${error.message}`);
    }
    throw error;
  }
  const { data: pub2 } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(key);
  return { url: pub2?.publicUrl || '', path: key };
}

async function uploadCreativeFile(file, pub) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) {
    toast('Файл великий (>50 MB)', 'warn', 'Скоро додам прямий upload у R2/Drive для великих файлів.');
    if (file.size > 100 * 1024 * 1024) return;
  }
  const t = inferCreativeType(file);
  toast('Завантажую…', 'info', file.name);

  // #295: inline progress placeholder у f_creatives strip — користувач БАЧИТЬ що upload іде
  const tempId = 'uploading_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const strip = document.getElementById('f_creatives');
  let progressItem = null;
  if (strip) {
    progressItem = document.createElement('div');
    progressItem.className = 'cs-item uploading';
    progressItem.dataset.tempId = tempId;
    progressItem.style.cssText = 'position:relative;overflow:hidden;background:linear-gradient(135deg,#1a1a1a,#2a2a2a);border:2px dashed rgba(122,176,255,0.5);';
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    const typeIcon = t === 'video' ? '🎬' : t === 'photo' ? '🖼' : '📄';
    progressItem.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#7ab0ff;font-size:9px;text-align:center;padding:4px;gap:3px;">
      <span style="font-size:22px;animation:spin 1.5s linear infinite;">⏳</span>
      <div style="font-size:10px;font-weight:600;">${typeIcon} Завантажую</div>
      <div style="opacity:0.8;font-size:8px;line-height:1.2;word-break:break-all;">${(file.name||'').slice(0,18)}</div>
      <div class="upl-progress" style="font-size:8px;color:#7ab0ff;">${sizeMb}МБ</div>
    </div>`;
    const addBtn = document.getElementById('addCreativeBtn');
    if (addBtn) strip.insertBefore(progressItem, addBtn);
    else strip.appendChild(progressItem);
  }
  const removeProgressItem = () => { if (progressItem && progressItem.parentNode) progressItem.parentNode.removeChild(progressItem); };

  try {
    const up = await storageUpload(file, pub);
    // Створюємо метаданий запис
    const creative = await createCreativeRecord({
      name: file.name,
      type: t,
      size_bytes: file.size,
      mime: file.type || '',
      url: up.url,
      storage_path: up.path,
    });
    if (!creative) { removeProgressItem(); return; }
    // Додаємо у pub.creatives і робимо autosave
    pub.creatives = [...(pub.creatives || []), creative.id];

    // #295: REPLACE progress item на real preview з thumbnail (а не emoji)
    const stripEl = document.getElementById('f_creatives');
    if (stripEl) {
      const c = Store.creative(creative.id);
      if (c) {
        const item = document.createElement('div');
        item.className = 'cs-item';
        item.dataset.id = creative.id;
        item.title = c.name;
        item.style.cssText = 'position:relative;overflow:hidden;';
        const thumb = c.thumbnail_url || c.url || '';
        const isVid = c.type === 'video';
        // Для video — поки compress=pending — animated placeholder. Інакше показуємо тhumbnail.
        const compressStatus = (c.compressed_status || 'ready').toLowerCase();
        const isPending = isVid && compressStatus !== 'ready' && compressStatus !== 'failed';
        let inner;
        if (isPending) {
          inner = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:linear-gradient(135deg,#1a1a1a,#2a2a2a);color:#888;font-size:10px;text-align:center;padding:6px;gap:4px;">
            <span style="font-size:24px;animation:spin 2s linear infinite;">⚙</span>
            <span>обробка відео</span>
          </div>`;
        } else if (thumb) {
          inner = `<img src="${thumb}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:6px;">${isVid ? '<span style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;font-size:9px;padding:2px 4px;border-radius:3px;">▶ VIDEO</span>' : ''}`;
        } else {
          inner = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:28px;color:#666;">${isVid ? '🎬' : '🖼'}</div>`;
        }
        item.innerHTML = `${inner}<div class="cs-remove" data-remove="${creative.id}">×</div>`;
        item.querySelector('.cs-remove').onclick = (e) => {
          e.stopPropagation();
          pub.creatives = pub.creatives.filter(x => x !== creative.id);
          item.remove();
          autosave(pub);
        };
        // Replace progress item or append before addCreativeBtn
        if (progressItem && progressItem.parentNode === stripEl) {
          stripEl.replaceChild(item, progressItem);
          progressItem = null;
        } else {
          stripEl.insertBefore(item, document.getElementById('addCreativeBtn'));
        }

        // #295: Poll DB для оновлення тhumbnail коли compress закінчиться (video)
        if (isPending && creative.id) {
          let polls = 0;
          const pollId = setInterval(async () => {
            polls++;
            if (polls > 60) { clearInterval(pollId); return; } // 60×5s = 5 хв max
            try {
              const { data: fresh } = await window.supabase.from('creatives')
                .select('compressed_status, thumbnail_url, compressed_url')
                .eq('id', creative.id).maybeSingle();
              if (fresh && (fresh.compressed_status === 'ready' || fresh.compressed_status === 'failed')) {
                clearInterval(pollId);
                // Update local cache
                const cached = Store.creative(creative.id);
                if (cached) Object.assign(cached, fresh);
                // Replace UI item з real thumbnail
                if (item.parentNode) {
                  const newThumb = fresh.thumbnail_url || fresh.compressed_url || '';
                  if (newThumb && fresh.compressed_status === 'ready') {
                    item.querySelector('div[style*="background:linear"]')?.remove();
                    const img = document.createElement('img');
                    img.src = newThumb;
                    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;border-radius:6px;';
                    img.loading = 'lazy';
                    item.insertBefore(img, item.firstChild);
                    if (isVid) {
                      const badge = document.createElement('span');
                      badge.style.cssText = 'position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;font-size:9px;padding:2px 4px;border-radius:3px;';
                      badge.textContent = '▶ VIDEO';
                      item.appendChild(badge);
                    }
                  }
                }
              }
            } catch (e) { console.warn('[poll compress]', e); }
          }, 5000);
        }
      }
    }
    refreshPreview(pub);
    autosave(pub);
    toast('Готово', 'success', file.name);
  } catch (e) {
    console.error('upload failed:', e);
    removeProgressItem();
    toast('Помилка завантаження', 'error', e.message || file.name);
  }
}

function inferCreativeType(file) {
  if ((file.type || '').startsWith('image/')) return 'photo';
  if ((file.type || '').startsWith('video/')) return 'video';
  if ((file.type || '').startsWith('audio/')) return 'audio';
  return 'doc';
}

async function createCreativeRecord(meta) {
  // 07.06.2026 FIX (Олександр "фото не грузит"): public.creatives.id тип UUID з default uuid_generate_v4().
  // Раніше передавали 'cr_xxx' (text) → invalid input syntax for type uuid → INSERT fail silent (toast не показувався у деяких випадках).
  // Тепер не передаємо id — БД сама згенерує. localId — тимчасовий для optimistic cache, потім замінюється на справжній UUID.
  const localId = 'tmp_' + uid();
  const previewMap = { photo: '🖼️', video: '🎬', doc: '📄', audio: '🎵' };
  const colorMap   = { photo: '#ff6577', video: '#7ab0ff', doc: '#888', audio: '#fbbf24' };
  const local = {
    id: localId,
    name: meta.name,
    type: meta.type,
    size: humanSize(meta.size_bytes),
    duration: null,
    res: '—',
    tags: [],
    uploadedBy: Store.currentUser().id,
    uploadedAt: new Date().toISOString(),
    preview: previewMap[meta.type] || '📦',
    color: colorMap[meta.type] || '#888',
    url: meta.url,
  };
  // optimistic cache
  Store._data.creatives.unshift(local);

  if (!BACKEND_MODE) {
    Store._saveLocal();
    return local;
  }
  const sb = window.supabase;
  const { data, error } = await sb.from('creatives').insert({
    // id НЕ передаємо — Postgres default uuid_generate_v4()
    desk_id: '11111111-1111-1111-1111-111111111111',
    name: meta.name,
    type: meta.type,
    size_bytes: meta.size_bytes,
    drive_file_id: meta.storage_path,
    thumbnail_url: meta.url,
    tags: [],
    uploaded_by: Store.currentUser().id,
  }).select().single();
  if (error) {
    console.error('creatives insert:', error);
    toast('Не зберіг у БД', 'error', error.message);
    // rollback кеш
    Store._data.creatives = Store._data.creatives.filter(c => c.id !== localId);
    throw error;
  }
  // Replace tmp_ id з реальним UUID з БД
  local.id = data.id;
  return local;
}

/* ============ Seed ============ */
function SEED() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const userIds = {
    vadym: 'u_vadym', danil: 'u_danil', oleksandra: 'u_oleks', artem: 'u_artem', vira: 'u_vira',
  };
  const users = [
    { id: userIds.vadym,      name: 'Вадим',       role: 'ceo',    email: 'vg@dreamcar.ua',    initial: 'В' },
    { id: userIds.danil,      name: 'Даніл',       role: 'coo',    email: 'danil@dreamcar.ua', initial: 'Д' },
    { id: userIds.oleksandra, name: 'Олександра',  role: 'lead',   email: 'sasha@dreamcar.ua', initial: 'О' },
    { id: userIds.artem,      name: 'Артем',       role: 'member', email: 'artem@dreamcar.ua',initial: 'А' },
    { id: userIds.vira,       name: 'Віра',        role: 'member', email: 'vira@dreamcar.ua', initial: 'В' },
  ];
  const rubrics = [
    { id: 'r_sales',   name: 'Продажний',   color: '#ff6577' },
    { id: 'r_expert',  name: 'Експертний',  color: '#7ab0ff' },
    { id: 'r_fun',     name: 'Розважальний', color: '#fbbf24' },
    { id: 'r_news',    name: 'Новинний',    color: '#6ee7b7' },
    { id: 'r_partner', name: 'Партнерський', color: '#c89af0' },
  ];
  const launches = [
    { id: 'l_audi',  name: 'AUDI E-TRON 2026', from: addDays(today, -10).toISOString().slice(0,10), to: addDays(today, 35).toISOString().slice(0,10), color: '#ff6577' },
    { id: 'l_bmw',   name: 'BMW X5 Hybrid #17',from: addDays(today, -28).toISOString().slice(0,10),to: addDays(today, 14).toISOString().slice(0,10), color: '#7ab0ff' },
    { id: 'l_brand', name: 'Bren brand-кампанія',from: addDays(today, 5).toISOString().slice(0,10), to: addDays(today, 50).toISOString().slice(0,10), color: '#fbbf24' },
  ];
  const creatives = [
    { id: 'cr1', name: 'Audi-etron-front.jpg',   type: 'photo', size: '4.2 MB', duration: null, res: '4032×3024', tags: ['audi','etron','front'], uploadedBy: userIds.artem,  uploadedAt: addDays(today,-3).toISOString(), preview: '🚗', color: '#ff6577' },
    { id: 'cr2', name: 'Audi-test-drive.mp4',    type: 'video', size: '128 MB',  duration: 47,   res: '1080×1920', tags: ['audi','reels','drive'], uploadedBy: userIds.artem,  uploadedAt: addDays(today,-2).toISOString(), preview: '🎬', color: '#7ab0ff' },
    { id: 'cr3', name: 'BMW-winner-story.mp4',   type: 'video', size: '210 MB',  duration: 89,   res: '1080×1920', tags: ['bmw','x5','winner'], uploadedBy: userIds.artem,    uploadedAt: addDays(today,-5).toISOString(), preview: '🏆', color: '#fbbf24' },
    { id: 'cr4', name: 'Tech-vacuum-process.mp4',type: 'video', size: '85 MB',   duration: 32,   res: '1920×1080', tags: ['tech','process','behind'], uploadedBy: userIds.artem, uploadedAt: addDays(today,-7).toISOString(), preview: '🏭', color: '#6ee7b7' },
    { id: 'cr5', name: 'Team-photo-spring.jpg',  type: 'photo', size: '2.8 MB',  duration: null, res: '3024×4032', tags: ['team','spring','office'], uploadedBy: userIds.oleksandra, uploadedAt: addDays(today,-8).toISOString(), preview: '👥', color: '#c89af0' },
    { id: 'cr6', name: 'Static-promo-bf.png',    type: 'photo', size: '0.9 MB',  duration: null, res: '1080×1080', tags: ['promo','bf','design'], uploadedBy: userIds.oleksandra,uploadedAt: addDays(today,-1).toISOString(), preview: '🎁', color: '#ff6577' },
    { id: 'cr7', name: 'Carousel-1-numbers.png', type: 'photo', size: '0.7 MB',  duration: null, res: '1080×1350', tags: ['carousel','stats','infographic'], uploadedBy: userIds.oleksandra, uploadedAt: addDays(today,-4).toISOString(), preview: '📊', color: '#7ab0ff' },
    { id: 'cr8', name: 'Funny-bts-fail.mp4',     type: 'video', size: '54 MB',   duration: 22,   res: '1080×1920', tags: ['fun','bts','fail'], uploadedBy: userIds.artem,         uploadedAt: addDays(today,-2).toISOString(), preview: '😂', color: '#fbbf24' },
    { id: 'cr9', name: 'TZ-onboarding.pdf',      type: 'doc',   size: '1.2 MB',  duration: null, res: '—',         tags: ['doc','onboarding'], uploadedBy: userIds.oleksandra,    uploadedAt: addDays(today,-12).toISOString(), preview: '📄', color: '#888' },
    { id: 'cr10', name: 'BMW-handover-emotion.jpg',type:'photo',size:'5.6 MB',   duration: null, res: '4032×3024', tags: ['bmw','winner','emotion'], uploadedBy: userIds.artem,    uploadedAt: addDays(today,-6).toISOString(), preview: '🥹', color: '#ff6577' },
    { id: 'cr11', name: 'YT-shorts-teaser.mp4',  type:'video',  size: '38 MB',   duration: 18,   res: '1080×1920', tags: ['yt','shorts','teaser'], uploadedBy: userIds.artem,      uploadedAt: addDays(today,-1).toISOString(), preview: '⚡', color: '#6ee7b7' },
    { id: 'cr12', name: 'Wallpaper-audi-night.jpg',type:'photo',size:'7.1 MB',   duration: null, res: '4032×6048', tags: ['audi','wallpaper','night'], uploadedBy: userIds.artem,   uploadedAt: addDays(today,-9).toISOString(), preview: '🌃', color: '#c89af0' },
  ];

  // Build 25 publications across the month around today
  const pubs = [];
  const titles = [
    { t:'Audi E-tron — перші тест-драйви від нашої команди', type:'Reels', plats:['ig','tt','yt'], rub:'r_expert', launch:'l_audi', cr:['cr2'] },
    { t:'BMW X5 #17 — момент передачі ключів',                type:'Reels', plats:['ig','tt'],     rub:'r_sales',  launch:'l_bmw',  cr:['cr3','cr10'] },
    { t:'5 фактів про мікрохвильово-вакуумну сушку',         type:'Карусель', plats:['ig'],       rub:'r_expert', launch:null,     cr:['cr7'] },
    { t:'BTS — як народжуються відео для проєкту',           type:'Reels', plats:['ig','tt'],     rub:'r_fun',    launch:null,     cr:['cr8'] },
    { t:'Анонс Audi E-tron — старт продажу токенів',         type:'Пост', plats:['ig','tg','fb'], rub:'r_sales',  launch:'l_audi', cr:['cr1','cr6'] },
    { t:'Команда DreamCar — весна 2026',                     type:'Карусель', plats:['ig','fb'], rub:'r_news',   launch:null,     cr:['cr5'] },
    { t:'Як працює технологія сушки знизу до верху',         type:'Лонгрід',  plats:['fb','tg'], rub:'r_expert', launch:null,     cr:[] },
    { t:'Emotion-shot — Олександр та його перша BMW',        type:'Reels', plats:['ig','tt','yt'],rub:'r_sales', launch:'l_bmw',  cr:['cr10'] },
    { t:'Промо: Black Friday для учасників',                 type:'Пост',  plats:['ig','tg','fb'], rub:'r_sales', launch:null,    cr:['cr6'] },
    { t:'Wallpaper Wednesday — Audi нічний',                 type:'Сторис', plats:['ig'],         rub:'r_fun',    launch:'l_audi', cr:['cr12'] },
    { t:'YT Shorts teaser — наступне авто',                  type:'Reels', plats:['yt','ig'],     rub:'r_sales',  launch:null,     cr:['cr11'] },
    { t:'Партнерство з McLaren-сервісом',                    type:'Пост',  plats:['ig','fb','tg'], rub:'r_partner', launch:null,   cr:['cr1'] },
    { t:'Інтерв\'ю з власником Audi #5',                     type:'Reels', plats:['ig','yt'],     rub:'r_news',   launch:'l_audi', cr:['cr2'] },
    { t:'Дайджест тижня: що відбувалося',                    type:'Карусель', plats:['ig','tg'], rub:'r_news',   launch:null,     cr:[] },
    { t:'Mythbusting — частые питання про токени',           type:'Reels', plats:['ig','tt'],     rub:'r_expert', launch:null,     cr:[] },
    { t:'Behind the scene — як ми знімаємо Reels',           type:'Сторис', plats:['ig'],         rub:'r_fun',    launch:null,     cr:['cr8'] },
    { t:'AUDI E-TRON — фінальний countdown',                 type:'Пост',  plats:['ig','tg','fb'], rub:'r_sales', launch:'l_audi', cr:['cr1'] },
    { t:'Розпаковка — приходить нове авто на склад',         type:'Reels', plats:['ig','tt','yt'],rub:'r_fun',    launch:'l_brand',cr:[] },
    { t:'Команда зростає — нова вакансія SMM',               type:'Пост',  plats:['ig','tg','th'], rub:'r_news',  launch:null,     cr:['cr5'] },
    { t:'Тест-драйв новачка — Олексій про Audi',             type:'Reels', plats:['yt','ig'],     rub:'r_sales',  launch:'l_audi', cr:['cr2'] },
    { t:'Технологічна екскурсія заводом',                    type:'Reels', plats:['ig','tt'],     rub:'r_expert', launch:null,     cr:['cr4'] },
    { t:'Stories-серія Q&A',                                 type:'Сторис', plats:['ig'],         rub:'r_fun',    launch:null,     cr:[] },
    { t:'Заглушка — нічого важливого',                       type:'Пост',  plats:['ig'],          rub:'r_fun',    launch:null,     cr:[] },
    { t:'Black Friday — фінальна заявка',                    type:'Пост',  plats:['ig','tg','fb'], rub:'r_sales', launch:null,     cr:['cr6'] },
    { t:'Підсумок місяця — цифри і перемоги',                type:'Карусель', plats:['ig','tg'], rub:'r_news',   launch:'l_brand',cr:['cr7','cr5'] },
  ];
  const offsets = [-12, -10, -9, -8, -7, -6, -5, -5, -4, -3, -2, -1, 0, 0, 1, 1, 2, 3, 4, 5, 6, 7, 9, 12, 14];
  const statusPlan = ['published','published','published','published','published','published','published','rework','published','published','published','review','review','review','in_work','approved','in_work','in_work','draft','draft','draft','draft','draft','draft','draft'];

  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    const offset = offsets[i];
    const dt = addDays(today, offset);
    dt.setHours(11 + (i % 8), [0,15,30,45][i % 4], 0, 0);
    const status = statusPlan[i] || 'draft';
    const respId = [userIds.artem, userIds.oleksandra, userIds.vira][i % 3];
    pubs.push({
      id: 'p_' + uid(),
      title: t.t,
      dateTime: dt.toISOString(),
      platforms: t.plats,
      rubric: t.rub,
      contentType: t.type,
      text: 'Текст для публікації «' + t.t + '».\n\n— Лід-абзац який чіпляє увагу.\n— Розкриття теми, з деталями та конкретикою.\n— Заклик до дії: переходь, забирай, дізнайся.\n\n#dreamcar #автомрії',
      hashtags: ['#dreamcar', '#автомрії', '#' + t.rub.slice(2)],
      creatives: t.cr,
      responsibles: [respId],
      deadline: addDays(dt, -2).toISOString().slice(0,10),
      approvers: [userIds.vadym],
      approverPolicy: 'all',
      status,
      launch: t.launch,
      comments: [],
      history: [
        { id: uid(), at: addDays(dt, -5).toISOString(), author: respId, action: 'create', detail: '' }
      ],
      createdAt: addDays(dt, -5).toISOString(),
      updatedAt: addDays(dt, -1).toISOString(),
    });
  }

  if (pubs[11]) {
    pubs[11].comments = [{ id: uid(), at: new Date().toISOString(), author: userIds.vadym, body: 'Чудовий ракурс, тільки текст переробіть: третій абзац здається зайвим.' }];
    pubs[11].status = 'rework';
  }

  return {
    version: 1,
    currentUserId: userIds.vadym,
    users, rubrics, launches, creatives,
    publications: pubs,
  };
}

function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

/* ============ App state (in-memory) ============ */
// 08.06.2026 Mobile fix: default до 'list' на mobile (≤480px) — agenda view зручніший
// на phone ніж 7-col grid з 42px клітинками. Localstorage memorize choice.
function _defaultCalMode() {
  try {
    const saved = localStorage.getItem('dc.calMode');
    if (saved) return saved;
  } catch (e) {}
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(max-width: 480px)').matches) return 'list';
  }
  return 'month';
}
const App = {
  view: 'calendar',
  calendarMode: _defaultCalMode(),
  calendarDate: new Date(),
  filters: { statuses: new Set(), platforms: new Set() },
  selectedPubs: new Set(),
  searchQuery: '',
};

/* ============ Toast ============ */
function toast(msg, kind = 'success', body = '') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `<b>${escapeHtml(msg)}</b>${body ? '<div class="toast-body">'+escapeHtml(body)+'</div>' : ''}`;
  stack.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; el.style.transition = 'all 0.3s'; }, 3000);
  setTimeout(() => el.remove(), 3400);
}

/* ============ Modal ============ */
const Modal = {
  open(html, size = '') {
    const bd = document.getElementById('modalBackdrop');
    const m = document.getElementById('modal');
    m.className = 'modal' + (size ? ' ' + size : '');
    m.innerHTML = html;
    bd.classList.add('open');
    bd.onclick = (e) => { if (e.target === bd) this.close(); };
    document.addEventListener('keydown', this._esc);
  },
  close() {
    document.getElementById('modalBackdrop').classList.remove('open');
    document.removeEventListener('keydown', this._esc);
    if (this.onClose) { this.onClose(); this.onClose = null; }
  },
  _esc: function(e) { if (e.key === 'Escape') Modal.close(); },
};

/* ============ Router ============ */
function parseHash() {
  const h = (location.hash || '#calendar').slice(1);
  const [route, ...args] = h.split('/');
  return { route, args };
}
function navigate() {
  const { route, args } = parseHash();
  App.view = route;
  document.querySelectorAll('.sidebar a.nav-item').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  const main = document.getElementById('main');
  const bc = document.getElementById('breadcrumb');
  if (route === 'calendar') { bc.innerHTML = 'Стіл SMM · <b>Календар</b>'; renderCalendar(main); }
  else if (route === 'board') { bc.innerHTML = 'Стіл SMM · <b>Дошка погоджень</b>'; renderBoard(main); }
  else if (route === 'library') { bc.innerHTML = 'Стіл SMM · <b>Бібліотека креативів</b>'; renderLibrary(main); }
  else if (route === 'launches') { bc.innerHTML = 'Стіл SMM · <b>Запуски</b>'; renderLaunches(main); }
  else if (route === 'publication' && args[0]) { openCard(args[0]); }
  else { bc.innerHTML = 'Стіл SMM · <b>Календар</b>'; renderCalendar(main); }
  updateNavCounts();
}
window.addEventListener('hashchange', navigate);

/* ============ Nav counts ============ */
function updateNavCounts() {
  const me = Store.currentUser();
  const pubs = Store.pubs();
  document.getElementById('navCntCalendar').textContent = pubs.length;
  const board = pubs.filter(p => p.status === 'review' && (p.approvers || []).includes(me.id)).length;
  document.getElementById('navCntBoard').textContent = board;
  document.getElementById('navCntLibrary').textContent = Store.creatives().length;
  document.getElementById('navCntLaunches').textContent = Store.launches().length;
}

/* ============ Sidebar filters ============ */
function renderSidebarFilters() {
  const fs = document.getElementById('filterStatus');
  fs.innerHTML = STATUSES.map(s => {
    const cnt = Store.pubs().filter(p => p.status === s.id).length;
    const on = App.filters.statuses.has(s.id);
    return `<div class="filter-chip ${on ? 'on' : ''}" data-status="${s.id}">
      <span class="swatch sw-${s.id}"></span><span>${s.label}</span><span class="cnt">${cnt}</span></div>`;
  }).join('');
  fs.querySelectorAll('.filter-chip').forEach(el => {
    el.onclick = () => {
      const s = el.dataset.status;
      if (App.filters.statuses.has(s)) App.filters.statuses.delete(s);
      else App.filters.statuses.add(s);
      renderSidebarFilters();
      navigate();
    };
  });
  const fp = document.getElementById('filterPlatform');
  fp.innerHTML = PLATFORMS.map(p => {
    const cnt = Store.pubs().filter(pub => pub.platforms.includes(p.id)).length;
    const on = App.filters.platforms.has(p.id);
    return `<div class="filter-chip ${on ? 'on' : ''}" data-platform="${p.id}">
      <span class="swatch" style="background:${p.color}"></span><span>${p.name}</span><span class="cnt">${cnt}</span></div>`;
  }).join('');
  fp.querySelectorAll('.filter-chip').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.platform;
      if (App.filters.platforms.has(id)) App.filters.platforms.delete(id);
      else App.filters.platforms.add(id);
      renderSidebarFilters();
      navigate();
    };
  });
}

/* ============ Apply filters ============ */
function filteredPubs() {
  let pubs = Store.pubs();
  if (App.filters.statuses.size > 0) pubs = pubs.filter(p => App.filters.statuses.has(p.status));
  if (App.filters.platforms.size > 0) pubs = pubs.filter(p => p.platforms.some(pl => App.filters.platforms.has(pl)));
  if (App.searchQuery) {
    const q = App.searchQuery.toLowerCase();
    pubs = pubs.filter(p => (p.title + ' ' + (p.text||'') + ' ' + (p.hashtags||[]).join(' ')).toLowerCase().includes(q));
  }
  return pubs;
}

/* ============ Helpers ============ */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
}
function fmtDate(d, opts = {}) {
  const dt = (d instanceof Date) ? d : new Date(d);
  const dd = String(dt.getDate()).padStart(2,'0');
  const mm = String(dt.getMonth()+1).padStart(2,'0');
  const yyyy = dt.getFullYear();
  if (opts.short) return `${dd}.${mm}`;
  if (opts.long)  return dt.toLocaleDateString('uk-UA', { day:'numeric', month:'long', year:'numeric' });
  return `${dd}.${mm}.${yyyy}`;
}
function fmtTime(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  return String(dt.getHours()).padStart(2,'0') + ':' + String(dt.getMinutes()).padStart(2,'0');
}
function fmtDateTime(d) { return fmtDate(d) + ' ' + fmtTime(d); }
function daysBetween(a, b) {
  const A = new Date(a); A.setHours(0,0,0,0);
  const B = new Date(b); B.setHours(0,0,0,0);
  return Math.round((B - A) / 86400000);
}
function urgencyClass(pub) {
  const dt = new Date(pub.dateTime);
  const today = new Date(); today.setHours(0,0,0,0);
  const dl = new Date(dt); dl.setHours(0,0,0,0);
  const diff = (dl - today) / 86400000;
  if (pub.status === 'published') return '';
  if (diff < 0) return 'missed';
  if (diff <= 1 && pub.status !== 'approved') return 'urgent-red';
  if (diff <= 3 && pub.status !== 'approved') return 'urgent-yellow';
  return '';
}
const PLATFORM_ORDER = ['ig','tg','tt','th','yt','fb'];
function sortPlatforms(ids) {
  return [...new Set(ids || [])].sort((a, b) => PLATFORM_ORDER.indexOf(a) - PLATFORM_ORDER.indexOf(b));
}
function platformIcons(ids) {
  return '<span class="platform-icons">' + sortPlatforms(ids).map(id => PLATFORM_BY_ID[id]?.icon || '').join('') + '</span>';
}
function renderPlatformFilterButtons() {
  const allOn = App.filters.platforms.size === 0;
  let html = `<button class="pf-btn ${allOn ? 'on' : ''}" data-platform="all">Всі <span class="pf-cnt">${Store.pubs().length}</span></button>`;
  for (const id of PLATFORM_ORDER) {
    const p = PLATFORM_BY_ID[id];
    const on = App.filters.platforms.has(id);
    const cnt = Store.pubs().filter(pub => pub.platforms.includes(id)).length;
    html += `<button class="pf-btn ${on ? 'on' : ''}" data-platform="${id}">${p.icon} ${escapeHtml(p.name)} <span class="pf-cnt">${cnt}</span></button>`;
  }
  return html;
}
function attachPlatformFilterHandlers() {
  const wrap = document.getElementById('platformFilter');
  if (!wrap) return;
  wrap.querySelectorAll('.pf-btn').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.platform;
      if (id === 'all') {
        App.filters.platforms.clear();
      } else {
        const hadOnlyThis = App.filters.platforms.size === 1 && App.filters.platforms.has(id);
        App.filters.platforms.clear();
        if (!hadOnlyThis) App.filters.platforms.add(id);
      }
      wrap.innerHTML = renderPlatformFilterButtons();
      attachPlatformFilterHandlers();
      renderSidebarFilters?.();
      renderCalBody();
    };
  });
}

/* ============ Avatar ============ */
function avatarHtml(userId, size = 22) {
  const u = Store.user(userId);
  if (!u) return '';
  return `<span class="avatar" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:linear-gradient(135deg,#E30613,#ff6577);font-size:${Math.round(size*0.45)}px;font-weight:700;color:#fff">${u.initial}</span>`;
}

/* ============ CALENDAR ============ */
function renderCalendar(root) {
  const me = Store.currentUser();
  root.innerHTML = `
    <div class="view-header">
      <h1>Календар публікацій</h1>
      <span class="view-meta" id="calMeta"></span>
      <div class="actions">
        <div class="segmented" id="modeSwitch">
          <button class="btn-segmented ${App.calendarMode==='month'?'on':''}" data-mode="month">Місяць</button>
          <button class="btn-segmented ${App.calendarMode==='week'?'on':''}" data-mode="week">Тиждень</button>
          <button class="btn-segmented ${App.calendarMode==='day'?'on':''}" data-mode="day">День</button>
          <button class="btn-segmented ${App.calendarMode==='list'?'on':''}" data-mode="list">Список</button>
        </div>
        <button class="btn btn-primary" id="addPubBtn">+ Нова публікація</button>
      </div>
    </div>
    <div class="calendar-wrap">
      <div class="calendar-controls">
        <div class="cal-nav">
          <button id="prevBtn">‹</button>
          <div class="month-label" id="monthLabel"></div>
          <button id="nextBtn">›</button>
          <button id="todayBtn" style="margin-left:8px;width:auto;padding:0 12px;font-size:12px;">Сьогодні</button>
        </div>
      </div>
      <div class="platform-filter" id="platformFilter">${renderPlatformFilterButtons()}</div>
      <div id="calBody"></div>
    </div>
  `;
  document.getElementById('addPubBtn').onclick = () => createPub(App.calendarDate);
  document.getElementById('prevBtn').onclick = () => navCal(-1);
  document.getElementById('nextBtn').onclick = () => navCal(1);
  document.getElementById('todayBtn').onclick = () => { App.calendarDate = new Date(); renderCalendar(document.getElementById('main')); };
  document.querySelectorAll('#modeSwitch .btn-segmented').forEach(b => {
    b.onclick = () => {
      App.calendarMode = b.dataset.mode;
      try { localStorage.setItem('dc.calMode', App.calendarMode); } catch(e) {}
      App.selectedPubs.clear();
      renderCalendar(document.getElementById('main'));
    };
  });
  attachPlatformFilterHandlers();

  renderCalBody();
}
function navCal(delta) {
  if (App.calendarMode === 'month') {
    App.calendarDate = new Date(App.calendarDate.getFullYear(), App.calendarDate.getMonth() + delta, 1);
  } else if (App.calendarMode === 'week') {
    App.calendarDate = addDays(App.calendarDate, delta * 7);
  } else if (App.calendarMode === 'day') {
    App.calendarDate = addDays(App.calendarDate, delta);
  }
  renderCalBody();
}
function renderCalBody() {
  const body = document.getElementById('calBody');
  const meta = document.getElementById('calMeta');
  const label = document.getElementById('monthLabel');
  const pubs = filteredPubs();

  if (App.calendarMode === 'month') {
    const d = App.calendarDate;
    label.textContent = d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
    meta.textContent = `· ${pubs.length} публікацій`;
    body.innerHTML = renderMonth(d, pubs);
    attachCalendarHandlers();
  } else if (App.calendarMode === 'week') {
    const start = startOfWeek(App.calendarDate);
    const end = addDays(start, 6);
    label.textContent = `${fmtDate(start, {short:true})} — ${fmtDate(end, {short:true})}`;
    meta.textContent = '';
    body.innerHTML = renderWeek(start, pubs);
    attachWeekHandlers();
  } else if (App.calendarMode === 'day') {
    label.textContent = fmtDate(App.calendarDate, {long:true});
    meta.textContent = '';
    body.innerHTML = renderDay(App.calendarDate, pubs);
    attachWeekHandlers();
  } else if (App.calendarMode === 'list') {
    label.textContent = 'Усі публікації';
    meta.textContent = `· ${pubs.length} рядків`;
    body.innerHTML = renderList(pubs);
    attachListHandlers();
  }
}
function startOfWeek(d) {
  const x = new Date(d);
  const dayOfWeek = x.getDay() === 0 ? 7 : x.getDay();
  x.setDate(x.getDate() - (dayOfWeek - 1));
  x.setHours(0,0,0,0);
  return x;
}
function renderMonth(d, pubs) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = startOfWeek(first);
  const today = new Date(); today.setHours(0,0,0,0);
  const weekdays = ['ПН','ВТ','СР','ЧТ','ПТ','СБ','НД'];
  let html = '<div class="calendar-grid">';
  for (const w of weekdays) html += `<div class="cal-weekday">${w}</div>`;
  for (let i = 0; i < 42; i++) {
    const day = addDays(start, i);
    const isOther = day.getMonth() !== d.getMonth();
    const isToday = day.getTime() === today.getTime();
    const dayPubs = pubs.filter(p => sameDate(p.dateTime, day)).sort((a,b)=> new Date(a.dateTime) - new Date(b.dateTime));
    const cards = dayPubs.slice(0,3).map(p => `
      <div class="cal-card s-${p.status} ${urgencyClass(p)}" draggable="true" data-id="${p.id}" title="${escapeHtml(p.title)}">
        ${p.contentType ? `<div class="ctype-badge">${escapeHtml((p.contentType || 'ПОСТ').toUpperCase())}</div>` : ''}
        <span class="time">${fmtTime(p.dateTime)}</span>
        ${platformIcons(p.platforms)}
        <span class="title">${escapeHtml(p.title)}</span>
      </div>
    `).join('');
    const more = dayPubs.length > 3 ? `<span class="more" data-date="${day.toISOString().slice(0,10)}">+${dayPubs.length-3} ще</span>` : '';
    html += `<div class="cal-day ${isOther?'other-month':''} ${isToday?'today':''}" data-date="${day.toISOString().slice(0,10)}">
      <div class="day-num">${day.getDate()}</div>${cards}${more}</div>`;
  }
  html += '</div>';
  return html;
}
function sameDate(a, b) {
  const A = new Date(a), B = new Date(b);
  return A.getFullYear() === B.getFullYear() && A.getMonth() === B.getMonth() && A.getDate() === B.getDate();
}
function attachCalendarHandlers() {
  document.querySelectorAll('.cal-day').forEach(el => {
    el.onclick = (e) => {
      if (e.target.classList.contains('cal-card') || e.target.closest('.cal-card')) return;
      if (e.target.classList.contains('more')) return;
      createPub(new Date(el.dataset.date + 'T12:00:00'));
    };
    el.ondragover = (e) => { e.preventDefault(); el.classList.add('drop-over'); };
    el.ondragleave = () => el.classList.remove('drop-over');
    el.ondrop = (e) => {
      e.preventDefault();
      el.classList.remove('drop-over');
      const pid = e.dataTransfer.getData('text/plain');
      const p = Store.pub(pid);
      if (!p) return;
      const oldDate = fmtDate(p.dateTime);
      const newDt = new Date(el.dataset.date + 'T' + fmtTime(p.dateTime) + ':00');
      p.dateTime = newDt.toISOString();
      p.updatedAt = new Date().toISOString();
      Store.upsertPub(p);
      Store.addHistory(p.id, 'move', `${oldDate} → ${fmtDate(newDt)}`);
      toast('Перенесено', 'success', `${p.title} → ${fmtDate(newDt)}`);
      renderCalBody();
    };
  });
  document.querySelectorAll('.cal-card[draggable]').forEach(el => {
    el.ondragstart = (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.id);
      el.classList.add('dragging');
    };
    el.ondragend = () => el.classList.remove('dragging');
    el.onclick = (e) => { e.stopPropagation(); location.hash = '#publication/' + el.dataset.id; };
  });
  document.querySelectorAll('.more').forEach(el => {
    el.onclick = (e) => {
      e.stopPropagation();
      App.calendarMode = 'day';
      App.calendarDate = new Date(el.dataset.date);
      renderCalendar(document.getElementById('main'));
    };
  });
}

function renderWeek(start, pubs) {
  const today = new Date(); today.setHours(0,0,0,0);
  const dayNames = ['ПОН','ВІВ','СЕР','ЧЕТ','П\'ЯТ','СУБ','НЕД'];
  let html = '<div class="week-grid">';
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i);
    const isToday = day.getTime() === today.getTime();
    const dayPubs = pubs.filter(p => sameDate(p.dateTime, day)).sort((a,b)=> new Date(a.dateTime) - new Date(b.dateTime));
    const cards = dayPubs.map(p => `
      <div class="week-card s-${p.status}" data-id="${p.id}">
        ${p.contentType ? `<div class="wc-ctype-badge">${escapeHtml((p.contentType || 'ПОСТ').toUpperCase())}</div>` : ''}
        <div class="wc-time">${fmtTime(p.dateTime)}</div>
        <div class="wc-title">${escapeHtml(p.title)}</div>
        <div class="wc-meta">${platformIcons(p.platforms)} · <span class="status ${p.status}" style="font-size:8px;padding:1px 5px;">${STATUS_BY_ID[p.status].label}</span></div>
      </div>
    `).join('');
    html += `<div class="week-col" data-date="${day.toISOString().slice(0,10)}">
      <div class="col-head ${isToday?'today':''}">
        <div class="day-num">${day.getDate()}</div>
        <div class="day-name">${dayNames[i]}</div>
      </div>${cards || '<div style="color:var(--grey-2);font-size:11px;padding:8px 0;">—</div>'}</div>`;
  }
  html += '</div>';
  return html;
}
function renderDay(date, pubs) {
  const day = new Date(date); day.setHours(0,0,0,0);
  const dayPubs = pubs.filter(p => sameDate(p.dateTime, day)).sort((a,b)=> new Date(a.dateTime) - new Date(b.dateTime));
  if (!dayPubs.length) return '<div class="empty"><div class="empty-icon">📅</div><div class="empty-title">Жодної публікації на цей день</div><div>Натисни «+ Нова публікація» щоб створити</div></div>';
  return '<div style="display:grid;gap:10px;">' + dayPubs.map(p => `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-left:4px solid;border-left-color:${STATUS_BY_ID[p.status].color};border-radius:10px;padding:18px 22px;cursor:pointer;" data-id="${p.id}" class="week-card">
      <div style="display:flex;gap:18px;align-items:flex-start;">
        <div style="text-align:center;min-width:60px;">
          <div style="font-size:22px;font-weight:800;color:#fff;">${fmtTime(p.dateTime)}</div>
          <div style="font-size:10px;color:var(--grey);text-transform:uppercase;letter-spacing:1px;">${p.contentType}</div>
        </div>
        <div style="flex:1;">
          <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:6px;">${escapeHtml(p.title)}</div>
          <div style="font-size:12px;color:var(--grey);margin-bottom:8px;">${platformIcons(p.platforms)} ${p.platforms.map(id=>PLATFORM_BY_ID[id]?.name||id).join(' · ')}</div>
          <div style="font-size:12px;color:#aaa;line-height:1.5;">${escapeHtml((p.text||'').slice(0,180))}…</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">
          <span class="status ${p.status}">${STATUS_BY_ID[p.status].label}</span>
          <span style="font-size:11px;color:var(--grey);">Відп.: ${(p.responsibles||[]).map(id=>Store.user(id)?.name).filter(Boolean).join(', ')||'—'}</span>
        </div>
      </div>
    </div>
  `).join('') + '</div>';
}
function attachWeekHandlers() {
  document.querySelectorAll('.week-card').forEach(el => {
    el.onclick = () => { if (el.dataset.id) location.hash = '#publication/' + el.dataset.id; };
  });
}

function renderList(pubs) {
  pubs = pubs.slice().sort((a,b)=> new Date(a.dateTime) - new Date(b.dateTime));
  let rows = pubs.map(p => {
    const r = Store.rubrics().find(x=>x.id===p.rubric);
    const respNames = (p.responsibles||[]).map(id=>Store.user(id)?.name).filter(Boolean).join(', ') || '—';
    return `<tr data-id="${p.id}" class="${App.selectedPubs.has(p.id)?'selected':''}">
      <td class="col-check"><input type="checkbox" data-pub="${p.id}" ${App.selectedPubs.has(p.id)?'checked':''}/></td>
      <td>${fmtDateTime(p.dateTime)}</td>
      <td><div class="pub-title">${escapeHtml(p.title)}</div><div class="pub-meta">${p.contentType}</div></td>
      <td>${platformIcons(p.platforms)} <small style="color:var(--grey)">${p.platforms.join(' · ')}</small></td>
      <td>${r?'<span style="color:'+r.color+'">●</span> '+escapeHtml(r.name):'—'}</td>
      <td>${escapeHtml(respNames)}</td>
      <td><span class="status ${p.status}">${STATUS_BY_ID[p.status].label}</span></td>
      <td>${(p.creatives||[]).length>0?'✓':'—'}</td>
    </tr>`;
  }).join('');
  return `<table class="list-table">
    <thead>
      <tr>
        <th class="col-check"><input type="checkbox" id="selAll"/></th>
        <th>Дата і час</th>
        <th>Назва</th>
        <th>Майданчики</th>
        <th>Рубрика</th>
        <th>Відповідальний</th>
        <th>Статус</th>
        <th>Медіа</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:var(--grey);padding:40px;">Нічого не знайдено</td></tr>'}</tbody>
  </table>
  <div class="bulk-bar ${App.selectedPubs.size>0?'shown':''}" id="bulkBar">
    <div class="bb-count">Вибрано: ${App.selectedPubs.size}</div>
    <div class="bb-actions">
      <button class="btn btn-sm" id="bulkShift">Перенести (днів)</button>
      <button class="btn btn-sm" id="bulkRubric">Змінити рубрику</button>
      <button class="btn btn-sm btn-danger" id="bulkDelete">Видалити</button>
      <button class="btn btn-sm" id="bulkClear">Зняти виділення</button>
    </div>
  </div>`;
}
function attachListHandlers() {
  document.querySelectorAll('.list-table tbody tr').forEach(tr => {
    tr.onclick = (e) => {
      if (e.target.type === 'checkbox') return;
      location.hash = '#publication/' + tr.dataset.id;
    };
  });
  document.querySelectorAll('input[type=checkbox][data-pub]').forEach(cb => {
    cb.onclick = (e) => {
      e.stopPropagation();
      if (cb.checked) App.selectedPubs.add(cb.dataset.pub);
      else App.selectedPubs.delete(cb.dataset.pub);
      cb.closest('tr').classList.toggle('selected', cb.checked);
      document.getElementById('bulkBar').classList.toggle('shown', App.selectedPubs.size > 0);
      document.querySelector('#bulkBar .bb-count').textContent = `Вибрано: ${App.selectedPubs.size}`;
    };
  });
  const selAll = document.getElementById('selAll');
  if (selAll) selAll.onclick = () => {
    if (selAll.checked) filteredPubs().forEach(p => App.selectedPubs.add(p.id));
    else App.selectedPubs.clear();
    renderCalBody();
  };
  const bulkShift = document.getElementById('bulkShift');
  if (bulkShift) bulkShift.onclick = () => {
    const n = parseInt(prompt('Перенести на скільки днів? (+ вперед, − назад)', '7'), 10);
    if (!n) return;
    for (const id of App.selectedPubs) {
      const p = Store.pub(id); if (!p) continue;
      const d = new Date(p.dateTime); d.setDate(d.getDate() + n);
      p.dateTime = d.toISOString();
      Store.upsertPub(p);
      Store.addHistory(id, 'move', `Bulk shift ${n}d`);
    }
    toast(`Перенесено ${App.selectedPubs.size} публікацій`, 'success');
    App.selectedPubs.clear();
    renderCalBody();
  };
  const bulkDelete = document.getElementById('bulkDelete');
  if (bulkDelete) bulkDelete.onclick = () => {
    if (!confirm(`Видалити ${App.selectedPubs.size} публікацій? Це необоротно.`)) return;
    for (const id of App.selectedPubs) Store.deletePub(id);
    toast(`Видалено ${App.selectedPubs.size}`, 'warn');
    App.selectedPubs.clear();
    renderCalBody();
    updateNavCounts();
    renderSidebarFilters();
  };
  const bulkRubric = document.getElementById('bulkRubric');
  if (bulkRubric) bulkRubric.onclick = () => {
    const options = Store.rubrics().map(r => r.id + ' — ' + r.name).join('\n');
    const v = prompt('Введи ID нової рубрики:\n' + options, 'r_news');
    if (!v) return;
    if (!Store.rubrics().find(r=>r.id===v)) { toast('Невідомий ID', 'error'); return; }
    for (const id of App.selectedPubs) {
      const p = Store.pub(id); if (!p) continue;
      p.rubric = v;
      Store.upsertPub(p);
    }
    toast(`Змінено рубрику для ${App.selectedPubs.size}`, 'success');
    App.selectedPubs.clear();
    renderCalBody();
  };
  const bulkClear = document.getElementById('bulkClear');
  if (bulkClear) bulkClear.onclick = () => { App.selectedPubs.clear(); renderCalBody(); };
}
