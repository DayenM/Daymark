# Daymark private source and signed updates

**Status:** Approved; implementation in progress
**Date:** 2026-11-13

## Intent

Keep Daymark's source private while allowing friends to receive signed Windows
updates through the app. The user selected the option to publish update
installers and metadata publicly; source code remains in a private repository.

## Current state

- Source is now at `https://github.com/DayenM/Daymark`, private, on `main`.
- The initial push contains the current Daymark 0.1.6 source. Build output,
  local databases, environment files, and signing-key files are ignored.
- Daymark is a Windows-first Tauri v2 app. It already has a persistent
  `today-widget` WebView, a Rust scheduler that blocks on a 60-second wait and
  wake signal, and the native notification plugin. The main workspace is lazy.
- The app has no updater plugin or update signing key today.

## Approaches

1. **Private source, public signed update artifacts — selected.** Put only
   signed installers, signatures, and the updater manifest in a separate public
   repository. Friends need no GitHub account; the source stays private. This
   requires a narrowly scoped release token and updater signing secrets in
   GitHub Actions.
2. **Private source and private releases.** Add every friend as a GitHub
   collaborator and provide a secure authentication flow in the app. This adds
   account management and token handling to a local productivity app.
3. **Private source with manual installer sharing.** Avoid public artifacts and
   credentials, but this does not provide in-app update delivery.

## Proposed architecture

```text
private DayenM/Daymark
    -- push a vX.Y.Z tag --> GitHub Actions (Windows x64)
    -- signed NSIS + .sig + latest.json --> public DayenM/Daymark-Releases

Daymark 0.1.7+
    -- HTTPS latest.json --> verify pinned Tauri updater signature
    -- notify; user chooses Install --> download, install, relaunch
```

- Add the official Tauri updater plugin and its frontend binding. Pin the
  updater public key in `tauri.conf.json`; enable signed updater artifacts.
- The existing `today-widget` performs one check on startup and receives
  another check request from the native scheduler on Tauri's event-loop resume
  signal or after its six-hour wall-clock deadline. Reuse its blocking wait and
  resume wake signal; keep the existing 60-second reminder fallback unchanged.
  That fallback catches up after a long suspend; it is not a guaranteed Windows
  power broadcast. Add no JavaScript polling, recurring timer, WebView, or idle
  animation.
- On a newer signed version, show a Windows notification and an update prompt
  in the panel. The update is downloaded and installed only after the user
  selects **Update now**; the app then relaunches. A repeated check for the same
  version must not repeatedly notify during one app session.
- A release workflow runs on semver tags (`vX.Y.Z`), builds the Windows x64
  NSIS updater bundle, and publishes the bundle, `.sig`, and generated
  `latest.json` to `DayenM/Daymark-Releases`. Updates are version-tag driven;
  pushing ordinary commits does not silently change the installed app.
- Store no credentials in source or in the executable. GitHub Actions needs
  `TAURI_SIGNING_PRIVATE_KEY` and a fine-grained `DAYMARK_RELEASES_TOKEN`
  limited to `Daymark-Releases` with Contents read/write permission.
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is needed only when the private key is
  generated with a password. Keep the private signing key outside the repo;
  commit only the public key.

## First-update limitation

Daymark 0.1.6 was built without an updater. It cannot discover or install an
update on its own. Publish 0.1.7 with the updater enabled, then users must
install that one version manually. Later signed releases can update in-app.

## Files expected to change

- `package.json`, `package-lock.json`: updater/process frontend bindings.
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`: updater plugin.
- `src-tauri/src/lib.rs`, `src-tauri/src/scheduler.rs`: plugin registration and
  throttled update-check wake events, preserving the current scheduler wait.
- `src-tauri/capabilities/default.json`: narrowly scoped updater/process
  permissions.
- `src-tauri/tauri.conf.json`: public endpoint, pinned public key, and signed
  updater artifact setting.
- `src/components/TodayWidget.tsx` and `src/styles.css`: check handling,
  notification/update prompt, install action, and reduced-motion-safe feedback.
- `.github/workflows/release.yml`: tag-triggered Windows build and signed
  publication to the public artifacts repo.
- `README.md`, `docs/performance.md`: release/secrets instructions and
  performance impact.

## Constraints and risks

- Only the installer, update signatures, manifest, and release notes become
  public; application source remains private.
- A public installer can be downloaded and redistributed. The pinned signing
  key prevents accepting an altered unsigned package, but does not make the
  binary private.
- A signing-key loss or rotation requires a manually installed recovery build.
- GitHub Actions cannot publish to a different repository with its default
  `GITHUB_TOKEN`; the owner must add the limited release token as a source-repo
  Actions secret. The signing-key secret is configured; add a passphrase secret
  only if a future key is password-protected.
- Update discovery may wait until the next six-hour check or resume after sleep;
  it must not add idle CPU wakeups beyond the existing scheduler cadence.
- No task data or local workspace database is uploaded by this update flow.

## Acceptance conditions

- `Daymark` stays private; `Daymark-Releases` contains release artifacts only.
- A `vX.Y.Z` tag produces a signed NSIS update, signature, and valid manifest.
- The app reports a newer version, rejects a mismatched signature, lets the
  user defer or install, and restarts into the new version.
- Update checks add no WebView, JavaScript polling, or extra scheduler wakeups;
  the existing reminder scheduler behavior and performance note remain accurate.
- Initial users install 0.1.7 manually; subsequent releases can install in-app.

## Implementation status

- Source repository remains private; the separate public repository currently
  contains only its distribution README and will receive signed release assets
  from the tag workflow.
- Version `0.1.7` contains updater wiring and the signed NSIS build setting.
- The signing key is generated outside this checkout and stored as the private
  repository's `TAURI_SIGNING_PRIVATE_KEY` Actions secret. The public key is
  pinned in `src-tauri/tauri.conf.json`.
- Publishing is pending the owner-created `DAYMARK_RELEASES_TOKEN`; no release
  tag or public installer has been published yet.
- Runtime toast/update/install behavior is not verified on Windows.
