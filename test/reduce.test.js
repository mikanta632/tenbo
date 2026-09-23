// 段階1: 畳み込み（reduce.js）と編集・再計算（edit.js）のテスト
// docs/design.md §4, §5, §8.4

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  applyEvent,
  reduce,
  reduceAll,
  kyokuGroups,
  dealerOf,
  seatWind,
  roundWind,
  kyokuNumber,
  ranksOf,
  canRiichi,
  agariYameAvailable,
  agariYameAvailableAfter,
} from "../src/reduce.js";
import {
  computeDeltas,
  appendEvent,
  recalc,
  replaceEvent,
  insertEvent,
  insertIndexOf,
  removeEvent,
  undoLast,
  deleteKyoku,
  replaceKyokuEnd,
  withEvents,
} from "../src/edit.js";
import { makeRule } from "../src/rules.js";
import { kyokuName } from "../src/ui/format.js";

const R4 = makeRule();
const R3 = makeRule({ playerCount: 3, length: 6, startPoints: 35000, returnPoints: 40000, uma: [20, 0, -20] });

// ---- イベント生成ヘルパー（deltas は持たない。appendEvent で埋める） ----

function w(who, han, fu) {
  return { who, han, fu, yakumanCount: 0, sekinin: null, chips: 0 };
}
const riichi = (who) => ({ t: "riichi", who });
const meld = (who, value = true) => ({ t: "meld", who, value });
const kita = (who, delta = 1) => ({ t: "kita", who, delta });
const ron = (who, from, han, fu) => ({ t: "agari", tsumo: false, from, winners: [w(who, han, fu)] });
const tsumo = (who, han, fu) => ({ t: "agari", tsumo: true, from: null, winners: [w(who, han, fu)] });
const doubleRon = (from, ...winners) => ({ t: "agari", tsumo: false, from, winners });
const exhaustive = (tenpai) => ({ t: "ryuukyoku", type: "exhaustive", abortiveKind: null, tenpai, nagashiBy: [] });
const abortive = (kind = "kyuushu") => ({ t: "ryuukyoku", type: "abortive", abortiveKind: kind, tenpai: [], nagashiBy: [] });
const nagashi = (nagashiBy, tenpai) => ({ t: "ryuukyoku", type: "nagashi", abortiveKind: null, tenpai, nagashiBy });
const chombo = (who) => ({ t: "chombo", who });
const adjust = (deltas, note = "") => ({ t: "adjust", note, deltas });
const end = () => ({ t: "end" });

/** イベントを順に append して deltas 付きの列を作る */
function build(rule, ...events) {
  let list = [];
  for (const e of events) list = appendEvent(list, e, rule);
  return list;
}
function run(rule, ...events) {
  return reduce(build(rule, ...events), rule);
}

// ---- 導出ヘルパー ----------------------------------------------------------

describe("導出ヘルパー", () => {
  test("親・自風・場・局番号（4人）", () => {
    assert.equal(dealerOf(0, 4), 0);
    assert.equal(dealerOf(3, 4), 3);
    assert.equal(dealerOf(4, 4), 0);
    assert.equal(seatWind(0, 1, 4), 3); // 東2局の起家は北家
    assert.equal(seatWind(1, 1, 4), 0);
    assert.equal(roundWind(3, 4), 0);
    assert.equal(roundWind(4, 4), 1);
    assert.equal(kyokuNumber(4, 4), 1);
    assert.equal(kyokuNumber(7, 4), 4);
  });
  test("親・場・局番号（3人）", () => {
    assert.equal(dealerOf(3, 3), 0);
    assert.equal(roundWind(2, 3), 0);
    assert.equal(roundWind(3, 3), 1);
    assert.equal(kyokuNumber(5, 3), 3);
  });
  test("順位: 同点は起家に近い方が上位", () => {
    assert.deepEqual(ranksOf([25000, 30000, 25000, 20000]), [1, 0, 2, 3]);
  });
});

// ---- 初期状態と局中イベント -------------------------------------------

describe("初期状態", () => {
  test("持ち点・局・本場・供託・round", () => {
    const s = initialState(R4);
    assert.deepEqual(s, {
      points: [25000, 25000, 25000, 25000],
      kyoku: 0,
      honba: 0,
      kyotaku: 0,
      over: false,
      chips: [0, 0, 0, 0],
      round: { riichi: [false, false, false, false], melded: [false, false, false, false], kita: [0, 0, 0, 0] },
    });
  });
  test("3人", () => {
    const s = initialState(R3);
    assert.deepEqual(s.points, [35000, 35000, 35000]);
    assert.equal(s.round.riichi.length, 3);
  });
});

