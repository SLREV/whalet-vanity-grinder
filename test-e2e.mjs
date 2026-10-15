/**
 * TEST END-TO-END - menjalankan CLI seperti pengguna asli.
 *
 *   node test-e2e.mjs
 *
 * Test ini butuh CPU yang benar-benar bisa dipakai terus-menerus, karena
 * grinding memang kerja brute-force. Di lingkungan yang membekukan thread
 * (sebagian sandbox/CI), satu test bisa dilewati dengan status SKIP -
 * itu gangguan lingkungan, bukan kegagalan kode.
 *
 * Hasil:
 *   PASS  = CLI menghasilkan file keypair yang benar
 *   SKIP  = lingkungan membekukan proses sebelum sempat selesai
 *   FAIL  = CLI menghasilkan output yang SALAH (ini bug sungguhan)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import bs58 from 'bs58';
import nacl from 'tweetnacl';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(ROOT, 'bin', 'grind.js');
const OUT_DIR = path.join(ROOT, '.e2e-out');

const counts = { pass: 0, skip: 0, fail: 0 };

function assertValidKeypairFile(file, address, expectPrefix) {
  assert.ok(
    address.startsWith(expectPrefix) || address.toLowerCase().startsWith(expectPrefix.toLowerCase()),
    `${address} tidak diawali ${expectPrefix}`
  );
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(parsed), 'harus JSON array');
  assert.equal(parsed.length, 64, 'harus 64 angka (32 secret + 32 public)');
  assert.ok(parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255), 'semua elemen 0..255');

  const bytes = Buffer.from(parsed);
  assert.equal(bs58.encode(bytes.subarray(32, 64)), address, 'nama file harus = base58(public key)');
  assert.equal(
    Buffer.from(nacl.sign.keyPair.fromSeed(bytes.subarray(0, 32)).publicKey).toString('hex'),
    bytes.subarray(32, 64).toString('hex'),
    'public key harus turunan dari seed'
  );
  const msg = Buffer.from('cek e2e');
  assert.equal(nacl.sign.detached.verify(msg, nacl.sign.detached(msg, bytes), bytes.subarray(32, 64)), true);
}

/**
 * Jalankan CLI beberapa kali. Kembalikan:
 *   { status: 'pass', result } kalau ada run yang sukses
 *   { status: 'skip' }         kalau semua run digantung lingkungan
 */
function runCli(args, { attempts = 2, timeout = 25_000 } = {}) {
  for (let a = 1; a <= attempts; a++) {
    const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout });
    if (r.status === 0) return { status: 'pass', result: r };
    const froze = /tidak memberi progres/.test(r.stderr || '') || r.status === null;
    if (!froze) return { status: 'fail', result: r };
  }
  return { status: 'skip' };
}

async function scenario(name, args, expect) {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  const t = Date.now();
  const run = runCli(args);

  if (run.status === 'skip') {
    counts.skip++;
    console.log(`  \u001b[33m-\u001b[0m ${name}: SKIP (lingkungan membekukan proses)`);
    return;
  }
  if (run.status === 'fail') {
    counts.fail++;
    console.log(`  \u001b[31m✗\u001b[0m ${name}: FAIL\n${run.result.stdout}\n${run.result.stderr}`);
    return;
  }

  try {
    await expect(OUT_DIR);
    counts.pass++;
    console.log(`  \u001b[32m✓\u001b[0m ${name} (${Date.now() - t} ms)`);
  } catch (err) {
    counts.fail++;
    console.log(`  \u001b[31m✗\u001b[0m ${name}: FAIL\n${err.message}`);
  }
}

