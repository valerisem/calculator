import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireMonday, signDownload, verifyDownload } from './auth.js';
import { config } from './config.js';
import { db, getDealOwnerPdIds, getRates, getSettings, logEvent, must, rebuildRates, saveSettings, supabase } from './db.js';
import { ADJUSTMENT_REASONS, BOOST_PLATFORMS, EXCLUSIVITY, PRICING_CONTEXTS, RECOMMENDATIONS, USAGE_RIGHTS, calculate, rateCardKey, reconcile, suggestMix } from './engine/calculator.js';
import { calculateInWorker } from './calc-pool.js';
import { OBJECTIVES, PLATFORMS, SIZE_BANDS } from './engine/constants.js';
import { CURRENCIES, getFx } from './fx.js';
import * as pipedrive from './pipedrive.js';
import { OUTPUTS, buildDeck } from './deck.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    supabase: !!supabase,
    pipedrive: !!config.pipedriveToken,
    mondayAuth: config.mondaySecrets.length > 0,
  });
});

// Slide download via signed link (opened in a new tab, outside the iframe).
app.get('/download/packages/:id/slide', wrap(async (req, res) => {
  const user = verifyDownload(req.query.t, req.params.id);
  if (!user) return res.status(403).send('This download link has expired. Generate the slide again from monday.');
  await sendSlide(req.params.id, user, res);
}));

const api = express.Router();
api.use(requireMonday);

// ---- reference data --------------------------------------------------------

api.get('/meta', wrap(async (_req, res) => {
  const [settings, rates, fx] = await Promise.all([getSettings(), getRates(), getFx().catch(() => null)]);
  const markets = new Map();
  const niches = new Map();
  for (const a of rates?.archetypes || []) {
    if (a.level === 4) markets.set(a.market, (markets.get(a.market) || 0) + a.n_cost);
    if (a.level === 3) niches.set(a.niche, (niches.get(a.niche) || 0) + a.n_cost);
  }
  const sorted = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, records]) => ({ name, records }));
  res.json({
    settings,
    sizes: SIZE_BANDS.map(({ key, label, big }) => ({ key, label, big: !!big })),
    platforms: PLATFORMS,
    objectives: OBJECTIVES,
    currencies: CURRENCIES,
    deckOutputs: Object.entries(OUTPUTS).map(([key, o]) => ({ key, label: o.label })),
    usageRights: USAGE_RIGHTS,
    exclusivity: EXCLUSIVITY,
    boostPlatforms: BOOST_PLATFORMS,
    adjustmentReasons: ADJUSTMENT_REASONS,
    pricingContexts: PRICING_CONTEXTS,
    markets: sorted(markets),
    niches: sorted(niches),
    rateBuild: rates ? { id: rates.build.id, builtAt: rates.build.built_at, stats: rates.build.stats } : null,
    fx,
  });
}));

api.post('/rates/rebuild', wrap(async (req, res) => {
  const out = await rebuildRates(req.user.label);
  await logEvent({ action: 'rates_rebuilt', actor: req.user.label, payload: out });
  res.json(out);
}));

// Rate card: the cost per video the team enters for each market × platform ×
// size (GBP, for everyone). It is the only creator cost the calculator uses.
// History is shown next to it as guidance only, and only where that exact
// market + platform + size has reliable data.
api.get('/rates/card', wrap(async (req, res) => {
  const { market, platform } = req.query;
  if (!market || !platform) return res.status(400).json({ error: 'Choose a market and platform.' });
  const [settings, rates] = await Promise.all([getSettings(), getRates()]);
  const card = settings.planningRates || {};
  const minN = settings.confidenceHigh ?? 10;
  const minC = settings.minCampaigns ?? 3;
  res.json({
    rows: SIZE_BANDS.map((b) => {
      const h = (rates?.archetypes || []).find((a) => a.level === 2 && a.market === market && a.platform === platform && a.size_band === b.key);
      const reliable = h && h.cost_p50 != null && h.n_cost >= minN && (h.n_cost_campaigns ?? 0) >= minC;
      return {
        size: b.key,
        label: b.label,
        costPerVideo: card[rateCardKey(market, platform, b.key)] ?? null,
        historicalTypical: reliable ? Math.round(h.cost_p50) : null,
        historicalBookings: reliable ? h.n_cost : null,
        historicalCampaigns: reliable ? h.n_cost_campaigns : null,
      };
    }),
  });
}));