describe("1. リーチの即時反映", () => {
  test("持ち点が 1000 減り、供託が 1 増える", () => {
    const s = run(R4, riichi(1));
    assert.deepEqual(s.points, [25000, 24000, 25000, 25000]);
    assert.equal(s.kyotaku, 1);
    assert.deepEqual(s.round.riichi, [false, true, false, false]);
    assert.equal(s.kyoku, 0);
    assert.equal(s.honba, 0);
  });
  test("applyEvent は元の state を変更しない", () => {
    const s0 = initialState(R4);
    const s1 = applyEvent(s0, riichi(0), R4);
    assert.equal(s0.points[0], 25000);
    assert.equal(s0.kyotaku, 0);
    assert.equal(s1.points[0], 24000);
  });
  test("1000点未満はリーチできない（発行時に拒否）", () => {
    const events = build(R4, adjust([0, -24100, 24100, 0]));
    const s = reduce(events, R4);
    assert.equal(s.points[1], 900);
    assert.equal(canRiichi(s, 1, R4), false);
    assert.equal(canRiichi(s, 0, R4), true);
    assert.throws(() => appendEvent(events, riichi(1), R4), /1000点未満/);
    // ちょうど 1000 は可
    const s2 = reduce(build(R4, adjust([0, -24000, 24000, 0])), R4);
    assert.equal(canRiichi(s2, 1, R4), true);
    // riichiUnderThousand が真なら可
    const rule = makeRule({ riichiUnderThousand: true });
    assert.equal(canRiichi(s, 1, rule), true);
    const after = appendEvent(events, riichi(1), rule);
    assert.equal(reduce(after, rule).points[1], -100);
  });
  test("副露と北抜きは持ち点を動かさない", () => {
    const s = run(R3, meld(1), kita(2), kita(2), kita(2, -1));
    assert.deepEqual(s.points, [35000, 35000, 35000]);
    assert.deepEqual(s.round.melded, [false, true, false]);
    assert.deepEqual(s.round.kita, [0, 0, 1]);
    const s2 = run(R3, meld(1), meld(1, false));
    assert.deepEqual(s2.round.melded, [false, false, false]);
  });
});

// ---- 供託 -----------------------------------------------------------------

describe("2. 供託の回収", () => {
  test("複数局にまたがる供託を和了者が全額回収する", () => {
    // 東1: 1 がリーチ、全員ノーテン流局（供託 1 が残り、親は流れる）
    // 東2: 2 がリーチ、途中流局（供託 2、親は連荘、2本場）
    // 東2 2本場: 3 が 0 からロン 30符1翻
    const s = run(R4, riichi(1), exhaustive([]), riichi(2), abortive(), ron(3, 0, 1, 30));
    // 3 の収入: 1000 + 本場 600 + 供託 2000
    assert.equal(s.points[3], 25000 + 1000 + 600 + 2000);
    assert.equal(s.points[0], 25000 - 1600);
    assert.equal(s.points[1], 24000);
    assert.equal(s.points[2], 24000);
    assert.equal(s.kyotaku, 0);
    assert.equal(s.points.reduce((a, b) => a + b, 0), 100000);
  });
  test("リーチ者本人が和了しても自分のリーチ棒を回収する", () => {
    const s = run(R4, riichi(1), tsumo(1, 2, 20));
    // 1000 供出 → 400/700 ツモ = +1500 → 供託 1000 回収
    assert.equal(s.points[1], 25000 - 1000 + 1500 + 1000);
    assert.equal(s.kyotaku, 0);
  });
  test("ダブロンの供託は下家取り", () => {
    // 親 0、放銃者 2、和了者 3 と 0。供託 2 は 3（2 から反時計回りで最初）へ
    const s = run(R4, riichi(0), riichi(1), doubleRon(2, w(3, 1, 30), w(0, 1, 30)));
    assert.equal(s.points[3], 25000 + 1000 + 2000);
    assert.equal(s.points[0], 24000 + 1500);
    assert.equal(s.kyotaku, 0);
  });
  test("multiRonKyotaku: split は等分し、端数は下家取りの者へ", () => {
    const rule = makeRule({ multiRonKyotaku: "split" });
    const s = run(rule, riichi(1), riichi(2), riichi(3), doubleRon(2, w(3, 1, 30), w(0, 1, 30)));
    // 供託 3000 → 1500 ずつ
    assert.equal(s.points[3], 24000 + 1000 + 1500);
    assert.equal(s.points[0], 25000 + 1500 + 1500);
    // 供託 1000 を 3人で: 300 ずつ、端数 100 は下家取りの者（3）へ
    const s2 = run(rule, riichi(1), doubleRon(2, w(3, 1, 30), w(0, 1, 30), w(1, 1, 30)));
    assert.equal(s2.points[3], 25000 + 1000 + 400);
    assert.equal(s2.points[0], 25000 + 1500 + 300);
    assert.equal(s2.points[1], 24000 + 1000 + 300);
    assert.equal(s2.points.reduce((a, b) => a + b, 0), 100000);
  });
});

// ---- 連荘 -----------------------------------------------------------------

describe("3. 連荘", () => {
  test("親の和了で本場が増え局が据え置かれる", () => {
    const s = run(R4, tsumo(0, 1, 30));
    assert.equal(s.kyoku, 0);
    assert.equal(s.honba, 1);
    const s2 = run(R4, tsumo(0, 1, 30), ron(0, 1, 1, 30));
    assert.equal(s2.kyoku, 0);
    assert.equal(s2.honba, 2);
    // 2局目は 1本場: 1500 + 300
    assert.equal(s2.points[1], 25000 - 500 - 1800);
  });
  test("子の和了で局が進み本場が 0 になる", () => {
    const s = run(R4, tsumo(0, 1, 30), tsumo(0, 1, 30), ron(2, 1, 1, 30));
    assert.equal(s.kyoku, 1);
    assert.equal(s.honba, 0);
    assert.equal(dealerOf(s.kyoku, 4), 1);
  });
  test("ダブロンに親が含まれれば連荘", () => {
    const s = run(R4, doubleRon(2, w(3, 1, 30), w(0, 1, 30)));
    assert.equal(s.kyoku, 0);
    assert.equal(s.honba, 1);
  });
  test("頭ハネで親が和了から外れれば連荘しない", () => {
    const rule = makeRule({ multiRon: false });
    const s = run(rule, doubleRon(2, w(3, 1, 30), w(0, 1, 30)));
    assert.equal(s.kyoku, 1);
    assert.equal(s.honba, 0);
    assert.deepEqual(s.points, [25000, 25000, 24000, 26000]);
  });
  test("round は局末でリセットされる", () => {
    const s = run(R4, riichi(1), meld(2), tsumo(0, 1, 30));
    assert.deepEqual(s.round.riichi, [false, false, false, false]);
    assert.deepEqual(s.round.melded, [false, false, false, false]);
  });
});

