import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initTelegram } from './telegram';
import { ensureFreshVersion } from './version';
import './styles.css';

initTelegram();
ensureFreshVersion();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
