/**
 * worker.js - Web Worker penggiling vanity address.
 *
 * Satu worker mencari SATU prefix sampai jatahnya terpenuhi atau diminta
 * berhenti. UI (app.js) yang membagi jatah dan menghentikan worker, persis
 * seperti bin/grind.js membagi jatah ke worker_thread di CLI.
 *
 * Pesan masuk : {type:'start'|'stop'|'bench'}
 * Pesan keluar: {type:'engine'|'progress'|'found'|'done'|'bench'|'error'}
 */
'use strict';

/* global importScripts */
importScripts('core/base58.js');
importScripts('core/grinder-core.js');
// Worker ini berada di js/, sedangkan fallback TweetNaCl berada di vendor/.
importScripts('../vendor/nacl-fast.min.js');
importScripts('engine.js');

var Core = self.SolanaVanity.Core;
var Engine = self.SolanaVanity.Engine;

var stopped = false;
var running = false;
var engineCache = null;
var engineName = 'belum diketahui';

function getEngine(concurrency) {
  if (engineCache) return Promise.resolve(engineCache);
  return Engine.create(concurrency).then(function (res) {
    engineCache = res.engine;
    engineName = res.name;
    self.postMessage({ type: 'engine', name: res.name, concurrency: res.engine.concurrency });
    return res.engine;
  });
}

/**
 * Inti pencarian. Dibuat sebagai fungsi terpisah (bukan langsung di onmessage)
 * supaya bisa diuji dari Node lewat tools/test-app-core.mjs.
 */
async function grind(opts, engine) {
  var prefix = opts.prefix;
  var count = opts.count;
  var ignoreCase = !!opts.ignoreCase;
  var needle = ignoreCase ? prefix.toLowerCase() : prefix;
  var checked = 0;
  var found = 0;
  var startedAt = Date.now();
  var lastReport = startedAt;

  while (!stopped && found < count) {
    var batch = await engine.nextBatch();
    for (var i = 0; i < batch.length; i++) {
      var cand = batch[i];
      checked++;
      var probe = ignoreCase ? cand.address.toLowerCase() : cand.address;
      if (probe.indexOf(needle) === 0) {
        found++;
        self.postMessage({
          type: 'found',
          prefix: prefix,
          address: cand.address,
          keypair: Array.prototype.slice.call(cand.keypair),
          checked: checked,
        });
        if (found >= count || stopped) break;
      }
    }
    var now = Date.now();
    if (now - lastReport >= 200) {
      lastReport = now;
      self.postMessage({
        type: 'progress',
        prefix: prefix,
        checked: checked,
        found: found,
        rate: Math.round(checked / Math.max((now - startedAt) / 1000, 0.001)),
      });
    }
  }

  var elapsed = (Date.now() - startedAt) / 1000;
  self.postMessage({
    type: 'done',
    prefix: prefix,
    checked: checked,
    found: found,
    seconds: elapsed,
    rate: Math.round(checked / Math.max(elapsed, 0.001)),
  });
}

async function bench(opts, engine) {
  var durationMs = opts.durationMs || 1200;
  var t0 = Date.now();
  var checked = 0;
  var batch = await engine.nextBatch();
  checked += batch.length;
  while (Date.now() - t0 < durationMs) {
    batch = await engine.nextBatch();
    checked += batch.length;
  }
  var elapsed = (Date.now() - t0) / 1000;
  self.postMessage({
    type: 'bench',
    checked: checked,
    seconds: elapsed,
    keysPerSec: Math.round(checked / Math.max(elapsed, 0.001)),
    engine: engine.name,
  });
}

self.onmessage = function (ev) {
  var msg = ev.data || {};

  if (msg.type === 'stop') {
    stopped = true;
    return;
  }

  if (running) {
    self.postMessage({ type: 'error', message: 'Worker sudah sedang bekerja.' });
    return;
  }

  stopped = false;
  running = true;

  getEngine(msg.concurrency)
    .then(function (engine) {
      if (msg.type === 'bench') return bench(msg, engine);
      if (msg.type === 'start') {
        var v = Core.validatePrefix(msg.prefix);
        if (!v.ok) throw new Error(v.message);
        return grind(msg, engine);
      }
      throw new Error('Pesan tidak dikenal: ' + msg.type);
    })
    .catch(function (err) {
      self.postMessage({ type: 'error', message: String((err && err.message) || err) });
    })
    .then(function () {
      running = false;
    });
};
