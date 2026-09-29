// 保存の共通処理（src/ui/persist.js）のテスト。docs/design.md §9.2

import { test } from "node:test";
import assert from "node:assert/strict";
import { createStorage, memoryStorage } from "../src/storage.js";
import { persist, requestPersistentStorage } from "../src/ui/persist.js";

/** 容量が尽きた localStorage。setItem が常に失敗する */
function fullStorage() {
  const ls = memoryStorage();
  ls.setItem = () => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  };
  return ls;
}

test("保存できたら true を返し、通知しない", () => {
  const storage = createStorage(memoryStorage());
  const notices = [];
  assert.equal(persist(() => storage.addPlayer("A"), (m) => notices.push(m)), true);
  assert.equal(storage.loadRoster().length, 1);
  assert.deepEqual(notices, []);
});

test("保存に失敗したら false を返し、反映していないことを 1 回だけ通知する", () => {
  const storage = createStorage(fullStorage());
  const notices = [];
  assert.equal(persist(() => storage.addPlayer("A"), (m) => notices.push(m)), false);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /保存できませんでした.*反映していません/);
  assert.deepEqual(storage.loadRoster(), []);
});

test("進行中の対局の削除・対局の削除・改名も、保存に失敗したら false になる", () => {
  const storage = createStorage(fullStorage());
  const quiet = () => {};
  assert.equal(persist(() => storage.clearCurrent(), quiet), false);
  assert.equal(persist(() => storage.deleteGame("g1"), quiet), true); // 対象が無ければ書き込まないので失敗しない
  assert.equal(persist(() => storage.renamePlayer("p", "B"), quiet), false);
});

test("保存領域の永続化を頼む。すでに永続なら頼み直さない", async () => {
  let asked = 0;
  const nav = (persisted, granted) => ({ storage: { persisted: async () => persisted, persist: async () => (asked++, granted) } });
  assert.equal(await requestPersistentStorage(nav(false, true)), true);
  assert.equal(asked, 1);
  assert.equal(await requestPersistentStorage(nav(true, false)), true);
  assert.equal(asked, 1);
  assert.equal(await requestPersistentStorage(nav(false, false)), false);
});

test("永続化に対応していない・失敗しても例外にしない", async () => {
  assert.equal(await requestPersistentStorage({}), false);
  assert.equal(await requestPersistentStorage(undefined), false);
  const broken = { storage: { persist: async () => { throw new Error("x"); } } };
  assert.equal(await requestPersistentStorage(broken), false);
});
