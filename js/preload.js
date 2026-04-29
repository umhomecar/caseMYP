// CasePool preload / startup helpers
document.documentElement.style.background="#0d1117";
if(document.body)document.body.style.background="#0d1117";
document.addEventListener('DOMContentLoaded',function(){if(document.body)document.body.style.background="#0d1117";});
// ฆ่า loader ให้ได้แน่ๆ หลัง 4 วิ
window.addEventListener('load',function(){
  setTimeout(function(){
    var el=document.getElementById('app-loader');
    if(el){el.style.pointerEvents='none';el.style.opacity='0';setTimeout(function(){el.remove();},400);}
  },4000);
});

// PWA install prompt listener
try{
  window._deferredInstall=null;
  window.addEventListener('beforeinstallprompt',function(e){
    e.preventDefault();
    window._deferredInstall=e;
    window.dispatchEvent(new CustomEvent('pwa-installable'));
  });
}catch(e){}
