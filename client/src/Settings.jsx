import React, { useState } from 'react';
import { api, notify } from './api.js';
import { fmtDate, fmtInt } from './format.js';

const FIELDS = [
  ['targetMargin', 'Default target margin', 'fraction', 'e.g. 0.5 = 50%'],
  ['giftingCostPerCreatorGbp', 'Gifting cost per gifted creator (GBP)', 'number', 'Product + shipping per gifted creator'],
  ['giftedPostingRate', 'Gifted posting rate', 'fraction', 'Share of gifted creators who post'],
  ['reachRatio', 'Reach ratio', 'fraction', 'Reach = views × this'],
  ['boostingCostPer1000Usd', 'Boosting cost per 1,000 views (USD)', 'number', ''],
  ['promisePercentile', 'Promise percentile', 'number', '10 = views beaten in 90% of runs'],
  ['simulationRuns', 'Simulation runs', 'number', ''],
  ['firstOfferShare', 'First offer (share of P50 cost)', 'fraction', ''],
  ['minimumBudgetGbp', 'Minimum budget warning (GBP)', 'number', ''],
  ['marginWarning', 'Margin warning below', 'fraction', ''],
  ['defaultVideosPerCreator', 'Default videos per creator', 'number', ''],
];

const RATE_FIELDS = [
  ['rateOwnerIds', 'Account owners whose campaigns feed the rates', 'ids', 'Team ids, comma separated (9 = Ritchie). Empty = all campaigns.'],
  ['keptGroupPattern', 'Kept board groups (regex)', 'text', ''],
  ['droppedGroupPattern', 'Dropped board groups (regex)', 'text', ''],
  ['planningPercentile', 'Planning cost percentile', 'number', ''],
  ['confidenceHigh', 'High confidence from (records)', 'number', ''],
  ['confidenceMedium', 'Medium confidence from (records)', 'number', ''],
];

export default function Settings({ meta, onChanged }) {
  const [values, setValues] = useState(meta.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const build = meta.rateBuild;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/settings', { method: 'PUT', body: values });
      notify('Settings saved');
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/settings', { method: 'PUT', body: values });
      const out = await api('/rates/rebuild', { method: 'POST' });
      notify(`Rate table rebuilt from ${fmtInt(out.stats.used)} bookings`);
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const field = ([key, label, type, hint]) => (
    <label key={key}>
      {label}
      <input
        type={type === 'text' || type === 'ids' ? 'text' : 'number'}
        step={type === 'fraction' ? '0.01' : 'any'}
        value={type === 'ids' ? (values[key] || []).join(', ') : values[key] ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          const v = type === 'ids'
            ? raw.split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => !Number.isNaN(n))
            : type === 'text' ? raw : raw === '' ? null : Number(raw);
          setValues({ ...values, [key]: v });
        }}
      />
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );

  return (
    <div className="page">
      <h1>Settings</h1>
      {error && <div className="callout error">{error}</div>}
      <section className="card">
        <h2>Calculator defaults</h2>
        <div className="grid-3">{FIELDS.map(field)}</div>
        <div className="row end">
          <button className="primary" disabled={busy} onClick={save}>Save settings</button>
        </div>
      </section>

      <section className="card">
        <h2>Rate table</h2>
        {build ? (
          <p className="muted">
            Build #{build.id}, {fmtDate(build.builtAt)}: {fmtInt(build.stats.used)} creator bookings used of {fmtInt(build.stats.bookings)}
            {' '}({fmtInt(build.stats.notOwner)} from other owners' campaigns, {fmtInt(build.stats.droppedGroup)} in shortlist or other groups,
            {' '}{fmtInt(build.stats.noFollowers)} without followers, {fmtInt(build.stats.flagged)} flagged as outliers).
          </p>
        ) : (
          <p className="muted">Not built yet.</p>
        )}
        <div className="grid-3">{RATE_FIELDS.map(field)}</div>
        <div className="row end">
          <button className="primary" disabled={busy} onClick={rebuild}>{busy ? 'Working…' : 'Save & rebuild rate table'}</button>
        </div>
      </section>

      {meta.fx && (
        <section className="card">
          <h2>Exchange rates</h2>
          <p className="muted small">Per 1 GBP, {meta.fx.source}, {meta.fx.date}</p>
          <div className="chips">
            {Object.entries(meta.fx.rates).map(([c, r]) => <span key={c} className="chip">{c} {r}</span>)}
          </div>
        </section>
      )}
    </div>
  );
}
