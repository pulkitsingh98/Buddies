import { useCallback, useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import type { PetManifest } from '@deskpals/shared';
import { APP_NAME } from '@deskpals/shared';
import { ipc, type Settings } from '../lib/ipc';
import { useSession } from '../lib/SignIn';
import { supabase } from '../lib/supabase';
import { checkForUpdate } from '../lib/updater';

export function App() {
  const [version, setVersion] = useState('');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [pets, setPets] = useState<PetManifest[]>([]);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);

  const refreshPets = useCallback(() => {
    ipc
      .listPets()
      .then(setPets)
      .catch(() => setPets([]));
  }, []);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion('dev'));
    ipc
      .getSettings()
      .then(setSettings)
      .catch(() => {});
    refreshPets();
    // Pets created in the creator window, or tray toggles, show up here live.
    const unlisten = listen<Settings>('settings://changed', (e) => {
      setSettings(e.payload);
      refreshPets();
    });
    return () => void unlisten.then((f) => f());
  }, [refreshPets]);

  const update = (patch: Partial<Settings>) => {
    ipc
      .updateSettings(patch)
      .then(setSettings)
      .catch(() => {});
  };

  if (!settings) return null;

  const toggleOut = (id: string) => {
    const out = settings.activePets.includes(id);
    update({
      activePets: out ? settings.activePets.filter((p) => p !== id) : [...settings.activePets, id],
      petsVisible: true,
    });
  };

  return (
    <main className="settings">
      <h1>{APP_NAME}</h1>
      <p className="muted small">Version {version}</p>

      <h2>Your pets</h2>
      {pets.length === 0 && <p className="muted">No pets yet.</p>}
      <ul className="pets">
        {pets.map((p) => (
          <PetRow
            key={p.id}
            pet={p}
            out={settings.activePets.includes(p.id)}
            onToggle={() => toggleOut(p.id)}
            onDelete={() => void ipc.deletePet(p.id).then(refreshPets)}
          />
        ))}
      </ul>
      <p>
        <button className="primary" onClick={() => void ipc.openCreator()}>
          + New pet
        </button>
      </p>

      <h2>Pets</h2>
      <Slider
        key={settings.petSize}
        label="Size"
        min={80}
        max={320}
        step={10}
        value={settings.petSize}
        unit="px"
        onChange={(v) => update({ petSize: v })}
      />
      <Slider
        key={settings.sleepAfterMin}
        label="Fall asleep after"
        min={1}
        max={60}
        step={1}
        value={settings.sleepAfterMin}
        unit="min"
        onChange={(v) => update({ sleepAfterMin: v })}
      />
      <Slider
        key={settings.bedtimeHour}
        label="Bedtime nudge from"
        min={19}
        max={23}
        step={1}
        value={settings.bedtimeHour}
        unit=":00"
        onChange={(v) => update({ bedtimeHour: v })}
      />
      <label className="row">
        <input
          type="checkbox"
          checked={settings.reducedMotion}
          onChange={(e) => update({ reducedMotion: e.target.checked })}
        />
        Reduced motion (calmer animations, no wandering)
      </label>

      <h2>Wellbeing</h2>
      <p className="muted small">
        Your first pet delivers these as speech bubbles. Nothing interrupts you during quiet hours,
        a focus session, a full-screen app, or while you&apos;re away.
      </p>
      <Today />
      {(
        [
          ['water', 'Water reminders', 'waterEnabled', 'waterEveryMin'],
          ['stretch', 'Stretch reminders', 'stretchEnabled', 'stretchEveryMin'],
          ['eye', 'Eye breaks (20-20-20)', 'eyeEnabled', 'eyeEveryMin'],
        ] as const
      ).map(([id, label, enabledKey, everyKey]) => (
        <div key={id}>
          <label className="row">
            <input
              type="checkbox"
              checked={settings[enabledKey]}
              onChange={(e) => update({ [enabledKey]: e.target.checked })}
            />
            {label}
          </label>
          {settings[enabledKey] && (
            <Slider
              key={settings[everyKey]}
              label="Every"
              min={10}
              max={id === 'eye' ? 120 : 180}
              step={5}
              value={settings[everyKey]}
              unit=" min"
              onChange={(v) => update({ [everyKey]: v })}
            />
          )}
        </div>
      ))}
      <Slider
        key={`qs${settings.quietStart}`}
        label="Quiet from"
        min={0}
        max={23}
        step={1}
        value={settings.quietStart}
        unit=":00"
        onChange={(v) => update({ quietStart: v })}
      />
      <Slider
        key={`qe${settings.quietEnd}`}
        label="Quiet until"
        min={0}
        max={23}
        step={1}
        value={settings.quietEnd}
        unit=":00"
        onChange={(v) => update({ quietEnd: v })}
      />
      <Slider
        key={`f${settings.focusMin}`}
        label="Focus session"
        min={5}
        max={90}
        step={5}
        value={settings.focusMin}
        unit=" min"
        onChange={(v) => update({ focusMin: v })}
      />
      <Slider
        key={`b${settings.breakMin}`}
        label="Break"
        min={1}
        max={30}
        step={1}
        value={settings.breakMin}
        unit=" min"
        onChange={(v) => update({ breakMin: v })}
      />
      {(
        [
          ['dailyMessage', 'A kind message each morning'],
          ['compliments', 'Occasional compliments'],
          ['moodCheckin', 'Daily mood check-in'],
        ] as const
      ).map(([key, label]) => (
        <label className="row" key={key}>
          <input
            type="checkbox"
            checked={settings[key]}
            onChange={(e) => update({ [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}

      <h2>Account</h2>
      <Account />

      <div className="footer">
        <button
          onClick={() => {
            setUpdateStatus('Checking…');
            void checkForUpdate().then(setUpdateStatus);
          }}
        >
          Check for updates
        </button>
        {updateStatus && <span className="muted small">{updateStatus}</span>}
      </div>
    </main>
  );
}

function PetRow({
  pet,
  out,
  onToggle,
  onDelete,
}: {
  pet: PetManifest;
  out: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    ipc
      .getPetSprite(pet.id)
      .then((b) => setUrl((u = URL.createObjectURL(b))))
      .catch(() => {});
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [pet.id]);
  return (
    <li className="pet">
      {url ? <img src={url} alt="" /> : <span />}
      <div>
        <div className="name">{pet.name}</div>
        <div className="muted small">{out ? 'On your desktop' : 'Resting'}</div>
      </div>
      <button onClick={onToggle}>{out ? 'Bring in' : 'Let out'}</button>
      {confirming ? (
        <button className="danger" onClick={onDelete}>
          Delete forever?
        </button>
      ) : (
        <button className="danger" onClick={() => setConfirming(true)}>
          Delete
        </button>
      )}
    </li>
  );
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  // The parent re-keys this component when the saved value changes, resetting `local`.
  const [local, setLocal] = useState(props.value);
  return (
    <label className="slider">
      {props.label}
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        // Commit on release so dragging the slider doesn't rewrite settings 60×/s.
        onPointerUp={() => props.onChange(local)}
        onKeyUp={() => props.onChange(local)}
      />
      <span className="muted small">
        {local}
        {props.unit}
      </span>
    </label>
  );
}

function Today() {
  const [state, setState] = useState<{
    waterGlasses?: number;
    mood?: string;
    focusSessionsToday?: number;
    focusStreak?: number;
    day?: string;
  } | null>(null);
  useEffect(() => {
    const load = () =>
      void ipc
        .getWellbeingState()
        .then((s) => setState(s as typeof state))
        .catch(() => {});
    load();
    const t = window.setInterval(load, 10_000);
    return () => clearInterval(t);
  }, []);
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const fresh = state?.day === today;
  return (
    <p className="muted small">
      Today: 💧 {fresh ? (state?.waterGlasses ?? 0) : 0} glasses · 🍅{' '}
      {fresh ? (state?.focusSessionsToday ?? 0) : 0} focus sessions
      {state?.focusStreak ? ` · 🔥 ${state.focusStreak}-day streak` : ''}
      {state?.mood ? ` · mood ${state.mood}` : ''}
    </p>
  );
}

function Account() {
  const session = useSession();
  if (session === undefined) return null;
  if (!session)
    return (
      <p className="muted small">Not signed in. You&apos;ll be asked when making a cartoon pet.</p>
    );
  return (
    <p className="small">
      Signed in as {session.user.email}{' '}
      <button className="link" onClick={() => void supabase?.auth.signOut()}>
        Sign out
      </button>
    </p>
  );
}
