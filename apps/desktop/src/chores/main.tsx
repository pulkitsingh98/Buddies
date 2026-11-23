import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { forwardErrors } from '../lib/log';
import { ChoresApp } from './ChoresApp';
import '../ui/base.css';
import './chores.css';

forwardErrors('chores');

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <ChoresApp />
  </StrictMode>,
);
