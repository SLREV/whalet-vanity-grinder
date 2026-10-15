# Kebijakan Privasi VanitySol

**Terakhir diperbarui: 15 Oktober 2026**

VanitySol membuat pasangan kunci Ed25519 untuk alamat Solana. Kebijakan ini menjelaskan data yang diproses aplikasi Android dan versi web/PWA.

## Data yang dikumpulkan

Kami **tidak mengumpulkan, menyimpan di server, menjual, atau membagikan** data pribadi. Aplikasi tidak menggunakan akun, iklan, analytics, pelacak, atau SDK pelaporan crash. Pencarian, pengukuran kecepatan, dan pembuatan private key dilakukan di perangkat.

APK native tidak meminta izin `INTERNET` dan tidak membuat koneksi jaringan. Versi web/PWA harus mengunduh file aplikasi statis saat kunjungan pertama; service worker menyimpan aset dari origin yang sama agar aplikasi dapat dibuka kembali tanpa koneksi. Prefix, hasil pencarian, seed, dan private key tidak dikirim ke server.

## Private key dan file hasil

Hasil pencarian hanya berada di memori selama aplikasi berjalan dan tidak disimpan otomatis. Jika pengguna memilih **Simpan**, aplikasi menulis file JSON berisi 64 angka ke folder `Documents/vanity-keys` di perangkat. 32 angka pertama adalah secret key; siapa pun yang mendapatkan file tersebut dapat mengendalikan aset terkait. Pengguna bertanggung jawab menjaga, mencadangkan, dan menghapus file itu.

Tombol **Bagikan** di aplikasi hanya membagikan alamat publik. Sistem Android dan aplikasi lain yang dipilih pengguna memiliki kebijakan privasi masing-masing. Jangan pernah mengirim file JSON private key melalui chat, email, atau layanan berbagi.

## Izin perangkat

- Akses penyimpanan hanya digunakan ketika pengguna secara eksplisit menyimpan file hasil. Pada Android 10 dan versi lebih lama, Android dapat meminta izin penyimpanan untuk menulis ke Documents.
- Getaran dipakai sebagai umpan balik opsional melalui fitur haptics perangkat.
- Aplikasi tidak meminta akses lokasi, kontak, kamera, mikrofon, atau daftar akun.

## Anak-anak, retensi, dan perubahan

Aplikasi tidak meminta atau mengumpulkan informasi dari anak-anak maupun pengguna lain. Hasil yang belum diekspor hilang saat aplikasi ditutup atau dibersihkan; file yang diekspor tetap ada sampai pengguna menghapusnya. Jika praktik aplikasi atau kebijakan ini berubah, dokumen ini akan diperbarui sebelum versi terkait dirilis.

## Kontak

Pertanyaan atau permintaan terkait privasi dapat disampaikan melalui issue repositori: <https://github.com/SLREV/whalet-vanity-grinder/issues>.
