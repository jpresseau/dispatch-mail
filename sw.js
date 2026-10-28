/* Dispatch — service worker.

   Network-first with a cache fallback, scoped to the folder it is served from: /dispatch/ on
   jpresseau.github.io, the site root on mail.jpresseau.com (tools/publish-dispatch.py copies the
   same files there). Online you get the freshly deployed page, offline the last good copy still
   opens and reads what IndexedDB holds. Only same-origin GETs inside this scope are ever
   handled - every request to Google goes straight through untouched, and so does build.txt,
   which the page reads to learn it is stale.

   OURS ONLY. caches.keys() is ORIGIN-WIDE and six apps share this origin, so the activate
   sweep deletes nothing but caches carrying this worker's own prefix (tools/test/structure.test.js
   drives every worker and checks exactly that). */
var VERSION = 'dispatch-v1';
var SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg',
             './apple-touch-icon.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then(function (c) {
    /* addAll is atomic - one 404 would abort the whole install, and a missing icon should not
       cost the app shell. */
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }));
});

var MINE = 'dispatch-';
/* the folder this worker was served from: '/dispatch/' here, '/' on its own domain */
var HOME = new URL('./', self.location).pathname;
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      return (k !== VERSION && k.indexOf(MINE) === 0) ? caches.delete(k) : null;
    }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(HOME) !== 0) return;
  if (/\/build\.txt$/.test(url.pathname)) return;       /* the stale check must reach the server or fail */

  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
