import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, notify, openUrl } from './api.js';
import { fmtInt, fmtMoney, fmtPct } from './format.js';
import PackageForm from './PackageForm.jsx';
import ResultView from './ResultView.jsx';

function defaultInputs(meta, prefill, currency) {
  return {
    mode: 'budget',
    currency: prefill?.currency || currency || 'GBP',
    budget: prefill?.budget || '',
    market: meta.markets.find((m) => m.name === prefill?.market)?.name || '',
    platform: 'TikTok',
    niche: meta.niches.find((n) => n.name === prefill?.niche)?.name || '',
    objective: 'Balanced',
    margin: meta.settings.targetMargin,
    videosPerCreator: meta.settings.defaultVideosPerCreator,
    gifted: 0,
    boosting: 0,
    paidMedia: prefill?.paidMedia || 0,
    otherCosts: 0,
    requiredVideos: '',
    minCreators: '',
    maxCreators: '',
    maxBigCreators: '',
    allowedSizes: meta.sizes.map((s) => s.key),
    package: {},
    agreedPrice: '',
  };
}

export default function DealView({ dealId, meta, boardId, onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null); // package id or 'new'
  const [name, setName] = useState('');
  const [inputs, setInputs] = useState(null);
  const [result, setResult] = useState(null);
  const [calcError, setCalcError] = useState(null);
  const [calculating, setCalculating] = useState(false);
  const [busy, setBusy] = useState(false);
  const prefillRef = useRef(null);
  const calcSeq = useRef(0);

  const reload = useCallback(async (proposalId) => {
    const d = await api(`/proposals/${proposalId}`);
    setData((prev) => ({ ...prev, ...d }));
    return d;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const opened = await api('/proposals', { method: 'POST', body: { pdDealId: dealId, boardId } });
        prefillRef.current = opened.prefill;
        setData({ deal: opened.deal });
        const d = await reload(opened.proposal.id);
        if (d.packages.length) selectPackage(d.packages.find((p) => p.is_approved) || d.packages[d.packages.length - 1]);
        else startNew(opened.proposal);
      } catch (e) {
        setError(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  function selectPackage(p) {
    setSelected(p.id);
    setName(p.name);
    setInputs({ ...defaultInputs(meta), ...p.inputs, agreedPrice: p.inputs.agreedPrice ?? '' });
    setResult(p.result);
    setCalcError(null);
  }

  function startNew(proposal, fromInputs) {
    setSelected('new');
    setName('');
    setInputs(fromInputs ? { ...fromInputs, agreedPrice: '' } : defaultInputs(meta, prefillRef.current, proposal?.currency));
    setResult(null);
    setCalcError(null);
  }

  // Live recalculation while editing.
  useEffect(() => {
    if (!inputs) return;
    const seq = ++calcSeq.current;
    const t = setTimeout(async () => {
      if (!inputs.market) return;
      setCalculating(true);
      try {
        const r = await api('/calculate', { method: 'POST', body: { inputs } });
        if (seq === calcSeq.current) {
          setResult(r);
          setCalcError(null);
        }
      } catch (e) {
        if (seq === calcSeq.current) {
          setCalcError(e.message);
          setResult(null);
        }
      } finally {
        if (seq === calcSeq.current) setCalculating(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [inputs]);

  if (error) {
    return (
      <div className="page">
        <button className="link" onClick={onBack}>← Deals</button>
        <div className="callout error">{error}</div>
      </div>
    );
  }
  if (!data?.proposal) return <div className="page muted">Opening deal…</div>;

  const { proposal, packages, deal, dealUrl } = data;
  const current = packages.find((p) => p.id === selected);

  const run = async (fn, okMessage) => {
    setBusy(true);
    try {
      const out = await fn();
      if (okMessage) notify(okMessage);
      return out;
    } catch (e) {
      setCalcError(e.message);
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveNew = () =>
    run(async () => {
      const pkg = await api(`/proposals/${proposal.id}/packages`, { method: 'POST', body: { name, inputs } });
      await reload(proposal.id);
      selectPackage(pkg);
    }, 'Package saved');

  const saveChanges = () =>
    run(async () => {
      const pkg = await api(`/packages/${current.id}`, { method: 'PUT', body: { name, inputs } });
      await reload(proposal.id);
      selectPackage(pkg);
    }, current?.is_approved ? 'Approved package updated and re-sent to Pipedrive' : 'Package updated');

  const approve = () =>
    run(async () => {
      const out = await api(`/packages/${current.id}/approve`, { method: 'POST' });
      await reload(proposal.id);
      selectPackage(out.package);
      if (!out.pipedrive.ok) throw new Error(`Approved, but Pipedrive was not updated: ${out.pipedrive.error}`);
    }, 'Approved — deal value, margin and a note were sent to Pipedrive');

  const unapprove = () =>
    run(async () => {
      await api(`/packages/${current.id}/unapprove`, { method: 'POST' });
      const d = await reload(proposal.id);
      selectPackage(d.packages.find((p) => p.id === current.id));
    });

  const remove = () =>
    run(async () => {
      await api(`/packages/${current.id}`, { method: 'DELETE' });
      const d = await reload(proposal.id);
      if (d.packages.length) selectPackage(d.packages[d.packages.length - 1]);
      else startNew(proposal);
    }, 'Package deleted');

  const downloadSlide = () =>
    run(async () => {
      const { url } = await api(`/packages/${current.id}/slide-link`, { method: 'POST' });
      openUrl(url);
    });

  // Turn a budget-mode result into an editable package (creators per size).
  const adjustAsPackage = () => {
    if (!result?.ok) return;
    setInputs({
      ...inputs,
      mode: 'package',
      package: Object.fromEntries(result.client.creators.map((c) => [c.size, c.count])),
    });
  };

  const dirty = current && JSON.stringify(normalise(inputs)) !== JSON.stringify(normalise({ ...defaultInputs(meta), ...current.inputs }));
  const nameDirty = current && name.trim() && name.trim() !== current.name;

  return (
    <div className="page wide">
      <div className="row between">
        <div>
          <button className="link" onClick={onBack}>← Deals</button>
          <h1>{proposal.deal_title}</h1>
          <div className="muted">
            {proposal.org_name || 'No organisation'}
            {deal?.value ? ` · Pipedrive value ${fmtMoney(deal.value, deal.currency)}` : ''}
            {dealUrl && (
              <>
                {' · '}
                <button className="link" onClick={() => openUrl(dealUrl)}>Open in Pipedrive</button>
              </>
            )}
          </div>
        </div>
        {proposal.status === 'approved' && <span className="chip green">Package approved</span>}
      </div>

      <div className="deal-layout">
        <aside className="packages">
          <div className="row between">
            <h2>Packages</h2>
            <button className="small" onClick={() => startNew(proposal)}>+ New</button>
          </div>
          {packages.map((p) => (
            <button key={p.id} className={`pkg-card ${p.id === selected ? 'active' : ''}`} onClick={() => selectPackage(p)}>
              <div className="row between">
                <b>{p.name}</b>
                {p.is_approved && <span className="chip green small">Approved</span>}
              </div>
              <div className="pkg-price">{fmtMoney(p.agreed_price ?? p.client_price, p.currency)}</div>
              <div className="muted small">
                {fmtInt(p.total_creators)} creators · {fmtInt(p.total_videos)} videos · {fmtInt(p.views_promised)} views
              </div>
              <div className="muted small">Margin {fmtPct(p.real_margin ?? p.expected_margin)} · v{p.version}</div>
            </button>
          ))}
          {selected === 'new' && (
            <div className="pkg-card active">
              <b>New package</b>
              <div className="muted small">Not saved yet</div>
            </div>
          )}
        </aside>

        <section className="editor">
          <div className="card">
            <div className="row between">
              <input className="name-input" placeholder={selected === 'new' ? `Option ${String.fromCharCode(65 + packages.length)}` : 'Package name'} value={name} onChange={(e) => setName(e.target.value)} />
              <div className="row">
                {selected === 'new' ? (
                  <button className="primary" disabled={busy || !result?.ok} onClick={saveNew}>Save package</button>
                ) : (
                  <>
                    <button onClick={() => startNew(proposal, inputs)} disabled={busy}>Duplicate</button>
                    <button className="primary" disabled={busy || !result?.ok || !(dirty || nameDirty)} onClick={saveChanges}>
                      Save changes
                    </button>
                  </>
                )}
              </div>
            </div>
            {inputs && <PackageForm meta={meta} inputs={inputs} onChange={setInputs} />}
          </div>
        </section>

        <section className="result-col">
          {calculating && <div className="muted small">Calculating…</div>}
          {calcError && <div className="callout error">{calcError}</div>}
          {!inputs?.market && <div className="callout">Choose a market to see the package.</div>}
          {result && !result.ok && <div className="callout error">{result.error}</div>}
          {result?.ok && (
            <ResultView
              result={result}
              agreedPrice={inputs.agreedPrice}
              onAgreedPrice={(v) => setInputs({ ...inputs, agreedPrice: v })}
              onAdjust={inputs.mode === 'budget' ? adjustAsPackage : null}
            />
          )}
          {current && (
            <div className="card actions">
              {dirty && <div className="callout warn small">You have unsaved changes. Save them before approving or downloading.</div>}
              <div className="row wrap">
                {current.is_approved ? (
                  <button disabled={busy} onClick={unapprove}>Withdraw approval</button>
                ) : (
                  <button className="primary" disabled={busy || dirty} onClick={approve}>Approve this package</button>
                )}
                <button disabled={busy || dirty} onClick={downloadSlide}>Download client slide</button>
                <button className="danger" disabled={busy} onClick={remove}>Delete</button>
              </div>
              <div className="muted small">
                Approving sets the Pipedrive deal value, projected margin, number of influencers and paid media, and adds a note.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function normalise(i) {
  if (!i) return i;
  const out = {};
  for (const k of Object.keys(i).sort()) {
    const v = i[k];
    if (k === 'package') {
      out[k] = Object.fromEntries(Object.entries(v || {}).filter(([, n]) => Number(n) > 0).map(([s, n]) => [s, Number(n)]).sort());
      continue;
    }
    if (k === 'allowedSizes') {
      out[k] = [...(v || [])].sort();
      continue;
    }
    out[k] = v === '' || v == null ? null : typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : v;
  }
  return out;
}