api.put('/rates/card', wrap(async (req, res) => {
  const { market, platform, size, rate } = req.body || {};
  if (!market || !PLATFORMS.includes(platform) || !SIZE_BANDS.some((b) => b.key === size)) {
    return res.status(400).json({ error: 'Market, platform and size are required.' });
  }
  const card = { ...((await getSettings()).planningRates || {}) };
  const key = rateCardKey(market, platform, size);
  if (rate === null || rate === '' || !(Number(rate) > 0)) delete card[key];
  else card[key] = Math.round(Number(rate) * 100) / 100;
  await saveSettings({ planningRates: card }, req.user.label);
  res.json({ ok: true });
}));

api.get('/settings', wrap(async (_req, res) => res.json(await getSettings())));
api.put('/settings', wrap(async (req, res) => res.json(await saveSettings(req.body || {}, req.user.label))));

// ---- Pipedrive -------------------------------------------------------------

// Only deals owned by the rate owners (Ritchie) and their pods.
api.get('/pipedrive/deals', wrap(async (req, res) => res.json(await pipedrive.listDeals(req.query.term, await getDealOwnerPdIds()))));
async function getAllowedDeal(id) {
  const out = await pipedrive.getDeal(id);
  if (!(await getDealOwnerPdIds()).includes(Number(out.deal.ownerId))) {
    throw Object.assign(new Error("This deal isn't owned by Ritchie or his pod."), { status: 403 });
  }
  return out;
}
// Deal + values to prefill the calculator (nothing is saved).
api.get('/pipedrive/deals/:id', wrap(async (req, res) => res.json(await getAllowedDeal(Number(req.params.id)))));
// Options for required deal fields (Source channel).
api.get('/pipedrive/deal-options', wrap(async (_req, res) => res.json(await pipedrive.dealFieldOptions())));
api.get('/pipedrive/orgs', wrap(async (req, res) => res.json(await pipedrive.searchOrganizations(req.query.term))));
api.post('/pipedrive/deals', wrap(async (req, res) => {
  const { title, orgId, orgName, currency, value, channel } = req.body || {};
  if (!title || !(orgId || orgName)) return res.status(400).json({ error: 'Deal title and client are required.' });
  if (!channel) return res.status(400).json({ error: 'Source channel is required in Pipedrive.' });
  const deal = await pipedrive.createDeal({ title, orgId, orgName, currency, value, channel, ownerId: (await getDealOwnerPdIds())[0] });
  await logEvent({ action: 'pipedrive_deal_created', actor: req.user.label, payload: deal });
  res.json(deal);
}));

// ---- proposals -------------------------------------------------------------

api.get('/proposals', wrap(async (_req, res) => {
  const rows = await must(
    db().from('pc_proposals')
      .select('id,pd_deal_id,deal_title,campaign_name,org_name,currency,status,updated_at,pc_packages!pc_packages_proposal_id_fkey(count)')
      .order('updated_at', { ascending: false })
      .limit(30),
  );
  res.json(rows.map((r) => ({ ...r, packages: r.pc_packages?.[0]?.count ?? 0, pc_packages: undefined })));
}));

