import { config } from './config.js';
import { normaliseMarket } from './engine/rates.js';

const BASE = 'https://api.pipedrive.com/v1';

async function pd(path, { method = 'GET', query = {}, body } = {}) {
  if (!config.pipedriveToken) throw httpError(503, 'PIPEDRIVE_API_TOKEN is not configured.');
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, v);
  url.searchParams.set('api_token', config.pipedriveToken);
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw httpError(res.status >= 400 ? 502 : 500, `Pipedrive ${method} ${path}: ${json.error || res.statusText}`);
  }
  return json;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const dealSummary = (d) => ({
  id: d.id,
  title: d.title,
  value: d.value,
  currency: d.currency,
  status: d.status,
  stageId: d.stage_id,
  orgId: d.org_id?.value ?? d.org_id ?? d.organization?.id ?? null,
  orgName: d.org_name ?? d.org_id?.name ?? d.organization?.name ?? null,
  ownerName: d.owner_name ?? d.owner?.name ?? null,
  updateTime: d.update_time,
  url: dealUrl(d.id),
});

let companyDomain = config.pipedriveDomain;
export const dealUrl = (id) => (companyDomain ? `https://${companyDomain}.pipedrive.com/deal/${id}` : null);

// Company domain for deal links, from the token's own user when not configured.
export async function loadCompanyDomain() {
  if (companyDomain || !config.pipedriveToken) return;
  try {
    const r = await pd('/users/me');
    companyDomain = r.data?.company_domain || null;
  } catch (e) {
    console.warn('Pipedrive company domain lookup failed:', e.message);
  }
}

export async function listDeals(term) {
  if (term && term.trim().length >= 2) {
    const r = await pd('/deals/search', { query: { term: term.trim(), fields: 'title', status: 'open', limit: 30 } });
    return (r.data?.items || []).map((i) => dealSummary(i.item));
  }
  const r = await pd('/deals', { query: { status: 'open', sort: 'update_time DESC', limit: 50 } });
  return (r.data || []).map(dealSummary);
}

export async function searchOrganizations(term) {
  if (!term || term.trim().length < 2) return [];
  const r = await pd('/organizations/search', { query: { term: term.trim(), limit: 20 } });
  return (r.data?.items || []).map((i) => ({ id: i.item.id, name: i.item.name }));
}

// Pipedrive marks Source channel as mandatory for deals; the form asks for it.
export async function dealFieldOptions() {
  if (!dealFieldsCache) {
    const r = await pd('/dealFields', { query: { limit: 500 } });
    dealFieldsCache = r.data || [];
  }
  const channel = dealFieldsCache.find((f) => f.key === 'channel');
  return { channel: (channel?.options || []).map((o) => ({ id: o.id, label: o.label })) };
}

export async function createDeal({ title, orgId, orgName, currency, value, channel }) {
  let org = orgId;
  if (!org && orgName) {
    const created = await pd('/organizations', { method: 'POST', body: { name: orgName } });
    org = created.data.id;
  }
  const r = await pd('/deals', {
    method: 'POST',
    body: { title, org_id: org || undefined, currency: currency || 'GBP', value: value || undefined, stage_id: config.pipedriveStageId, channel: channel || undefined },
  });
  return dealSummary(r.data);
}

let dealFieldsCache = null;
async function optionLabels(fieldKey) {
  if (!dealFieldsCache) {
    const r = await pd('/dealFields', { query: { limit: 500 } });
    dealFieldsCache = r.data || [];
  }
  const f = dealFieldsCache.find((x) => x.key === fieldKey);
  return Object.fromEntries((f?.options || []).map((o) => [String(o.id), o.label]));
}

/** Deal plus the values used to prefill a package. */
export async function getDeal(id) {
  const r = await pd(`/deals/${id}`);
  const d = r.data;
  const deal = dealSummary(d);
  const prefill = { campaign: d.title, currency: d.currency, budget: d.value || null };
  try {
    const raw = d[config.pdFields.targetCountry];
    if (raw) {
      const labels = await optionLabels(config.pdFields.targetCountry);
      // Target Country can hold several countries.
      prefill.markets = [...new Set(String(raw).split(',').map((id) => normaliseMarket(labels[id.trim()] || id.trim())).filter(Boolean))];
    }
    const pm = d[config.pdFields.paidMediaSpend];
    if (pm) prefill.paidMedia = Number(pm);
    if (deal.orgId) {
      const org = await pd(`/organizations/${deal.orgId}`);
      const niche = org.data?.[config.pdFields.orgWideNiche];
      if (niche) prefill.niche = niche;
    }
  } catch (e) {
    console.warn('deal prefill failed', e.message);
  }
  return { deal, prefill };
}

/** Writes the approved package back to the deal: value, custom fields and a note. */
export async function syncApprovedPackage(dealId, pkg, fxPerGbp) {
  const r = pkg.result;
  const price = r.client.price; // final quote, after any commercial adjustment
  const margin = r.internal.expectedMargin; // effective margin at that price
  const f = config.pdFields;
  const body = {
    value: price,
    currency: r.currency,
    [f.projectedMargin]: Math.round(margin * 1000) / 10,
    [f.numberOfInfluencers]: r.client.totalCreators + r.client.giftedCreators,
  };
  const media = typeof r.inputs.paidMedia === 'object' ? r.inputs.paidMedia.spend : r.inputs.paidMedia;
  if (media) {
    body[f.paidMediaSpend] = media;
    body[`${f.paidMediaSpend}_currency`] = r.currency;
  }
  if (r.inputs.otherCosts) {
    body[f.brandUpliftGbp] = Math.round((r.inputs.otherCosts / fxPerGbp) * 100) / 100;
    body[`${f.brandUpliftGbp}_currency`] = 'GBP';
  }
  await pd(`/deals/${dealId}`, { method: 'PUT', body });

  const fmt = (n) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 });
  const lines = r.client.creators
    .map((c) => `<li>${c.count} × ${c.label}, ${c.platform}, ${escapeHtml(c.market)}, ${c.videosEach} videos each</li>`)
    .join('');
  const content = [
    `<b>Approved package: ${escapeHtml(pkg.name)}</b>`,
    `<p>${escapeHtml([r.inputs.campaign, (r.inputs.platforms || []).join(' & '), (r.inputs.markets || []).join(', '), r.inputs.niche].filter(Boolean).join(' · '))}</p>
    <p>Price: ${r.currency} ${fmt(price)} · Margin: ${(margin * 100).toFixed(1)}%` +
      (r.internal.adjusted
        ? ` · Standard quote ${r.currency} ${fmt(r.internal.standardPrice)} (${r.internal.adjustmentPct > 0 ? '+' : ''}${r.internal.adjustmentPct.toFixed(1)}%${r.internal.commercial?.reason ? `, ${escapeHtml(r.internal.commercial.reason)}` : ''})`
        : '') +
      '</p>',
    `<ul>${lines}</ul>`,
    `<p>Guaranteed views by tier: ${(r.client.tierGuarantees || []).map((t) => `${t.tier} ${fmt(t.guaranteedViews)}`).join(' · ')}</p>`,
    `<p>${fmt(r.client.totalVideos)} videos · ${fmt(r.client.viewsPromised)} guaranteed views overall` +
      (r.client.giftedCreators ? ` · ${r.client.giftedCreators} gifted creators` : '') +
      (r.client.boostedViews ? ` · ${fmt(r.client.boostedViews)} boosted views (separate)` : '') +
      '</p>',
    '<p><i>From the monday Package Calculator.</i></p>',
  ].join('');
  await pd('/notes', { method: 'POST', body: { deal_id: dealId, content } });
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
