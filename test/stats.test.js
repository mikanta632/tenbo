// 成績集計（stats.js）のテスト。docs/design.md §8.5

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gameStats, aggregate, derive, playerGames, combineGames } from "../src/stats.js";
import { makeRule } from "../src/rules.js";
import { appendEvent } from "../src/edit.js";

const R4 = makeRule();
function w(who, han, fu) {
  return { who, han, fu, yakumanCount: 0, sekinin: null, chips: 0 };
}
const ron = (who, from, han, fu) => ({ t: "agari", tsumo: false, from, winners: [w(who, han, fu)] });
const tsumo = (who, han, fu) => ({ t: "agari", tsumo: true, from: null, winners: [w(who, han, fu)] });
const riichi = (who) => ({ t: "riichi", who });
const meld = (who, value = true) => ({ t: "meld", who, value });
const exhaustive = (tenpai) => ({ t: "ryuukyoku", type: "exhaustive", abortiveKind: null, tenpai, nagashiBy: [] });
const chombo = (who) => ({ t: "chombo", who });
function game(id, seats, ...events) {
  let list = [];
  for (const e of events) list = appendEvent(list, e, R4);
  return { id, rule: R4, seats, events: list, settlement: null };
}

describe("gameStats", () => {
  test("有効局・和了・放銃・リーチ・副露を数える。チョンボの局は除外", () => {
    const g = game(
      "g1",
      ["a", "b", "c", "d"],
      riichi(1), ron(1, 2, 3, 30), // 東1: 1 リーチ和了、2 放銃
      meld(3), tsumo(0, 1, 30), // 東2（親1）: 0 ツモ、3 副露
      riichi(2), chombo(0), // 東3: チョンボ → 除外（2 のリーチも数えない）
      exhaustive([0, 3]), // 東3 やり直し
    );
    const { seats } = gameStats(g);
    assert.deepEqual(seats.map((s) => s.effective), [3, 3, 3, 3]);
    assert.deepEqual(seats.map((s) => s.agari), [1, 1, 0, 0]);
    assert.deepEqual(seats.map((s) => s.houju), [0, 0, 1, 0]);
    assert.deepEqual(seats.map((s) => s.riichi), [0, 1, 0, 0]);
    assert.deepEqual(seats.map((s) => s.meld), [0, 0, 0, 1]);
    assert.equal(seats[1].agariSum, 3900);
    assert.equal(seats[2].houjuSum, 3900);
    assert.equal(seats[0].agariSum, 1100); // 子ツモ 30符1翻 300/500 = 1100
  });
  test("順位と pt は精算から取る", () => {
    const g = game("g1", ["a", "b", "c", "d"], ron(0, 1, 5, 30));
    const { seats } = gameStats(g);
    assert.equal(seats[0].rank, 0);
    assert.equal(seats[1].rank, 3);
    assert.equal(seats.reduce((a, s) => a + s.pt, 0), 0);
  });
});

describe("aggregate / derive", () => {
  test("プレイヤー ID ごとに合算し、率と平均を出す", () => {
    const g1 = game("g1", ["a", "b", "c", "d"], ron(0, 1, 5, 30), ron(0, 2, 1, 30));
    const g2 = game("g2", ["b", "a", "c", "d"], tsumo(1, 5, 30)); // a は席 1
    const m = aggregate([g1, g2]);
    const a = derive(m.get("a"));
    assert.equal(a.games, 2);
    assert.equal(a.rankDist[0], 2);
    assert.equal(a.avgRank, 1);
    assert.equal(a.effective, 3);
    assert.equal(a.agariRate, 1);
    assert.equal(a.houjuRate, 0);
    // 東1 1本場の親ロン 30符1翻は 1500 + 300
    assert.equal(a.avgAgari, (12000 + 1800 + 8000) / 3);
    const b = derive(m.get("b"));
    assert.equal(b.houjuRate, 1 / 3);
    assert.equal(b.avgHouju, 12000);
    assert.equal(b.avgAgari, null);
    assert.equal(a.ptSum + b.ptSum + derive(m.get("c")).ptSum + derive(m.get("d")).ptSum, 0);
  });
  test("対局が無ければ空", () => {
    assert.equal(aggregate([]).size, 0);
  });
});

describe("playerGames", () => {
  test("そのプレイヤーが出た対局だけを、席・順位・pt 付きで返す", () => {
    const g1 = game("g1", ["a", "b", "c", "d"], ron(0, 1, 5, 30));
    const g2 = game("g2", ["b", "a", "c", "d"], tsumo(1, 5, 30));
    const g3 = game("g3", ["b", "e", "c", "d"], tsumo(0, 1, 30));
    const list = playerGames([g3, g2, g1], "a");
    assert.deepEqual(list.map((x) => x.game.id), ["g2", "g1"]);
    assert.deepEqual(list.map((x) => x.seat), [1, 0]);
    assert.deepEqual(list.map((x) => x.rank), [0, 0]);
    assert.equal(list[1].points, 25000 + 12000);
    assert.equal(list[0].agari, 1);
    assert.equal(list[0].effective, 1);
    assert.deepEqual(playerGames([g1], "zzz"), []);
  });
});

describe("combineGames", () => {
  test("選んだ対局の収支を合算し、席の違う同じプレイヤーをまとめる", () => {
    const g1 = game("g1", ["a", "b", "c", "d"], ron(0, 1, 4, 30), ron(0, 2, 4, 30), { t: "end" });
    const g2 = game("g2", ["b", "a", "d", "c"], ron(0, 1, 4, 30), { t: "end" });
    const { players, transfers } = combineGames([g1, g2]);
    assert.deepEqual(players.map((p) => p.playerId).sort(), ["a", "b", "c", "d"]);
    for (const p of players) assert.equal(p.games, 2);
    // 収支の多い順。合計は 0（ゼロサム）
    assert.deepEqual(
      players.map((p) => p.yen),
      [...players.map((p) => p.yen)].sort((x, y) => y - x),
    );
    assert.equal(players.reduce((a, p) => a + p.yen, 0), 0);
    // 各対局の合算値と一致する
    const expect = new Map();
    for (const g of [g1, g2]) {
      for (const s of gameStats(g).seats) expect.set(s.playerId, (expect.get(s.playerId) || 0) + s.yen);
    }
    for (const p of players) assert.equal(p.yen, expect.get(p.playerId));
    // 支払いは受取と支払を突き合わせ、卓外は出ない
    assert.ok(transfers.length > 0);
    for (const t of transfers) assert.ok(t.from !== null && t.to !== null);
    const net = new Array(players.length).fill(0);
    for (const t of transfers) {
      net[t.to] += t.amount;
      net[t.from] -= t.amount;
    }
    assert.deepEqual(net, players.map((p) => p.yen));
  });

  test("対局が無ければ空", () => {
    assert.deepEqual(combineGames([]), { players: [], transfers: [] });
  });
});
