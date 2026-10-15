# solana-vanity — buat alamat Solana yang diawali namamu

Generator **vanity address** Solana: brute-force membuat keypair Ed25519 sampai
public key-nya (alamat) diawali prefix yang kamu pilih, misalnya nama sendiri.

Script ini meniru perilaku dan format keluaran `solana-keygen grind` dari Solana
CLI resmi, tapi ditulis dalam JavaScript murni sehingga jalan di mana pun Node.js
ada — tanpa perlu memasang Solana CLI atau Rust toolchain.

```bash
node bin/grind.js --starts-with Budi:1 --ignore-case
```

```
✓ Ketemu  BudiK7qXhY9m3vQ2pLcR8tWnZsAeDfGjHkLmNoPqRsTu
  prefix   : Budi
  percobaan: 1.284 (worker)
  file     : ./vanity-keys/BudiK7qXhY9m3vQ2pLcR8tWnZsAeDfGjHkLmNoPqRsTu.json
```

---

## Dasar resminya

Semua yang dilakukan script ini mengikuti dokumentasi resmi Solana:

| Hal | Sumber resmi |
| --- | --- |
| Vanity address = "alamat Solana yang diawali karakter pilihan", dibuat dengan `solana-keygen grind --starts-with hi:1` | [Solana Cookbook — How to Generate a Vanity Address](https://solana.com/developers/cookbook/wallets/generate-vanity-address) |
| Bentuk perintah `grind`, termasuk `--use-mnemonic` dan peringatan "bisa butuh berhari-hari" | [Agave Validator Guide — Vanity Keypair](https://docs.anza.xyz/operations/guides/validator-start#vanity-keypair) |
| Format file keypair: JSON array **64 angka**, 32 byte secret + 32 byte public, dibaca dengan `Uint8Array.from(JSON.parse(...))` | [Solana Cookbook — Load a local json file keypair](https://solana.com/developers/cookbook/development/load-keypair-from-file) |
| Keypair Ed25519, secret key tidak boleh dibagikan | [Solana Cookbook — How to Create a Keypair](https://solana.com/developers/cookbook/wallets/create-keypair) |
| Referensi perintah CLI | [Solana CLI Reference](https://solana.com/docs/references/solana-cli) |

Perintah resmi yang setara persis:

```bash
solana-keygen grind --starts-with Budi:1 --ignore-case
```

---

## Syarat

- **Node.js 18 atau lebih baru** (diuji di Node 20). CLI tidak memiliki dependensi runtime; aplikasi Android/PWA memakai Capacitor.
- CPU. Grinding itu brute-force, tidak ada jalan pintas.

```bash
node --version
```

---

## Langkah menjalankan

### 1. Cek Node.js sudah ada

```bash
node --version
```

Harus muncul `v18.x` atau lebih baru. Kalau `command not found`, pasang dulu dari
[nodejs.org](https://nodejs.org) (Windows/macOS) atau `sudo apt install nodejs`
(Linux).

### 2. Masuk ke folder script

```bash
cd solana-vanity
```

### 3. Cek dulu berapa lama (opsional tapi sangat disarankan)

```bash
node bin/grind.js --starts-with Rian:1 --ignore-case --estimate
```

Ini mengukur kecepatan CPU-mu dan menampilkan perkiraan waktu, lalu keluar tanpa
mencari apa pun. Jadi kamu tahu lebih dulu apakah ini butuh 20 detik atau 8 jam —
bukan menebak-nebak sambil menunggu.

### 4. Jalankan

```bash
node bin/grind.js --starts-with Rian:1 --ignore-case
```

Ganti `Rian` dengan namamu. Artinya: cari **1** alamat yang diawali `Rian`,
huruf besar/kecil bebas.

> **Selalu pakai `--ignore-case`.** Tanpa itu pencarian case-sensitive dan butuh
> sekitar 16× lebih lama untuk nama 4 huruf. Ini penyebab paling umum orang
> menunggu berjam-jam tanpa hasil.

### 5. Tunggu

Layar menampilkan progres langsung:

```
  25.000 keypair dicoba | 22.502 key/detik | 1d | ditemukan 0/1
```

`1d` = 1 detik berjalan. Untuk hentikan paksa: `Ctrl+C`.

### 6. Lihat hasilnya

```
✓ Ketemu  rcbi23FdZgWCyDEXKV6wndCGxJsBfKYuBfE8bM3gsec
  prefix   : R
  percobaan: 2.452 (worker)
  file     : ./vanity-keys/rcbi23FdZgWCyDEXKV6wndCGxJsBfKYuBfE8bM3gsec.json

Selesai: 1 alamat dalam 0.1 detik.
Muat ke Solana CLI : solana config set --keypair ./vanity-keys/<ALAMAT>.json
Cek pubkey         : solana-keygen pubkey ./vanity-keys/<ALAMAT>.json

⚠  File .json itu ISINYA PRIVATE KEY. Jangan di-share, jangan di-commit ke git.
```

(Output di atas hasil jalankan sungguhan, bukan contoh karangan.)

### 7. Pakai alamatnya

```bash
solana config set --keypair ./vanity-keys/<ALAMAT>.json
solana balance
```

Atau di JavaScript:

```js
const bytes = Uint8Array.from(JSON.parse(fs.readFileSync('./vanity-keys/<ALAMAT>.json', 'utf8')));
```

### Kalau mau coba dulu tanpa menunggu lama

Prefix 1 huruf selesai dalam hitungan detik:

```bash
node bin/grind.js --starts-with R:1 --ignore-case
```

### Kalau keluar "karakter yang tidak ada di base58"

Namamu mengandung `0`, `O`, `I`, atau `l`. Contoh:

```
✗ PREFIX "Rizal0" memakai karakter yang tidak ada di base58:
  '0' -> pakai 'o'
```

Ganti sesuai saran, misalnya `--starts-with Rizalo:1`.

### CLI tidak perlu `npm install`

Untuk grinding CLI, Node.js saja cukup dan tidak ada dependensi runtime. `npm ci`
diperlukan untuk test dan untuk membangun aplikasi Android/PWA (Capacitor).

## Cara pakai

```bash
cd solana-vanity
node bin/grind.js --starts-with Budi:1
```

Hasilnya disimpan di `./vanity-keys/<ALAMAT>.json` dengan izin `0600`.

### Opsi

| Opsi | Arti |
| --- | --- |
| `--starts-with PREFIX:JUMLAH` | Cari `JUMLAH` alamat yang diawali `PREFIX`. Boleh ditulis berulang untuk beberapa prefix sekaligus. |
| `--ignore-case` | Cocokkan tanpa memedulikan huruf besar/kecil. **Default case-sensitive**, sama seperti `solana-keygen`. |
| `--threads N` | Jumlah thread (default: semua core CPU). |
| `--out-dir DIR` | Folder keluaran (default `./vanity-keys`). |
| `--overwrite` | Izinkan menimpa file yang sudah ada. |
| `--estimate` | Ukur kecepatan CPU-mu, tampilkan perkiraan waktu, lalu keluar **tanpa mencari**. Jalankan ini dulu. |
| `--print-keys` | Tampilkan secret key di layar. Jangan dipakai kalau layar direkam. |
| `--quiet` | Tanpa baris progres. |
| `-h`, `--help` | Bantuan. |

### Contoh

```bash
# Satu alamat diawali "Budi", huruf besar/kecil bebas (paling cepat)
node bin/grind.js --starts-with Budi:1 --ignore-case

# Tiga pilihan alamat untuk dipilih
node bin/grind.js --starts-with Budi:3 --ignore-case --out-dir ./kunci

# Dua prefix sekaligus
node bin/grind.js --starts-with Budi:1 --starts-with BUDI:1

# Case-sensitive persis "Budi" (16x lebih lama daripada --ignore-case)
node bin/grind.js --starts-with Budi:1
```

---

## Berapa lama?

Rata-rata percobaan = `58^panjang_prefix`, dibagi `2^jumlah_huruf` kalau
`--ignore-case` dipakai. CLI menampilkan angka ini saat mulai.

| Prefix | Case-sensitive | `--ignore-case` |
| --- | --- | --- |
| 1 huruf | ~58 | ~29 |
| 2 huruf | ~3.400 | ~841 |
| 3 huruf | ~195.000 | ~24.400 |
| 4 huruf (nama pendek) | ~11,3 juta | ~707.000 |
| 5 huruf | ~656 juta | ~20,5 juta |
| 6 huruf | ~38 miliar | ~790 juta |

Dengan kecepatan sekitar **15.000–25.000 keypair/detik per core** (tergantung
CPU), prefix 4 huruf dengan `--ignore-case` biasanya selesai dalam beberapa
detik sampai beberapa menit. Prefix 6 huruf ke atas butuh waktu lama — untuk itu
lebih baik pakai tool berakselerasi GPU.

> Angka kecepatan di atas adalah hasil pengukuran di mesin pengembangan, bukan
> jaminan di mesinmu. CLI menampilkan kecepatan aktual secara langsung.

---

## Sudah lama tapi belum ketemu?

**Cek dulu perkiraan waktunya, jangan menebak:**

```bash
node bin/grind.js --starts-with Rian:1 --estimate
```

Ini mengukur kecepatan CPU-mu selama kurang dari 1 detik, menampilkan perkiraan
waktu, lalu keluar **tanpa mencari apa pun**. Contoh keluaran nyata:

```
Kecepatan terukur: ~16.904 keypair/detik per thread (x 2 thread = ~33.809/detik)
Perkiraan waktu  : ~5.6 menit
```

Kalau perkiraannya sudah masuk akal tapi tetap tidak ketemu, periksa hal-hal ini:

### 1. Kamu tidak pakai `--ignore-case`

Ini penyebab paling umum. Tanpa flag itu pencarian **case-sensitive**, artinya
`Rian` hanya cocok kalau persis `Rian` — bukan `rian`, `RiaN`, atau `rIan`.

Untuk nama 4 huruf, bedanya **16 kali**:

| Perintah | Rata-rata percobaan | Waktu (2 thread @ ~20rb/detik) |
| --- | --- | --- |
| `--starts-with Rian:1` | ~11,3 juta | ~4,7 menit |
| `--starts-with Rian:1 --ignore-case` | ~707 ribu | **~18 detik** |

Selalu pakai `--ignore-case` kecuali kamu memang butuh huruf besar/kecil persis.

### 2. Prefix-nya lebih panjang dari yang kamu kira

Tiap tambahan 1 karakter = **58× lebih lama**. Nama 5 huruf sudah ~20 juta
percobaan (~8,5 menit dengan `--ignore-case`), nama 6 huruf ~1,2 miliar
(~8 jam). Nama panjang seperti `Muhammad` praktis mustahil di CPU
(~500 miliar percobaan).

Solusinya: pakai 3–4 huruf pertama saja. Alamat `Ria...` atau `Rian...` tetap
terlihat sebagai namamu.

### 3. Thread-nya kurang

```bash
node bin/grind.js --starts-with Rian:1 --ignore-case --threads 8
```

Cek jumlah core: `node -e "console.log(require('os').cpus().length)"`.

### 4. Kecepatan mesinmu jauh di bawah perkiraan

Bandingkan angka `--estimate` dengan tabel di atas. Kalau kecepatanmu cuma
sepersepuluh, kemungkinan laptop dalam mode hemat baterai, atau ada proses lain
yang memakan CPU.

### 5. Kamu menjalankannya di lingkungan terbatas

Kalau kamu menjalankan script ini di sandbox online / container / workspace
berbasis web (bukan di komputermu sendiri), thread-nya bisa dibatasi atau
dibekukan sehingga pencarian nyaris tidak maju. Ciri-cirinya: baris progres
berhenti di angka yang sama lama sekali, atau muncul pesan
`worker #N tidak memberi progres >15s, diganti` berulang-ulang.

**Solusinya: jalankan di komputermu sendiri**, bukan di sandbox.

### 6. Memang butuh GPU

Untuk prefix 6 karakter ke atas, CPU bukan alat yang tepat. Grinder GPU bisa
ratusan kali lebih cepat — lihat bagian [Batasan](#batasan).

---

## Cara mempercepat (ringkasan)

1. `--ignore-case` — sampai 2^(jumlah huruf) kali lebih cepat
2. Prefix lebih pendek 1 karakter — 58× lebih cepat
3. `--threads` lebih banyak
4. Jalankan di mesin sendiri, bukan sandbox
5. Prefix panjang → pakai grinder GPU

### Karakter yang tidak bisa dipakai

Alamat Solana memakai **base58**, yaitu:

```
123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
```

Empat karakter ini **tidak ada** di base58 karena mudah tertukar:
`0` (nol), `O` (O besar), `I` (I besar), `l` (L kecil).

Kalau namamu mengandung salah satunya, script akan menolak dan menyarankan
pengganti:

```
✗ PREFIX "B0di" memakai karakter yang tidak ada di base58:
  '0' -> pakai 'o'
```

---

## Format file keluaran

Sama persis dengan `solana-keygen`: satu baris JSON array berisi 64 angka.

```json
[12,255,7,...,193]
```

- 32 angka pertama = **secret key** (seed Ed25519)
- 32 angka terakhir = **public key** = alamatmu setelah di-base58

Dipakai di Solana CLI:

```bash
solana config set --keypair ./vanity-keys/<ALAMAT>.json
solana-keygen pubkey ./vanity-keys/<ALAMAT>.json
```

Dipakai di JavaScript (`@solana/kit` maupun `@solana/web3.js`):

```js
const bytes = Uint8Array.from(JSON.parse(fs.readFileSync('vanity-keys/<ALAMAT>.json', 'utf8')));
```

---

## ⚠ Keamanan

- **File `.json` itu berisi private key.** Siapa pun yang punya file itu bisa
  menguras seluruh isi wallet. Jangan di-share, jangan di-commit ke git, jangan
  di-upload.
- Script ini membuat keypair **tanpa seed phrase**. Kalau kamu butuh pemulihan
  lewat seed phrase, pakai perintah resmi:
  `solana-keygen grind --use-mnemonic --starts-with Budi:1`
  (catatan resmi: jauh lebih lambat).
- Grinding berjalan **100% offline**. Script ini tidak mengirim data ke mana pun
  dan tidak membuat koneksi jaringan.
- Jangan pernah menjalankan grinder untuk alamat yang akan menampung dana besar
  di mesin yang tidak kamu percayai.
- Vanity address tidak menambah maupun mengurangi keamanan wallet. Keamanannya
  sama dengan keypair Ed25519 biasa.

---

## Cara kerja

Untuk tiap kandidat:

1. Buat keypair Ed25519 acak lewat CSPRNG bawaan Node/OpenSSL.
2. Ambil 32 byte seed dan 32 byte public key.
3. Encode public key ke base58 → inilah alamat Solana.
4. Cocokkan dengan prefix yang diminta.
5. Kalau cocok: lakukan **self-check** (bangun ulang keypair dari byte mentah,
   pastikan public key-nya sama dan tanda tangannya bisa diverifikasi), lalu
   tulis file.

Pencarian disebar ke beberapa `worker_thread`. Proses induk memantau tiap worker;
kalau worker thread tidak memberi progres lebih dari 15 detik, CLI menganggap
mesin itu tidak menjadwalkan worker thread dan **otomatis beralih ke mode aman**:
grinding jalan di proses utama (lebih pelan, tapi pasti jalan). Bisa juga
dipaksa lewat env `SOLANA_VANITY_NO_THREADS=1`. Jadi pencarian tidak pernah
berhenti diam-diam.

Dua detail implementasi yang sengaja dibuat begitu:

- **Export JWK, bukan DER.** `privateKey.export({format:'jwk'})` memberi seed dan
  public key sekaligus, dan terukur sekitar 70× lebih cepat daripada
  `export({type:'spki'/'pkcs8', format:'der'})`.
- **Encoder base58 memakai word 16 bit.** Nilai antara `rem * BASE + w[i]` harus
  tetap di bawah `2^53` supaya pembagian dan sisanya eksak dalam double. Dengan
  `BASE = 2^16` nilai maksimumnya 3.801.087 — aman. Dengan `BASE = 2^32`
  sisanya bisa meleset karena presisi, dan loop-nya tidak pernah berhenti.
  Ada test regresi khusus untuk ini.

---

## Test

```bash
npm ci
npm test             # test inti CLI
npm run test:app     # WebCrypto/TweetNaCl app dibandingkan dengan node:crypto
npm run test:e2e     # test end-to-end, menjalankan CLI sungguhan
```

**Test inti** (`test.mjs`) membandingkan encoder base58 internal dengan library
referensi `bs58` pada 1.000 byte acak, **5.000 public key Ed25519 asli**, dan
kasus tepi; lalu memeriksa bahwa keypair hasil grind benar-benar sah secara
kriptografis memakai `tweetnacl` sebagai pembanding independen.

**Test end-to-end** (`test-e2e.mjs`) menjalankan CLI seperti pengguna asli dan
memeriksa jumlah serta isi file yang dihasilkan.

```bash
node tools/make-fixtures.mjs   # buat ulang fixture public key
```

---

## Isi direktori

```
solana-vanity/
├── bin/grind.js              CLI (entry point)
├── src/grinder.worker.js     worker: bikin keypair + cek prefix
├── test.mjs                  test inti (deterministik)
├── test-e2e.mjs              test end-to-end (menjalankan CLI)
├── test/fixtures-pubkeys.json  5.000 public key Ed25519 untuk test
├── tools/make-fixtures.mjs   pembuat fixture
└── package.json
```

## Batasan

- Hanya mendukung **prefix** (`--starts-with`), seperti yang diminta. Untuk
  suffix, `solana-keygen grind` punya `--ends-with` dan
  `--starts-and-ends-with`.
- Tidak membuat seed phrase. Lihat bagian Keamanan di atas.
- CPU-only. Untuk prefix panjang (6 karakter ke atas) pertimbangkan grinder
  berakselerasi GPU, misalnya
  [grincel.gpu](https://github.com/binoculars/grincel.gpu) (Metal/Vulkan,
  diklaim ~820k key/detik di Apple Silicon) atau
  [ziglana/grincel.gpu](https://github.com/ziglana/grincel.gpu). Angka itu klaim
  penulisnya, belum saya verifikasi sendiri.

---

## Aplikasi Android: VanitySol

Repo ini juga menyediakan aplikasi Android/PWA berbahasa Indonesia. PWA bisa dipasang dari Chrome Android; project native Capacitor dan workflow GitHub Actions membangun AAB/APK untuk pengujian atau distribusi. APK tidak meminta izin internet. Estimasi dan kecepatan di ponsel bergantung perangkat serta kondisi panas/baterai.

Untuk menyiapkan aset web dan menyinkronkannya ke Android:

```bash
npm ci
npm run android:sync
```

Untuk mencoba versi web lokal:

```bash
npm run preview:app
```

Buka tautan HTTPS Live Preview dari Arena di Chrome Android untuk memasangnya sebagai PWA. Untuk build native lokal diperlukan JDK dan Android SDK:

```bash
cd android
./gradlew assembleDebug
```

Build Play Store harus memakai upload keystore milikmu sendiri. CI menghasilkan artifact bertanda debug bila signing secrets belum tersedia; artifact debug **tidak dapat dipublikasikan**. Jangan pernah commit keystore atau file JSON hasil grinder.

- Panduan Android dan CI: [docs/ANDROID.md](docs/ANDROID.md)
- Checklist listing dan signing Play Store: [docs/PLAY-STORE.md](docs/PLAY-STORE.md)
- Kebijakan privasi: [PRIVACY.md](PRIVACY.md)
