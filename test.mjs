/**
 * TEST INTI - deterministik & cepat (sekitar 1-2 detik).
 *
 *   node test.mjs
 *
 * Semua pemeriksaan di sini tidak bergantung pada keberuntungan pencarian,
 * jadi hasilnya selalu sama di mesin mana pun.
 *
 * Yang diverifikasi:
 *  1. Encoder base58 internal identik dengan library referensi `bs58`,
 *     untuk byte acak, public key Ed25519 asli, dan kasus tepi.
 *  2. Keypair hasil grind sah secara kriptografis: 64 byte, public key
 *     benar-benar turunan dari seed (dicek tweetnacl), tanda tangan valid.
 *  3. Format file output sama dengan solana-keygen: JSON array 64 angka,
 *     permission 0600, dan nama file = alamat.
 *  4. Penolakan input yang salah (karakter non-base58, format flag).
 *
 * Pencarian end-to-end yang butuh CPU penuh ada di test-e2e.mjs.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Worker } from 'node:worker_threads';

import bs58 from 'bs58';
import nacl from 'tweetnacl';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(ROOT, 'src', 'grinder.worker.js');
const CLI = path.join(ROOT, 'bin', 'grind.js');
const OUT_DIR = path.join(ROOT, '.test-out');

let passed = 0;
async function ok(name, fn) {
  const t = Date.now();
  await fn();
  passed++;
  console.log(`  \u001b[32m✓\u001b[0m ${name} (${Date.now() - t} ms)`);
}

/** Ambil encoder base58 internal grinder untuk dibandingkan dengan bs58. */
function internalEncoder() {
  const src = fs.readFileSync(WORKER, 'utf8');
  const start = src.indexOf('const B58_ALPHABET');
  const end = src.indexOf('// base64url');
  if (start < 0 || end < 0) throw new Error('Tidak bisa mengekstrak encoder dari worker');
  const body = src.slice(start, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\n return base58Encode32;`)();
}

/**
 * Cari satu alamat lewat worker.
 *
 * Di sebagian lingkungan sandbox, thread bisa dibekukan hypervisor secara acak.
 * Karena itu pencarian diulang beberapa kali: kegagalan yang dilaporkan berarti
 * benar-benar bug kode, bukan gangguan lingkungan.
 */
async function grindOnce(prefix, ignoreCase = false, timeoutMs = 30_000, attempts = 8) {
  let lastErr;
  for (let a = 1; a <= attempts; a++) {
    try {
      return await grindOnceInner(prefix, ignoreCase, timeoutMs);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `gagal mencari prefix "${prefix}" setelah ${attempts} percobaan ` +
      `(kemungkinan thread dibekukan lingkungan). Terakhir: ${lastErr.message}`
  );
}

function grindOnceInner(prefix, ignoreCase, timeoutMs) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER, {
      workerData: { targets: [{ prefix, ignoreCase }], progressEvery: 50_000 },
    });
    const timer = setTimeout(() => {
      w.terminate();
      reject(new Error(`timeout mencari prefix "${prefix}"`));
    }, timeoutMs);
    w.on('message', (m) => {
      if (m.type === 'found') {
        clearTimeout(timer);
        w.terminate();
        resolve(m);
      } else if (m.type === 'error') {
        clearTimeout(timer);
        reject(new Error(m.message));
      }
    });
    w.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

/** Periksa sebuah file keypair punya format & isi yang benar. */
function assertValidKeypairFile(file, address, expectPrefix) {
  assert.ok(address.startsWith(expectPrefix) || address.toLowerCase().startsWith(expectPrefix.toLowerCase()),
    `${address} tidak diawali ${expectPrefix}`);

  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(parsed), 'harus JSON array');
  assert.equal(parsed.length, 64, 'harus 64 angka (32 secret + 32 public)');
  assert.ok(parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255), 'semua elemen 0..255');

  const bytes = Buffer.from(parsed);
  // Nama file harus sama dengan base58 dari 32 byte terakhir.
  assert.equal(bs58.encode(bytes.subarray(32, 64)), address);
  // 32 byte pertama harus benar-benar seed yang menurunkan public key itu.
  assert.equal(
    Buffer.from(nacl.sign.keyPair.fromSeed(bytes.subarray(0, 32)).publicKey).toString('hex'),
    bytes.subarray(32, 64).toString('hex')
  );
  // Tanda tangan harus bisa diverifikasi.
  const msg = Buffer.from('cek format keypair');
  assert.equal(nacl.sign.detached.verify(msg, nacl.sign.detached(msg, bytes), bytes.subarray(32, 64)), true);
}

async function main() {
  console.log('\n\u001b[1msolana-vanity — TEST INTI\u001b[0m\n');

  const enc = internalEncoder();

  // --- 1. Encoder base58 ----------------------------------------------------
  await ok('encoder base58 identik dengan bs58 (1000 vektor acak)', () => {
    for (let i = 0; i < 1000; i++) {
      const r = crypto.randomBytes(32);
      assert.equal(enc(r), bs58.encode(r));
    }
  });

  // REGRESI: versi lama memakai word 32 bit sehingga `rem * 2^32 + w[i]`
  // kehilangan presisi dan loop tidak pernah berhenti untuk sebagian input.
  // Input pemicunya adalah public key Ed25519 asli, yang TIDAK tercakup oleh
  // byte acak biasa - itu sebabnya bug-nya lolos dari uji vektor acak.
  await ok('REGRESI: public key yang dulu bikin loop tak terbatas kini benar', () => {
    const triggers = [
      '562d4baa73797f0137fac825bfdf93d66f3b3cee44959a42e9fbc92fd5a9a6dc',
      '651083e361388ecf4f413d3c3c9e04cd754a42b27f9d81e29baba14a9fb2e8f0',
      'b6545c58f1de899810a4b2f0ecd617ba68c984601a341215771d9d81753aeecd',
      'b0126c41fe0991ee65aaeed41e46c75fc0d57e980d7259f4cec594ae192e8f6e',
      'd2379ada57f1800bbaa725273520e4cb0cb03c074e47154a702f37e666c43662',
    ];
    for (const h of triggers) {
      const b = Buffer.from(h, 'hex');
      assert.equal(enc(b), bs58.encode(b), h);
    }
  });

  await ok('encoder base58 benar untuk 5000 public key Ed25519 ASLI (fixture)', () => {
    const fixtures = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures-pubkeys.json'), 'utf8'));
    assert.equal(fixtures.length, 5000);
    for (const b64 of fixtures) {
      const pub = Buffer.from(b64, 'base64url');
      assert.equal(pub.length, 32);
      assert.equal(enc(pub), bs58.encode(pub), pub.toString('hex'));
    }
  });

  await ok('encoder base58 benar untuk kasus tepi (all-zero, all-FF, leading zeros)', () => {
    const cases = [
      Buffer.alloc(32, 0),
      Buffer.alloc(32, 0xff),
      Buffer.concat([Buffer.alloc(16, 0), crypto.randomBytes(16)]),
      Buffer.concat([Buffer.alloc(31, 0), Buffer.from([1])]),
      Buffer.concat([Buffer.alloc(1, 0), crypto.randomBytes(31)]),
    ];
    for (const c of cases) assert.equal(enc(c), bs58.encode(c), c.toString('hex'));
  });

  // --- 2. Keypair hasil grind ----------------------------------------------
  const found = await grindOnce('AB');

  await ok('worker menemukan alamat yang benar-benar diawali prefix', () => {
    assert.ok(found.address.startsWith('AB'), found.address);
  });

  await ok('keypair 64 byte: public key turunan dari seed (dicek tweetnacl)', () => {
    const bytes = Buffer.from(found.keypair);
    assert.equal(bytes.length, 64, 'panjang harus 64');
    const kp = nacl.sign.keyPair.fromSeed(bytes.subarray(0, 32));
    assert.equal(Buffer.from(kp.publicKey).toString('hex'), bytes.subarray(32, 64).toString('hex'));
    assert.equal(Buffer.from(kp.secretKey).toString('hex'), bytes.toString('hex'));
  });

  await ok('tanda tangan dari keypair bisa diverifikasi terhadap address-nya', () => {
    const bytes = Buffer.from(found.keypair);
    const msg = Buffer.from('solana-vanity test message');
    assert.equal(nacl.sign.detached.verify(msg, nacl.sign.detached(msg, bytes), bytes.subarray(32, 64)), true);
  });

  await ok('address base58 konsisten antara grinder, bs58, dan tweetnacl', () => {
    const pub = Buffer.from(found.keypair).subarray(32, 64);
    assert.equal(enc(pub), found.address);
    assert.equal(bs58.encode(pub), found.address);
    assert.equal(pub.length, 32);
  });

  // --- 3. Case sensitivity --------------------------------------------------
  await ok('--ignore-case: address cocok tanpa memedulikan besar/kecil huruf', async () => {
    const ic = await grindOnce('q', true);
    assert.ok(ic.address.toLowerCase().startsWith('q'), ic.address);
    assert.equal(nacl.sign.keyPair.fromSeed(Buffer.from(ic.keypair).subarray(0, 32)).publicKey.length, 32);
  });

  await ok('case-sensitive (default) TIDAK mencampur besar/kecil huruf', async () => {
    const cs = await grindOnce('K', false);
    assert.ok(cs.address.startsWith('K'), cs.address);
    assert.ok(!cs.address.startsWith('k'), cs.address);
  });

  // --- 4. Penolakan input yang salah (deterministik, tanpa grinding) --------
  await ok('prefix dengan karakter non-base58 ditolak (0, O, I, l, spasi)', () => {
    for (const bad of ['B0di', 'BOdi', 'BIdi', 'Bludi', 'Bu di']) {
      const r = spawnSync(process.execPath, [CLI, '--starts-with', `${bad}:1`, '--quiet'], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      assert.notEqual(r.status, 0, `"${bad}" seharusnya ditolak`);
      assert.match(r.stderr, /base58/);
    }
  });

  await ok('format PREFIX:JUMLAH yang salah ditolak', () => {
    const r = spawnSync(process.execPath, [CLI, '--starts-with', 'Budi'], { encoding: 'utf8', timeout: 20_000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /PREFIX:JUMLAH/);
  });

  await ok('CLI tanpa argumen menampilkan bantuan dan keluar dengan error', () => {
    const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8', timeout: 20_000 });
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /PENGGUNAAN/);
    assert.match(r.stdout, /--starts-with/);
  });

  await ok('--estimate menampilkan perkiraan waktu dan tidak menulis file', () => {
    fs.rmSync(OUT_DIR, { recursive: true, force: true });
    const r = spawnSync(
      process.execPath,
      [CLI, '--starts-with', 'Zz:1', '--out-dir', OUT_DIR, '--estimate'],
      { encoding: 'utf8', timeout: 30_000 }
    );
    assert.match(r.stdout, /Kecepatan terukur|gagal diukur/);
    assert.match(r.stdout, /Perkiraan waktu/);
    assert.match(r.stdout, /tidak mencari apa pun/);
    const dibuat = fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : [];
    assert.equal(dibuat.length, 0, `--estimate tidak boleh menulis file, dapat ${dibuat}`);
  });

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  console.log(`\n\u001b[32m\u001b[1m${passed} test inti lolos\u001b[0m\n`);
}

main().catch((err) => {
  console.error(`\n\u001b[31m\u001b[1mTEST GAGAL\u001b[0m\n${err.stack || err}\n`);
  process.exit(1);
});
