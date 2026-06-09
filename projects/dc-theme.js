/* DreamCar Unified Theme v2 — #218 повноцінна світла тема (Vira UX feedback 09.06.2026) */
(function(){
  if(window.__dcThemeLoaded) return;
  window.__dcThemeLoaded = true;
  var KEY='dc-theme';
  function get(){try{return localStorage.getItem(KEY)||'dark';}catch(_){return 'dark';}}
  function set(v){try{localStorage.setItem(KEY,v);}catch(_){}apply(v);}
  function apply(v){
    document.documentElement.setAttribute('data-dc-theme',v);
    document.body&&document.body.classList.toggle('dc-light',v==='light');
    document.body&&document.body.classList.toggle('hq-light',v==='light');
    document.querySelectorAll('.dc-theme-toggle,#hq-theme-toggle').forEach(function(b){b.textContent=v==='light'?'☀️':'🌙';b.title=v==='light'?'Темна тема':'Світла тема';});
  }
  window.dcToggleTheme=function(){set(get()==='dark'?'light':'dark');};
  if(!document.getElementById('dc-theme-css')){
    var st=document.createElement('style');st.id='dc-theme-css';
    /* #218: token-level overrides — будь-який var(--bg-*) автоматично стає світлим.
       Покриває hardcoded inline color:#fff через attribute selectors.
       Брендовий DC red лишається на CTA. */
    st.textContent = [
      'html[data-dc-theme="light"]{',
      '  --bg:#fafafa; --bg-1:#fafafa; --bg-2:#ffffff; --bg-3:#f5f5f7; --bg-4:#ececef; --bg-hover:#f0f0f3;',
      '  --coal:#e8e8eb; --graphite:#d4d4d8; --steel:#e1e1e6;',
      '  --border:#e1e1e6; --border-2:#d4d4d8; --line:#ececef;',
      /* #220: темніші secondary тексти для WCAG AAA контрасту (Vira UX) */
      '  --ash:#3c3c43; --ash-2:#6b6b73; --bone:#0a0a0a;',
      '  --grey:#3c3c43; --grey-2:#6b6b73;',
      '  --white:#0a0a0a; --black:#0a0a0a;',
      '  --shadow:0 1px 3px rgba(0,0,0,0.08);',
      '  --card-color:#ffffff; --col-color:#0a0a0a;',
      '}',
      /* Тіло і основний контент */
      'html[data-dc-theme="light"] body{background:#fafafa!important;color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body :is(.main,.content,main,section,article){background:transparent;color:#0a0a0a;}',
      /* Sidebar/topbar/header/nav */
      'html[data-dc-theme="light"] body :is(.sidebar,.topbar,header,nav,aside,.app-topbar,.filter-bar){background:#ffffff!important;color:#0a0a0a!important;border-color:#e1e1e6!important;}',
      /* Картки/панелі/модали — всі бекграунд-варіанти */
      'html[data-dc-theme="light"] body :is(.modal,.modal-body,.panel,.card,.col,.col-body,.col-head,.col-card,.cal-card,.week-card,.ms-chip,.hq-an-card,.hq-feed-cell,.hq-feed-empty){background:#ffffff!important;color:#0a0a0a!important;border-color:#e1e1e6!important;}',
      /* Inputs/selects/textareas */
      'html[data-dc-theme="light"] body :is(input,textarea,select){background:#ffffff!important;color:#0a0a0a!important;border-color:#d4d4d8!important;}',
      'html[data-dc-theme="light"] body :is(input,textarea,select)::placeholder{color:#9a9aa3!important;}',
      /* Кнопки/chips */
      'html[data-dc-theme="light"] body :is(.btn,.chip,.filter-btn){background:#ffffff!important;color:#0a0a0a!important;border-color:#d4d4d8!important;}',
      'html[data-dc-theme="light"] body :is(.btn:hover,.chip:hover,.filter-btn:hover){background:#f5f5f7!important;}',
      'html[data-dc-theme="light"] body :is(.chip.on,.chip.active,.chip-cta,.filter-btn.active){background:#E30613!important;color:#ffffff!important;border-color:#E30613!important;}',
      'html[data-dc-theme="light"] body :is(.btn-primary,.btn.primary,.btn-success){background:#E30613!important;color:#ffffff!important;border-color:#E30613!important;}',
      'html[data-dc-theme="light"] body :is(.btn-primary:hover,.btn.primary:hover){background:#c5050f!important;}',
      /* Таблиці */
      'html[data-dc-theme="light"] body :is(table,thead,tbody,tr,th,td){background:transparent!important;color:#0a0a0a!important;border-color:#e1e1e6!important;}',
      'html[data-dc-theme="light"] body :is(thead th,th){background:#f5f5f7!important;}',
      'html[data-dc-theme="light"] body tr:hover{background:#f5f5f7!important;}',
      /* INLINE STYLES — найважче. Покриваємо найчастіші паттерни attribute selectors */
      'html[data-dc-theme="light"] body [style*="background:var(--bg-2"]{background:#ffffff!important;color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body [style*="background:var(--bg-3"]{background:#f5f5f7!important;color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body [style*="background:var(--bg-4"]{background:#ececef!important;color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body [style*="background:var(--coal"]{background:#e8e8eb!important;color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body [style*="background:var(--graphite"]{background:#d4d4d8!important;color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body [style*="background-color:var(--bg-2"]{background-color:#ffffff!important;color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body [style*="background-color:var(--bg-3"]{background-color:#f5f5f7!important;color:#0a0a0a!important;}',
      /* Inline color:#fff → темний (але не на брендових btn-primary всередині) */
      'html[data-dc-theme="light"] body [style*="color:#fff"]:not(.btn-primary):not(.btn.primary):not(.chip-cta):not(.chip.on):not(.chip.active):not(.btn-success):not(.dc-btn-brand){color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body [style*="color: #fff"]:not(.btn-primary):not(.btn.primary):not(.chip-cta):not(.chip.on):not(.chip.active):not(.btn-success):not(.dc-btn-brand){color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body [style*="color:white"]:not(.btn-primary):not(.btn.primary):not(.chip-cta):not(.chip.on):not(.chip.active):not(.btn-success):not(.dc-btn-brand){color:#0a0a0a!important;}',
      /* Темно-сірі inline borders + дрібні текстові hint */
      'html[data-dc-theme="light"] body [style*="border:1px solid var(--steel"]{border-color:#e1e1e6!important;}',
      'html[data-dc-theme="light"] body [style*="border:1px solid var(--border"]{border-color:#e1e1e6!important;}',
      'html[data-dc-theme="light"] body [style*="border:1px solid var(--graphite"]{border-color:#d4d4d8!important;}',
      /* Specific app-card-like блоки (Retention list cards) */
      'html[data-dc-theme="light"] body .ms-row,html[data-dc-theme="light"] body [class*="msg-row"],html[data-dc-theme="light"] body [class*="msg-card"]{background:#ffffff!important;color:#0a0a0a!important;border-color:#e1e1e6!important;}',
      /* Modal overlay */
      'html[data-dc-theme="light"] body .modal-backdrop{background:rgba(0,0,0,0.3)!important;}',
      /* Themed toggle button itself */
      '.dc-theme-toggle{background:transparent;border:1px solid currentColor;color:inherit;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:14px;line-height:1;}',
      /* Status chips — зберігаємо колір але робимо світлий фон */
      'html[data-dc-theme="light"] body :is(.chip-status-draft,.chip-status-review,.chip-status-approved,.chip-status-published,.chip-status-rework){background:#ffffff!important;border-width:1.5px;}',
      /* #220: Vira UX — sidebar text contrast. Inline color:var(--ash) було #5e5e66 (light) → тепер #3c3c43 (WCAG AAA) */
      'html[data-dc-theme="light"] body [style*="color:var(--ash"]{color:#3c3c43!important;}',
      'html[data-dc-theme="light"] body [style*="color:var(--grey"]{color:#3c3c43!important;}',
      'html[data-dc-theme="light"] body [style*="color:var(--bone"]{color:#0a0a0a!important;}',
      /* Sidebar nav items + headings — гарантовано темніший текст */
      'html[data-dc-theme="light"] body :is(.sidebar,.sidebar-section) :is(a,span,div,h1,h2,h3,h4,h5,label){color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body .sidebar :is(.section-title,.subtitle,.label,small,.muted){color:#3c3c43!important;}',
      /* Кількісні badges у sidebar (12, 5, 0) — теж темні */
      'html[data-dc-theme="light"] body .sidebar :is(.badge,.count,.number){color:#3c3c43!important;opacity:1!important;}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function injectBtn(){
    if(document.querySelector('.dc-theme-toggle')) return apply(get());
    var t=document.querySelector('.topbar .actions,.topbar-actions,.topbar,header.topbar,.app-topbar');
    if(!t){
      var fb=document.createElement('button');fb.className='dc-theme-toggle';fb.style.cssText='position:fixed;top:14px;right:14px;z-index:9998;';fb.onclick=window.dcToggleTheme;document.body.appendChild(fb);apply(get());return;
    }
    var b=document.createElement('button');b.className='dc-theme-toggle';b.onclick=window.dcToggleTheme;t.appendChild(b);apply(get());
  }
  window.addEventListener('storage',function(e){if(e.key===KEY&&e.newValue)apply(e.newValue);});
  if(document.body){apply(get());injectBtn();}
  document.addEventListener('DOMContentLoaded',function(){apply(get());injectBtn();});
  setTimeout(injectBtn,800);setTimeout(injectBtn,2500);
})();
