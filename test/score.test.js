// 段階0: 点数計算のテスト（docs/design.md §6）
//
// 期待値は §6 の式から生成せず、麻雀の標準的な点数表の既知の値を独立に書き下している。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  basePoints,
  agariDeltas,
  winnerDeltas,
  tenpaiDeltas,
  nagashiDeltas,
  chomboDeltas,
  effectiveWinners,
} from "../src/score.js";
import { makeRule } from "../src/rules.js";

const R4 = makeRule();
const R3 = makeRule({ playerCount: 3, length: 6, uma: [20, 0, -20] });
const NO_KIRIAGE = makeRule({ kiriageMangan: false });

// ---- ヘルパー -------------------------------------------------------------

function w(who, han, fu, extra = {}) {
  return { who, han, fu, yakumanCount: 0, sekinin: null, chips: 0, ...extra };
}
function yakuman(who, count = 1, sekinin = null) {
  return { who, han: 0, fu: 0, yakumanCount: count, sekinin, chips: 0 };
}

/** 単独ロン。dealer は既定 0。 */
function ron(winner, from, { rule = R4, dealer = 0, honba = 0 } = {}) {
  return agariDeltas({ rule, dealer, honba, tsumo: false, from, winners: [winner] });
}
/** 単独ツモ。 */
function tsumo(winner, { rule = R4, dealer = 0, honba = 0 } = {}) {
  return agariDeltas({ rule, dealer, honba, tsumo: true, from: null, winners: [winner] });
}

/** ロンの授受額（放銃者の支払い）を取り出す */
function ronPay(deltas, who, from) {
  assert.equal(deltas[who], -deltas[from], "ロンは和了者と放銃者の間だけで移動する");
  return deltas[who];
}

/** 4人麻雀: 子ロンの deltas を期待値と照合 */
function assertKoRon(han, fu, expected, rule = R4) {
  const d = ron(w(1, han, fu), 2, { rule });
  assert.deepEqual(d, [0, expected, -expected, 0], `子ロン ${fu}符${han}翻`);
}
function assertOyaRon(han, fu, expected, rule = R4) {
  const d = ron(w(0, han, fu), 1, { rule });
  assert.deepEqual(d, [expected, -expected, 0, 0], `親ロン ${fu}符${han}翻`);
}
/** 子ツモ: 親から oya、各子から ko */
function assertKoTsumo(han, fu, ko, oya, rule = R4) {
  const d = tsumo(w(1, han, fu), { rule });
  assert.deepEqual(d, [-oya, oya + ko * 2, -ko, -ko], `子ツモ ${fu}符${han}翻`);
}
/** 親ツモ: 各子から all */
function assertOyaTsumo(han, fu, all, rule = R4) {
  const d = tsumo(w(0, han, fu), { rule });
  assert.deepEqual(d, [all * 3, -all, -all, -all], `親ツモ ${fu}符${han}翻`);
}

// ---- 必須ケース（引き継ぎプロンプトの表） -------------------------------

describe("必須ケース", () => {
  test("子ロン 30符 1〜4翻", () => {
    assertKoRon(1, 30, 1000);
    assertKoRon(2, 30, 2000);
    assertKoRon(3, 30, 3900);
    assertKoRon(4, 30, 7700, NO_KIRIAGE);
    assertKoRon(4, 30, 8000, R4);
  });

  test("親ロン 30符4翻", () => {
    assertOyaRon(4, 30, 11600, NO_KIRIAGE);
    assertOyaRon(4, 30, 12000, R4);
  });

  test("子ロン 60符3翻", () => {
    assertKoRon(3, 60, 7700, NO_KIRIAGE);
    assertKoRon(3, 60, 8000, R4);
  });

  test("子ロン 40符3翻 / 40符4翻（頭打ち）", () => {
    assertKoRon(3, 40, 5200);
    assertKoRon(4, 40, 8000);
  });

  test("子ロン 25符（七対子）", () => {
    assertKoRon(2, 25, 1600);
    assertKoRon(4, 25, 6400);
  });

  test("子ツモ 20符2翻（平和ツモ）は 400/700", () => {
    assertKoTsumo(2, 20, 400, 700);
  });

  test("子ロン 満貫〜役満", () => {
    assertKoRon(5, 30, 8000);
    assertKoRon(6, 30, 12000);
    assertKoRon(8, 30, 16000);
    assertKoRon(11, 30, 24000);
    assert.deepEqual(ron(yakuman(1), 2), [0, 32000, -32000, 0]);
  });

  test("親ロン 満貫〜役満", () => {
    assertOyaRon(5, 30, 12000);
    assertOyaRon(6, 30, 18000);
    assertOyaRon(8, 30, 24000);
    assertOyaRon(11, 30, 36000);
    assert.deepEqual(ron(yakuman(0), 1), [48000, -48000, 0, 0]);
  });

  test("親ツモ 役満は 16000 オール", () => {
    assert.deepEqual(tsumo(yakuman(0)), [48000, -16000, -16000, -16000]);
  });

  test("三麻 子ツモ 満貫はツモ損あり: 子から2000・親から4000、和了者は6000", () => {
    const d = tsumo(w(1, 5, 30), { rule: R3 });
    assert.deepEqual(d, [-4000, 6000, -2000]);
  });
});

