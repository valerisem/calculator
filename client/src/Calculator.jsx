import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, notify, openUrl } from './api.js';
import DealPicker from './DealPicker.jsx';
import PackageCard, { PackageDetails } from './PackageCard.jsx';
import { fmtInt } from './format.js';
import { SettingsPanel } from './Settings.jsx';
import AddOns from './AddOns.jsx';

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
    gifting: { enabled: false, creators: '', productCost: '', shippingCost: '', postingRate: '', clientCharge: '' },
    boostingLines: [],
    paidMedia: { platform: '', spend: '', feeType: meta.settings.paidMediaFeeType, fee: meta.settings.paidMediaFee },
    usage: { rights: 'organic', paidUsage: false, exclusivity: 'none' },
    otherCosts: 0,
    requiredVideos: '',
    minCreators: '',
    maxCreators: '',
    maxBigCreators: '',
    allowedSizes: meta.sizes.map((s) => s.key),
    package: {},
    settings: {},
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
export default function Calculator({ meta, initialInputs, editing, onSaved, onOpenProposal, onDefaultsSaved }) {
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
  const [deal, setDeal] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // run after a deal is picked
  // Number of creators: while auto is on, "Your creators" is rebuilt from it and the inputs above.
  const [creatorCount, setCreatorCount] = useState('');
  const [auto, setAuto] = useState(false);
  const seq = useRef(0);
  const mixSeq = useRef(0);

  const fullInputs = useMemo(() => ({ ...inputs, package: packageFromLines(lines) }), [inputs, lines]);
  // Only what changes the numbers triggers a recalculation (not the campaign name).
  const calcKey = useMemo(() => { const { campaign, ...rest } = fullInputs; return JSON.stringify(rest); }, [fullInputs]);

  useEffect(() => {
    if (!fullInputs.markets.length) {
      setSet(null);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      // "Your creators" is quick: show it first, then the recommended packages.
      const hasCreators = Object.keys(fullInputs.package || {}).length > 0;
      const quick = hasCreators && Number(fullInputs.budget) > 0
        ? api('/calculate', { method: 'POST', body: { inputs: { ...fullInputs, budget: '' } } })
            .then((r) => { if (mine === seq.current) setSet((prev) => ({ ...r, recommended: prev?.recommended || [], partial: true })); })
            .catch(() => {})
        : null;
      try {
        const r = await api('/calculate', { method: 'POST', body: { inputs: fullInputs } });
        await quick;
        if (mine === seq.current) {
          setSet(r);
          setError(null);
        }
      } catch (e) {
        if (mine === seq.current) setError(e.message);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcKey]);

  const mixKey = JSON.stringify([creatorCount, inputs.platforms, inputs.markets, inputs.niche, inputs.budget, inputs.currency, inputs.margin, inputs.videosPerCreator, inputs.allowedSizes]);
  useEffect(() => {
    if (!auto || !inputs.markets.length) return;
    const n = Number(creatorCount);
    if (!(n > 0)) {
      setLines([]);
      return;
    }
    const mine = ++mixSeq.current;
    const t = setTimeout(async () => {
      try {
        const r = await api('/suggest-mix', { method: 'POST', body: { inputs: { ...inputs, package: {} }, creators: n } });
        if (mine === mixSeq.current) setLines(linesFromPackage(r.package));
      } catch (e) {
        if (mine === mixSeq.current) setError(e.message);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, mixKey]);

  // Picking a deal fills in what Pipedrive knows about it.
  const pickDeal = async (d) => {
    setPicking(false);
    setDeal(d);
    try {
      const { prefill } = await api(`/pipedrive/deals/${d.id}`);
      const markets = (prefill.markets || []).filter((m) => meta.markets.some((x) => x.name === m));
      const next = {
        ...inputs,
        campaign: inputs.campaign || prefill.campaign || '',
        currency: meta.currencies.includes(prefill.currency) ? prefill.currency : inputs.currency,
        budget: inputs.budget || prefill.budget || '',
        markets: inputs.markets.length ? inputs.markets : markets,
        niche: inputs.niche || (meta.niches.some((n) => n.name === prefill.niche) ? prefill.niche : ''),
        paidMedia: Number(inputs.paidMedia?.spend) || !prefill.paidMedia ? inputs.paidMedia : { ...inputs.paidMedia, spend: prefill.paidMedia },
      };
      setInputs(next);
    } catch (e) {
      setError(e.message);
    }
    if (pendingAction) {
      const action = pendingAction;
      setPendingAction(null);
      action(d);
    }
  };

  const cards = [
    { kind: 'yours', name: 'Your creators', priceLabel: 'Price to quote', result: set?.yours, empty: 'Enter the number of creators or add them below.' },
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

  // Override estimated costs: save to the rate card (all proposals) or to this proposal only, then re-price.
  const enterRates = async (entries, toCard, fxPerGbp) => {
    if (toCard) {
      await Promise.all(entries.map((e) => api('/rates/card', { method: 'PUT', body: { market: e.market, platform: e.platform, size: e.size, rate: e.costPerVideo / (fxPerGbp || 1) } })));
      setInputs({ ...inputs, ratesVersion: Date.now() });
      return;
    }
    const same = (o, e) => o.size === e.size && o.platform === e.platform && o.market === e.market;
    const keep = (inputs.rateOverrides || []).filter((o) => !entries.some((e) => same(o, e)));
    setInputs({ ...inputs, rateOverrides: [...keep, ...entries.map(({ size, platform, market, costPerVideo }) => ({ size, platform, market, costPerVideo }))] });
  };
  // Editing a line by hand stops the automatic fill.
  const editLines = (next) => {
    setAuto(false);
    setLines(next);
    setCreatorCount(String(next.reduce((a, l) => a + (Number(l.count) || 0), 0) || ''));
  };
  const totals = lines.reduce((a, l) => ({ creators: a.creators + (Number(l.count) || 0) }), { creators: 0 });

  const useMix = (card) => {
    editLines(card.result.client.creators.map((c, i) => ({ id: `${c.key}-${Date.now()}-${i}`, platform: c.platform, market: c.market, size: c.size, count: c.count })));
    setSelected('yours');
  };

  const addLine = () => {
    const platform = inputs.platforms[0];
    const market = inputs.markets[0] || '';
    const used = new Set(lines.filter((l) => l.platform === platform && l.market === market).map((l) => l.size));
    const size = meta.sizes.find((s) => !used.has(s.key))?.key || meta.sizes[0].key;
    editLines([...lines, { id: `${size}-${Date.now()}`, platform, market, size, count: 1 }]);
  };
  const setLine = (idx, patch) => editLines(lines.map((x, j) => (j === idx ? { ...x, ...patch } : x)));
  const togglePlatform = (p) => {
    const on = inputs.platforms.includes(p);
    if (on && inputs.platforms.length === 1) return; // at least one platform
    setInputs({ ...inputs, platforms: on ? inputs.platforms.filter((x) => x !== p) : meta.platforms.filter((x) => x === p || inputs.platforms.includes(x)) });
  };
  const optionsWith = (list, current) => (current && !list.includes(current) ? [...list, current] : list);

  // Create proposal: every priced option is saved to the deal, chosen one first.
  // Saves every priced option to the deal's proposal (chosen one first).
  const save = async (d, { slide = false } = {}) => {
    if (!d) {
      setPendingAction(() => (picked) => save(picked, { slide }));
      setPicking(true);
      return;
    }
    setBusy(true);
    try {
      const { proposal } = await api('/proposals', { method: 'POST', body: { pdDealId: d.id, campaignName: inputs.campaign } });
      const ordered = [selectedCard, ...savable.filter((c) => c.kind !== selectedKind)].filter((c) => c?.result?.ok);
      const saved = await api(`/proposals/${proposal.id}/packages`, {
        method: 'POST',
        body: { packages: ordered.map((c) => ({ name: c.name, kind: c.kind, inputs: packageInputs(fullInputs, c) })) },
      });
      if (slide && saved[0]) {
        const { url } = await api(`/packages/${saved[0].id}/slide-link`, { method: 'POST' });
        openUrl(url);
      }
      notify('Proposal saved');
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
    <>
    <SettingsPanel
      meta={meta}
      inputs={inputs}
      onRatesSaved={() => setInputs({ ...inputs, ratesVersion: Date.now() })}
      defaults={meta.settings}
      values={inputs.settings || {}}
      onChange={(settings) => setInputs({ ...inputs, settings })}
      onDefaultsSaved={() => { setInputs({ ...inputs, settings: {} }); onDefaultsSaved?.(); }}
    />
    <div className="split">
      <section className="left">
        <h1 className="title">Creator calculator</h1>
        {!editing && (
          <div className="field">
            <span>Pipedrive deal</span>
            {deal ? (
              <div className="chips">
                <span className="chip-dark">
                  {deal.title}{deal.orgName ? ` · ${deal.orgName}` : ''}
                  <button aria-label="Change deal" onClick={() => setDeal(null)}>×</button>
                </span>
              </div>
            ) : (
              <button className="add" onClick={() => setPicking(true)}>Pick or create deal <span>+</span></button>
            )}
          </div>
        )}

        <label className="field">
          <span>Campaign</span>
          <input className="line" placeholder="Campaign name" value={inputs.campaign} onChange={set1('campaign')} />
        </label>

        <div className="field">
          <span>Platforms</span>
          <div className="pills">
            {meta.platforms.map((p) => (
              <button key={p} className={`pill ${inputs.platforms.includes(p) ? 'on' : ''}`} onClick={() => togglePlatform(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Markets</span>
          <MultiChipPicker
            values={inputs.markets}
            placeholder="Add market"
            options={meta.markets.map((m) => ({ value: m.name, label: m.name }))}
            onChange={(markets) => setInputs({ ...inputs, markets })}
          />
        </div>

        <div className="field">
          <span>Niche</span>
          <ChipPicker
            value={inputs.niche}
            placeholder="Add niche"
            options={meta.niches.map((n) => ({ value: n.name, label: n.name }))}
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
          <label className="field">
            <span>Number of creators</span>
            <input
              className="line"
              type="number"
              min="0"
              placeholder="e.g. 7"
              value={creatorCount}
              onChange={(e) => { setCreatorCount(e.target.value); setAuto(true); }}
            />
          </label>
        </div>

        <div className="dash" />

        <div className="section-head">
          <h2>Your creators</h2>
          <span className="muted small">{fmtInt(totals.creators)} creators · {fmtInt(totals.creators * inputs.videosPerCreator)} videos</span>
        </div>
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
              <button className="icon" aria-label="Remove line" onClick={() => editLines(lines.filter((_, j) => j !== idx))}>×</button>
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
          <h2>Add-ons & media</h2>
        </div>
        <AddOns meta={meta} inputs={inputs} setInputs={setInputs} sizes={[set?.yours, ...(set?.recommended || [])].flatMap((r) => (r?.ok ? r.internal.sizes : []))} />

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
              onEnterRates={enterRates}
            />
            {view === 'internal' && selectedKind === c.kind && <PackageDetails result={c.result} />}
          </React.Fragment>
        ))}

        <div className="right-foot">
          {editing ? (
            <button className="cta" disabled={busy || !selectedCard?.result?.ok} onClick={saveEdit}>
              Save to proposal <span>›</span>
            </button>
          ) : (
            <>
              <button className="ghost" disabled={busy || !selectedCard} onClick={() => save(deal, { slide: true })}>
                Download pricing slides
              </button>
              <button className="cta" disabled={busy || !savable.length} onClick={() => save(deal)}>
                Create proposal <span>›</span>
              </button>
            </>
          )}
        </div>
      </section>

      {picking && (
        <DealPicker
          defaultTitle={inputs.campaign}
          currency={inputs.currency}
          busy={busy}
          onClose={() => { setPicking(false); setPendingAction(null); }}
          onPick={pickDeal}
        />
      )}
    </div>
    </>
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
                  {o.label}
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
