/**
 * sw.js - service worker supaya app tetap bisa dibuka tanpa internet.
 *
 * Hanya untuk mode browser/PWA. Di dalam APK Capacitor, asset sudah ter-bundle
 * di dalam aplikasi sehingga service worker ini tidak didaftarkan.
 *
 * Strategi: cache-first untuk asset aplikasi, tanpa strategi jaringan khusus.
 * Tidak ada request keluar domain aplikasi yang pernah dibuat.
 */
'use strict';

var CACHE = 'vanitysol-v2';
var SHELL = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/worker.js',
  './js/engine.js',
  './js/core/base58.js',
  './js/core/grinder-core.js',
  './vendor/nacl-fast.min.js',
  './vendor/nacl-fast.LICENSE',
  './licenses/THIRD-PARTY-NOTICES.txt',
  './licenses/capacitor-core-LICENSE.txt',
  './licenses/capacitor-android-LICENSE.txt',
  './licenses/capacitor-filesystem-LICENSE.txt',
  './licenses/capacitor-share-LICENSE.txt',
  './licenses/capacitor-haptics-LICENSE.txt',
  './licenses/capacitor-status-bar-LICENSE.txt',
  './licenses/capacitor-synapse-LICENSE.txt',
  './licenses/tweetnacl-LICENSE.txt',
  './build-info.js',
  './privacy.html',
  './manifest.webmanifest',
  './icons/icon-96.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches
      .open(CACHE)
      .then(function (c) {
        return c.addAll(SHELL);
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (k) {
            // Jangan hapus cache milik aplikasi lain pada origin yang sama.
            return k.indexOf('vanitysol-') === 0 && k !== CACHE ? caches.delete(k) : null;
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (ev) {
  var url = new URL(ev.request.url);
  // Jangan pernah menyentuh request lintas-origin. Aplikasi ini tidak punya
  // kebutuhan jaringan sama sekali.
  if (ev.request.method !== 'GET' || url.origin !== self.location.origin) return;

  ev.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(ev.request, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(ev.request)
          .then(function (res) {
            if (res.ok) cache.put(ev.request, res.clone());
            return res;
          })
          .catch(function () {
            return cache.match('./index.html');
          });
      });
    })
  );
});
