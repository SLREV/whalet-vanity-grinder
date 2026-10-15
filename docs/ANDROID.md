# VanitySol di Android

VanitySol tersedia dalam dua jalur:

1. **PWA** — bisa dipasang dari Chrome Android melalui tautan HTTPS. PWA memerlukan koneksi untuk membuka/mengunduh aset pertama kali; setelah cache terpasang, antarmuka dan mesin pencariannya berjalan lokal.
2. **APK/AAB native** — dibangun dengan Capacitor. APK tidak memiliki izin `INTERNET`; hasil pencarian tidak dikirim ke server. Minimum Android yang dikonfigurasi saat ini API 24 (Android 7.0).

## Coba PWA sekarang

Buka tautan **Live Preview** yang dibagikan bersama sesi Arena dari Chrome Android. Pilih menu Chrome → **Instal aplikasi** (atau **Tambahkan ke layar utama**). Link preview hanya aktif selama sesi/layanan preview tersedia; ini bukan alamat hosting permanen.

## Persiapan build native

- Node.js 22+ dan npm (sesuai kebutuhan Capacitor CLI 8 pada project ini).
- Android Studio dengan Android SDK yang cocok dengan `android/variables.gradle`.
- JDK 21 (Android Gradle Plugin pada template Capacitor 8).

```bash
npm ci
npm run test:app
npm run android:sync
```

Buka project native:

```bash
npx cap open android
```

Atau build APK debug lokal (perlu JDK dan Android SDK di `PATH`/`local.properties`):

```bash
cd android
./gradlew assembleDebug
```

APK debug ada di `android/app/build/outputs/apk/debug/app-debug.apk`. Untuk mengirim aplikasi ke pengguna, **jangan bagikan build debug**; gunakan AAB bertanda tangan upload key melalui workflow CI.

## Signing lokal (opsional)

Untuk build lokal bertanda tangan, letakkan `android/keystore.properties` dengan format berikut. Keystore dan file properti ini sudah dikecualikan dari Git.

```properties
storeFile=app/upload-key.jks
storePassword=GANTI_DENGAN_PASSWORD
keyAlias=vanitysol-upload
keyPassword=GANTI_DENGAN_PASSWORD
```

Simpan `upload-key.jks` di `android/app/`. Jangan commit atau mengunggahnya ke issue/chat. Lihat [PLAY-STORE.md](PLAY-STORE.md) untuk strategi key yang disarankan.

## Build melalui GitHub Actions

Workflow `.github/workflows/android.yml` berjalan pada pull request, push ke `main`/`arena/**`, tag `v*`, atau manual (`workflow_dispatch`). Workflow menjalankan test app, membangun web assets, sinkronisasi Capacitor, lalu mengunggah AAB dan APK sebagai artifact GitHub Actions.

Tambahkan ke **Repository → Settings → Secrets and variables → Actions**:

- `KEYSTORE_BASE64` — keystore upload dalam base64 satu baris.
- `KEYSTORE_PASSWORD`
- `KEY_ALIAS`
- `KEY_PASSWORD`

Jika semua secret tersedia, build release memakai upload key tersebut. Jika tidak, workflow memakai debug key agar artifact tetap bisa dipasang untuk pengujian; **artifact itu tidak dapat dipublikasikan di Google Play**. Build dari pull request fork tidak menerima secrets.

`VERSION_CODE` berasal dari nomor run Actions dan `VERSION_NAME` dari `package.json` (atau nama tag `v...`). Jangan mengubah `applicationId` `com.vanitysol.app` setelah rilis pertama ke Play Store—mengubahnya akan membuat aplikasi baru.

## Pengujian

```bash
npm run test:app   # base58, JWK, keypair WebCrypto dibandingkan dengan node:crypto
npm test           # test inti CLI
npm run test:e2e   # menjalankan CLI sungguhan; lingkungan sandbox bisa melewati test yang thread-nya dibekukan
```

Perlu diingat: generator bekerja dengan brute force. Tambahan satu karakter pada prefix meningkatkan rata-rata pekerjaan sekitar 58 kali (atau sekitar 29 kali per huruf saat abaikan besar/kecil aktif). Estimasi di ponsel hanya perkiraan; beban, panas, dan throttling dapat memperlambat pencarian.
