// Service Worker（docs/design.md §10）。完全オフラインで動かすための事前キャッシュ。
//
// - キャッシュ名に版番号を埋める。版を上げると新しいキャッシュを作り、古いものは activate で消す
// - skipWaiting は使わない。新しい SW は、開いているページが全部閉じたあと（次回起動時）に有効になる
// - 同一オリジンの GET はキャッシュ優先。無ければネットワークから取り、取れたらキャッシュに入れる
//
// 版はスクリプト URL の ?v= から取る。このファイル自体は版が変わっても中身が変わらないため、
// ページ側が ./sw.js?v=版 で登録して「別のスクリプト」にする。そうしないとブラウザが
// 同じスクリプトと見なして更新を取り込まない（importScripts した version.js の変化は
// HTTP キャッシュに隠れることがあり、当てにできない）。

importScripts("./version.js");

const VERSION = new URL(self.location.href).searchParams.get("v") || self.APP_VERSION;
const CACHE = `tenbo-${VERSION}`;

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
  "./src/ui/tabs.js",
  "./src/ui/misc.js",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  // HTTP キャッシュを通さずに取る。通すと、更新直後に古いファイルを事前キャッシュしてしまう
  const requests = PRECACHE.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(requests)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tenbo-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 「更新を確認」から明示的に頼まれたときだけ、待機中の新しい版をすぐ有効にする
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 更新確認の版番号はキャッシュを読まず、現在の版のキャッシュにも書き込まない。
  // Request.cache は古い iOS Safari では読めないので、クエリ付き（キャッシュ避けの ?t=）も同じ扱いにする。
  // 事前キャッシュの URL にクエリは無いため、これで取りこぼしは起きない。
  if (req.cache === "no-store" || url.search !== "") {
    event.respondWith(fetch(req));
    return;
  }
  event.respondWith(
    caches.match(req, { ignoreSearch: true, cacheName: CACHE }).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {
            /* 容量不足でもネットワークから取得した応答は利用できる */
          }));
        }
        return res;
      });
    }),
  );
});
