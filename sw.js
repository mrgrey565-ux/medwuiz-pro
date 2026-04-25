'use strict';

const CACHE_NAME = 'medquiz-pro-v1';
const BASE = '/medwuiz-pro';

const PRECACHE = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/css/style.css',
  BASE + '/js/script.js',
  BASE + '/manifest.json',
  BASE + '/icons/icon-192.png',
  BASE + '/icons/icon-512.png'
];

// Install — cache core files
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// Activate — clean old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key !== CACHE_NAME;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch — network first, cache fallback
self.addEventListener('fetch', function(e) {
  // Skip non-GET and cross-origin requests
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request).then(function(response) {
      // Cache a copy of fresh responses
      if (response && response.status === 200) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, copy);
        });
      }
      return response;
    }).catch(function() {
      // Network failed — serve from cache
      return caches.match(e.request).then(function(cached) {
        return cached || caches.match(BASE + '/index.html');
      });
    })
  );
});
