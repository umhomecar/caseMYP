// CasePool preload / startup helpers
document.documentElement.style.background="#0d1117";
if(document.body)document.body.style.background="#0d1117";
document.addEventListener('DOMContentLoaded',function(){if(document.body)document.body.style.background="#0d1117";});

// ฆ่า loader ทันทีที่ React พร้อม (React จะ remove เอง)
// fallback: ถ้า React ไม่ remove ภายใน 500ms ให้ลองอีกรอบ
window.addEventListener('load',function(){
  // React App จะ remove loader เอง — นี่คือ fallback กัน stuck
  setTimeout(function(){
    var el=document.getElementById('app-loader');
    if(el){el.style.pointerEvents='none';el.style.opacity='0';el.style.transition='opacity .3s';setTimeout(function(){if(el.parentNode)el.remove();},350);}
  },500); // ลดจาก 4000ms → 500ms
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
