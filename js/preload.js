// CasePool preload / startup helpers
document.documentElement.style.background="#0d1117";
if(document.body)document.body.style.background="#0d1117";
document.addEventListener('DOMContentLoaded',function(){if(document.body)document.body.style.background="#0d1117";});

// React จะนำ loader ออกเมื่อ mount สำเร็จ
// ถ้ายังค้างนาน ให้แสดงทางแก้แทนการซ่อน loader แล้วเหลือหน้าว่าง
window.addEventListener('load',function(){
  setTimeout(function(){
    var el=document.getElementById('app-loader');
    if(!el)return;
    var sub=el.querySelector('.loader-sub');
    var spinner=el.querySelector('.loader-spinner');
    if(sub)sub.textContent='โหลดนานกว่าปกติ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่';
    if(spinner)spinner.style.display='none';
    if(!el.querySelector('.loader-retry')){
      var retry=document.createElement('button');
      retry.type='button';
      retry.className='loader-retry';
      retry.textContent='โหลดใหม่';
      retry.addEventListener('click',function(){location.reload();});
      el.appendChild(retry);
    }
  },8000);
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