// ---- 流局の3タイプ ------------------------------------------------------

describe("4. 流局の3タイプ", () => {
  test("exhaustive: 親テンパイで連荘、テンパイ料あり", () => {
    const s = run(R4, exhaustive([0, 2]));
    assert.deepEqual(s.points, [26500, 23500, 26500, 23500]);
    assert.equal(s.kyoku, 0);
    assert.equal(s.honba, 1);
  });
  test("exhaustive: 親ノーテンで親が流れる、本場は増える", () => {
    const s = run(R4, exhaustive([1]));
    assert.deepEqual(s.points, [24000, 28000, 24000, 24000]);
    assert.equal(s.kyoku, 1);
    assert.equal(s.honba, 1);
  });
  test("exhaustive: renchan が agari なら親テンパイでも流れる", () => {
    const rule = makeRule({ renchan: "agari" });
    const s = run(rule, exhaustive([0]));
    assert.equal(s.kyoku, 1);
    assert.equal(s.honba, 1);
    assert.equal(s.points[0], 28000);
  });
  test("exhaustive: 供託は場に残る", () => {
    const s = run(R4, riichi(3), exhaustive([3]));
    assert.equal(s.kyotaku, 1);
    assert.equal(s.points[3], 24000 + 3000);
  });
  test("abortive: 点数移動なし、常に親が連荘、供託は場に残る", () => {
    const s = run(R4, riichi(1), abortive("suufon"));
    assert.deepEqual(s.points, [25000, 24000, 25000, 25000]);
    assert.equal(s.kyotaku, 1);
    assert.equal(s.kyoku, 0);
    assert.equal(s.honba, 1);
    assert.deepEqual(s.round.riichi, [false, false, false, false]);
  });
  test("abortive: 親がノーテン扱いになることはない（tenpai は無視）", () => {
    const e = { ...abortive(), tenpai: [1, 2, 3] };
    const s = reduce(build(R4, e), R4);
    assert.equal(s.kyoku, 0);
    assert.deepEqual(s.points, [25000, 25000, 25000, 25000]);
  });
  test("nagashi: 満貫の支払い、テンパイ料なし、連荘はテンパイで判定", () => {
    const s = run(R4, nagashi([1], [0, 1]));
    assert.deepEqual(s.points, [21000, 33000, 23000, 23000]);
    assert.equal(s.kyoku, 0); // 親テンパイで据置
    assert.equal(s.honba, 1);
    const s2 = run(R4, nagashi([1], [1]));
    assert.equal(s2.kyoku, 1); // 親ノーテンで流れる
    assert.deepEqual(s2.points, [21000, 33000, 23000, 23000]);
  });
  test("nagashi: 親の成立", () => {
    const s = run(R4, nagashi([0], [0]));
    assert.deepEqual(s.points, [37000, 21000, 21000, 21000]);
    assert.equal(s.kyoku, 0);
  });
});

// ---- チョンボ -------------------------------------------------------------

describe("5. チョンボのリーチ棒返却", () => {
  test("その局のリーチ棒が宣言者に戻り、供託が減る。前局までの供託は残る", () => {
    // 東1: 1 リーチ → 全員ノーテン流局（供託 1、東2 1本場）
    // 東2（親 1）: 2 と 3 がリーチ → 0 がチョンボ
    const s = run(R4, riichi(1), exhaustive([]), riichi(2), riichi(3), chombo(0));
    assert.equal(s.kyotaku, 1);
    assert.deepEqual(s.points, [25000 - 8000, 24000 + 4000, 25000 + 2000, 25000 + 2000]);
    assert.equal(s.kyoku, 1);
    assert.equal(s.honba, 1);
    assert.deepEqual(s.round.riichi, [false, false, false, false]);
  });
  test("チョンボ者自身のリーチ棒も戻る", () => {
    const s = run(R4, riichi(0), chombo(0));
    assert.equal(s.kyotaku, 0);
    assert.deepEqual(s.points, [25000 - 12000, 29000, 29000, 29000]);
  });
  test("局と本場は据え置き", () => {
    const s = run(R4, tsumo(0, 1, 30), chombo(2));
    assert.equal(s.kyoku, 0);
    assert.equal(s.honba, 1);
  });
  test("3人麻雀", () => {
    const s = run(R3, riichi(2), chombo(1));
    assert.deepEqual(s.points, [39000, 29000, 37000]);
    assert.equal(s.kyotaku, 0);
  });
});

// ---- 複数和了の原子性 -----------------------------------------------------

describe("6. 複数和了の原子性", () => {
  test("全 winner の deltas を合算してから一括適用する", () => {
    const ev = build(R4, doubleRon(2, w(3, 1, 30), w(0, 1, 30)));
    assert.deepEqual(ev[0].deltas, [1500, 0, -2500, 1000]);
    const s = reduce(ev, R4);
    assert.deepEqual(s.points, [26500, 25000, 22500, 26000]);
  });
  test("トビ判定は合算後の持ち点で行う（ちょうど 0 はトビでない）", () => {
    const s = run(R4, adjust([0, 0, -22500, 22500]), doubleRon(2, w(3, 1, 30), w(0, 1, 30)));
    assert.equal(s.points[2], 0);
    assert.equal(s.over, false);
  });
  test("合算後にトビ線を割れば終局", () => {
    const s = run(R4, adjust([0, 0, -22600, 22600]), doubleRon(2, w(3, 1, 30), w(0, 1, 30)));
    assert.equal(s.points[2], -100);
    assert.equal(s.over, true);
  });
  test("applyEvent は winner ごとに逐次適用しない（deltas を 1回だけ足す）", () => {
    // deltas を改変した agari を渡し、points の変化が deltas と厳密に一致することで確認する
    const e = { ...doubleRon(2, w(3, 1, 30), w(0, 1, 30)), deltas: [700, 0, -700, 0] };
    const s = applyEvent(initialState(R4), e, R4);
    assert.deepEqual(s.points, [25700, 25000, 24300, 25000]);
  });
});

