// storage.js のテスト。メモリ上の localStorage 互換オブジェクトで動かす。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStorage, memoryStorage, migrate, prepareImport, SCHEMA_VERSION, KEYS } from "../src/storage.js";
import { makeRule } from "../src/rules.js";
import { appendEvent } from "../src/edit.js";
import { computeSettlement } from "../src/settlement.js";
import { PRESETS } from "../src/rules.js";

function backup() {
  const rule = makeRule();
  return {
    meta: { schemaVersion: SCHEMA_VERSION },
    roster: ["a", "b", "c", "d"].map((id) => ({ id, name: id })),
    current: null,
    games: [{ id: "g_import", startedAt: "2026-09-06T00:00:00Z", endedAt: null, rule, seats: ["a", "b", "c", "d"], events: appendEvent([], { t: "riichi", who: 0 }, rule), settlement: null }],
  };
}

/** 検証を通る最小の Carry */
function carry(playerId, playerCount) {
  return {
    playerId,
    playerCount,
    games: 3,
    rankDist: [1, 1, 1, 0],
    pointsSum: 90000,
    ptSum: -1.5,
    yenSum: -300,
    maxPoints: 52000,
    effective: 24,
    agari: 6,
    houju: 3,
    riichi: 7,
    meld: 4,
    agariSum: 48000,
    houjuSum: 27000,
    tsumoAgari: 3,
    riichiAgari: 4,
    meldAgari: 1,
    damaAgari: 1,
    riichiAgariSum: 36000,
    meldAgariSum: 6000,
    damaAgariSum: 6000,
    riichiHouju: 1,
    meldHouju: 1,
    damaHouju: 1,
    riichiRyuukyoku: 2,
    meldRyuukyoku: 1,
    plus: 8,
    minus: 13,
    tobi: 0,
    chipSum: 0,
  };
}

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

  test("deleteGame は id の対局だけを消す", () => {
    const { st } = make();
    st.init();
    st.appendGame({ id: "g_1" });
    st.appendGame({ id: "g_2" });
    st.appendGame({ id: "g_3" });
    assert.deepEqual(st.deleteGame("g_2").map((g) => g.id), ["g_3", "g_1"]);
    assert.deepEqual(st.loadGames().map((g) => g.id), ["g_3", "g_1"]);
    // 無い id は何もしない
    assert.deepEqual(st.deleteGame("g_9").map((g) => g.id), ["g_3", "g_1"]);
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
    assert.deepEqual(out.carry, []);
  });

  test("版 2 の carry は増えた項目を 0 で埋めて上げる", () => {
    const old = { playerId: "a", playerCount: 3, games: 1, rankDist: [1, 0, 0, 0], pointsSum: 40000, ptSum: 10, yenSum: 300, effective: 8, agari: 2, houju: 1, riichi: 3, meld: 1, agariSum: 16000, houjuSum: 8000 };
    const out = migrate({ meta: { schemaVersion: 2 }, roster: [], current: null, games: [], carry: [old] });
    assert.equal(out.carry[0].agari, 2); // 元の値は残る
    assert.equal(out.carry[0].riichiAgari, 0);
    assert.equal(out.carry[0].maxPoints, null);
  });

  test("版 1 のデータに手で足した carry はマイグレーションで消えない", () => {
    const out = migrate({ meta: { schemaVersion: 1 }, roster: [], current: null, games: [], carry: [carry("a", 3)] });
    assert.deepEqual(out.carry, [carry("a", 3)]);
  });

  test("carry を含めて export / import できる", () => {
    const { st } = make();
    st.init();
    const data = backup();
    data.carry = [carry("a", 3)];
    st.importAll(data);
    assert.deepEqual(st.loadCarry(), data.carry);
    assert.deepEqual(st.exportAll().carry, data.carry);
  });

  test("export / import の往復", () => {
    const { st } = make();
    st.init();
    st.addPlayer("A");
    st.appendGame({ ...backup().games[0], id: "g_1" });
    const dump = st.exportAll();
    const { st: st2 } = make();
    st2.init();
    st2.importAll(dump);
    assert.equal(st2.loadRoster()[0].name, "A");
    assert.equal(st2.loadGames()[0].id, "g_1");
  });

  test("壊れたバックアップは保存前に拒否し、既存データを保持する", () => {
    const invalid = [
      (d) => { d.games = [null]; },
      (d) => { d.current = {}; },
      (d) => { d.roster = [null]; },
      (d) => { d.games[0].events = null; },
      (d) => { d.games[0].seats.pop(); },
      (d) => { d.games[0].rule.startPoints = "25000"; },
      (d) => { d.games[0].events[0].who = 4; },
      (d) => { d.games[0].events = [{ t: "adjust", deltas: [0, null, 0, 0] }]; },
      (d) => { d.games[0].events = [{ t: "agari", tsumo: true, from: null, winners: [], deltas: [0, 0, 0, 0] }]; },
      (d) => { d.games[0].settlement = {}; },
      (d) => { d.meta.schemaVersion = SCHEMA_VERSION + 1; },
      (d) => { d.meta.schemaVersion = "1"; },
      (d) => { d.carry = [null]; },
      (d) => { d.carry = [{ ...carry("a", 3), playerCount: 2 }]; },
      (d) => { d.carry = [{ ...carry("a", 3), playerId: "" }]; },
      (d) => { d.carry = [{ ...carry("a", 3), rankDist: [1, 0, 0] }]; },
      (d) => { d.carry = [{ ...carry("a", 3), games: 5 }]; }, // rankDist の合計と合わない
      (d) => { d.carry = [{ ...carry("a", 3), agari: 1.5 }]; },
      (d) => { d.carry = [{ ...carry("a", 3), ptSum: null }]; },
      (d) => { d.carry = [carry("a", 3), carry("a", 3)]; },
    ];
    for (const corrupt of invalid) {
      const { st } = make();
      st.init();
      st.addPlayer("保存済み");
      st.saveCurrent({ id: "existing" });
      const before = st.exportAll();
      const data = backup();
      corrupt(data);
      assert.throws(() => st.importAll(data), Error, String(corrupt));
      assert.deepEqual(st.exportAll(), before);
    }
  });

  test("インポートの各書き込みが容量不足で失敗したら元のデータへ戻す", () => {
    for (const failedKey of [KEYS.roster, KEYS.current, KEYS.games, KEYS.carry, KEYS.meta]) {
      const ls = memoryStorage();
      ls.setItem("mj.prefs", '{"sound":"off"}');
      const original = createStorage(ls);
      original.init();
      original.addPlayer("保存済み");
      original.saveCurrent({ id: "old_current" });
      original.appendGame({ id: "old_game" });
      const before = original.exportAll();
      const st = createStorage({
        ...ls,
        setItem(key, value) {
          if (key === failedKey) throw new Error("quota exceeded");
          ls.setItem(key, value);
        },
      });
      assert.throws(() => st.importAll(backup()), /quota exceeded/);
      assert.deepEqual(original.exportAll(), before);
      assert.equal(ls.getItem("mj.prefs"), '{"sound":"off"}');
    }
  });

  test("未来のスキーマを古い版としてマイグレーションしない", () => {
    assert.throws(() => migrate({ meta: { schemaVersion: SCHEMA_VERSION + 1 } }), /schemaVersion/);
  });

  test("3人・4人の全イベント種別と精算済みデータをそのまま復元できる", () => {
    for (const rule of Object.values(PRESETS)) {
      const data = backup();
      const g = data.games[0];
      g.rule = rule;
      g.seats = g.seats.slice(0, rule.playerCount);
      const zero = new Array(rule.playerCount).fill(0);
      const events = [
        { t: "riichi", who: 0 },
        { t: "meld", who: 1, value: true },
        ...(rule.playerCount === 3 ? [{ t: "kita", who: 2, delta: 1 }] : []),
        { t: "agari", tsumo: false, from: 1, winners: [{ who: 0, han: 1, fu: 30, yakumanCount: 0, sekinin: null, chips: 0 }] },
        { t: "agari", tsumo: true, from: null, winners: [{ who: 0, han: 0, fu: 0, yakumanCount: 1, sekinin: { who: 1, yakumanCount: 1 }, chips: 0 }] },
        ...["exhaustive", "abortive", "nagashi"].map((type) => ({ t: "ryuukyoku", type, tenpai: [0], nagashiBy: type === "nagashi" ? [0] : [], abortiveKind: type === "abortive" ? "kyuushu" : null })),
        { t: "chombo", who: 0 },
        { t: "adjust", note: "修正", deltas: zero },
        { t: "end" },
      ];
      g.events = events.reduce((list, event) => appendEvent(list, event, rule), []);
      g.settlement = computeSettlement(g);
      const before = structuredClone(data);
      const { st } = make();
      st.importAll(data);
      assert.deepEqual(st.loadGames(), data.games);
      assert.deepEqual(data, before);
    }
  });
});

