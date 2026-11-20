<div align="center">

<img src="src-tauri/icons/icon.png" alt="Daymark" width="88" height="88">

# Daymark

**Plan the day. Keep the focus.**

A local-first desktop workspace for tasks, projects, notes, and a calendar that lives
in a Dynamic Island at the top of your screen.

<br>

[![Latest release](https://img.shields.io/github/v/release/DayenM/Daymark?style=for-the-badge&label=release&labelColor=0A0A0B&color=F5F5F7)](https://github.com/DayenM/Daymark/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/DayenM/Daymark/total?style=for-the-badge&label=downloads&labelColor=0A0A0B&color=F5F5F7)](https://github.com/DayenM/Daymark/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-F5F5F7?style=for-the-badge&labelColor=0A0A0B)](LICENSE)
[![Windows 10 | 11](https://img.shields.io/badge/Windows-10%20%7C%2011-F5F5F7?style=for-the-badge&labelColor=0A0A0B)](https://github.com/DayenM/Daymark/releases/latest)

**[Download for Windows](https://github.com/DayenM/Daymark/releases/latest)**
&nbsp;·&nbsp;
[Features](#features)
&nbsp;·&nbsp;
[Build from source](#build-from-source)
&nbsp;·&nbsp;
[Bahasa Indonesia](README.id.md)

</div>

<br>

## Why Daymark

Most task apps ask you to open a window, find your list, and context-switch before you can even start.
Daymark keeps today one glance away: a small notch at the edge of your screen that opens into
your calendar and to-do list, and folds away when you are done.

Everything you write stays on your machine. There is no account, no sync service, and no telemetry.

## Features

<table>
<tr>
<td width="50%" valign="top">

### Dynamic Island
A notch-style panel that opens into your day. Drag it to the top, left, or right edge of any monitor;
it remembers where you left it. Triple-click to send it back to the centre.

</td>
<td width="50%" valign="top">

### Calendar first
Open Daymark on a full-width month board where every task is readable at a glance, with its time.
Resize the board freely and fold the sidebar away for more room.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Tasks with depth
Priorities, dates, reminders, recurrence, projects, tags, one level of subtasks,
and Markdown notes, all validated in Rust before they reach the database.

</td>
<td width="50%" valign="top">

### Capture anywhere
Press <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Y</kbd> from any app to jot a task without
leaving what you are doing. Reminders arrive as native Windows notifications.

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Seven themes
Glass light and dark in black and white, Neumorphic, plus Sakura Milk, Peach Matcha,
Cherry Cola, and Midnight Ocean. Panel and window transparency are adjustable.

</td>
<td width="50%" valign="top">

### Local and light
SQLite with WAL on your own disk, JSON backup and import, and a single always-on window
at idle. Starts with Windows and updates itself from signed releases.

</td>
</tr>
</table>

## Install

1. Open the [latest release](https://github.com/DayenM/Daymark/releases/latest).
2. Download `Daymark_X.Y.Z_x64-setup.exe` from **Assets**.
3. Run the installer.

You do not need Node.js, Rust, or a terminal. The installer bundles the WebView2 bootstrapper;
if the WebView2 Runtime is missing, an internet connection is needed once to fetch it.

Already installed? Open **Settings → App updates → Check for updates**. Daymark also checks in the background
and installs a new version only after you choose **Install**.

> **On version 0.1.6?** That version has no updater. Install the latest release once manually;
> every update after that happens inside the app.

## Your data

The workspace lives in a local SQLite database in your Windows app-data directory. Checking for updates
never uploads your tasks. Export a JSON backup any time from **Settings → Workspace backup**.

Windows may delay notifications while Do Not Disturb is on or the device sleeps. Daymark re-checks
reminders when it receives a resume signal.

## Built with

| Layer | Technology | Role |
| --- | --- | --- |
| Shell | [Tauri v2](https://tauri.app) | Windows, tray, startup, global hotkey, notifications, updater |
| Interface | React 19, TypeScript, Vite | Island panel and full workspace |
| Native | Rust | Commands, reminder scheduler, validation, data access |
| Storage | SQLite (WAL) via `rusqlite` | Tasks, projects, notes, and settings on-device |
| Runtime | Microsoft WebView2 | Renders the UI without bundling a second browser |

The full workspace window is created on demand and destroyed when closed; only the Island stays resident.
Design notes live in [`docs/performance.md`](docs/performance.md).

## Build from source

> For developers only. Everyone else can use the installer above.

**Prerequisites:** Node.js 20.19+ or 22.12+, Rust stable (MSVC) 1.90+,
Microsoft C++ Build Tools (*Desktop development with C++*), and the WebView2 Runtime.

```powershell
npm install
npm run tauri dev      # development
npm run tauri build    # NSIS x64 installer
```

Releases are produced by GitHub Actions when a `v*` tag is pushed.
See [`docs/releasing.md`](docs/releasing.md).

## Contributing

Issues and pull requests are welcome. For anything larger than a small fix, please open an issue first
so we can agree on the direction.

## License

Released under the [MIT License](LICENSE). Bundled fonts keep their own
[SIL OFL licenses](public/licenses).

<div align="center">
<br>
<sub>Built by <a href="https://github.com/DayenM">DayenM</a></sub>
</div>
