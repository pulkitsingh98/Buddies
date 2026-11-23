import { useCallback, useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { listen } from '@tauri-apps/api/event';
import type { PetManifest } from '@deskpals/shared';
import { APP_NAME } from '@deskpals/shared';
import { ipc, type Settings } from '../lib/ipc';
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
