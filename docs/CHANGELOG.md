# Changelog

## Pro Enchant
- Refactor folder structure.
- Separated inline JS from HTML.
- Added reusable bracket engine.
- Added 1 vs 1 Brawl tournament mode.
- Added brawl leaderboard stats.
- Rebuilt mobile-first responsive UI.
- Added toast notification helper.
- Added safer HTML escaping helper.

## Pro v2 - Login Team/User + Safe Tournament Flow
- Login sekarang mencari akun di `teams` dan `users`, bukan team saja.
- Register punya tipe akun: Team atau User/Solo Player.
- Akun user tidak melihat tournament Team 5v5.
- Team 5v5 wajib memilih lineup player ketika daftar.
- Admin bisa menentukan `playerPerTeam` per tournament dan `maxRoster` tiap team.
- Participant menyimpan WhatsApp untuk kontak cepat via Admin Panel.
- Bracket generation melakukan validasi approved payment, slot, duplicate, dan jumlah player sebelum start.
- UI/UX diperhalus dengan wallpaper Clint Soul Vessels, navbar lebih jelas, checkbox lineup, dan bracket visual lebih rapi.


## v4
- Menghapus mode admin `User Solo`.
- Akun user biasa sekarang hanya melihat dan join `1 vs 1 Brawl`.
- Team tetap bisa join `Team 5v5`; 1v1 Brawl bisa memakai salah satu player roster.
- Leaderboard brawl untuk akun user tidak lagi dipaksa masuk ke data team.
