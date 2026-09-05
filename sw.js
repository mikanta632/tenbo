// Service Worker（docs/design.md §10）。完全オフラインで動かすための事前キャッシュ。
//
// - キャッシュ名に版番号を埋める。版を上げると新しいキャッシュを作り、古いものは activate で消す
// - skipWaiting は使わない。新しい SW は、開いているページが全部閉じたあと（次回起動時）に有効になる
// - 同一オリジンの GET はキャッシュ優先。無ければネットワークから取り、取れたらキャッシュに入れる

importScripts("./version.js");

const CACHE = `tenbo-${self.APP_VERSION}`;

const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./version.js",
  "./manifest.webmanifest",
  "./src/rules.js",
  "./src/score.js",
  "./src/reduce.js",
  "./src/edit.js",
  "./src/storage.js",
  "./src/settlement.js",
  "./src/stats.js",
  "./src/ui/app.js",
  "./src/ui/dom.js",
  "./src/ui/format.js",
  "./src/ui/sheets.js",
  "./src/ui/start.js",
  "./src/ui/table.js",
  "./src/ui/log.js",
  "./src/ui/result.js",
  "./src/ui/stats.js",
  "./src/ui/sound.js",
  "./src/ui/prefs.js",
  "./src/ui/settings.js",
  "./src/ui/player.js",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tenbo-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});
