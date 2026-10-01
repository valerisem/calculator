// Exchange rates (units of each currency per 1 GBP) from the ECB reference
// rates via frankfurter.dev, cached for 12 hours.
export const CURRENCIES = ['GBP', 'USD', 'EUR', 'AUD', 'CAD', 'SEK', 'PLN', 'CHF', 'NOK', 'DKK', 'SGD'];

let cache = null;

export async function getFx() {
  if (cache && Date.now() - cache.at < 12 * 3600 * 1000) return cache.data;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=GBP&symbols=${CURRENCIES.filter((c) => c !== 'GBP').join(',')}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    cache = { at: Date.now(), data: { rates: { GBP: 1, ...json.rates }, date: json.date, source: 'ECB via frankfurter.dev' } };
  } catch (e) {
    console.warn('FX fetch failed:', e.message);
    if (!cache) throw Object.assign(new Error('Exchange rates are unavailable right now.'), { status: 503 });
  }
  return cache.data;
}
