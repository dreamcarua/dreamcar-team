/* ============================================================
   DreamCar HQ — Access Request (G1: §5.1 «Сторінка немає доступу»)
   ============================================================ */
// Якщо Google-юзер залогінився, але йому не призначено record у public.users
// (тригер handle_new_user не спрацював) — показуємо screen «У вас немає доступу»
// з кнопкою «Запросити доступ», який створює запис у access_requests.

(function () {
  if (window.__hqAccessReqLoaded) return;
  window.__hqAccessReqLoaded = true;

  // ---- CSS ----
  (function () {
    if (document.getElementById('hq-ar-css')) return;
    var css = document.createElement('style');
    css.id = 'hq-ar-css';
    css.textContent =
      '.hq-ar-screen { position: fixed; inset: 0; background: linear-gradient(135deg, #0a0a12 0%, #1a0a0a 100%); z-index: 250; display: flex; align-items: center; justify-content: center; padding: 20px; }' +
      '.hq-ar-card { background: var(--bg-2); border: 1px solid var(--border); border-radius: 14px; padding: 32px 32px; max-width: 440px; width: 100%; box-shadow: 0 24px 60px rgba(0,0,0,0.7); text-align: center; }' +
      '.hq-ar-card .hr-icon { width: 56px; height: 56px; background: rgba(204,0,0,0.15); border: 1px solid var(--red); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; margin: 0 auto 16px; }' +
      '.hq-ar-card h2 { font-size: 18px; color: #fff; margin-bottom: 8px; font-weight: 800; }' +
      '.hq-ar-card p { font-size: 13px; color: var(--grey); line-height: 1.6; margin-bottom: 14px; }' +
      '.hq-ar-card .hr-email { font-size: 11px; color: var(--gold); margin-bottom: 18px; word-break: break-all; }' +
      '.hq-ar-card textarea { width: 100%; background: var(--bg); border: 1px solid var(--border); color: #fff; padding: 9px 12px; border-radius: 8px; font-size: 12px; min-height: 60px; resize: vertical; font-family: inherit; margin-bottom: 12px; }' +
      '.hq-ar-card button { width: 100%; padding: 11px; background: var(--red); color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; transition: background 0.15s; margin-bottom: 8px; }' +
      '.hq-ar-card button:hover { background: #e60019; }' +
      '.hq-ar-card button.signout { background: transparent; color: var(--grey); border: 1px solid var(--border); }' +
      '.hq-ar-card button.signout:hover { background: var(--bg-3); color: #fff; }' +
      '.hq-ar-card .hr-success { color: var(--green-soft); font-size: 12px; margin-top: 14px; padding: 10px; background: rgba(74,222,128,0.08); border: 1px solid var(--green); border-radius: 8px; }';
    document.head.appendChild(css);
  })();

  async function checkAccess() {
    if (!window.HQ_BACKEND || !window.supabase) return { allowed: true };
    var sess = await window.supabase.auth.getSession();
    if (!sess.data?.session) return { allowed: true };
    var authId = sess.data.session.user.id;
    var resp = await window.supabase.from('users').select('id, name').eq('auth_id', authId).maybeSingle();
    if (resp.error) {
      console.warn('checkAccess err:', resp.error);
      return { allowed: true };
    }
    if (!resp.data) return { allowed: false, email: sess.data.session.user.email, authId: authId };
    return { allowed: true };
  }

  async function submitRequest(email, authId, comment) {
    if (!window.supabase) return false;
    var resp = await window.supabase.from('access_requests').insert({
      auth_id: authId,
      email: email,
      desk_id: '11111111-1111-1111-1111-111111111111',
      comment: comment || null,
    });
    if (resp.error) {
      console.error('access_requests insert err:', resp.error);
      return false;
    }
    return true;
  }

  function showScreen(email, authId) {
    if (document.querySelector('.hq-ar-screen')) return;
    var sc = document.createElement('div');
    sc.className = 'hq-ar-screen';
    sc.innerHTML =
      '<div class="hq-ar-card">' +
        '<div class="hr-icon">🔒</div>' +
        '<h2>У вас немає доступу до HQ</h2>' +
        '<p>Доступ закритий за whitelist. Запросіть запрошення у керівника або відправте автоматичну заявку нижче.</p>' +
        '<div class="hr-email">Ваш email: <b>' + email + '</b></div>' +
        '<textarea id="hq_ar_comment" placeholder="Кілька слів про себе / роль у команді (опційно)"></textarea>' +
        '<button id="hq_ar_send">Запросити доступ</button>' +
        '<button class="signout" id="hq_ar_out">Вийти і використати інший акаунт</button>' +
      '</div>';
    document.body.appendChild(sc);

    sc.querySelector('#hq_ar_send').onclick = async function () {
      var btn = sc.querySelector('#hq_ar_send');
      btn.disabled = true; btn.textContent = 'Надсилаю…';
      var comment = sc.querySelector('#hq_ar_comment').value;
      var ok = await submitRequest(email, authId, comment);
      if (ok) {
        sc.querySelector('.hq-ar-card').insertAdjacentHTML('beforeend',
          '<div class="hr-success">✓ Заявку надіслано. Засновники отримають сповіщення і дадуть доступ протягом доби.</div>');
        btn.textContent = 'Запит надіслано';
      } else {
        btn.disabled = false;
        btn.textContent = 'Спробувати знову';
      }
    };
    sc.querySelector('#hq_ar_out').onclick = function () {
      if (window.supabase) window.supabase.auth.signOut().then(function () { location.reload(); });
    };
  }
  window.HQ_showAccessRequest = showScreen;

  async function autoCheck() {
    var res = await checkAccess();
    if (!res.allowed) showScreen(res.email, res.authId);
  }
  setTimeout(autoCheck, 2000);
  setTimeout(autoCheck, 5000);

  console.log('%cDreamCar HQ Access %c· No-access screen ready', 'color:#cc0000;font-weight:700;', 'color:#888;');
})();