// ---- 点数表との突き合わせ ------------------------------------------------

describe("点数表: 子ロン", () => {
  test("1翻", () => {
    assertKoRon(1, 30, 1000);
    assertKoRon(1, 40, 1300);
    assertKoRon(1, 50, 1600);
    assertKoRon(1, 60, 2000);
    assertKoRon(1, 70, 2300);
    assertKoRon(1, 80, 2600);
    assertKoRon(1, 90, 2900);
    assertKoRon(1, 100, 3200);
    assertKoRon(1, 110, 3600);
  });
  test("2翻", () => {
    assertKoRon(2, 25, 1600);
    assertKoRon(2, 30, 2000);
    assertKoRon(2, 40, 2600);
    assertKoRon(2, 50, 3200);
    assertKoRon(2, 60, 3900);
    assertKoRon(2, 70, 4500);
    assertKoRon(2, 80, 5200);
    assertKoRon(2, 90, 5800);
    assertKoRon(2, 100, 6400);
    assertKoRon(2, 110, 7100);
  });
  test("3翻", () => {
    assertKoRon(3, 25, 3200);
    assertKoRon(3, 30, 3900);
    assertKoRon(3, 40, 5200);
    assertKoRon(3, 50, 6400);
    assertKoRon(3, 60, 7700, NO_KIRIAGE);
    assertKoRon(3, 70, 8000);
    assertKoRon(3, 110, 8000);
  });
  test("4翻", () => {
    assertKoRon(4, 20, 5200);
    assertKoRon(4, 25, 6400);
    assertKoRon(4, 30, 7700, NO_KIRIAGE);
    assertKoRon(4, 40, 8000);
  });
});

describe("点数表: 親ロン", () => {
  test("1翻", () => {
    assertOyaRon(1, 30, 1500);
    assertOyaRon(1, 40, 2000);
    assertOyaRon(1, 50, 2400);
    assertOyaRon(1, 60, 2900);
    assertOyaRon(1, 70, 3400);
    assertOyaRon(1, 80, 3900);
    assertOyaRon(1, 90, 4400);
    assertOyaRon(1, 100, 4800);
    assertOyaRon(1, 110, 5300);
  });
  test("2翻", () => {
    assertOyaRon(2, 25, 2400);
    assertOyaRon(2, 30, 2900);
    assertOyaRon(2, 40, 3900);
    assertOyaRon(2, 50, 4800);
    assertOyaRon(2, 60, 5800);
    assertOyaRon(2, 70, 6800);
    assertOyaRon(2, 80, 7700);
    assertOyaRon(2, 90, 8700);
    assertOyaRon(2, 100, 9600);
    assertOyaRon(2, 110, 10600);
  });
  test("3翻", () => {
    assertOyaRon(3, 25, 4800);
    assertOyaRon(3, 30, 5800);
    assertOyaRon(3, 40, 7700);
    assertOyaRon(3, 50, 9600);
    assertOyaRon(3, 60, 11600, NO_KIRIAGE);
    assertOyaRon(3, 70, 12000);
  });
  test("4翻", () => {
    assertOyaRon(4, 25, 9600);
    assertOyaRon(4, 30, 11600, NO_KIRIAGE);
    assertOyaRon(4, 40, 12000);
  });
});

