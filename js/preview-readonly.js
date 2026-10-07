(() => {
  const bootstrap = window.__CASEMYP_PREVIEW_BOOTSTRAP__ || {};
  const env = String(bootstrap.deployEnvironment || '').trim().toLowerCase();
  if (env !== 'preview') return;

  const prod = window.__CASEMYP_CONFIG__ || {};
  const supabaseUrl = String(prod.supabaseUrl || '').trim();
  const supabaseAnonKey = String(prod.supabaseAnonKey || '').trim();

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Preview read-only bootstrap failed: production runtime config is unavailable.');
    return;
  }

  window.__CASEMYP_READ_ONLY__ = true;
  window.__CASEMYP_CONFIG__ = Object.freeze({
    ...prod,
    deployEnvironment: 'preview-readonly',
    authMode: 'legacy'
  });

  let supabaseHost = '';
  try { supabaseHost = new URL(supabaseUrl).host; } catch (_) {}

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || '');
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    let targetHost = '';
    try { targetHost = new URL(url, location.href).host; } catch (_) {}

    const isProductionSupabase = supabaseHost && targetHost === supabaseHost;
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);

    if (isProductionSupabase && isWrite) {
      console.warn(`[Preview read-only] Blocked ${method} ${url}`);
      return Promise.resolve(new Response(JSON.stringify({
        error: 'PREVIEW_READ_ONLY',
        message: 'Preview นี้เชื่อมฐานจริงแบบอ่านอย่างเดียว จึงไม่อนุญาตให้เพิ่ม แก้ไข หรือลบข้อมูล'
      }), {
        status: 403,
        headers: {'Content-Type': 'application/json'}
      }));
    }

    return nativeFetch(input, init);
  };

  if (typeof navigator.sendBeacon === 'function') {
    const nativeBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      let targetHost = '';
      try { targetHost = new URL(String(url), location.href).host; } catch (_) {}
      if (supabaseHost && targetHost === supabaseHost) {
        console.warn(`[Preview read-only] Blocked beacon ${url}`);
        return false;
      }
      return nativeBeacon(url, data);
    };
  }

  const showBanner = () => {
    if (document.getElementById('cp-preview-readonly-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'cp-preview-readonly-banner';
    bar.textContent = '🔒 PREVIEW READ-ONLY · กำลังอ่านข้อมูลจริงจาก CaseMYP · การเพิ่ม/แก้ไข/ลบถูกบล็อก';
    Object.assign(bar.style, {
      position: 'fixed',
      left: '50%',
      bottom: '12px',
      transform: 'translateX(-50%)',
      zIndex: '100000',
      maxWidth: 'calc(100vw - 24px)',
      padding: '9px 14px',
      borderRadius: '999px',
      border: '1px solid rgba(210,153,34,.55)',
      background: 'rgba(45,35,12,.96)',
      color: '#f2cc60',
      fontFamily: "'Sarabun', sans-serif",
      fontSize: '12px',
      fontWeight: '700',
      boxShadow: '0 8px 28px rgba(0,0,0,.35)',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });
    document.body.appendChild(bar);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner, {once:true});
  } else {
    showBanner();
  }
})();
