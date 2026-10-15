/**
 * Membuat ulang test/fixtures-pubkeys.json
 *
 *   node tools/make-fixtures.mjs [jumlah]
 *
 * Fixture berisi public key Ed25519 ASLI (bukan byte acak) supaya encoder
 * base58 diuji terhadap input yang bentuknya sama dengan yang akan ditemui
 * grinder di dunia nyata.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const N = Number(process.argv[2] || 5000);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'fixtures-pubkeys.json');

const out = [];
for (let i = 0; i < N; i++) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  out.push(privateKey.export({ format: 'jwk' }).x); // base64url, 32 byte
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`${out.length} public key ditulis ke ${OUT}`);
