(() => {
  const STORAGE_KEY = 'casepool_meta_ads_csv_v1';
  const MAX_PERSIST_BYTES = 3_500_000;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { dataset: null, runtimeOnly: false };

  const aliases = {
    start: ['เริ่มการรายงาน','Reporting starts','reporting_starts','date_start'],
    end: ['สิ้นสุดการรายงาน','Reporting ends','reporting_ends','date_stop'],
    campaignName: ['ชื่อแคมเปญ','Campaign name','campaign_name'],
    campaignId: ['รหัสแคมเปญ','Campaign ID','campaign_id'],
    adsetName: ['ชื่อชุดโฆษณา','Ad set name','Ad Set name','adset_name'],
    adsetId: ['รหัสชุดโฆษณา','Ad set ID','Ad Set ID','adset_id'],
    adName: ['ชื่อโฆษณา','Ad name','ad_name'],
    adId: ['รหัสโฆษณา','Ad ID','ad_id'],
    linkClicks: ['การคลิกลิงก์','Link clicks','link_clicks'],
    impressions: ['อิมเพรสชัน','Impressions','impressions'],
    ctr: ['CTR (ทั้งหมด)','CTR (all)','CTR','ctr'],
    cpc: ['CPC (ทั้งหมด) (THB)','CPC (all) (THB)','CPC (ทั้งหมด)','CPC (all)','CPC','cpc'],
    cpm: ['CPM (ต้นทุนต่ออิมเพรสชั่น 1,000 ครั้ง) (THB)','CPM (cost per 1,000 impressions) (THB)','CPM (ต้นทุนต่ออิมเพรสชั่น 1,000 ครั้ง)','CPM','cpm'],
    spend: ['จำนวนเงินที่ใช้จ่ายไป (THB)','Amount spent (THB)','จำนวนเงินที่ใช้จ่ายไป','Amount spent','spend'],
    reach: ['การเข้าถึง','Reach','reach'],
    results: ['ค่าผลลัพธ์','Results','result_value','results'],
    costPerResult: ['ต้นทุนต่อผลลัพธ์','Cost per result','cost_per_result'],
    resultType: ['ตัวระบุผลลัพธ์','Result type','result_type']
  };

  function normalizeHeader(v) {
    return String(v ?? '').replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ').toLowerCase();
  }
  const aliasLookup = Object.fromEntries(Object.entries(aliases).flatMap(([key, list]) => list.map(x => [normalizeHeader(x), key])));

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    const source = String(text ?? '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  function toNum(v) {
    const s = String(v ?? '').trim();
    if (!s || s === '-' || s === '—') return null;
    const n = Number(s.replace(/,/g, '').replace(/%/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }

  function normalizeRows(matrix) {
    if (matrix.length < 2) throw new Error('ไฟล์ CSV ไม่มีข้อมูล');
    const rawHeaders = matrix[0];
    const mapped = rawHeaders.map(h => aliasLookup[normalizeHeader(h)] || '');
    const required = ['spend','impressions'];
    for (const key of required) if (!mapped.includes(key)) throw new Error(`ไม่พบคอลัมน์ ${key === 'spend' ? 'จำนวนเงินที่ใช้จ่าย' : 'Impressions'} ในไฟล์`);
    if (!mapped.includes('campaignName') && !mapped.includes('adName')) throw new Error('ไม่พบชื่อ Campaign หรือชื่อ Ad ในไฟล์');

    const rows = [];
    for (const cells of matrix.slice(1)) {
      const raw = {};
      mapped.forEach((key, i) => { if (key) raw[key] = cells[i] ?? ''; });
      const row = {
        start: String(raw.start || '').trim(), end: String(raw.end || '').trim(),
        campaignName: String(raw.campaignName || '').trim(), campaignId: String(raw.campaignId || '').trim(),
        adsetName: String(raw.adsetName || '').trim(), adsetId: String(raw.adsetId || '').trim(),
        adName: String(raw.adName || '').trim(), adId: String(raw.adId || '').trim(),
        linkClicks: toNum(raw.linkClicks), impressions: toNum(raw.impressions), ctr: toNum(raw.ctr),
        cpc: toNum(raw.cpc), cpm: toNum(raw.cpm), spend: toNum(raw.spend), reach: toNum(raw.reach),
        results: toNum(raw.results), costPerResult: toNum(raw.costPerResult), resultType: String(raw.resultType || '').trim()
      };
      const hasIdentity = row.adName || row.adId || row.campaignName || row.campaignId;
      const hasMetrics = [row.spend,row.impressions,row.linkClicks,row.reach].some(v => v != null);
      if (hasIdentity && hasMetrics) rows.push(row);
    }
    if (!rows.length) throw new Error('ไม่พบแถวข้อมูลโฆษณาที่ใช้งานได้');
    return { rows, rawHeaders };
  }

  function detectCurrency(headers) {
    const joined = headers.join(' ');
    const m = joined.match(/\(([A-Z]{3})\)/);
    return m ? m[1] : 'THB';
  }

  function aggregate(rows) {
    const sum = (key) => rows.reduce((a,r) => a + (Number.isFinite(r[key]) ? r[key] : 0), 0);
    const spend = sum('spend');
    const impressions = sum('impressions');
    const linkClicks = sum('linkClicks');
    const reachSum = sum('reach');
    let ctrNumerator = 0, ctrDenominator = 0;
    let impliedClicks = 0;
    let actualResults = 0, resultRows = 0;
    for (const r of rows) {
      if (Number.isFinite(r.ctr) && Number.isFinite(r.impressions)) { ctrNumerator += r.ctr * r.impressions; ctrDenominator += r.impressions; }
      if (Number.isFinite(r.cpc) && r.cpc > 0 && Number.isFinite(r.spend)) impliedClicks += r.spend / r.cpc;
      if (Number.isFinite(r.results)) { actualResults += r.results; resultRows++; }
    }
    return {
      spend, impressions, linkClicks, reachSum,
      ctr: ctrDenominator ? ctrNumerator / ctrDenominator : null,
      cpc: impliedClicks ? spend / impliedClicks : null,
      cpm: impressions ? spend / impressions * 1000 : null,
      actualResults: resultRows ? actualResults : null,
      resultRows
    };
  }

  function buildDataset(fileName, normalized) {
    const starts = normalized.rows.map(r => r.start).filter(Boolean).sort();
    const ends = normalized.rows.map(r => r.end).filter(Boolean).sort();
    const level = normalized.rows.some(r => r.adName || r.adId) ? 'ad' : 'campaign';
    return {
      version: 1,
      fileName,
      importedAt: new Date().toISOString(),
      reportingStart: starts[0] || '',
      reportingEnd: ends[ends.length - 1] || '',
      currency: detectCurrency(normalized.rawHeaders),
      level,
      rows: normalized.rows
    };
  }

  function saveDataset(data) {
    state.dataset = data; state.runtimeOnly = false;
    try {
      const json = JSON.stringify(data);
      if (json.length > MAX_PERSIST_BYTES) { state.runtimeOnly = true; return false; }
      localStorage.setItem(STORAGE_KEY, json);
      return true;
    } catch (_) { state.runtimeOnly = true; return false; }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed?.rows) || !parsed.rows.length) return null;
      return parsed;
    } catch (_) { return null; }
  }

  function clearSaved() {
    state.dataset = null; state.runtimeOnly = false;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
    document.getElementById('metaCsvTable')?.remove();
    document.getElementById('metaCsvSourceBar')?.remove();
    setTimeout(() => document.dispatchEvent(new CustomEvent('casepool:meta-csv-cleared')), 0);
  }

  function fmtInt(v) { return Number(v || 0).toLocaleString('th-TH',{maximumFractionDigits:0}); }
  function fmt2(v) { return Number(v || 0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtMaybe(v, suffix='') { return Number.isFinite(v) ? `${fmt2(v)}${suffix}` : '—'; }
  function fmtMoney(v, currency='THB') { return `${fmt2(v)} ${currency}`; }
  function dateLabel(v) {
    if (!v) return '-';
    const d = new Date(`${v}T00:00:00`);
    return isNaN(d) ? v : d.toLocaleDateString('th-TH',{day:'2-digit',month:'short',year:'numeric'});
  }

  function metaIsLiveConnected() {
    return String($('.meta-state')?.textContent || '').includes('เชื่อมแล้ว');
  }

  function ensureImportButton() {
    const actions = $('.actions'); if (!actions || $('#metaCsvImportBtn')) return;
    const input = document.createElement('input');
    input.id = 'metaCsvFileInput'; input.type = 'file'; input.accept = '.csv,text/csv'; input.hidden = true;
    const btn = document.createElement('button');
    btn.id = 'metaCsvImportBtn'; btn.type = 'button'; btn.className = 'btn'; btn.textContent = '📄 นำเข้า CSV';
    btn.title = 'นำไฟล์ CSV ที่ Export จาก Meta Ads Manager มาใช้ชั่วคราว';
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const text = await file.text();
        const normalized = normalizeRows(parseCsv(text));
        const dataset = buildDataset(file.name, normalized);
        const persisted = saveDataset(dataset);
        renderCsv(dataset, {persisted});
      } catch (err) {
        renderImportError(err?.message || 'อ่าน CSV ไม่สำเร็จ');
      } finally { input.value = ''; }
    });
    actions.insertBefore(btn, actions.firstChild);
    actions.appendChild(input);
  }

  function ensureSourceBar(data, persisted = !state.runtimeOnly) {
    let bar = document.getElementById('metaCsvSourceBar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'metaCsvSourceBar';
      const rangeBar = document.getElementById('adsRangeBar');
      (rangeBar || $('.notice'))?.insertAdjacentElement('afterend', bar);
    }
    const levelText = data.level === 'ad' ? 'Ads level' : 'Campaign level';
    bar.innerHTML = `<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:10px 12px;border:1px solid rgba(63,185,80,.28);background:rgba(63,185,80,.07);border-radius:10px;margin-bottom:14px;font-size:11px">
      <div style="min-width:0"><b style="color:#56d364">📄 CSV Ads Manager · ${esc(levelText)}</b><div style="color:#8b949e;margin-top:3px;white-space:normal">${esc(data.fileName)} · ${dateLabel(data.reportingStart)} – ${dateLabel(data.reportingEnd)} · ${data.rows.length.toLocaleString('th-TH')} แถว${persisted?' · เก็บไว้ใน browser เครื่องนี้':' · ใช้ได้จนกว่าจะปิด/รีโหลดหน้า'}</div></div>
      <div style="display:flex;gap:6px"><button type="button" class="btn" id="metaCsvReplace" style="font-size:11px">เปลี่ยนไฟล์</button><button type="button" class="btn" id="metaCsvClear" style="font-size:11px">ล้าง CSV</button></div>
      <div style="width:100%;color:#d29922">⚠️ ช่วงเวลา CaseMYP ด้านบนไม่สามารถตัดแบ่ง CSV แบบสรุปย้อนหลังได้ หากต้องการ 7/30/90 วัน ให้ Export CSV จาก Ads Manager ตามช่วงนั้นโดยตรง</div>
    </div>`;
    $('#metaCsvReplace', bar)?.addEventListener('click', () => $('#metaCsvFileInput')?.click());
    $('#metaCsvClear', bar)?.addEventListener('click', () => { clearSaved(); location.reload(); });
  }

  function setCsvKpi(data, a) {
    const card = $('.kpis .kpi'); if (!card) return;
    const label = $('.kpi-label', card), val = $('.kpi-val', card), sub = $('.kpi-sub', card);
    if (label) label.textContent = '💰 ค่าใช้จ่ายโฆษณา · CSV';
    if (val) { val.textContent = fmtMoney(a.spend, data.currency); val.classList.remove('waiting'); val.classList.add('real'); }
    if (sub) sub.textContent = `${data.level === 'ad' ? 'Ads' : 'Campaign'} · ${dateLabel(data.reportingStart)} – ${dateLabel(data.reportingEnd)}`;
  }

  function renderCsvMetaPanel(data, a) {
    const panel = [...$$('.triple .mini')].find(x => $('h3',x)?.textContent.includes('ข้อมูลจาก Meta'));
    if (!panel) return;
    panel.dataset.csvRendered = '1';
    panel.innerHTML = `<h3>ข้อมูลจาก CSV Ads Manager</h3><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${[
        ['Impressions',fmtInt(a.impressions)],['Link Clicks',fmtInt(a.linkClicks)],['Reach รวม*',fmtInt(a.reachSum)],['CTR (ทั้งหมด)',fmtMaybe(a.ctr,'%')],['CPC (ทั้งหมด)',fmtMaybe(a.cpc)],['CPM',fmtMaybe(a.cpm)],['Results',a.actualResults == null?'—':fmtInt(a.actualResults)],['แถวข้อมูล',fmtInt(data.rows.length)]
      ].map(([k,v]) => `<div style="background:#12171d;border:1px solid #30363d;border-radius:8px;padding:9px"><div style="font-size:10px;color:#8b949e">${k}</div><div style="font-size:17px;font-weight:800;color:#79c0ff;margin-top:3px">${v}</div></div>`).join('')}
    </div><div style="font-size:10px;color:#59636f;margin-top:9px">* Reach เป็นผลรวมรายแถว จึงอาจนับคนซ้ำข้าม Campaign/Ad ได้ · Results จะแสดงเฉพาะเมื่อ CSV มีจำนวนจริง ไม่คำนวณเดา</div>`;
  }

  function renderCsvTable(data) {
    let host = document.getElementById('metaCsvTable');
    if (!host) {
      host = document.createElement('section'); host.id = 'metaCsvTable'; host.className = 'card table-card';
      const existing = document.getElementById('metaLiveTable') || $$('.table-card').at(-1);
      existing?.insertAdjacentElement('afterend', host);
    }
    const rows = [...data.rows].sort((a,b) => (b.spend || 0) - (a.spend || 0));
    const adLevel = data.level === 'ad';
    host.innerHTML = `<div class="table-head"><h3>📄 ${adLevel?'Ads':'Campaigns'} จาก CSV</h3><span class="chip">${rows.length.toLocaleString('th-TH')} ${adLevel?'แอด':'แคมเปญ'}</span></div><div class="table-scroll"><table><thead><tr>
      ${adLevel?'<th>Ad</th><th>Campaign</th>':'<th>Campaign</th>'}<th>Spend</th><th>Reach*</th><th>Impressions</th><th>Link Clicks</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Results</th><th>Cost/Result</th><th>Result type</th>
    </tr></thead><tbody>${rows.map(r => `<tr>
      ${adLevel?`<td><b>${esc(r.adName || r.adId || '-')}</b></td><td>${esc(r.campaignName || '-')}</td>`:`<td><b>${esc(r.campaignName || r.campaignId || '-')}</b></td>`}
      <td class="num">${fmtMoney(r.spend || 0,data.currency)}</td><td class="num">${Number.isFinite(r.reach)?fmtInt(r.reach):'—'}</td><td class="num">${Number.isFinite(r.impressions)?fmtInt(r.impressions):'—'}</td><td class="num">${Number.isFinite(r.linkClicks)?fmtInt(r.linkClicks):'—'}</td>
      <td class="num">${fmtMaybe(r.ctr,'%')}</td><td class="num">${fmtMaybe(r.cpc)}</td><td class="num">${fmtMaybe(r.cpm)}</td><td class="num">${Number.isFinite(r.results)?fmtInt(r.results):'—'}</td><td class="num">${Number.isFinite(r.costPerResult)?fmt2(r.costPerResult):'—'}</td><td>${esc(r.resultType || '—')}</td>
    </tr>`).join('')}</tbody></table></div>`;
  }

  function renderCsv(data, {persisted = !state.runtimeOnly} = {}) {
    if (!data || metaIsLiveConnected()) return;
    state.dataset = data;
    const a = aggregate(data.rows);
    const chip = $('.meta-state'); if (chip) { chip.textContent = '● CSV · นำเข้าแล้ว'; chip.style.color = '#56d364'; }
    ensureSourceBar(data, persisted);
    setCsvKpi(data, a);
    renderCsvMetaPanel(data, a);
    renderCsvTable(data);
  }

  function renderImportError(message) {
    let bar = document.getElementById('metaCsvSourceBar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'metaCsvSourceBar';
      (document.getElementById('adsRangeBar') || $('.notice'))?.insertAdjacentElement('afterend', bar);
    }
    bar.innerHTML = `<div style="padding:10px 12px;border:1px solid rgba(248,81,73,.35);background:rgba(248,81,73,.08);color:#f85149;border-radius:10px;margin-bottom:14px;font-size:12px">⚠️ ${esc(message)}</div>`;
  }

  function boot() {
    ensureImportButton();
    state.dataset = loadSaved();
    if (state.dataset) setTimeout(() => renderCsv(state.dataset), 450);

    document.addEventListener('click', e => {
      if ((e.target.closest('[data-range]') || e.target.closest('#refreshBtn')) && state.dataset) {
        setTimeout(() => renderCsv(state.dataset), 350);
      }
    });

    const observer = new MutationObserver(() => {
      if (!state.dataset || metaIsLiveConnected()) return;
      const chipText = String($('.meta-state')?.textContent || '');
      if (chipText.includes('ต้องตั้งค่า') || chipText.includes('รอยืนยัน') || chipText.includes('เชื่อมไม่สำเร็จ')) {
        setTimeout(() => renderCsv(state.dataset), 50);
      }
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
