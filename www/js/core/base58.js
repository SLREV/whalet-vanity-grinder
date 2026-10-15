/**
 * base58 - encoder/decoder base58 alpabet Bitcoin/Solana.
 *
 * Modul UMD: bisa dipakai sebagai
 *   - CommonJS  (Node CLI):   require('../core/base58')
 *   - <script> di browser:    window.SolanaVanity.Base58
 *   - importScripts di worker: self.SolanaVanity.Base58
 *
 * Sengaja tidak pakai bundler supaya tidak ada langkah build yang bisa
 * mengubah perilaku kode kriptonya.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SolanaVanity = root.SolanaVanity || {};
  root.SolanaVanity.Base58 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  // Lookup char -> nilai. -1 berarti bukan karakter base58.
  var LOOKUP = new Int8Array(128).fill(-1);
  for (var i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

  var OUT = new Uint8Array(128);

  /**
   * Encode tepat 32 byte -> string base58.
   *
   * PENTING - kenapa word-nya 16 bit, bukan 32 bit:
   *   Nilai antara `cur = rem * BASE + w[i]` harus tetap di bawah 2^53 supaya
   *   pembagian dan sisanya eksak dalam double. Dengan BASE = 2^16:
   *       cur maks = 57 * 65536 + 65535 = 3.801.087  (jauh di bawah 2^53)
   *   Dengan BASE = 2^32 nilainya 2,46e11 dan sisa `% 58` bisa meleset karena
   *   presisi, yang membuat loop tidak pernah berhenti. Ada test regresi untuk
   *   ini di test-core.mjs - jangan "dioptimalkan" ke 2^32.
   */
  function encode32(b) {
    var w = new Uint16Array(16);
    for (var i = 0; i < 16; i++) w[i] = (b[2 * i] << 8) | b[2 * i + 1];

    var zeros = 0;
    while (zeros < 32 && b[zeros] === 0) zeros++;

    var start = 0;
    var end = OUT.length;
    var guard = 0;

    while (start < 16) {
      if (w[start] === 0) {
        start++;
        continue;
      }
      if (++guard > 64) throw new Error('base58.encode32: iterasi melebihi batas, ada bug');
      var rem = 0;
      for (var j = start; j < 16; j++) {
        var cur = rem * 65536 + w[j];
        var q = (cur / 58) | 0;
        w[j] = q;
        rem = cur - q * 58;
      }
      OUT[--end] = rem;
      if (w[start] === 0) start++;
    }

    var s = '';
    for (var k = 0; k < zeros; k++) s += '1';
    for (var m = end; m < OUT.length; m++) s += ALPHABET[OUT[m]];
    return s;
  }

  /** Encode Uint8Array/Array panjang bebas -> string base58. */
  function encode(bytes) {
    var arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (arr.length === 32) return encode32(arr);

    var zeros = 0;
    while (zeros < arr.length && arr[zeros] === 0) zeros++;
    // Untuk input kosong atau seluruhnya nol, jangan tambahkan digit nol kedua.
    if (zeros === arr.length) return '1'.repeat(zeros);

    var digits = [0];
    for (var i = zeros; i < arr.length; i++) {
      var carry = arr[i];
      for (var j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    var out = '';
    for (var z = 0; z < zeros; z++) out += '1';
    for (var d = digits.length - 1; d >= 0; d--) out += ALPHABET[digits[d]];
    return out;
  }

  /** Decode string base58 -> Uint8Array. Null kalau ada karakter ilegal. */
  function decode(str) {
    if (typeof str !== 'string' || str.length === 0) return null;
    var zeros = 0;
    while (zeros < str.length && str[zeros] === '1') zeros++;
    // String yang hanya berisi leading-zero marker adalah tepat sebanyak itu byte nol.
    if (zeros === str.length) return new Uint8Array(zeros);
    var bytes = [0];
    for (var i = zeros; i < str.length; i++) {
      var code = str.charCodeAt(i);
      var v = code < 128 ? LOOKUP[code] : -1;
      if (v < 0) return null;
      var carry = v;
      for (var j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 255;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 255);
        carry >>= 8;
      }
    }
    var out = new Uint8Array(zeros + bytes.length);
    for (var k = 0; k < bytes.length; k++) out[zeros + k] = bytes[bytes.length - 1 - k];
    return out;
  }

  function isValid(str) {
    if (typeof str !== 'string' || str.length === 0) return false;
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c >= 128 || LOOKUP[c] < 0) return false;
    }
    return true;
  }

  return {
    ALPHABET: ALPHABET,
    encode: encode,
    encode32: encode32,
    decode: decode,
    isValid: isValid,
  };
});
