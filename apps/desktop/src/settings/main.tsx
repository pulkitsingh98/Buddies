import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { forwardErrors } from '../lib/log';
import '../ui/base.css';
import './settings.css';

forwardErrors('settings');

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
