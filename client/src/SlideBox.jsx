import React, { useEffect, useState } from 'react';
import { api, notify, openUrl } from './api.js';

const CONTACT_KEY = 'pc.contact';
const readContact = () => {
  try {
    return JSON.parse(localStorage.getItem(CONTACT_KEY)) || {};
  } catch {
    return {};
  }
};

// Presentation export for one package: version, output and the text the templates need.
export default function SlideBox({ pkg, settings, outputs, busy, onError, onDefaultsSaved }) {
  const defaults = () => ({
    theme: settings.slideTheme || 'light',
    output: 'presentation',
    badge: settings.slideBadge || 'Most popular',
    oneLine: '',
    proposalLine: '',
    estimatedSales: '',
    salesNote: settings.slideSalesNote || 'Excludes repeat purchases',
    ...readContact(),
  });
  const [o, setO] = useState(defaults);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setO({ ...defaults(), ...(pkg.slide_options || {}), ...readContact() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg.id]);

  const set = (k) => (e) => setO({ ...o, [k]: e.target.value });
  const isPdf = o.output === 'pricingPdf';

  const download = async () => {
    setWorking(true);
    try {
      const contact = { contactName: o.contactName, contactTitle: o.contactTitle, contactEmail: o.contactEmail, contactPhone: o.contactPhone };
      try {
        localStorage.setItem(CONTACT_KEY, JSON.stringify(contact));
      } catch {
        // private window: just don't remember
      }
      const { url } = await api(`/packages/${pkg.id}/slide-link`, { method: 'POST', body: { options: o } });
      openUrl(url);
    } catch (e) {
      onError(e.message);
    } finally {
      setWorking(false);
    }
  };

  const saveDefault = async () => {
    try {
      await api('/settings', { method: 'PUT', body: { slideTheme: o.theme, slideBadge: o.badge, slideSalesNote: o.salesNote } });
      notify('Presentation defaults saved');
      onDefaultsSaved?.();
    } catch (e) {
      onError(e.message);
    }
  };

  return (
    <div className="slide-box">
      <div className="section-head">
        <h2>Presentation</h2>
        <div className="toggle-group">
          <button className={o.theme === 'light' ? 'on' : ''} onClick={() => setO({ ...o, theme: 'light' })}>Light</button>
          <button className={o.theme === 'dark' ? 'on' : ''} onClick={() => setO({ ...o, theme: 'dark' })}>Dark</button>
        </div>
      </div>
      <div className="output-options">
        {outputs.map((x) => (
          <button key={x.key} className={`output ${o.output === x.key ? 'on' : ''}`} onClick={() => setO({ ...o, output: x.key })}>
            <span className={`radio ${o.output === x.key ? 'on' : ''}`} />
            {x.label}
          </button>
        ))}
      </div>
      <div className="row2">
        <label className="field"><span>Badge on the pricing slide</span><input className="line" value={o.badge} onChange={set('badge')} /></label>
        <label className="field"><span>Estimated sales (leave empty to hide)</span><input className="line" value={o.estimatedSales} onChange={set('estimatedSales')} /></label>
      </div>
      <label className="field"><span>Campaign goal and audience, one line</span><input className="line" placeholder="Defaults to platforms · markets · niche" value={o.oneLine} onChange={set('oneLine')} /></label>
      {(o.output === 'presentation' || o.output === 'template') && (
        <>
          <label className="field"><span>What this proposal sets out to do, one line</span><input className="line" value={o.proposalLine} onChange={set('proposalLine')} /></label>
          <div className="row2">
            <label className="field"><span>Your name</span><input className="line" value={o.contactName || ''} onChange={set('contactName')} /></label>
            <label className="field"><span>Job title</span><input className="line" value={o.contactTitle || ''} onChange={set('contactTitle')} /></label>
            <label className="field"><span>Email</span><input className="line" value={o.contactEmail || ''} onChange={set('contactEmail')} /></label>
            <label className="field"><span>Phone</span><input className="line" value={o.contactPhone || ''} onChange={set('contactPhone')} /></label>
          </div>
        </>
      )}
      <div className="actions">
        <button className="cta" disabled={busy || working} onClick={download}>
          {working ? 'Preparing…' : isPdf ? 'Download PDF' : 'Download PowerPoint'} <span>›</span>
        </button>
        <button className="ghost" disabled={busy} onClick={saveDefault}>Save version & badge as default</button>
      </div>
    </div>
  );
}
