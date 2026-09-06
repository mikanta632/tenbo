import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../sw.js", import.meta.url), "utf8");

function worker({ failPut = false, scriptUrl = "https://example.test/tenbo/sw.js" } = {}) {
  const handlers = {};
  const puts = [];
  const network = [];
  const stored = new Map([
    ["tenbo-old", new Map([["https://example.test/tenbo/version.js", "old"]])],
    ["tenbo-test", new Map([["https://example.test/tenbo/version.js", "current"]])],
  ]);
  const match = (entries, req, options) => {
    const url = new URL(req.url);
    if (options?.ignoreSearch) url.search = "";
    const value = entries?.get(url.href);
    return value === undefined ? undefined : new Response(value);
  };
  runInNewContext(source, {
    URL,
    importScripts() {},
    Request,
    self: { APP_VERSION: "test", location: new URL(scriptUrl), addEventListener: (type, fn) => (handlers[type] = fn) },
    caches: {
      async match(req, options) {
        if (options?.cacheName) return match(stored.get(options.cacheName), req, options);
        for (const entries of stored.values()) {
          const hit = match(entries, req, options);
          if (hit) return hit;
        }
      },
      async open(name) {
        return {
          async match(req, options) { return match(stored.get(name), req, options); },
          async put(req, res) {
            if (failPut) throw new Error("cache full");
            puts.push([name, req.url, await res.text()]);
          },
        };
      },
    },
    async fetch(req) { network.push(req.url); return new Response("network"); },
  });
  return {
    puts, network,
    async request(path, options) {
      let response;
      const pending = [];
      const req = new Request(`https://example.test/tenbo/${path}`, options);
      handlers.fetch({ request: req, respondWith: (p) => (response = p), waitUntil: (p) => pending.push(p) });
      const res = await response;
      await Promise.all(pending);
      return res?.text();
    },
  };
}

test("SW は自身の版のキャッシュだけを返す", async () => {
  const sw = worker();
  assert.equal(await sw.request("version.js"), "current");
  assert.deepEqual(sw.network, []);
});

test("更新確認の no-store はネットワークへ送り通常のキャッシュを変更しない", async () => {
  const sw = worker();
  assert.equal(await sw.request("version.js?t=123", { cache: "no-store" }), "network");
  assert.equal(sw.network.length, 1);
  assert.deepEqual(sw.puts, []);
  assert.equal(await sw.request("version.js"), "current");
});

test("Request.cache を読めない環境でも、クエリ付きなら更新確認とみなしてネットワークへ送る", async () => {
  const sw = worker();
  assert.equal(await sw.request("version.js?t=123"), "network");
  assert.deepEqual(sw.puts, []);
});

test("キャッシュにない応答は保存完了まで待つ", async () => {
  const sw = worker();
  assert.equal(await sw.request("extra.js"), "network");
  assert.deepEqual(sw.puts, [["tenbo-test", "https://example.test/tenbo/extra.js", "network"]]);
});

test("キャッシュの保存が失敗してもネットワーク応答を返す", async () => {
  assert.equal(await worker({ failPut: true }).request("extra.js"), "network");
});

test("版はスクリプト URL の ?v= を優先し、無ければ version.js の値を使う", async () => {
  const next = worker({ scriptUrl: "https://example.test/tenbo/sw.js?v=9.9.9" });
  await next.request("extra.js");
  assert.deepEqual(next.puts.map(([cache]) => cache), ["tenbo-9.9.9"]);

  const plain = worker();
  await plain.request("extra.js");
  assert.deepEqual(plain.puts.map(([cache]) => cache), ["tenbo-test"]);
});

test("新しい版の SW は、自分の版のキャッシュしか読まない", async () => {
  // tenbo-test には version.js があるが、?v=9.9.9 の SW はそれを使わない
  const next = worker({ scriptUrl: "https://example.test/tenbo/sw.js?v=9.9.9" });
  assert.equal(await next.request("version.js"), "network");
});
