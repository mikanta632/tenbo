// storage.js のテスト。メモリ上の localStorage 互換オブジェクトで動かす。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStorage, memoryStorage, migrate, SCHEMA_VERSION, KEYS } from "../src/storage.js";

function make() {
  const ls = memoryStorage();
  let tick = 0;
  const st = createStorage(ls, () => `t${++tick}`);
  return { ls, st };
}

describe("storage", () => {
  test("init は空の状態から meta を作る", () => {
    const { ls, st } = make();
    st.init();
    const meta = JSON.parse(ls.getItem(KEYS.meta));
    assert.equal(meta.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(st.loadRoster(), []);
    assert.equal(st.loadCurrent(), null);
    assert.deepEqual(st.loadGames(), []);
  });

  test("roster の追加と改名", () => {
    const { st } = make();
    st.init();
    const p = st.addPlayer("太郎");
    assert.ok(p.id.startsWith("p_"));
    assert.equal(st.loadRoster().length, 1);
    st.renamePlayer(p.id, "次郎");
    assert.equal(st.loadRoster()[0].name, "次郎");
    assert.equal(st.loadRoster()[0].id, p.id);
  });

  test("current の保存・読込・消去と updatedAt", () => {
    const { ls, st } = make();
    st.init();
    const game = { id: "g_1", events: [{ t: "riichi", who: 0 }] };
    st.saveCurrent(game);
    assert.deepEqual(st.loadCurrent(), game);
    assert.equal(JSON.parse(ls.getItem(KEYS.meta)).updatedAt, "t2");
    st.clearCurrent();
    assert.equal(st.loadCurrent(), null);
  });

  test("games は新しい順に追記し、同じ id は置き換える", () => {
    const { st } = make();
    st.init();
    st.appendGame({ id: "g_1" });
    st.appendGame({ id: "g_2" });
    assert.deepEqual(st.loadGames().map((g) => g.id), ["g_2", "g_1"]);
    st.appendGame({ id: "g_1", x: 1 });
    assert.deepEqual(st.loadGames().map((g) => g.id), ["g_1", "g_2"]);
  });

  test("updateGame は順序を保って差し替える", () => {
    const { st } = make();
    st.init();
    st.appendGame({ id: "g_1", x: 0 });
    st.appendGame({ id: "g_2", x: 0 });
    st.updateGame({ id: "g_1", x: 9 });
    assert.deepEqual(st.loadGames().map((g) => [g.id, g.x]), [["g_2", 0], ["g_1", 9]]);
    st.updateGame({ id: "g_none", x: 1 });
    assert.equal(st.loadGames().length, 2);
    assert.equal(st.findGame("g_1").x, 9);
    assert.equal(st.findGame("nope"), null);
  });

  test("壊れた JSON は既定値に落ちる", () => {
    const { ls, st } = make();
    ls.setItem(KEYS.games, "{broken");
    st.init();
    assert.deepEqual(st.loadGames(), []);
  });

  test("migrate は版 0 のデータを最新版に上げる", () => {
    const out = migrate({ meta: null, roster: [], current: null, games: [] });
    assert.equal(out.meta.schemaVersion, SCHEMA_VERSION);
  });

  test("export / import の往復", () => {
    const { st } = make();
    st.init();
    st.addPlayer("A");
    st.appendGame({ id: "g_1" });
    const dump = st.exportAll();
    const { st: st2 } = make();
    st2.init();
    st2.importAll(dump);
    assert.equal(st2.loadRoster()[0].name, "A");
    assert.equal(st2.loadGames()[0].id, "g_1");
  });
});
