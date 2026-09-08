(() => {
  const cfg = window.__CASEMYP_CONFIG__ || {};
  const base = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  const key = String(cfg.supabaseAnonKey || '').trim();
  if (!base || !key) return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = (v) => String(v || '').trim();
  const sold = (v) => ['ปล่อยแล้ว','ปล่อยรถ'].includes(norm(v));
  const approved = (v) => ['อนุมัติ','ปล่อยแล้ว','ปล่อยรถ'].includes(norm(v));
  const state = { cases: [], bookings: [], range: 'all' };

  async function q(table, query = '') {
    const r = await fetch(`${base}/rest/v1/${table}${query ? `?${query}` : ''}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const text = await r.text();
    if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
    return text ? JSON.parse(text) : [];
  }

  function parseDate(v) {
    const s = String(v || '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
      const d = new Date(s); return isNaN(d) ? null : d;
    }
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      let y = Number(m[3]); if (y > 2400) y -= 543;
      const d = new Date(y, Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
      return isNaN(d) ? null : d;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) {
      let y = Number(m[1]); if (y > 2400) y -= 543;
      const d = new Date(y, Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
      return isNaN(d) ? null : d;
    }
    const d = new Date(s); return isNaN(d) ? null : d;
  }

  function fallbackCaseMonth(caseid) {
    const m = String(caseid || '').match(/^(\d{2})(\d{2})/);
    if (!m) return null;
    const year = 2000 + Number(m[1]);
    const month = Number(m[2]);
    if (month < 1 || month > 12) return null;
    return new Date(year, month - 1, 1);
  }

  function rowDate(row) { return parseDate(row.createdat) || fallbackCaseMonth(row.caseid); }
  function adsFromCase(c) {
    const m = String(c.attachment || '').match(/\[CLIP:([^\]]+)\]/i);
    return m ? m[1].trim() : '';
  }

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function inRange(row, range) {
    if (range === 'all') return true;
    const d = rowDate(row); if (!d) return false;
    const now = new Date();
    if (range === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    const days = Number(range.replace('d','')) || 0;
    const from = startOfDay(now); from.setDate(from.getDate() - (days - 1));
    return d >= from && d <= new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  }

  const rangeLabel = (range) => ({all:'ทั้งหมด', '7d':'7 วันล่าสุด', '30d':'30 วันล่าสุด', month:'เดือนนี้', '90d':'90 วันล่าสุด'}[range] || 'ทั้งหมด');

  function installControls() {
    if ($('adsRangeBar')) return;
    const style = document.createElement('style');
    style.textContent = `
      .ads-range-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:-4px 0 14px;padding:10px 12px;border:1px solid #30363d;border-radius:10px;background:#12171d}
      .ads-range-title{font-size:12px;color:#8b949e;font-weight:700}.ads-range-buttons{display:flex;gap:6px;flex-wrap:wrap}
      .ads-range-btn{border:1px solid #30363d;background:#161b22;color:#c9d1d9;border-radius:8px;padding:6px 10px;font-size:11px;cursor:pointer}
      .ads-range-btn:hover{border-color:#4a5563}.ads-range-btn.active{background:#1877f2;border-color:#1877f2;color:#fff;font-weight:800}
      @media(max-width:820px){.ads-range-bar{align-items:flex-start;flex-direction:column}.ads-range-buttons{width:100%}.ads-range-btn{flex:1 1 auto}}
    `;
    document.head.appendChild(style);
    const bar = document.createElement('div');
    bar.id = 'adsRangeBar';
    bar.className = 'ads-range-bar';
    bar.innerHTML = `<div class="ads-range-title">📅 ช่วงข้อมูล CaseMYP</div><div class="ads-range-buttons">${[
      ['all','ทั้งหมด'],['7d','7 วัน'],['30d','30 วัน'],['month','เดือนนี้'],['90d','90 วัน']
    ].map(([v,l]) => `<button type="button" class="ads-range-btn${v==='all'?' active':''}" data-range="${v}">${l}</button>`).join('')}</div>`;
    const notice = document.querySelector('.notice');
    notice?.insertAdjacentElement('afterend', bar);
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-range]'); if (!btn) return;
      state.range = btn.dataset.range;
      bar.querySelectorAll('[data-range]').forEach(x => x.classList.toggle('active', x === btn));
      render();
    });
  }

  function setLabels(label) {
    const caseCard = $('caseCount')?.closest('.kpi');
    const bookingCard = $('bookingCount')?.closest('.kpi');
    const soldCard = $('soldCount')?.closest('.kpi');
    if (caseCard) caseCard.querySelector('.kpi-label').textContent = `💬 เคสใน CaseMYP · ${label}`;
    if (bookingCard) bookingCard.querySelector('.kpi-label').textContent = `📋 การจอง · ${label}`;
    if (soldCard) soldCard.querySelector('.kpi-label').textContent = `🚗 ปล่อยรถ · ${label}`;
    const trendTitle = $('trend')?.closest('.panel')?.querySelector('h3');
    if (trendTitle) trendTitle.textContent = `แนวโน้มจำนวนเคส · ${label}`;
  }

  function renderTrend(rows, range) {
    const host = $('trend'); if (!host) return;
    const buckets = new Map();
    for (const row of rows) {
      const d = rowDate(row); if (!d) continue;
      const bucketKey = range === 'all'
        ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
        : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      buckets.set(bucketKey, (buckets.get(bucketKey) || 0) + 1);
    }
    let entries = [...buckets.entries()].sort((a,b) => a[0].localeCompare(b[0]));
    if (entries.length > 18) entries = entries.slice(-18);
    if (!entries.length) { host.innerHTML = `<div class="empty-chart">ยังไม่มีเคสในช่วง ${esc(rangeLabel(range))}</div>`; return; }
    const max = Math.max(...entries.map(([,v]) => v), 1);
    host.innerHTML = entries.map(([k,v]) => {
      const parts = k.split('-');
      let label = '';
      if (range === 'all') {
        const d = new Date(Number(parts[0]), Number(parts[1])-1, 1);
        label = d.toLocaleDateString('th-TH',{month:'short',year:'2-digit'}).replace(/\s+/g,' ');
      } else label = `${Number(parts[2])}/${Number(parts[1])}`;
      return `<div class="trend-col"><div class="trend-bar" title="${v} เคส" style="height:${Math.max(5,Math.round(v/max*100))}%"></div><span class="trend-label">${esc(label)}</span></div>`;
    }).join('');
  }

  function renderFunnel(cases, bookings, soldIds) {
    const caseIds = new Set(cases.map(c => String(c.caseid)).filter(Boolean));
    const bookingIds = new Set(bookings.map(b => String(b.caseid)).filter(Boolean));
    const approvedIds = new Set(bookings.filter(b => approved(b.status)).map(b => String(b.caseid)).filter(Boolean));
    const attributed = new Set();
    cases.forEach(c => { if (adsFromCase(c)) attributed.add(String(c.caseid)); });
    bookings.forEach(b => { if (norm(b.ads) || norm(b.facebook)) attributed.add(String(b.caseid || b.id)); });
    const rows = [['เคส',caseIds.size],['ระบุ Ads/Facebook',attributed.size],['การจอง',bookingIds.size],['อนุมัติ',approvedIds.size],['ปล่อยรถ',soldIds.size]];
    const max = rows[0][1] || 1;
    $('funnel').innerHTML = rows.map(([name,val],i) => `<div class="frow"><div class="fbarwrap"><div class="fbar" style="width:${Math.max(val?5:0,Math.round(val/max*100))}%"></div></div><span class="fname">${esc(name)}</span><span class="fnum">${val.toLocaleString('th-TH')}</span><span class="fpct">${i===0?'100':Math.round(val/max*100)}%</span></div>`).join('');
  }

  function renderBreakdowns(cases, bookings) {
    const sources = new Map();
    const ensure = (src) => {
      const name = norm(src) || 'ไม่ระบุ';
      if (!sources.has(name)) sources.set(name,{source:name,cases:new Set(),bookings:new Set(),approved:new Set(),sold:new Set()});
      return sources.get(name);
    };
    for (const c of cases) {
      const src = adsFromCase(c); if (!src) continue;
      const rec = ensure(src); const id = String(c.caseid || ''); if (!id) continue;
      rec.cases.add(id); if (approved(c.status)) rec.approved.add(id); if (sold(c.status)) rec.sold.add(id);
    }
    for (const b of bookings) {
      const src = norm(b.ads) || norm(b.facebook); if (!src) continue;
      const rec = ensure(src); const id = String(b.caseid || b.id || ''); if (!id) continue;
      rec.cases.add(id); rec.bookings.add(id); if (approved(b.status)) rec.approved.add(id); if (sold(b.status)) rec.sold.add(id);
    }
    const list = [...sources.values()].sort((a,b) => b.cases.size - a.cases.size);
    $('adsSources').innerHTML = list.length ? list.slice(0,8).map((r,i) => `<div class="legend-row"><span class="dot" style="background:${['#1877f2','#bc8cff','#3fb950','#d29922','#f85149','#79c0ff'][i%6]}"></span><span title="${esc(r.source)}">${esc(r.source.length>30?r.source.slice(0,30)+'…':r.source)}</span><strong>${r.cases.size}</strong></div>`).join('') : '<div class="muted-box">ยังไม่มีเคสที่ระบุ Ads/คลิปแอด</div>';

    const attributedIds = new Set(list.flatMap(r => [...r.cases]));
    const stat = {};
    cases.filter(c => attributedIds.has(String(c.caseid))).forEach(c => { const s = norm(c.status) || 'ไม่ระบุ'; stat[s] = (stat[s] || 0) + 1; });
    const statuses = Object.entries(stat).sort((a,b) => b[1]-a[1]).slice(0,8);
    $('adStatuses').innerHTML = statuses.length ? statuses.map(([name,val],i) => `<div class="legend-row"><span class="dot" style="background:${['#1877f2','#3fb950','#d29922','#bc8cff','#f85149','#79c0ff'][i%6]}"></span><span>${esc(name)}</span><strong>${val}</strong></div>`).join('') : '<div class="muted-box">ยังไม่มีสถานะที่ผูกกับ Ads</div>';

    $('tableCount').textContent = `${list.length} แหล่ง`;
    $('adsTable').innerHTML = list.length ? list.map(r => {
      const conv = r.cases.size ? Math.round(r.sold.size / r.cases.size * 100) : 0;
      const cls = r.sold.size ? 'good' : r.cases.size >= 3 ? 'warn' : 'neutral';
      const label = r.sold.size ? 'มีผลปิดขาย' : r.cases.size >= 3 ? 'ควรติดตาม' : 'ข้อมูลน้อย';
      return `<tr><td><b>${esc(r.source)}</b></td><td class="num">${r.cases.size}</td><td class="num">${r.bookings.size}</td><td class="num">${r.approved.size}</td><td class="num">${r.sold.size}</td><td class="num">${conv}%</td><td><span class="status ${cls}">${label}</span></td></tr>`;
    }).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:28px">ยังไม่พบข้อมูล Ads ในช่วงที่เลือก</td></tr>';

    const best = list.filter(r => r.sold.size > 0).sort((a,b) => (b.sold.size/(b.cases.size||1)) - (a.sold.size/(a.cases.size||1)))[0];
    $('bestSource').textContent = best ? best.source : 'ยังไม่มีข้อมูล';
    $('bestSourceDetail').textContent = best ? `ปล่อย ${best.sold.size} จาก ${best.cases.size} เคส (${Math.round(best.sold.size/best.cases.size*100)}%)` : 'ต้องมี Ads attribution + ปล่อยรถก่อนจึงจะจัดอันดับได้';

    const watch = list.filter(r => r.cases.size >= 3 && r.sold.size === 0).sort((a,b) => b.cases.size-a.cases.size)[0];
    $('watchSource').textContent = watch ? watch.source : 'ยังไม่พบ';
    $('watchSourceDetail').textContent = watch ? `${watch.cases.size} เคส แต่ยังไม่พบการปล่อยรถ` : 'ยังไม่มีแหล่งที่มีเคสมากแต่ปิดไม่ได้';

    const tips = [];
    if (!list.length) tips.push('ยังไม่พบชื่อ Ads/Facebook ในช่วงที่เลือก — ลอง “ทั้งหมด” หรือเริ่มบันทึกชื่อแอดให้เป็นมาตรฐาน');
    else tips.push(`พบ ${list.length} ชื่อ Ads/แคมเปญ — ควรกำหนดชื่อมาตรฐานก่อนเชื่อม Meta`);
    const noAdsBookings = bookings.filter(b => !norm(b.ads) && !norm(b.facebook)).length;
    if (noAdsBookings) tips.push(`มีการจอง ${noAdsBookings} รายการที่ยังไม่ระบุ Ads/Facebook ทำให้ attribution ขาดช่วง`);
    tips.push('ข้อมูล Spend, Reach, Click, CPM, CPC และ CTR จะเพิ่มในขั้นเชื่อม Meta');
    $('tips').innerHTML = tips.map(t => `<li>${esc(t)}</li>`).join('');
  }

  function render() {
    const label = rangeLabel(state.range);
    const cases = state.cases.filter(r => inRange(r,state.range));
    const bookings = state.bookings.filter(r => inRange(r,state.range));
    const adsCases = cases.filter(c => adsFromCase(c));
    const bookingAds = bookings.filter(b => norm(b.ads) || norm(b.facebook));
    const soldIds = new Set([
      ...cases.filter(c => sold(c.status)).map(c => String(c.caseid)).filter(Boolean),
      ...bookings.filter(b => sold(b.status)).map(b => String(b.caseid)).filter(Boolean)
    ]);
    const attributed = new Set([
      ...adsCases.map(c => String(c.caseid)).filter(Boolean),
      ...bookingAds.map(b => String(b.caseid || b.id)).filter(Boolean)
    ]);

    setLabels(label);
    $('caseCount').textContent = cases.length.toLocaleString('th-TH');
    $('adsCaseCount').textContent = attributed.size.toLocaleString('th-TH');
    $('bookingCount').textContent = bookings.length.toLocaleString('th-TH');
    $('soldCount').textContent = soldIds.size.toLocaleString('th-TH');
    renderTrend(cases,state.range);
    renderFunnel(cases,bookings,soldIds);
    renderBreakdowns(cases,bookings);
    $('statusLine').textContent = `อัปเดตจาก CaseMYP · ${label} · ${new Date().toLocaleString('th-TH')}`;
  }

  async function loadAll() {
    installControls();
    try {
      $('statusLine').textContent = 'กำลังโหลดข้อมูล CaseMYP ทุกช่วงเวลา...';
      const [cases,bookings] = await Promise.all([
        q('cases','select=caseid,customername,status,sales,createdat,updatedat,attachment&deleted_at=is.null&order=caseid.desc&limit=10000'),
        q('bookings','select=id,caseid,sales,customer,facebook,ads,status,createdat&deleted_at=is.null&order=createdat.desc&limit=10000')
      ]);
      state.cases = Array.isArray(cases) ? cases : [];
      state.bookings = Array.isArray(bookings) ? bookings : [];
      render();
      setTimeout(render, 700);
    } catch (err) {
      console.error('Facebook Ads range enhancement failed',err);
      $('statusLine').textContent = `โหลดข้อมูลย้อนหลังไม่สำเร็จ: ${err?.message || err}`;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(loadAll,250), {once:true});
  else setTimeout(loadAll,250);
})();