// Opens (or creates) the proposal for a Pipedrive deal.
api.post('/proposals', wrap(async (req, res) => {
  const dealId = Number(req.body?.pdDealId);
  if (!dealId) return res.status(400).json({ error: 'pdDealId is required.' });
  const { deal, prefill } = await getAllowedDeal(dealId);
  const existing = await must(db().from('pc_proposals').select('*').eq('pd_deal_id', dealId).maybeSingle());
  const fields = {
    deal_title: deal.title,
    pd_org_id: deal.orgId,
    org_name: deal.orgName,
    currency: deal.currency || 'GBP',
    updated_at: new Date().toISOString(),
    ...(req.body?.campaignName ? { campaign_name: String(req.body.campaignName).trim() } : {}),
  };
  let proposal;
  if (existing) {
    proposal = await must(db().from('pc_proposals').update(fields).eq('id', existing.id).select().single());
  } else {
    proposal = await must(
      db().from('pc_proposals').insert({
        ...fields,
        pd_deal_id: dealId,
        monday_account_id: req.user.accountId || null,
        monday_board_id: Number(req.body?.boardId) || null,
        created_by_monday_id: req.user.userId || null,
      }).select().single(),
    );
    await logEvent({ proposalId: proposal.id, action: 'proposal_created', actor: req.user.label });
  }
  res.json({ proposal, deal, prefill });
}));

api.get('/proposals/:id', wrap(async (req, res) => {
  const proposal = await must(db().from('pc_proposals').select('*').eq('id', req.params.id).single());
  const packages = await must(db().from('pc_packages').select('*').eq('proposal_id', proposal.id).order('created_at'));
  res.json({ proposal, packages, dealUrl: pipedrive.dealUrl(proposal.pd_deal_id) });
}));

// ---- calculator & packages -------------------------------------------------

// Settings a person can change for their own calculation (inputs.settings).
// Saved packages keep them in their inputs, so they re-price the same way.
const PERSONAL_SETTINGS = [
  'giftedPostingRate', 'boostingCostPer1000Usd', 'paidMediaFee',
  'firstOfferShare', 'minimumBudgetGbp', 'marginWarning', 'balancedSizeBonus', 'balancedCreatorBonus',
  'guaranteeMinSample',
];
// Settings that are small tables of numbers (merged key by key).
const PERSONAL_TABLES = ['boostingCpmUsd'];

async function calcContext(inputs = {}) {
  const [settings, rates, fx] = await Promise.all([getSettings(), getRates(), getFx()]);
  if (!rates) throw Object.assign(new Error('The rate table is still being built. Try again in a minute.'), { status: 409 });
  const own = {};
  for (const k of PERSONAL_SETTINGS) {
    const v = inputs?.settings?.[k];
    if (v !== undefined && v !== null && v !== '' && !Number.isNaN(Number(v))) own[k] = Number(v);
  }
  if (inputs?.settings?.paidMediaFeeType) own.paidMediaFeeType = inputs.settings.paidMediaFeeType === 'fixed' ? 'fixed' : 'percent';
  for (const k of PERSONAL_TABLES) {
    const t = inputs?.settings?.[k];
    if (!t || typeof t !== 'object') continue;
    own[k] = { ...settings[k] };
    for (const [key, v] of Object.entries(t)) if (v !== null && v !== '' && !Number.isNaN(Number(v))) own[k][key] = Number(v);
  }
  return { ctx: { archetypes: rates.archetypes, factors: rates.factors, settings: { ...settings, ...own }, fx: fx.rates }, buildId: rates.build.id };
}

async function runCalc(inputs) {
  const { ctx, buildId } = await calcContext(inputs);
  return { result: calculate(inputs, ctx), buildId };
}

// The calculator screen: your creators + a recommended package per objective.
// Each package runs in a worker thread, in parallel; recent answers are cached.
const calcCache = new Map();
const CACHE_SIZE = 300;
api.post('/calculate', wrap(async (req, res) => {
  const raw = req.body?.inputs || {};
  const { ctx, buildId } = await calcContext(raw);
  const { campaign, ...priced } = raw; // the campaign name doesn't change the numbers
  const key = JSON.stringify([buildId, ctx.fx, ctx.settings, priced]); // a rate card or settings change re-prices
  if (calcCache.has(key)) return res.json(calcCache.get(key));
  const hasCreators = Object.values(raw.package || {}).some((n) => Number(n) > 0);
  const budget = Number(raw.budget) > 0;
  const [yours, ...recommended] = await Promise.all([
    hasCreators ? calculateInWorker({ ...raw, mode: 'package' }, ctx, buildId) : null,
    ...(budget
      ? RECOMMENDATIONS.map((r) =>
          calculateInWorker({ ...raw, mode: 'budget', objective: r.objective, commercial: {} }, ctx, buildId).then((x) => ({ ...r, ...x })),
        )
      : []),
  ]);
  const set = { ok: true, yours, recommended: reconcile(recommended) };
  calcCache.set(key, set);
  if (calcCache.size > CACHE_SIZE) calcCache.delete(calcCache.keys().next().value);
  res.json(set);
}));

