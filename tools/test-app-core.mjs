#!/usr/bin/env node
/**
 * Uji diferensial untuk core yang dipakai aplikasi web/Android.
 *
 * Memeriksa encoder base58 terhadap bs58, decoder base64url yang menerima
 * JWK WebCrypto, lalu membangun sejumlah keypair Ed25519 WebCrypto dan
 * membandingkan seed -> public key dengan node:crypto.
 */
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, randomBytes, sign, verify, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import bs58 from 'bs58';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const Base58 = require('../src/core/base58.js');
const Core = require('../src/core/grinder-core.js');

// Jalankan UMD app/engine.js sebagai browser Worker dengan WebCrypto Node.
const sandbox = {
  self: { SolanaVanity: { Base58 } },
  crypto: webcrypto,
  console,
};
vm.createContext(sandbox);
vm.runInContext(readFileSync(path.join(ROOT, 'app/js/engine.js'), 'utf8'), sandbox, {
  filename: 'app/js/engine.js',
});
const Engine = sandbox.self.SolanaVanity.Engine;

let passed = 0;
async function test(name, fn) {
  const t0 = Date.now();
  await fn();
  passed++;
  console.log(`  \u001b[32m✓\u001b[0m ${name} (${Date.now() - t0} ms)`);
}

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function nodePublicKeyFromSeed(seed) {
  assert.equal(seed.length, 32);
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const der = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  return { privateKey, publicKey: Buffer.from(der).subarray(-32) };
}

