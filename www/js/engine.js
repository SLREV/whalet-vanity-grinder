/**
 * engine.js - mesin pembuat keypair untuk aplikasi Android.
 *
 * Dua mesin, dipilih otomatis saat runtime:
 *
 *  1. "webcrypto" (UTAMA) - crypto.subtle.generateKey({name:'Ed25519'}).
 *     Kriptonya jalan di kode native Chromium/BoringSSL, bukan JavaScript,
 *     jadi jauh lebih cepat dan hemat baterai. Hasilnya di-export sebagai JWK:
 *     `d` = seed 32 byte, `x` = public key 32 byte. Ini pipeline yang SAMA
 *     dengan yang dipakai CLI (bin/grind.js) lewat privateKey.export('jwk').
 *
 *  2. "js" (CADANGAN) - TweetNaCl (public domain, app/vendor/nacl-fast.min.js).
 *     Dipakai hanya kalau WebView-nya terlalu tua untuk Ed25519 di WebCrypto.
 *     Lebih lambat, tapi tetap benar dan tetap 100% offline.
 *
 * Keduanya menghasilkan format yang identik: Uint8Array 64 byte
 * [secret 32 byte | public 32 byte] = format file solana-keygen.
 *
 * UMD: CommonJS (untuk test) / self.SolanaVanity.Engine (untuk worker).
 */
(function (root, factory) {
  var SV = root.SolanaVanity || (root.SolanaVanity = {});
  var api = factory(SV.Base58, root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  SV.Engine = api;
})(typeof self !== 'undefined' ? self : this, function (Base58, root) {
  'use strict';

  // -----------------------------------------------------------------------
  // base64url -> 32 byte (tanpa alokasi berlebihan, sama seperti di CLI)
  // -----------------------------------------------------------------------
  var B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var LOOKUP = new Int16Array(128).fill(-1);
  for (var i = 0; i < 64; i++) LOOKUP[B64U.charCodeAt(i)] = i;

  function b64urlTo32Bytes(s) {
    var out = new Uint8Array(32);
    var o = 0;
    for (var i = 0; i < 40; i += 4) {
      var n =
        (LOOKUP[s.charCodeAt(i)] << 18) |
        (LOOKUP[s.charCodeAt(i + 1)] << 12) |
        (LOOKUP[s.charCodeAt(i + 2)] << 6) |
        LOOKUP[s.charCodeAt(i + 3)];
      out[o++] = (n >> 16) & 255;
      out[o++] = (n >> 8) & 255;
      out[o++] = n & 255;
    }
    // 4 karakter terakhir = 3 byte (43 char base64url = 32 byte).
    var tail =
      (LOOKUP[s.charCodeAt(40)] << 12) | (LOOKUP[s.charCodeAt(41)] << 6) | LOOKUP[s.charCodeAt(42)];
    out[30] = (tail >> 10) & 255;
    out[31] = (tail >> 2) & 255;
    return out;
  }

  function cryptoObj() {
    if (typeof crypto !== 'undefined' && crypto) return crypto;
    if (root && root.crypto) return root.crypto;
    return null;
  }

  // -----------------------------------------------------------------------
  // Deteksi mesin
  // -----------------------------------------------------------------------
  /** Nama algoritma Ed25519 yang benar-benar diterima WebView ini. */
  function detectWebCrypto() {
    var c = cryptoObj();
    if (!c || !c.subtle || typeof c.subtle.generateKey !== 'function') return Promise.resolve(null);
    var names = ['Ed25519', 'ED25519'];
    var idx = 0;
    function tryNext() {
      if (idx >= names.length) return Promise.resolve(null);
      var name = names[idx++];
      return c.subtle
        .generateKey({ name: name }, true, ['sign'])
        .then(function (k) {
          return c.subtle.exportKey('jwk', k.privateKey);
        })
        .then(function (jwk) {
          if (jwk && typeof jwk.x === 'string' && typeof jwk.d === 'string') return name;
          return tryNext();
        })
        .catch(tryNext);
    }
    return tryNext();
  }

  function hasNacl() {
    return !!(root.nacl && root.nacl.sign && root.nacl.sign.keyPair);
  }

  /**
   * @returns {Promise<{name:'webcrypto'|'js', engine:object}>}
   */
  function create(concurrency) {
    return detectWebCrypto().then(function (name) {
      if (name) return { name: 'webcrypto', engine: webCryptoEngine(name, concurrency) };
      if (hasNacl()) return { name: 'js', engine: jsEngine() };
      throw new Error(
        'Perangkat ini tidak mendukung Ed25519 (WebCrypto lama, dan TweetNaCl tidak termuat).'
      );
    });
  }

  // -----------------------------------------------------------------------
  // Mesin 1: WebCrypto native
  // -----------------------------------------------------------------------
  function webCryptoEngine(algoName, concurrency) {
    var subtle = cryptoObj().subtle;
    var n = Math.max(1, concurrency || 32);

    function one() {
      return subtle.generateKey({ name: algoName }, true, ['sign']).then(function (k) {
        return subtle.exportKey('jwk', k.privateKey).then(function (jwk) {
          var pub = b64urlTo32Bytes(jwk.x);
          var seed = b64urlTo32Bytes(jwk.d);
          var keypair = new Uint8Array(64);
          keypair.set(seed, 0);
          keypair.set(pub, 32);
          return { keypair: keypair, address: Base58.encode32(pub) };
        });
      });
    }

    return {
      name: 'webcrypto',
      concurrency: n,
      /** Sekali jalan menghasilkan n kandidat sekaligus (menutup biaya async). */
      nextBatch: function () {
        var jobs = new Array(n);
        for (var i = 0; i < n; i++) jobs[i] = one();
        return Promise.all(jobs);
      },
      one: one,
    };
  }

  // -----------------------------------------------------------------------
  // Mesin 2: TweetNaCl murni JavaScript (cadangan)
  // -----------------------------------------------------------------------
  function jsEngine() {
    var nacl = root.nacl;
    var c = cryptoObj();
    var seed = new Uint8Array(32);

    function one() {
      c.getRandomValues(seed);
      var kp = nacl.sign.keyPair.fromSeed(seed);
      var keypair = new Uint8Array(64);
      keypair.set(seed, 0);
      keypair.set(kp.publicKey, 32);
      return { keypair: keypair, address: Base58.encode32(kp.publicKey) };
    }

    return {
      name: 'js',
      concurrency: 1,
      nextBatch: function () {
        // Ukuran batch kecil supaya UI tetap responsif di mesin lambat ini.
        var out = new Array(50);
        for (var i = 0; i < out.length; i++) out[i] = one();
        return Promise.resolve(out);
      },
      one: one,
    };
  }

  return {
    b64urlTo32Bytes: b64urlTo32Bytes,
    detectWebCrypto: detectWebCrypto,
    hasNacl: hasNacl,
    create: create,
    webCryptoEngine: webCryptoEngine,
    jsEngine: jsEngine,
  };
});
