import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CreatorApp } from './CreatorApp';
import { forwardErrors } from '../lib/log';
import '../ui/base.css';
import './creator.css';

forwardErrors('creator');

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <CreatorApp />
  </StrictMode>,
);
