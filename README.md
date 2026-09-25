# BlogSEO Engine

Web engine untuk membuat dan memposting artikel SEO ke banyak blog/website sekaligus.
Anda cukup mengisi **kata kunci + deskripsi sederhana + gambar + URL situs utama**, lalu engine:

1. Menulis **satu artikel per blog dengan narasi berbeda** (panduan, daftar tips, FAQ, cerita, kesalahan umum, tips memilih, tren, untuk pemula) memakai AI: **Google Gemini** (ada paket gratis), Claude, dan/atau ChatGPT (OpenAI), berbayar. Bisa diisi beberapa API key sekaligus dengan urutan prioritas.
2. Memberi **anchor text yang bervariasi** (brand, generik, partial match, URL, exact match terbatas) untuk link ke situs utama.
3. **Mengecek kemiripan** antar artikel; artikel yang terlalu mirip otomatis ditulis ulang.
4. Menampilkan semua artikel untuk **direview/diedit** sebelum terbit.
5. **Memposting bertahap** (ada jeda antar blog) ke Blogger, WordPress, dan website lain via webhook, dengan retry otomatis jika gagal.

## Menjalankan

Butuh Node.js 20 atau lebih baru.

```bash
npm install
cp .env.example .env    # lalu isi nilainya
npm start               # buka http://localhost:3000
```

### Pengaturan dari dashboard

Penulis AI (Gemini, Claude, ChatGPT; urutan prioritas; mode berurutan/cadangan atau bergantian/campur), API key & model, Client ID/Secret Google untuk Blogger, serta username & password login bisa diatur dari menu **Pengaturan** di dashboard, tanpa mengedit `.env` dan tanpa restart. Nilainya disimpan di `DATA_DIR/settings.json` (izin 0600); password disimpan sebagai hash scrypt. Menu ini juga berisi panduan langkah demi langkah membuat OAuth client Google beserta Redirect URI yang harus didaftarkan.

### Isi `.env` (hanya pengaturan server)

| Variabel | Keterangan |
|---|---|
| `PUBLIC_BASE_URL` | URL publik aplikasi, dipakai untuk callback Google dan URL gambar yang di-upload. |
| `HOST` / `PORT` | Alamat & port yang didengarkan. Isi `HOST=127.0.0.1` di balik reverse proxy. |
| `ADMIN_USER` / `ADMIN_PASSWORD` | Login awal dashboard. Setelah password diganti dari Pengaturan, nilai ini tidak dipakai lagi. |
| `DATA_DIR` | Lokasi database JSON, pengaturan, & gambar upload (default `./data`). |
| `AI_ORDER`, `AI_MODE`, `AI_DISABLED`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Opsional, cadangan jika tidak diisi dari menu Pengaturan. |

### Biaya AI

