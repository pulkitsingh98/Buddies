import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { forwardErrors } from '../lib/log';
import { Onboarding } from './Onboarding';
import '../ui/base.css';
import './onboarding.css';

forwardErrors('onboarding');

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <Onboarding />
  </StrictMode>,
);
