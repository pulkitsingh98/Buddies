import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { forwardErrors } from '../lib/log';
import { FriendsApp } from './FriendsApp';
import '../ui/base.css';
import './friends.css';

forwardErrors('friends');

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <FriendsApp />
  </StrictMode>,
);