// ---- 終局判定 -------------------------------------------------------------

describe("終局判定", () => {
  test("アガリやめ: チョンボ・途中流局では選べない", () => {
    for (const rule of [R4, R3]) {
      const dealer = rule.playerCount - 1;
      const prefix = Array.from({ length: rule.length - 1 }, () => exhaustive([]));
      const gains = new Array(rule.playerCount).fill(0);
      gains[dealer] = 20000;
      for (const event of [chombo(0), abortive()]) {
        const events = build(rule, ...prefix, adjust(gains), event);
        assert.equal(reduce(events, rule).over, false);
        assert.equal(agariYameAvailableAfter(events, rule), false);
      }
      for (const event of [tsumo(dealer, 1, 30), exhaustive([dealer]), nagashi([dealer], [dealer])]) {
        assert.equal(agariYameAvailableAfter(build(rule, ...prefix, adjust(gains), event), rule), true);
      }
    }
  });
  test("規定局数の消化", () => {
    const events = [];
    for (let i = 0; i < 8; i++) events.push(ron((i + 1) % 4, (i + 2) % 4, 1, 30));
    const states = reduceAll(build(R4, ...events), R4);
    assert.equal(states[6].over, false);
    assert.equal(states[7].over, true);
    assert.equal(states[7].kyoku, 8);
  });
  test("end の後に局末イベントがあっても終局のまま", () => {
    const s = run(R4, ron(1, 3, 1, 30), end(), ron(2, 3, 1, 30), exhaustive([]));
    assert.equal(s.over, true);
  });
  test("トビ", () => {
    const s = run(R4, adjust([0, 0, -20000, 20000]), ron(3, 2, 5, 30));
    assert.equal(s.points[2], -3000);
    assert.equal(s.over, true);
    const rule = makeRule({ tobi: false });
    const s2 = run(rule, adjust([0, 0, -20000, 20000]), ron(3, 2, 5, 30));
    assert.equal(s2.over, false);
  });
  test("リーチによる減点では終局しない（局末イベントでのみ判定）", () => {
    const rule = makeRule({ riichiUnderThousand: true });
    const s = run(rule, adjust([0, -24500, 24500, 0]), riichi(1));
    assert.equal(s.points[1], -500);
    assert.equal(s.over, false);
  });
  test("アガリやめ: 自動では終局せず、親が選べる状態を導出する", () => {
    const events = [];
    for (let i = 0; i < 7; i++) events.push(ron((i + 1) % 4, (i + 2) % 4, 1, 30));
    // 南4局 親 3。3 がトップになる和了
    const built = build(R4, ...events, ron(3, 0, 5, 30));
    const s = reduce(built, R4);
    assert.equal(s.kyoku, 7);
    assert.equal(s.honba, 1);
    assert.equal(s.over, false);
    assert.equal(agariYameAvailableAfter(built, R4), true);
    // やめるなら end イベントで終局
    const ended = appendEvent(built, end(), R4);
    assert.equal(reduce(ended, R4).over, true);
    assert.equal(agariYameAvailableAfter(ended, R4), false);
    // 続けるなら次の局末までは選べない
    const cont = appendEvent(built, riichi(0), R4);
    assert.equal(agariYameAvailableAfter(cont, R4), false);
  });
  test("アガリやめ: テンパイ連荘でも親がトップなら選べる", () => {
    const events = [];
    for (let i = 0; i < 7; i++) events.push(ron((i + 1) % 4, (i + 2) % 4, 1, 30));
    const built = build(R4, ...events, adjust([0, 0, 0, 20000]), exhaustive([3]));
    const s = reduce(built, R4);
    assert.equal(s.kyoku, 7);
    assert.equal(agariYameAvailableAfter(built, R4), true);
  });
  test("アガリやめ: 選べない場合", () => {
    const events = [];
    for (let i = 0; i < 7; i++) events.push(ron((i + 1) % 4, (i + 2) % 4, 1, 30));
    // agariYame が偽
    const rule = makeRule({ agariYame: false });
    assert.equal(agariYameAvailableAfter(build(rule, ...events, ron(3, 0, 5, 30)), rule), false);
    // 親がトップでない
    assert.equal(agariYameAvailableAfter(build(R4, ...events, adjust([30000, 0, 0, 0]), ron(3, 0, 1, 30)), R4), false);
    // 親が流れた（オーラスに入っただけ）
    const six = events.slice(0, 6);
    const s6 = build(R4, ...six, ron(3, 0, 1, 30));
    assert.equal(reduce(s6, R4).kyoku, 7);
    assert.equal(agariYameAvailableAfter(s6, R4), false);
    // オーラス以外
    assert.equal(agariYameAvailableAfter(build(R4, tsumo(0, 5, 30)), R4), false);
    // 局末以外
    assert.equal(agariYameAvailableAfter(build(R4, ...events, ron(3, 0, 5, 30), riichi(1)), R4), false);
    // prev/next を直接渡す形
    const prev = reduce(build(R4, ...events), R4);
    const next = applyEvent(prev, build(R4, ...events, ron(3, 0, 5, 30))[7], R4);
    assert.equal(agariYameAvailable(prev, next, R4), true);
  });
  test("end イベント", () => {
    const s = run(R4, ron(1, 2, 1, 30), end());
    assert.equal(s.over, true);
  });
});

