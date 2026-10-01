import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { fmtDate } from './format.js';

const STATUSES = [
  ['not_reviewed', 'Not reviewed'],
  ['cm_reviewed', 'CM reviewed'],
  ['confirmed', 'Confirmed'],
];

// Has the campaign team checked this package can be delivered at these rates?
export default function Review({ pkg, onSaved, onError }) {
  const [status, setStatus] = useState(pkg.delivery_status || 'not_reviewed');
  const [by, setBy] = useState(pkg.reviewed_by || '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setStatus(pkg.delivery_status || 'not_reviewed');
    setBy(pkg.reviewed_by || '');
  }, [pkg.id, pkg.delivery_status, pkg.reviewed_by]);
  const dirty = status !== (pkg.delivery_status || 'not_reviewed') || by !== (pkg.reviewed_by || '');

  const save = async () => {
    setBusy(true);
    try {
      await api(`/packages/${pkg.id}/review`, { method: 'PUT', body: { status, reviewedBy: by } });
      onSaved();
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review">
      <div className="section-head">
        <h2>Delivery confidence</h2>
        {pkg.reviewed_at && <span className="muted small">{fmtDate(pkg.reviewed_at)}</span>}
      </div>
      <div className="row2">
        <div className="field">
          <span>Status</span>
          <div className="toggle-group small">
            {STATUSES.map(([k, label]) => (
              <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{label}</button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Reviewed by</span>
          <input className="line" placeholder="e.g. Levi" value={by} disabled={status === 'not_reviewed'} onChange={(e) => setBy(e.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button className="ghost" disabled={busy || !dirty || (status !== 'not_reviewed' && !by.trim())} onClick={save}>Save review</button>
      </div>
    </div>
  );
}
