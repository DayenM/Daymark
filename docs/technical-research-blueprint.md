# Technical Research & Planning Blueprint

**Produk:** Local-first Desktop To-do & Notion-Lite Workspace  
**Versi blueprint:** 0.1 · **Tanggal:** 11 November 2026  
**Target awal:** Windows 10/11, satu pengguna lokal, tanpa layanan cloud  
**Status:** Blueprint; source MVP mulai diimplementasikan. Build, benchmark,
runtime, dan QA visual belum diverifikasi.

> Brief menyebut “6 sections”, tetapi mencantumkan tujuh deliverable. Dokumen ini
> mencakup ketujuhnya.

## Keputusan arsitektur

Rekomendasi utama adalah **Tauri v2 + React/TypeScript + Rust + SQLite lokal**.
Tauri v2 memiliki jalur native untuk tray, autostart, hotkey global, notifikasi,
dan efek window. Wails v2 masih menarik untuk Go, tetapi tidak memiliki API
system-tray bawaan; proyeknya sendiri mencatat batasan itu pada issue v2.
Electron menyediakan API desktop yang matang, tetapi membawa Chromium dan Node
ke distribusi sehingga kurang cocok untuk target installer ringkas dan proses
tray yang berjalan lama. Sumber: [Wails v2 issue #4990](https://github.com/wailsapp/wails/issues/4990),
[Tauri tray API](https://v2.tauri.app/reference/javascript/api/namespacetray/),
[Tauri autostart plugin](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/autostart/README.md),
dan [Electron app API](https://www.electronjs.org/docs/latest/api/app/).

Rekomendasi ini bukan klaim angka RAM atau cold-start. Ketiganya harus diukur
pada build rilis di mesin target; hasilnya dipengaruhi versi WebView2, jumlah
window, workload, dan OS. Keunggulan Tauri di sini adalah tidak mengemas browser
Chromium sendiri, sementara UI tetap memakai WebView sistem.

**Keputusan distribusi yang diperbarui:** batas installer maksimal 150 MB.
Build NSIS offline aktual menghasilkan 210,13 MiB karena payload WebView2,
sehingga konfigurasi rilis memakai `embedBootstrapper` (~1,8 MB). Windows
10/11 umumnya sudah menyertakan runtime; jika belum, installer perlu internet
untuk mengunduh WebView2. Mode offline disediakan hanya untuk distribusi yang
mementingkan instalasi tanpa jaringan dan menerima ukuran di atas batas.

## 1. Desktop Runtime & Stack Trade-off Analysis

### Matriks keputusan

| Kriteria | Wails v2 (Go + React/TS) | Tauri v2 (Rust + React/TS) | Electron |
|---|---|---|---|
| Browser di Windows | WebView2 dari sistem | WebView2 dari sistem | Chromium dikemas bersama aplikasi |
| Cold start saat login | Host Go kecil; WebView2 tetap harus dibuat. Tidak ada angka pembanding resmi yang setara. | Host Rust tipis; WebView2 tetap harus dibuat. Potensi start baik, tetapi wajib diukur. | Chromium/Node dan proses renderer harus dimulai; overhead startup umumnya lebih besar secara arsitektural. Ukur pada rilis. |
| RAM idle 24/7 | Ringan di host Go, tetapi proses WebView tetap ada. Wails v2 tidak menghapus biaya renderer. | Host Rust kecil; WebView2 tetap memiliki proses browser/renderer. Kurangi jumlah WebView yang hidup. | Browser runtime terpisah disertakan; cenderung memiliki baseline lebih tinggi. Jangan memakai estimasi angka tanpa benchmark app. |
| Tray | Tidak ada API tray bawaan v2; perlu integrasi pihak ketiga/native sendiri. | API tray resmi `tauri::tray` dan binding JS tersedia. | `Tray` merupakan API inti dan ekosistemnya matang. |
| Autostart | Perlu menulis integrasi registry/OS sendiri atau dependency. | Plugin resmi `tauri-plugin-autostart`; Windows didukung. | `app.setLoginItemSettings()` mendukung Windows dan macOS; Windows memakai konfigurasi login item. |
| Hotkey global | Integrasi eksternal/native. | Plugin resmi `global-shortcut`; kegagalan bentrok shortcut perlu ditangani. | API/ekosistem desktop luas; library hotkey sering menjadi dependency tambahan. |
| Transparan / frameless | Mendukung `Frameless`, WebView transparan, translucency, dan `BackdropType` Mica/Acrylic. BackdropType native perlu Windows 11 build 22621+; fallback BlurBehind pada build lebih lama dapat lambat. | `transparent`, `decorations`, `windowEffects`, Mica/Acrylic tersedia sesuai OS. | `BrowserWindow` mendukung window transparan; desktop backdrop material Windows perlu integrasi platform. |
| Notifikasi | Integrasi OS perlu dipilih sendiri. | Plugin resmi tersedia; pada Windows dokumentasi menyatakan hanya aplikasi terpasang yang mendapat identitas aplikasi normal. | Mature API dan ekosistem notifikasi; lebih banyak runtime yang ikut didistribusikan. |
| Distribusi | Binary Go dapat ringkas; WebView2 tetap dependency runtime. | Binary + asset dapat ringkas; NSIS mendukung WebView2 offline installer. Ukuran akhir belum terukur. | Electron membawa Chromium dan Node; target 150 MB mungkin tercapai lewat kompresi, tetapi harus diukur bersama footprint idle. |
| Biaya tim | Pilihan baik jika Go menjadi keahlian utama; tray native v2 menambah pekerjaan. | Rust menaikkan kurva awal, tetapi API yang dibutuhkan tersedia langsung. | Implementasi UI cepat dan banyak contoh; pemakaian memori/ukuran paket adalah trade-off tetap. |

Wails v2 juga menyediakan opsi `OnSuspend`/`OnResume` native dan window
translucency; kelemahan penentunya untuk lifecycle produk ini adalah tray yang
harus dirakit dari integrasi non-bawaan. Rujukan: [Wails v2 Windows options](https://v2.wails.io/docs/reference/options/)
dan [Wails v2 release notes](https://v2.wails.io/blog/wails-v2-released/).

Tauri v2 mensyaratkan Rust minimal 1.90 pada plugin yang dirujuk di dokumentasi
terkini. Capability/permission plugin harus dinyatakan secara eksplisit. Itu
menambah disiplin konfigurasi, tetapi menjaga akses UI ke API native tetap
terbatas. Lihat [global shortcut](https://v2.tauri.app/plugin/global-shortcut/),
[notifications](https://v2.tauri.app/plugin/notification/), dan
[plugin autostart](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/autostart/README.md).

### Rekomendasi implementasi

- **Shell dan daemon:** Tauri v2, Rust stable yang dipin pada toolchain rilis.
- **UI:** React + TypeScript, satu WebView utama. Tambahkan WebView kedua hanya
  bila floating reminder khusus benar-benar diaktifkan.
- **Database:** SQLite lewat `rusqlite` dengan library SQLite dibundel di binary
  native. Jangan akses DB langsung dari React.
- **Tray, hotkey, autostart, instance tunggal, notifikasi:** plugin/API Tauri
  resmi; integrasi Windows tipis hanya untuk power, clock, dan session-unlock
  event yang belum terwakili abstraksi Tauri.
- **Target distribusi awal:** Windows x64; Windows ARM64 dapat menjadi artifact
  terpisah setelah pipeline x64 stabil.
- **UI appearance:** CSS glass berada di dalam WebView. Mica/Acrylic adalah efek
  native window di bawah WebView; keduanya berbeda dan perlu fallback solid.

Windows WebView2 Evergreen tersedia sebagai runtime bersama pada Windows 11 dan
Windows 10 modern yang memenuhi prasyaratnya; runtime dapat hilang pada image
lama, LTSC, atau perangkat yang dibatasi admin. [Microsoft: WebView2 distribution](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)

## 2. Background Daemon, Auto-Start & Window Lifecycle Architecture

### Lifecycle state machine

```text
OS_LOGIN / MANUAL_LAUNCH / GLOBAL_HOTKEY
    -> SINGLE_INSTANCE_GATE
        -> existing instance: forward args/event, show/focus existing UI, exit new process
        -> first instance:
            -> RESOLVE_USER_DATA_PATH
            -> OPEN_DB_AND_APPLY_MIGRATIONS
            -> REGISTER_TRAY_AND_HOTKEY
            -> RECONCILE_AUTOSTART_PATH
            -> RECONCILE_LOCAL_DATE_AND_RECURRING_TASKS
            -> START_SCHEDULER
            -> DAILY_BRIEFING_PENDING? show MAIN_WINDOW / briefing route
            -> otherwise hide to BACKGROUND_TRAY_MODE

MAIN_WINDOW_VISIBLE <-> BACKGROUND_TRAY_MODE
    close button -> prevent process exit; hide window
    tray Open     -> show + focus
    global hotkey -> show/focus + route to Quick Capture + focus input
    explicit Quit -> stop timer -> checkpoint/close DB -> remove tray -> exit

SUSPEND -> keep persisted due times; do not wake the laptop
RESUME / TIME_CHANGE / TIMEZONE_CHANGE / SESSION_UNLOCK
    -> recompute local date and next due time from wall clock
    -> dispatch eligible missed reminders once per occurrence
    -> show briefing only if local-day policy says it is still pending
```

Gunakan plugin single-instance untuk menyaring peluncuran kedua sebelum DB
dibuka. Peluncuran kedua harus meneruskan argumen (`--quick-capture`, bila ada)
ke instance pertama, lalu keluar. Semua operasi startup dapat gagal: tampilkan
pesan yang jelas, simpan log lokal, dan jangan menghapus/membuat ulang DB yang
gagal dibuka. Daftarkan plugin lebih dulu pada urutan Tauri builder agar
callback instance kedua berjalan sebelum setup window/tray. [Tauri single-instance](https://v2.tauri.app/plugin/single-instance/)

`HKCU\...\Run` berjalan saat pengguna masuk ke sesi Windows, bukan sebelum
login pada fase boot firmware/secure desktop. Windows juga dapat menunda entri
Run untuk mengurangi gangguan login, jadi aplikasi membuka briefing segera
setelah proses dan WebView siap, bukan menjanjikan popup pada milidetik tertentu.
“Wake pertama hari ini” berarti wake/resume atau unlock pertama pada tanggal
lokal baru saat desktop pengguna dapat menerima window; aplikasi tidak
membangunkan PC dan tidak menampilkan UI di secure desktop. Windows mengirim
`PBT_APMRESUMEAUTOMATIC` melalui `WM_POWERBROADCAST`, tetapi event itu sendiri
tidak memastikan pengguna sudah hadir. Tunggu event user-resume/session-unlock
sebelum memunculkan UI. [Microsoft: Run keys](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys),
[PBT_APMRESUMEAUTOMATIC](https://learn.microsoft.com/en-gb/windows/win32/power/pbt-apmresumeautomatic),
dan [system wake-up events](https://learn.microsoft.com/en-us/windows/win32/power/system-wake-up-events).

### Briefing harian dan rollover

1. Tentukan `local_date` dengan timezone Windows pengguna saat ini dan baca
   `daily_briefing_state(local_date)`. `timezone_id` menyimpan konteks saat
   state dibuat, bukan bagian dari key, agar perubahan timezone pada tanggal
   yang sama tidak menampilkan briefing kedua.
2. Query task `open` dengan due date lokal kemarin, task overdue yang lebih
   lama, task hari ini, serta quick notes yang dipin.
3. Tampilkan briefing maksimal sekali per local calendar date. Jika pengguna
   snooze, simpan `snoozed_until`; jadwalkan satu timer untuk waktu tersebut.
   Jika briefing ditutup tanpa acknowledge, kebijakan produk tetap dapat
   menampilkannya saat app dibuka lagi hari itu, tetapi jangan munculkan lagi
   setelah acknowledge.
4. `Move to today` adalah aksi pengguna per task. Update due date dalam transaksi
   dan tambah `rollover_count`; jangan memindah task otomatis saat startup.
   Untuk task terjadwal, pertahankan jam lokalnya. Untuk all-day, ubah tanggal
   lokal. Kasus DST yang tidak valid memakai kebijakan yang sama dengan
   recurrence: gap waktu digeser ke menit valid berikutnya.
5. Hindari pemindahan ganda dengan compare-and-set terhadap `id`, due lama, dan
   `updated_at`. Tampilkan Undo sementara; undo hanya berhasil jika task belum
   diedit lagi sejak rollover.

`Yesterday` dan `Today` adalah tanggal kalender lokal, bukan rentang 24 jam.
Saat timezone atau tanggal sistem berubah, hitung ulang batas hari dan briefing
key; jangan mengubah due time hanya karena aplikasi mulai lagi.

### Scheduler rendah wakeup

- Satu scheduler Rust menetapkan timer ke **reminder valid berikutnya**, bukan
  polling setiap detik. Query berikutnya memakai `MIN(remind_at)` dari task open
  yang belum tercatat untuk occurrence itu.
- Event task berubah, recurrence diubah, snooze dibuat, clock/timezone berubah,
  resume, shutdown, atau timer jatuh tempo membatalkan perhitungan lama dan
  menghitung ulang deadline baru.
- Deadline disimpan sebagai UTC epoch milliseconds; tampilan dan aturan
  recurrence dikonversi dengan timezone lokal. Timer monotonic hanya dipakai
  untuk menunggu; setelah resume/time-change selalu bandingkan kembali ke wall
  clock karena jam dapat melompat dan laptop bisa sleep/hibernate.
- Saat resume, query semua `remind_at <= now` yang belum diklaim. Terapkan
  catch-up satu notifikasi per task occurrence, bukan satu toast untuk setiap
  interval yang terlewat. Task masih terbuka tetap terlihat di briefing meskipun
  OS menahan notifikasi.
- Setiap reminder punya dedupe key stabil dari task + `occurrence_key` + slot
  reminder + channel. DB menyimpan status `pending/requested/failed`. Karena
  transaksi DB dan toast OS tidak atomik, jaminan tepat-sekali tidak mungkin:
  pilih at-least-once dengan dedupe sehingga crash di antara pemanggilan API dan
  update log dapat menimbulkan satu duplikat, bukan reminder hilang diam-diam.
- Quiet hours, Focus Assist, izin notifikasi, shutdown, dan perangkat mati dapat
  menunda atau mencegah toast. Sistem tidak boleh mengklaim “tidak akan pernah
  melewatkan tugas”; klaim yang dapat dijamin adalah task tetap tersimpan dan
  dihitung ulang saat proses hidup kembali.

### Hotkey, tray, dan window

- Gunakan chord awal `Ctrl+Shift+Space` sebagai kandidat, lalu validasi
  ketersediaannya saat register. Jika bentrok, jangan mengganti diam-diam; tampilkan
  error dan sediakan pengaturan untuk memilih chord lain. Hindari `Alt+Space`
  karena itu membuka system menu window Windows.
- Main, briefing, dan quick-capture adalah route/state di **satu WebView** agar
  memory idle tidak berlipat. Hotkey menampilkan window di tengah layar,
  mengganti route ke capture, fokuskan input; Enter menyimpan, Escape
  menyembunyikan tanpa menyimpan.
- Tombol close menyembunyikan window ke tray; menu tray menyediakan Open,
  Quick Capture, Today Focus, Settings, dan Quit. Quit saja yang menghentikan
  scheduler/process.
- Saat app tertutup, perubahan task tidak dapat datang dari UI lain karena MVP
  ini local-only. Namun scheduler tetap bereaksi terhadap Windows power/time
  messages. Gunakan hook pada main HWND atau satu hidden **top-level** native
  window/thread untuk meneruskan resume, time-change, dan session-unlock ke event
  loop Tauri. Tangani `WM_POWERBROADCAST` (`PBT_APMRESUMEAUTOMATIC` dan,
  bila tersedia, `PBT_APMRESUMESUSPEND`), `WM_TIMECHANGE`, dan
  `WM_SETTINGCHANGE` dengan membaca ulang waktu/timezone OS; registrasikan
  window memakai `WTSRegisterSessionNotification` untuk `WM_WTSSESSION_CHANGE`
  / `WTS_SESSION_UNLOCK`. Jangan memakai HWND_MESSAGE untuk event yang dikirim
  sebagai broadcast ke top-level windows. Unregister WTS sebelum HWND dihancurkan.
  Kode bridge hanya ada pada target Windows. [Microsoft: time changes](https://learn.microsoft.com/en-us/windows/win32/sysinfo/wm-timechange),
  [settings changes](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settingchange),
  [session unlock messages](https://learn.microsoft.com/en-us/windows/win32/termserv/wm-wtssession-change).

### Strategi notifikasi hybrid

| Channel | Kekuatan | Batasan | Peran |
|---|---|---|---|
| Native Windows toast | Terintegrasi dengan Notification Center, DND, dan pengaturan OS; ringan | Bisa dinonaktifkan/ditahan; tindakan interaktif desktop terbatas pada plugin Tauri; identitas aplikasi normal memerlukan app terpasang | Default untuk semua reminder |
| Floating reminder card | Tombol Done/Snooze/Open dapat konsisten dengan UI dan theme | Selalu-on-top mengganggu, menambah WebView, dapat mengganggu fullscreen/keyboard; tidak boleh mencuri fokus | Opt-in; satu card singleton, tidak membuat satu window per task |

Plugin Tauri notification mendokumentasikan Windows sebagai dukungan untuk app
terpasang dan menyebut action button tersedia hanya pada mobile. Karena itu,
native toast menjalankan fungsi pemberitahuan; tindakan Done/Snooze ditempatkan
pada optional card atau dilakukan setelah pengguna membuka task. [Tauri notification plugin](https://v2.tauri.app/plugin/notification/).

## 3. Local-First Database Schema & State Sync

### Kontrak penyimpanan

- Satu file `workspace.sqlite3` di direktori app-data OS per pengguna. WAL dan
  shared-memory companion file dibuat SQLite di lokasi yang sama.
- Semua timestamp waktu absolut adalah UTC epoch milliseconds; tanggal all-day
  memakai ISO `YYYY-MM-DD` lokal; timezone workspace adalah IANA ID yang
  dipetakan dari timezone Windows. Recurrence mengulang local wall-time di
  timezone workspace.
- Status task: `open`, `completed`, `cancelled`. Prioritas numerik: `4=urgent`,
  `3=high`, `2=normal`, `1=low`.
- SQLite adalah sumber tunggal setting. Tidak perlu file settings JSON kedua;
  jika kelak dibutuhkan untuk migrasi, letakkan di app-data dinamis yang sama.
- MVP tidak punya remote sync. “Sync” berarti konsistensi antar-window/commands
  dalam proses dan validasi backup/import; bukan sinkronisasi antarperangkat.

### Schema baseline (migration `0001_init.sql`)

```sql
CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_theme TEXT NOT NULL DEFAULT 'glass_light'
    CHECK (active_theme IN ('glass_light', 'glass_dark', 'neumorphic')),
  startup_enabled INTEGER NOT NULL DEFAULT 1 CHECK (startup_enabled IN (0, 1)),
  briefing_on_new_local_day INTEGER NOT NULL DEFAULT 1
    CHECK (briefing_on_new_local_day IN (0, 1)),
  sound_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sound_enabled IN (0, 1)),
  floating_reminders_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (floating_reminders_enabled IN (0, 1)),
  global_shortcut TEXT NOT NULL DEFAULT 'Ctrl+Shift+Space',
  timezone_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  sort_order INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE
    CHECK (length(trim(name)) BETWEEN 1 AND 64),
  created_at INTEGER NOT NULL,
  UNIQUE (name)
) STRICT;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 500),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
  due_at INTEGER,                     -- timed due instant, UTC epoch ms
  due_date TEXT,                       -- all-day local date, YYYY-MM-DD
  due_precision TEXT NOT NULL DEFAULT 'timed'
    CHECK (due_precision IN ('timed', 'all_day')),
  remind_at INTEGER,                   -- UTC epoch ms, NULL means no reminder
  reminder_offset_minutes INTEGER
    CHECK (reminder_offset_minutes IS NULL OR reminder_offset_minutes BETWEEN 0 AND 525600),
  recurrence_rule TEXT,               -- versioned JSON subset, see below
  rollover_count INTEGER NOT NULL DEFAULT 0 CHECK (rollover_count >= 0),
  parent_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (due_precision = 'timed' AND due_date IS NULL) OR
    (due_precision = 'all_day' AND due_at IS NULL AND due_date IS NOT NULL)
  ),
  CHECK (remind_at IS NULL OR due_at IS NOT NULL OR due_date IS NOT NULL),
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL) OR
    (status <> 'completed' AND completed_at IS NULL)
  ),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (recurrence_rule IS NULL OR due_at IS NOT NULL OR due_date IS NOT NULL)
) STRICT;

CREATE TABLE task_occurrences (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  occurrence_key TEXT NOT NULL,        -- T:<UTC-ms> or D:<YYYY-MM-DD>
  occurrence_due_at INTEGER,            -- timed occurrence only
  occurrence_local_date TEXT,           -- all-day occurrence only
  outcome TEXT NOT NULL CHECK (outcome IN ('completed', 'skipped')),
  completed_at INTEGER,
  CHECK (
    (occurrence_due_at IS NOT NULL AND occurrence_local_date IS NULL) OR
    (occurrence_due_at IS NULL AND occurrence_local_date IS NOT NULL)
  ),
  UNIQUE (task_id, occurrence_key)
) STRICT;

CREATE TABLE task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
) STRICT;

CREATE TABLE task_blocks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  block_type TEXT NOT NULL
    CHECK (block_type IN ('paragraph', 'heading', 'bullet', 'checklist')),
  content TEXT NOT NULL DEFAULT '',
  checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 240),
  markdown TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE notification_logs (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  occurrence_key TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('native', 'floating')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'requested', 'failed', 'acted')),
  scheduled_for INTEGER NOT NULL,
  requested_at INTEGER,
  action TEXT,
  error_text TEXT
) STRICT;

CREATE TABLE daily_briefing_state (
  local_date TEXT NOT NULL,            -- YYYY-MM-DD
  timezone_id TEXT NOT NULL,
  presented_at INTEGER,
  acknowledged_at INTEGER,
  snoozed_until INTEGER,
  PRIMARY KEY (local_date)
) STRICT;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_tasks_open_due ON tasks(status, due_at, due_date);
CREATE INDEX idx_tasks_priority_due ON tasks(status, priority DESC, due_at, sort_order);
CREATE INDEX idx_tasks_project ON tasks(project_id, status, due_at);
CREATE INDEX idx_tasks_parent ON tasks(parent_id, sort_order);
CREATE INDEX idx_blocks_task_order ON task_blocks(task_id, sort_order);
CREATE INDEX idx_task_occurrences_task_due ON task_occurrences(task_id, occurrence_due_at DESC);
CREATE INDEX idx_task_occurrences_task_date ON task_occurrences(task_id, occurrence_local_date DESC);
CREATE INDEX idx_notifications_due_state ON notification_logs(state, scheduled_for);
CREATE INDEX idx_notes_pinned_order ON notes(pinned DESC, sort_order, updated_at DESC);
```

SQLite membutuhkan partial indexes hanya bila hasil profiling menunjukkan
benefit; indeks di atas mencukupi untuk workspace lokal kecil. Hindari membuat
indeks tiap kolom tanpa query yang menggunakannya.

### Recurrence, transaksi, dan batas concurrency

- `recurrence_rule` adalah JSON ter-version yang dibatasi ke daily, weekly,
  monthly, dan `interval`; v1 tidak mengklaim implementasi penuh RFC 5545.
  Contoh: `{"v":1,"freq":"weekly","interval":1,"byWeekday":[1,3,5],"localTime":"09:00"}`.
- `reminder_offset_minutes` adalah nilai sumber untuk occurrence berulang;
  `remind_at` adalah waktu UTC occurrence aktif. Untuk timed task, hitung
  `remind_at = due_at - offset`; untuk all-day, `remind_at` adalah instant lokal
  yang dipilih pengguna/settings.
- Monthly day 29–31 yang tidak ada di bulan tujuan dijalankan pada hari terakhir
  bulan itu. Simpan `anchorDay` pada recurrence rule agar Februari yang memakai
  tanggal 28 tidak menggeser jadwal Maret ke tanggal 28. Jika task completion
  terlambat, catat occurrence aktif selesai lalu maju ke slot pertama setelah
  `now`; jangan membuat backlog toast untuk seluruh slot yang terlewat. Waktu
  lokal di DST gap digeser ke waktu valid pertama; waktu ambiguous memilih offset
  lebih awal. Simpan occurrence selesai dan update task dalam satu transaksi
  `BEGIN IMMEDIATE`.
- Semua mutasi melewati satu writer queue/connection. Query boleh memakai
  koneksi read-only terpisah agar WAL mengizinkan reader bersamaan dengan writer.
  Tiap koneksi mengaktifkan `foreign_keys`, `busy_timeout`, dan batas query yang
  sama.
- WAL tetap hanya mengizinkan satu writer pada satu waktu. Serialisasi write di
  proses menghindari race drag/drop, checklist, rollover, dan scheduler. Gunakan
  transaksi pendek; jangan menahan transaksi sambil menunggu toast, file dialog,
  atau input pengguna.
- Pasang `busy_timeout` terbatas (misalnya 3 detik), retry terbatas hanya untuk
  `SQLITE_BUSY/LOCKED`, lalu tampilkan tindakan retry yang jelas. Jangan retry
  mutasi tanpa idempotency key. Satu instance Tauri dan SQLite locking melindungi
  dari peluncuran ganda; WAL bukan multi-writer database.
- Gunakan `synchronous=NORMAL` dengan WAL sebagai default praktis. Jika jaminan
  durability terhadap kehilangan daya lebih tinggi dipilih, ukur biaya
  `FULL`. Jalankan checkpoint passive setelah idle/penutupan terkontrol dan
  pantau WAL yang tumbuh karena reader panjang.
- Jangan simpan DB di OneDrive/network share untuk menulis langsung. WAL memakai
  shared memory dan tidak cocok untuk filesystem jaringan. Lihat
  [SQLite WAL](https://www.sqlite.org/wal.html).

Migrasi berjalan berurutan dalam transaksi dan dicatat hanya di
`schema_migrations` (satu sumber versi). Saat migrasi mengubah bentuk data, buat snapshot backup
sebelum migrasi. Bila integrity check gagal, pertahankan file sumber, tampilkan
jalur pemulihan, dan jangan bootstrap DB kosong di atas data lama.

### Security boundary

- React memanggil command Rust bertipe, bukan SQL atau arbitrary filesystem/shell
  access. Tauri capabilities hanya mengizinkan plugin/window API yang dipakai;
  jangan aktifkan shell plugin untuk kebutuhan tray/autostart.
- File import dipilih lewat dialog OS. Validasi ukuran, jumlah record, panjang
  teks, parent graph, enum, tanggal, dan encoding sebelum transaksi. Markdown
  menonaktifkan raw HTML dan tidak memuat remote image/script secara otomatis;
  tautan eksternal dibuka hanya setelah aksi pengguna.
- Default Content Security Policy hanya mengizinkan asset lokal dan sumber UI
  yang dibutuhkan. Tidak ada endpoint server atau koneksi sync pada MVP.
- DB berada di folder app-data pengguna dan mewarisi ACL akun Windows. Ini
  melindungi dari akun OS lain secara default, tetapi bukan enkripsi at-rest
  terhadap malware yang berjalan sebagai pengguna, administrator, atau backup
  yang diekspor. Karena belum ada threat model untuk rahasia tinggi, jangan
  menambah SQLCipher/DPAPI tanpa keputusan produk tentang recovery dan ekspor.
- Template/backup dapat memuat catatan pribadi. Gunakan native Save/Open dialog,
  jelaskan isi/tujuan sebelum ekspor atau restore, dan jangan menulis file ke
  direktori sementara yang dapat dibaca lintas akun.

### Backup dan import

- **Template JSON untuk berbagi:** versioned envelope berisi project, task,
  tag, task blocks, dan notes yang dipilih; tidak memuat notification log,
  preference pribadi, atau path lokal. Saat import template, buat ID baru dan
  remap relasi sehingga tidak menimpa data teman.
- **Backup penuh:** snapshot SQLite melalui SQLite Online Backup API atau
  `VACUUM INTO`, bukan menyalin `workspace.sqlite3` saja saat WAL aktif. File
  backup mempertahankan ID, settings, dan riwayat.
- Import selalu ke file staging. Validasi versi, batas ukuran dan panjang
  string, enum, relasi, `PRAGMA integrity_check`, `foreign_key_check`, dan
  migrasi. Tampilkan ringkasan isi dan tujuan sebelum mengganti/merge. Untuk
  restore penuh, tutup koneksi aktif, simpan backup sebelum restore, lalu tukar
  file secara atomik pada filesystem yang sama. Jangan pernah menggabungkan file
  SQLite yang tidak dipercaya dengan `ATTACH` lalu menjalankan trigger.
- [SQLite Online Backup API](https://sqlite.org/backup.html) mendukung snapshot
  konsisten dari DB hidup; jangan menyalin file `.db` bersama WAL/SHM secara
  manual.

## 4. Complete Mathematical CSS Token & Theme Engine Specification

### Palette dan kontras

Semua warna yang membentuk sistem visual berasal dari empat swatch master.
Nilai OKLCH berikut adalah konversi sRGB D65, dibulatkan empat desimal untuk L/C
dan dua desimal untuk hue:

| Token | Hex | OKLCH | Penggunaan |
|---|---|---|---|
| Plum | `#534859` | `oklch(0.4191 0.0311 313.70)` | Teks utama, outline, dark glass, sumber bayangan |
| Cream | `#FBF0E8` | `oklch(0.9616 0.0160 58.64)` | Kanvas tactile, teks pada dark glass, highlight maksimum |
| Blush | `#FBD0D0` | `oklch(0.8944 0.0486 18.10)` | Permukaan kedua, tag/chip, latar checklist terpilih |
| Coral | `#F9688D` | `oklch(0.7067 0.1795 7.07)` | Indikator urgent, titik aktif, garis fokus non-teks |

Rasio kontras WCAG dihitung dari relative luminance sRGB. Untuk tiap kanal sRGB
`c` yang telah dinormalisasi ke `[0,1]`, linearize dengan
`c/12.92` jika `c <= 0.04045`, selain itu `((c+0.055)/1.055)^2.4`;
`L = 0.2126R + 0.7152G + 0.0722B`, dan rasio
`(L_lighter + 0.05) / (L_darker + 0.05)`.

| Pasangan | Rasio | Keputusan |
|---|---:|---|
| Plum / Cream | 7.68:1 | Lulus AA normal dan AAA normal |
| Plum / Blush | 6.16:1 | Lulus AA normal |
| Coral / Cream | 2.53:1 | Gagal untuk teks; jangan pakai coral sebagai warna teks |
| Coral / Plum | 3.03:1 | Gagal teks normal; cukup untuk banyak indikator non-teks bila state tidak hanya warna |
| Cream / Blush | 1.25:1 | Bukan pasangan teks yang aman |

Karena glass memakai alpha di atas desktop/Mica yang berubah-ubah, kontras
tidak dapat dijamin dari hex foreground saja. Taruh teks pada content plate
opacity minimal 0.94 dan ukur hasil komposit paling gelap/terang saat QA visual.
Jangan menaruh label kecil langsung di atas mesh gradient. Coral selalu dipadukan
dengan label Plum/Cream pada latar yang lulus kontras, bentuk/outline, atau ikon
tambahan.

### Token dasar dan tema glass

```css
:root {
  color-scheme: light;
  --plum: #534859;
  --cream: #FBF0E8;
  --blush: #FBD0D0;
  --coral: #F9688D;
  --plum-rgb: 83 72 89;
  --cream-rgb: 251 240 232;
  --blush-rgb: 251 208 208;
  --coral-rgb: 249 104 141;

  /* Safe startup fallback until the persisted theme is loaded. */
  --window-base: var(--cream);
  --text-primary: var(--plum);
  --text-secondary: var(--plum);
  --surface-glass: rgba(251, 240, 232, 0.72);
  --surface-content: rgba(251, 240, 232, 0.96);
  --surface-secondary: rgba(251, 208, 208, 0.88);
  --line: rgba(83, 72, 89, 0.24);
  --ambient-mesh:
    radial-gradient(42rem 34rem at 12% 6%, rgba(249, 104, 141, 0.22), transparent 72%),
    radial-gradient(38rem 30rem at 94% 18%, rgba(251, 208, 208, 0.46), transparent 70%),
    radial-gradient(42rem 34rem at 68% 100%, rgba(83, 72, 89, 0.15), transparent 74%),
    var(--cream);
  --shadow-floating: 0 20px 56px rgba(83, 72, 89, 0.24),
                     0 1px 0 rgba(251, 240, 232, 0.88) inset;

  --font-ui: "Segoe UI Variable", "Segoe UI", sans-serif;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --radius-control: 10px;
  --radius-card: 18px;
  --radius-window: 24px;
  --focus-outline: 0 0 0 2px var(--cream), 0 0 0 4px var(--plum);

  --glass-blur: 24px;
  --glass-saturation: 145%;
  --specular-edge: linear-gradient(
    135deg,
    rgba(251, 240, 232, 0.92) 0%,
    rgba(251, 240, 232, 0.46) 24%,
    rgba(251, 208, 208, 0.22) 58%,
    rgba(83, 72, 89, 0.28) 100%
  );
}

[data-theme="glassmorphism"][data-glass-variant="light"] {
  color-scheme: light;
  --window-base: var(--cream);
  --text-primary: var(--plum);
  --text-secondary: var(--plum);
  --surface-glass: rgba(251, 240, 232, 0.72);
  --surface-content: rgba(251, 240, 232, 0.96);
  --surface-secondary: rgba(251, 208, 208, 0.88);
  --line: rgba(83, 72, 89, 0.24);
  --ambient-mesh:
    radial-gradient(42rem 34rem at 12% 6%, rgba(249, 104, 141, 0.22), transparent 72%),
    radial-gradient(38rem 30rem at 94% 18%, rgba(251, 208, 208, 0.46), transparent 70%),
    radial-gradient(42rem 34rem at 68% 100%, rgba(83, 72, 89, 0.15), transparent 74%),
    var(--cream);
  --shadow-floating: 0 20px 56px rgba(83, 72, 89, 0.24),
                     0 1px 0 rgba(251, 240, 232, 0.88) inset;
}

[data-theme="glassmorphism"][data-glass-variant="dark"] {
  color-scheme: dark;
  --window-base: var(--plum);
  --text-primary: var(--cream);
  --text-secondary: var(--blush);
  --surface-glass: rgba(83, 72, 89, 0.76);
  --surface-content: rgba(83, 72, 89, 0.96);
  --surface-secondary: rgba(83, 72, 89, 0.88);
  --line: rgba(251, 240, 232, 0.30);
  --ambient-mesh:
    radial-gradient(40rem 34rem at 12% 10%, rgba(249, 104, 141, 0.25), transparent 70%),
    radial-gradient(42rem 32rem at 94% 22%, rgba(251, 208, 208, 0.18), transparent 74%),
    radial-gradient(44rem 34rem at 56% 100%, rgba(83, 72, 89, 0.88), transparent 72%),
    var(--plum);
  --shadow-floating: 0 22px 64px rgba(83, 72, 89, 0.58),
                     0 1px 0 rgba(251, 240, 232, 0.22) inset;
}

.app-canvas {
  color: var(--text-primary);
  background: var(--ambient-mesh);
  font-family: var(--font-ui);
}

.glass-panel {
  color: var(--text-primary);
  border: 1px solid transparent;
  border-radius: var(--radius-card);
  background:
    linear-gradient(var(--surface-content), var(--surface-content)) padding-box,
    var(--specular-edge) border-box;
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation));
  box-shadow: var(--shadow-floating);
}

@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass-panel { background: var(--surface-content); }
}
```

Persisted enum-to-DOM mapping: `glass_light` →
`data-theme="glassmorphism" data-glass-variant="light"`;
`glass_dark` → `data-theme="glassmorphism" data-glass-variant="dark"`;
`neumorphic` → `data-theme="neumorphism"`. The DB enum stays stable if CSS
selector naming changes later.

`border-image` setara untuk panel tanpa radius:

```css
.specular-square-edge {
  border: 1px solid transparent;
  border-image: linear-gradient(
    135deg,
    rgba(251, 240, 232, 0.92),
    rgba(251, 208, 208, 0.22) 58%,
    rgba(83, 72, 89, 0.28)
  ) 1;
}
```

Untuk panel ber-radius gunakan dua `background` layer seperti `.glass-panel`;
`border-image` tidak memberi clipping radius yang konsisten.

### Neumorphism: turunan warna dan lighting

Pencampuran shadow memakai **OKLCH shorter-hue interpolation**:

```css
--neu-shadow-opaque: color-mix(in oklch, #FBF0E8 70%, #534859 30%);
/* Hasil sRGB 8-bit kira-kira #CAB9B6; OKLCH(0.7988 0.0205 27.16). */
--neu-shadow: color-mix(in oklch, var(--neu-shadow-opaque) 28%, transparent);
```

Perhitungannya memakai `L = .70×.961566 + .30×.419090 = .798823`,
`C = .70×.016002 + .30×.031077 = .020524`, dan shortest hue path
`58.64° → 313.70°` (selisih `-104.94°`) pada proporsi 30%, menghasilkan
`h=27.16°`. Konversi OKLCH ke sRGB lalu pembulatan 8-bit menghasilkan
`#CAB9B6`. CSS `color-mix()` tetap menjadi sumber nilai agar browser tidak
bergantung pada pembulatan hex antara.

Sumber highlight tidak dapat dibuat lebih terang dari cream hanya dengan
mencampur cream dan plum: campuran dua warna tidak dapat melampaui lightness
maksimum sumber cream `L=0.9616`. Karena itu highlight keras menggunakan cream
itu sendiri; pada kontrol dengan permukaan blush, cream sudah lebih terang dari
permukaannya. Ini batas matematis palet, bukan nilai warna yang disamarkan.

Geometri memakai satu sumber cahaya virtual dari kiri-atas. Vektor unit layar
`L = (-1/√2, -1/√2)` memberi offset highlight `(-d, -d)` dan bayangan kebalikan
`(+d, +d)`. Level raised standar memakai `d=8px`, blur `20px`, spread `0`; hover
memakai `d=10px`, blur `24px`; modal memakai kira-kira `2d` dan blur `34–40px`.
Saat ditekan, offset menjadi inset dan sisi gelap/terang bertukar orientasi.
Nilai adalah logical CSS px sehingga ukuran fisik mengikuti DPI Windows, bukan
janji luminansi fisik monitor.

```css
[data-theme="neumorphism"] {
  color-scheme: light;
  --window-base: var(--cream);
  --ambient-mesh: var(--cream);
  --surface: var(--cream);
  --surface-secondary: var(--blush);
  --text-primary: var(--plum);
  --text-secondary: var(--plum);
  --accent: var(--coral);
  --neu-highlight: rgba(251, 240, 232, 0.98);
  --neu-shadow-opaque: color-mix(in oklch, #FBF0E8 70%, #534859 30%);
  --neu-shadow: color-mix(in oklch, var(--neu-shadow-opaque) 28%, transparent);
  --neu-raised:
    -8px -8px 20px var(--neu-highlight),
     8px  8px 20px var(--neu-shadow);
  --neu-raised-hover:
    -10px -10px 24px var(--neu-highlight),
     10px  10px 24px var(--neu-shadow);
  --neu-pressed:
    inset 4px 4px 10px var(--neu-shadow),
    inset -4px -4px 10px var(--neu-highlight);
  --neu-modal:
    -16px -16px 34px rgba(251, 240, 232, 0.98),
     18px  18px 40px color-mix(in oklch, var(--neu-shadow-opaque) 34%, transparent);
}

.neu-card { background: var(--surface); box-shadow: var(--neu-raised); }
.neu-card:hover { box-shadow: var(--neu-raised-hover); }
.neu-card:active,
.neu-check[aria-pressed="true"] { box-shadow: var(--neu-pressed); }
.neu-modal { background: var(--surface); box-shadow: var(--neu-modal); }
```

`--neu-shadow-opaque` adalah hasil campuran matematis palet; alpha membuatnya
menjadi bayangan lembut. Jangan membuat teks abu-abu menggunakan bayangan atau
opacity: teks utama tetap Plum pada Cream/Blush. Coral tidak boleh menjadi teks
di atas Cream atau Plum; gunakan coral sebagai strip/dot, dengan label Plum dan
outline yang terlihat. Checkbox tertekan memakai state selain warna (check glyph,
outline, dan `aria-pressed`) agar state tetap terbaca oleh pengguna.

### Tailwind CSS v4 token extension

Tailwind v4 memakai konfigurasi CSS-first `@theme`, jadi tidak perlu menambah
`tailwind.config.js` untuk warna. Ikat utility ke custom properties agar theme
switch tidak menggandakan palette:

```css
@import "tailwindcss";

@theme inline {
  --color-plum: var(--plum);
  --color-cream: var(--cream);
  --color-blush: var(--blush);
  --color-coral: var(--coral);
  --font-sans: var(--font-ui);
  --shadow-glass: var(--shadow-floating);
  --shadow-neu-raised: var(--neu-raised);
  --shadow-neu-pressed: var(--neu-pressed);
}
```

Contoh utility: `bg-cream text-plum`, `bg-blush`, `border-coral`,
`shadow-neu-raised`. Simpan efek blur, layered border, dan state pressed sebagai
kelas CSS semantik; jangan memaksakan semua lighting ke utility panjang.
Dokumentasi [Tailwind theme variables](https://tailwindcss.com/docs/theme)
dan [colors](https://tailwindcss.com/docs/colors) menunjukkan `@theme` dan
`@theme inline` untuk token yang mengacu ke CSS variable. Jika implementasi
memilih Tailwind v3, baru gunakan `theme.extend.colors` pada `tailwind.config.ts`;
jangan mencampur dua sistem konfigurasi.

### Native transparency dan fallback

Tauri window memakai `transparent: true`, `decorations: false` bila custom
titlebar diperlukan, dan `noRedirectionBitmap: true` untuk menghindari white
flash pada sebagian window transparan Windows. Efek native `mica`/`micaLight`/
`micaDark` tersedia pada Windows 11; `acrylic` tersedia di Windows 10/11 dan
`blur` punya batas versi/performa. Dokumentasi Tauri memperingatkan Acrylic/Blur
dapat berdampak pada resize/drag di build Windows tertentu. CSS
`backdrop-filter` hanya memburamkan konten yang berada di belakang elemen dalam
compositing WebView; ia **tidak** mengambil pixel window aplikasi lain di
desktop. Mica/Acrylic yang dipasang OS adalah lapisan berbeda. Lihat
[Tauri window configuration/effects](https://v2.tauri.app/reference/config/).

Urutan fallback:

1. Windows 11: Mica sesuai varian light/dark bila komposisi window tersedia.
2. Windows 10 atau efek native gagal: acrylic/blur hanya jika dukungan dan
   performanya lolos; kalau tidak, panel Cream/Plum opacity tinggi.
3. WebView tanpa `backdrop-filter`: gunakan `--surface-content` solid dan
   specular edge; kontras/struktur tetap utuh tanpa blur.

## 5. UI/UX Wireframe & Component Hierarchy

### A. Startup Briefing Window

Tujuan tiga detik: pengguna melihat hari/tanggal, jumlah overdue, prioritas
tertinggi berikutnya, dan satu tindakan yang perlu dikerjakan. Jangan mulai dengan
grafik atau angka dekoratif.

```text
┌──────────────────────────────────────────────────────────────────┐
│ Selasa, 11 Nov                         Search / theme / close      │
│ Hari ini · 4 tugas terbuka · 1 overdue                             │
├──────────────────────────────────────────────────────────────────┤
│ BELUM SELESAI                                                     │
│ [! Urgent] Kirim revisi     kemarin 16.00     [Pindahkan ke hari ini]│
│ 1 tugas lain dari kemarin                              [Undo]      │
├──────────────────────────────────────────────────────────────────┤
│ FOKUS HARI INI                         PINNED NOTES                │
│ 09.00  ● Siapkan dataset                • Tujuan sprint            │
│ 11.30    Review PR                      • Catatan ide               │
│ 14.00    Kirim dokumen                  [+ Quick note]              │
├──────────────────────────────────────────────────────────────────┤
│ [Buka Today Focus]                 [Quick Capture  Ctrl+Shift+Space]│
└──────────────────────────────────────────────────────────────────┘
```

Urutan scan: headline tanggal + ringkasan → overdue → task hari ini berdasarkan
priority lalu jam → pinned note. Overdue paling urgent diberi accent stripe
coral plus label plum; teks tidak memakai coral. Rollover memiliki aksi per task,
mempertahankan jam yang sama, dan toast Undo singkat.

Component hierarchy:

```text
AppShell
└─ MainWindow
   ├─ WindowChrome
   ├─ DailyBriefingView
   │  ├─ BriefingHeader
   │  ├─ OverdueTaskGroup
   │  │  └─ OverdueTaskRow -> RolloverAction
   │  ├─ TodaySchedule
   │  │  └─ BriefingTaskRow
   │  ├─ PinnedNotes
   │  └─ BriefingActions
   └─ ToastRegion (Undo, saved, scheduler status)
```

### B. Main Notion-Lite Workspace

```text
┌───────────────┬────────────────────────────┬────────────────────────┐
│ Sidebar       │ Today Focus                │ Task / Block editor    │
│               │                            │                        │
│ Morning       │ Selasa, 11 Nov              │ Kirim revisi           │
│ Today         │ [ + Add a task ]            │ Priority · Due · Tags  │
│ Upcoming      │ 09.00  Dataset     [ ]       │ Checklist              │
│ Projects      │ 11.30  Review PR  [ ]        │ [ ] Paragraf context   │
│               │ 14.00  Dokumen    [ ]        │ [ ] Markdown blocks    │
│ Project list  │                            │                        │
│               │                            │ [Save / close details] │
│ Theme switch  │                            │                        │
└───────────────┴────────────────────────────┴────────────────────────┘
```

- Sidebar navigasi tetap: Morning Briefing, Today Focus, Upcoming, All Projects;
  project list di bawah. Collapse menjadi icon rail pada window sempit.
- Main pane memakai satu list/timeline yang dapat diurutkan. Task selesai tidak
  hilang tanpa transisi; tampilkan completed section yang dapat diciutkan.
- Detail pane inline: title, priority, due date/time, reminder, project/tags,
  checklist subtask, dan `task_blocks` sederhana. Autosave per perubahan dengan
  debounce singkat, tetapi flush saat hide/quit; jika save gagal, pertahankan
  draft dan tampilkan retry.
- Keyboard focus ring terlihat, semua kontrol dapat dicapai keyboard, ukuran
  target klik memadai, `prefers-reduced-motion` menghentikan transisi non-esensial.
- Theme switcher memilih `glass_light`, `glass_dark`, atau `neumorphic`; theme
  disimpan di app_settings dan diterapkan tanpa reload window.

Component hierarchy:

```text
WorkspaceView
├─ Sidebar
│  ├─ ViewNavigation
│  ├─ ProjectList
│  └─ ThemeSwitcher
├─ ViewHeader
├─ TaskComposer
├─ TaskList / UpcomingTimeline / ProjectTaskList
│  └─ TaskRow -> PriorityMarker, DueLabel, ChecklistProgress, TagList
└─ TaskDetailPane
   ├─ TaskProperties
   ├─ SubtaskChecklist
   └─ BlockEditor (paragraph, heading, bullet, checklist)
```

### C. Quick Capture dan Reminder Toast

```text
Quick Capture (centered, compact)      Reminder card (bottom-right)
┌──────────────────────────────┐       ┌─────────────────────────────┐
│ Tambah tugas…                │       │ Waktunya: Review PR         │
│ project · priority · due     │       │ Terjadwal 11.30              │
│ Enter simpan · Esc tutup     │       │ [Snooze] [Selesai] [Buka]    │
└──────────────────────────────┘       └─────────────────────────────┘
```

Quick Capture punya satu field utama; project/priority/due adalah affordance
sekunder agar entry default hanya satu tindakan. Setelah simpan, form reset dan
tetap terbuka bila user terus mengetik. Escape tidak pernah menyimpan diam-diam.
Floating card opt-in, tidak mencuri fokus, tidak tampil di atas fullscreen,
menghormati quiet hours, dan hanya satu instance yang diperbarui untuk task
berikutnya.

## 6. Phased Implementation Roadmap (Epics & Atomic Tasks)

File di bawah adalah target path untuk repo yang saat ini kosong. Acceptance
criteria adalah gerbang implementasi masa depan; tidak ada build atau test yang
dijalankan dalam fase blueprint ini.

### Milestone 1 — Core Daemon, SQLite & Tray Lifecycle

**Files**

```text
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/build.rs
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
src-tauri/src/main.rs
src-tauri/src/app.rs
src-tauri/src/paths.rs
src-tauri/src/lifecycle.rs
src-tauri/src/tray.rs
src-tauri/src/autostart.rs
src-tauri/src/db/mod.rs
src-tauri/src/db/repository.rs
src-tauri/src/db/migrations/0001_init.sql
src-tauri/tests/migrations.rs
src-tauri/tests/single_instance.rs
package.json
package-lock.json
vite.config.ts
tsconfig.json
index.html
src/main.tsx
src/App.tsx
src/views/EmptyWorkspace.tsx
src-tauri/icons-source/app-icon.svg
src-tauri/icons/icon.ico
src-tauri/icons/32x32.png
src-tauri/icons/128x128.png
```

**Atomic tasks:** scaffold Tauri; resolve app-data through Tauri path API; create
DB directory and migration runner; configure WAL/foreign keys/busy timeout;
single-instance forward; tray and hide-on-close; menu Open/Quick Capture/Quit;
autostart registry reconciliation; seed settings; include Windows icon assets.

**Acceptance gates:** second launch never opens a second DB/window; close leaves
tray and process active; explicit Quit closes cleanly; first run creates data
under current user app-data independent of executable folder; failed migration
preserves DB; autostart is per-user and no elevation is requested.

### Milestone 2 — Dual-Theme Design System Engine

**Files**

```text
src/styles/tokens.css
src/styles/themes.css
src/styles/components.css
src/components/ThemeSwitcher.tsx
src/components/FocusRing.tsx
src-tauri/tests/theme_persistence.rs
```

**Atomic tasks:** implement palette/OKLCH tokens; wire Tailwind v4 `@theme
inline`; implement glass light/dark and neumorphic scopes; set CSS solid fallback;
wire persisted theme; build buttons, cards, checkbox, chips, dialog, focus state.

**Acceptance gates:** switching theme changes tokens without reload; color
contrast remains compliant for body labels; Coral is never used as small text;
glass remains legible when blur is disabled; reduced-motion setting works;
pressed and checked controls differ by shape/glyph as well as color.

### Milestone 3 — Startup Briefing & Notification Scheduler

**Files**

```text
src-tauri/src/scheduler.rs
src-tauri/src/notifications.rs
src-tauri/src/windows_events.rs
src-tauri/src/db/briefing.rs
src-tauri/tests/scheduler_catchup.rs
src-tauri/tests/briefing_local_day.rs
src/views/DailyBriefingView.tsx
src/components/OverdueTaskRow.tsx
src/components/ReminderPreferences.tsx
```

**Atomic tasks:** next-deadline scheduler; due-task query and log dedupe; resume,
time-change, timezone-change, and session-unlock message bridge; daily briefing
idempotency/snooze; one-task rollover + undo CAS; native notification permission
flow; optional singleton floating card behind setting.

**Acceptance gates:** idle scheduler has no periodic one-second polling; sleep
and wake delivers one catch-up per occurrence; time change recalculates deadline;
notification denial leaves tasks intact; briefing appears once per local date;
rollover preserves timed wall clock and cannot duplicate under double click.

### Milestone 4 — Notion-Lite Workspace & Quick Capture

**Files**

```text
src-tauri/src/commands.rs
src-tauri/src/db/tasks.rs
src-tauri/src/db/notes.rs
src-tauri/src/db/backup.rs
src/views/WorkspaceView.tsx
src/views/TodayFocusView.tsx
src/views/UpcomingView.tsx
src/views/ProjectsView.tsx
src/components/Sidebar.tsx
src/components/TaskRow.tsx
src/components/TaskDetailPane.tsx
src/components/BlockEditor.tsx
src/components/QuickCapture.tsx
src/components/ImportExportDialog.tsx
src-tauri/tests/import_validation.rs
```

**Atomic tasks:** task CRUD through typed commands; projects/tags/subtasks;
ordered blocks and pinned notes; Today/Upcoming/Projects views; quick capture
route on global hotkey; JSON template import/export; SQLite snapshot backup/restore.

**Acceptance gates:** each view uses the same source of truth; writes survive app
restart; import with malformed fields changes no data; template import remaps
IDs; full restore keeps a recoverable prior snapshot; keyboard-only task creation
and completion work.

### Milestone 5 — Polish, Packaging & Installer

**Files**

```text
src-tauri/tauri.windows.conf.json
src-tauri/windows/nsis/hooks.nsh
.github/workflows/windows-release.yml
README.md
docs/architecture.md
docs/backup-and-restore.md
```

**Atomic tasks:** pin exact crate/npm/toolchain versions; configure x64 release
size optimization; NSIS per-user install in LocalAppData; embed app/tray/icon
resources; enable `embedBootstrapper` or `downloadBootstrapper`; create/remove
startup setting; sign installer when a certificate is available; produce
checksums and release notes.

**Acceptance gates:** install/update/uninstall do not delete user DB; fresh user
with WebView2 installed can launch; missing runtime is bootstrapped online with
clear failure feedback offline; executable path in Run key matches installed
binary; x64 NSIS size is measured and target is <=150 MB; cold-start/RAM are
measured on named Windows hardware and reported as observations, not guarantees.

## 7. Zero-Dependency Distribution & Multi-Machine Portability

### Dynamic paths and first-run bootstrap

Jangan pernah mengambil path dari current working directory atau folder
executable. Resolve `app.path().app_data_dir()` dari bundle identifier
stabil, lalu buat direktori dengan izin user saat ini. Tauri memetakan ini ke
Roaming `%APPDATA%` pada Windows. Setting v1 disimpan di SQLite sehingga tidak
memerlukan config JSON kedua. Jika JSON konfigurasi
ditambahkan kelak, resolve lewat `app_config_dir()` saat runtime, bukan path
hardcode. [Tauri path resolver](https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html)
dan [path API](https://v2.tauri.app/reference/javascript/api/namespacepath/):

```text
Windows: %APPDATA%\<bundle-identifier>\
         workspace.sqlite3, workspace.sqlite3-wal, workspace.sqlite3-shm
         app settings live in SQLite app_settings
macOS:   ~/Library/Application Support/<Product>/
Linux:   $XDG_DATA_HOME/<product>/ (fallback ~/.local/share/<product>/)
```

`%APPDATA%` can be redirected or synchronized by organization policy. In that
case, do not open the same live database concurrently from multiple machines;
WAL sidecar files must stay beside the database. For portable multi-machine
transfer, use explicit JSON export/import rather than synchronizing an open DB.

Startup bootstrap order: resolve directory → create it → verify it is writable
→ open database → apply transactional migrations → seed the single settings row
→ start scheduler. If any step fails, keep source files untouched and show
recovery guidance. Do not silently fall back to the executable folder.

### Self-healing auto-start registration

- Windows registration: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
  under a stable product value name, with a correctly quoted `current_exe` path
  plus `--startup` argument. `HKCU` requires no Administrator rights.
- Configure Tauri autostart with `app_name("localfirst-workspace")` so its Run
  value name matches the uninstaller.
  A small Windows-only registry reconciler compares the stored command with
  `std::env::current_exe()` and rewrites only when the executable path differs;
  this repairs a moved portable app on its next manual launch without resetting
  the Windows Startup Apps enabled/disabled state on every launch. Remove the
  value when startup is disabled or app is uninstalled.
- Default aktif hanya untuk build terpasang; debug/dev build tidak menulis Run
  key. Rekonsiliasi berjalan setelah settings tersedia dan sebelum briefing.
- **Move limitation:** if a user moves a portable `.exe`, the old Run value points
  to the old missing path and cannot execute code at the new path to repair
  itself. Self-healing occurs on the next manual launch from the new location.
  For friend distribution, prefer the per-user NSIS installation under a stable
  LocalAppData path; do not promise automatic repair before the app runs.
- Installer and app share one registry value name. The app must quote paths with
  spaces and preserve flags; never create duplicate Run values on upgrades.
- Windows membatasi data command line Run ke 260 karakter dan dapat menunda
  eksekusi saat login. Gunakan install path pendek/stabil dan jangan menjadikan
  registry ini sebagai jaminan launch-time presisi. [Microsoft: Run and RunOnce](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)
- Startup is a visible preference and can be disabled by the user in Settings
  or Windows Startup Apps. The app should report if Windows has disabled it.

Wails v3 documentation describes stale path detection for its own autostart
manager; that guarantee should not be attributed to Wails v2 or copied as a
promise for an arbitrary moved binary. The chosen Tauri path reconciliation is
explicit app logic. [Wails v3 autostart behavior](https://wails.io/features/autostart/basics/).

### Backup/import UX and portability

- Settings are per-device and excluded from share templates. Template JSON
  includes a schema version, creation time, selected project/tag/task/block data,
  and stable relation keys. It does not include OS paths, notification history,
  or personal device preferences.
- Provide **Export template** (new IDs when imported) and **Backup workspace**
  (full consistent SQLite snapshot). Keep the action names distinct so users
  understand merge/template versus restore/replace semantics.
- Show the chosen filename and record counts before import; write to a sibling
  staging file, validate size and schema, then commit/rename atomically. Preserve
  the existing workspace as a backup before full restore.
- Reject unknown major schema versions, oversized notes/tasks, malformed dates,
  broken parent chains, and duplicate logical tags before any mutation.

### NSIS and WebView2 pipeline

Tauri v2 builds `.exe` setup files with its NSIS bundler. Per-user install is the
default and installs under `%LOCALAPPDATA%`, so no admin privileges are needed.
The installer configuration belongs in `src-tauri/tauri.windows.conf.json` or
the platform section of `tauri.conf.json`. Since auto-start is registered by the
app on first packaged launch, the NSIS uninstaller also removes its one known
Run value; user data remains in AppData and is not removed:

```json
{
  "bundle": {
    "targets": ["nsis"],
    "icon": [
      "icons/icon.ico",
      "icons/32x32.png",
      "icons/128x128.png"
    ],
    "windows": {
      "webviewInstallMode": {
        "type": "embedBootstrapper",
        "silent": true
      },
      "nsis": {
        "displayLanguageSelector": false,
        "installerHooks": "./windows/nsis/hooks.nsh"
      }
    }
  }
}
```

`NSIS_HOOK_PREUNINSTALL` deletes only the app's stable value under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (value name
`localfirst-workspace`). Do not delete the whole `Run` key or the user's AppData.

Use the official Tauri icon generation command to derive Windows `.ico` and
tray-sized PNG assets from a single vector/source master. Embed icons in the
Windows executable resources and include tray PNG bytes in the app bundle; do
not load icons relative to current working directory. Generate assets with:

```powershell
npx tauri icon ./src-tauri/icons-source/app-icon.svg --output ./src-tauri/icons
```

Set the generated `icons/icon.ico` and PNG sizes in `bundle.icon`; load the
32px PNG from a compile-time resource such as
`include_bytes!("../icons/32x32.png")` in `src-tauri/src/tray.rs` (enable Tauri's
`image-png` feature for PNG decoding). This keeps
the tray asset inside the binary and independent of the process working
directory. [Tauri CLI icon command](https://v2.tauri.app/reference/cli/).

WebView2 mode choice:

| Mode | Added installer payload | Internet when runtime is absent | Fits <=150 MB goal? |
|---|---:|---:|---|
| `downloadBootstrapper` | ~0 MB | Yes | Best size; setup downloads the small bootstrapper/runtime when needed |
| `embedBootstrapper` | ~1.8 MB | Yes | Selected; Windows 10/11 commonly have WebView2 |
| `offlineInstaller` | ~127 MB | No | Actual package measured at 210.13 MiB; over target |
| `fixedVersion` | ~180 MB | No | No |

Tauri's Windows installer docs give these approximate size and network tradeoffs;
Microsoft describes its Evergreen bootstrapper as roughly 2 MB and the runtime
as separately installed. Sources: [Tauri Windows installer](https://v2.tauri.app/distribute/windows-installer/)
and [Microsoft WebView2 distribution](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution).

### Ukuran rilis: target, bukan klaim

Build x64 dengan `offlineInstaller` menghasilkan installer NSIS aktual
220.337.207 byte (210,13 MiB), melewati target 150 MB. Konfigurasi beralih ke
`embedBootstrapper`, yang menambah sekitar 1,8 MB dan mengunduh WebView2 hanya
jika runtime tidak ada. Build ulang menghasilkan installer 4.344.208 byte
(4,14 MiB), di bawah target 150 MB.
Gunakan Rust release profile `opt-level="s"`, LTO, satu codegen unit,
minimalkan plugin/asset, dan jangan menyertakan Fixed WebView2 Runtime, source
map, dev server, atau runtime Node. Jangan memakai UPX sebagai jalan pintas
tanpa menilai false positive antivirus dan dampak code signing.

“Zero dependency” yang realistis berarti **tidak memerlukan Go/Node/Rust
terpasang pada komputer pengguna dan tidak membutuhkan server app**, bukan
“tidak memakai runtime OS”. Tauri pada Windows tetap menggunakan WebView2.
Windows 11 dan banyak Windows 10 telah menyertakannya, sementara installer
menangani kasus yang belum memilikinya. Installer kecil tetap memerlukan jaringan
untuk memasang runtime pada mesin yang benar-benar belum memilikinya.

---

## Sumber primer yang dipakai

- [Wails v2 installation and supported Windows versions](https://v2.wails.io/docs/gettingstarted/installation/)
- [Wails v2 system-tray issue](https://github.com/wailsapp/wails/issues/4990)
- [Wails v2 window options](https://v2.wails.io/docs/reference/options/)
- [Wails v2 native translucency announcement](https://v2.wails.io/blog/wails-v2-released/)
- [Tauri v2 tray API](https://v2.tauri.app/reference/javascript/api/namespacetray/)
- [Tauri v2 single-instance plugin](https://v2.tauri.app/plugin/single-instance/)
- [Tauri path resolver](https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html)
- [Tauri autostart plugin](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/autostart/README.md)
- [Tauri global shortcut plugin](https://v2.tauri.app/plugin/global-shortcut/)
- [Tauri notification plugin](https://v2.tauri.app/plugin/notification/)
- [Tauri window effects and transparency configuration](https://v2.tauri.app/reference/config/)
- [Tauri Windows installer and WebView2 modes](https://v2.tauri.app/distribute/windows-installer/)
- [Electron app/login item API](https://www.electronjs.org/docs/latest/api/app/)
- [Electron Tray API](https://www.electronjs.org/docs/latest/api/tray)
- [Microsoft WebView2 distribution](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)
- [Microsoft Run and RunOnce registry keys](https://learn.microsoft.com/en-us/windows/win32/setupapi/run-and-runonce-registry-keys)
- [Microsoft resume-from-sleep event](https://learn.microsoft.com/en-gb/windows/win32/power/pbt-apmresumeautomatic)
- [Microsoft WM_TIMECHANGE](https://learn.microsoft.com/en-us/windows/win32/sysinfo/wm-timechange)
- [Microsoft WM_SETTINGCHANGE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settingchange)
- [Microsoft WM_WTSSESSION_CHANGE](https://learn.microsoft.com/en-us/windows/win32/termserv/wm-wtssession-change)
- [SQLite WAL](https://www.sqlite.org/wal.html)
- [SQLite Online Backup API](https://sqlite.org/backup.html)
- [Tailwind CSS v4 theme variables](https://tailwindcss.com/docs/theme)

## Evidence boundary

Ini adalah rancangan berbasis dokumentasi platform dan framework, bukan bukti
build atau perilaku pada mesin pengguna. Ukuran installer, cold-start, RAM idle,
performa Acrylic, perilaku toast pada Focus Assist, dan recovery setelah sleep
harus diukur pada milestone implementasi di Windows 10/11 target.
