# Daymark CPU and Memory Design

## Findings

The app is a Tauri + React desktop app. On Windows, each Tauri window hosts a WebView2 control. WebView2 uses browser helper processes and its resource use depends on the number of controls and the content loaded; a hidden window is still live content. The app previously created the complete `main` workspace WebView at startup while also creating the always-on `today-widget` window. The full React workspace loaded its task, project, notes, editor, and settings components even though the widget was the visible startup surface.

The Rust reminder worker is not a busy loop: it performs due-reminder and briefing checks, then blocks on `recv_timeout(60s)` or the app-resume signal. There is no `setInterval` or `requestAnimationFrame` loop in the frontend. That scheduler remains unchanged to preserve reminder behavior and near-immediate wake checks.

The UI also had idle looping decorative animations and multiple glass layers with blur values up to 24px. These can increase compositing work while the desktop behind a transparent always-on-top window changes. Native Windows Acrylic is opt-in through the existing app-transparency control.

## Changes in this optimization

- `main` now has `create: false`; the full workspace WebView is built on first request. Closing that window destroys it while the tray process and today widget remain alive.
- The panel calendar is rendered only when selected and groups the existing task snapshot by local date; it adds no background timer, polling, or WebView.
- `open_main_window` stays an async Tauri command: Wry creates the WebView through a blocking event-loop round trip, so running this command synchronously on the IPC thread deadlocks window creation and leaves the invoke pending.
- Opening the full workspace shows and verifies it before the widget plays its collapse transition and hides itself; closing the workspace restores the widget. A failure leaves the panel available and reports the error there. The widget WebView remains resident while hidden, and no additional polling or animation loop is introduced.
- Workspace creation/show/focus errors now return through the command bridge; a failed open restores the widget and displays the error there.
- `src/main.tsx` dynamically imports only the selected window's entry component. The compact widget no longer imports the full `WorkspaceApp` tree.
- Infinite decorative idle animations were removed earlier in this optimization. Remaining animation is transient, hover-triggered, or part of the island interaction.
- Main glass blur is now 12px maximum; titlebar/sidebar and modal sticky surfaces are 10px; the collapsed island is 8px and expanded island is 12px. Neumorphism disables backdrop filters.
- The panel view dropdown is mounted only while opened by the user. Its single popover uses an 8px glass blur and is removed on selection, outside click, Escape, or focus leaving; it adds no polling, recurring timer, or idle animation.
- The scheduler still blocks between checks and wakes on the existing Tauri resume event.
- Update discovery adds no scheduler wakeups or JavaScript timer: the widget checks once on mount, then the existing scheduler requests another check on Tauri's best-effort event-loop resume signal or at a six-hour wall-clock deadline. The scheduler keeps its 60-second blocking reminder wait; that fallback also catches up after a long suspend. Network work is limited to those checks, and downloads begin only after the user selects **Pasang**. Installation can temporarily use CPU, disk, and bandwidth; this change has not been measured on the target laptop, so no CPU/RAM improvement or unchanged peak is claimed.

## Confirmed renderer loop and runtime measurements

The high CPU/RAM growth came from `TodayWidget` creating a fresh Tauri `Window` wrapper on every React render with `getCurrentWindow()`. That wrapper was an effect dependency, and the effect called `refresh()`, which set `snapshot`; this caused a loop of render → new wrapper → effect cleanup/restart → SQLite snapshot fetch → state update. The local data set contained 30 tasks and the SQLite database was 128 KiB, ruling out a large task payload as the cause. `panelWindow` is now memoized by `previewMode`, so the effect runs once per actual window instance.

Measurements were taken on the target Windows laptop using the x64 release executable from `src-tauri/target/release`, with the process tree correlated by parent PID (Daymark host plus all WebView2 descendants). Each run used a 10-second warm-up followed by 12 samples at 5-second intervals. CPU was normalized over 16 logical processors.

| State | CPU average | Private working set | Private bytes | Total working set |
|---|---:|---:|---:|---:|
| Before fix, collapsed island | 22.92% | Not captured | 1,675 MB average; 2,467 MB peak | 1,905 MB average; 2,693 MB peak |
| After fix, collapsed island | 0.00% rounded to 2 decimals | 109.2 MB point sample | 180 MB average; 183 MB peak | 412 MB average; 414 MB peak |
| After fix, expanded Quick Capture | 0.05% perf-counter average; 0.31% peak | 172.5 MB average and peak | 245 MB average and peak | 485 MB average and peak |

The expanded Quick Capture state was triggered through the existing `--quick-capture` single-instance path, not UI automation; the host remained responsive and reported a 400×620 px panel. Task Manager's Processes tab reports private working-set memory, so the comparable Daymark-tree results are about 109 MB collapsed and 173 MB expanded, both below the 400 MB target. Total working set is higher because it also includes shared resident pages across browser processes; the summed total is not the same measure as Task Manager's private-memory column. The CPU target is below 10% in both measured states.

CSV samples are in `%TEMP%` as `daymark-idle-20261112.csv`, `daymark-idle-after-20261112.csv`, and `daymark-expanded-after-20261112.csv`.

## Trade-offs and limits

- The tray island's WebView remains resident by design. Removing it would also remove the always-visible island and quick-capture entry point.
- Closing the full workspace now releases its WebView and transient React state. Data already committed to SQLite remains; an unsubmitted form or unsaved transient editor state may be lost when closing the workspace.
- CSS blur and WebView2 GPU composition vary by Windows build, display driver, scaling, and desktop content. The measurements above apply to this laptop, release build, current display scale, and the two listed widget states; they do not establish a limit for every GPU, system configuration, or full workspace session.
- Reminder delivery has a fallback check interval of up to 60 seconds, and the operating system may delay native toast delivery while asleep or in Do Not Disturb.

## Future change and measurement rules

For any change affecting idle UI, window count, rendering, timers, scheduler, notifications, or transparency:

1. Keep the workspace WebView lazy and the widget's idle path event-driven.
2. Review this file and `AGENTS.md`; do not introduce recurring frontend polling or idle animation without a product requirement and measured justification.
3. Compare release builds on the same Windows machine, power mode, display scaling, theme, task dataset, and window state. Record idle and expanded-widget CPU, process memory (including WebView2 child processes), and fan/power behavior for a consistent observation period.
4. Separate build evidence from runtime performance evidence. A successful build is not proof of reduced CPU/RAM.
5. Update this note with the measurement method and actual before/after values; never invent a numeric budget before a baseline exists.

