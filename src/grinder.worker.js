'use strict';
/**
 * Worker grinding vanity address Solana.
 *
 * Langkah per kandidat, identik dengan yang dilakukan `solana-keygen grind`:
 *   1. Buat keypair Ed25519 acak (CSPRNG bawaan Node/OpenSSL).
 *   2. Ambil 32 byte seed (secret) + 32 byte public key.
 *   3. Encode public key ke base58 -> inilah "alamat" Solana.
 *   4. Cocokkan dengan prefix yang diminta.
 *   5. Kalau cocok -> self-check tanda tangan, lalu kirim keypair 64 byte.
 *
 * Format keypair 64 byte = [secret 32 byte | public 32 byte],
 * sama persis dengan file .json yang ditulis solana-keygen.
 */

const { parentPort, workerData } = require('node:worker_threads');
const { generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey } = require('node:crypto');

// ---------------------------------------------------------------------------
// Base58 (alpabet resmi: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz)
// ---------------------------------------------------------------------------
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_OUT = new Uint8Array(128);

/**
 * Encode 32 byte -> string base58 tanpa alokasi per iterasi.
 * Algoritma "long division" berulang: tiap putaran menghasilkan satu digit
 * base58 paling belakang. Hasilnya diverifikasi identik dengan `bs58`.
 *
 * PENTING - kenapa word-nya 16 bit, bukan 32 bit:
 *   Nilai antara `cur = rem * BASE + w[i]` harus tetap di bawah 2^53 supaya
 *   pembagian dan sisanya eksak dalam double. Dengan BASE = 2^16:
 *       cur maks = 57 * 65536 + 65535 = 3.801.087  (jauh di bawah 2^53)
 *   Dengan BASE = 2^32 nilainya 2,46e11 dan sisa `% 58` bisa meleset karena
 *   presisi, yang membuat loop tidak pernah berhenti. Jangan "dioptimalkan"
 *   ke 2^32 tanpa memeriksa ini.
 */
const WORD_BITS = 16;
const WORD_BASE = 65536;
const N_WORDS = 32 * 8 / WORD_BITS; // 16

function base58Encode32(b) {
  const w = new Uint16Array(N_WORDS);
  for (let i = 0; i < N_WORDS; i++) w[i] = (b[2 * i] << 8) | b[2 * i + 1];

  let zeros = 0;
  while (zeros < 32 && b[zeros] === 0) zeros++;

  let start = 0;
  let end = B58_OUT.length;
  let guard = 0;

  while (start < N_WORDS) {
    if (w[start] === 0) {
      start++;
      continue;
    }
    if (++guard > 64) {
      // Jumlah digit base58 untuk 32 byte maksimal 44. Lebih dari itu = bug.
      throw new Error('base58Encode32: iterasi melebihi batas, ada bug');
    }

    let rem = 0;
    for (let i = start; i < N_WORDS; i++) {
      const cur = rem * WORD_BASE + w[i];
      const q = (cur / 58) | 0;
      w[i] = q;
      rem = cur - q * 58;
    }
    B58_OUT[--end] = rem;
    if (w[start] === 0) start++;
  }

  let s = '';
  for (let i = 0; i < zeros; i++) s += '1';
  for (let i = end; i < B58_OUT.length; i++) s += B58_ALPHABET[B58_OUT[i]];
  return s;
}

// ---------------------------------------------------------------------------
// base64url -> bytes (tanpa Buffer.from, lebih cepat untuk string 43 karakter)
// ---------------------------------------------------------------------------
const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64U_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64U_LOOKUP[B64U.charCodeAt(i)] = i;

