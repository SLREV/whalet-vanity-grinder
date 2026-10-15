/**
 * grinder-core - aturan bersama CLI dan aplikasi Android.
 *
 * Isinya hanya logika murni (tanpa fs, tanpa worker_threads, tanpa crypto)
 * supaya file yang sama bisa di-require Node dan di-importScripts di Web
 * Worker. Dengan begitu CLI dan app tidak mungkin beda perilaku soal validasi
 * prefix, estimasi kesulitan, dan pencocokan address.
 *
 * UMD: CommonJS / window.SolanaVanity.Core / self.SolanaVanity.Core
 */
(function (root, factory) {
  var base58;
  if (typeof module === 'object' && module.exports) base58 = require('./base58.js');
  else base58 = root.SolanaVanity.Base58;
  var api = factory(base58);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.SolanaVanity = root.SolanaVanity || {};
  root.SolanaVanity.Core = api;
})(typeof self !== 'undefined' ? self : this, function (Base58) {
  'use strict';

  var ALPHABET = Base58.ALPHABET;

  // Karakter yang sering tertukar -> saran pengganti (sama dengan CLI).
  var CONFUSABLE = { '0': 'o', O: 'o', I: 'i', l: 'L' };

  var MAX_PREFIX_LENGTH = 44;

  /** Karakter non-base58 yang ada di prefix (unik, urut kemunculan). */
  function invalidChars(prefix) {
    var seen = {};
    var bad = [];
    for (var i = 0; i < prefix.length; i++) {
      var c = prefix[i];
      if (ALPHABET.indexOf(c) === -1 && !seen[c]) {
        seen[c] = true;
        bad.push(c);
      }
    }
    return bad;
  }

  /** Ganti 0/O/I/l dengan saran yang valid. */
  function suggest(prefix) {
    return prefix.replace(/[0OIl]/g, function (c) {
      return CONFUSABLE[c] || c;
    });
  }

  /**
   * Validasi prefix.
   * @returns {{ok:true,prefix:string}|{ok:false,reason:'kosong'|'kepanjangan'|'karakter',message:string,suggestion?:string}}
   */
  function validatePrefix(prefix) {
    if (typeof prefix !== 'string' || prefix.length === 0) {
      return { ok: false, reason: 'kosong', message: 'Prefix tidak boleh kosong.' };
    }
    if (prefix.length > MAX_PREFIX_LENGTH) {
      return {
        ok: false,
        reason: 'kepanjangan',
        message: 'Prefix terlalu panjang (maksimal ' + MAX_PREFIX_LENGTH + ' karakter).',
      };
    }
    var bad = invalidChars(prefix);
    if (bad.length > 0) {
      var detail = bad
        .map(function (c) {
          var code = c.codePointAt(0);
          var note = code < 32 || code === 127 ? ' (karakter kontrol/spasi)' : '';
          var fix = CONFUSABLE[c] ? " -> pakai '" + CONFUSABLE[c] + "'" : '';
          return "'" + c + "'" + note + fix;
        })
        .join(', ');
      return {
        ok: false,
        reason: 'karakter',
        message: 'Karakter tidak ada di base58: ' + detail,
        suggestion: suggest(prefix),
      };
    }
    return { ok: true, prefix: prefix };
  }

  /**
   * Rata-rata percobaan sampai ketemu.
   * 58^panjang prefix, dibagi 2^(jumlah huruf) kalau ignore-case.
   */
  function estimateAttempts(prefix, ignoreCase) {
    var letters = 0;
    for (var i = 0; i < prefix.length; i++) {
      if (/[a-zA-Z]/.test(prefix[i])) letters++;
    }
    return Math.pow(58, prefix.length) / (ignoreCase ? Math.pow(2, letters) : 1);
  }

  /** Prefix cocok dengan address? */
  function matches(address, prefix, ignoreCase) {
    if (!ignoreCase) return address.indexOf(prefix) === 0;
    return address.toLowerCase().indexOf(prefix.toLowerCase()) === 0;
  }

  /**
   * Peringkat kesulitan untuk UI. Ambang dipilih supaya jujur: di HP
   * kecepatan nyata biasanya 3.000-20.000 key/detik per thread.
   */
  function difficulty(prefix, ignoreCase) {
    var n = estimateAttempts(prefix, ignoreCase);
    if (n <= 5e4) return { level: 'mudah', attempts: n };
    if (n <= 2e6) return { level: 'sedang', attempts: n };
    if (n <= 5e7) return { level: 'berat', attempts: n };
    return { level: 'sangat berat', attempts: n };
  }

  function humanDuration(ms) {
    if (!isFinite(ms) || ms <= 0) return 'kurang dari 1 detik';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(s < 10 ? 1 : 0) + ' detik';
    var m = s / 60;
    if (m < 60) return m.toFixed(1) + ' menit';
    var h = m / 60;
    if (h < 48) return h.toFixed(1) + ' jam';
    return (h / 24).toFixed(1) + ' hari';
  }

  function humanTime(sec) {
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    return [h ? h + 'j' : '', m ? m + 'm' : '', s + 'd'].filter(Boolean).join(' ');
  }

  function formatNumber(n) {
    try {
      return Math.round(n).toLocaleString('id-ID');
    } catch (e) {
      return String(Math.round(n));
    }
  }

  /** "PREFIX:JUMLAH" -> {prefix,count}. Null kalau formatnya salah. */
  function parseTarget(raw) {
    if (typeof raw !== 'string') return null;
    var idx = raw.lastIndexOf(':');
    if (idx === -1) return null;
    var prefix = raw.slice(0, idx);
    var count = Number(raw.slice(idx + 1));
    if (!prefix || !Number.isInteger(count) || count < 1) return null;
    return { prefix: prefix, count: count };
  }

  /**
   * Keypair 64 byte -> objek siap pakai.
   * @param {Uint8Array|number[]} keypair 32 byte secret + 32 byte public
   */
  function describeKeypair(keypair) {
    var bytes = keypair instanceof Uint8Array ? keypair : new Uint8Array(keypair);
    if (bytes.length !== 64) throw new Error('keypair harus 64 byte, dapat ' + bytes.length);
    var publicKey = bytes.slice(32, 64);
    return {
      secretKey: bytes.slice(0, 32),
      publicKey: publicKey,
      address: Base58.encode32(publicKey),
      json: '[' + Array.prototype.join.call(bytes, ',') + ']',
      keypair: Array.prototype.slice.call(bytes),
    };
  }

  return {
    ALPHABET: ALPHABET,
    CONFUSABLE: CONFUSABLE,
    MAX_PREFIX_LENGTH: MAX_PREFIX_LENGTH,
    validatePrefix: validatePrefix,
    invalidChars: invalidChars,
    suggest: suggest,
    estimateAttempts: estimateAttempts,
    matches: matches,
    difficulty: difficulty,
    humanDuration: humanDuration,
    humanTime: humanTime,
    formatNumber: formatNumber,
    parseTarget: parseTarget,
    describeKeypair: describeKeypair,
  };
});
