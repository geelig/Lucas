import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import './refinements.css';
import './reference.css';
import './terminal-unified.css';
import './layout-refine.css';
import './modern-ui.css';
import './drag-fix.css';
import './metadata-lower.css';
import './layout-hardfix.css';
import './border-clean.css';
import './panel-dock.css';
import './polish.css';
import './file-table.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
