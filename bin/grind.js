#!/usr/bin/env node
'use strict';
/**
 * solana-vanity  -  generator vanity address Solana (prefix nama sendiri)
 *
 * Mengikuti perilaku & format resmi `solana-keygen grind` (Agave CLI):
 *   - flag  --starts-with PREFIX:COUNT  dan  --ignore-case
 *   - output berupa file  <ADDRESS>.json  berisi JSON array 64 angka
 *     (32 byte secret + 32 byte public), file permission 0600
 *
 * Referensi dokumentasi resmi ada di README.md.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_PATH = path.join(__dirname, '..', 'src', 'grinder.worker.js');
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// Karakter yang sering tertukar -> saran pengganti
const CONFUSABLE = {
  '0': 'o',
  O: 'o',
  I: 'i',
  l: 'L',
};

function fail(msg) {
  process.stderr.write(`\n\u001b[31m✗ ${msg}\u001b[0m\n\n`);
  process.exit(1);
}

function help() {
  process.stdout.write(`
solana-vanity - buat alamat Solana yang diawali nama/prefix pilihanmu

PENGGUNAAN
  node bin/grind.js --starts-with <PREFIX:JUMLAH> [opsi]

OPSI
  --starts-with PREFIX:JUMLAH   Cari JUMLAH alamat yang diawali PREFIX.
                                Boleh ditulis beberapa kali sekaligus.
  --ignore-case                 Cocokkan tanpa memedulikan huruf besar/kecil
                                (default: case-sensitive, sama seperti solana-keygen)
  --threads N                   Jumlah thread (default: semua core CPU)
  --out-dir DIR                 Folder output (default: ./vanity-keys)
  --overwrite                   Izinkan menimpa file yang sudah ada
  --estimate                    Ukur kecepatan CPU-mu dan tampilkan perkiraan
                                waktu, lalu keluar TANPA mencari. Pakai ini
                                dulu sebelum grinding lama.
  --print-keys                  Tampilkan juga base58 secret key di layar
                                (JANGAN dipakai kalau layar direkam/shared)
  --quiet                       Tanpa baris progres
  -h, --help                    Tampilkan bantuan ini

CONTOH
  node bin/grind.js --starts-with Budi:1
  node bin/grind.js --starts-with Budi:3 --ignore-case --out-dir ./kunci
  node bin/grind.js --starts-with Budi:1 --starts-with BUDI:1

CATATAN
  PREFIX hanya boleh memakai karakter base58:
  ${B58_ALPHABET}
  Karakter 0 (nol), O (huruf O besar), I (huruf I besar), dan l (huruf L kecil)
  TIDAK ADA di base58.

  Perkiraan rata-rata percobaan = 58^panjang_prefix
  (dibagi 2^jumlah_huruf kalau --ignore-case dipakai).
`);
}

// ---------------------------------------------------------------------------
// Parsing argumen
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = {
    targets: [],
    ignoreCase: false,
    threads: Math.max(1, os.cpus().length),
    outDir: path.resolve('vanity-keys'),
    overwrite: false,
    printKeys: false,
    quiet: false,
    estimate: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '-h':
      case '--help':
        help();
        process.exit(0);
        break;
      case '--starts-with': {
        const raw = argv[++i];
        if (!raw) fail('--starts-with butuh nilai, contoh: --starts-with Budi:1');
        const idx = raw.lastIndexOf(':');
        if (idx === -1) fail(`Format salah: "${raw}". Pakai PREFIX:JUMLAH, contoh: ${raw}:1`);
        const prefix = raw.slice(0, idx);
        const count = Number(raw.slice(idx + 1));
        if (!prefix) fail('PREFIX tidak boleh kosong.');
        if (!Number.isInteger(count) || count < 1) fail(`JUMLAH harus angka >= 1 (dapat "${raw.slice(idx + 1)}").`);
        validatePrefix(prefix);
        opts.targets.push({ prefix, count });
        break;
      }
      case '--ignore-case':
        opts.ignoreCase = true;
        break;
      case '--threads': {
        const n = Number(argv[++i]);
        if (!Number.isInteger(n) || n < 1) fail('--threads butuh angka >= 1');
        opts.threads = Math.min(n, Math.max(1, os.cpus().length * 4));
        break;
      }
      case '--out-dir':
        opts.outDir = path.resolve(argv[++i] || '');
        break;
      case '--overwrite':
        opts.overwrite = true;
        break;
      case '--estimate':
        opts.estimate = true;
        break;
      case '--print-keys':
        opts.printKeys = true;
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      default:
        if (a === '-') break;
        fail(`Opsi tidak dikenal: ${a}\nJalankan dengan --help untuk melihat pemakaian.`);
    }
  }

  if (opts.targets.length === 0) {
    help();
    fail('Belum ada target. Contoh: node bin/grind.js --starts-with Budi:1');
  }
  return opts;
}

function validatePrefix(prefix) {
  if (prefix.length > 44) fail('PREFIX terlalu panjang (maksimal 44 karakter).');
  const bad = [...new Set([...prefix].filter((c) => !B58_ALPHABET.includes(c)))];
  if (bad.length > 0) {
    const detail = bad
      .map((c) => {
        const code = c.codePointAt(0);
        const note = code < 32 || code === 127 ? ' (karakter kontrol/spasi)' : '';
        const fix = CONFUSABLE[c] ? ` -> pakai '${CONFUSABLE[c]}'` : '';
        return `  '${c}'${note}${fix}`;
      })
      .join('\n');
    fail(
      `PREFIX "${prefix}" memakai karakter yang tidak ada di base58:\n${detail}\n\n` +
        `Alamat Solana memakai base58:\n  ${B58_ALPHABET}\n\n` +
        `Contoh perbaikan: --starts-with ${prefix.replace(/[0OIl]/g, (c) => CONFUSABLE[c])}:1`
    );
  }
}

// ---------------------------------------------------------------------------
// Base58 (untuk mencetak secret key & verifikasi akhir)
// ---------------------------------------------------------------------------
function base58Encode(buf) {
  const bytes = [...buf];
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [0];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

// ---------------------------------------------------------------------------
// Estimasi kesulitan
// ---------------------------------------------------------------------------
function estimateAttempts(prefix, ignoreCase) {
  const letters = [...prefix].filter((c) => /[a-zA-Z]/.test(c)).length;
  const variants = ignoreCase ? Math.pow(2, letters) : 1;
  return Math.pow(58, prefix.length) / variants;
}

/**
 * Ukur kecepatan CPU yang SESUNGGUHNYA di mesin ini dengan menjalankan satu
 * worker selama beberapa ratus milidetik pada prefix yang mustahil ketemu.
 * Mengembalikan keypair/detik untuk SATU thread.
 */