// ---- adjust ---------------------------------------------------------------

describe("adjust", () => {
  test("非ゼロサムを許し、round と局に影響しない", () => {
    const s = run(R4, riichi(1), adjust([100, 0, 0, 0], "点棒ズレ"));
    assert.deepEqual(s.points, [25100, 24000, 25000, 25000]);
    assert.deepEqual(s.round.riichi, [false, true, false, false]);
    assert.equal(s.kyoku, 0);
  });
});

// ---- 編集と再計算 ---------------------------------------------------------

describe("7. 編集後の再計算", () => {
  test("東1局を子和了から親和了に変えると後続の親・本場・deltas が変わる", () => {
    // 東1: 1 が 3 からロン 30符1翻（1000）→ 東2（親 1）
    // 東2: 1 が 2 からロン 30符1翻 → 親なので 1500、連荘で東2 1本場
    const before = build(R4, ron(1, 3, 1, 30), ron(1, 2, 1, 30));
    assert.deepEqual(before[1].deltas, [0, 1500, -1500, 0]);
    const sBefore = reduce(before, R4);
    assert.equal(sBefore.kyoku, 1);
    assert.equal(sBefore.honba, 1);

    // 東1 を 0（親）の和了に変える → 東1 1本場（親 0）。東2 の 1 は子で 1000 + 300
    const after = replaceEvent(before, 0, ron(0, 3, 1, 30), R4);
    assert.deepEqual(after[0].deltas, [1500, 0, 0, -1500]);
    assert.deepEqual(after[1].deltas, [0, 1300, -1300, 0]);
    const sAfter = reduce(after, R4);
    assert.equal(sAfter.kyoku, 1);
    assert.equal(sAfter.honba, 0);
    assert.deepEqual(sAfter.points, [26500, 26300, 23700, 23500]);
  });
  test("編集地点より前の deltas は再計算しない", () => {
    const before = build(R4, ron(1, 3, 1, 30), ron(2, 3, 1, 30), ron(3, 0, 1, 30));
    // 1 番目の deltas を故意に壊し、2 番目を編集する
    const tampered = before.slice();
    tampered[0] = { ...tampered[0], deltas: [0, 999, 0, -999] };
    const after = replaceEvent(tampered, 1, ron(2, 3, 2, 30), R4);
    assert.deepEqual(after[0].deltas, [0, 999, 0, -999]);
    assert.deepEqual(after[1].deltas, [0, 0, 2000, -2000]);
    assert.deepEqual(after[2].deltas, [-1000, 0, 0, 1000]);
  });
  test("adjust の deltas は再計算で保持される", () => {
    const before = build(R4, ron(1, 3, 1, 30), adjust([100, -100, 0, 0]), ron(2, 3, 1, 30));
    const after = replaceEvent(before, 0, ron(0, 3, 1, 30), R4);
    assert.deepEqual(after[1].deltas, [100, -100, 0, 0]);
    assert.equal(after[1].t, "adjust");
  });
  test("recalc は全体を作り直しても同じ deltas になる", () => {
    const events = build(R4, riichi(1), ron(1, 3, 1, 30), exhaustive([1]), riichi(2), chombo(0), tsumo(2, 3, 40));
    const again = recalc(events.map((e) => ({ ...e, deltas: undefined })), R4);
    assert.deepEqual(again.map((e) => e.deltas), events.map((e) => e.deltas));
    assert.deepEqual(reduce(again, R4), reduce(events, R4));
  });
  test("ありえない翻符の和了は追加・挿入・差し替えで拒否する", () => {
    assert.throws(() => appendEvent([], ron(1, 3, 1, 20), R4), /ありえない翻符/);
    assert.throws(() => appendEvent([], tsumo(1, 1, 25), R4), /ありえない翻符/);
    assert.throws(() => appendEvent([], doubleRon(2, w(3, 2, 30), w(0, 2, 20)), R4), /ありえない翻符/);
    const events = build(R4, ron(1, 3, 1, 30));
    assert.throws(() => insertEvent(events, 0, ron(1, 3, 2, 20), R4), /ありえない翻符/);
    assert.throws(() => replaceEvent(events, 0, ron(1, 3, 2, 20), R4), /ありえない翻符/);
    // 記録済みの古いイベントは再計算で咎めない
    const old = [{ ...ron(1, 3, 1, 20), deltas: undefined }];
    assert.doesNotThrow(() => recalc(old, R4));
  });
  test("挿入と削除も以降を再計算する", () => {
    const events = build(R4, ron(1, 3, 1, 30), ron(1, 2, 1, 30));
    const inserted = insertEvent(events, 0, exhaustive([0]), R4);
    // 東1 1本場（親 0）: 1 の和了は 1000 + 300、東2 0本場: 1 は親 1500
    assert.deepEqual(inserted[1].deltas, [0, 1300, 0, -1300]);
    assert.deepEqual(inserted[2].deltas, [0, 1500, -1500, 0]);
    const removed = removeEvent(inserted, 0, R4);
    assert.deepEqual(removed.map((e) => e.deltas), events.map((e) => e.deltas));
  });
  test("挿入位置: 局の先頭。空の進行中の局は末尾で、どちらも end より後ろにしない", () => {
    const events = build(R4, ron(1, 3, 1, 30), riichi(2), ron(2, 0, 1, 30));
    assert.equal(insertIndexOf(events, 1), 1);
    assert.equal(insertIndexOf(events, 2), 3);
    const withRiichi = build(R4, ron(1, 3, 1, 30), riichi(2));
    assert.equal(insertIndexOf(withRiichi, 1), 1);
    const ended = build(R4, ron(1, 3, 1, 30), end());
    assert.equal(insertIndexOf(ended, 1), 1);
    // 終局後の手動修正は進行中の局に入るが、挿入は end の前
    const adjusted = [...ended, adjust([1000, -1000, 0, 0])];
    assert.equal(insertIndexOf(adjusted, 1), 1);
    const after = insertEvent(adjusted, insertIndexOf(adjusted, 1), exhaustive([]), R4);
    assert.equal(reduce(after, R4).over, true);
  });
  test("流局と流し満貫の deltas も親の変化に追随する", () => {
    const events = build(R4, ron(1, 3, 1, 30), nagashi([1], []));
    // 東2 の親は 1。親の流し満貫は 4000 オール
    assert.deepEqual(events[1].deltas, [-4000, 12000, -4000, -4000]);
    // 東1 を親和了にすると東1 1本場のまま。1 は子として満貫ツモ相当
    const after = replaceEvent(events, 0, ron(0, 3, 1, 30), R4);
    assert.deepEqual(after[1].deltas, [-4000, 8000, -2000, -2000]);
  });
  test("withEvents は settlement を null に戻す", () => {
    const game = { id: "g", rule: R4, seats: ["a", "b", "c", "d"], events: [], settlement: { x: 1 } };
    const next = withEvents(game, build(R4, ron(1, 3, 1, 30)));
    assert.equal(next.settlement, null);
    assert.equal(next.events.length, 1);
    assert.deepEqual(game.settlement, { x: 1 });
  });
});

