import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireMonday, signDownload, verifyDownload } from './auth.js';
import { config } from './config.js';
import { db, getRates, getSettings, logEvent, must, rebuildRates, saveSettings, supabase } from './db.js';
import { calculate, calculateSet, suggestMix } from './engine/calculator.js';
import { OBJECTIVES, PLATFORMS, SIZE_BANDS } from './engine/constants.js';
import { CURRENCIES, getFx } from './fx.js';
import * as pipedrive from './pipedrive.js';
import { buildSlide } from './slide.js';

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

api.get('/settings', wrap(async (_req, res) => res.json(await getSettings())));
api.put('/settings', wrap(async (req, res) => res.json(await saveSettings(req.body || {}, req.user.label))));

// ---- Pipedrive -------------------------------------------------------------

api.get('/pipedrive/deals', wrap(async (req, res) => res.json(await pipedrive.listDeals(req.query.term))));
// Deal + values to prefill the calculator (nothing is saved).
api.get('/pipedrive/deals/:id', wrap(async (req, res) => res.json(await pipedrive.getDeal(Number(req.params.id)))));
// Options for required deal fields (Source channel).
api.get('/pipedrive/deal-options', wrap(async (_req, res) => res.json(await pipedrive.dealFieldOptions())));
api.get('/pipedrive/orgs', wrap(async (req, res) => res.json(await pipedrive.searchOrganizations(req.query.term))));
api.post('/pipedrive/deals', wrap(async (req, res) => {
  const { title, orgId, orgName, currency, value, channel } = req.body || {};
  if (!title || !(orgId || orgName)) return res.status(400).json({ error: 'Deal title and client are required.' });
  if (!channel) return res.status(400).json({ error: 'Source channel is required in Pipedrive.' });
  const deal = await pipedrive.createDeal({ title, orgId, orgName, currency, value, channel });
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
  const { deal, prefill } = await pipedrive.getDeal(dealId);
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

async function calcContext() {
  const [settings, rates, fx] = await Promise.all([getSettings(), getRates(), getFx()]);
  if (!rates) throw Object.assign(new Error('The rate table has not been built yet. Open Settings and rebuild rates.'), { status: 409 });
  return { ctx: { archetypes: rates.archetypes, factors: rates.factors, settings, fx: fx.rates }, buildId: rates.build.id };
}

async function runCalc(inputs) {
  const { ctx, buildId } = await calcContext();
  return { result: calculate(inputs, ctx), buildId };
}

// The calculator screen: your creators + suggested mixes at the same price.
api.post('/calculate', wrap(async (req, res) => {
  const { ctx } = await calcContext();
  const set = calculateSet(req.body?.inputs || {}, ctx);
  res.status(set.ok ? 200 : 422).json(set);
}));

// Number of creators -> "Your creators" lines.
api.post('/suggest-mix', wrap(async (req, res) => {
  const { ctx } = await calcContext();
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
    expected_margin: i.expectedMargin,
    agreed_price: i.agreedPrice,
    real_margin: i.realMargin,
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
    confidence: sizes[c.key]?.confidence,
    fallback_level: sizes[c.key]?.level,
  }));
  if (rows.length) await must(db().from('pc_package_lines').insert(rows));
}

// Saves one or more packages to a proposal: { packages: [{ name, kind, inputs }] }.
api.post('/proposals/:id/packages', wrap(async (req, res) => {
  const list = req.body?.packages || [req.body];
  const { ctx, buildId } = await calcContext();
  const results = list.map((p) => ({ p, result: calculate(p.inputs || {}, ctx) }));
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
  // An approved package that changes is re-synced to Pipedrive.
  if (pkg.is_approved) await syncToPipedrive(pkg, req.user.label);
  res.json(pkg);
}));

api.delete('/packages/:id', wrap(async (req, res) => {
  const pkg = await must(db().from('pc_packages').select('id,proposal_id,is_approved').eq('id', req.params.id).single());
  if (pkg.is_approved) await must(db().from('pc_proposals').update({ status: 'draft', approved_package_id: null }).eq('id', pkg.proposal_id));
  await must(db().from('pc_packages').delete().eq('id', pkg.id));
  await logEvent({ proposalId: pkg.proposal_id, action: 'package_deleted', actor: req.user.label, payload: { packageId: pkg.id } });
  res.json({ ok: true });
}));

api.post('/packages/:id/approve', wrap(async (req, res) => {
  const pkg = await must(db().from('pc_packages').select('*').eq('id', req.params.id).single());
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
  if (req.body?.options) {
    await must(db().from('pc_packages').update({ slide_options: req.body.options }).eq('id', req.params.id));
  }
  const token = signDownload(req.params.id, req.user.label);
  res.json({ url: `${config.publicUrl}/download/packages/${req.params.id}/slide?t=${token}` });
}));

api.get('/packages/:id/slide', wrap(async (req, res) => sendSlide(req.params.id, req.user.label, res)));

async function sendSlide(packageId, actor, res) {
  const pkg = await must(db().from('pc_packages').select('*').eq('id', packageId).single());
  const proposal = await must(db().from('pc_proposals').select('*').eq('id', pkg.proposal_id).single());
  const settings = await getSettings();
  const options = {
    theme: settings.slideTheme,
    part: settings.slidePart,
    subtitle: settings.slideSubtitle,
    badge: settings.slideBadge,
    extraLines: settings.slideExtraLines,
    salesNote: settings.slideSalesNote,
    oneLine: '',
    estimatedSales: '',
    ...(pkg.slide_options || {}),
  };
  const { buffer, fileName } = await buildSlide({ proposal, pkg, options });
  await must(db().from('pc_slides').insert({ package_id: pkg.id, file_name: fileName, created_by: actor, options }));
  await logEvent({ proposalId: proposal.id, packageId: pkg.id, action: 'slide_generated', actor });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
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
