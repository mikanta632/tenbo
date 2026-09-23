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

// ---- 同点の等分（§7 tieBreak: split） --------------------------------------------

describe("同点の等分", () => {
  const SPLIT = makeRule({ tieBreak: "split" });
  test("同点の 2人でウマ（トップならオカも）を等分する", () => {
    const g = game(SPLIT, adjust([5000, 5000, -5000, -5000]));
    const s = computeSettlement(g);
    assert.deepEqual(s.points, [30000, 30000, 20000, 20000]);
    // 表示上の順位は起家優先のまま
    assert.deepEqual(s.ranks, [0, 1, 2, 3]);
    // 上位組: (20 + 10 + オカ 20) / 2 = 25、下位組: −10 + (−10 − 20) / 2 = −25
    assert.deepEqual(s.pt, [25, 25, -25, -25]);
    // 起家優先ならトップが端数とオカを引き受ける
    assert.deepEqual(computeSettlement(game(R4, adjust([5000, 5000, -5000, -5000]))).pt, [40, 10, -20, -30]);
  });
  test("小数保持でも同じ", () => {
    const g = game({ ...SPLIT, ptRounding: "none" }, adjust([5000, 5000, -5000, -5000]));
    assert.deepEqual(computeSettlement(g).pt, [25, 25, -25, -25]);
  });
  test("全員同点なら全員 0", () => {
    assert.deepEqual(computeSettlement(game(SPLIT)).pt, [0, 0, 0, 0]);
    assert.deepEqual(computeSettlement(game({ ...SPLIT, ptRounding: "none" })).pt, [0, 0, 0, 0]);
  });
  test("五捨六入の端数はトップの組で等分する", () => {
    // 0 と 1 が 30,000 で並び、2 は 22,600、3 は 17,400
    const g = game(SPLIT, adjust([5000, 5000, -2400, -7600]));
    const s = computeSettlement(g);
    // 2: −7.4 → −7 −10 = −17、3: −12.6 → −13 −20 = −33、残り 50 を 2人で
    assert.deepEqual(s.pt, [25, 25, -17, -33]);
    assert.equal(s.pt.reduce((a, b) => a + b, 0), 0);
  });
});

describe("五捨六入でもトップに卓外の分を吸わせない", () => {
  test("残り供託（remain）の分だけ pt の合計がマイナスになり、場に残した分は卓外への支払いになる", () => {
    const rule = makeRule({ finalKyotaku: "remain", rate: 100 });
    const s = computeSettlement(game(rule, riichi(0), adjust([15000, 5000, -5000, -15000])));
    assert.deepEqual(s.points, [39000, 30000, 20000, 10000]);
    // 1: 0 + 10、2: −10 − 10、3: −20 − 20。トップは丸めない合計 −1 から他を引いて 49（吸わせると 50）
    assert.deepEqual(s.pt, [49, 10, -20, -40]);
    assert.equal(s.pt.reduce((a, b) => a + b, 0), -1);
    // 卓外への支払いは 1pt × 100円（誰が払うかは経路の組み方による）
    assert.equal(s.transfers.filter((t) => t.to === null).reduce((a, t) => a + t.amount, 0), 100);
    assert.equal(s.transfers.some((t) => t.from === null), false);
  });
  test("手動修正の卓外差額は pt の合計のずれとして残り、卓外からの受取になる", () => {
    const rule = makeRule({ rate: 100 });
    const s = computeSettlement(game(rule, adjust([1000, 0, 0, 0])));
    assert.equal(s.outsideDiff, 1000);
    assert.deepEqual(s.pt, [36, 5, -15, -25]);
    assert.equal(s.pt.reduce((a, b) => a + b, 0), 1);
    assert.equal(s.transfers.filter((t) => t.from === null).reduce((a, t) => a + t.amount, 0), 100);
    assert.equal(s.transfers.some((t) => t.to === null), false);
  });
  test("小数保持（none）と合計が一致する", () => {
    const events = [riichi(0), adjust([15000, 5000, -5000, -15000])];
    const round = computeSettlement(game(makeRule({ finalKyotaku: "remain" }), ...events)).pt;
    const exact = computeSettlement(game(makeRule({ finalKyotaku: "remain", ptRounding: "none" }), ...events)).pt;
    assert.equal(round.reduce((a, b) => a + b, 0), exact.reduce((a, b) => a + b, 0));
  });
});

