import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, notify } from './api.js';
import DealPicker from './DealPicker.jsx';
import PackageCard, { PackageDetails } from './PackageCard.jsx';
import { fmtInt } from './format.js';

export function defaultInputs(meta) {
  return {
    campaign: '',
    platforms: ['TikTok'],
    markets: [],
    niche: '',
    currency: 'GBP',
    budget: '',
    margin: meta.settings.targetMargin,
    videosPerCreator: meta.settings.defaultVideosPerCreator,
    gifted: 0,
    boosting: 0,
    paidMedia: 0,
    otherCosts: 0,
    requiredVideos: '',
    minCreators: '',
    maxCreators: '',
    maxBigCreators: '',
    allowedSizes: meta.sizes.map((s) => s.key),
    package: {},
  };
}

// Inputs a saved package is stored with, so it re-prices to the same result.
export function packageInputs(inputs, card) {
  if (card.kind === 'yours') return { ...inputs, mode: 'package' };
  return { ...inputs, mode: 'budget', objective: card.objective };
}

// package keys are "platform|market|size".
const linesFromPackage = (pkg) =>
  Object.entries(pkg || {})
    .filter(([, n]) => Number(n) > 0)
    .map(([key, count], i) => {
      const [platform, market, size] = key.split('|');
      return { id: `${key}-${i}`, platform, market, size, count: Number(count) };
    });

const packageFromLines = (lines) => {
  const out = {};
  for (const l of lines) {
    if (!l.size || !l.platform || !l.market || !(Number(l.count) > 0)) continue;
    const key = `${l.platform}|${l.market}|${l.size}`;
    out[key] = (out[key] || 0) + Number(l.count);
  }
  return out;
};

/**
 * The calculator screen. editing = { packageId, proposalId, kind } when a saved
 * package was opened from a proposal.
 */