describe("戻す", () => {
  test("最後のイベントの削除。局末を消すと局中イベントは残り、局が再開する", () => {
    const events = build(R4, riichi(1), meld(2), tsumo(0, 1, 30));
    const undone = undoLast(events, R4);
    assert.deepEqual(undone.map((e) => e.t), ["riichi", "meld"]);
    const s = reduce(undone, R4);
    assert.deepEqual(s.round.riichi, [false, true, false, false]);
    assert.deepEqual(s.round.melded, [false, false, true, false]);
    assert.equal(s.kyotaku, 1);
    assert.equal(s.kyoku, 0);
  });
  test("空の列で戻しても例外にならない", () => {
    assert.deepEqual(undoLast([], R4), []);
  });
});

// ---- 局の区切りと削除 -----------------------------------------------------

describe("8. 局の削除", () => {
  test("kyokuGroups は局末イベントで区切り、末尾に進行中の局を置く", () => {
    const events = build(R4, riichi(1), ron(1, 3, 1, 30), meld(2), adjust([0, 0, 100, 0]), exhaustive([]), kita(0), end());
    const groups = kyokuGroups(events);
    assert.deepEqual(groups, [
      { indices: [0, 1], endIndex: 1 },
      { indices: [2, 3, 4], endIndex: 4 },
      { indices: [5], endIndex: null },
    ]);
  });
  test("局に属する riichi / meld / kita / adjust がまとめて消える", () => {
    const events = build(
      R4,
      riichi(1), meld(2), adjust([0, 0, -100, 100]), ron(1, 3, 1, 30), // 東1（削除対象）
      riichi(0), ron(0, 2, 1, 30), // 東2（親 1）… 削除後は東1（親 0）になる
    );
    const after = deleteKyoku(events, 0, R4);
    assert.deepEqual(after.map((e) => e.t), ["riichi", "agari"]);
    // 削除後: 東1 親 0。0 のリーチ → 0 の親ロン 1500 + 供託回収
    assert.deepEqual(after[1].deltas, [1500, 0, -1500, 0]);
    const s = reduce(after, R4);
    assert.deepEqual(s.points, [25000 - 1000 + 1500 + 1000, 25000, 23500, 25000]);
    assert.equal(s.kyoku, 0);
    assert.equal(s.honba, 1);
    assert.equal(s.kyotaku, 0);
  });
  test("中間の局を削除しても前後の局中イベントが混ざらない", () => {
    const events = build(
      R4,
      ron(1, 3, 1, 30), // 東1
      riichi(2), meld(3), exhaustive([2]), // 東2（削除対象）
      riichi(3), tsumo(3, 1, 30), // 東3
    );
    const after = deleteKyoku(events, 1, R4);
    assert.deepEqual(after.map((e) => e.t), ["agari", "riichi", "agari"]);
    const groups = kyokuGroups(after);
    assert.deepEqual(groups[1].indices, [1, 2]);
    const s = reduce(after, R4);
    assert.deepEqual(s.round.riichi, [false, false, false, false]);
    assert.equal(s.kyotaku, 0);
  });
  test("進行中の局（局末なし）も削除できる", () => {
    const events = build(R4, ron(1, 3, 1, 30), riichi(2), meld(3));
    const after = deleteKyoku(events, 1, R4);
    assert.deepEqual(after.map((e) => e.t), ["agari"]);
    assert.equal(reduce(after, R4).kyotaku, 0);
  });
  test("end イベントは局に属さず、削除で消えない", () => {
    const events = build(R4, ron(1, 3, 1, 30), end());
    const after = deleteKyoku(events, 0, R4);
    assert.deepEqual(after.map((e) => e.t), ["end"]);
  });
  test("存在しない局は例外", () => {
    assert.throws(() => deleteKyoku([], 5, R4));
  });
});