describe("点数表: 子ツモ（子/親）", () => {
  test("1翻", () => {
    assertKoTsumo(1, 30, 300, 500);
    assertKoTsumo(1, 40, 400, 700);
    assertKoTsumo(1, 50, 400, 800);
    assertKoTsumo(1, 60, 500, 1000);
    assertKoTsumo(1, 70, 600, 1200);
    assertKoTsumo(1, 80, 700, 1300);
    assertKoTsumo(1, 90, 800, 1500);
    assertKoTsumo(1, 100, 800, 1600);
    assertKoTsumo(1, 110, 900, 1800);
  });
  test("2翻", () => {
    assertKoTsumo(2, 20, 400, 700);
    assertKoTsumo(2, 25, 400, 800);
    assertKoTsumo(2, 30, 500, 1000);
    assertKoTsumo(2, 40, 700, 1300);
    assertKoTsumo(2, 50, 800, 1600);
    assertKoTsumo(2, 60, 1000, 2000);
    assertKoTsumo(2, 70, 1200, 2300);
    assertKoTsumo(2, 80, 1300, 2600);
    assertKoTsumo(2, 90, 1500, 2900);
    assertKoTsumo(2, 100, 1600, 3200);
    assertKoTsumo(2, 110, 1800, 3600);
  });
  test("3翻", () => {
    assertKoTsumo(3, 20, 700, 1300);
    assertKoTsumo(3, 25, 800, 1600);
    assertKoTsumo(3, 30, 1000, 2000);
    assertKoTsumo(3, 40, 1300, 2600);
    assertKoTsumo(3, 50, 1600, 3200);
    assertKoTsumo(3, 60, 2000, 3900, NO_KIRIAGE);
    assertKoTsumo(3, 60, 2000, 4000, R4);
    assertKoTsumo(3, 70, 2000, 4000);
  });
  test("4翻", () => {
    assertKoTsumo(4, 20, 1300, 2600);
    assertKoTsumo(4, 25, 1600, 3200);
    assertKoTsumo(4, 30, 2000, 3900, NO_KIRIAGE);
    assertKoTsumo(4, 30, 2000, 4000, R4);
    assertKoTsumo(4, 40, 2000, 4000);
  });
  test("満貫〜役満", () => {
    assertKoTsumo(5, 30, 2000, 4000);
    assertKoTsumo(6, 30, 3000, 6000);
    assertKoTsumo(8, 30, 4000, 8000);
    assertKoTsumo(11, 30, 6000, 12000);
    assert.deepEqual(tsumo(yakuman(1)), [-16000, 32000, -8000, -8000]);
  });
});

describe("点数表: 親ツモ（オール）", () => {
  test("1翻", () => {
    assertOyaTsumo(1, 30, 500);
    assertOyaTsumo(1, 40, 700);
    assertOyaTsumo(1, 50, 800);
    assertOyaTsumo(1, 60, 1000);
    assertOyaTsumo(1, 70, 1200);
    assertOyaTsumo(1, 80, 1300);
    assertOyaTsumo(1, 90, 1500);
    assertOyaTsumo(1, 100, 1600);
    assertOyaTsumo(1, 110, 1800);
  });
  test("2翻", () => {
    assertOyaTsumo(2, 20, 700);
    assertOyaTsumo(2, 25, 800);
    assertOyaTsumo(2, 30, 1000);
    assertOyaTsumo(2, 40, 1300);
    assertOyaTsumo(2, 50, 1600);
    assertOyaTsumo(2, 60, 2000);
    assertOyaTsumo(2, 70, 2300);
    assertOyaTsumo(2, 80, 2600);
    assertOyaTsumo(2, 90, 2900);
    assertOyaTsumo(2, 100, 3200);
    assertOyaTsumo(2, 110, 3600);
  });
  test("3翻", () => {
    assertOyaTsumo(3, 20, 1300);
    assertOyaTsumo(3, 25, 1600);
    assertOyaTsumo(3, 30, 2000);
    assertOyaTsumo(3, 40, 2600);
    assertOyaTsumo(3, 50, 3200);
    assertOyaTsumo(3, 60, 3900, NO_KIRIAGE);
    assertOyaTsumo(3, 60, 4000, R4);
    assertOyaTsumo(3, 70, 4000);
  });
  test("4翻", () => {
    assertOyaTsumo(4, 20, 2600);
    assertOyaTsumo(4, 25, 3200);
    assertOyaTsumo(4, 30, 3900, NO_KIRIAGE);
    assertOyaTsumo(4, 30, 4000, R4);
    assertOyaTsumo(4, 40, 4000);
  });
  test("満貫〜役満", () => {
    assertOyaTsumo(5, 30, 4000);
    assertOyaTsumo(6, 30, 6000);
    assertOyaTsumo(8, 30, 8000);
    assertOyaTsumo(11, 30, 12000);
  });
});