- **Gemini**: API key dibuat gratis di [Google AI Studio](https://aistudio.google.com/apikey). Paket gratis dibatasi jumlah permintaan per menit & per hari; engine otomatis menunggu dan mencoba ulang saat batas per menit tercapai. Langganan Google AI Pro (aplikasi Gemini) tidak termasuk API. Di paket gratis, Google dapat memakai isi permintaan untuk meningkatkan produknya.
- **Claude**: berbayar per pemakaian lewat [console.anthropic.com](https://console.anthropic.com).
- **ChatGPT (OpenAI)**: berbayar per pemakaian dengan saldo di [platform.openai.com](https://platform.openai.com/api-keys). Langganan ChatGPT Plus tidak termasuk API.

### Beberapa AI sekaligus

Urutan AI diatur di Pengaturan (tombol ↑/↓):

- **Berurutan (cadangan)**: semua artikel ditulis AI nomor 1; jika gagal, otomatis pindah ke nomor 2, lalu 3.
- **Bergantian (campur)**: artikel ke-1 ditulis AI nomor 1, artikel ke-2 AI nomor 2, dst., sehingga gaya tulisan antar blog makin beragam. Cadangan tetap berlaku.

AI yang key-nya salah atau saldo/kuota hariannya habis dilewati untuk sisa kampanye. Jika semua AI gagal, artikel tetap dibuat dengan template dan diberi peringatan.

## Menghubungkan situs tujuan

### Blogger
1. Buka [Google Cloud Console](https://console.cloud.google.com/), buat project, lalu aktifkan **Blogger API v3**.
2. Buat **OAuth client ID** tipe *Web application*. Isi *Authorized redirect URI* dengan `{PUBLIC_BASE_URL}/auth/google/callback`.
3. Isi `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` di `.env`, lalu restart.
4. Di dashboard: **Situs Tujuan → Blogger → Hubungkan akun Google**, lalu pilih blog yang ingin ditambahkan. Satu akun Google bisa punya banyak blog, dan Anda bisa menghubungkan banyak akun.

### WordPress
Di WP Admin: **Users → Profile → Application Passwords**, buat password baru. Masukkan URL situs, username, dan application password di dashboard. Gambar otomatis diunggah ke media library dan dijadikan *featured image*; label dijadikan tag.

### Website lain (webhook)
Untuk CMS buatan sendiri. Engine mengirim `POST` JSON (`title`, `slug`, `html`, `excerpt`, `labels`, `imageUrl`, dll.) dengan tanda tangan HMAC-SHA256 di header `X-BlogSEO-Signature`. Balas dengan `{"url": "..."}`. Contoh penerima PHP: [`examples/webhook-receiver.php`](examples/webhook-receiver.php).

## Soal gambar
- **WordPress**: gambar upload dikirim langsung ke media library.
- **Blogger & webhook** butuh URL gambar publik. Pilihannya: isi kolom *URL gambar*, jalankan server di domain publik (`PUBLIC_BASE_URL`), atau sertakan minimal satu situs WordPress di kampanye. Engine memposting ke WordPress lebih dulu lalu memakai ulang URL gambarnya untuk blog lain.

## Tentang target "peringkat 1 Google"

Tidak ada alat yang bisa menjamin peringkat 1. Engine ini membantu distribusi konten dan backlink, tetapi perlu diketahui:

- Google punya [kebijakan spam](https://developers.google.com/search/docs/essentials/spam-policies) untuk *link scheme* (jaringan blog yang dibuat hanya untuk menaikkan link) dan *scaled content abuse* (konten massal yang tidak bermanfaat). Jika terdeteksi, link diabaikan atau situs bisa terkena penalti manual.
- Karena itu engine dibuat dengan fokus pada kualitas: artikel orisinal per blog, AI dilarang mengarang statistik/testimoni, satu link per artikel, anchor bervariasi, posting bertahap, dan ada tahap review sebelum terbit.
- Rawat blog satelit seperti blog sungguhan: isi juga dengan konten lain yang tidak menautkan situs utama.
- Backlink paling berpengaruh tetap dari situs pihak lain yang relevan: media, direktori bisnis lokal, Google Business Profile, kerja sama, guest post. Pakai `rel="sponsored"` untuk link berbayar.
- Daftarkan situs utama dan semua blog di Google Search Console, lalu kirim sitemap.

## Struktur kode

```
src/
  server.js            API + dashboard (Express)
  queue.js             penjadwalan & worker publikasi
  google.js            OAuth Google untuk Blogger
  db.js                penyimpanan JSON
  generator/
    ai.js              penulisan artikel dengan Claude
    template.js        penulis cadangan tanpa AI
    angles.js          daftar sudut pandang narasi
    anchors.js         variasi anchor text
    similarity.js      pengecekan kemiripan antar artikel
    html.js            sanitasi HTML, sisip link & gambar
  publishers/          blogger.js, wordpress.js, webhook.js
public/                dashboard (HTML/CSS/JS tanpa build)
examples/              contoh penerima webhook
test/                  unit test (npm test)
```

## Pemasangan di shared hosting cPanel (tanpa Passenger)

Pola yang dipakai di `blogseo.semestateknologiutama.com`:

1. Kode di-clone lewat **Git Deploy** ke `~/blogseo-app` (di luar document root).
2. `~/blogseo-app/.env` berisi `HOST=127.0.0.1`, `PORT=3761`, `DATA_DIR=/home/semestat/blogseo-data`, dan kunci-kunci lainnya.
3. [`deploy/blogseo-runner.sh`](deploy/blogseo-runner.sh) disalin ke `~/blogseo-runner.sh` dan dijalankan cron (misalnya tiap 6 menit, dengan `flock -n`). Skrip ini memasang dependensi, menyalakan aplikasi, dan me-restart otomatis setelah deploy baru.
4. [`deploy/htaccess`](deploy/htaccess) disalin sebagai `.htaccess` di document root subdomain, untuk meneruskan semua permintaan ke `127.0.0.1:3761`.

Setelah mengubah `.env`, hapus `~/.blogseo-rev` agar aplikasi di-restart pada putaran cron berikutnya.