// Number of creators -> "Your creators" lines.
api.post('/suggest-mix', wrap(async (req, res) => {
  const { ctx } = await calcContext(req.body?.inputs);
  const out = suggestMix(req.body?.inputs || {}, req.body?.creators, ctx);
  res.status(out.ok ? 200 : 422).json(out);
}));

const KINDS = ['yours', 'performance', 'balanced', 'content', 'custom'];

function packageColumns(result, kind) {
  const c = result.client;
  const i = result.internal;
  return {
    mode: KINDS.includes(kind) ? kind : 'custom',
    inputs: result.inputs,
    result,
    currency: result.currency,
    client_price: c.price,
    views_promised: c.viewsPromised,
    reach_promised: c.reachPromised,
    cpm: c.cpm,
    total_creators: c.totalCreators,
    total_videos: c.totalVideos,
    gifted_creators: c.giftedCreators,
    boosted_views: c.boostedViews,
    views_expected: i.viewsExpected,
    creator_money: i.creatorMoney,
    creator_money_allocated: i.creatorMoneyAllocated,
    // Standard vs final quote, adjustment reason/context and low/likely/high views
    // are kept in result.internal; these columns hold the headline figures.
    expected_margin: i.standardMargin,
    agreed_price: i.adjusted ? i.finalPrice : null,
    real_margin: i.expectedMargin,
  };
}

async function writeLines(packageId, result) {
  await must(db().from('pc_package_lines').delete().eq('package_id', packageId));
  const sizes = Object.fromEntries(result.internal.sizes.map((x) => [x.key, x]));
  const rows = result.client.creators.map((c, k) => ({
    package_id: packageId,
    size_band: c.size,
    platform: c.platform,
    market: c.market,
    creators: c.count,
    videos_each: c.videosEach,
    package_cost: sizes[c.key]?.packageCost,
    first_offer_per_video: result.internal.brief[k]?.firstOfferPerVideo,
    max_fee_per_video: result.internal.brief[k]?.maxFeePerVideo,
    target_views_per_video: result.internal.brief[k]?.targetViewsPerVideo,
    confidence: sizes[c.key] ? (sizes[c.key].viewsThin ? 'Low' : 'High') : null, // views data
    fallback_level: sizes[c.key]?.viewsLevel,
  }));
  if (rows.length) await must(db().from('pc_package_lines').insert(rows));
}

// Saves one or more packages to a proposal: { packages: [{ name, kind, inputs }] }.
api.post('/proposals/:id/packages', wrap(async (req, res) => {
  const list = req.body?.packages || [req.body];
  const results = [];
  let buildId = null;
  for (const p of list) {
    const c = await calcContext(p.inputs);
    buildId = c.buildId;
    results.push({ p, result: calculate(p.inputs || {}, c.ctx) });
  }
  const bad = results.find((r) => !r.result.ok);
  if (bad) return res.status(422).json({ error: `${bad.p.name || 'Package'}: ${bad.result.error}` });
  const saved = [];
  for (const { p, result } of results) {
    const pkg = await must(
      db().from('pc_packages').insert({
        proposal_id: req.params.id,
        name: p.name?.trim() || 'Package',
        rate_build_id: buildId,
        created_by: req.user.label,
        updated_by: req.user.label,
        ...packageColumns(result, p.kind),
      }).select().single(),
    );
    await writeLines(pkg.id, result);
    await logEvent({ proposalId: req.params.id, packageId: pkg.id, action: 'package_created', actor: req.user.label });
    saved.push(pkg);
  }
  await touchProposal(req.params.id);
  res.json(saved);
}));

