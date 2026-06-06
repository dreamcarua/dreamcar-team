/* DreamCar Unified Theme — light/dark (Давид 05.06.2026) */
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
    st.textContent='html[data-dc-theme="light"] body.dc-light{background:#fafafa!important;color:#0a0a0a!important;}html[data-dc-theme="light"] body.dc-light :is(.sidebar,.topbar,header,nav,aside,.modal,.modal-body,.panel,.card,.col,.col-body,.col-head){background:#fff!important;color:#0a0a0a!important;border-color:#e0e0e0!important;}html[data-dc-theme="light"] body.dc-light :is(input,textarea,select){background:#fff!important;color:#0a0a0a!important;border-color:#d4d4d4!important;}html[data-dc-theme="light"] body.dc-light :is(.chip,.filter-btn){background:#f0f0f0!important;color:#0a0a0a!important;border-color:#d4d4d4!important;}html[data-dc-theme="light"] body.dc-light :is(.chip.active,.chip-cta){background:#E30613!important;color:#fff!important;}html[data-dc-theme="light"] body.dc-light :is(.col-card,.cal-card,.ms-chip){background:#fff!important;color:#0a0a0a!important;border-color:#e0e0e0!important;}.dc-theme-toggle{background:transparent;border:1px solid currentColor;color:inherit;cursor:pointer;padding:6px 10px;border-radius:6px;font-size:14px;line-height:1;}';
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
