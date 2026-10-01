import React, { useEffect, useState } from 'react';
import { api, inMonday, monday } from './api.js';
import DealView from './DealView.jsx';
import Home from './Home.jsx';
import Settings from './Settings.jsx';

export default function App() {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ name: 'home' });
  const [context, setContext] = useState(null);

  const loadMeta = () => api('/meta').then(setMeta).catch((e) => setError(e.result?.code === 'restricted' || e.status === 401 ? 'restricted' : e.message));

  useEffect(() => {
    loadMeta();
    if (inMonday) {
      monday.listen('context', (res) => {
        setContext(res.data);
        document.documentElement.dataset.theme = res.data?.theme === 'light' ? 'light' : 'dark';
      });
    }
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
  if (error) {
    return (
      <div className="page">
        <div className="callout error">{error}</div>
      </div>
    );
  }
  if (!meta) return <div className="page muted">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView({ name: 'home' })}>
          Package Calculator
        </button>
        <nav>
          <button className={view.name !== 'settings' ? 'tab active' : 'tab'} onClick={() => setView({ name: 'home' })}>
            Deals
          </button>
          <button className={view.name === 'settings' ? 'tab active' : 'tab'} onClick={() => setView({ name: 'settings' })}>
            Settings
          </button>
        </nav>
      </header>
      {!meta.rateBuild && view.name !== 'settings' && (
        <div className="callout warn page-callout">
          The rate table has not been built yet. Open <b>Settings</b> and press <b>Rebuild rate table</b>.
        </div>
      )}
      {view.name === 'home' && <Home onOpenDeal={(dealId) => setView({ name: 'deal', dealId })} />}
      {view.name === 'deal' && (
        <DealView dealId={view.dealId} meta={meta} boardId={context?.boardId} onBack={() => setView({ name: 'home' })} />
      )}
      {view.name === 'settings' && <Settings meta={meta} onChanged={loadMeta} />}
    </div>
  );
}