api.put('/packages/:id', wrap(async (req, res) => {
  const current = await must(db().from('pc_packages').select('*').eq('id', req.params.id).single());
  const { name, inputs, kind } = req.body || {};
  const { result, buildId } = await runCalc(inputs || current.inputs);
  if (!result.ok) return res.status(422).json(result);
  const pkg = await must(
    db().from('pc_packages').update({
      name: name?.trim() || current.name,
      rate_build_id: buildId,
      version: current.version + 1,
      updated_by: req.user.label,
      updated_at: new Date().toISOString(),
      ...packageColumns(result, kind || current.mode),
    }).eq('id', current.id).select().single(),
  );
  await writeLines(pkg.id, result);
  await touchProposal(current.proposal_id);
  await logEvent({ proposalId: current.proposal_id, packageId: pkg.id, action: 'package_updated', actor: req.user.label, payload: { version: pkg.version } });
  // An approved package that changes is re-synced to Pipedrive (only with final pricing).
  if (pkg.is_approved && !result.needsRates?.length) await syncToPipedrive(pkg, req.user.label);
  res.json(pkg);
}));

api.delete('/packages/:id', wrap(async (req, res) => {
  const pkg = await must(db().from('pc_packages').select('id,proposal_id,is_approved').eq('id', req.params.id).single());
  if (pkg.is_approved) await must(db().from('pc_proposals').update({ status: 'draft', approved_package_id: null }).eq('id', pkg.proposal_id));
  await must(db().from('pc_packages').delete().eq('id', pkg.id));
  await logEvent({ proposalId: pkg.proposal_id, action: 'package_deleted', actor: req.user.label, payload: { packageId: pkg.id } });
  res.json({ ok: true });
}));

// A package whose creator sizes still need a cost per video has a provisional price only.
function requireRates(pkg) {
  const missing = pkg.result?.needsRates || [];
  if (missing.length) {
    throw Object.assign(new Error(`Cost per video required for ${missing.map((n) => `${n.label} (${n.platform}, ${n.market})`).join(', ')} before this package can be finalised.`), { status: 409 });
  }
}

api.post('/packages/:id/approve', wrap(async (req, res) => {
  const pkg = await must(db().from('pc_packages').select('*').eq('id', req.params.id).single());
  requireRates(pkg);
  await must(db().from('pc_packages').update({ is_approved: false, approved_at: null, approved_by: null }).eq('proposal_id', pkg.proposal_id).neq('id', pkg.id));
  const approved = await must(
    db().from('pc_packages').update({ is_approved: true, approved_at: new Date().toISOString(), approved_by: req.user.label })
      .eq('id', pkg.id).select().single(),
  );
  await must(db().from('pc_proposals').update({ status: 'approved', approved_package_id: pkg.id, updated_at: new Date().toISOString() }).eq('id', pkg.proposal_id));
  await logEvent({ proposalId: pkg.proposal_id, packageId: pkg.id, action: 'package_approved', actor: req.user.label });
  const sync = await syncToPipedrive(approved, req.user.label);
  res.json({ package: approved, pipedrive: sync });
}));

// Delivery check by the campaign team: not_reviewed | cm_reviewed | confirmed.
api.put('/packages/:id/review', wrap(async (req, res) => {
  const status = ['not_reviewed', 'cm_reviewed', 'confirmed'].includes(req.body?.status) ? req.body.status : null;
  if (!status) return res.status(400).json({ error: 'Unknown delivery status.' });
  const reviewedBy = String(req.body?.reviewedBy || '').trim() || null;
  const pkg = await must(
    db().from('pc_packages').update({
      delivery_status: status,
      reviewed_by: status === 'not_reviewed' ? null : reviewedBy,
      reviewed_at: status === 'not_reviewed' ? null : new Date().toISOString(),
    }).eq('id', req.params.id).select().single(),
  );
  await logEvent({ proposalId: pkg.proposal_id, packageId: pkg.id, action: 'delivery_review', actor: req.user.label, payload: { status, reviewedBy } });
  res.json(pkg);
}));

