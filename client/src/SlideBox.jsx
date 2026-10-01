import React, { useEffect, useState } from 'react';
import { api, openUrl } from './api.js';

// Slide options for one package: light or dark version and the editable text.
export default function SlideBox({ pkg, settings, busy, onError }) {
  const defaults = () => ({
    theme: settings.slideTheme || 'light',
    part: settings.slidePart || '',
    subtitle: settings.slideSubtitle || '',
    badge: settings.slideBadge || '',
    oneLine: '',
    extraLines: (settings.slideExtraLines || []).join('\n'),
    estimatedSales: '',
    salesNote: settings.slideSalesNote || '',
  });
  const [o, setO] = useState(defaults);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const saved = pkg.slide_options || {};
    setO({ ...defaults(), ...saved, extraLines: Array.isArray(saved.extraLines) ? saved.extraLines.join('\n') : defaults().extraLines });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkg.id]);

  const set = (k) => (e) => setO({ ...o, [k]: e.target.value });

  const download = async () => {
    setWorking(true);
    try {
      const options = { ...o, extraLines: o.extraLines.split('\n').map((l) => l.trim()).filter(Boolean) };
      const { url } = await api(`/packages/${pkg.id}/slide-link`, { method: 'POST', body: { options } });
      openUrl(url);
    } catch (e) {
      onError(e.message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="slide-box">
      <div className="section-head">
        <h2>Client slide</h2>
        <div className="toggle-group">
          <button className={o.theme === 'light' ? 'on' : ''} onClick={() => setO({ ...o, theme: 'light' })}>Light</button>
          <button className={o.theme === 'dark' ? 'on' : ''} onClick={() => setO({ ...o, theme: 'dark' })}>Dark</button>
        </div>
      </div>
      <div className="row2">
        <label className="field"><span>Part number</span><input className="line" value={o.part} onChange={set('part')} /></label>
        <label className="field"><span>Badge</span><input className="line" value={o.badge} onChange={set('badge')} /></label>
      </div>
      <label className="field"><span>Subtitle</span><input className="line" value={o.subtitle} onChange={set('subtitle')} /></label>
      <label className="field"><span>One line on the campaign goal and audience</span><input className="line" value={o.oneLine} onChange={set('oneLine')} /></label>
      <label className="field">
        <span>Extra lines (one per line: usage rights, free extras…)</span>
        <textarea className="line" rows={3} value={o.extraLines} onChange={set('extraLines')} />
      </label>
      <div className="row2">
        <label className="field"><span>Estimated sales (leave empty to hide)</span><input className="line" value={o.estimatedSales} onChange={set('estimatedSales')} /></label>
        <label className="field"><span>Sales note</span><input className="line" value={o.salesNote} onChange={set('salesNote')} /></label>
      </div>
      <button className="cta" disabled={busy || working} onClick={download}>
        {working ? 'Preparing…' : 'Download slide'} <span>›</span>
      </button>
    </div>
  );
}
