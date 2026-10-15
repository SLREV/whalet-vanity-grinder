/**
 * app.js - logika UI VanitySol.
 *
 * Tidak memakai framework: satu file, tanpa bundler, supaya mudah diaudit.
 * Semua aturan (validasi prefix, estimasi, pencocokan) diambil dari
 * js/core/grinder-core.js - file yang SAMA dengan yang dipakai CLI Node.
 */
(function () {
  'use strict';

  var SV = window.SolanaVanity || {};
  var Core = SV.Core;
  var Base58 = SV.Base58;
  if (!Core || !Base58) {
    document.body.innerHTML =
      '<p style="padding:24px;font-family:system-ui">Gagal memuat modul inti. ' +
      'Pastikan app di-build lewat <code>node tools/build-app.mjs</code>.</p>';
    return;
  }

  var Cap = window.Capacitor || null;
  var P = (Cap && Cap.Plugins) || {};

  // ---------------------------------------------------------------------
  // Referensi DOM
  // ---------------------------------------------------------------------
  function $(id) {
    return document.getElementById(id);
  }
  var el = {
    prefix: $('prefix'),
    hint: $('prefix-hint'),
    fix: $('fix-btn'),
    ignoreCase: $('ignore-case'),
    countChips: $('count-chips'),
    threadChips: $('thread-chips'),
    estLevel: $('est-level'),
    estAttempts: $('est-attempts'),
    estRate: $('est-rate'),
    estTime: $('est-time'),
    estNote: $('est-note'),
    bench: $('bench-btn'),
    start: $('start-btn'),
    bar: $('bar'),
    statChecked: $('stat-checked'),
    statRate: $('stat-rate'),
    statTime: $('stat-time'),
    statFound: $('stat-found'),
    runNote: $('run-note'),
    results: $('results'),
    noResults: $('no-results'),
    saveAll: $('save-all'),
    clearResults: $('clear-results'),
    engine: $('badge-engine'),
    toast: $('toast'),
    about: $('about'),
    aboutBtn: $('about-btn'),
    aboutClose: $('about-close'),
    buildInfo: $('build-info'),
  };

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var state = {
    count: 3,
    parallel: defaultParallel(),
    running: false,
    stopping: false,
    measuredRate: 0, // key/detik per proses paralel
    engineName: '',
    results: [],
    t0: 0,
    checked: 0,
    found: 0,
    total: 0,
    timer: null,
    wakeLock: null,
    workers: [],
    benchWorker: null,
  };

  function defaultParallel() {
    var hc = navigator.hardwareConcurrency || 4;
    return Math.max(1, Math.min(4, hc));
  }

  // ---------------------------------------------------------------------
  // Util
  // ---------------------------------------------------------------------
  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.hidden = true;
    }, 2600);
  }

  function haptic(kind) {
    if (P.Haptics && P.Haptics.notification) {
      // Enum Capacitor Haptics.NotificationType.Success bernilai "SUCCESS".
      P.Haptics.notification({ type: kind === 'Success' ? 'SUCCESS' : kind }).catch(function () {});
    } else if (navigator.vibrate) {
      navigator.vibrate(kind === 'Success' ? [12, 40, 20] : 20);
    }
  }

  function fmt(n) {
    return Core.formatNumber(n);
  }

  function prefix() {
    return el.prefix.value.trim();
  }

  function ignoreCase() {
    return el.ignoreCase.checked;
  }

  // ---------------------------------------------------------------------
  // Validasi + estimasi
  // ---------------------------------------------------------------------
  function currentValidation() {
    var p = prefix();
    if (p === '') {
      el.prefix.classList.remove('invalid');
      el.hint.className = 'hint';
      el.hint.innerHTML =
        'Hanya karakter base58. Huruf <code>0 O I l</code> tidak ada di alamat Solana.';
      el.fix.hidden = true;
      return null;
    }
    var v = Core.validatePrefix(p);
    if (v.ok) {
      el.prefix.classList.remove('invalid');
      el.hint.className = 'hint';
      var d = Core.difficulty(p, ignoreCase());
      el.hint.innerHTML =
        'Prefix <code>' +
        escapeHtml(p) +
        '</code> · tingkat kesulitan <strong>' +
        d.level +
        '</strong>';
      el.fix.hidden = true;
      return v;
    }
    el.prefix.classList.add('invalid');
    el.hint.className = 'hint err';
    el.hint.textContent = v.message;
    if (v.suggestion && v.suggestion !== p) {
      el.fix.hidden = false;
      el.fix.textContent = 'Pakai "' + v.suggestion + '" sebagai gantinya';
      el.fix.onclick = function () {
        el.prefix.value = v.suggestion;
        refresh();
      };
    } else {
      el.fix.hidden = true;
    }
    return null;
  }

  function renderEstimate() {
    var p = prefix();
    var v = Core.validatePrefix(p);
    if (!v.ok) {
      el.estLevel.textContent = '—';
      el.estAttempts.textContent = '—';
      el.estTime.textContent = '—';
      return;
    }
    var d = Core.difficulty(p, ignoreCase());
    el.estLevel.textContent = d.level;
    el.estLevel.className = 'level-' + d.level.replace(/\s+/g, '-');
    el.estAttempts.textContent = '±' + fmt(d.attempts);

    if (state.measuredRate > 0) {
      var total = state.measuredRate * state.parallel;
      var ms = (d.attempts / total) * 1000;
      el.estTime.textContent = '±' + Core.humanDuration(ms);
      el.estNote.textContent =
        'Berdasarkan kecepatan terukur ' +
        fmt(total) +
        ' keypair/detik (' +
        state.parallel +
        ' proses paralel). Waktu nyata bisa lebih lama karena panas dan hemat baterai.';
      if (ms > 15 * 60 * 1000) {
        el.estNote.textContent +=
          ' Di HP, prefix sepanjang ini biasanya terlalu lama — coba kurangi satu huruf.';
      }
    } else {
      el.estTime.textContent = 'ukur dulu';
      el.estNote.textContent =
        'Tekan “Ukur kecepatan perangkat” supaya perkiraannya nyata, bukan tebakan.';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function refresh() {
    currentValidation();
    renderEstimate();
    el.start.disabled = state.running ? false : !Core.validatePrefix(prefix()).ok;
  }

  // ---------------------------------------------------------------------
  // Chips
  // ---------------------------------------------------------------------
  function buildChips(container, values, current, onPick) {
    container.innerHTML = '';
    values.forEach(function (v) {
      var b = document.createElement('button');
      b.className = 'chip' + (v === current ? ' active' : '');
      b.textContent = v;
      b.type = 'button';
      b.onclick = function () {
        Array.prototype.forEach.call(container.children, function (c) {
          c.classList.remove('active');
        });
        b.classList.add('active');
        onPick(v);
      };
      container.appendChild(b);
    });
  }

  function renderThreadChips() {
    var hc = navigator.hardwareConcurrency || 4;
    var values = [1, 2, 4, 6, 8].filter(function (n) {
      return n <= Math.max(2, hc);
    });
    if (values.indexOf(state.parallel) === -1) state.parallel = values[values.length - 1];
    buildChips(el.threadChips, values, state.parallel, function (v) {
      state.parallel = v;
      renderEstimate();
    });
  }

  // ---------------------------------------------------------------------
  // Bench
  // ---------------------------------------------------------------------
  function runBench() {
    if (state.running) return;
    if (state.benchWorker) return;
    el.bench.disabled = true;
    el.bench.textContent = 'Mengukur…';
    el.estRate.textContent = 'mengukur…';

    var w = new Worker('js/worker.js');
    state.benchWorker = w;
    w.onmessage = function (ev) {
      var m = ev.data || {};
      if (m.type === 'engine') {
        state.engineName = m.name;
        el.engine.textContent = 'mesin: ' + (m.name === 'webcrypto' ? 'native' : 'JS');
      } else if (m.type === 'bench') {
        state.measuredRate = m.keysPerSec;
        el.estRate.textContent = fmt(m.keysPerSec) + ' key/detik/proses';
        renderEstimate();
        toast('Kecepatan terukur: ' + fmt(m.keysPerSec) + ' keypair/detik per proses');
        cleanup();
      } else if (m.type === 'error') {
        toast('Gagal mengukur: ' + m.message);
        cleanup();
      }
    };
    w.onerror = function () {
      toast('Worker tidak bisa dijalankan di lingkungan ini.');
      cleanup();
    };

    function cleanup() {
      el.bench.disabled = false;
      el.bench.textContent = 'Ukur kecepatan perangkat';
      if (state.benchWorker) {
        state.benchWorker.terminate();
        state.benchWorker = null;
      }
    }

    w.postMessage({ type: 'bench', durationMs: 1200, concurrency: 48 });
  }

  // ---------------------------------------------------------------------
  // Grinding
  // ---------------------------------------------------------------------
  function start() {
    var v = Core.validatePrefix(prefix());
    if (!v.ok || state.running) return;

    var p = v.prefix;
    var want = state.count;

    state.running = true;
    state.stopping = false;
    state.results = [];
    state.checked = 0;
    state.found = 0;
    state.total = want;
    state.t0 = Date.now();

    renderResults();
    el.start.textContent = 'HENTIKAN';
    el.start.classList.add('stop');
    el.bar.style.width = '0%';
    el.runNote.textContent = 'Mencari ' + want + ' alamat yang diawali “' + p + '”…';
    requestWakeLock();
    haptic('Success');

    var remaining = want;
    var concurrency = 48;

    for (var i = 0; i < state.parallel; i++) {
      (function () {
        var w = new Worker('js/worker.js');
        var localChecked = 0;
        var finished = false;

        w.onmessage = function (ev) {
          var m = ev.data || {};
          if (m.type === 'engine') {
            state.engineName = m.name;
            el.engine.textContent = 'mesin: ' + (m.name === 'webcrypto' ? 'native' : 'JS');
            if (m.name === 'js') {
              el.runNote.textContent =
                'Mesin cadangan (JavaScript) aktif — jauh lebih lambat. Perbarui Android System WebView untuk kecepatan penuh.';
            }
          } else if (m.type === 'progress') {
            state.checked += Math.max(0, m.checked - localChecked);
            localChecked = m.checked;
            paint();
          } else if (m.type === 'found') {
            state.checked += Math.max(0, m.checked - localChecked);
            localChecked = m.checked;
            if (remaining > 0 && !state.stopping) {
              remaining--;
              state.found++;
              var info = Core.describeKeypair(m.keypair);
              info.attempts = m.checked;
              state.results.push(info);
              renderResults();
              haptic('Success');
            }
            if (remaining <= 0) stop(true);
            paint();
          } else if (m.type === 'done') {
            if (!finished) {
              finished = true;
              state.checked += Math.max(0, m.checked - localChecked);
              localChecked = m.checked;
            }
            removeWorker(w);
            paint();
          } else if (m.type === 'error') {
            toast('Worker error: ' + m.message);
          }
        };

        w.onerror = function () {
          toast('Worker berhenti tak terduga.');
          removeWorker(w);
        };

        state.workers.push(w);
        w.postMessage({
          type: 'start',
          prefix: p,
          count: want,
          ignoreCase: ignoreCase(),
          concurrency: concurrency,
        });
      })();
    }

    paint();
    state.timer = setInterval(paint, 250);
  }

  function removeWorker(w) {
    var i = state.workers.indexOf(w);
    if (i !== -1) state.workers.splice(i, 1);
  }

  function stop(finishedOk) {
    if (!state.running) return;
    state.stopping = true;
    state.running = false;
    clearInterval(state.timer);
    state.timer = null;

    state.workers.slice().forEach(function (w) {
      try {
        w.postMessage({ type: 'stop' });
      } catch (e) {}
      // Beri kesempatan worker mengirim 'done', lalu hentikan paksa.
      setTimeout(function () {
        try {
          w.terminate();
        } catch (e) {}
      }, 300);
    });
    state.workers = [];

    el.start.textContent = 'MULAI CARI';
    el.start.classList.remove('stop');
    releaseWakeLock();
    paint(true);

    if (finishedOk && state.results.length > 0) {
      el.runNote.textContent =
        'Selesai: ' +
        state.results.length +
        ' alamat dalam ' +
        Core.humanTime((Date.now() - state.t0) / 1000) +
        '.';
      toast('Ketemu ' + state.results.length + ' alamat!');
    } else {
      el.runNote.textContent =
        'Dihentikan setelah ' + fmt(state.checked) + ' keypair dicoba.';
    }
    refresh();
  }

  function paint(force) {
    var dt = (Date.now() - state.t0) / 1000;
    var rate = state.checked / Math.max(dt, 0.001);
    el.statChecked.textContent = fmt(state.checked);
    el.statRate.textContent = fmt(rate) + '/detik';
    el.statTime.textContent = Core.humanTime(dt);
    el.statFound.textContent = state.found + '/' + state.total;
    var pct = state.total ? Math.min(100, (state.found / state.total) * 100) : 0;
    el.bar.style.width = pct + '%';
    if (force && !state.running) el.statRate.textContent = fmt(rate) + '/detik';
  }

  // ---------------------------------------------------------------------
  // Wake lock
  // ---------------------------------------------------------------------
  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock
      .request('screen')
      .then(function (lock) {
        state.wakeLock = lock;
        lock.addEventListener('release', function () {
          state.wakeLock = null;
        });
      })
      .catch(function () {});
  }

  function releaseWakeLock() {
    if (state.wakeLock) {
      try {
        state.wakeLock.release();
      } catch (e) {}
      state.wakeLock = null;
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.running) requestWakeLock();
  });

  // ---------------------------------------------------------------------
  // Hasil
  // ---------------------------------------------------------------------
  function highlight(addr, p) {
    var n = p.length;
    return '<b>' + escapeHtml(addr.slice(0, n)) + '</b>' + escapeHtml(addr.slice(n));
  }

  function renderResults() {
    var p = prefix() || '';
    el.results.innerHTML = '';
    el.noResults.hidden = state.results.length > 0;
    el.saveAll.hidden = state.results.length === 0;
    el.clearResults.hidden = state.results.length === 0;

    state.results.forEach(function (r, idx) {
      var box = document.createElement('div');
      box.className = 'result';

      var addr = document.createElement('div');
      addr.className = 'addr';
      addr.innerHTML = highlight(r.address, p);
      box.appendChild(addr);

      var meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent =
        '#' + (idx + 1) + ' · ketemu setelah ' + fmt(r.attempts) + ' percobaan di prosesnya';
      box.appendChild(meta);

      var acts = document.createElement('div');
      acts.className = 'acts';
      acts.appendChild(mini('Salin alamat', function () {
        copyText(r.address);
      }));
      acts.appendChild(mini('Simpan file .json', function () {
        saveKeypair(r);
      }));
      acts.appendChild(mini('Bagikan', function () {
        shareAddress(r);
      }));
      var secretBtn = mini('Lihat private key', null, 'danger');
      var shown = false;
      secretBtn.onclick = function () {
        if (shown) {
          var old = box.querySelector('.secret');
          if (old) old.remove();
          secretBtn.textContent = 'Lihat private key';
          shown = false;
          return;
        }
        var s = document.createElement('div');
        s.className = 'secret';
        s.textContent =
          'PRIVATE KEY (jangan dibagikan): ' +
          Array.prototype.join.call(r.secretKey, ',');
        box.appendChild(s);
        secretBtn.textContent = 'Sembunyikan';
        shown = true;
      };
      acts.appendChild(secretBtn);
      box.appendChild(acts);

      el.results.appendChild(box);
    });
  }

  function mini(label, fn, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini' + (cls ? ' ' + cls : '');
    b.textContent = label;
    if (fn) b.onclick = fn;
    return b;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          toast('Disalin ke clipboard');
        },
        function () {
          toast('Tidak bisa menyalin di lingkungan ini');
        }
      );
    } else {
      toast('Clipboard tidak tersedia');
    }
  }

  function shareAddress(r) {
    var text = 'Alamat Solana: ' + r.address;
    if (P.Share && P.Share.share) {
      P.Share.share({ title: 'Alamat Solana', text: text, dialogTitle: 'Bagikan alamat' }).catch(
        function () {}
      );
    } else if (navigator.share) {
      navigator.share({ title: 'Alamat Solana', text: text }).catch(function () {});
    } else {
      copyText(r.address);
    }
  }

  /** Simpan <ALAMAT>.json (format solana-keygen) ke penyimpanan perangkat. */
  function saveKeypair(r) {
    var filename = 'vanity-keys/' + r.address + '.json';
    if (P.Filesystem && typeof P.Filesystem.writeFile === 'function') {
      P.Filesystem.writeFile({
        path: filename,
        data: r.json,
        encoding: 'utf8',
        // Enum Capacitor Filesystem.Directory.Documents bernilai "DOCUMENTS".
        directory: 'DOCUMENTS',
        recursive: true,
      }).then(
        function (res) {
          toast('Tersimpan di Documents/vanity-keys');
          return res;
        },
        function (err) {
          toast('Gagal menyimpan: ' + ((err && err.message) || err));
        }
      );
      return;
    }
    downloadBlob(r.json, r.address + '.json', 'application/json');
  }

  function downloadBlob(text, filename, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function saveAll() {
    state.results.forEach(function (r, i) {
      setTimeout(function () {
        saveKeypair(r);
      }, i * 250);
    });
  }

  // ---------------------------------------------------------------------
  // Event
  // ---------------------------------------------------------------------
  el.prefix.addEventListener('input', refresh);
  el.ignoreCase.addEventListener('change', refresh);
  el.bench.addEventListener('click', runBench);
  el.start.addEventListener('click', function () {
    if (state.running) stop(false);
    else start();
  });
  el.saveAll.addEventListener('click', saveAll);
  el.clearResults.addEventListener('click', function () {
    state.results = [];
    renderResults();
  });
  el.aboutBtn.addEventListener('click', function () {
    el.about.hidden = false;
  });
  el.aboutClose.addEventListener('click', function () {
    el.about.hidden = true;
  });
  el.about.addEventListener('click', function (ev) {
    if (ev.target === el.about) el.about.hidden = true;
  });

  buildChips(el.countChips, [1, 3, 5, 10], state.count, function (v) {
    state.count = v;
    renderEstimate();
  });

  // ---------------------------------------------------------------------
  // Inisialisasi
  // ---------------------------------------------------------------------
  var build = window.SolanaVanityBuild || {};
  el.buildInfo.textContent =
    'VanitySol ' + (build.version || '0.0.0') + ' · build ' + (build.build || 'dev');

  el.engine.textContent = build.isNative ? 'mesin: memeriksa…' : 'mesin: —';

  if (P.StatusBar) {
    if (typeof P.StatusBar.setStyle === 'function') {
      P.StatusBar.setStyle({ style: 'DARK' }).catch(function () {});
    }
    if (typeof P.StatusBar.setBackgroundColor === 'function') {
      P.StatusBar.setBackgroundColor({ color: '#0b1220' }).catch(function () {});
    }
  }

  renderThreadChips();
  refresh();
  renderResults();

  // Service worker hanya berguna di browser (bukan di dalam Capacitor).
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !build.isNative) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
