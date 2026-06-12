/* DreamCar Unified Theme v2 — копія для /inventory/ (інакше: посилання у HTML на retention/dc-theme.js буде підтягувати CORS issue) */
(function(){
  if(window.__dcThemeLoaded) return;
  window.__dcThemeLoaded = true;
  var KEY='dc-theme';
  function get(){try{return localStorage.getItem(KEY)||'dark';}catch(_){return 'dark';}}
  function set(v){try{localStorage.setItem(KEY,v);}catch(_){}apply(v);}
  function apply(v){
    document.documentElement.setAttribute('data-dc-theme',v);
    document.body&&document.body.classList.toggle('dc-light',v==='light');
    document.querySelectorAll('.dc-theme-toggle').forEach(function(b){b.textContent=v==='light'?'☀️':'🌙';b.title=v==='light'?'Темна тема':'Світла тема';});
  }
  window.dcToggleTheme=function(){set(get()==='dark'?'light':'dark');};
  if(!document.getElementById('dc-theme-css')){
    var st=document.createElement('style');st.id='dc-theme-css';
    st.textContent = [
      'html[data-dc-theme="light"]{',
      '  --bg:#fafafa; --bg-2:#ffffff; --bg-3:#f5f5f7;',
      '  --steel:#e1e1e6; --line:#ececef;',
      '  --ash:#3c3c43; --white:#0a0a0a;',
      '}',
      'html[data-dc-theme="light"] body{background:#fafafa!important;color:#0a0a0a!important;}',
      'html[data-dc-theme="light"] body :is(.sidebar,.topbar,header,nav){background:#ffffff!important;color:#0a0a0a!important;border-color:#e1e1e6!important;}',
      'html[data-dc-theme="light"] body :is(.modal,.modal-body,.item-card,.an-card,.variant-row){background:#ffffff!important;color:#0a0a0a!important;border-color:#e1e1e6!important;}',
      'html[data-dc-theme="light"] body :is(input,textarea,select){background:#ffffff!important;color:#0a0a0a!important;border-color:#d4d4d8!important;}',
      'html[data-dc-theme="light"] body :is(.btn,.filter-btn,.filter-chip){background:#ffffff!important;color:#0a0a0a!important;border-color:#d4d4d8!important;}',
      'html[data-dc-theme="light"] body :is(.btn.primary,.btn.success,.btn.danger,.btn.warn){color:#fff!important;}',
      'html[data-dc-theme="light"] body :is(.btn.warn){color:#000!important;}',
      'html[data-dc-theme="light"] body :is(table,thead,tbody,tr,th,td){background:transparent!important;color:#0a0a0a!important;border-color:#e1e1e6!important;}',
      'html[data-dc-theme="light"] body thead th{background:#f5f5f7!important;}',
      '.dc-theme-toggle{background:transparent;border:1px solid currentColor;color:inherit;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:14px;line-height:1;}'
    ].join('\n');
    document.head.appendChild(st);
  }
  function injectBtn(){
    if(document.querySelector('.dc-theme-toggle')) return apply(get());
    var t=document.querySelector('.topbar-actions,.topbar');
    if(!t){var fb=document.createElement('button');fb.className='dc-theme-toggle';fb.style.cssText='position:fixed;top:14px;right:14px;z-index:9998;';fb.onclick=window.dcToggleTheme;document.body.appendChild(fb);apply(get());return;}
    var b=document.createElement('button');b.className='dc-theme-toggle';b.onclick=window.dcToggleTheme;t.appendChild(b);apply(get());
  }
  window.addEventListener('storage',function(e){if(e.key===KEY&&e.newValue)apply(e.newValue);});
  if(document.body){apply(get());injectBtn();}
  document.addEventListener('DOMContentLoaded',function(){apply(get());injectBtn();});
  setTimeout(injectBtn,800);setTimeout(injectBtn,2500);
})();
