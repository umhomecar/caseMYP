(() => {
  const cfg = window.__CASEMYP_CONFIG__ || {};
  const env = String(cfg.deployEnvironment || '').trim().toLowerCase();
  if (env !== 'preview') return;

  let supabaseHost = '(ไม่พบ Supabase URL)';
  try {
    supabaseHost = new URL(String(cfg.supabaseUrl || '')).hostname || supabaseHost;
  } catch (_) {}

  function showDiagnostic(error) {
    if (document.getElementById('cp-preview-db-diagnostic')) return;

    const box = document.createElement('div');
    box.id = 'cp-preview-db-diagnostic';
    Object.assign(box.style, {
      position: 'fixed',
      left: '12px',
      right: '12px',
      bottom: '12px',
      zIndex: '99999',
      maxWidth: '760px',
      margin: '0 auto',
      padding: '12px 14px',
      borderRadius: '10px',
      border: '1px solid rgba(248,81,73,.55)',
      background: 'rgba(33,18,20,.97)',
      color: '#ffd7d5',
      fontFamily: "'Sarabun', sans-serif",
      fontSize: '12px',
      lineHeight: '1.55',
      boxShadow: '0 10px 30px rgba(0,0,0,.35)'
    });

    const name = String(error?.name || 'Error');
    const message = String(error?.message || 'ไม่ทราบสาเหตุ');
    const online = navigator.onLine === false ? 'ออฟไลน์' : 'ออนไลน์';

    box.textContent = `Preview DB Diagnostic · env=preview · host=${supabaseHost} · network=${online} · ${name}: ${message}`;
    document.body.appendChild(box);
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    try {
      return await originalFetch(...args);
    } catch (error) {
      const input = args[0];
      const target = typeof input === 'string' ? input : String(input?.url || '');
      if (target.includes('.supabase.co')) showDiagnostic(error);
      throw error;
    }
  };
})();
