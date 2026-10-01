import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { fmtDate, fmtMoney } from './format.js';

export default function Home({ onOpenDeal }) {
  const [term, setTerm] = useState('');
  const [deals, setDeals] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const timer = useRef();

  useEffect(() => {
    api('/proposals').then(setRecent).catch(() => {});
  }, []);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setError(null);
      api(`/pipedrive/deals?term=${encodeURIComponent(term)}`)
        .then(setDeals)
        .catch((e) => setError(e.message));
    }, term ? 350 : 0);
  }, [term]);

  return (
    <div className="page">
      <div className="row between">
        <h1>Price a deal</h1>
        <button className="primary" onClick={() => setCreating(true)}>
          + New deal
        </button>
      </div>
      <p className="muted">Pick the Pipedrive deal you are pricing, or create it here first.</p>

      <div className="grid-2">
        <section className="card">
          <h2>Pipedrive deals</h2>
          <input className="search" placeholder="Search open deals by title…" value={term} onChange={(e) => setTerm(e.target.value)} />
          {error && <div className="callout error">{error}</div>}
          {!deals && !error && <div className="muted">Loading…</div>}
          <ul className="list">
            {deals?.map((d) => (
              <li key={d.id}>
                <button className="list-item" onClick={() => onOpenDeal(d.id)}>
                  <span>
                    <b>{d.title}</b>
                    <span className="muted small">{d.orgName || 'No organisation'}{d.ownerName ? ` · ${d.ownerName}` : ''}</span>
                  </span>
                  <span className="muted">{d.value ? fmtMoney(d.value, d.currency) : ''}</span>
                </button>
              </li>
            ))}
            {deals && !deals.length && <li className="muted">No open deals match.</li>}
          </ul>
        </section>

        <section className="card">
          <h2>Recently priced</h2>
          <ul className="list">
            {recent.map((p) => (
              <li key={p.id}>
                <button className="list-item" onClick={() => onOpenDeal(p.pd_deal_id)}>
                  <span>
                    <b>{p.deal_title}</b>
                    <span className="muted small">
                      {p.org_name} · {p.packages} package{p.packages === 1 ? '' : 's'} · {fmtDate(p.updated_at)}
                    </span>
                  </span>
                  {p.status === 'approved' && <span className="chip green">Approved</span>}
                </button>
              </li>
            ))}
            {!recent.length && <li className="muted">Nothing priced yet.</li>}
          </ul>
        </section>
      </div>

      {creating && <NewDealModal onClose={() => setCreating(false)} onCreated={(d) => onOpenDeal(d.id)} />}
    </div>
  );
}

function NewDealModal({ onClose, onCreated }) {
  const [orgTerm, setOrgTerm] = useState('');
  const [orgs, setOrgs] = useState([]);
  const [org, setOrg] = useState(null);
  const [title, setTitle] = useState('');
  const [currency, setCurrency] = useState('GBP');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (org || orgTerm.trim().length < 2) return setOrgs([]);
    const t = setTimeout(() => api(`/pipedrive/orgs?term=${encodeURIComponent(orgTerm)}`).then(setOrgs).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [orgTerm, org]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const deal = await api('/pipedrive/deals', {
        method: 'POST',
        body: { title, orgId: org?.id, orgName: org ? undefined : orgTerm.trim(), currency, value: Number(value) || undefined },
      });
      onCreated(deal);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New deal in Pipedrive</h2>
        <label>
          Client
          {org ? (
            <div className="row">
              <span className="chip">{org.name}</span>
              <button className="link" onClick={() => setOrg(null)}>change</button>
            </div>
          ) : (
            <input autoFocus placeholder="Search Pipedrive organisations…" value={orgTerm} onChange={(e) => setOrgTerm(e.target.value)} />
          )}
        </label>
        {!org && orgTerm.trim().length >= 2 && (
          <ul className="list compact">
            {orgs.map((o) => (
              <li key={o.id}>
                <button className="list-item" onClick={() => { setOrg(o); if (!title) setTitle(`${o.name} – creator campaign`); }}>
                  {o.name}
                </button>
              </li>
            ))}
            <li className="muted small">No match? A new organisation “{orgTerm.trim()}” will be created.</li>
          </ul>
        )}
        <label>
          Deal title
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Acme – Q4 TikTok launch" />
        </label>
        <div className="grid-2 tight">
          <label>
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {['GBP', 'USD', 'EUR', 'AUD', 'CAD'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>
            Estimated value (optional)
            <input type="number" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        </div>
        {error && <div className="callout error">{error}</div>}
        <div className="row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !title.trim() || !(org || orgTerm.trim())} onClick={submit}>
            {busy ? 'Creating…' : 'Create deal'}
          </button>
        </div>
      </div>
    </div>
  );
}