describe("3人麻雀", () => {
  test("子ロンは4人と同額", () => {
    assert.deepEqual(ron(w(1, 3, 30), 2, { rule: R3 }), [0, 3900, -3900]);
  });
  test("親ロンは4人と同額", () => {
    assert.deepEqual(ron(w(0, 3, 30), 2, { rule: R3 }), [5800, 0, -5800]);
  });
  test("親ツモはオールで支払者が 2人（ツモ損）", () => {
    assert.deepEqual(tsumo(w(0, 5, 30), { rule: R3 }), [8000, -4000, -4000]);
    assert.deepEqual(tsumo(yakuman(0), { rule: R3 }), [32000, -16000, -16000]);
  });
  test("子ツモ 30符1翻は 300/500 で和了者は 800", () => {
    assert.deepEqual(tsumo(w(2, 1, 30), { rule: R3 }), [-500, -300, 800]);
  });
  test("親が 1 のとき（東2局）", () => {
    assert.deepEqual(tsumo(w(2, 5, 30), { rule: R3, dealer: 1 }), [-2000, -4000, 6000]);
  });
});

// ---- 境界 1: 切り上げ満貫 ------------------------------------------------

describe("切り上げ満貫の境界", () => {
  test("基本点 1920 になる組み合わせだけが対象", () => {
    assert.equal(basePoints(w(1, 4, 30), NO_KIRIAGE), 1920);
    assert.equal(basePoints(w(1, 3, 60), NO_KIRIAGE), 1920);
    assert.equal(basePoints(w(1, 4, 30), R4), 2000);
    assert.equal(basePoints(w(1, 3, 60), R4), 2000);
  });
  test("他の組み合わせは巻き込まれない", () => {
    // 3翻40符 1280、3翻50符 1600、4翻25符 1600、4翻20符 1280
    for (const [han, fu, expected] of [
      [3, 40, 5200],
      [3, 50, 6400],
      [4, 25, 6400],
      [4, 20, 5200],
      [2, 110, 7100],
      [3, 30, 3900],
    ]) {
      assertKoRon(han, fu, expected, R4);
      assertKoRon(han, fu, expected, NO_KIRIAGE);
    }
  });
  test("跳満以上には作用しない（6翻は 3000 のまま）", () => {
    assert.equal(basePoints(w(1, 6, 30), R4), 3000);
    assert.equal(basePoints(w(1, 5, 30), R4), 2000);
  });
});

// ---- 境界 2: 役満ルートの分岐 -------------------------------------------

describe("役満ルート", () => {
  test("yakumanCount > 0 は翻・符を見ない", () => {
    assert.equal(basePoints({ who: 1, han: 1, fu: 30, yakumanCount: 1 }, R4), 8000);
    assert.equal(basePoints({ who: 1, han: undefined, fu: undefined, yakumanCount: 1 }, R4), 8000);
  });
  test("han >= 13 は数え役満（yakumanCount = 0）", () => {
    assert.equal(basePoints(w(1, 13, 30), R4), 8000);
    assert.equal(basePoints(w(1, 20, 30), R4), 8000);
    assertKoRon(13, 30, 32000);
    assertOyaRon(13, 30, 48000);
  });
  test("kazoeYakuman: sanbaiman で数え役満は 6000、役満手は 8000 のまま", () => {
    const rule = makeRule({ kazoeYakuman: "sanbaiman" });
    assert.equal(basePoints(w(1, 13, 30), rule), 6000);
    assert.equal(basePoints(yakuman(1), rule), 8000);
    assert.deepEqual(ron(w(1, 13, 30), 2, { rule }), [0, 24000, -24000, 0]);
    assert.deepEqual(ron(yakuman(1), 2, { rule }), [0, 32000, -32000, 0]);
  });
  test("ダブル役満・トリプル役満", () => {
    assert.deepEqual(ron(yakuman(1, 2), 2), [0, 64000, -64000, 0]);
    assert.deepEqual(ron(yakuman(0, 3), 2), [144000, 0, -144000, 0]);
    assert.deepEqual(tsumo(yakuman(1, 2)), [-32000, 64000, -16000, -16000]);
  });
  test("doubleYakuman が偽なら個数に関係なく 8000", () => {
    const rule = makeRule({ doubleYakuman: false });
    assert.deepEqual(ron(yakuman(1, 2), 2, { rule }), [0, 32000, -32000, 0]);
    assert.deepEqual(ron(yakuman(1, 3), 2, { rule }), [0, 32000, -32000, 0]);
  });
});

