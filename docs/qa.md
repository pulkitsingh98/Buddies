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

## Phase 3 — Social (needs two machines)

| Check                                                                             | macOS | Windows |
| --------------------------------------------------------------------------------- | ----- | ------- |
| Friends window: sign in, set name, copy friend code                               | ☐     | ☐       |
| Add the other's code → request appears → accept → both see each other online      | ☐     | ☐       |
| Send my pet to visit with a message → it walks in on the other screen within ~2 s | ☐     | ☐       |
| Reply from the visitor's bubble → message arrives at the other's pet              | ☐     | ☐       |
| Nudge and heart arrive at the other's pet with "nudge back" / "send one back"     | ☐     | ☐       |
| Quit the app on one side, send a visit, reopen → it arrives                       | ☐     | ☐       |
| Do Not Disturb holds visits; turning it off delivers them                         | ☐     | ☐       |
| Block: the blocked side's sends silently do nothing                               | ☐     | ☐       |

## Phase 4 — Chores, hang-out, onboarding, updates

| Check                                                                                          | macOS | Windows |
| ---------------------------------------------------------------------------------------------- | ----- | ------- |
| First launch shows onboarding; finishing it opens the pet creator                              | ☐     | ☐       |
| Chores: enable Desktop (macOS asks for access) → Preview lists files by category               | ☐     | ☐       |
| Tidy → files land in "Tidied by <pet>/<date>/…", pet celebrates with Undo                      | ☐     | ☐       |
| Undo → every file is back where it was; empty tidy folders are gone                            | ☐     | ☐       |
| Open files / partial downloads / folders / shortcuts are left alone                            | ☐     | ☐       |
| Quick folder and quick note appear on the Desktop (no overwrite)                               | ☐     | ☐       |
| Hang out (both online): each pet appears next to the other's and they play                     | ☐     | ☐       |
| Mood check-in: follow-up questions work; breathing exercise; friend is told when sharing is on | ☐     | ☐       |
| Launch at login toggle works                                                                   | ☐     | ☐       |
| Older version shows "new version ready" bubble; Update now installs and restarts               | ☐     | ☐       |
