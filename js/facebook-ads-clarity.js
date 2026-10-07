(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

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
      setText($('.kpi-sub', bookingCard), 'รายการจองทั้งหมดในช่วงที่เลือก (อาจมีหลายรายการต่อ Case ID)');
    }

    const adsCard = $('#adsCaseCount')?.closest('.kpi');
    if (adsCard) {
      setText($('.kpi-sub', adsCard), 'Case ID ไม่ซ้ำที่มีข้อมูล Ads/Facebook');
    }

    const soldCard = $('#soldCount')?.closest('.kpi');
    if (soldCard) {
      const label = $('.kpi-label', soldCard);
      if (label && !label.textContent.includes('ปล่อยรถจาก Ads')) {
        setText(label, label.textContent.replace('ปล่อยรถ ·', 'ปล่อยรถจาก Ads ·'));
      }
      setText($('.kpi-sub', soldCard), 'เฉพาะเคสที่ระบุ Ads/Facebook และถึงสถานะปล่อยรถ');
    }
  }

  function clarifyFunnel() {
    const rows = $$('.funnel .frow');
    if (!rows.length) return;

    const values = rows.map(row => parseNumber($('.fnum', row)?.textContent));
    const names = ['เคสทั้งหมด','เคสที่ระบุ Ads/Facebook','เคสจาก Ads ที่มีการจอง','ผ่านขั้นอนุมัติ','ปล่อยรถจาก Ads'];

    rows.forEach((row, index) => {
      const name = $('.fname', row);
      const percent = $('.fpct', row);
      if (name && names[index]) setText(name, names[index]);
      if (!percent) return;

      if (index === 0) {
        setText(percent, 'ฐาน 100%');
        percent.title = 'เคสทั้งหมดในช่วงที่เลือก';
        return;
      }

      const base = values[index - 1];
      setText(percent, pct(values[index], base));
      percent.title = `Conversion จากขั้นก่อนหน้า: ${values[index].toLocaleString('th-TH')} / ${base.toLocaleString('th-TH')}`;
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
