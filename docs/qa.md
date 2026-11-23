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

## Phase 1 — Pets

| Check                                                                                      | macOS | Windows |
| ------------------------------------------------------------------------------------------ | ----- | ------- |
| New Pet → Cartoon: sign up, all 18 frames appear, pet lands on desktop                     | ☐     | ☐       |
| New Pet → Photo cutout: model downloads once, cutout looks clean                           | ☐     | ☐       |
| Clicks on empty space around the pet reach the app underneath                              | ☐     | ☐       |
| Click = laugh/hearts, hover = love/blush, 5 fast clicks = grumpy, double-click = celebrate | ☐     | ☐       |
| Drag and drop: pet falls to the floor; shaking it makes it dizzy                           | ☐     | ☐       |
| Faces don't "jump" when switching expressions                                              | ☐     | ☐       |
| Idle 5 min → falls asleep; move mouse → wakes and waves                                    | ☐     | ☐       |
| Pet doesn't appear over a full-screen app                                                  | ☐     | ☐       |

## Phase 2 — Wellbeing

| Check                                                                           | macOS | Windows |
| ------------------------------------------------------------------------------- | ----- | ------- |
| Set water to 10 min → bubble appears; Done counts a glass; Snooze delays 10 min | ☐     | ☐       |
| No reminders during quiet hours or while away                                   | ☐     | ☐       |
| Tray → Start Focus Timer: pet sits, countdown badge, celebrates at the end      | ☐     | ☐       |
| Kind message once per morning; mood check-in once after noon                    | ☐     | ☐       |
| Settings persist across restarts                                                | ☐     | ☐       |
