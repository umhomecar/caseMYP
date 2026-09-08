(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function parseNumber(text) {
    const n = Number(String(text || '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function pct(value, base) {
    if (!base) return value ? '—' : '0%';
    const p = (value / base) * 100;
    if (p >= 10 || Number.isInteger(p)) return `${Math.round(p)}%`;
    return `${p.toFixed(1)}%`;
  }

  function clarifyCards() {
    const bookingCard = $('#bookingCount')?.closest('.kpi');
    if (bookingCard) {
      const sub = $('.kpi-sub', bookingCard);
      if (sub) sub.textContent = 'รายการจองทั้งหมดในช่วงที่เลือก (อาจมีหลายรายการต่อ Case ID)';
    }

    const adsCard = $('#adsCaseCount')?.closest('.kpi');
    if (adsCard) {
      const sub = $('.kpi-sub', adsCard);
      if (sub) sub.textContent = 'Case ID ไม่ซ้ำที่มีข้อมูล Ads/Facebook';
    }

    const soldCard = $('#soldCount')?.closest('.kpi');
    if (soldCard) {
      const label = $('.kpi-label', soldCard);
      if (label) label.textContent = label.textContent.replace('ปล่อยรถ ·', 'ปล่อยรถจาก Ads ·');
      const sub = $('.kpi-sub', soldCard);
      if (sub) sub.textContent = 'เฉพาะเคสที่ระบุ Ads/Facebook และถึงสถานะปล่อยรถ';
    }
  }

  function clarifyFunnel() {
    const rows = $$('.funnel .frow');
    if (!rows.length) return;

    const values = rows.map(row => parseNumber($('.fnum', row)?.textContent));
    rows.forEach((row, index) => {
      const name = $('.fname', row);
      const percent = $('.fpct', row);
      if (!percent) return;

      if (index === 0) {
        percent.textContent = 'ฐาน 100%';
        percent.title = 'เคสทั้งหมดในช่วงที่เลือก';
        return;
      }

      const base = values[index - 1];
      percent.textContent = pct(values[index], base);
      percent.title = `Conversion จากขั้นก่อนหน้า: ${values[index].toLocaleString('th-TH')} / ${base.toLocaleString('th-TH')}`;

      if (index === 1 && name) name.textContent = 'เคสที่ระบุ Ads/Facebook';
      if (index === 2 && name) name.textContent = 'เคสจาก Ads ที่มีการจอง';
      if (index === 3 && name) name.textContent = 'ผ่านขั้นอนุมัติ';
      if (index === 4 && name) name.textContent = 'ปล่อยรถจาก Ads';
    });
  }

  let scheduled = false;
  function sync() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      clarifyCards();
      clarifyFunnel();
    });
  }

  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, {subtree: true, childList: true, characterData: true});
  document.addEventListener('DOMContentLoaded', sync);
  window.addEventListener('load', sync);
  sync();
})();