describe("局末イベントの差し替え", () => {
  test("局中イベントを保持したまま局末だけ変える", () => {
    const events = build(R4, riichi(1), ron(1, 3, 1, 30), ron(2, 3, 1, 30));
    const after = replaceKyokuEnd(events, 0, exhaustive([1]), R4);
    assert.deepEqual(after.map((e) => e.t), ["riichi", "ryuukyoku", "agari"]);
    // 東1 流局（1 だけテンパイ、親ノーテン）→ 東2 1本場、親 1。
    // 2 はノーテン罰符 1000 を払ったあと、1000 + 300 + 供託 1000 を得る
    assert.deepEqual(after[2].deltas, [0, 0, 1300, -1300]);
    const s = reduce(after, R4);
    assert.equal(s.points[2], 25000 - 1000 + 1300 + 1000);
    assert.equal(s.kyotaku, 0);
  });
  test("進行中の局なら末尾に追加する", () => {
    const events = build(R4, riichi(1));
    const after = replaceKyokuEnd(events, 0, tsumo(1, 2, 20), R4);
    assert.equal(after.length, 2);
    assert.deepEqual(after[1].deltas, [-700, 1500, -400, -400]);
  });
});

// ---- computeDeltas --------------------------------------------------------

describe("computeDeltas", () => {
  test("deltas を持たないイベントは undefined", () => {
    const s = initialState(R4);
    assert.equal(computeDeltas(riichi(0), s, R4), undefined);
    assert.equal(computeDeltas(meld(0), s, R4), undefined);
    assert.equal(computeDeltas(end(), s, R4), undefined);
  });
  test("abortive はゼロ、chombo manual は指定値", () => {
    const s = initialState(R4);
    assert.deepEqual(computeDeltas(abortive(), s, R4), [0, 0, 0, 0]);
    const rule = makeRule({ chomboRule: "manual" });
    assert.deepEqual(computeDeltas({ t: "chombo", who: 1, deltas: [0, -1000, 1000, 0] }, s, rule), [0, -1000, 1000, 0]);
  });
  test("未知の流局タイプは例外", () => {
    assert.throws(() => computeDeltas({ t: "ryuukyoku", type: "unknown" }, initialState(R4), R4));
  });
});

// ---- reduceAll ------------------------------------------------------------

describe("reduceAll", () => {
  test("各イベント後の状態を返す", () => {
    const events = build(R4, riichi(1), tsumo(1, 2, 20), exhaustive([]));
    const states = reduceAll(events, R4);
    assert.equal(states.length, 3);
    assert.equal(states[0].kyotaku, 1);
    assert.equal(states[1].kyotaku, 0);
    assert.equal(states[1].kyoku, 1);
    assert.equal(states[2].kyoku, 2);
  });
});

// ---- 延長戦（§5.6） --------------------------------------------------------------

describe("延長戦", () => {
  const EXT = makeRule({ extension: true });
  /** 東1〜南4 を親流れで消化する 8局（誰も 30000 に届かない） */
  const eight = () => Array.from({ length: 8 }, (_, i) => ron((i + 1) % 4, (i + 2) % 4, 1, 30));
  test("規定局数を終えてトップが返す点未満なら西入する", () => {
    const s = run(EXT, ...eight());
    assert.ok(Math.max(...s.points) < 30000);
    assert.equal(s.kyoku, 8);
    assert.equal(s.over, false);
    // 延長戦が無効なら終局
    assert.equal(run(R4, ...eight()).over, true);
  });
  test("トップが返す点以上なら通常どおり終局する", () => {
    const s = run(EXT, adjust([10000, 0, 0, -10000]), ...eight());
    assert.equal(s.over, true);
  });
  test("延長中は誰かが返す点に届いた局末で終局する（連荘でも）", () => {
    const base = build(EXT, ...eight());
    // 西1局（親 0）で 1 が 1翻ツモ → 届かないので続行
    const s1 = reduce(appendEvent(base, tsumo(1, 1, 30), EXT), EXT);
    assert.equal(s1.kyoku, 9);
    assert.equal(s1.over, false);
    // 西2局（親 1）で親が跳満ツモして 30000 以上 → 連荘だが終局
    const s2 = reduce(appendEvent(appendEvent(base, tsumo(1, 1, 30), EXT), tsumo(1, 6, 30), EXT), EXT);
    assert.equal(s2.kyoku, 9);
    assert.ok(s2.points[1] >= 30000);
    assert.equal(s2.over, true);
  });
  test("延長は 1 場まで。西4 を終えたら点数に関わらず終局", () => {
    const events = [...eight(), ...Array.from({ length: 4 }, () => exhaustive([]))];
    const states = reduceAll(build(EXT, ...events), EXT);
    assert.equal(states[10].over, false);
    assert.equal(states[11].kyoku, 12);
    assert.equal(states[11].over, true);
  });
  test("東風は南入し、南4 まで", () => {
    const rule = makeRule({ extension: true, length: 4 });
    const four = Array.from({ length: 4 }, (_, i) => ron((i + 1) % 4, (i + 2) % 4, 1, 30));
    const s = run(rule, ...four);
    assert.equal(s.kyoku, 4);
    assert.equal(s.over, false);
    const s2 = run(rule, ...four, ...Array.from({ length: 4 }, () => exhaustive([])));
    assert.equal(s2.over, true);
    // 3人麻雀は西3 まで
    const r3 = { ...R3, extension: true };
    const six = Array.from({ length: 6 }, (_, i) => ron((i + 1) % 3, (i + 2) % 3, 1, 30));
    const s3 = run(r3, ...six, exhaustive([]), exhaustive([]), exhaustive([]));
    assert.equal(s3.kyoku, 9);
    assert.equal(s3.over, true);
    assert.equal(run(r3, ...six, exhaustive([]), exhaustive([])).over, false);
  });
  test("トビは延長中も優先する", () => {
    const s = run(EXT, ...eight(), adjust([0, 0, -20000, 0]), ron(3, 2, 5, 30));
    assert.equal(s.over, true);
  });
  test("オーラスで親がトップでも返す点未満ならアガリやめを出さない", () => {
    const seven = Array.from({ length: 7 }, (_, i) => ron((i + 1) % 4, (i + 2) % 4, 1, 30));
    const built = build(EXT, ...seven, ron(3, 0, 1, 30));
    const s = reduce(built, EXT);
    assert.equal(ranksOf(s.points)[3], 0);
    assert.ok(s.points[3] < 30000);
    assert.equal(agariYameAvailableAfter(built, EXT), false);
    assert.equal(agariYameAvailableAfter(build(R4, ...seven, ron(3, 0, 1, 30)), R4), true);
    // 届いていれば選べる
    const built2 = build(EXT, ...seven, ron(3, 0, 5, 30));
    assert.ok(reduce(built2, EXT).points[3] >= 30000);
    assert.equal(agariYameAvailableAfter(built2, EXT), true);
  });
  test("延長中は西・北場の局名になる", () => {
    assert.equal(kyokuName(8, 4), "西1局");
    assert.equal(kyokuName(11, 4), "西4局");
    assert.equal(kyokuName(4, 4), "南1局");
    assert.equal(kyokuName(6, 3), "西1局");
  });
});

