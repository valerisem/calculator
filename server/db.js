import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { DEFAULT_SETTINGS } from './engine/constants.js';
import { buildRateTable } from './engine/rates.js';

export const supabase = config.supabaseUrl && config.supabaseKey
  ? createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false } })
  : null;

export function db() {
  if (!supabase) throw Object.assign(new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured.'), { status: 503 });
  return supabase;
}

export async function must(promise) {
  const { data, error } = await promise;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return data;
}

// ---- settings ------------------------------------------------------------

export async function getSettings() {
  const row = await must(db().from('pc_settings').select('values').eq('id', 'default').maybeSingle());
  return { ...DEFAULT_SETTINGS, ...(row?.values || {}) };
}

export async function saveSettings(values, actor) {
  const clean = Object.fromEntries(Object.entries(values).filter(([k]) => k in DEFAULT_SETTINGS));
  const current = await must(db().from('pc_settings').select('values').eq('id', 'default').maybeSingle());
  const merged = { ...(current?.values || {}), ...clean };
  await must(db().from('pc_settings').upsert({ id: 'default', values: merged, updated_at: new Date().toISOString(), updated_by: actor }));
  await logEvent({ action: 'settings_changed', actor, payload: clean });
  return { ...DEFAULT_SETTINGS, ...merged };
}

// ---- rate table ----------------------------------------------------------

let rateCache = null;

async function fetchAll(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = await must(db().from(table).select(columns).order('id', { ascending: true }).range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function rebuildRates(actor) {
  const settings = await getSettings();
  const bookings = await fetchAll(
    'creator_bookings',
    'id,campaign_number,platform,location,tiktok_followers,instagram_followers,youtube_followers,avg_views,deliverables,fee_gbp,board_group',
  );
  const campaigns = await must(db().from('campaigns').select('pd_deal_id,wide_niche,account_owner_id').limit(10000));
  const { archetypes, flags, factors, stats } = buildRateTable(bookings, campaigns, settings);
  const params = {
    rateOwnerIds: settings.rateOwnerIds,
    keptGroupPattern: settings.keptGroupPattern,
    droppedGroupPattern: settings.droppedGroupPattern,
    planningPercentile: settings.planningPercentile,
    confidenceHigh: settings.confidenceHigh,
    confidenceMedium: settings.confidenceMedium,
  };
  const build = await must(
    db().from('pc_rate_builds').insert({ built_by: actor, params, stats, multi_video_factors: factors }).select().single(),
  );
  for (let i = 0; i < archetypes.length; i += 500) {
    await must(db().from('pc_rate_archetypes').insert(archetypes.slice(i, i + 500).map((a) => ({ ...a, build_id: build.id }))));
  }
  for (let i = 0; i < flags.length; i += 500) {
    await must(db().from('pc_rate_flags').insert(flags.slice(i, i + 500).map((f) => ({ ...f, build_id: build.id }))));
  }
  rateCache = null;
  return { buildId: build.id, stats, archetypes: archetypes.length, flags: flags.length };
}

export async function getRates() {
  if (rateCache && Date.now() - rateCache.at < 10 * 60 * 1000) return rateCache.data;
  const build = await must(db().from('pc_rate_builds').select('*').order('id', { ascending: false }).limit(1).maybeSingle());
  if (!build) return null;
  const archetypes = [];
  for (let from = 0; ; from += 1000) {
    const rows = await must(
      db().from('pc_rate_archetypes').select('*').eq('build_id', build.id).order('id').range(from, from + 999),
    );
    archetypes.push(...rows.map((r) => ({
      ...r,
      cost_p50: num(r.cost_p50),
      cost_p65: num(r.cost_p65),
      cost_p80: num(r.cost_p80),
      views_p25: num(r.views_p25),
      views_p50: num(r.views_p50),
      views_p75: num(r.views_p75),
    })));
    if (rows.length < 1000) break;
  }
  const data = { build, archetypes, factors: build.multi_video_factors };
  rateCache = { at: Date.now(), data };
  return data;
}

const num = (v) => (v == null ? null : Number(v));

// ---- audit ---------------------------------------------------------------

export async function logEvent({ proposalId = null, packageId = null, action, actor, payload = null }) {
  const { error } = await db().from('pc_events').insert({ proposal_id: proposalId, package_id: packageId, action, actor, payload });
  if (error) console.warn('event log failed', error.message);
}
