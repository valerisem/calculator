import React, { useEffect, useState } from 'react';
import { api, notify, openUrl } from './api.js';
import { fmtDate } from './format.js';
import PackageCard, { PackageDetails } from './PackageCard.jsx';
import SlideBox from './SlideBox.jsx';
import Commercial from './Commercial.jsx';
import Review from './Review.jsx';

// A deal's saved packages: choose one, approve it (syncs Pipedrive), download its slide.
export default function Proposal({ proposalId, meta, settings, onBack, onEdit, onDefaultsSaved }) {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('client');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    const d = await api(`/proposals/${proposalId}`);
    setData(d);
    setSelected((s) => (d.packages.some((p) => p.id === s) ? s : (d.packages.find((p) => p.is_approved) || d.packages[0])?.id));
    return d;
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId]);

  const pkg = data?.packages.find((p) => p.id === selected);

  if (error && !data) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!data) return <div className="page muted">Loading…</div>;
  const { proposal, packages, dealUrl } = data;

  const run = async (fn, ok) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (ok) notify(ok);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const approve = () => run(async () => {
    const out = await api(`/packages/${pkg.id}/approve`, { method: 'POST' });
    await load();
    if (!out.pipedrive.ok) throw new Error(`Approved, but Pipedrive was not updated: ${out.pipedrive.error}`);
  }, 'Approved. Deal value, margin and a note were sent to Pipedrive.');

  const withdraw = () => run(async () => {
    await api(`/packages/${pkg.id}/unapprove`, { method: 'POST' });
    await load();
  });

  const remove = () => run(async () => {
    await api(`/packages/${pkg.id}`, { method: 'DELETE' });
    await load();
  }, 'Package deleted');


  const saveCommercial = (commercial) => run(async () => {
    await api(`/packages/${pkg.id}`, { method: 'PUT', body: { inputs: { ...pkg.inputs, agreedPrice: null, commercial } } });
    await load();
  }, 'Adjustment saved');

  return (
    <div className="split">
      <section className="left">
        <button className="text-link" onClick={onBack}>‹ All proposals</button>
        <h1 className="title">{proposal.campaign_name || proposal.deal_title}</h1>
        <p className="muted">
          {proposal.org_name || 'No organisation'} · Pipedrive deal “{proposal.deal_title}”
          {dealUrl && <> · <button className="text-link" onClick={() => openUrl(dealUrl)}>Open in Pipedrive</button></>}
        </p>
        <p className="muted small">Updated {fmtDate(proposal.updated_at)}{proposal.status === 'approved' ? ' · package approved' : ''}</p>

        <div className="dash" />
        {pkg ? (
          <>
            <div className="section-head"><h2>{pkg.name}</h2>{pkg.is_approved && <span className="badge">Approved</span>}</div>
            <p className="muted small">
              {(pkg.result.inputs.platforms || []).join(' & ')} · {(pkg.result.inputs.markets || []).join(', ')}{pkg.result.inputs.niche ? ` · ${pkg.result.inputs.niche}` : ''} · {pkg.result.inputs.videosPerCreator} videos per creator · version {pkg.version}
            </p>
            <Commercial pkg={pkg} meta={meta} busy={busy} onSave={saveCommercial} />
            <Review pkg={pkg} onSaved={() => load()} onError={setError} />
            <div className="actions">
              {pkg.is_approved
                ? <button className="ghost" disabled={busy} onClick={withdraw}>Withdraw approval</button>
                : <button className="cta" disabled={busy} onClick={approve}>Approve package <span>›</span></button>}
              <button className="ghost" disabled={busy} onClick={() => onEdit(pkg)}>Adjust in calculator</button>
              <button className="ghost danger" disabled={busy} onClick={remove}>Delete</button>
            </div>
            <div className="dash" />
            <SlideBox pkg={pkg} settings={settings} busy={busy} onError={setError} onDefaultsSaved={onDefaultsSaved} />
          </>
        ) : (
          <p className="muted">No packages saved yet.</p>
        )}
        {error && <div className="error-box">{error}</div>}
      </section>

      <section className="right">
        <div className="right-head">
          <h1 className="title">Packages</h1>
          <div className="toggle-group">
            <button className={view === 'client' ? 'on' : ''} onClick={() => setView('client')}>Client</button>
            <button className={view === 'internal' ? 'on' : ''} onClick={() => setView('internal')}>Internal</button>
          </div>
        </div>
        {packages.map((p) => (
          <React.Fragment key={p.id}>
            <PackageCard
              title={p.name}
              priceLabel={p.mode === 'yours' ? 'Price to quote' : 'Price'}
              result={p.result}
              view={view}
              selected={p.id === selected}
              accent={p.mode !== 'yours'}
              badge={p.is_approved ? 'Approved' : null}
              onSelect={() => setSelected(p.id)}
            />
            {view === 'internal' && p.id === selected && <PackageDetails result={p.result} />}
          </React.Fragment>
        ))}
      </section>
    </div>
  );
}
