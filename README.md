# DeskPals 🐾

Turn a photo of a person, pet or object into a little animated buddy that lives on your desktop, reminds you to drink water and stretch, tidies your files, and visits your friends' screens.

**What it does**

- 🎨 **Pets from photos** — a cartoon character with 18 expressions (free AI drawing), or the photo itself cut out on-device.
- 🐾 **Lives on your desktop** — walks, sits, sleeps when you're away, reacts to clicks, hovers and shakes; drop it anywhere.
- 💧 **Looks after you** — water, stretch and eye-break reminders, a focus timer, a kind message each morning, mood check-ins with follow-up questions and a guided breathing exercise.
- 👫 **Friends** — add by friend code; send your pet to visit with a message, nudge, send hearts, message, hang out so your pets play together, and see when friends are online or feeling down.
- 🧹 **Chores** — tidy your Desktop or Downloads into dated folders (preview first, one-click undo, never deletes), quick folders and notes.

macOS + Windows · Tauri v2 · React · Supabase

---

## Install (for friends)

Download the latest installer from **[Releases](https://github.com/pulkitsingh98/Buddies/releases/latest)**.

### Windows

1. Download `DeskPals_x.y.z_x64-setup.exe`.
2. Run it. Windows SmartScreen may say _"Windows protected your PC"_, because the app isn't code-signed yet.
   Click **More info → Run anyway**.
3. The installer needs no admin rights. DeskPals appears as a small icon in the system tray (bottom-right;
   check the **^** overflow arrow). Drag it out onto the taskbar to keep it visible.
4. Updates install automatically from then on.

### macOS

1. Download `DeskPals_x.y.z_universal.dmg`, open it and drag **DeskPals** into **Applications**.
2. The first time, **right-click (or Control-click) DeskPals → Open → Open**. macOS Gatekeeper blocks a normal
   double-click because the app isn't notarized yet. If you only see "Move to Bin", go to
   **System Settings → Privacy & Security** and click **Open Anyway**.
3. DeskPals lives in the menu bar (top-right). It has no Dock icon.
4. When you first use _Tidy Desktop_, macOS will ask for permission to access your Desktop / Downloads. That's expected.

---

## Development

### Prerequisites

- Node ≥ 22 and pnpm (`brew install pnpm`)
- Rust stable (`curl https://sh.rustup.rs -sSf | sh`)
- Supabase CLI (`brew install supabase/tap/supabase`) and a Docker runtime (OrbStack or Docker Desktop) for the local DB
- Windows only: Visual Studio Build Tools (C++), WebView2 (preinstalled on Win 11)

### Setup

```sh
pnpm install
cp .env.example .env        # fill in your Supabase URL + anon key
pnpm dev                    # runs the desktop app
```

### Database

```sh
pnpm db:start               # local Supabase in Docker
pnpm db:test                # pgTAP RLS tests
pnpm db:types               # regenerate packages/shared/src/database.types.ts
supabase link --project-ref <ref> && supabase db push   # apply migrations to the hosted project
```

### Release

1. Bump `version` in `apps/desktop/package.json`.
2. Commit, then `git tag v0.1.0 && git push origin main --tags`.
3. GitHub Actions builds the `.dmg` and `.exe`, signs updater artifacts and publishes the release.

#### Required GitHub settings

| Kind     | Name                                 | Value                                            |
| -------- | ------------------------------------ | ------------------------------------------------ |
| Secret   | `TAURI_SIGNING_PRIVATE_KEY`          | contents of `~/.tauri/deskpals-updater.key`      |
| Secret   | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | contents of `~/.tauri/deskpals-updater.password` |
| Variable | `VITE_SUPABASE_URL`                  | your project URL                                 |
| Variable | `VITE_SUPABASE_ANON_KEY`             | your anon (public) key                           |

Code signing hooks for Apple notarization and Windows Authenticode are commented in `.github/workflows/release.yml`.

See `CLAUDE.md` for architecture and conventions.
