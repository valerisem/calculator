import React, { useState } from 'react';

export default function PackageForm({ meta, inputs, onChange }) {
  const [showConstraints, setShowConstraints] = useState(false);
  const set = (k) => (e) => onChange({ ...inputs, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setPkg = (size, n) => onChange({ ...inputs, package: { ...inputs.package, [size]: n } });
  const toggleSize = (key) => {
    const s = new Set(inputs.allowedSizes);
    s.has(key) ? s.delete(key) : s.add(key);
    onChange({ ...inputs, allowedSizes: meta.sizes.map((x) => x.key).filter((k) => s.has(k)) });
  };
  const budgetMode = inputs.mode === 'budget';

  return (
    <div className="form">
      <div className="segmented">
        <button className={budgetMode ? 'active' : ''} onClick={() => onChange({ ...inputs, mode: 'budget' })}>
          Budget → package
        </button>
        <button className={!budgetMode ? 'active' : ''} onClick={() => onChange({ ...inputs, mode: 'package' })}>
          Package → price
        </button>
      </div>

      <div className="grid-3">
        <label>
          Currency
          <select value={inputs.currency} onChange={set('currency')}>
            {meta.currencies.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        {budgetMode && (
          <label className="span-2">
            Client budget (price to client)
            <input type="number" min="0" value={inputs.budget} onChange={set('budget')} placeholder="e.g. 25000" />
          </label>
        )}
        <label>
          Market
          <select value={inputs.market} onChange={set('market')}>
            <option value="">Choose…</option>
            {meta.markets.map((m) => (
              <option key={m.name} value={m.name}>{m.name} ({m.records})</option>
            ))}
          </select>
        </label>
        <label>
          Platform
          <select value={inputs.platform} onChange={set('platform')}>
            {meta.platforms.map((p) => <option key={p}>{p}</option>)}
          </select>
        </label>
        <label>
          Niche
          <select value={inputs.niche} onChange={set('niche')}>
            <option value="">Any niche</option>
            {meta.niches.map((n) => (
              <option key={n.name} value={n.name}>{n.name} ({n.records})</option>
            ))}
          </select>
        </label>
        {budgetMode && (
          <label>
            Objective
            <select value={inputs.objective} onChange={set('objective')}>
              {meta.objectives.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        )}
        <label>
          Target margin
          <div className="suffix">
            <input type="number" min="0" max="99" step="1" value={Math.round(Number(inputs.margin) * 100)} onChange={(e) => onChange({ ...inputs, margin: Number(e.target.value) / 100 })} />
            <span>%</span>
          </div>
        </label>
        <label>
          Videos per creator
          <input type="number" min="1" step="1" value={inputs.videosPerCreator} onChange={set('videosPerCreator')} />
        </label>
      </div>

      {!budgetMode && (
        <>
          <h3>Creators per size</h3>
          <div className="size-grid">
            {meta.sizes.map((s) => (
              <label key={s.key} className="size-row">
                <span>{s.label}</span>
                <input type="number" min="0" step="1" value={inputs.package?.[s.key] || ''} placeholder="0" onChange={(e) => setPkg(s.key, e.target.value)} />
              </label>
            ))}
          </div>
        </>
      )}

      <h3>Extras</h3>
      <div className="grid-4">
        <label>
          Gifted creators
          <input type="number" min="0" step="1" value={inputs.gifted} onChange={set('gifted')} />
        </label>
        <label>
          Boosting budget
          <input type="number" min="0" value={inputs.boosting} onChange={set('boosting')} />
        </label>
        <label>
          Paid media budget
          <input type="number" min="0" value={inputs.paidMedia} onChange={set('paidMedia')} />
        </label>
        <label>
          Brand lift / other costs
          <input type="number" min="0" value={inputs.otherCosts} onChange={set('otherCosts')} />
        </label>
      </div>

      {budgetMode && (
        <>
          <button className="link" onClick={() => setShowConstraints(!showConstraints)}>
            {showConstraints ? '▾' : '▸'} Constraints
          </button>
          {showConstraints && (
            <div className="constraints">
              <div className="grid-4">
                <label>
                  Required total videos
                  <input type="number" min="0" value={inputs.requiredVideos ?? ''} onChange={set('requiredVideos')} />
                </label>
                <label>
                  Min creators
                  <input type="number" min="0" value={inputs.minCreators ?? ''} onChange={set('minCreators')} />
                </label>
                <label>
                  Max creators
                  <input type="number" min="0" value={inputs.maxCreators ?? ''} onChange={set('maxCreators')} />
                </label>
                <label>
                  Max creators above 350k
                  <input type="number" min="0" value={inputs.maxBigCreators ?? ''} onChange={set('maxBigCreators')} />
                </label>
              </div>
              <div className="muted small">Allowed creator sizes</div>
              <div className="chips">
                {meta.sizes.map((s) => (
                  <button key={s.key} className={`chip toggle ${inputs.allowedSizes.includes(s.key) ? 'on' : ''}`} onClick={() => toggleSize(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
