// Service Worker for Nokia PM Field Tool - 100% Offline PWA
const CACHE_NAME = 'nokia-pm-cache-v5';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/style.css',
  './libs/exceljs.min.js',
  './js/sample-template.js',
  './js/db.js',
  './js/geotag.js',
  './js/excel-analyzer.js',
  './js/excel-exporter.js',
  './js/visit-manager.js',
  './js/app.js',
  './samples/nokia_pm_template.xlsx'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('Cache addAll warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