export default function Calculator({ meta, initialInputs, editing, onSaved, onOpenProposal }) {
  const [inputs, setInputs] = useState(() => ({ ...defaultInputs(meta), ...(initialInputs || {}) }));
  const [lines, setLines] = useState(() => linesFromPackage(initialInputs?.package));
  const [set, setSet] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('client');
  const [selected, setSelected] = useState(editing?.kind && editing.kind !== 'custom' ? editing.kind : 'yours');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const seq = useRef(0);

  const fullInputs = useMemo(() => ({ ...inputs, package: packageFromLines(lines) }), [inputs, lines]);

  useEffect(() => {
    if (!fullInputs.markets.length) {
      setSet(null);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await api('/calculate', { method: 'POST', body: { inputs: fullInputs } });
        if (mine === seq.current) {
          setSet(r);
          setError(null);
        }
      } catch (e) {
        if (mine === seq.current) setError(e.message);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [fullInputs]);

  const cards = [
    { kind: 'yours', name: 'Your creators', priceLabel: 'Price to quote', result: set?.yours, empty: 'Add creators below to price the package the client asked for.' },
    ...(set?.recommended?.length
      ? set.recommended.map((r) => ({ kind: r.kind, name: r.name, objective: r.objective, priceLabel: 'Price', result: r }))
      : [
          { kind: 'performance', name: 'Most views', objective: 'Performance', empty: 'Enter a client budget to see recommended packages.' },
          { kind: 'balanced', name: 'Balanced', objective: 'Balanced', empty: '' },
          { kind: 'content', name: 'Most videos', objective: 'Content', empty: '' },
        ]),
  ];
  // Keep a priced card selected: fall back to the first one that has a result.
  const selectedCard = cards.find((c) => c.kind === selected && c.result?.ok) || cards.find((c) => c.result?.ok);
  const selectedKind = selectedCard?.kind;
  const savable = cards.filter((c) => c.result?.ok);

  const set1 = (k) => (e) => setInputs({ ...inputs, [k]: e.target.value });
  const totals = lines.reduce((a, l) => ({ creators: a.creators + (Number(l.count) || 0) }), { creators: 0 });

  const useMix = (card) => {
    setLines(card.result.client.creators.map((c, i) => ({ id: `${c.key}-${Date.now()}-${i}`, platform: c.platform, market: c.market, size: c.size, count: c.count })));
    setSelected('yours');
  };

  const addLine = () => {
    const platform = inputs.platforms[0];
    const market = inputs.markets[0] || '';
    const used = new Set(lines.filter((l) => l.platform === platform && l.market === market).map((l) => l.size));
    const size = meta.sizes.find((s) => !used.has(s.key))?.key || meta.sizes[0].key;
    setLines([...lines, { id: `${size}-${Date.now()}`, platform, market, size, count: 1 }]);
  };
  const setLine = (idx, patch) => setLines(lines.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
  const togglePlatform = (p) => {
    const on = inputs.platforms.includes(p);
    if (on && inputs.platforms.length === 1) return; // at least one platform
    setInputs({ ...inputs, platforms: on ? inputs.platforms.filter((x) => x !== p) : meta.platforms.filter((x) => x === p || inputs.platforms.includes(x)) });
  };
  const optionsWith = (list, current) => (current && !list.includes(current) ? [...list, current] : list);

  // Create proposal: every priced option is saved to the deal, chosen one first.
  const createProposal = async (deal) => {
    setBusy(true);
    try {
      const { proposal } = await api('/proposals', { method: 'POST', body: { pdDealId: deal.id, campaignName: inputs.campaign } });
      const ordered = [selectedCard, ...savable.filter((c) => c.kind !== selectedKind)].filter((c) => c?.result?.ok);
      await api(`/proposals/${proposal.id}/packages`, {
        method: 'POST',
        body: { packages: ordered.map((c) => ({ name: c.name, kind: c.kind, inputs: packageInputs(fullInputs, c) })) },
      });
      notify('Proposal created');
      onOpenProposal(proposal.id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await api(`/packages/${editing.packageId}`, {
        method: 'PUT',
        body: { kind: selectedCard.kind, name: selectedCard.kind === editing.kind ? undefined : selectedCard.name, inputs: packageInputs(fullInputs, selectedCard) },
      });
      notify('Package updated');
      onSaved?.();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="split">
      <section className="left">
        <h1 className="title">Creator calculator</h1>
        {editing && <p className="muted small">Editing a saved package. Pick the option to keep and save it back to the proposal.</p>}

        <label className="field">
          <span>Campaign</span>
          <input className="line" placeholder="Campaign name" value={inputs.campaign} onChange={set1('campaign')} />
        </label>

        <div className="field">
          <span>Platforms <em>· recommended packages can use any of them</em></span>
          <div className="pills">
            {meta.platforms.map((p) => (
              <button key={p} className={`pill ${inputs.platforms.includes(p) ? 'on' : ''}`} onClick={() => togglePlatform(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Markets <em>· recommended packages can use any of them</em></span>
          <MultiChipPicker
            values={inputs.markets}
            placeholder="Add market"
            options={meta.markets.map((m) => ({ value: m.name, label: m.name, hint: `${m.records} records` }))}
            onChange={(markets) => setInputs({ ...inputs, markets })}
          />
        </div>

        <div className="field">
          <span>Niche <em>· optional</em></span>
          <ChipPicker
            value={inputs.niche}
            placeholder="Add niche"
            options={meta.niches.map((n) => ({ value: n.name, label: n.name, hint: `${n.records} records` }))}
            onChange={(v) => setInputs({ ...inputs, niche: v })}
          />
        </div>

        <div className="row2">
          <label className="field">
            <span>
              Client budget,{' '}
              <select className="inline-select" value={inputs.currency} onChange={set1('currency')}>
                {meta.currencies.map((c) => <option key={c}>{c}</option>)}
              </select>
            </span>
            <input className="line" type="number" min="0" placeholder="e.g. 25000" value={inputs.budget} onChange={set1('budget')} />
          </label>
          <label className="field">
            <span>Target margin</span>
            <strong className="slider-value">{Math.round(inputs.margin * 100)}%</strong>
            <input type="range" min="20" max="80" step="1" value={Math.round(inputs.margin * 100)} onChange={(e) => setInputs({ ...inputs, margin: Number(e.target.value) / 100 })} />
          </label>
        </div>

        <div className="row2">
          <label className="field">
            <span>Videos per creator</span>
            <strong className="slider-value">{inputs.videosPerCreator}</strong>
            <input type="range" min="1" max="10" step="1" value={inputs.videosPerCreator} onChange={(e) => setInputs({ ...inputs, videosPerCreator: Number(e.target.value) })} />
          </label>
          <div className="field">
            <span>&nbsp;</span>
            <p className="muted small">Same for every creator. Money short? Creators are removed, never videos.</p>
          </div>
        </div>

        <div className="dash" />

        <div className="section-head">
          <h2>Your creators</h2>
          <span className="muted small">{fmtInt(totals.creators)} creators · {fmtInt(totals.creators * inputs.videosPerCreator)} videos</span>
        </div>
        <p className="muted small">The package the client asked for. It is priced as a quote at your target margin.</p>
        {lines.map((l, idx) => (
          <div className="creator-line" key={l.id}>
            <div className="line-row top">
              <label className="field">
                <span>Creators</span>
                <input className="line" type="number" min="0" value={l.count} onChange={(e) => setLine(idx, { count: e.target.value })} />
              </label>
              <div className="field">
                <span>Videos each</span>
                <div className="line static">{inputs.videosPerCreator}</div>
              </div>
              <button className="icon" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== idx))}>×</button>
            </div>
            <div className="line-row">
              <label className="field">
                <span>Platform</span>
                <select className="line" value={l.platform} onChange={(e) => setLine(idx, { platform: e.target.value })}>
                  {optionsWith(inputs.platforms, l.platform).map((p) => <option key={p}>{p}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Market</span>
                <select className="line" value={l.market} onChange={(e) => setLine(idx, { market: e.target.value })}>
                  {!l.market && <option value="">Choose…</option>}
                  {optionsWith(inputs.markets, l.market).map((m) => <option key={m}>{m}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Size, followers</span>
                <select className="line" value={l.size} onChange={(e) => setLine(idx, { size: e.target.value })}>
                  {meta.sizes.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            </div>
          </div>
        ))}
        <button className="add" onClick={addLine}>Add creators <span>+</span></button>

        <div className="dash" />

        <div className="section-head">
          <h2>Extra costs</h2>
        </div>
        <div className="row2">
          <label className="field"><span>Gifted creators</span><input className="line" type="number" min="0" value={inputs.gifted} onChange={set1('gifted')} /></label>
          <label className="field"><span>Boosting budget, {inputs.currency}</span><input className="line" type="number" min="0" value={inputs.boosting} onChange={set1('boosting')} /></label>
          <label className="field"><span>Paid media, {inputs.currency}</span><input className="line" type="number" min="0" value={inputs.paidMedia} onChange={set1('paidMedia')} /></label>
          <label className="field"><span>Brand lift / other, {inputs.currency}</span><input className="line" type="number" min="0" value={inputs.otherCosts} onChange={set1('otherCosts')} /></label>
        </div>

        <button className="text-link toggle" onClick={() => setShowMore(!showMore)}>
          {showMore ? '− Hide' : '+ Show'} constraints for recommended packages
        </button>
        {showMore && (
          <>
            <div className="row2">
              <label className="field"><span>Required total videos</span><input className="line" type="number" min="0" value={inputs.requiredVideos} onChange={set1('requiredVideos')} /></label>
              <label className="field"><span>Max creators above 350k</span><input className="line" type="number" min="0" value={inputs.maxBigCreators} onChange={set1('maxBigCreators')} /></label>
              <label className="field"><span>Min creators</span><input className="line" type="number" min="0" value={inputs.minCreators} onChange={set1('minCreators')} /></label>
              <label className="field"><span>Max creators</span><input className="line" type="number" min="0" value={inputs.maxCreators} onChange={set1('maxCreators')} /></label>
            </div>
            <div className="field">
              <span>Allowed sizes</span>
              <div className="pills wrap">
                {meta.sizes.map((s) => {
                  const on = inputs.allowedSizes.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      className={`pill small ${on ? 'on' : ''}`}
                      onClick={() => setInputs({ ...inputs, allowedSizes: on ? inputs.allowedSizes.filter((k) => k !== s.key) : meta.sizes.map((x) => x.key).filter((k) => k === s.key || inputs.allowedSizes.includes(k)) })}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="right">
        <div className="right-head">
          <h1 className="title">Choose a package</h1>
          <div className="toggle-group">
            <button className={view === 'client' ? 'on' : ''} onClick={() => setView('client')}>Client</button>
            <button className={view === 'internal' ? 'on' : ''} onClick={() => setView('internal')}>Internal</button>
          </div>
        </div>

        {!inputs.markets.length && <div className="hint">Add a market to start.</div>}
        {error && <div className="error-box">{error}</div>}
        {loading && <div className="muted small">Calculating…</div>}

        {inputs.markets.length > 0 && cards.map((c) => (
          <React.Fragment key={c.kind}>
            <PackageCard
              title={c.name}
              priceLabel={c.priceLabel}
              result={c.result}
              empty={c.empty}
              view={view}
              selected={selectedKind === c.kind}
              accent={c.kind !== 'yours'}
              onSelect={() => setSelected(c.kind)}
              onUseMix={c.kind !== 'yours' && c.result?.ok ? () => useMix(c) : null}
            />
            {view === 'internal' && selectedKind === c.kind && <PackageDetails result={c.result} />}
          </React.Fragment>
        ))}

        <div className="right-foot">
          <p className="muted small">
            Indicative only. Views we promise are beaten in 9 of 10 simulated campaigns. Boosted views are never part of the promise.
          </p>
          {editing ? (
            <button className="cta" disabled={busy || !selectedCard?.result?.ok} onClick={saveEdit}>
              Save to proposal <span>›</span>
            </button>
          ) : (
            <button className="cta" disabled={busy || !savable.length} onClick={() => setPicking(true)}>
              Create proposal <span>›</span>
            </button>
          )}
        </div>
      </section>

      {picking && (
        <DealPicker
          defaultTitle={inputs.campaign}
          currency={inputs.currency}
          busy={busy}
          onClose={() => setPicking(false)}
          onPick={createProposal}
        />
      )}
    </div>
  );
}

// Several values: dark chips with ×, then "Add … +" with a searchable list.
function MultiChipPicker({ values, placeholder, options, onChange }) {
  return (
    <>
      {values.length > 0 && (
        <div className="chips">
          {values.map((v) => (
            <span className="chip-dark" key={v}>
              {v}
              <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
            </span>
          ))}
        </div>
      )}
      <ChipPicker value="" placeholder={placeholder} options={options.filter((o) => !values.includes(o.value))} onChange={(v) => v && onChange([...values, v])} />
    </>
  );
}

// Single-value chip: dark chip with × when set, "Add … +" with a searchable list when not.
function ChipPicker({ value, placeholder, options, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  if (value) {
    return (
      <div className="chips">
        <span className="chip-dark">
          {value}
          <button aria-label={`Remove ${value}`} onClick={() => onChange('')}>×</button>
        </span>
      </div>
    );
  }
  const shown = options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  return (
    <div className="picker">
      <button className="add" onClick={() => setOpen(!open)}>{placeholder} <span>+</span></button>
      {open && (
        <div className="popover">
          <input autoFocus className="line" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul>
            {shown.map((o) => (
              <li key={o.value}>
                <button onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}>
                  {o.label} <span className="muted small">{o.hint}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="muted small">No match</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
