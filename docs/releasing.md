# Merilis Daymark

Rilis Windows x64 dibuat oleh workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) saat tag versi dipush.

## Persiapan

- Samakan versi di `package.json`, `src-tauri/Cargo.toml`, dan `src-tauri/tauri.conf.json`.
- Simpan private signing key sebagai GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`. Jika key dienkripsi, tambahkan `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Jangan commit atau membagikan private key. File lokal pengembangan berada di `%LOCALAPPDATA%\Daymark\signing\daymark-updater.key`.

## Menerbitkan rilis

Commit dan push perubahan ke `main`, lalu buat tag yang sama dengan versi aplikasi. Contoh untuk `0.1.8`:

```powershell
git tag v0.1.8
git push origin v0.1.8
```

Workflow memvalidasi tag, membangun installer NSIS, lalu menerbitkan installer, signature updater, dan `latest.json` ke GitHub Release. Push biasa ke `main` tidak menerbitkan installer.

> Beri akses tulis hanya kepada orang tepercaya. Akses itu dapat menjalankan workflow rilis yang menggunakan signing key.
