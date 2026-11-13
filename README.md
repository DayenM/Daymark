# Daymark

Daymark adalah workspace desktop lokal untuk brief pagi, tugas, project,
catatan, dan pengingat. Aplikasi ditujukan lebih dulu untuk Windows 10/11 x64.

## Menjalankan dari source

Prasyarat development:

- Node.js 20.19+ atau 22.12+
- Rust stable MSVC 1.90+
- Microsoft C++ Build Tools dengan workload **Desktop development with C++**
- WebView2 Runtime

Perintah:

```powershell
npm install
npm run tauri dev
```

Build rilis NSIS:

```powershell
npm run tauri build
```

Installer menanam bootstrapper WebView2 (~1,8 MB). Windows 10/11 umumnya sudah
menyertakan runtime; jika belum tersedia, installer memerlukan internet untuk
mengunduhnya. Distribusi menggunakan installer NSIS x64.

## Perilaku aplikasi

- Startup Windows aktif secara default dan dapat dimatikan dari Pengaturan.
- Menutup jendela menyembunyikan aplikasi ke system tray. Gunakan menu tray
  **Keluar** untuk menghentikan process.
- `Ctrl+Shift+T` membuka Quick Capture dari aplikasi lain.
- Briefing harian muncul saat startup Windows jika belum diakui, dan saat
  tanggal lokal berganti. Opsi tunda 15 menit menyembunyikan jendela sementara.
- Pengingat disimpan bersama tugas dan dikirim sebagai notifikasi native.
- Tema: Glass terang, Glass gelap, dan Neumorphic.
- Backup JSON mengekspor tugas, catatan, tag, project, serta status. Impor
  menambahkan data ke workspace saat ini; impor file sama dua kali membuat
  duplikasi.

## Data lokal

Database dibuat saat first run lewat `app_data_dir()` milik Tauri, yang
menyelesaikan direktori pengguna saat runtime (Windows: `%APPDATA%`), lalu
membuat folder dan skema SQLite secara otomatis. SQLite memakai WAL dan
seluruh operasi native mengalir melalui command Rust. Backup JSON dapat dibuat
dari **Pengaturan → Backup workspace**.

## Batas implementasi awal

Scheduler memeriksa pengingat paling lama setiap 60 detik dan langsung memeriksa
lagi saat event resume diterima. Karena Windows dapat menahan toast saat Focus
Assist/Do Not Disturb atau ketika perangkat tidur, aplikasi tidak dapat menjamin
toast terlihat tepat pada waktunya. Jika pengiriman native gagal, reminder tetap
dicoba kembali.

Notifikasi Windows, perilaku tray, hotkey, backup, dan transisi tema sudah
dibangun, tetapi perilaku interaktif Windows belum diverifikasi dengan
menjalankan installer.

Panduan batasan CPU/RAM dan evaluasi performa ada di [docs/performance.md](docs/performance.md).

## Source dan pembaruan aplikasi

Source Daymark dan rilis installer bertanda tangan berada di repo publik
[DayenM/Daymark](https://github.com/DayenM/Daymark). Setiap rilis berisi source,
installer NSIS, signature, dan `latest.json`; database tugas dan konfigurasi
lokal tidak diunggah. Repo tidak memiliki hide per file: semua file terlacak dan
riwayat commit dapat dilihat publik. `.gitignore` mengecualikan database,
environment lokal, build output, dan private signing key.

Daymark 0.1.7 adalah versi pertama dengan updater. Pengguna 0.1.6 perlu memasang
0.1.7 sekali secara manual; sesudahnya Daymark dapat memberi notifikasi dan
memasang update bertanda tangan setelah pengguna memilih **Pasang**.

### GitHub Actions dan signing

Private signing key disimpan sebagai secret `TAURI_SIGNING_PRIVATE_KEY` di
**Settings → Secrets and variables → Actions**. File lokalnya berada di
`%LOCALAPPDATA%\Daymark\signing\daymark-updater.key`; jangan commit atau bagikan
file itu. Jika key dibuat dengan password, tambahkan secret
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Token lintas-repo tidak diperlukan karena
workflow menerbitkan release ke repo yang sama menggunakan `GITHUB_TOKEN`.

Push tag versi `vX.Y.Z` yang cocok dengan versi di `package.json`,
`src-tauri/Cargo.toml`, dan `src-tauri/tauri.conf.json` untuk membangun dan
menerbitkan NSIS x64, signature, serta updater manifest. Push biasa ke `main`
tidak menerbitkan installer.

Kontributor publik dapat mengusulkan perubahan melalui pull request. Beri akses
write hanya kepada orang tepercaya: akses itu juga dapat menjalankan release
workflow dengan signing key. Pemilik repo sebaiknya meninjau dan menerbitkan tag
rilis sendiri. Repo ini belum memiliki file `LICENSE`; publikasi tidak otomatis
memberi lisensi bebas pakai di luar kemampuan view/fork GitHub.
