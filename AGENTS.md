# Daymark Performance Guardrails

All future Daymark changes must preserve the low-idle CPU and memory design in [docs/performance.md](docs/performance.md).

- Keep the `today-widget` window as the only WebView created for tray/idle operation. Create the full `main` workspace only when requested and allow it to be destroyed on close.
- Keep the widget bundle separate from `WorkspaceApp`; do not make the widget statically import the full workspace tree.
- Memoize Tauri window wrappers before using them as React effect dependencies; `getCurrentWindow()` constructs a new wrapper, so calling it during render can retrigger effects that update state.
- Do not add unbounded polling, recurring JavaScript timers, or `requestAnimationFrame` loops. Prefer native events and blocking waits; clear every timer and listener on unmount.
- Do not add infinite idle animations. Keep motion user-triggered or short-lived, and preserve the reduced-motion rule.
- Keep glass blur at or below 12px (8px for the collapsed island), avoid stacking native Acrylic with stronger CSS blur, and disable backdrop filters in Neumorphism.
- Keep the reminder scheduler's blocking wait and wake signal. Do not shorten its 60-second fallback interval without a demonstrated reminder-timing requirement.
- Before changing window lifetime, scheduler cadence, render loops, blur, or always-on UI, inspect the whole call path and update the performance note. Do not claim a CPU/RAM improvement without a release-build measurement on the same machine and workload.