// ---- 境界 3: 本場 ---------------------------------------------------------

describe("本場の加算", () => {
  test("ロンは放銃者が 300×本場", () => {
    assert.deepEqual(ron(w(1, 1, 30), 2, { honba: 1 }), [0, 1300, -1300, 0]);
    assert.deepEqual(ron(w(1, 1, 30), 2, { honba: 2 }), [0, 1600, -1600, 0]);
    assert.deepEqual(ron(w(0, 1, 30), 3, { honba: 3 }), [2400, 0, 0, -2400]);
  });
  test("ツモは各支払者が 100×本場", () => {
    assert.deepEqual(tsumo(w(1, 2, 20), { honba: 2 }), [-900, 2100, -600, -600]);
    assert.deepEqual(tsumo(w(0, 5, 30), { honba: 1 }), [12300, -4100, -4100, -4100]);
  });
  test("三麻のツモも各支払者が 100×本場", () => {
    assert.deepEqual(tsumo(w(1, 5, 30), { rule: R3, honba: 2 }), [-4200, 6400, -2200]);
  });
});

// ---- 境界 4: 責任払い ----------------------------------------------------

describe("責任払い", () => {
  const sek3 = { who: 3, yakumanCount: 1 };

  test("単独役満ロン: half は責任者と放銃者で折半", () => {
    const d = ron(yakuman(1, 1, sek3), 2);
    assert.deepEqual(d, [0, 32000, -16000, -16000]);
  });
  test("単独役満ロン: full は責任者が全額", () => {
    const rule = makeRule({ sekininRon: "full" });
    const d = ron(yakuman(1, 1, sek3), 2, { rule });
    assert.deepEqual(d, [0, 32000, 0, -32000]);
  });
  test("単独役満ツモ: 責任者が全額（ロン相当額）", () => {
    assert.deepEqual(tsumo(yakuman(1, 1, sek3)), [0, 32000, 0, -32000]);
    assert.deepEqual(tsumo(yakuman(0, 1, sek3)), [48000, 0, 0, -48000]);
  });
  test("複合役満で責任分だけを責任者が負担する（ロン half）", () => {
    // 大三元（包あり）+ 四暗刻（包なし）: 子 64000 のうち責任分 32000
    const d = ron(yakuman(1, 2, sek3), 2);
    // 非責任分 32000 は放銃者、責任分 32000 は折半 16000/16000
    assert.deepEqual(d, [0, 64000, -48000, -16000]);
  });
  test("複合役満で責任分だけを責任者が負担する（ロン full）", () => {
    const rule = makeRule({ sekininRon: "full" });
    const d = ron(yakuman(1, 2, sek3), 2, { rule });
    assert.deepEqual(d, [0, 64000, -32000, -32000]);
  });
  test("複合役満ツモ: 非責任分は通常配分、責任分は責任者が全額", () => {
    const d = tsumo(yakuman(1, 2, sek3));
    // 非責任分 32000: 親 16000、子 8000 ずつ（責任者も子として 8000）
    // 責任分 32000: 責任者
    assert.deepEqual(d, [-16000, 64000, -8000, -40000]);
  });
  test("本場は放銃者が負担し、責任者は負担しない", () => {
    const d = ron(yakuman(1, 1, sek3), 2, { honba: 2 });
    assert.deepEqual(d, [0, 32600, -16600, -16000]);
  });
  test("rule.sekinin が偽なら無視する", () => {
    const rule = makeRule({ sekinin: false });
    assert.deepEqual(ron(yakuman(1, 1, sek3), 2, { rule }), [0, 32000, -32000, 0]);
  });
  test("通常手では sekinin を無視する", () => {
    const d = ron(w(1, 5, 30, { sekinin: sek3 }), 2);
    assert.deepEqual(d, [0, 8000, -8000, 0]);
  });
  test("責任者が放銃者と同一なら結局その者が全額", () => {
    const d = ron(yakuman(1, 1, { who: 2, yakumanCount: 1 }), 2);
    assert.deepEqual(d, [0, 32000, -32000, 0]);
  });
  test("三麻でも同じ", () => {
    const d = ron(yakuman(1, 1, { who: 0, yakumanCount: 1 }), 2, { rule: R3 });
    assert.deepEqual(d, [-16000, 32000, -16000]);
  });
});

