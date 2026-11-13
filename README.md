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

Rilis NSIS:

```powershell
npm run tauri build
```

Installer menanam bootstrapper WebView2 (~1,8 MB). Windows 10/11 umumnya sudah
menyertakan runtime; jika belum tersedia, installer memerlukan internet untuk
mengunduhnya. Artifact NSIS x64 saat ini berukuran 4,58 MiB:
`src-tauri/target/release/bundle/nsis/Daymark_0.1.6_x64-setup.exe`. Mode offline
terlalu besar untuk batas 150 MB.

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