api.post('/packages/:id/unapprove', wrap(async (req, res) => {
  const pkg = await must(db().from('pc_packages').update({ is_approved: false, approved_at: null, approved_by: null }).eq('id', req.params.id).select().single());
  await must(db().from('pc_proposals').update({ status: 'draft', approved_package_id: null }).eq('id', pkg.proposal_id));
  await logEvent({ proposalId: pkg.proposal_id, packageId: pkg.id, action: 'package_unapproved', actor: req.user.label });
  res.json(pkg);
}));

async function syncToPipedrive(pkg, actor) {
  const proposal = await must(db().from('pc_proposals').select('pd_deal_id').eq('id', pkg.proposal_id).single());
  try {
    await pipedrive.syncApprovedPackage(proposal.pd_deal_id, pkg, pkg.result.fxPerGbp);
    await logEvent({ proposalId: pkg.proposal_id, packageId: pkg.id, action: 'pipedrive_synced', actor });
    return { ok: true };
  } catch (e) {
    await logEvent({ proposalId: pkg.proposal_id, packageId: pkg.id, action: 'pipedrive_sync_failed', actor, payload: { error: e.message } });
    return { ok: false, error: e.message };
  }
}

async function touchProposal(id) {
  await must(db().from('pc_proposals').update({ updated_at: new Date().toISOString() }).eq('id', id));
}

// ---- slide -----------------------------------------------------------------

// Saves the slide options for the package and returns a short-lived download link.
api.post('/packages/:id/slide-link', wrap(async (req, res) => {
  requireRates(await must(db().from('pc_packages').select('result').eq('id', req.params.id).single()));
  if (req.body?.options) {
    await must(db().from('pc_packages').update({ slide_options: req.body.options }).eq('id', req.params.id));
  }
  const token = signDownload(req.params.id, req.user.label);
  res.json({ url: `${config.publicUrl}/download/packages/${req.params.id}/slide?t=${token}` });
}));

api.get('/packages/:id/slide', wrap(async (req, res) => sendSlide(req.params.id, req.user.label, res)));

async function sendSlide(packageId, actor, res) {
  const pkg = await must(db().from('pc_packages').select('*').eq('id', packageId).single());
  requireRates(pkg);
  const proposal = await must(db().from('pc_proposals').select('*').eq('id', pkg.proposal_id).single());
  const settings = await getSettings();
  const options = {
    theme: settings.slideTheme,
    output: 'pricing',
    badge: settings.slideBadge,
    salesNote: settings.slideSalesNote,
    ...(pkg.slide_options || {}),
  };
  const { buffer, fileName, contentType } = await buildDeck({ proposal, pkg, options });
  await must(db().from('pc_slides').insert({ package_id: pkg.id, file_name: fileName, created_by: actor, options }));
  await logEvent({ proposalId: proposal.id, packageId: pkg.id, action: 'slide_generated', actor, payload: { output: options.output, theme: options.theme } });
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(buffer);
}

app.use('/api', api);

// ---- static client ---------------------------------------------------------

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

app.listen(config.port, async () => {
  console.log(`Package calculator listening on ${config.port}`);
  getFx().catch((e) => console.warn('FX warm-up failed:', e.message));
  await pipedrive.loadCompanyDomain();
  if (supabase) {
    try {
      if (!(await getRates())) {
        console.log('No rate table yet; building from creator_bookings…');
        console.log(await rebuildRates('startup'));
      }
    } catch (e) {
      console.error('Rate table check failed:', e.message);
    }
    // Rebuild the rate table from creator_bookings once a day.
    setInterval(() => {
      rebuildRates('daily').then((r) => console.log('Daily rate rebuild', r.stats)).catch((e) => console.error('Daily rate rebuild failed:', e.message));
    }, 24 * 3600 * 1000);
  }
});
