import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { AppThemeProvider } from './theme';
import { engine } from './core/engine';
import { warmupChains } from './core/cache';
import './index.css';

engine.start();
window.setTimeout(warmupChains, 1500);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppThemeProvider>
      <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </HashRouter>
    </AppThemeProvider>
  </React.StrictMode>,
);
