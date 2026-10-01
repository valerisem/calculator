import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { fmtMoney } from './format.js';

// Pick the Pipedrive deal a proposal belongs to, or create it.
export default function DealPicker({ defaultTitle, currency, busy, onClose, onPick }) {
  const [tab, setTab] = useState('existing');
  const [term, setTerm] = useState('');
  const [deals, setDeals] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api(`/pipedrive/deals?term=${encodeURIComponent(term)}`).then(setDeals).catch((e) => setError(e.message));
    }, term ? 300 : 0);
    return () => clearTimeout(t);
  }, [term]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Which deal is this for?</h2>
        <div className="toggle-group">
          <button className={tab === 'existing' ? 'on' : ''} onClick={() => setTab('existing')}>Pipedrive deal</button>
          <button className={tab === 'new' ? 'on' : ''} onClick={() => setTab('new')}>New deal</button>
        </div>
        {error && <div className="error-box">{error}</div>}
        {tab === 'existing' ? (
          <>
            <input className="line" autoFocus placeholder="Search open deals…" value={term} onChange={(e) => setTerm(e.target.value)} />
            <ul className="deal-list">
              {!deals && <li className="muted small">Loading…</li>}
              {deals?.map((d) => (
                <li key={d.id}>
                  <button disabled={busy} onClick={() => onPick(d)}>
                    <span>
                      <b>{d.title}</b>
                      <span className="muted small">{d.orgName || 'No organisation'}{d.ownerName ? ` · ${d.ownerName}` : ''}</span>
                    </span>
                    <span className="muted small">{d.value ? fmtMoney(d.value, d.currency) : ''}</span>
                  </button>
                </li>
              ))}
              {deals && !deals.length && <li className="muted small">No open deals match.</li>}
            </ul>
          </>
        ) : (
          <NewDeal defaultTitle={defaultTitle} currency={currency} busy={busy} onCreated={onPick} onError={setError} />
        )}
        {busy && <p className="muted small">Saving packages…</p>}
      </div>
    </div>
  );
}

function NewDeal({ defaultTitle, currency, busy, onCreated, onError }) {
  const [orgTerm, setOrgTerm] = useState('');
  const [orgs, setOrgs] = useState([]);
  const [org, setOrg] = useState(null);
  const [title, setTitle] = useState(defaultTitle || '');
  const [channel, setChannel] = useState('');
  const [channels, setChannels] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/pipedrive/deal-options').then((o) => setChannels(o.channel || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (org || orgTerm.trim().length < 2) return setOrgs([]);
    const t = setTimeout(() => api(`/pipedrive/orgs?term=${encodeURIComponent(orgTerm)}`).then(setOrgs).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [orgTerm, org]);

  const create = async () => {
    setSaving(true);
    try {
      const deal = await api('/pipedrive/deals', {
        method: 'POST',
        body: { title, orgId: org?.id, orgName: org ? undefined : orgTerm.trim(), currency, channel: Number(channel) },
      });
      onCreated(deal);
    } catch (e) {
      onError(e.message);
      setSaving(false);
    }
  };

  return (
    <>
      <label className="field">
        <span>Client</span>
        {org ? (
          <div className="chips">
            <span className="chip-dark">{org.name}<button onClick={() => setOrg(null)}>×</button></span>
          </div>
        ) : (
          <input className="line" autoFocus placeholder="Search Pipedrive organisations…" value={orgTerm} onChange={(e) => setOrgTerm(e.target.value)} />
        )}
      </label>
      {!org && orgTerm.trim().length >= 2 && (
        <ul className="deal-list short">
          {orgs.map((o) => (
            <li key={o.id}><button onClick={() => setOrg(o)}>{o.name}</button></li>
          ))}
          <li className="muted small">No match? “{orgTerm.trim()}” will be created as a new organisation.</li>
        </ul>
      )}
      <label className="field">
        <span>Deal title</span>
        <input className="line" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Acme – Q4 TikTok launch" />
      </label>
      <label className="field">
        <span>Source channel</span>
        <select className="line" value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">Choose…</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <button className="cta" disabled={busy || saving || !title.trim() || !(org || orgTerm.trim()) || !channel} onClick={create}>
        {saving ? 'Creating…' : 'Create deal and proposal'} <span>›</span>
      </button>
    </>
  );
}
