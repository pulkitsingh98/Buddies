# Decisions

## 2026-11-23 — Foundations

- **Name / id**: DeskPals, `com.pulkitsingh.deskpals`. The id is effectively permanent (updater, macOS TCC permissions).
- **Package manager**: pnpm workspaces.
- **TypeScript 6.0, not 7.0**: typescript-eslint 8.x supports `<6.1`. Revisit when it supports TS 7.
- **Windows target**: x64 only (NSIS, per-user install, no admin prompt). Add `aarch64-pc-windows-msvc` to the release matrix if an ARM friend joins.
- **macOS target**: one universal `.dmg` (Apple Silicon + Intel), min macOS 11.
- **Release flow**: draft release → matrix build via `tauri-action@v1` with `releaseId` → publish. Avoids races between matrix jobs creating the same release.
- **Updater**: GitHub Releases `latest/download/latest.json`. Works because the repo is public; a private repo would need a proxy.
- **Windows-on-demand**: settings/creator windows are built when opened and destroyed on close to keep idle RAM low.
- **Background removal (planned, Phase 1)**: on-device `onnxruntime-web` (MIT) in the creator window only, with an Apache-2.0 model
  (ISNet / U²-Net family), downloaded on first use rather than bundled. Rejected: BRIA RMBG (non-commercial licence),
  `@imgly/background-removal` (AGPL), Rust `ort` (still 2.0 RC; native dylib packaging per OS).

## Dependencies over ~1 MB

| Dependency                                | Size        | Why                                                                       |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| WebView2 bootstrapper (Windows installer) | ~1.8 MB     | Required on Windows 10 machines without WebView2; spec asks to bundle it. |
| React + ReactDOM (settings window only)   | ~190 KB min | Under threshold; listed for awareness. Pet windows will not load React.   |

## 2026-11-23 — Cartoon pets on a free image model
- **Requirement**: no paid services.
- **Choice**: FLUX.2 [klein] 4B on **Cloudflare Workers AI**, called from the `generate-pet` Edge Function.
  The free plan gives 10,000 neurons/day forever (about 125 per 1024² image with a reference, so ~4 pets/day
  for the whole app) and never bills; requests just fail once the day's allowance is spent.
  Supports up to 4 reference images, so frames are drawn from the base character for consistency.
- **No transparency** from FLUX, so frames are drawn on a pure-green screen and keyed on-device
  (`removeKeyedBackground`), falling back to the on-device ISNet remover when the key looks wrong.
- **Rejected**: OpenAI gpt-image (paid); Gemini image API (no reliable free API tier);
  Pollinations (free tier is text-to-image only, no reference editing); HF Spaces (unreliable queues).
- **Quota**: 4 pets and 90 frames per user per day (`consume_generation_quota`), which also keeps the
  shared Cloudflare allowance from being drained by one person.