describe("同点トップと残り供託", () => {
  const SPLIT = makeRule({ tieBreak: "split" });
  test("トップが並んでいれば、残り供託は並んだ者で等分する", () => {
    const g = game(SPLIT, riichi(2), riichi(3), adjust([5000, 5000, -6000, -4000]));
    const s = computeSettlement(g);
    assert.deepEqual(s.points, [31000, 31000, 18000, 20000]);
    assert.equal(s.kyotakuToTop, 2000);
    assert.equal(s.pt[0], s.pt[1]);
    // 起家優先なら起家に近い方が全部受け取る
    assert.deepEqual(computeSettlement(game(R4, riichi(2), riichi(3), adjust([5000, 5000, -6000, -4000]))).points, [32000, 30000, 18000, 20000]);
  });
  test("割り切れない端数は起家に近い方へ渡し、同点の扱いは崩さない", () => {
    const g = game(SPLIT, riichi(3), adjust([5000, 5000, 5000, -15000]));
    const s = computeSettlement(g);
    assert.deepEqual(s.points, [30400, 30300, 30300, 9000]);
    assert.deepEqual(s.ranks, [0, 1, 2, 3]);
    assert.equal(s.pt[0], s.pt[1]);
    assert.equal(s.pt[1], s.pt[2]);
  });
});

// ---- 祝儀（§7） -----------------------------------------------------------------

describe("チップの精算", () => {
  const CH = makeRule({ chips: true, chipRate: 100 });
  const wc = (who, han, fu, chips) => ({ who, han, fu, yakumanCount: 0, sekinin: null, chips });
  test("円は pt × レート + チップ × 単価", () => {
    const g = game(CH, { t: "agari", tsumo: true, from: null, winners: [wc(1, 5, 30, 2)] });
    const s = computeSettlement(g);
    assert.deepEqual(s.points, [21000, 33000, 23000, 23000]);
    assert.deepEqual(s.chips, [-2, 6, -2, -2]);
    assert.deepEqual(s.chipYen, [-200, 600, -200, -200]);
    assert.deepEqual(s.pt, [-29, 43, 3, -17]);
    assert.deepEqual(s.yen, [-1650, 2750, -50, -1050]);
    assert.equal(s.yen.reduce((a, b) => a + b, 0), 0);
  });
  test("rule.chips が偽なら和了に枚数があっても 0", () => {
    const g = game(R4, { t: "agari", tsumo: true, from: null, winners: [wc(1, 5, 30, 2)] });
    const s = computeSettlement(g);
    assert.deepEqual(s.chips, [0, 0, 0, 0]);
    assert.deepEqual(s.yen, s.pt.map((p) => p * 50));
  });
  test("焼き鳥: 和了ゼロの人が他の各人に払う。流し満貫は設定で数える", () => {
    const rule = { ...CH, yakitori: 1 };
    const g = game(rule, ron(1, 2, 1, 30), { t: "end" });
    const s = computeSettlement(g);
    assert.deepEqual(s.yakitoriSeats, [0, 2, 3]);
    assert.deepEqual(s.chips, [-1, 3, -1, -1]);
    const nagashi = { t: "ryuukyoku", type: "nagashi", abortiveKind: null, tenpai: [], nagashiBy: [2] };
    assert.deepEqual(computeSettlement(game(rule, nagashi, { t: "end" })).yakitoriSeats, [0, 1, 3]);
    assert.deepEqual(computeSettlement(game({ ...rule, yakitoriNagashi: false }, nagashi, { t: "end" })).yakitoriSeats, [0, 1, 2, 3]);
    // チョンボで流れた局の和了は数えない（そもそも和了イベントにならない）
    assert.deepEqual(computeSettlement(game(rule, { t: "chombo", who: 1 }, { t: "end" })).yakitoriSeats, [0, 1, 2, 3]);
    // yakitori が 0 なら無し
    assert.deepEqual(computeSettlement(game(CH, ron(1, 2, 1, 30), { t: "end" })).yakitoriSeats, []);
  });
  test("トビ賞は畳み込みで動いた枚数に含まれ、飛んだ席を返す", () => {
    const rule = { ...CH, tobiPrize: 2 };
    const g = game(rule, adjust([0, 0, -20000, 20000]), { t: "agari", tsumo: false, from: 2, winners: [wc(3, 5, 30, 0)] });
    const s = computeSettlement(g);
    assert.deepEqual(s.tobiSeats, [2]);
    assert.deepEqual(s.chips, [0, 0, -2, 2]);
    assert.deepEqual(computeSettlement(game(CH, adjust([0, 0, -20000, 20000]), ron(3, 2, 5, 30))).tobiSeats, []);
  });
  test("adjust の chips は精算に入る（合計が 0 でなくてもよい）", () => {
    const g = game(CH, { t: "adjust", note: "", deltas: [0, 0, 0, 0], chips: [1, 0, 0, 0] });
    const s = computeSettlement(g);
    assert.deepEqual(s.chips, [1, 0, 0, 0]);
    assert.equal(s.yen[0], s.pt[0] * 50 + 100);
    assert.equal(s.outsideChips, 1);
  });
});