async function main() {
  console.log('\nTest core aplikasi VanitySol…\n');

  await test('base58 encode/decode sama dengan bs58 untuk byte acak dan kasus nol', () => {
    const cases = [
      Buffer.alloc(0),
      Buffer.alloc(1),
      Buffer.alloc(31),
      Buffer.alloc(32),
      Buffer.alloc(33),
      Buffer.alloc(64),
      Buffer.from([0, 0, 0, 1]),
      Buffer.from([0, 1, 0, 255]),
      Buffer.alloc(32, 255),
    ];
    for (let i = 0; i < 512; i++) {
      const size = i % 65;
      cases.push(randomBytes(size));
    }
    for (const input of cases) {
      const actual = Base58.encode(input);
      assert.equal(actual, bs58.encode(input), `base58 encode ${input.toString('hex')}`);
      if (input.length > 0) {
        assert.deepEqual(Buffer.from(Base58.decode(actual)), input, `base58 round-trip ${actual}`);
      } else {
        assert.equal(actual, '');
      }
    }
    assert.equal(Base58.decode('1'.repeat(32)).length, 32);
    assert.deepEqual(Buffer.from(Base58.decode('1'.repeat(32))), Buffer.alloc(32));
    assert.equal(Base58.decode('0OIl'), null);
  });

  await test('b64urlTo32Bytes mengembalikan 32 byte persis', () => {
    for (let i = 0; i < 256; i++) {
      const expected = randomBytes(32);
      const actual = Engine.b64urlTo32Bytes(expected.toString('base64url'));
      assert.deepEqual(Buffer.from(actual), expected);
    }
  });

  const webCryptoAlgorithm = await Engine.detectWebCrypto();
  if (!webCryptoAlgorithm) {
    console.log('  \u001b[33m-\u001b[0m WebCrypto Ed25519 tidak didukung runtime Node ini: SKIP diferensial WebCrypto');
  } else {
    await test('deteksi memilih WebCrypto; Ed25519 menghasilkan keypair Solana 64 byte yang cocok dengan node:crypto', async () => {
      const selected = await Engine.create(12);
      assert.equal(selected.name, 'webcrypto');
      const engine = selected.engine;
      const batch = await engine.nextBatch();
      assert.equal(batch.length, 12);

      for (const candidate of batch) {
        const bytes = Buffer.from(candidate.keypair);
        assert.equal(bytes.length, 64);
        const seed = bytes.subarray(0, 32);
        const publicBytes = bytes.subarray(32, 64);
        const { privateKey, publicKey } = nodePublicKeyFromSeed(seed);

        assert.deepEqual(publicBytes, publicKey, 'public key harus turunan seed JWK.d');
        assert.equal(candidate.address, bs58.encode(publicKey), 'alamat harus base58(public key)');
        assert.deepEqual(Buffer.from(Base58.decode(candidate.address)), publicKey);

        const described = Core.describeKeypair(candidate.keypair);
        assert.equal(described.address, candidate.address);
        assert.equal(described.json, JSON.stringify(Array.from(bytes)));
        assert.equal(described.keypair.length, 64);

        const message = Buffer.from('VanitySol: uji Ed25519');
        const signature = sign(null, message, privateKey);
        const publicDer = createPublicKey(privateKey);
        assert.equal(verify(null, message, publicDer, signature), true);
      }
    });
  }

  await test('fallback TweetNaCl dari vendor menghasilkan keypair yang sama validnya', async () => {
    const fallbackSandbox = {
      self: { SolanaVanity: { Base58 } },
      crypto: {
        getRandomValues(bytes) {
          bytes.set(randomBytes(bytes.length));
          return bytes;
        },
      },
      console,
    };
    vm.createContext(fallbackSandbox);
    vm.runInContext(readFileSync(path.join(ROOT, 'app/vendor/nacl-fast.min.js'), 'utf8'), fallbackSandbox, {
      filename: 'app/vendor/nacl-fast.min.js',
    });
    vm.runInContext(readFileSync(path.join(ROOT, 'app/js/engine.js'), 'utf8'), fallbackSandbox, {
      filename: 'app/js/engine.js (fallback)',
    });

    const selected = await fallbackSandbox.self.SolanaVanity.Engine.create(1);
    assert.equal(selected.name, 'js');
    const batch = await selected.engine.nextBatch();
    assert.equal(batch.length, 50);
    for (const candidate of batch.slice(0, 4)) {
      const bytes = Buffer.from(candidate.keypair);
      assert.equal(bytes.length, 64);
      const { publicKey } = nodePublicKeyFromSeed(bytes.subarray(0, 32));
      assert.deepEqual(bytes.subarray(32), publicKey);
      assert.equal(candidate.address, bs58.encode(publicKey));
    }
  });

  await test('Worker browser memuat TweetNaCl/core dan mengembalikan hasil sesuai protokol', async () => {
    const messages = [];
    let finish;
    let fail;
    const completed = new Promise((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    const context = {
      crypto: webcrypto,
      console,
      setTimeout,
      clearTimeout,
      importScripts(...scripts) {
        for (const script of scripts) {
          const file = script.startsWith('core/')
            ? path.resolve(ROOT, 'src', script)
            : path.resolve(ROOT, 'app/js', script);
          vm.runInContext(readFileSync(file, 'utf8'), context, { filename: path.relative(ROOT, file) });
        }
      },
      postMessage(message) {
        messages.push(message);
        if (message.type === 'error') fail(new Error(message.message));
        if (message.type === 'done') finish();
      },
    };
    context.self = context;
    vm.createContext(context);
    vm.runInContext(readFileSync(path.join(ROOT, 'app/js/worker.js'), 'utf8'), context, {
      filename: 'app/js/worker.js',
    });
    const timer = setTimeout(() => fail(new Error('worker timeout')), 10_000);
    context.onmessage({
      data: { type: 'start', prefix: '1', count: 1, ignoreCase: false, concurrency: 8 },
    });
    try {
      await completed;
    } finally {
      clearTimeout(timer);
    }
    const found = messages.find((message) => message.type === 'found');
    assert.ok(found, 'worker harus mengirim hasil');
    assert.ok(found.address.startsWith('1'));
    assert.equal(found.keypair.length, 64);
    assert.ok(messages.some((message) => message.type === 'engine' && message.name === 'webcrypto'));
  });

  await test('aturan prefix bersama menerima Solana base58 dan memberi saran karakter', () => {
    assert.equal(Core.validatePrefix('Budi').ok, true);
    assert.equal(Core.validatePrefix('0Budi').reason, 'karakter');
    assert.equal(Core.validatePrefix('0Budi').suggestion, 'oBudi');
    assert.equal(Core.matches('Budi123', 'Bu', false), true);
    assert.equal(Core.matches('budi123', 'Bu', true), true);
    assert.equal(Core.estimateAttempts('Aa', true), 58 ** 2 / 4);
  });

  console.log(`\nHasil app core: PASS ${passed}, FAIL 0\n`);
}

main().catch((err) => {
  console.error('\nFAIL app core:', err);
  process.exitCode = 1;
});
