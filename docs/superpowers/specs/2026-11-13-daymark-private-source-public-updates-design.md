# Daymark Public Source and Signed Updates

**Status:** Approved and implemented
**Date:** 2026-11-13

## Decision

Publish the existing `DayenM/Daymark` repository and use it for both source and
signed Windows update releases. Do not try to hide tracked files inside the
public repository: GitHub exposes the complete tracked tree and commit history.
The user approved making this existing repository public after the repository
history audit found no tracked database, `.env`, private-key file, or common
credential markers. The updater signing key remains outside Git and in the
GitHub Actions secret store.

## Architecture

```text
public DayenM/Daymark source
    -- push matching vX.Y.Z tag --> GitHub Actions (Windows x64)
    -- signed NSIS + .sig + latest.json --> same public repository release

Daymark 0.1.7+
    -- HTTPS latest.json --> validate the pinned updater public key
    -- notify; user chooses Install --> download, install, relaunch
```

- Tauri updater requires signed artifacts. Only its public key is committed to
  `src-tauri/tauri.conf.json`; the private key is kept at
  `%LOCALAPPDATA%\Daymark\signing\daymark-updater.key` and in the Actions secret
  `TAURI_SIGNING_PRIVATE_KEY`.
- The workflow uses the repository-scoped `GITHUB_TOKEN` with `contents: write`
  to create releases in `Daymark`. No cross-repository PAT is needed.
- A tag must match the version in `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json`. Ordinary branch pushes do not publish binaries.
- The `today-widget` checks at startup, on Tauri's best-effort event-loop resume
  signal, and at the existing six-hour wall-clock deadline. It reuses the
  existing blocking scheduler and its 60-second reminder fallback. This is not
  a guaranteed Windows power broadcast; no new polling, WebView, timer, or idle
  animation is introduced.
- Update installation happens only after the user chooses **Pasang**. A native
  notification and panel prompt announce the available version.
- The task database and user workspace data remain local and are not uploaded.

## First update

Version 0.1.6 predates the updater. Users must manually install the signed
0.1.7 bootstrap once; later versions can update in-app.

## Security and collaboration

- `.gitignore` excludes SQLite databases and journals, local environment files,
  generated builds, and common private-key formats. It cannot hide files already
  committed, and removing a tracked file does not remove it from Git history.
- Public repository source and history can be viewed and forked. Public users
  should submit changes for owner review; only trusted collaborators should get
  write access because they can invoke the signed-release workflow.
- The repository currently has no `LICENSE`. Public visibility alone does not
  give a general open-source license; choose one separately if code reuse is
  intended.
- The previous public `DayenM/Daymark-Releases` repository will not be used for
  new releases. Keep it as an informational stub; do not delete it as part of
  this migration.
- The updater key remains sensitive. If it is lost or exposed, a manually
  installed recovery build and key rotation are required.

## Files and status

- `src-tauri/tauri.conf.json`: endpoint uses `DayenM/Daymark` releases.
- `.github/workflows/release.yml`: tag-triggered signed x64 build publishes to
  the same repo with least-scope `GITHUB_TOKEN` permissions; third-party actions
  are SHA-pinned.
- `.gitignore`: expanded to cover common SQLite journal/sidecar variants.
- `README.md`, `docs/performance.md`: public source/release operation and idle
  impact documentation.
- The signed 0.1.7 installer was built locally (5.37 MiB) with its `.sig`.
  Runtime update/notification behavior has not been verified.
- The migration completed on 2026-11-13. Repo `DayenM/Daymark` is public at
  source commit `e0bcf85`; tag `v0.1.7` is published. GitHub Actions run
  `43428984765` completed successfully and uploaded the signed NSIS installer,
  `.sig`, and `latest.json`.
- The public `DayenM/Daymark-Releases` README points users to the new channel.
- The published manifest serves `0.1.7` and a signed `windows-x86_64-nsis`
  entry. Using the Tauri updater's `User-Agent` and
  `Accept: application/octet-stream` headers, the GitHub asset URL returned
  HTTP 200 with `application/octet-stream`.
- Runtime update discovery and installation were not exercised in the app;
  a successful CI build and asset download do not prove the UI/install flow.
