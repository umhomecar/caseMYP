(() => {
  const KEY_STORAGE = 'casepool_meta_dashboard_key_v1';
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (v) => Number(v || 0);
  const state = { key: '', loading: false, configured: null, lastRange: '' };

  try { state.key = sessionStorage.getItem(KEY_STORAGE) || ''; } catch (_) {}

  function activeRange() {
    return document.querySelector('[data-range].active')?.dataset?.range || 'all';
  }

  function fmtInt(v) { return Math.round(num(v)).toLocaleString('th-TH'); }
  function fmt2(v) { return num(v).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2}); }
  function fmtPct(v) { return `${fmt2(v)}%`; }
  function fmtMoney(v, currency = '') {
    const amount = num(v).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2});
    return currency ? `${amount} ${currency}` : amount;
  }

  function metaPanel() {
    const candidates = [...document.querySelectorAll('.triple .mini')];
    return candidates.find(x => x.querySelector('h3')?.textContent.includes('ข้อมูลจาก Meta')) || null;
  }

  function metaChip() { return document.querySelector('.meta-state'); }
  function spendCard() { return document.querySelector('.kpis .kpi'); }

  function setChip(text, mode = 'wait') {
    const chip = metaChip(); if (!chip) return;
    chip.textContent = text;
    chip.style.color = mode === 'ok' ? '#56d364' : mode === 'err' ? '#f85149' : '#f0ad4e';
  }

  function setSpend(value, currency, sub) {
    const card = spendCard(); if (!card) return;
    const val = card.querySelector('.kpi-val');
    const subEl = card.querySelector('.kpi-sub');
    if (val) {
      val.textContent = value == null ? '—' : fmtMoney(value, currency);
      val.classList.toggle('waiting', value == null);
      val.classList.toggle('real', value != null);
    }
    if (subEl) subEl.textContent = sub || (value == null ? 'รอเชื่อม Meta' : 'ข้อมูลจริงจาก Meta Ads');
  }

  function renderNotConfigured(status) {
    setChip('● Meta · ต้องตั้งค่า', 'wait');
    setSpend(null, '', 'ยังไม่ได้ตั้งค่า Meta ฝั่ง Vercel');
    const panel = metaPanel(); if (!panel) return;
    panel.innerHTML = `<h3>ข้อมูลจาก Meta</h3><div class="muted-box" style="text-align:left">
      <div style="font-weight:800;color:#f0ad4e;margin-bottom:8px">⚙️ ยังตั้งค่า Meta ไม่ครบ</div>
      <div style="line-height:1.8">ต้องมี Environment Variables ฝั่ง Vercel:<br>
      <code>META_ACCESS_TOKEN</code><br><code>META_AD_ACCOUNT_ID</code><br><code>CASEMYP_META_DASHBOARD_KEY</code><br>
      <code>META_GRAPH_API_VERSION</code> (ถ้าไม่ใส่จะใช้ v26.0)</div>
      ${status ? `<div style="margin-top:8px;color:#8b949e">Token ${status.tokenConfigured?'✅':'❌'} · Ad Account ${status.adAccountConfigured?'✅':'❌'} · Dashboard Key ${status.dashboardKeyConfigured?'✅':'❌'}</div>` : ''}
    </div>`;
    removeMetaTable();
  }

  function renderKeyPrompt(message = '') {
    setChip('● Meta · รอยืนยัน', 'wait');
    const panel = metaPanel(); if (!panel) return;
    panel.innerHTML = `<h3>ข้อมูลจาก Meta</h3><div class="muted-box" style="text-align:left">
      <div style="font-weight:800;color:#79c0ff;margin-bottom:8px">🔐 ยืนยัน Meta Dashboard</div>
      <div style="font-size:11px;line-height:1.7;margin-bottom:10px">กุญแจนี้ใช้เฉพาะเปิดดูข้อมูลโฆษณา และเก็บใน session ของเบราว์เซอร์เท่านั้น</div>
      ${message ? `<div style="color:#f85149;font-size:11px;margin-bottom:8px">${esc(message)}</div>` : ''}
      <div style="display:flex;gap:7px"><input id="metaDashboardKey" type="password" autocomplete="off" placeholder="Meta Dashboard Key" style="flex:1;min-width:0;background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:8px;padding:8px 10px;font:inherit"><button id="metaKeySave" class="btn btn-primary" type="button">เชื่อม</button></div>
    </div>`;
    removeMetaTable();
    $('#metaKeySave', panel)?.addEventListener('click', () => {
      const value = String($('#metaDashboardKey', panel)?.value || '').trim();
      if (!value) return;
      state.key = value;
      try { sessionStorage.setItem(KEY_STORAGE, value); } catch (_) {}
      loadMeta(true);
    });
    $('#metaDashboardKey', panel)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') $('#metaKeySave', panel)?.click();
    });
  }

  function removeMetaTable() { document.getElementById('metaLiveTable')?.remove(); }

  function renderMetaTable(data) {
    let host = document.getElementById('metaLiveTable');
    if (!host) {
      host = document.createElement('section');
      host.id = 'metaLiveTable';
      host.className = 'card table-card';
      const existing = document.querySelector('.table-card');
      existing?.insertAdjacentElement('afterend', host);
    }
    const rows = Array.isArray(data.ads) ? data.ads : [];
    host.innerHTML = `<div class="table-head"><h3>📣 แอดจริงจาก Meta · ${esc(data.account?.name || 'Ad Account')}</h3><span class="chip">${rows.length.toLocaleString('th-TH')} แอด</span></div>
      <div class="table-scroll"><table><thead><tr>
        <th>Ad</th><th>Campaign</th><th>Spend</th><th>Reach</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>CPC</th><th>CPM</th><th>Leads</th><th>Messages</th>
      </tr></thead><tbody>${rows.length ? rows.map(r => `<tr>
        <td><b>${esc(r.adName || r.adId || '-')}</b></td><td>${esc(r.campaignName || '-')}</td>
        <td class="num">${fmtMoney(r.spend, data.account?.currency || '')}</td><td class="num">${fmtInt(r.reach)}</td><td class="num">${fmtInt(r.impressions)}</td><td class="num">${fmtInt(r.clicks)}</td>
        <td class="num">${fmtPct(r.ctr)}</td><td class="num">${fmt2(r.cpc)}</td><td class="num">${fmt2(r.cpm)}</td><td class="num">${fmtInt(r.leads)}</td><td class="num">${fmtInt(r.messages)}</td>
      </tr>`).join('') : '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:26px">ช่วงเวลานี้ยังไม่มีข้อมูลแอดจาก Meta</td></tr>'}</tbody></table></div>`;
  }

  function renderConnected(data) {
    const a = data.account || {};
    setChip('● Meta · เชื่อมแล้ว', 'ok');
    setSpend(a.spend, a.currency, `Meta Ads · ${data.graphVersion || ''}`);
    const panel = metaPanel(); if (panel) {
      panel.innerHTML = `<h3>ข้อมูลจาก Meta</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          ${[
            ['Reach',fmtInt(a.reach)],['Impressions',fmtInt(a.impressions)],['Clicks',fmtInt(a.clicks)],['CTR',fmtPct(a.ctr)],['CPC',fmt2(a.cpc)],['CPM',fmt2(a.cpm)],['Leads',fmtInt(a.leads)],['Messages',fmtInt(a.messages)]
          ].map(([k,v]) => `<div style="background:#12171d;border:1px solid #30363d;border-radius:8px;padding:9px"><div style="font-size:10px;color:#8b949e">${k}</div><div style="font-size:17px;font-weight:800;color:#79c0ff;margin-top:3px">${v}</div></div>`).join('')}
        </div>
        <div style="font-size:10px;color:#59636f;margin-top:9px">อัปเดต ${new Date(data.fetchedAt || Date.now()).toLocaleString('th-TH')} · ${esc(a.currency || '')}</div>`;
    }
    renderMetaTable(data);
  }

  function renderError(message) {
    setChip('● Meta · เชื่อมไม่สำเร็จ', 'err');
    const panel = metaPanel(); if (!panel) return;
    panel.innerHTML = `<h3>ข้อมูลจาก Meta</h3><div class="muted-box"><b style="color:#f85149">⚠️ ${esc(message || 'ดึงข้อมูล Meta ไม่สำเร็จ')}</b><br><button id="metaRetry" type="button" class="btn" style="margin-top:10px">ลองใหม่</button></div>`;
    $('#metaRetry', panel)?.addEventListener('click', () => loadMeta(true));
  }

  async function status() {
    try {
      const r = await fetch('/api/meta-insights?status=1', {cache:'no-store'});
      return await r.json();
    } catch (_) { return null; }
  }

  async function loadMeta(force = false) {
    if (state.loading) return;
    const range = activeRange();
    if (!force && state.lastRange === range && state.configured === false) return;
    state.loading = true;
    try {
      const st = await status();
      if (!st?.configured) {
        state.configured = false;
        state.lastRange = range;
        renderNotConfigured(st);
        return;
      }
      state.configured = true;
      if (!state.key) { renderKeyPrompt(); return; }

      setChip('● Meta · กำลังโหลด...', 'wait');
      const response = await fetch(`/api/meta-insights?range=${encodeURIComponent(range)}`, {
        cache: 'no-store', headers: {'x-casemyp-meta-key': state.key}
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        state.key = '';
        try { sessionStorage.removeItem(KEY_STORAGE); } catch (_) {}
        renderKeyPrompt(data?.message || 'กุญแจ Meta Dashboard ไม่ถูกต้อง');
        return;
      }
      if (!response.ok || !data?.ok) {
        renderError(data?.message || `Meta HTTP ${response.status}`);
        return;
      }
      state.lastRange = range;
      renderConnected(data);
    } catch (err) {
      renderError(err?.message || 'เชื่อม Meta ไม่สำเร็จ');
    } finally { state.loading = false; }
  }

  document.addEventListener('click', e => {
    if (e.target.closest('[data-range]')) setTimeout(() => loadMeta(true), 120);
    if (e.target.closest('#refreshBtn')) setTimeout(() => loadMeta(true), 120);
  });

  function boot() {
    const waitForPanel = () => {
      if (metaPanel()) loadMeta(true);
      else setTimeout(waitForPanel, 150);
    };
    waitForPanel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
