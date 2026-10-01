import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import Calculator from './Calculator.jsx';
import { fmtDate } from './format.js';
import Proposal from './Proposal.jsx';
import Settings from './Settings.jsx';

export default function App() {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ name: 'calculator', key: 0 });

  const loadMeta = () => api('/meta').then(setMeta).catch((e) => setError(e.result?.code === 'restricted' || e.status === 401 ? 'restricted' : e.message));
  useEffect(() => {
    loadMeta();
  }, []);

  if (error === 'restricted') {
    return (
      <div className="lost">
        <div className="lost-emoji">🧭</div>
        <h1>It looks like you're lost</h1>
        <p className="muted">There's nothing here for you yet. Head back to your boards.</p>
      </div>
    );
  }
  if (error) return <div className="page"><div className="error-box">{error}</div></div>;
  if (!meta) return <div className="page muted">Loading…</div>;

  const go = (v) => setView({ ...v, key: Date.now() });
  const tab = view.name === 'proposal' ? 'proposals' : view.name;

  return (
    <div className="app">
      <nav className="nav">
        <button className={tab === 'calculator' ? 'on' : ''} onClick={() => go({ name: 'calculator' })}>Calculator</button>
        <button className={tab === 'proposals' ? 'on' : ''} onClick={() => go({ name: 'proposals' })}>Proposals</button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => go({ name: 'settings' })}>Settings</button>
      </nav>
      {!meta.rateBuild && view.name !== 'settings' && (
        <div className="error-box page-callout">The rate table has not been built yet. Open Settings and rebuild it.</div>
      )}
      {view.name === 'calculator' && (
        <Calculator
          key={view.key}
          meta={meta}
          initialInputs={view.inputs}
          editing={view.editing}
          onSaved={() => go({ name: 'proposal', id: view.editing.proposalId })}
          onOpenProposal={(id) => go({ name: 'proposal', id })}
        />
      )}
      {view.name === 'proposals' && <Proposals onOpen={(id) => go({ name: 'proposal', id })} />}
      {view.name === 'proposal' && (
        <Proposal
          key={view.key}
          proposalId={view.id}
          settings={meta.settings}
          onBack={() => go({ name: 'proposals' })}
          onEdit={(pkg) => go({ name: 'calculator', inputs: pkg.inputs, editing: { packageId: pkg.id, proposalId: pkg.proposal_id, kind: pkg.mode } })}
        />
      )}
      {view.name === 'settings' && <Settings meta={meta} onChanged={loadMeta} />}
    </div>
  );
}

function Proposals({ onOpen }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    api('/proposals').then(setRows).catch((e) => setError(e.message));
  }, []);
  return (
    <div className="page">
      <h1 className="title">Proposals</h1>
      {error && <div className="error-box">{error}</div>}
      {!rows && !error && <p className="muted">Loading…</p>}
      <ul className="proposal-list">
        {rows?.map((p) => (
          <li key={p.id}>
            <button onClick={() => onOpen(p.id)}>
              <span>
                <b>{p.campaign_name || p.deal_title}</b>
                <span className="muted small">{p.org_name} · {p.packages} package{p.packages === 1 ? '' : 's'} · {fmtDate(p.updated_at)}</span>
              </span>
              {p.status === 'approved' && <span className="badge">Approved</span>}
            </button>
          </li>
        ))}
        {rows && !rows.length && <li className="muted">No proposals yet. Create one from the calculator.</li>}
      </ul>
    </div>
  );
}