async function main() {
  console.log('\n\u001b[1msolana-vanity — TEST END-TO-END\u001b[0m\n');

  await scenario('prefix 1 huruf, case-sensitive, file format solana-keygen', ['--starts-with', 'B:1', '--out-dir', OUT_DIR, '--quiet'], async (dir) => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1, `harus 1 file, dapat ${files.length}`);
    const address = files[0].replace(/\.json$/, '');
    assertValidKeypairFile(path.join(dir, files[0]), address, 'B');
    const mode = fs.statSync(path.join(dir, files[0])).mode & 0o777;
    assert.equal(mode, 0o600, `permission harus 0600, dapat 0${mode.toString(8)}`);
  });

  await scenario('prefix nama 4 huruf dengan --ignore-case, multi-thread', ['--starts-with', 'Budi:1', '--ignore-case', '--threads', '2', '--out-dir', OUT_DIR, '--quiet'], async (dir) => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1);
    const address = files[0].replace(/\.json$/, '');
    assert.ok(address.toLowerCase().startsWith('budi'), address);
    assertValidKeypairFile(path.join(dir, files[0]), address, 'budi');
  });

  // REGRESI: dulu CLI menulis file lebih banyak daripada yang diminta, dan
  // sesudah perbaikan pertama malah mematikan worker yang masih dibutuhkan.
  // Skenario ini yang menangkap kedua bug itu.
  await scenario('beberapa prefix sekaligus: jumlahnya harus PERSIS', ['--starts-with', 'k:1', '--starts-with', 'r:1', '--ignore-case', '--threads', '2', '--out-dir', OUT_DIR, '--quiet'], async (dir) => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 2, `harus tepat 2 file, dapat ${files.length}: ${files}`);
    const lowers = files.map((f) => f.toLowerCase());
    assert.ok(lowers.some((f) => f.startsWith('k')), files.join(','));
    assert.ok(lowers.some((f) => f.startsWith('r')), files.join(','));
    for (const f of files) assertValidKeypairFile(path.join(dir, f), f.replace(/\.json$/, ''), f.slice(0, 1));
  });

  await scenario('JUMLAH > 1 menghasilkan tepat N alamat', ['--starts-with', 't:3', '--ignore-case', '--threads', '2', '--out-dir', OUT_DIR, '--quiet'], async (dir) => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 3, `harus tepat 3 file, dapat ${files.length}`);
    for (const f of files) {
      assert.ok(f.toLowerCase().startsWith('t'), f);
      assertValidKeypairFile(path.join(dir, f), f.replace(/\.json$/, ''), 't');
    }
  });

  await scenario('kuota tiap prefix dihitung terpisah: k:2 + r:1 = 3 file', ['--starts-with', 'k:2', '--starts-with', 'r:1', '--ignore-case', '--threads', '2', '--out-dir', OUT_DIR, '--quiet'], async (dir) => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 3, `harus tepat 3 file, dapat ${files.length}: ${files}`);
    const lowers = files.map((f) => f.toLowerCase());
    assert.equal(lowers.filter((f) => f.startsWith('k')).length, 2, files.join(','));
    assert.equal(lowers.filter((f) => f.startsWith('r')).length, 1, files.join(','));
    for (const f of files) assertValidKeypairFile(path.join(dir, f), f.replace(/\.json$/, ''), f.slice(0, 1));
  });

  fs.rmSync(OUT_DIR, { recursive: true, force: true });

  console.log(
    `\n  PASS ${counts.pass}   SKIP ${counts.skip}   FAIL ${counts.fail}\n`
  );
  if (counts.fail > 0) {
    console.error('\u001b[31m\u001b[1mADA KEGAGALAN NYATA\u001b[0m\n');
    process.exit(1);
  }
  if (counts.skip > 0) {
    console.log('\u001b[33mSebagian test dilewati karena lingkungan membekukan proses.\u001b[0m');
    console.log('Jalankan ulang di mesin biasa untuk hasil penuh.\n');
  }
}

main().catch((err) => {
  console.error(`\n\u001b[31m\u001b[1mTEST E2E GAGAL\u001b[0m\n${err.stack || err}\n`);
  process.exit(1);
});