function measureRate(durationMs = 700) {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_PATH, {
      workerData: {
        targets: [{ prefix: '1111111111', ignoreCase: false }],
        progressMs: 50,
        progressMinKeys: 100,
      },
    });
    let last = 0;
    const timer = setTimeout(() => {
      w.terminate();
      resolve(last / (durationMs / 1000));
    }, durationMs);
    w.on('message', (m) => {
      if (m.type === 'progress') last = m.checked;
    });
    w.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function humanDuration(ms) {
  if (!isFinite(ms) || ms <= 0) return '?';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} detik`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)} menit`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(1)} jam`;
  return `${(h / 24).toFixed(1)} hari`;
}

function humanTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return [h ? `${h}j` : '', m ? `${m}m` : '', `${s}d`].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------
// Utama
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  fs.mkdirSync(opts.outDir, { recursive: true });

  const totalWanted = opts.targets.reduce((n, t) => n + t.count, 0);
  const remaining = new Map(opts.targets.map((t) => [t.prefix, t.count]));
  // Berapa worker yang saat ini sedang mencari tiap prefix. Tanpa ini, CLI bisa
  // menulis file lebih banyak daripada yang diminta (misal --starts-with Ka:1
  // --starts-with Ra:1 dengan 2 thread pernah menghasilkan 3 file).
  const assigned = new Map(opts.targets.map((t) => [t.prefix, 0]));
  const prefixes = opts.targets.map((t) => t.prefix);

  // Info kesulitan
  process.stdout.write('\n\u001b[1msolana-vanity\u001b[0m — vanity address Solana\n');
  process.stdout.write(`Mencari dengan ${opts.threads} thread untuk:\n`);
  for (const t of opts.targets) {
    const avg = estimateAttempts(t.prefix, opts.ignoreCase);
    process.stdout.write(
      `  ${t.count} pubkey yang diawali '${t.prefix}'` +
        `  (~${avg >= 1e6 ? avg.toExponential(2) : avg.toLocaleString('id-ID')} percobaan rata-rata)\n`
    );
  }
  process.stdout.write(
    opts.ignoreCase
      ? `Mode: case-INSENSITIVE (--ignore-case)\n`
      : `Mode: case-sensitive (tambahkan --ignore-case supaya jauh lebih cepat)\n`
  );
  process.stdout.write(`Output: ${opts.outDir}\n\n`);

  const workers = [];
  let checkedTotal = 0;
  let foundTotal = 0;
  const t0 = Date.now();
  let lastRender = 0;

  function render(force) {
    if (opts.quiet) return;
    const now = Date.now();
    if (!force && now - lastRender < 200) return;
    lastRender = now;
    const dt = (now - t0) / 1000;
    const rate = checkedTotal / Math.max(dt, 0.001);
    process.stderr.write(
      `\r  ${checkedTotal.toLocaleString('id-ID')} keypair dicoba | ` +
        `${Math.round(rate).toLocaleString('id-ID')} key/detik | ` +
        `${humanTime(dt)} | ditemukan ${foundTotal}/${totalWanted}   `
    );
  }

  function finish(code) {
    for (const w of workers) {
      if (!w || w._done) continue;
      w._intentional = true;
      w._done = true;
      // `w` adalah wrapper, bukan Worker asli: fungsi penghentinya ada di
      // `w.kill` (t.terminate() untuk worker thread, atau stopper mode aman).
      if (typeof w.kill === 'function') {
        try {
          w.kill();
        } catch {
          /* sudah mati, tidak masalah */
        }
      }
    }
    if (!opts.quiet) process.stderr.write('\n');
    process.exit(code);
  }

  function onFound(msg) {
    const need = remaining.get(msg.prefix) || 0;
    // Worker lain mungkin sudah lebih dulu memenuhi prefix ini. Hasil ekstra
    // dibuang, bukan ditulis, supaya jumlah file selalu sama dengan JUMLAH.
    if (need <= 0 || (assigned.get(msg.prefix) || 0) <= 0) {
      checkedTotal += msg.checked;
      if (!opts.quiet) {
        process.stderr.write(
          `\n\u001b[90m  (hasil '${msg.prefix}' dari worker lain diabaikan, kuota sudah penuh)\u001b[0m\n`
        );
      }
      return;
    }
    assigned.set(msg.prefix, assigned.get(msg.prefix) - 1);
    remaining.set(msg.prefix, need - 1);
    checkedTotal += msg.checked;
    foundTotal++;

    const bytes = Buffer.from(msg.keypair);
    if (bytes.length !== 64) throw new Error('Panjang keypair bukan 64 byte.');

    // Verifikasi independen: 32 byte terakhir harus encode ke address yang sama.
    const recomputed = base58Encode(bytes.subarray(32, 64));
    if (recomputed !== msg.address) {
      fail(`Hasil tidak konsisten: ${recomputed} != ${msg.address}`);
    }

    const file = path.join(opts.outDir, `${msg.address}.json`);
    if (fs.existsSync(file) && !opts.overwrite) {
      fail(`File sudah ada: ${file}\nPakai --overwrite untuk menimpa.`);
    }
    fs.writeFileSync(file, JSON.stringify(Array.from(bytes)), { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* abaikan kalau filesystem tidak mendukung */
    }

    render(true);
    process.stdout.write(
      `\n\u001b[32m✓ Ketemu\u001b[0m  ${msg.address}\n` +
        `  prefix   : ${msg.prefix}\n` +
        `  percobaan: ${msg.checked.toLocaleString('id-ID')} (worker)\n` +
        `  file     : ${file}\n`
    );
    if (opts.printKeys) {
      process.stdout.write(`  secret (base58): ${base58Encode(bytes.subarray(0, 32))}\n`);
      process.stdout.write(`  seed   (base58): ${base58Encode(bytes.subarray(0, 32))}\n`);
    }

    if (foundTotal >= totalWanted) {
      render(true);
      process.stdout.write(
        `\nSelesai: ${foundTotal} alamat dalam ${humanDuration(Date.now() - t0)}.\n` +
          `Muat ke Solana CLI : solana config set --keypair ${file}\n` +
          `Cek pubkey         : solana-keygen pubkey ${file}\n\n` +
          `\u001b[33m⚠  File .json itu ISINYA PRIVATE KEY. Jangan di-share, jangan di-commit ke git.\u001b[0m\n\n`
      );
      finish(0);
    }
  }

  const workerTargetsFor = (prefix) => [{ prefix, ignoreCase: opts.ignoreCase }];

  // ---------------------------------------------------------------------
  // Kalibrasi: ukur kecepatan mesin ini, lalu tampilkan perkiraan waktu.
  // Tanpa ini pengguna tidak tahu apakah pencariannya butuh 20 detik atau
  // 20 jam, dan baru sadar setelah menunggu berjam-jam.
  // ---------------------------------------------------------------------
  const slowest = opts.targets.reduce(
    (m, t) => Math.max(m, estimateAttempts(t.prefix, opts.ignoreCase)),
    0
  );

  let ratePerThread;
  try {
    process.stdout.write('Mengukur kecepatan CPU...\r');
    ratePerThread = await measureRate();
    process.stdout.write('                          \r');
  } catch {
    ratePerThread = 0;
  }

  if (ratePerThread > 0) {
    const seconds = slowest / opts.threads / ratePerThread;
    process.stdout.write(
      `Kecepatan terukur: ~${Math.round(ratePerThread).toLocaleString('id-ID')} keypair/detik per thread ` +
        `(x ${opts.threads} thread = ~${Math.round(ratePerThread * opts.threads).toLocaleString('id-ID')}/detik)\n`
    );
    process.stdout.write(`Perkiraan waktu  : ~${humanDuration(seconds * 1000)}\n`);

    if (seconds > 600) {
      const letters = [...opts.targets[0].prefix].filter((c) => /[a-zA-Z]/.test(c)).length;
      process.stdout.write(
        `\n\u001b[33m! Ini akan lama.\u001b[0m Beberapa cara mempercepat:\n` +
          (!opts.ignoreCase && letters > 0
            ? `  - tambahkan \u001b[1m--ignore-case\u001b[0m -> sekitar ${Math.pow(2, letters)}x lebih cepat\n`
            : '') +
          `  - pendekkan prefix 1 karakter -> 58x lebih cepat\n` +
          `  - naikkan --threads (CPU kamu punya ${os.cpus().length} core)\n` +
          `  - pakai GPU grinder untuk prefix 6 karakter ke atas\n\n`
      );
    }
  } else {
    process.stdout.write('Kecepatan terukur: gagal diukur, lanjut tanpa perkiraan waktu\n');
  }

  if (opts.estimate) {
    process.stdout.write('\n--estimate: tidak mencari apa pun. Keluar.\n');
    process.exit(0);
  }

  process.stdout.write('\n');

  // Prefix mana yang masih perlu dicari? Pilih yang kuotanya paling besar dulu.
  function nextPrefix() {
    let best = null;
    for (const p of prefixes) {
      const free = (remaining.get(p) || 0) - (assigned.get(p) || 0);
      if (free > 0 && (best === null || free > best.free)) best = { prefix: p, free };
    }
    return best ? best.prefix : null;
  }

  // Berapa worker yang seharusnya hidup sekarang?
  function desiredWorkers() {
    let sum = 0;
    for (const p of prefixes) sum += Math.max(0, (remaining.get(p) || 0) - (assigned.get(p) || 0));
    return Math.min(opts.threads, sum);
  }

  function onMessage(msg) {
    const w = this;
    if (msg.type === 'progress') {
      checkedTotal += msg.checked - w._lastChecked;
      w._lastChecked = msg.checked;
      w._lastBeat = Date.now();
      w._stalls = 0;
      render();
    } else if (msg.type === 'found') {
      // Amankan hitungan progress worker ini sebelum dihitung ulang.
      checkedTotal += msg.checked - w._lastChecked;
      w._lastChecked = msg.checked;
      // URUTAN PENTING: onFound() harus jalan lebih dulu karena dia yang
      // memakai kuota `assigned`. retire() membebaskan kuota itu, jadi kalau
      // dipanggil duluan hasilnya akan dianggap ekstra dan dibuang.
      onFound(msg);
      // Kuota prefix ini sudah dipakai oleh onFound (remaining & assigned
      // sama-sama dikurangi di sana), jadi lepas dulu supaya retire() tidak
      // mengurangi `assigned` dua kali.
      w._prefix = null;
      retire(w);
      rebalance();
    } else if (msg.type === 'error') {
      process.stderr.write(`\n\u001b[31mWorker error:\u001b[0m ${msg.message}\n`);
      finish(1);
    }
  }

  function onError(err) {
    process.stderr.write(`\n\u001b[31mWorker crash:\u001b[0m ${err.message}\n`);
    finish(1);
  }

  function onExit(code) {
    const w = this;
    if (w._done || w._intentional || foundTotal >= totalWanted) return;
    // Worker mati sendiri padahal target belum terpenuhi -> jangan diam saja.
    process.stderr.write(
      `\n\u001b[31mWorker #${w._index} berhenti tak terduga (kode ${code}).\u001b[0m\n`
    );
    retire(w);
    if (w._stalls >= 5) {
      finish(1);
      return;
    }
    w._stalls++;
    rebalance();
  }

  /** Tandai worker sudah tidak dipakai lagi dan hentikan. */
  function retire(w) {
    if (!w || w._done) return;
    w._done = true;
    w._intentional = true;
    checkedTotal += w._lastChecked;
    w._lastChecked = 0;
    // Kembalikan kuota prefix-nya supaya worker lain bisa mengambilnya.
    if (w._prefix && assigned.get(w._prefix) > 0) {
      assigned.set(w._prefix, assigned.get(w._prefix) - 1);
    }
    w._prefix = null;
    if (w.kill) w.kill();
  }

  // ------------------------------------------------------------------------
  // Mode aman: grinding di proses utama (tanpa worker thread).
  // Dipakai otomatis kalau thread terdeteksi macet di mesin ini.
  // ------------------------------------------------------------------------
  let threadsBroken = process.env.SOLANA_VANITY_NO_THREADS === '1';

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
    const tail =
      (B64U_LOOKUP[s.charCodeAt(40)] << 12) |
      (B64U_LOOKUP[s.charCodeAt(41)] << 6) |
      B64U_LOOKUP[s.charCodeAt(42)];
    out[30] = (tail >> 10) & 255;
    out[31] = (tail >> 2) & 255;
    return out;
  }
  const B58_OUT2 = new Uint8Array(128);
  function base58Encode32(b) {
    const w = new Uint16Array(16);
    for (let i = 0; i < 16; i++) w[i] = (b[2 * i] << 8) | b[2 * i + 1];
    let zeros = 0;
    while (zeros < 32 && b[zeros] === 0) zeros++;
    let start = 0;
    let end = B58_OUT2.length;
    let guard = 0;
    while (start < 16) {
      if (w[start] === 0) {
        start++;
        continue;
      }
      if (++guard > 64) throw new Error('base58Encode32: bug');
      let rem = 0;
      for (let i = start; i < 16; i++) {
        const cur = rem * 65536 + w[i];
        const q = (cur / 58) | 0;
        w[i] = q;
        rem = cur - q * 58;
      }
      B58_OUT2[--end] = rem;
      if (w[start] === 0) start++;
    }
    let s = '';
    for (let i = 0; i < zeros; i++) s += '1';
    for (let i = end; i < B58_OUT2.length; i++) s += B58_ALPHABET[B58_OUT2[i]];
    return s;
  }

  function startInProcessGrinder(prefix, onMsg) {
    let stopped = false;
    let checked = 0;
    let lastReport = Date.now();
    let lastReported = 0;
    const probeWant = opts.ignoreCase ? prefix.toLowerCase() : prefix;
    (async () => {
      while (!stopped) {
        const batchEnd = checked + 500;
        while (checked < batchEnd && !stopped) {
          const { privateKey } = require('node:crypto').generateKeyPairSync('ed25519');
          const jwk = privateKey.export({ format: 'jwk' });
          const pub = b64urlTo32Bytes(jwk.x);
          const address = base58Encode32(pub);
          const probe = opts.ignoreCase ? address.toLowerCase() : address;
          checked++;
          if (probe.startsWith(probeWant)) {
            const seed = b64urlTo32Bytes(jwk.d);
            onMsg({ type: 'found', prefix, address, keypair: [...Buffer.concat([seed, pub])], checked });
            stopped = true;
            break;
          }
        }
        if (stopped) break;
        const now = Date.now();
        if (checked - lastReported >= 50 && now - lastReport >= 200) {
          lastReport = now;
          lastReported = checked;
          onMsg({ type: 'progress', checked });
        }
        await new Promise((r) => setImmediate(r));
      }
    })().catch((err) => onMsg({ type: 'error', message: String((err && err.message) || err) }));
    return { stop() { stopped = true; } };
  }

  /** Buat satu worker untuk satu prefix tertentu. */
  function spawnFor(prefix) {
    const idx = workers.length;
    const w = {
      kind: threadsBroken ? 'aman' : 'thread',
      _index: idx,
      _prefix: prefix,
      _lastChecked: 0,
      _done: false,
      _intentional: false,
      _stalls: 0,
      _lastBeat: Date.now(),
    };
    if (w.kind === 'thread') {
      const t = new Worker(WORKER_PATH, {
        workerData: { targets: workerTargetsFor(prefix), progressMs: 200, progressMinKeys: 50 },
      });
      t.on('message', onMessage.bind(w));
      t.on('error', onError);
      t.on('exit', onExit.bind(w));
      w.kill = () => t.terminate();
    } else {
      w.kill = startInProcessGrinder(prefix, onMessage.bind(w)).stop;
    }
    workers.push(w);
    assigned.set(prefix, (assigned.get(prefix) || 0) + 1);
    return w;
  }

  /**
   * Samakan jumlah worker hidup dengan kuota yang masih kosong.
   * Worker yang prefix-nya sudah terpenuhi dimatikan; slot kosong diisi
   * dengan worker untuk prefix yang masih butuh.
   */
  function rebalance() {
    if (foundTotal >= totalWanted) {
      for (const w of workers) retire(w);
      finish(0);
      return;
    }
    // Matikan HANYA worker yang prefix-nya sudah tidak dibutuhkan lagi.
    // Worker yang sedang mencari prefix yang masih kosong harus dibiarkan
    // jalan - kalau tidak, pencarian target kedua akan ikut terhenti.
    for (const w of workers) {
      if (w._done || w._intentional) continue;
      const p = w._prefix;
      if (!p || (remaining.get(p) || 0) <= 0) retire(w);
    }

    const target = desiredWorkers();
    let guard = 0;
    while (aliveWorkers() < target && guard++ < 64) {
      const p = nextPrefix();
      if (p === null) break;
      spawnFor(p);
    }
    // Bersihkan worker yang sudah mati supaya array tidak tumbuh terus.
    if (workers.length > 64) {
      const aliveNow = workers.filter((w) => !w._done);
      workers.length = 0;
      workers.push(...aliveNow);
    }
  }

  function aliveWorkers() {
    return workers.filter((w) => !w._done && !w._intentional).length;
  }

  rebalance();

  // Watchdog: worker yang diam lebih dari 15 detik dianggap macet -> ganti.
  const STALL_MS = 15_000;
  const watchdog = setInterval(() => {
    if (foundTotal >= totalWanted) return;
    const now = Date.now();
    for (const w of workers) {
      if (!w || w._done || w._intentional) continue;
      if (now - w._lastBeat > STALL_MS) {
        if (w.kind === 'thread') {
          // Thread tidak jalan di mesin ini. Mengganti thread dengan thread
          // lagi cuma buang waktu - matikan semua thread, pindah mode aman.
          if (!threadsBroken) {
            threadsBroken = true;
            process.stderr.write(
              `\n\u001b[33m! Worker thread macet >${STALL_MS / 1000}s. ` +
                'Mesin ini sepertinya tidak menjadwalkan worker thread - ' +
                'beralih ke MODE AMAN (proses utama, lebih pelan tapi jalan).\u001b[0m\n'
            );
            for (const t of workers) if (t.kind === 'thread' && !t._done) retire(t);
          }
          rebalance();
        } else {
          const stalls = w._stalls + 1;
          if (stalls > 5) {
            process.stderr.write(
              `\n\u001b[31mGrinder macet berulang kali. Hentikan.\u001b[0m\n`
            );
            finish(1);
            return;
          }
          process.stderr.write(
            `\n\u001b[33m! grinder tidak memberi progres >${STALL_MS / 1000}s\u001b[0m\n`
          );
          w._stalls = stalls;
        }
      }
    }
  }, 5_000);
  // Sengaja TIDAK di-unref: timer ini satu-satunya yang menjaga proses tetap
  // hidup saat semua worker sedang macet. Keluar selalu lewat process.exit().

  process.on('SIGINT', () => {
    render(true);
    process.stderr.write(`\n\u001b[33mDihentikan.\u001b[0m ${checkedTotal.toLocaleString('id-ID')} keypair sudah dicoba.\n`);
    finish(130);
  });
}

main();
