# Daymark public source and update channel migration

## Progress

- Done: updater code, signing key outside the workspace, public key pin, signed
  0.1.7 Windows x64 NSIS installer (5.37 MiB) and `.sig`, update UI/notification,
  six-hour scheduler check, public-source/release documentation.
- Done: `DayenM/Daymark` is public; tag `v0.1.7` points to rewritten commit
  `5b614ad`. GitHub Actions run `43433617910` completed successfully and
  published the signed installer, signature, and updater manifest.
- Done: the six historical commits and release tag now use author/committer
  identity `DayenM <dayengarena@gmail.com>`; the commit tree was preserved.
  The GitHub Contributors graph and stats API show only `DayenM`; the direct
  contributors REST endpoint was still returning cached data during verification.
- Done: the old public `DayenM/Daymark-Releases` README now points to the new
  release channel (notice commit `f81d33f`).
- Anyone with a clone from before the author rewrite must re-clone or reset it
  to the updated public history.
- No `LICENSE` exists. Do not add one without the owner's choice.
- No automated tests, installer launch, or runtime update UI verification have
  been run. A prior build attempt failed on disk space; the later build passed.

## Scope

- `.gitignore`: ignore SQLite sidecars, local config, build output and key files.
- `src-tauri/tauri.conf.json`: updater manifest endpoint points to this repo.
- `.github/workflows/release.yml`: publish signed NSIS and `latest.json` using
  `GITHUB_TOKEN` with only release content write permission; actions SHA-pinned.
- `README.md`, `docs/superpowers/specs/*`, `docs/performance.md`: source
  visibility, collaboration boundaries, release steps, and CPU/RAM behavior.
- GitHub repo `DayenM/Daymark`: make public only after the user approved full
  source/history visibility; release assets and source will share one repo.
- Existing `DayenM/Daymark-Releases`: keep as a notice-only stub; do not delete.

## Operations

1. Keep the signing key private and retain only its GitHub Actions secret plus
   the committed public key.
2. Keep the release workflow tag-triggered. Update all three version fields,
   push source, then push a matching `vX.Y.Z` tag.
3. Do not grant write access to untrusted contributors: they can trigger the
   workflow that holds the signing key. Prefer public pull requests and owner
   review/tagging.
4. Existing 0.1.6 installations require a manual 0.1.7 install before the
   in-app updater can work.

## Verification

- Locally built output: `Daymark_0.1.7_x64-setup.exe` (5.37 MiB) and matching
  updater signature. Build is not a runtime or update-install test.
- Verified public visibility, source commit, and non-draft `v0.1.7` release.
  Assets: `Daymark_0.1.7_x64-setup.exe` (5,674,639 bytes), matching `.sig`
  (436 bytes), and `latest.json` (1,315 bytes).
- Verified `latest.json` serves version `0.1.7` with a signed
  `windows-x86_64-nsis` entry. With the updater's `User-Agent` and
  `Accept: application/octet-stream` headers, its asset endpoint returned HTTP
  200 and `application/octet-stream`.
- No automated tests, installer launch, in-app update/install, notification, or
  sleep/resume behavior was verified. The app uses a best-effort Tauri resume
  event plus the existing blocking scheduler fallback, not a dedicated Windows
  power broadcast.
