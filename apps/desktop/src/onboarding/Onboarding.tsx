import { useEffect, useState } from 'react';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ipc, type Settings } from '../lib/ipc';

const isMac = navigator.userAgent.includes('Mac');
const STEPS = 5;

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [autostart, setAutostart] = useState(false);

  useEffect(() => {
    void ipc.getSettings().then(setSettings);
    void isEnabled()
      .then(setAutostart)
      .catch(() => {});
  }, []);

  if (!settings) return null;
  const update = (patch: Partial<Settings>) => void ipc.updateSettings(patch).then(setSettings);

  async function finish(makePet: boolean) {
    await ipc.updateSettings({ onboarded: true });
    if (makePet) {
      const pets = await ipc.listPets();
      if (pets.length === 0) await ipc.openCreator();
    }
    await getCurrentWindow().close();
  }

  const pages = [
    <>
      <div className="hero">🐾</div>
      <h1>Welcome to DeskPals!</h1>
      <p className="lead">
        Turn a photo into a little pet that lives on your desktop, keeps you company, reminds you to
        look after yourself, and visits your friends.
      </p>
    </>,
    <>
      <div className="hero">🔒</div>
      <h1>Your stuff stays yours</h1>
      <ul className="points">
        <li>
          <span>📷</span>
          <span>
            <strong>Photo cutout</strong> pets are made entirely on this computer. For{' '}
            <strong>cartoon</strong> pets, the photo is sent once to the drawing service and not
            stored. The original photo is never kept.
          </span>
        </li>
        <li>
          <span>👫</span>
          <span>Only friends you accept (by friend code) can see your pets, mood or messages.</span>
        </li>
        <li>
          <span>🙋</span>
          <span>Pets made from a photo of a person need that person&apos;s permission.</span>
        </li>
        <li>
          <span>🗑️</span>
          <span>Deleting a pet deletes its images from the cloud too.</span>
        </li>
      </ul>
    </>,
    <>
      <div className="hero">🧹</div>
      <h1>Little helpers</h1>
      <p className="lead">
        Your pet can tidy loose files into neat folders — only where you allow it.
      </p>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.tidyDesktop}
          onChange={(e) => update({ tidyDesktop: e.target.checked })}
        />
        Let my pet tidy my Desktop
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.sortDownloads}
          onChange={(e) => update({ sortDownloads: e.target.checked })}
        />
        Let my pet sort my Downloads
      </label>
      <p className="muted small">
        Files are only ever moved (never deleted), you see a preview first, and every tidy has an
        Undo button.
        {isMac &&
          ' The first time, macOS will ask whether DeskPals may access the folder — click Allow.'}
      </p>
      <label className="row">
        <input
          type="checkbox"
          checked={autostart}
          onChange={(e) => {
            const on = e.target.checked;
            void (on ? enable() : disable()).then(() => setAutostart(on)).catch(() => {});
          }}
        />
        Start DeskPals when I log in
      </label>
    </>,
    <>
      <div className="hero">💧</div>
      <h1>Gentle reminders</h1>
      <p className="lead">
        Your pet can nudge you to look after yourself. Change these any time in Settings.
      </p>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.waterEnabled}
          onChange={(e) => update({ waterEnabled: e.target.checked })}
        />
        Drink water (every hour)
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.stretchEnabled}
          onChange={(e) => update({ stretchEnabled: e.target.checked })}
        />
        Stretch (every 45 minutes)
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.eyeEnabled}
          onChange={(e) => update({ eyeEnabled: e.target.checked })}
        />
        Eye breaks (20-20-20)
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={settings.moodCheckin}
          onChange={(e) => update({ moodCheckin: e.target.checked })}
        />
        Ask how I&apos;m feeling now and then
      </label>
      <p className="muted small">
        It stays quiet between 10pm and 8am, while you&apos;re away and during full-screen apps.
      </p>
    </>,
    <>
      <div className="hero">✨</div>
      <h1>Let&apos;s make your first pet</h1>
      <p className="lead">
        Pick a photo of a person, an animal or anything you love. Your pet lives in the menu bar
        {isMac ? ' (top right)' : ' / system tray (bottom right)'} — click the little icon for
        everything else.
      </p>
    </>,
  ];

  const last = step === STEPS - 1;
  return (
    <main className="onboarding">
      {pages[step]}
      <div className="dots">
        {Array.from({ length: STEPS }, (_, i) => (
          <span key={i} className={i === step ? 'on' : ''} />
        ))}
      </div>
      <div className="nav">
        {step > 0 ? (
          <button onClick={() => setStep(step - 1)}>Back</button>
        ) : (
          <button onClick={() => void finish(false)}>Skip</button>
        )}
        {last ? (
          <button className="primary" onClick={() => void finish(true)}>
            Make my pet 🐾
          </button>
        ) : (
          <button className="primary" onClick={() => setStep(step + 1)}>
            Next
          </button>
        )}
      </div>
    </main>
  );
}
