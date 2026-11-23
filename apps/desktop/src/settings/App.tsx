import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { APP_NAME } from '@deskpals/shared';
import { checkForUpdate } from '../lib/updater';

export function App() {
  const [version, setVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('dev'));
  }, []);

  return (
    <main className="settings">
      <h1>{APP_NAME}</h1>
      <p className="muted">Version {version}</p>
      <p>Your pets will live here soon. For now, the tray icon is all there is.</p>
      <button
        onClick={() => {
          setUpdateStatus('Checking…');
          checkForUpdate().then(setUpdateStatus);
        }}
      >
        Check for updates
      </button>
      {updateStatus && <p className="muted">{updateStatus}</p>}
    </main>
  );
}
