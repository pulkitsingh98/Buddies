# Manual QA checklist

Run on **both** macOS and Windows for every release. Tick each box per OS.

## Phase 0 — Foundations

| Check                                                                                         | macOS | Windows |
| --------------------------------------------------------------------------------------------- | ----- | ------- |
| Installer from GitHub Release installs (Gatekeeper / SmartScreen bypass per README)           | ☐     | ☐       |
| App launches with tray / menu-bar icon, **no** Dock / taskbar icon                            | ☐     | ☐       |
| Tray menu shows: Show/Hide Pets, Focus Timer, Tidy Desktop, Friends, Settings, Pause 1h, Quit | ☐     | ☐       |
| Settings opens a window; closing it leaves the app running in the tray                        | ☐     | ☐       |
| Launching the app a second time focuses Settings instead of starting a second copy            | ☐     | ☐       |
| Quit exits fully (no process left in Activity Monitor / Task Manager)                         | ☐     | ☐       |
| Idle after launch: CPU ≈ 0%, RAM < 150 MB                                                     | ☐     | ☐       |
| "Check for updates" against an older installed version updates and relaunches                 | ☐     | ☐       |
