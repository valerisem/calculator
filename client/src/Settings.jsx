import React, { useState } from 'react';
import { api, notify } from './api.js';

const pct = (x) => `${Math.round(Number(x) * 100)}%`;

const FIELDS = [
  ['targetMargin', 'Default target margin', 'percent'],
  ['giftingCostPerCreatorGbp', 'Gifting cost per gifted creator (GBP)', 'number'],
  ['giftedPostingRate', 'Share of gifted creators who post', 'percent'],
  ['reachRatio', 'Reach as a share of views', 'percent'],
  ['boostingCostPer1000Usd', 'Boosting cost per 1,000 views (USD)', 'number'],
  ['firstOfferShare', 'First offer to creators (share of typical fee)', 'percent'],
  ['minimumBudgetGbp', 'Warn when the budget is below (GBP)', 'number'],
  ['marginWarning', 'Warn when the margin is below', 'percent'],
  ['defaultVideosPerCreator', 'Default videos per creator', 'number'],
];

const SLIDE_FIELDS = [
  ['slidePart', 'Part number', 'text'],
  ['slideSubtitle', 'Subtitle', 'text'],
  ['slideBadge', 'Badge', 'text'],
  ['slideSalesNote', 'Estimated sales note', 'text'],
];

export default function Settings({ meta, onChanged }) {
  const [values, setValues] = useState(meta.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const v = meta.settings;

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

  const field = ([key, label, type]) => (
    <label key={key}>
      {label}
      <input
        type={type === 'text' ? 'text' : 'number'}
        step="any"
        value={type === 'percent' ? (values[key] == null ? '' : Math.round(values[key] * 1000) / 10) : values[key] ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          const val = type === 'text' ? raw : raw === '' ? null : type === 'percent' ? Number(raw) / 100 : Number(raw);
          setValues({ ...values, [key]: val });
        }}
      />
      {type === 'percent' && <span className="muted small">%</span>}
    </label>
  );

  return (
    <div className="page">
      <h1 className="title">Settings</h1>
      {error && <div className="error-box">{error}</div>}

      <section className="card howto">
        <h2>How the price is worked out</h2>

        <h3>1. What one creator costs us</h3>
        <div className="formula">Creator cost = videos per creator × planning cost per video × multi-video factor</div>
        <dl>
          <dt>Planning cost per video</dt>
          <dd>What we paid per video for that kind of creator (size, platform, market, niche) in past campaigns. We use the 65th percentile: 65% of past bookings cost this or less, so most creators fit inside it.</dd>
          <dt>Multi-video factor</dt>
          <dd>The discount creators give when they make several videos, taken from past bookings. It stays at 1 until we have at least 10 bookings to measure it.</dd>
        </dl>

        <h3>2. Price to quote (Your creators)</h3>
        <div className="formula">Price = (all creator costs + boosting + paid media + gifting + brand lift / other) ÷ (1 − margin)</div>
        <p>With a {pct(v.targetMargin)} margin, a package that costs us £10,000 to deliver is quoted at £{Math.round(10000 / (1 - v.targetMargin)).toLocaleString('en-GB')}.</p>

        <h3>3. Package from a budget (Most views, Balanced, Most videos)</h3>
        <div className="formula">Creator money = budget × (1 − margin) − boosting − paid media − gifting − brand lift / other</div>
        <p>
          We then choose how many creators of each size fit inside the creator money. <b>Most views</b> gets the most views.
          <b> Balanced</b> gets the most views but rewards a mix: +{pct(v.balancedSizeBonus)} for each extra size and +{pct(v.balancedCreatorBonus)} for each extra creator.
          <b> Most videos</b> gets the most videos first, then the most views. Money left over buys one more of the cheapest creator; anything still left is the negotiation buffer.
        </p>

        <h3>4. Results we show the client</h3>
        <dl>
          <dt>Views (guaranteed)</dt>
          <dd>We run the campaign 5,000 times using past views for each creator type. The guarantee is the number beaten in 9 of 10 runs, rounded down to the nearest 10,000.</dd>
          <dt>Minimum reach</dt>
          <dd>Guaranteed views × {pct(v.reachRatio)}.</dd>
          <dt>Cost per view</dt>
          <dd>Price ÷ guaranteed views.</dd>
          <dt>eCPM</dt>
          <dd>Price ÷ guaranteed views × 1,000.</dd>
          <dt>Boosted views</dt>
          <dd>Boosting budget ÷ ${v.boostingCostPer1000Usd} × 1,000. Shown on its own line, never added to the guarantee.</dd>
          <dt>Gifted creators</dt>
          <dd>Cost {v.giftingCostPerCreatorGbp == null ? 'not set yet (counted as £0)' : `£${v.giftingCostPerCreatorGbp} each`}; we assume {pct(v.giftedPostingRate)} of them post one video.</dd>
        </dl>

        <h3>5. What stays internal</h3>
        <dl>
          <dt>Margin</dt>
          <dd>(price − everything it costs us to deliver) ÷ price. Flagged below {pct(v.marginWarning)}.</dd>
          <dt>Creator brief</dt>
          <dd>First offer = {pct(v.firstOfferShare)} of the typical (median) fee per video; maximum = the planning cost per video.</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Calculator settings</h2>
        <div className="grid-3">{FIELDS.map(field)}</div>
        <h2 style={{ marginTop: 28 }}>Slide defaults</h2>
        <div className="grid-3">{SLIDE_FIELDS.map(field)}</div>
        <label style={{ marginTop: 18 }}>
          Extra lines on every slide (one per line, e.g. usage rights, free extras)
          <textarea
            rows={3}
            value={(values.slideExtraLines || []).join('\n')}
            onChange={(e) => setValues({ ...values, slideExtraLines: e.target.value.split('\n') })}
          />
        </label>
        <div className="row end">
          <button className="primary" disabled={busy} onClick={() => save()}>Save settings</button>
        </div>
      </section>
    </div>
  );
}
