import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import './index.css';
import { DesignPage } from './design/DesignPage';
import { Workspace } from './app/Workspace';

function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  // #design (and its section anchors) shows the design system; everything else is the workspace.
  const designAnchors = ['#design', '#colours', '#type', '#buttons', '#ribbon', '#tree', '#fields', '#panels', '#overlays', '#workspace'];
  return designAnchors.includes(hash) ? <DesignPage /> : <Workspace />;
}

// Offline support: in production builds a service worker keeps the app and the
// geometry engine cached, so Partwright starts without a network connection.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {}));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
