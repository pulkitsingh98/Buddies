import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ipc, type ChoreFolder, type Settings, type TidyBatch, type TidyPlan } from '../lib/ipc';
import {
  CATEGORY_ICONS,
  CHORES_UNDONE,
  choresPetName,
  runTidy,
  today,
  undoTidy,
} from '../lib/chores';

const isMac = navigator.userAgent.includes('Mac');
type Msg = { ok: boolean; text: string } | null;

export function ChoresApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [history, setHistory] = useState<TidyBatch[]>([]);
  const [msg, setMsg] = useState<Msg>(null);

  const loadHistory = useCallback(() => {
    void ipc
      .tidyHistory()
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => {
    void ipc.getSettings().then(setSettings);
    loadHistory();
    const un = listen(CHORES_UNDONE, loadHistory);
    return () => void un.then((f) => f());
  }, [loadHistory]);

  if (!settings) return null;
  const toggle = (patch: Partial<Settings>) => void ipc.updateSettings(patch).then(setSettings);
  const lastUndoable = history.find((b) => !b.undone);

  async function undo() {
    setMsg(null);
    try {
      const r = await undoTidy();
      if (!r) setMsg({ ok: true, text: 'Nothing to undo.' });
      else
        setMsg({
          ok: true,
          text:
            `Put ${r.restored} file${r.restored === 1 ? '' : 's'} back where ${r.restored === 1 ? 'it was' : 'they were'}.` +
            (r.renamed.length
              ? ` ${r.renamed.length} got a "(1)" because something new had the same name.`
              : '') +
            (r.missing.length
              ? ` ${r.missing.length} had already been moved, so I left them.`
              : ''),
        });
      loadHistory();
    } catch (e) {
      setMsg({ ok: false, text: String(e) });
    }
  }

  return (
    <main className="chores">
      <h1>Chores</h1>
      <p className="muted small">
        Your pet only ever <strong>moves</strong> files — it never deletes or overwrites anything,
        and every tidy can be undone. Folders, hidden files, shortcuts and files that are open or
        still downloading are left alone.
      </p>

      <div className="card">
        <h2>Allowed folders</h2>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.tidyDesktop}
            onChange={(e) => toggle({ tidyDesktop: e.target.checked })}
          />
          Desktop
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.sortDownloads}
            onChange={(e) => toggle({ sortDownloads: e.target.checked })}
          />
          Downloads
        </label>
        {isMac && (
          <p className="muted small">
            The first time, macOS asks whether DeskPals may access the folder — click{' '}
            <strong>Allow</strong>. You can change it later in System Settings → Privacy &amp;
            Security → Files and Folders.
          </p>
        )}
      </div>

      <TidyCard
        folder="desktop"
        title="Tidy Desktop"
        enabled={settings.tidyDesktop}
        onDone={(m) => {
          setMsg(m);
          loadHistory();
        }}
      />
      <TidyCard
        folder="downloads"
        title="Sort Downloads"
        enabled={settings.sortDownloads}
        onDone={(m) => {
          setMsg(m);
          loadHistory();
        }}
      />

      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}

      <div className="card">
        <h2>Undo</h2>
        {lastUndoable ? (
          <p className="row-inline">
            Last tidy: {lastUndoable.count} files from {lastUndoable.folder},{' '}
            {new Date(lastUndoable.at * 1000).toLocaleString()}
            <button onClick={() => void undo()}>↩️ Undo last tidy</button>
          </p>
        ) : (
          <p className="muted">Nothing to undo.</p>
        )}
        {history.length > 0 && (
          <details>
            <summary className="muted small">History (last 30 days)</summary>
            <ul className="files">
              {history.map((b) => (
                <li key={b.id}>
                  {new Date(b.at * 1000).toLocaleString()} — {b.count} from {b.folder}
                  {b.undone ? ' (undone)' : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <QuickCreate />
    </main>
  );
}

function TidyCard({
  folder,
  title,
  enabled,
  onDone,
}: {
  folder: ChoreFolder;
  title: string;
  enabled: boolean;
  onDone: (m: Msg) => void;
}) {
  const [plan, setPlan] = useState<TidyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function preview() {
    setError(null);
    setBusy(true);
    try {
      setPlan(await ipc.tidyPreview(folder, await choresPetName(), today()));
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  }

  async function tidy() {
    setBusy(true);
    try {
      const r = await runTidy(folder);
      setPlan(null);
      onDone({
        ok: true,
        text:
          `Moved ${r.moved} file${r.moved === 1 ? '' : 's'} into “${r.dest.split(/[\\/]/).slice(-2).join('/')}”.` +
          (r.failed.length
            ? ` ${r.failed.length} changed since the preview and were left alone.`
            : ''),
      });
      if (r.moved) void ipc.reveal(r.dest).catch(() => {});
    } catch (e) {
      setError(String(e));
    }
    setBusy(false);
  }

  const counts = new Map<string, number>();
  for (const m of plan?.moves ?? []) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);

  return (
    <div className="card">
      <h2>{title}</h2>
      {!enabled ? (
        <p className="muted small">Turn on this folder above first.</p>
      ) : !plan ? (
        <button className="primary" disabled={busy} onClick={() => void preview()}>
          Preview
        </button>
      ) : plan.moves.length === 0 ? (
        <p className="muted">Already tidy! ✨</p>
      ) : (
        <>
          <p className="small">
            {plan.moves.length} file{plan.moves.length === 1 ? '' : 's'} will go into{' '}
            <strong>{plan.dest.split(/[\\/]/).slice(-2).join('/')}</strong>:
          </p>
          <div className="cats">
            {[...counts].map(([c, n]) => (
              <span key={c} className="cat">
                {CATEGORY_ICONS[c] ?? '📦'} {c} {n}
              </span>
            ))}
          </div>
          <details>
            <summary className="muted small">Show files</summary>
            <ul className="files">
              {plan.moves.map((m) => (
                <li key={m.from}>
                  {m.from.split(/[\\/]/).pop()} → {m.category}
                </li>
              ))}
            </ul>
          </details>
          {plan.skipped.length > 0 && (
            <details>
              <summary className="muted small">Leaving {plan.skipped.length} alone</summary>
              <ul className="files">
                {plan.skipped.map((s) => (
                  <li key={s.name}>
                    {s.name} — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="row-inline" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy} onClick={() => void tidy()}>
              Tidy {plan.moves.length} file{plan.moves.length === 1 ? '' : 's'}
            </button>
            <button onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </>
      )}
      {error && <p className="error small">{error}</p>}
    </div>
  );
}

function QuickCreate() {
  const [folder, setFolder] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const name = (p: string) => p.split(/[\\/]/).pop();

  return (
    <div className="card">
      <h2>Quick create</h2>
      <form
        className="row-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void ipc
            .quickFolder(folder)
            .then((p) => {
              setMsg({ ok: true, text: `Made the folder “${name(p)}” on your Desktop.` });
              setFolder('');
            })
            .catch((err: unknown) => setMsg({ ok: false, text: String(err) }));
        }}
      >
        <input
          type="text"
          placeholder="New folder name"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
        />
        <button type="submit" disabled={!folder.trim()}>
          📁 Create folder
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ipc
            .quickNote(title, body)
            .then((p) => {
              setMsg({ ok: true, text: `Saved “${name(p)}” on your Desktop.` });
              setTitle('');
              setBody('');
            })
            .catch((err: unknown) => setMsg({ ok: false, text: String(err) }));
        }}
      >
        <input
          type="text"
          placeholder="Note title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ marginTop: 10 }}
        />
        <textarea
          placeholder="Write your note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="submit" disabled={!title.trim()}>
          📝 Save note to Desktop
        </button>
      </form>
      {msg && <p className={msg.ok ? 'ok small' : 'error small'}>{msg.text}</p>}
    </div>
  );
}