// ---- トビの基準（§5.6） -------------------------------------------------------

describe("トビの基準", () => {
  test("tobiLine 1 なら 0点ちょうどでも終局", () => {
    const rule = makeRule({ tobiLine: 1 });
    const s = run(rule, adjust([0, 0, -17000, 17000]), ron(3, 2, 5, 30));
    assert.equal(s.points[2], 0);
    assert.equal(s.over, true);
    assert.equal(run(R4, adjust([0, 0, -17000, 17000]), ron(3, 2, 5, 30)).over, false);
  });
});

// ---- チップ（§5.2 手順6、§5.5） -----------------------------------------------------

describe("チップ", () => {
  const CH = makeRule({ chips: true, tobiPrize: 2 });
  const wc = (who, han, fu, chips) => ({ who, han, fu, yakumanCount: 0, sekinin: null, chips });
  test("初期値は 0。和了の chips をツモは各人から、ロンは放銃者から受け取る", () => {
    assert.deepEqual(initialState(CH).chips, [0, 0, 0, 0]);
    const s = run(CH, { t: "agari", tsumo: true, from: null, winners: [wc(1, 3, 30, 1)] }, { t: "agari", tsumo: false, from: 0, winners: [wc(2, 1, 30, 2)] });
    assert.deepEqual(s.chips, [-3, 3, 1, -1]);
  });
  test("rule.chips が偽なら和了に chips があっても動かない", () => {
    const s = run(R4, { t: "agari", tsumo: true, from: null, winners: [wc(1, 3, 30, 1)] });
    assert.deepEqual(s.chips, [0, 0, 0, 0]);
  });
  test("トビ賞: 飛んだ人が各和了者に tobiPrize 枚。チョンボ・手動修正・テンパイ料では出ない", () => {
    // 2 が 3 に放銃して飛ぶ
    const s = run(CH, adjust([0, 0, -20000, 20000]), { t: "agari", tsumo: false, from: 2, winners: [wc(3, 5, 30, 0)] });
    assert.equal(s.over, true);
    assert.deepEqual(s.chips, [0, 0, -2, 2]);
    // ツモで 2人同時に飛ぶ
    const s2 = run(CH, adjust([0, 0, -24000, 24000]), adjust([-23500, 23500, 0, 0]), { t: "agari", tsumo: true, from: null, winners: [wc(1, 5, 30, 0)] });
    assert.deepEqual(s2.chips, [-2, 4, -2, 0]);
    // 流し満貫でも成立者が受け取る
    const s3 = run(CH, adjust([0, 0, -24000, 24000]), nagashi([1], []));
    assert.equal(s3.over, true);
    assert.deepEqual(s3.chips, [0, 2, -2, 0]);
    // テンパイ料で飛んでも和了者がいない
    const s4 = run(CH, adjust([0, 0, -24500, 24500]), exhaustive([0, 1, 3]));
    assert.equal(s4.over, true);
    assert.deepEqual(s4.chips, [0, 0, 0, 0]);
    // tobiPrize が 0 なら無し
    const s5 = run({ ...CH, tobiPrize: 0 }, adjust([0, 0, -20000, 20000]), { t: "agari", tsumo: false, from: 2, winners: [wc(3, 5, 30, 0)] });
    assert.deepEqual(s5.chips, [0, 0, 0, 0]);
  });
  test("複数和了のトビ賞は各和了者に", () => {
    const s = run(CH, adjust([0, 0, -20000, 20000]), { t: "agari", tsumo: false, from: 2, winners: [wc(1, 5, 30, 0), wc(3, 1, 30, 0)] });
    assert.deepEqual(s.chips, [0, 2, -4, 2]);
  });
  test("adjust の chips で枚数を補正できる。点数は動かない", () => {
    const s = run(CH, { t: "adjust", note: "", deltas: [0, 0, 0, 0], chips: [1, -1, 0, 0] });
    assert.deepEqual(s.chips, [1, -1, 0, 0]);
    assert.deepEqual(s.points, [25000, 25000, 25000, 25000]);
  });
  test("編集後の再計算でも chips は意味情報から導出される", () => {
    const events = build(CH, { t: "agari", tsumo: true, from: null, winners: [wc(1, 3, 30, 1)] }, { t: "agari", tsumo: false, from: 0, winners: [wc(2, 1, 30, 2)] });
    const edited = replaceEvent(events, 0, { t: "agari", tsumo: false, from: 3, winners: [wc(1, 3, 30, 3)] }, CH);
    assert.deepEqual(reduce(edited, CH).chips, [-2, 3, 2, -3]);
  });
});
