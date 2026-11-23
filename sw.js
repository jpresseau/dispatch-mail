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
var WAIT = 4000;   /* how long the network has before the last good copy is shown instead */
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

  /* Network-first, but not for ever: a stalled connection (a lift, a train, a captive Wi-Fi page that
     never answers) gave a blank app until the request finally failed. After WAIT ms the last good
     copy is shown, if there is one, and the network's answer still lands in the cache when it
     comes (waitUntil). With nothing cached it keeps waiting, since nothing is better than a page. */
  var net = fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      return caches.open(VERSION).then(function (c) { return c.put(req, copy); }).then(function () { return res; }, function () { return res; });
    }
    return res;
  });
  e.waitUntil(net.catch(function () {}));
  var cached = function (orShell) {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (orShell ? caches.match('./index.html') : null);
    });
  };
  e.respondWith(new Promise(function (resolve, reject) {
    var done = false;
    var give = function (r) { if (done || !r) return false; done = true; resolve(r); return true; };
    net.then(give, function (err) {
      cached(true).then(function (hit) { if (!give(hit) && !done) { done = true; reject(err); } });
    });
    setTimeout(function () { if (!done) cached(req.mode === 'navigate').then(give); }, WAIT);
  }));
});