// ---- 複数和了 -------------------------------------------------------------

describe("複数和了", () => {
  // 親 0、放銃者 2、和了者 3（子・30符1翻）と 0（親・30符1翻）
  const winners = [w(3, 1, 30), w(0, 1, 30)];

  test("ダブロン: 全員分の合算", () => {
    const d = agariDeltas({ rule: R4, dealer: 0, honba: 0, tsumo: false, from: 2, winners });
    assert.deepEqual(d, [1500, 0, -2500, 1000]);
  });
  test("本場は下家取り（放銃者から反時計回りに最も近い者）", () => {
    const d = agariDeltas({ rule: R4, dealer: 0, honba: 1, tsumo: false, from: 2, winners });
    assert.deepEqual(d, [1500, 0, -2800, 1300]);
  });
  test("multiRonHonba: each は放銃者が人数分払う", () => {
    const rule = makeRule({ multiRonHonba: "each" });
    const d = agariDeltas({ rule, dealer: 0, honba: 1, tsumo: false, from: 2, winners });
    assert.deepEqual(d, [1800, 0, -3100, 1300]);
  });
  test("multiRon が偽なら頭ハネ", () => {
    const rule = makeRule({ multiRon: false });
    assert.deepEqual(effectiveWinners(winners, { tsumo: false, from: 2, rule }).map((x) => x.who), [3]);
    const d = agariDeltas({ rule, dealer: 0, honba: 1, tsumo: false, from: 2, winners });
    assert.deepEqual(d, [0, 0, -1300, 1300]);
  });
  test("頭ハネは放銃者をまたいで数える（from=3 なら 0 が最も近い）", () => {
    const rule = makeRule({ multiRon: false });
    const ws = [w(2, 1, 30), w(0, 1, 30)];
    const d = agariDeltas({ rule, dealer: 0, honba: 0, tsumo: false, from: 3, winners: ws });
    assert.deepEqual(d, [1500, 0, 0, -1500]);
  });
  test("トリロン", () => {
    const ws = [w(0, 1, 30), w(1, 1, 30), w(3, 1, 30)];
    const d = agariDeltas({ rule: R4, dealer: 0, honba: 0, tsumo: false, from: 2, winners: ws });
    assert.deepEqual(d, [1500, 1000, -3500, 1000]);
  });
});

// ---- テンパイ料 -----------------------------------------------------------

describe("テンパイ料", () => {
  test("4人: 1人テンパイ", () => {
    assert.deepEqual(tenpaiDeltas({ rule: R4, tenpai: [0] }), [3000, -1000, -1000, -1000]);
  });
  test("4人: 2人テンパイ", () => {
    assert.deepEqual(tenpaiDeltas({ rule: R4, tenpai: [1, 3] }), [-1500, 1500, -1500, 1500]);
  });
  test("4人: 3人テンパイ", () => {
    assert.deepEqual(tenpaiDeltas({ rule: R4, tenpai: [0, 1, 2] }), [1000, 1000, 1000, -3000]);
  });
  test("0人・全員は移動なし", () => {
    assert.deepEqual(tenpaiDeltas({ rule: R4, tenpai: [] }), [0, 0, 0, 0]);
    assert.deepEqual(tenpaiDeltas({ rule: R4, tenpai: [0, 1, 2, 3] }), [0, 0, 0, 0]);
  });
  test("3人", () => {
    assert.deepEqual(tenpaiDeltas({ rule: R3, tenpai: [2] }), [-1500, -1500, 3000]);
    assert.deepEqual(tenpaiDeltas({ rule: R3, tenpai: [0, 2] }), [1500, -3000, 1500]);
    assert.deepEqual(tenpaiDeltas({ rule: R3, tenpai: [0, 1, 2] }), [0, 0, 0]);
  });
});

