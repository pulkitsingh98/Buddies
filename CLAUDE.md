# DeskPals — notes for Claude / contributors

Photo → animated desktop pet. Tauri v2 desktop app (macOS + Windows) + Supabase backend.
Full product spec lives in `docs/spec.md`; decisions and dependency justifications in `docs/decisions.md`.

## Layout

- `apps/desktop/` — Tauri app. `src/` = web frontend (React + TS + Vite, one HTML entry per window type), `src-tauri/` = Rust.
- `packages/shared/` — shared TS constants/types. `database.types.ts` is generated (`pnpm db:types`), never hand-edited.
- `supabase/` — `migrations/` (timestamped SQL), `tests/` (pgTAP, run by `supabase test db`), `functions/` (Edge Functions; all third-party secrets live here).
- `docs/` — spec, decisions, QA checklist.

## Commands (run from repo root)

- `pnpm dev` — run the desktop app with hot reload.
- `pnpm lint` / `pnpm format` / `pnpm typecheck` / `pnpm test`
- `pnpm rust:lint` (fmt check + clippy -D warnings) / `pnpm rust:test`
- `pnpm db:start` (needs Docker/OrbStack) / `pnpm db:reset` / `pnpm db:test` / `pnpm db:types`
- Release: bump `apps/desktop/package.json` version, commit, `git tag vX.Y.Z && git push --tags`.

## Architecture rules (non-negotiable)

- **Lightweight**: ≤30 fps, throttle when idle, pause when full-screen/locked. No server polling — Realtime websockets only.
  Windows other than pets (settings, creator) are created on demand and _destroyed_ on close.
- The app is tray-only: no Dock icon (macOS `ActivationPolicy::Accessory`), no taskbar entry. Closing all windows must not quit (`RunEvent::ExitRequested` → `prevent_exit` unless an exit code is set).
- **Never delete user files.** File chores only move, are logged to SQLite, and are undoable.
- **No secrets in the app.** Only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`. RLS on every table.
- Tauri capabilities are per window label (`src-tauri/capabilities/*.json`); grant the minimum.
- Pet generation goes through the `PetGenerator` interface so new styles plug in without touching the renderer.

## Conventions

- TS strict (+ `noUncheckedIndexedAccess`); no non-null assertions. Prettier: single quotes, 100 cols.
- Rust: `cargo fmt`, clippy clean with `-D warnings`. Tauri commands return `Result<T, String>`-style errors, never panic.
- SQL: `set search_path = ''` on every function; `security definer` only when needed; RLS policies use `(select auth.uid())`.
- Tray menu ids not handled in Rust are emitted as `tray://<id>` events.
- Commit after each meaningful step; keep this file current.

## Platform notes

- macOS transparent windows require `app.macOSPrivateApi: true` (set) and the `macos-private-api` cargo feature (set).
- Windows: WebView2 bootstrapper is embedded in the NSIS installer; Desktop path must come from Known Folders (OneDrive redirection).
- Windows: any Tauri command that creates a window (directly or via `pet_windows::reconcile`) must be `async` — a sync command deadlocks WebView2 and the new window stays blank white.
- Updater: pubkey in `tauri.conf.json`; private key lives at `~/.tauri/deskpals-updater.key` on the dev Mac and in the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret. Never commit it.

## Status

- Phase 1 (pet on desktop): done — photo cutout + cartoon (FLUX.2 on Cloudflare free tier) pets, expressions, click-through.
- Phase 2 (wellbeing): done — reminders, focus timer, daily message, compliments, mood check-in (src/pet/wellbeing.ts, focus.ts, messages.ts). Delivered only by the first active pet.
- Phase 3 (social): done — friends by code, presence, visits/nudges/hearts/messages, offline queue, DND, block, rate limits. Hidden `social` window owns the realtime connection (src/social/main.ts) and talks to other windows via `social://*` events; visitor windows are `visit-<interaction id>`. `scripts/e2e-social.mjs` runs against a local stack in CI.
- Phase 4 (chores & polish): done — tidy/sort with preview + SQLite undo log (src-tauri/src/chores.rs), quick create, hang-out mode (src/pet/visitor.ts + `hangout://` events), onboarding, launch at login, background update checks (src-tauri/src/updates.rs). Mood check-in is a decision tree (src/pet/moods.ts) shared via `share_mood()`.
- Settings live in `settings.json`; wellbeing counters in `wellbeing.json` (both in the app config dir). The undo log is SQLite (`deskpals.db`, rusqlite).

- Phase 0 (foundations): done — v0.1.0 released with universal .dmg + x64 NSIS installer + signed latest.json. Pending: manual install QA on both OSes, hosted Supabase link + `db push`.
- Supabase project ref: `fbsmbgptbkrgmarxctih` (ap-northeast-2).
