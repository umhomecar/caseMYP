(() => {
  const TARGET_HREF = './facebook-ads.html';

  function addDesktopLink() {
    const nav = document.querySelector('.sidebar .sidebar-nav');
    if (!nav || nav.querySelector('[data-facebook-ads-link]')) return;

    const link = document.createElement('a');
    link.href = TARGET_HREF;
    link.className = 'nav-item nav-link-external';
    link.dataset.facebookAdsLink = 'true';
    link.setAttribute('aria-label', 'วิเคราะห์แอด Facebook');
    link.innerHTML = '<span aria-hidden="true" style="width:18px;height:18px;border-radius:50%;display:inline-grid;place-items:center;background:#1877f2;color:#fff;font-size:13px;font-weight:800">f</span><span>วิเคราะห์แอด Facebook</span><span style="margin-left:auto;font-size:11px;opacity:.65">↗</span>';

    const dashboardButton = [...nav.children].find(el => el.textContent.includes('แดชบอร์ด'));
    if (dashboardButton?.nextSibling) nav.insertBefore(link, dashboardButton.nextSibling);
    else nav.appendChild(link);
  }

  function addMobileLink() {
    const topbar = document.querySelector('.admin-topbar');
    if (!topbar || topbar.querySelector('[data-facebook-ads-mobile-link]')) return;
    const actions = topbar.lastElementChild;
    if (!actions) return;

    const link = document.createElement('a');
    link.href = TARGET_HREF;
    link.dataset.facebookAdsMobileLink = 'true';
    link.className = 'btn btn-ghost';
    link.setAttribute('aria-label', 'วิเคราะห์แอด Facebook');
    link.title = 'วิเคราะห์แอด Facebook';
    link.style.cssText = 'padding:4px 8px;text-decoration:none;color:#1877f2;font-weight:800';
    link.textContent = 'f';
    actions.insertBefore(link, actions.firstChild);
  }

  function sync() {
    // AdminApp ใช้ .sidebar / .admin-topbar ส่วน Sales ใช้ .sales-sidebar
    // จึงไม่เพิ่มเมนูนี้ให้บัญชี Sales
    if (!document.querySelector('.sidebar')) return;
    addDesktopLink();
    addMobileLink();
  }

  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', sync);
  sync();
})();