function b64urlTo32Bytes(s) {
  const out = Buffer.allocUnsafe(32);
  let o = 0;
  for (let i = 0; i < 40; i += 4) {
    const n =
      (B64U_LOOKUP[s.charCodeAt(i)] << 18) |
      (B64U_LOOKUP[s.charCodeAt(i + 1)] << 12) |
      (B64U_LOOKUP[s.charCodeAt(i + 2)] << 6) |
      B64U_LOOKUP[s.charCodeAt(i + 3)];
    out[o++] = (n >> 16) & 255;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  // 3 karakter terakhir (43 total) = 18 bit -> 2 byte berguna
  const tail =
    (B64U_LOOKUP[s.charCodeAt(40)] << 12) |
    (B64U_LOOKUP[s.charCodeAt(41)] << 6) |
    B64U_LOOKUP[s.charCodeAt(42)];
  out[30] = (tail >> 10) & 255;
  out[31] = (tail >> 2) & 255;
  return out;
}

// ---------------------------------------------------------------------------
// Persiapan target
// ---------------------------------------------------------------------------
const targets = workerData.targets.map((t) => ({
  prefix: t.prefix,
  probe: t.ignoreCase ? t.prefix.toLowerCase() : t.prefix,
}));
const IGNORE_CASE = targets[0].ignoreCase;

// Kirim progres berdasarkan WAKTU, bukan jumlah tetap. Tanpa ini, prefix pendek
// yang ketemu dalam <1.000 percobaan tidak pernah mengirim progres sama sekali,
// jadi pemanggil tidak bisa mengukur kecepatan.
const PROGRESS_MS = workerData.progressMs || 200;
const PROGRESS_MIN_KEYS = workerData.progressMinKeys || 50;
let lastReport = Date.now();
let lastReported = 0;

// Header DER untuk membangun kembali key dari byte mentah (dipakai saat self-check).
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

let checked = 0;

function selfCheck(seedRaw, pubRaw, address) {
  // Bangun ulang keypair dari byte mentah (jalur kode yang berbeda),
  // lalu pastikan public key-nya sama dan tanda tangannya valid.
  const priv = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seedRaw]),
    format: 'der',
    type: 'pkcs8',
  });
  const pub = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, pubRaw]),
    format: 'der',
    type: 'spki',
  });

  const derived = pub.export({ type: 'spki', format: 'der' }).subarray(-32);
  if (Buffer.compare(derived, pubRaw) !== 0) {
    throw new Error('Self-check gagal: public key tidak cocok dengan seed.');
  }

  const msg = Buffer.from(`solana-vanity self-check ${address}`);
  const sig = sign(null, msg, priv);
  if (!verify(null, msg, pub, sig)) {
    throw new Error('Self-check gagal: tanda tangan tidak bisa diverifikasi.');
  }
}

function loop() {
  while (true) {
    const { privateKey } = generateKeyPairSync('ed25519');

    // JWK export ~70x lebih cepat daripada DER export, dan berisi dua-duanya:
    //   d = seed 32 byte (base64url),  x = public key 32 byte (base64url)
    const jwk = privateKey.export({ format: 'jwk' });
    const pubRaw = b64urlTo32Bytes(jwk.x);

    const address = base58Encode32(pubRaw);
    const probe = IGNORE_CASE ? address.toLowerCase() : address;

    checked++;

    for (let i = 0; i < targets.length; i++) {
      if (probe.startsWith(targets[i].probe)) {
        const seedRaw = b64urlTo32Bytes(jwk.d);
        selfCheck(seedRaw, pubRaw, address);

        // Keypair 64 byte seperti file solana-keygen: secret lalu public.
        const keypair = Buffer.concat([seedRaw, pubRaw]);
        parentPort.postMessage({
          type: 'found',
          address,
          prefix: targets[i].prefix,
          keypair: Array.from(keypair),
          checked,
        });
        return;
      }
    }

    if (checked - lastReported >= PROGRESS_MIN_KEYS && Date.now() - lastReport >= PROGRESS_MS) {
      lastReport = Date.now();
      lastReported = checked;
      parentPort.postMessage({ type: 'progress', checked });
    }
  }
}

try {
  loop();
} catch (err) {
  parentPort.postMessage({ type: 'error', message: String((err && err.stack) || err) });
}
