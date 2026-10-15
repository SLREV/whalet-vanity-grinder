# Persiapan Google Play Store

> Project sudah memiliki Android app, ikon aplikasi, kebijakan privasi, dan workflow CI untuk AAB/APK. Publikasi tetap perlu dilakukan oleh pemilik akun Play Console; CI tidak mengunggah aplikasi otomatis.

## Identitas aplikasi

- **Nama:** VanitySol
- **Application ID:** `com.vanitysol.app`
- **AAB:** `android/app/build/outputs/bundle/release/app-release.aab`
- **APK uji:** `android/app/build/outputs/apk/release/app-release.apk`
- **Ikon 512×512:** `docs/assets/play-icon-512.png`
- **Kebijakan privasi:** `docs/privacy.html` atau `PRIVACY.md`; host sebagai URL HTTPS publik sebelum mengisi listing. Jika GitHub Pages diaktifkan untuk folder `docs`, URL biasanya berbentuk `https://slrev.github.io/whalet-vanity-grinder/privacy.html`.

Application ID adalah identitas permanen di Play Store. Pastikan pemilik domain/package name menyetujuinya sebelum rilis pertama.

## Keystore upload

Buat **satu upload key** dan simpan salinan terenkripsi/offline yang aman. Jangan menaruh keystore, password, atau hasil base64 di Git, issue, atau chat. Contoh Linux/macOS:

```bash
keytool -genkeypair -v \
  -keystore vanitysol-upload.jks \
  -alias vanitysol-upload \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w 0 vanitysol-upload.jks
```

Di Windows PowerShell, base64 satu baris dapat dibuat dengan:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('vanitysol-upload.jks'))
```

Tambahkan empat nilai berikut sebagai **GitHub Actions repository secrets**:

1. `KEYSTORE_BASE64` — string base64 satu baris dari file keystore.
2. `KEYSTORE_PASSWORD` — password keystore.
3. `KEY_ALIAS` — contoh `vanitysol-upload`.
4. `KEY_PASSWORD` — password key alias.

Setelah itu jalankan workflow **Android build** (manual atau dengan push/tag). Jika secrets tidak ada, workflow tetap membuat artifact debug-signed untuk uji perangkat. Artifact tersebut **tidak layak diunggah ke Play Store**. Rahasiakan dan cadangkan upload key; kehilangan key dapat menghambat pembaruan aplikasi.

Google Play App Signing dan proses pengelolaan kunci di Play Console tetap perlu diselesaikan oleh pemilik akun. Untuk rilis, gunakan AAB yang ditandatangani dengan upload key dan ikuti instruksi terkini di Play Console.

## Teks listing yang bisa disunting

**Judul**

> VanitySol: Alamat Solana

**Deskripsi singkat**

> Temukan alamat Solana berawalan pilihanmu. Kunci dibuat lokal; ekspor JSON.

**Deskripsi lengkap**

> VanitySol mencari pasangan kunci Solana yang alamat publik base58-nya diawali karakter pilihanmu.
>
> • Tentukan prefix dan jumlah alamat yang ingin dicari.<br>
> • Ukur kecepatan perangkat dan lihat estimasi rata-rata sebelum mulai.<br>
> • Jalankan beberapa proses paralel, hentikan kapan saja, lalu pilih hasil.<br>
> • Salin atau bagikan alamat publik, atau ekspor keypair JSON 64 angka yang kompatibel dengan `solana-keygen`.
>
> **Privasi dan keamanan**<br>
> Pencarian dan pembuatan kunci terjadi di perangkat. APK tidak meminta izin internet dan tidak memiliki iklan, analytics, atau akun. Tidak ada private key yang dikirim ke server. File JSON hanya dibuat setelah pengguna memilih Simpan; file itu berisi private key dan harus dijaga seperti uang tunai.
>
> VanitySol hanya membuat keypair. Aplikasi tidak mengirim transaksi, tidak menyimpan dana, dan tidak menjamin prefix tertentu akan ditemukan dalam waktu tertentu. Pencarian bersifat brute force; prefix lebih panjang dapat memerlukan waktu sangat lama dan menguras baterai.

**Kategori dan dukungan**

Pilih kategori yang paling sesuai di Play Console, masukkan email dukungan yang dipantau, dan tautkan kebijakan privasi publik. Jangan menyatakan aplikasi sebagai wallet/custodian atau mengklaim audit keamanan yang belum dilakukan.

**Data safety (draf untuk diverifikasi pada build final):** aplikasi tidak mengumpulkan atau membagikan data melalui server/SDK. File private key hanya disimpan lokal setelah pengguna menekan Simpan. Konfirmasi setiap jawaban melalui pemeriksaan manifest, dependency final, dan formulir Play Console; jangan menyalin deklarasi tanpa meninjau versi yang benar-benar diunggah.

## Checklist sebelum rilis

- [ ] Tinjau kepemilikan dan kestabilan `com.vanitysol.app`.
- [ ] Isi semua metadata listing, email dukungan, URL kebijakan privasi, rating konten, dan formulir Data safety berdasarkan build final.
- [ ] Siapkan screenshot asli aplikasi dari perangkat Android; jangan pakai mockup yang menyiratkan fitur yang tidak ada.
- [ ] Pastikan ikon 512×512 (`docs/assets/play-icon-512.png`) memenuhi spesifikasi listing yang berlaku.
- [ ] Tambahkan keempat signing secrets dan pastikan ringkasan Actions menyatakan upload key dipakai.
- [ ] Unduh AAB dari artifact Actions, lalu cek di Play Console / Bundle Explorer sebelum rilis.
- [ ] Uji instalasi dan ekspor file di perangkat sungguhan. Verifikasi JSON berisi 64 angka dan jangan unggah file keypair ke test report.
- [ ] Uji pencarian prefix pendek, proses paralel, berhenti, ekspor, share alamat publik, dan penggunaan tanpa jaringan.
- [ ] Tinjau kebijakan dan persyaratan Play Console saat publikasi; Google dapat mengubah persyaratan setelah dokumen ini ditulis.
