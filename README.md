# Icikiwir Esports Pro

Versi hasil enchant dari project tournament esports lama.

## Yang diubah
- Struktur folder profesional.
- HTML dipisah dari JavaScript.
- JavaScript dibuat modular: core service, bracket engine, utils, page controller.
- UI dibuat ulang: clean, modern, responsive mobile dan desktop.
- Tambahan mode tournament baru: **1 vs 1 Brawl**.
- Leaderboard mendukung poin Free, Paid, dan Brawl.
- Bracket single elimination lebih rapi dan reusable.
- Payment approval tetap tersedia untuk tournament paid.

## Struktur
```txt
icikiwir-esports-pro/
├─ index.html
├─ login.html
├─ dashboard.html
├─ admin.html
├─ assets/
│  ├─ css/style.css
│  └─ js/
│     ├─ core/firebase.js
│     ├─ core/utils.js
│     ├─ core/team-service.js
│     ├─ core/bracket.js
│     ├─ pages/login.js
│     ├─ pages/dashboard.js
│     └─ pages/admin.js
├─ database.rules.json
└─ docs/CHANGELOG.md
```

## Cara pakai
1. Upload semua file ke hosting static seperti GitHub Pages, Netlify, Vercel static, atau Firebase Hosting.
2. Pastikan Firebase Auth Email/Password aktif.
3. Pastikan Realtime Database aktif.
4. Sesuaikan `ADMIN_UID` di `assets/js/core/firebase.js` jika akun admin berubah.
5. Terapkan rules Firebase yang aman sebelum public.

## Catatan penting security
Firebase API key memang boleh ada di frontend, tetapi database wajib diamankan dengan Firebase Rules. Jangan gunakan `.read: true` dan `.write: true` untuk production.
