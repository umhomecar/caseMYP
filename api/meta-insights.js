const crypto = require('node:crypto');

const GRAPH_DEFAULT_VERSION = 'v26.0';
const VALID_RANGES = new Set(['all', '7d', '30d', 'month', '90d']);
const ACCOUNT_FIELDS = [
  'account_id', 'account_name', 'account_currency',
  'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'frequency', 'actions'
].join(',');
const AD_FIELDS = [
  'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name',
  'spend', 'impressions', 'reach', 'clicks', 'ctr', 'cpc', 'cpm', 'frequency', 'actions'
].join(',');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(body));
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb);
}

function pad(n) { return String(n).padStart(2, '0'); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function rangeParams(range) {
  if (range === 'all') return { date_preset: 'maximum' };
  const now = new Date();
  let since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'month') since = new Date(now.getFullYear(), now.getMonth(), 1);
  else {
    const days = Number(range.replace('d', '')) || 30;
    since.setDate(since.getDate() - (days - 1));
  }
  return { time_range: JSON.stringify({ since: ymd(since), until: ymd(now) }) };
}

function sumAction(actions, matcher) {
  return (Array.isArray(actions) ? actions : []).reduce((sum, item) => {
    const type = String(item?.action_type || '').toLowerCase();
    if (!matcher(type)) return sum;
    const value = Number(item?.value || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function summarizeActions(actions) {
  const leads = sumAction(actions, type => type === 'lead' || type.includes('lead_grouped') || type.endsWith('.lead'));
  const messages = sumAction(actions, type => type.includes('messaging_conversation_started'));
  return { leads, messages };
}

async function metaGet(url, token) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = null; }
  if (!response.ok) {
    const message = data?.error?.message || data?.error_user_msg || text || `Meta HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.metaCode = data?.error?.code || null;
    err.metaSubcode = data?.error?.error_subcode || null;
    throw err;
  }
  return data || {};
}

async function fetchAllPages(firstUrl, token, maxRows = 5000) {
  const rows = [];
  let next = firstUrl;
  let pages = 0;
  while (next && rows.length < maxRows && pages < 50) {
    const payload = await metaGet(next, token);
    if (Array.isArray(payload.data)) rows.push(...payload.data);
    next = payload?.paging?.next || '';
    pages += 1;
  }
  return rows.slice(0, maxRows);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
  }

  const token = String(process.env.META_ACCESS_TOKEN || '').trim();
  const rawAccountId = String(process.env.META_AD_ACCOUNT_ID || '').trim();
  const dashboardKey = String(process.env.CASEMYP_META_DASHBOARD_KEY || '').trim();
  const versionRaw = String(process.env.META_GRAPH_API_VERSION || GRAPH_DEFAULT_VERSION).trim();
  const graphVersion = /^v\d+\.\d+$/.test(versionRaw) ? versionRaw : GRAPH_DEFAULT_VERSION;

  if (String(req.query?.status || '') === '1') {
    return json(res, 200, {
      ok: true,
      configured: Boolean(token && rawAccountId && dashboardKey),
      tokenConfigured: Boolean(token),
      adAccountConfigured: Boolean(rawAccountId),
      dashboardKeyConfigured: Boolean(dashboardKey),
      graphVersion
    });
  }

  if (!token || !rawAccountId || !dashboardKey) {
    return json(res, 503, {
      ok: false,
      code: 'META_NOT_CONFIGURED',
      message: 'ยังไม่ได้ตั้งค่า Meta credentials ฝั่ง Vercel ครบ'
    });
  }

  const suppliedKey = String(req.headers['x-casemyp-meta-key'] || '').trim();
  if (!safeEqual(suppliedKey, dashboardKey)) {
    return json(res, 401, {
      ok: false,
      code: 'META_DASHBOARD_KEY_REQUIRED',
      message: 'ต้องยืนยันกุญแจ Meta Dashboard ก่อนดูข้อมูลโฆษณา'
    });
  }

  const range = VALID_RANGES.has(String(req.query?.range || '')) ? String(req.query.range) : '30d';
  const accountId = rawAccountId.replace(/^act_/i, '').replace(/\D/g, '');
  if (!accountId) {
    return json(res, 500, { ok: false, code: 'BAD_AD_ACCOUNT_ID', message: 'META_AD_ACCOUNT_ID ไม่ถูกต้อง' });
  }

  const rangeQuery = rangeParams(range);
  const base = `https://graph.facebook.com/${graphVersion}/act_${accountId}/insights`;

  try {
    const accountParams = new URLSearchParams({
      level: 'account',
      fields: ACCOUNT_FIELDS,
      limit: '10',
      time_increment: 'all_days',
      ...rangeQuery
    });
    const adParams = new URLSearchParams({
      level: 'ad',
      fields: AD_FIELDS,
      limit: '500',
      time_increment: 'all_days',
      ...rangeQuery
    });

    const [accountPayload, ads] = await Promise.all([
      metaGet(`${base}?${accountParams.toString()}`, token),
      fetchAllPages(`${base}?${adParams.toString()}`, token)
    ]);

    const account = Array.isArray(accountPayload.data) ? (accountPayload.data[0] || {}) : {};
    const accountActions = summarizeActions(account.actions);
    const adRows = ads.map(row => {
      const actions = summarizeActions(row.actions);
      return {
        adId: row.ad_id || '', adName: row.ad_name || '',
        adsetId: row.adset_id || '', adsetName: row.adset_name || '',
        campaignId: row.campaign_id || '', campaignName: row.campaign_name || '',
        spend: Number(row.spend || 0), impressions: Number(row.impressions || 0),
        reach: Number(row.reach || 0), clicks: Number(row.clicks || 0),
        ctr: Number(row.ctr || 0), cpc: Number(row.cpc || 0), cpm: Number(row.cpm || 0),
        frequency: Number(row.frequency || 0), leads: actions.leads, messages: actions.messages
      };
    }).sort((a, b) => b.spend - a.spend);

    return json(res, 200, {
      ok: true,
      range,
      graphVersion,
      account: {
        id: account.account_id || accountId,
        name: account.account_name || '',
        currency: account.account_currency || '',
        spend: Number(account.spend || 0),
        impressions: Number(account.impressions || 0),
        reach: Number(account.reach || 0),
        clicks: Number(account.clicks || 0),
        ctr: Number(account.ctr || 0),
        cpc: Number(account.cpc || 0),
        cpm: Number(account.cpm || 0),
        frequency: Number(account.frequency || 0),
        leads: accountActions.leads,
        messages: accountActions.messages
      },
      ads: adRows,
      adCount: adRows.length,
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Meta insights error', {
      message: error?.message,
      status: error?.status,
      metaCode: error?.metaCode,
      metaSubcode: error?.metaSubcode
    });
    return json(res, 502, {
      ok: false,
      code: 'META_API_ERROR',
      message: error?.message || 'ดึงข้อมูลจาก Meta ไม่สำเร็จ',
      metaCode: error?.metaCode || null,
      metaSubcode: error?.metaSubcode || null
    });
  }
};