// ---- schemaVersion 4（チップ） ---------------------------------------------------

describe("チップの保存", () => {
  test("版 3 の繰越には chipSum: 0 を足す", () => {
    const old = { ...carry("a", 4) };
    delete old.chipSum;
    const out = migrate({ meta: { schemaVersion: 3 }, roster: [], current: null, games: [], carry: [old] });
    assert.equal(out.meta.schemaVersion, 4);
    assert.equal(out.carry[0].chipSum, 0);
    assert.equal(out.carry[0].agari, 6);
  });
  test("和了の chips と adjust.chips を検証し、往復できる", () => {
    const rule = makeRule({ chips: true, chipRate: 100, tobiPrize: 1, yakitori: 1 });
    const data = backup();
    const g = data.games[0];
    g.rule = rule;
    const events = [
      { t: "agari", tsumo: true, from: null, winners: [{ who: 0, han: 3, fu: 30, yakumanCount: 0, sekinin: null, chips: 2 }] },
      { t: "adjust", note: "チップ", deltas: [0, 0, 0, 0], chips: [1, -1, 0, 0] },
      { t: "end" },
    ];
    g.events = events.reduce((list, event) => appendEvent(list, event, rule), []);
    g.settlement = computeSettlement(g);
    // ツモで 2枚ずつ受け取り、adjust で +1/−1、焼き鳥は 1・2・3 が他の各人に 1枚
    assert.deepEqual(g.settlement.chips, [6 + 1 + 3, -2 - 1 - 1, -2 - 1, -2 - 1]);
    const { st } = make();
    st.importAll(data);
    assert.deepEqual(st.loadGames(), data.games);

    const bad1 = structuredClone(data);
    bad1.games[0].events[0].winners[0].chips = -1;
    assert.throws(() => prepareImport(bad1), /winner.chips/);
    const bad2 = structuredClone(data);
    bad2.games[0].events[1].chips = [1, 0];
    assert.throws(() => prepareImport(bad2), /adjust.chips/);
  });
  test("廃止した項目や新しい選択肢の不正値は検証で落とす", () => {
    const data = backup();
    data.games[0].rule = { ...data.games[0].rule, sanmaScoring: "unknown" };
    assert.throws(() => prepareImport(data), /sanmaScoring/);
    const ok = backup();
    ok.games[0].rule = { ...ok.games[0].rule, nishiIri: true, rateBase: "rawScore", abortiveRyuukyoku: ["kyuushu"] };
    assert.doesNotThrow(() => prepareImport(ok));
  });
});
