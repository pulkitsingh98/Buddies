import { useCallback, useEffect, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { MESSAGE_MAX_LEN } from '@deskpals/shared';
import { ipc, type Settings } from '../lib/ipc';
import { SignIn, useSession } from '../lib/SignIn';
import {
  addFriend,
  blockUser,
  conversation,
  EVENTS,
  friendPet,
  removeFriend,
  respondRequest,
  send,
  unblockUser,
  updateProfile,
  visitingPetId,
  type Friend,
  type Interaction,
  type SocialState,
} from '../lib/social';

const refresh = () => void emit(EVENTS.refresh);

export function FriendsApp() {
  const session = useSession();
  const [social, setSocial] = useState<SocialState | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    const un1 = listen<SocialState>(EVENTS.state, (e) => setSocial(e.payload));
    const un2 = listen<Settings>('settings://changed', (e) => setSettings(e.payload));
    void emit(EVENTS.requestState);
    void ipc.getSettings().then(setSettings);
    return () => {
      void un1.then((f) => f());
      void un2.then((f) => f());
    };
  }, []);

  if (session === undefined) return null;
  if (!session)
    return (
      <main className="friends">
        <h1>Friends</h1>
        <SignIn reason="Sign in to add friends, see when they're online and send your pet to visit them." />
      </main>
    );
  if (!social?.me)
    return (
      <main className="friends">
        <h1>Friends</h1>
        <p className="muted">Connecting…</p>
      </main>
    );

  const friends = social.friends.filter((f) => f.status === 'accepted');
  const incoming = social.friends.filter((f) => f.status === 'pending' && f.incoming);
  const outgoing = social.friends.filter((f) => f.status === 'pending' && !f.incoming);
  const blocked = social.friends.filter((f) => f.status === 'blocked');

  return (
    <main className="friends">
      <h1>Friends</h1>
      <p className="status muted">
        <span className={`dot ${social.connected ? 'on' : ''}`} />
        {social.connected
          ? 'Online'
          : 'Offline — things you receive will arrive when you reconnect'}
      </p>

      <Me name={social.me.display_name} code={social.me.friend_code} />

      {settings && (
        <>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.doNotDisturb}
              onChange={(e) =>
                void ipc.updateSettings({ doNotDisturb: e.target.checked }).then(setSettings)
              }
            />
            Do not disturb (hold visits and messages until I turn this off)
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={settings.shareMood}
              onChange={(e) =>
                void ipc.updateSettings({ shareMood: e.target.checked }).then(setSettings)
              }
            />
            Share my daily mood with friends
          </label>
        </>
      )}

      <AddFriend />

      {incoming.length > 0 && (
        <>
          <h2>Friend requests</h2>
          <ul className="list">
            {incoming.map((f) => (
              <li key={f.friendship_id} className="friend">
                <div className="head" style={{ padding: '8px 10px' }}>
                  <span className="name">{f.display_name}</span> wants to be friends
                  <div className="buttons" style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                    <button
                      className="primary"
                      onClick={() => void respondRequest(f.friendship_id, true).then(refresh)}
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => void respondRequest(f.friendship_id, false).then(refresh)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Your friends</h2>
      {friends.length === 0 && (
        <p className="muted">No friends yet. Share your code above, or add theirs.</p>
      )}
      <ul className="list">
        {friends.map((f) => (
          <FriendRow key={f.user_id} friend={f} online={social.online.includes(f.user_id)} />
        ))}
      </ul>

      {outgoing.length > 0 && (
        <>
          <h2>Waiting for them to accept</h2>
          {outgoing.map((f) => (
            <p key={f.friendship_id} className="row-inline">
              {f.display_name}
              <button className="link" onClick={() => void removeFriend(f.user_id).then(refresh)}>
                Cancel
              </button>
            </p>
          ))}
        </>
      )}

      {blocked.length > 0 && (
        <>
          <h2>Blocked</h2>
          {blocked.map((f) => (
            <p key={f.friendship_id} className="row-inline">
              {f.display_name}
              <button className="link" onClick={() => void unblockUser(f.user_id).then(refresh)}>
                Unblock
              </button>
            </p>
          ))}
        </>
      )}
    </main>
  );
}

function Me({ name, code }: { name: string; code: string }) {
  const [draft, setDraft] = useState(name);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className="code">
        <span className="muted small">Your friend code</span>
        <strong>{code}</strong>
        <button
          onClick={() =>
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <div className="row-inline" style={{ marginTop: 10 }}>
        <input
          type="text"
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Your name (friends see this)"
        />
        <button
          disabled={!draft.trim() || draft.trim() === name}
          onClick={() => void updateProfile({ display_name: draft.trim() }).then(refresh)}
        >
          Save name
        </button>
      </div>
    </>
  );
}

function AddFriend() {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function add() {
    setMsg(null);
    try {
      const f = await addFriend(code);
      setMsg({
        ok: true,
        text:
          f.status === 'accepted'
            ? "You're now friends! 🎉"
            : 'Request sent! They need to accept it.',
      });
      setCode('');
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }
  return (
    <>
      <h2>Add a friend</h2>
      <form
        className="row-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          type="text"
          placeholder="Their 8-letter code"
          value={code}
          maxLength={8}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="primary" type="submit" disabled={code.trim().length !== 8}>
          Add
        </button>
      </form>
      {msg && <p className={msg.ok ? 'ok small' : 'error small'}>{msg.text}</p>}
    </>
  );
}

function FriendRow({ friend, online }: { friend: Friend; online: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [chat, setChat] = useState<Interaction[]>([]);
  const [avatar, setAvatar] = useState<{ url: string; size: string; pos: string } | null>(null);
  const [confirm, setConfirm] = useState<'remove' | 'block' | null>(null);

  const loadChat = useCallback(() => {
    void conversation(friend.user_id)
      .then(setChat)
      .catch(() => {});
  }, [friend.user_id]);

  useEffect(() => {
    if (open) loadChat();
  }, [open, loadChat]);

  // Their pet's neutral frame as the avatar.
  useEffect(() => {
    if (!friend.avatar_pet_id) return;
    let url: string | null = null;
    void friendPet(friend.avatar_pet_id).then(async (p) => {
      if (!p) return;
      url = URL.createObjectURL(p.sprite);
      const bmp = await createImageBitmap(p.sprite);
      const r = p.manifest.sprite.frames?.neutral?.[0] ?? {
        x: 0,
        y: 0,
        w: p.manifest.sprite.width,
        h: p.manifest.sprite.height,
      };
      const scale = 44 / Math.max(r.w, r.h);
      setAvatar({
        url,
        size: `${bmp.width * scale}px ${bmp.height * scale}px`,
        pos: `${-r.x * scale + (44 - r.w * scale) / 2}px ${-r.y * scale + (44 - r.h * scale) / 2}px`,
      });
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [friend.avatar_pet_id]);

  async function act(kind: 'visit' | 'nudge' | 'heart' | 'message') {
    setStatus(null);
    try {
      if (kind === 'message' && !text.trim()) return;
      const pet = kind === 'visit' ? await visitingPetId() : null;
      if (kind === 'visit' && !pet) throw new Error('Make a pet first — it does the visiting!');
      await send(
        friend.user_id,
        kind,
        kind === 'visit' || kind === 'message' ? text.trim() : undefined,
        pet ?? undefined,
      );
      const done = {
        visit: online
          ? 'Your pet is on its way! 🐾'
          : `Your pet will visit when ${friend.display_name} is back.`,
        nudge: 'Nudged! 👉',
        heart: 'Sent some love 💕',
        message: 'Sent!',
      }[kind];
      setStatus({ ok: true, text: done });
      if (kind === 'visit' || kind === 'message') setText('');
      loadChat();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <li className="friend">
      <button className="head" onClick={() => setOpen(!open)}>
        <span
          className="avatar checker"
          style={
            avatar
              ? {
                  backgroundImage: `url(${avatar.url})`,
                  backgroundSize: avatar.size,
                  backgroundPosition: avatar.pos,
                }
              : {}
          }
        />
        <span>
          <span className="name">{friend.display_name}</span>
          <br />
          <span className="muted small">
            <span className={`dot ${online ? 'on' : ''}`} />
            {online ? 'online' : 'offline'}
            {friend.mood_emoji ? ` · feeling ${friend.mood_emoji}` : ''}
          </span>
        </span>
        <span className="muted">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="panel">
          {chat.length > 0 && (
            <div className="chat">
              {chat.map((m) => (
                <div key={m.id} className={`msg ${m.sender_id === friend.user_id ? '' : 'mine'}`}>
                  {m.type === 'message' || m.body
                    ? m.body
                    : ({
                        visit: '🐾 visit',
                        nudge: '👉 nudge',
                        heart: '💕',
                        hangout_invite: '🎈 hang out?',
                      }[m.type] ?? m.type)}
                </div>
              ))}
            </div>
          )}
          <textarea
            placeholder={`Say something to ${friend.display_name} (sent with a visit or as a message)`}
            maxLength={MESSAGE_MAX_LEN}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="muted small">
            {text.length}/{MESSAGE_MAX_LEN}
          </div>
          <div className="buttons">
            <button className="primary" onClick={() => void act('visit')}>
              🐾 Send my pet to visit
            </button>
            <button disabled={!text.trim()} onClick={() => void act('message')}>
              ✉️ Message
            </button>
            <button onClick={() => void act('nudge')}>👉 Nudge</button>
            <button onClick={() => void act('heart')}>💕 Heart</button>
          </div>
          {status && <p className={status.ok ? 'ok small' : 'error small'}>{status.text}</p>}
          <div className="buttons" style={{ marginTop: 10 }}>
            {confirm ? (
              <>
                <button
                  className="danger"
                  onClick={() =>
                    void (
                      confirm === 'remove'
                        ? removeFriend(friend.user_id)
                        : blockUser(friend.user_id)
                    ).then(refresh)
                  }
                >
                  {confirm === 'remove'
                    ? `Remove ${friend.display_name}?`
                    : `Block ${friend.display_name}?`}
                </button>
                <button onClick={() => setConfirm(null)}>Cancel</button>
              </>
            ) : (
              <>
                <button className="link" onClick={() => setConfirm('remove')}>
                  Remove friend
                </button>
                <button className="link" onClick={() => setConfirm('block')}>
                  Block
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
