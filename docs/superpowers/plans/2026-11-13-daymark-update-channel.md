# Daymark update channel implementation plan

## Progress

- Done: public artifact repo, updater signing key + private Actions secret,
  pinned public key, Tauri updater APIs, widget update prompt/native toast,
  scheduler resume/six-hour events, release workflow, and operating notes.
- Waiting: add `DAYMARK_RELEASES_TOKEN` to the private source repo Actions
  secrets. It must be a fine-grained token limited to `Daymark-Releases` with
  Contents read/write. Until then, the workflow can build but cannot publish.
- Bootstrap: `0.1.7` is the first updater-enabled build; `0.1.6` users need one
  manual install.
- Verification: the Vite production bundle and signed Windows x64 NSIS release
  build completed. Outputs: `Daymark_0.1.7_x64-setup.exe` (5.37 MiB) and its
  updater `.sig`. The first build attempt hit OS error 112 with only 0.12 GB
  free; a retry completed after free space recovered. No automated tests,
  installer launch, or runtime UI checks were run.
- Publishing: no version tag or public release has been created.

## Scope and files

- `package.json`, `package-lock.json`: official updater and process guest APIs.
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`: Tauri updater plugin.
- `src-tauri/tauri.conf.json`: pinned public key, HTTPS endpoint, signed updater
  artifacts.
- `src-tauri/capabilities/default.json`: only the updater and restart
  permissions needed by the two existing windows.
- `src-tauri/src/lib.rs`: updater plugin registration and update-check event
  wiring.
- `src-tauri/src/scheduler.rs`: request an update check at startup and at a
  six-hour cadence while reusing the existing blocking wait and resume signal.
- `src/components/TodayWidget.tsx`, `src/styles.css`: native notification,
  current-version prompt, defer/install actions, and error feedback.
- `.github/workflows/release.yml`: signed Windows x64 NSIS build and release
  upload to `DayenM/Daymark-Releases` on version tags.
- `README.md`, `docs/performance.md`: signing, release, first-upgrade, and
  performance instructions.

## Tasks

1. **Create the public artifact repository.** Create `DayenM/Daymark-Releases`
   as public with a README stating it contains signed installers and manifests
   only. Keep `DayenM/Daymark` private and verify `main` remains its source
   branch. Result: the public endpoint has a stable owner/repository name but
   contains no source code.
2. **Set up update signing.** Generate a Tauri updater key pair outside the
   workspace, add only the public key to `tauri.conf.json`, ignore private key
   material, and configure signing environment variable names for CI. Result:
   the source can build signed updater artifacts without committing secrets.
3. **Wire the Tauri updater.** Add Rust and JavaScript plugin dependencies,
   register the plugin, enable the minimum capability permissions, and set the
   public endpoint and signature requirements. Result: the app can check and
   install only releases that match the pinned key.
4. **Add update discovery and user controls.** The widget checks once on start
   and receives a native event every six hours and on resume. Deduplicate a
   notification for the same version for the current session. Show a Windows
   toast and a compact panel prompt with **Install now** and **Later**. Install
   only on explicit user action and relaunch after installation. Result: an
   available update is discoverable without JS polling, extra windows, or
   silent installation.
5. **Add the release workflow.** On `vX.Y.Z` tags, build only Windows x64 NSIS,
   sign the updater artifacts, and publish the setup bundle, signature, and
   generated manifest to the public artifact repository. Use the limited
   `DAYMARK_RELEASES_TOKEN` and updater signing secrets; do not broaden the
   workflow's default token permissions. Result: each tagged version creates
   one signed release friends can download without GitHub accounts.
6. **Document release operations and update performance notes.** Explain
   version/tag alignment, the two required Actions secrets and optional key
   password, limited token setup, the manual 0.1.7 bootstrap install, and how
   to make a later release.
   Record that checks add no timers or wakeups and preserve the existing
   60-second reminder fallback. Result: the user can publish future updates
   without re-deriving the process.

## Implementation verification

- Build the Windows release bundle and confirm expected `.exe`, `.sig`, and
  updater manifest outputs exist before publishing.
- Do not run automated tests or open/install the app in this task. Report those
  limits explicitly; do not claim runtime notifications or installation were
  verified.

## External setup limit

The private source repo needs a fine-grained `DAYMARK_RELEASES_TOKEN` with
Contents read/write permission only for `Daymark-Releases`; the updater key is
already configured as an Actions secret. A password secret is needed only if
the key is encrypted. Secret values must never be committed or posted in chat.
