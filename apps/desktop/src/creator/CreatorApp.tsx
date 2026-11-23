import { useEffect, useMemo, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { CARTOON_FRAMES, type PetKind } from '@deskpals/shared';
import { ipc } from '../lib/ipc';
import { SignIn, useSession } from '../lib/SignIn';
import {
  CartoonGenerator,
  CutoutGenerator,
  resize,
  toCanvas,
  type GeneratedPet,
  type GenerationProgress,
  type PetGenerator,
} from './generator';
import { OnDeviceRemover, type RemoverStatus } from './remover';
import { adjustEdge, coverage, trim, type RawImage } from './stylize';

const MAX_PHOTO = 1600;
const MAX_SUBJECT = 800;
const FRAME_CSS = 360;
const FRAME_OUT = 512;

type Step =
  | { kind: 'pick' }
  | { kind: 'working'; status: RemoverStatus | null }
  | { kind: 'drawing'; progress: GenerationProgress | null }
  | { kind: 'adjust' }
  | { kind: 'review'; pet: GeneratedPet; url: string }
  | { kind: 'saved'; name: string };

const KINDS: { id: PetKind; label: string }[] = [
  { id: 'animal', label: '🐾 Animal' },
  { id: 'person', label: '🙂 Person' },
  { id: 'object', label: '🧸 Object' },
];

type Style = 'cartoon' | 'cutout';

const remover = new OnDeviceRemover();
const cutoutGenerator: PetGenerator = new CutoutGenerator();
const cartoonGenerator: PetGenerator = new CartoonGenerator();

export function CreatorApp() {
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [photo, setPhoto] = useState<{ bitmap: ImageBitmap; url: string } | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<PetKind>('animal');
  const [consent, setConsent] = useState(false);
  const [subject, setSubject] = useState<RawImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<Style>('cartoon');
  const session = useSession();

  useEffect(() => () => remover.dispose(), []);

  const needsSignIn = style === 'cartoon' && !session;
  const canStart = photo && name.trim() && (kind !== 'person' || consent) && !needsSignIn;

  async function drawCartoon() {
    if (!photo) return;
    setError(null);
    setStep({ kind: 'drawing', progress: null });
    try {
      const pet = await cartoonGenerator.generate(
        { name, kind, consentConfirmed: kind === 'person' ? consent : false, photo: photo.bitmap },
        (progress) => setStep({ kind: 'drawing', progress }),
      );
      setStep({ kind: 'review', pet, url: URL.createObjectURL(pet.sprite) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: 'pick' });
    }
  }

  async function choose(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    setError(null);
    try {
      const raw = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const s = Math.min(1, MAX_PHOTO / Math.max(raw.width, raw.height));
      const bitmap =
        s < 1
          ? await createImageBitmap(raw, {
              resizeWidth: Math.round(raw.width * s),
              resizeHeight: Math.round(raw.height * s),
              resizeQuality: 'high',
            })
          : raw;
      if (photo) URL.revokeObjectURL(photo.url);
      setPhoto({ bitmap, url: URL.createObjectURL(file) });
      if (!name) setName(file.name.replace(/\.[^.]+$/, '').slice(0, 20));
    } catch {
      setError("That image couldn't be opened. Try a JPG or PNG.");
    }
  }

  async function cutOut(wholePhoto = false) {
    if (!photo) return;
    setError(null);
    setStep({ kind: 'working', status: null });
    try {
      let cut: RawImage;
      if (wholePhoto) {
        const c = new OffscreenCanvas(photo.bitmap.width, photo.bitmap.height);
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(photo.bitmap, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        cut = { width: d.width, height: d.height, data: d.data };
      } else {
        cut = await remover.removeBackground(photo.bitmap, (status) =>
          setStep({ kind: 'working', status }),
        );
      }
      const trimmed = trim(cut, 16);
      if (!trimmed || coverage(trimmed) < 0.02) {
        throw new Error("Couldn't find a clear subject in this photo.");
      }
      setSubject(
        resize(trimmed, Math.min(1, MAX_SUBJECT / Math.max(trimmed.width, trimmed.height))),
      );
      setStep({ kind: 'adjust' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep({ kind: 'pick' });
    }
  }

  async function finish(framed: RawImage) {
    setError(null);
    try {
      const pet = await cutoutGenerator.generate({
        name,
        kind,
        consentConfirmed: kind === 'person' ? consent : false,
        cutout: framed,
      });
      setStep({ kind: 'review', pet, url: URL.createObjectURL(pet.sprite) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save(pet: GeneratedPet) {
    try {
      await ipc.savePet(pet.manifest, pet.sprite);
      setStep({ kind: 'saved', name: pet.manifest.name });
    } catch (e) {
      setError(`Couldn't save: ${String(e)}`);
    }
  }

  function reset() {
    if (photo) URL.revokeObjectURL(photo.url);
    setPhoto(null);
    setSubject(null);
    setName('');
    setConsent(false);
    setStep({ kind: 'pick' });
  }

  return (
    <main className="creator">
      {step.kind === 'pick' && (
        <>
          <h1>Make a pet</h1>
          <p className="muted">
            Pick a photo of a person, animal or thing. It is processed on this computer and the
            original photo is not kept.
          </p>
          <DropZone photoUrl={photo?.url} onFile={choose} />
          <h2>Name</h2>
          <input
            type="text"
            value={name}
            maxLength={40}
            placeholder="e.g. Biscuit"
            onChange={(e) => setName(e.target.value)}
          />
          <h2>Style</h2>
          <div className="kinds">
            <button aria-pressed={style === 'cartoon'} onClick={() => setStyle('cartoon')}>
              🎨 Cartoon
            </button>
            <button aria-pressed={style === 'cutout'} onClick={() => setStyle('cutout')}>
              📷 Photo cutout
            </button>
          </div>
          <p className="muted small">
            {style === 'cartoon'
              ? 'Redraws your photo as a cartoon character with 18 expressions and poses — laughs, blushes, sulks, waves, sleeps. Takes a few minutes; your photo is sent once to the image service and not stored.'
              : 'Animates your actual photo with the background removed. Free, works offline, and the photo never leaves this computer.'}
          </p>
          {needsSignIn && session === null && (
            <SignIn reason="Cartoon pets are drawn by an AI service, so they need a (free) sign-in. You can make up to 6 a day." />
          )}
          <h2>What is it?</h2>
          <div className="kinds">
            {KINDS.map((k) => (
              <button key={k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          {kind === 'person' && (
            <label className="row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I have this person&apos;s permission to turn their photo into a pet.
            </label>
          )}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            {error && photo && style === 'cutout' && (
              <button onClick={() => void cutOut(true)}>Use the whole photo</button>
            )}
            <button
              className="primary"
              disabled={!canStart}
              onClick={() => void (style === 'cartoon' ? drawCartoon() : cutOut())}
            >
              Make my pet
            </button>
          </div>
        </>
      )}

      {step.kind === 'working' && <Working status={step.status} />}

      {step.kind === 'drawing' && <Drawing progress={step.progress} />}

      {step.kind === 'adjust' && subject && (
        <Adjust
          subject={subject}
          error={error}
          onBack={() => setStep({ kind: 'pick' })}
          onDone={(framed) => void finish(framed)}
        />
      )}

      {step.kind === 'review' && (
        <>
          <h1>Meet {step.pet.manifest.name}!</h1>
          <p className="muted">
            {step.pet.manifest.style === 'stylized'
              ? `All of ${step.pet.manifest.name}'s faces and poses.`
              : 'This is how your pet will look on the desktop.'}
          </p>
          <div className="review checker">
            <img src={step.url} alt={step.pet.manifest.name} />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            {step.pet.manifest.style === 'stylized' ? (
              <button onClick={() => void drawCartoon()}>Draw again</button>
            ) : (
              <button onClick={() => setStep({ kind: 'adjust' })}>Back</button>
            )}
            <button className="primary" onClick={() => void save(step.pet)}>
              Put it on my desktop
            </button>
          </div>
        </>
      )}

      {step.kind === 'saved' && (
        <>
          <h1>{step.name} is out! 🎉</h1>
          <p>
            Look at the bottom of your screen. Click it, hover over it, double-click it, drag it
            around (try giving it a shake) — and see how it reacts.
          </p>
          <div className="actions">
            <button onClick={reset}>Make another</button>
            <button className="primary" onClick={() => void getCurrentWindow().close()}>
              Done
            </button>
          </div>
        </>
      )}
    </main>
  );
}

function DropZone({ photoUrl, onFile }: { photoUrl?: string; onFile: (f?: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFile(e.dataTransfer.files[0]);
      }}
    >
      {photoUrl ? (
        <img src={photoUrl} alt="Selected photo" />
      ) : (
        <span className="muted">
          Drop a photo here
          <br />
          or click to choose one
        </span>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => onFile(e.target.files?.[0])}
      />
    </div>
  );
}

function Working({ status }: { status: RemoverStatus | null }) {
  if (status?.phase === 'downloading' && status.progress.downloaded < status.progress.total) {
    const mb = (n: number) => Math.round(n / 1e6);
    return (
      <>
        <h1>One-time setup…</h1>
        <p className="muted">
          Downloading the on-device cutout model ({mb(status.progress.downloaded)} /{' '}
          {mb(status.progress.total)} MB). This only happens once, and it means your photos never
          leave this computer.
        </p>
        <progress value={status.progress.downloaded} max={status.progress.total} />
      </>
    );
  }
  return (
    <>
      <h1>Cutting out your pet…</h1>
      <p className="muted">
        {status?.phase === 'segmenting' ? 'Finding the subject — a few seconds.' : 'Getting ready…'}
      </p>
      <progress />
    </>
  );
}

const FRAME_LABELS: Record<string, string> = {
  neutral: 'Hello',
  blink: 'Blink',
  happy: 'Happy',
  laugh: 'Laugh',
  love: 'Love',
  blush: 'Blush',
  surprised: 'Surprised',
  sad: 'Sad',
  grumpy: 'Grumpy',
  sleepy: 'Sleepy',
  asleep: 'Asleep',
  wink: 'Wink',
  dizzy: 'Dizzy',
  walk1: 'Walk',
  walk2: 'Walk',
  sit: 'Sit',
  wave: 'Wave',
  celebrate: 'Yay!',
};

function Drawing({ progress }: { progress: GenerationProgress | null }) {
  const done = progress ? Object.keys(progress.previews).length : 0;
  return (
    <>
      <h1>{done === 0 ? 'Drawing your character…' : 'Drawing expressions…'}</h1>
      <p className="muted">
        {done === 0
          ? 'First the main character (about 30 seconds)…'
          : `${done} of ${CARTOON_FRAMES.length} done. This takes a couple of minutes.`}
      </p>
      <progress value={done} max={CARTOON_FRAMES.length} />
      <div className="frames">
        {CARTOON_FRAMES.map((f) => {
          const url = progress?.previews[f];
          const failed = progress?.failed.includes(f);
          return (
            <figure key={f} className="checker">
              {url ? (
                <img src={url} alt={f} />
              ) : (
                <span className="muted">{failed ? '✕' : '…'}</span>
              )}
              <figcaption>{FRAME_LABELS[f] ?? f}</figcaption>
            </figure>
          );
        })}
      </div>
    </>
  );
}

function Adjust({
  subject,
  error,
  onBack,
  onDone,
}: {
  subject: RawImage;
  error: string | null;
  onBack: () => void;
  onDone: (framed: RawImage) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [edge, setEdge] = useState(0);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const edgeStep = Math.max(1, Math.round(Math.max(subject.width, subject.height) / 250));
  const edged = useMemo(
    () => toCanvas(adjustEdge(subject, edge * edgeStep)),
    [subject, edge, edgeStep],
  );
  const fit = (FRAME_CSS * 0.84) / Math.max(subject.width, subject.height);

  const drawFrame = (
    ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
    size: number,
  ) => {
    const k = size / FRAME_CSS;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2 + pan.x * k, size / 2 + pan.y * k);
    ctx.scale(fit * zoom * k, fit * zoom * k);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(edged, -subject.width / 2, -subject.height / 2);
    ctx.restore();
  };

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = FRAME_CSS * dpr;
    c.height = FRAME_CSS * dpr;
    drawFrame(ctx, c.width);
  });

  function done() {
    const out = new OffscreenCanvas(FRAME_OUT, FRAME_OUT);
    const ctx = out.getContext('2d');
    if (!ctx) return;
    drawFrame(ctx, FRAME_OUT);
    const d = ctx.getImageData(0, 0, FRAME_OUT, FRAME_OUT);
    onDone({ width: FRAME_OUT, height: FRAME_OUT, data: d.data });
  }

  return (
    <>
      <h1>Frame your pet</h1>
      <p className="muted">Drag to move it. Anything outside the square is cropped off.</p>
      <canvas
        ref={canvas}
        className="frame checker"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setPan({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y });
        }}
        onPointerUp={() => (drag.current = null)}
      />
      <label className="slider">
        Size
        <input
          type="range"
          min={0.4}
          max={2.5}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </label>
      <label className="slider">
        Edges
        <input
          type="range"
          min={-3}
          max={3}
          step={1}
          value={edge}
          onChange={(e) => setEdge(Number(e.target.value))}
        />
      </label>
      <p className="muted small">Edges: left trims the outline tighter, right keeps more.</p>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button onClick={onBack}>Back</button>
        <button className="primary" onClick={done}>
          Next
        </button>
      </div>
    </>
  );
}
