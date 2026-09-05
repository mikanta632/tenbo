// 精算（settlement.js）のテスト。docs/design.md §7

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { round56, settleTransfers, computeSettlement } from "../src/settlement.js";
import { makeRule } from "../src/rules.js";
import { appendEvent } from "../src/edit.js";

const R4 = makeRule();
function w(who, han, fu) {
  return { who, han, fu, yakumanCount: 0, sekinin: null, chips: 0 };
}
const ron = (who, from, han, fu) => ({ t: "agari", tsumo: false, from, winners: [w(who, han, fu)] });
const riichi = (who) => ({ t: "riichi", who });
const adjust = (deltas) => ({ t: "adjust", note: "", deltas });
function game(rule, ...events) {
  let list = [];
  for (const e of events) list = appendEvent(list, e, rule);
  return { id: "g", rule, seats: ["a", "b", "c", "d"].slice(0, rule.playerCount), events: list, settlement: null };
}

describe("round56（五捨六入）", () => {
  test("正の値", () => {
    assert.equal(round56(0), 0);
    assert.equal(round56(500), 0);
    assert.equal(round56(600), 1);
    assert.equal(round56(2500), 2);
    assert.equal(round56(2600), 3);
    assert.equal(round56(12000), 12);
  });
  test("負の値は絶対値で丸めて符号を戻す", () => {
    assert.equal(round56(-500), 0);
    assert.equal(round56(-600), -1);
    assert.equal(round56(-2500), -2);
    assert.equal(round56(-2600), -3);
    assert.equal(round56(-17400), -17);
  });
});

describe("settleTransfers", () => {
  test("貪欲法で最小回数に落とす", () => {
    const t = settleTransfers([3000, 1000, -1500, -2500]);
    assert.deepEqual(t, [
      { from: 3, to: 0, amount: 2500 },
      { from: 2, to: 0, amount: 500 },
      { from: 2, to: 1, amount: 1000 },
    ]);
    const sum = (i) => t.reduce((a, x) => a + (x.to === i ? x.amount : 0) - (x.from === i ? x.amount : 0), 0);
    assert.deepEqual([0, 1, 2, 3].map(sum), [3000, 1000, -1500, -2500]);
  });
  test("合計が 0 でなければ卓外との授受を出す", () => {
    assert.deepEqual(settleTransfers([1000, -400, 0, 0]), [
      { from: 1, to: 0, amount: 400 },
      { from: null, to: 0, amount: 600 },
    ]);
  });
  test("全員 0 なら空", () => {
    assert.deepEqual(settleTransfers([0, 0, 0, 0]), []);
  });
});

describe("computeSettlement", () => {
  test("五捨六入: 素点 40000/30000/20000/10000 → uma とオカでトップが端数を引き受ける", () => {
    // 東1: 3 が 0 から ... 手作りの点数にするため adjust で並べる
    const g = game(R4, adjust([15000, 5000, -5000, -15000]));
    const s = computeSettlement(g);
    assert.deepEqual(s.points, [40000, 30000, 20000, 10000]);
    assert.deepEqual(s.ranks, [0, 1, 2, 3]);
    // 2位: 0 + 10 = 10、3位: −10 −10 = −20、4位: −20 −20 = −40、トップは残り +50
    assert.deepEqual(s.pt, [50, 10, -20, -40]);
    assert.equal(s.pt.reduce((a, b) => a + b, 0), 0);
    assert.deepEqual(s.yen, [2500, 500, -1000, -2000]);
    assert.equal(s.oka, 20);
  });
  test("五捨六入の境界: 32,500 は +2、32,600 は +3", () => {
    const g1 = game(R4, adjust([7500, 0, -2500, -5000]));
    const s1 = computeSettlement(g1);
    // 2位 0: 25000 → −5 +10 = 5、3位 2: 22500 → −7.5 → −7 −10 = −17、4位 3: 20000 → −10 −20 = −30
    assert.deepEqual(s1.ranks, [0, 1, 2, 3]);
    assert.deepEqual(s1.pt.slice(1), [5, -17, -30]);
    assert.equal(s1.pt[0], 42);
    const g2 = game(R4, adjust([0, 2600, -2600, 0]));
    const s2 = computeSettlement(g2);
    // 1: 27600 → −2.4 → −2、0: 25000 → −5、3: 25000 → −5、2: 22400 → −7.6 → −8
    assert.deepEqual(s2.ranks, [1, 0, 3, 2]);
    assert.equal(s2.pt[0], -5 + 10);
    assert.equal(s2.pt[3], -5 - 10);
    assert.equal(s2.pt[2], -8 - 20);
    assert.equal(s2.pt[1], -(s2.pt[0] + s2.pt[2] + s2.pt[3]));
  });
  test("小数保持: トップに オカ、合計は 0", () => {
    const rule = makeRule({ ptRounding: "none" });
    const g = game(rule, adjust([7500, 0, -2500, -5000]));
    const s = computeSettlement(g);
    assert.deepEqual(s.pt, [2.5 + 20 + 20, -5 + 10, -7.5 - 10, -10 - 20]);
    assert.equal(s.pt.reduce((a, b) => a + b, 0), 0);
  });
  test("終局時の供託はトップに加算（finalKyotaku: top）", () => {
    const g = game(R4, riichi(1), ron(0, 2, 1, 30), riichi(3), { t: "end" });
    // 1 のリーチ棒は 0 が回収済み。3 のリーチ棒 1本が残る → トップ 0 に +1000
    const s = computeSettlement(g);
    assert.equal(s.kyotakuToTop, 1000);
    assert.equal(s.kyotakuRemain, 0);
    assert.equal(s.points[0], 25000 + 1500 + 1000 + 1000);
  });
  test("finalKyotaku: remain は場に残す", () => {
    const rule = makeRule({ finalKyotaku: "remain" });
    const g = game(rule, riichi(3), { t: "end" });
    const s = computeSettlement(g);
    assert.equal(s.kyotakuRemain, 1);
    assert.equal(s.kyotakuToTop, 0);
    assert.equal(s.points[3], 24000);
  });
  test("卓外差額は adjust の合計", () => {
    const g = game(R4, adjust([100, 0, 0, 0]), adjust([0, -300, 0, 0]));
    assert.equal(computeSettlement(g).outsideDiff, -200);
  });
  test("同点は起家に近い方が上位", () => {
    const g = game(R4);
    const s = computeSettlement(g);
    assert.deepEqual(s.ranks, [0, 1, 2, 3]);
    assert.deepEqual(s.pt, [-(-5 + 10 - 5 - 10 - 5 - 20), 5, -15, -25]);
  });
  test("3人麻雀: uma 30/−10/−20", () => {
    const rule = makeRule({ playerCount: 3, length: 6, startPoints: 35000, returnPoints: 40000, uma: [30, -10, -20] });
    const g = game(rule, adjust([10000, 0, -10000]));
    const s = computeSettlement(g);
    // 2位 1: 35000 → −5 −10 = −15、3位 2: 25000 → −15 −20 = −35、トップ +50
    assert.deepEqual(s.pt, [50, -15, -35]);
    assert.equal(s.oka, 15);
  });
});
