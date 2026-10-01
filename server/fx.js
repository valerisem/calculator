import { supabase } from './db.js';

// Exchange rates (units of each currency per 1 GBP) from the ECB reference
// rates via frankfurter.dev. The last good rates are kept in pc_settings
// (id 'fx') so a fresh server never waits on the rates service: it answers
// with the stored rates and refreshes in the background.
export const CURRENCIES = ['GBP', 'USD', 'EUR', 'AUD', 'CAD', 'SEK', 'PLN', 'CHF', 'NOK', 'DKK', 'SGD'];
const MAX_AGE = 12 * 3600 * 1000;

let cache = null; // { at, data }
let refreshing = null;

async function fetchRates() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=GBP&symbols=${CURRENCIES.filter((c) => c !== 'GBP').join(',')}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return { rates: { GBP: 1, ...json.rates }, date: json.date, source: 'ECB via frankfurter.dev' };
  } finally {
    clearTimeout(t);
  }
}

async function loadStored() {
  if (!supabase) return null;
  const { data } = await supabase.from('pc_settings').select('values, updated_at').eq('id', 'fx').maybeSingle();
  return data?.values?.rates ? { at: new Date(data.updated_at).getTime(), data: data.values } : null;
}

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const data = await fetchRates();
      cache = { at: Date.now(), data };
      if (supabase) await supabase.from('pc_settings').upsert({ id: 'fx', values: data, updated_at: new Date().toISOString() });
    } catch (e) {
      console.warn('FX refresh failed:', e.message);
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function getFx() {
  if (!cache) cache = await loadStored().catch(() => null);
  if (cache) {
    if (Date.now() - cache.at > MAX_AGE) refresh(); // stale: refresh without waiting
    return cache.data;
  }
  await refresh(); // nothing stored yet: wait (at most ~4 s)
  if (!cache) throw Object.assign(new Error('Exchange rates are unavailable right now.'), { status: 503 });
  return cache.data;
}