// ---- 流し満貫 -------------------------------------------------------------

describe("流し満貫", () => {
  test("子: 満貫ツモ相当", () => {
    assert.deepEqual(nagashiDeltas({ rule: R4, dealer: 0, nagashiBy: [1] }), [-4000, 8000, -2000, -2000]);
  });
  test("親: 4000 オール", () => {
    assert.deepEqual(nagashiDeltas({ rule: R4, dealer: 0, nagashiBy: [0] }), [12000, -4000, -4000, -4000]);
  });
  test("複数成立はそれぞれ独立", () => {
    assert.deepEqual(nagashiDeltas({ rule: R4, dealer: 0, nagashiBy: [1, 2] }), [-8000, 6000, 6000, -4000]);
  });
  test("3人はツモ損", () => {
    assert.deepEqual(nagashiDeltas({ rule: R3, dealer: 0, nagashiBy: [1] }), [-4000, 6000, -2000]);
  });
});

// ---- チョンボ -------------------------------------------------------------

describe("チョンボ", () => {
  test("親のチョンボ: 各子に 4000", () => {
    assert.deepEqual(chomboDeltas({ rule: R4, dealer: 0, who: 0 }), [-12000, 4000, 4000, 4000]);
  });
  test("子のチョンボ: 親に 4000、各子に 2000", () => {
    assert.deepEqual(chomboDeltas({ rule: R4, dealer: 0, who: 1 }), [4000, -8000, 2000, 2000]);
    assert.deepEqual(chomboDeltas({ rule: R4, dealer: 2, who: 1 }), [2000, -8000, 4000, 2000]);
  });
  test("3人麻雀は北家分を差し引く", () => {
    assert.deepEqual(chomboDeltas({ rule: R3, dealer: 0, who: 0 }), [-8000, 4000, 4000]);
    assert.deepEqual(chomboDeltas({ rule: R3, dealer: 0, who: 1 }), [4000, -6000, 2000]);
  });
  test("manual は deltas をそのまま使う", () => {
    const rule = makeRule({ chomboRule: "manual" });
    assert.deepEqual(chomboDeltas({ rule, dealer: 0, who: 1, deltas: [0, -3000, 3000, 0] }), [0, -3000, 3000, 0]);
    assert.throws(() => chomboDeltas({ rule, dealer: 0, who: 1 }));
  });
});

// ---- 不変条件 -------------------------------------------------------------

describe("不変条件", () => {
  test("和了の deltas は常にゼロサム", () => {
    for (const rule of [R4, R3, NO_KIRIAGE]) {
      const n = rule.playerCount;
      for (let han = 1; han <= 13; han++) {
        for (const fu of [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110]) {
          for (let dealer = 0; dealer < n; dealer++) {
            for (let who = 0; who < n; who++) {
              for (let honba = 0; honba <= 2; honba++) {
                const from = (who + 1) % n;
                for (const t of [true, false]) {
                  const d = agariDeltas({
                    rule, dealer, honba, tsumo: t, from: t ? null : from, winners: [w(who, han, fu)],
                  });
                  const sum = d.reduce((a, b) => a + b, 0);
                  assert.equal(sum, 0);
                  assert.ok(d.every((x) => x % 100 === 0), "100点単位");
                  assert.ok(d[who] > 0);
                }
              }
            }
          }
        }
      }
    }
  });
  test("winnerDeltas と agariDeltas は単独和了で一致する", () => {
    const a = winnerDeltas({ rule: R4, dealer: 0, honba: 1, tsumo: false, from: 2, winner: w(1, 3, 40) });
    const b = agariDeltas({ rule: R4, dealer: 0, honba: 1, tsumo: false, from: 2, winners: [w(1, 3, 40)] });
    assert.deepEqual(a, b);
    assert.equal(ronPay(a, 1, 2), 5500);
  });
});
