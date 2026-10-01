import React, { useEffect, useState } from 'react';
import { api, notify, openUrl } from './api.js';

// Presentation export for one package: version, output and the text the templates need.
export default function SlideBox({ pkg, settings, outputs, busy, onError, onDefaultsSaved }) {
  const defaults = () => ({
    theme: settings.slideTheme || 'light',
    output: 'presentation',
    badge: settings.slideBadge || 'Most popular',
    estimatedSales: '',
    salesNote: settings.slideSalesNote || 'Excludes repeat purchases',
  });
  const [o, setO] = useState(defaults);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setO({ ...defaults(), ...(pkg.slide_options || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg.id]);

  const set = (k) => (e) => setO({ ...o, [k]: e.target.value });
  const isPdf = o.output === 'pricingPdf';

  const download = async () => {
    setWorking(true);
    try {
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
      <div className="actions">
        <button className="cta" disabled={busy || working} onClick={download}>
          {working ? 'Preparing…' : isPdf ? 'Download PDF' : 'Download PowerPoint'} <span>›</span>
        </button>
        <button className="ghost" disabled={busy} onClick={saveDefault}>Save version & badge as default</button>
      </div>
    </div>
  );
}
