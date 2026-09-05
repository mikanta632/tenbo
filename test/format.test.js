// 表示用の純関数のテスト（席と画面位置の対応、局名）

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { seatPositions, positionsFor, kyokuName, windName, fmtPoints, fmtDelta, hanName } from "../src/ui/format.js";
import { seatsFromPositions } from "../src/ui/start.js";

describe("seatPositions", () => {
  test("4人: 下から反時計回りに 右・上・左", () => {
    assert.deepEqual(seatPositions(0, 4), { bottom: 0, right: 1, top: 2, left: 3 });
    assert.deepEqual(seatPositions(2, 4), { bottom: 2, right: 3, top: 0, left: 1 });
  });
  test("3人: 空席は常に左。下・右・上を反時計回りに使う", () => {
    assert.deepEqual(positionsFor(3), ["bottom", "right", "top"]);
    assert.deepEqual(seatPositions(0, 3), { bottom: 0, right: 1, top: 2 });
    assert.deepEqual(seatPositions(2, 3), { bottom: 2, right: 0, top: 1 });
  });
  test("配置図の選択（下→右→上→左の順）と起家の位置から seats / bottomSeat を出し、往復が一致する", () => {
    // 4人: 下 a、右 b、上 c、左 d。起家は上（添字 2）→ seats は c,d,a,b、下は seats[2]
    const r4 = seatsFromPositions({ posPlayers: ["a", "b", "c", "d"], chiichaPos: 2 });
    assert.deepEqual(r4, { seats: ["c", "d", "a", "b"], bottomSeat: 2 });
    const pos4 = seatPositions(r4.bottomSeat, 4);
    assert.deepEqual(["bottom", "right", "top", "left"].map((k) => r4.seats[pos4[k]]), ["a", "b", "c", "d"]);
    // 3人: 下 a、右 b、上 c（左は空席）。起家は右（添字 1）→ seats は b,c,a、下は seats[2]
    const r3 = seatsFromPositions({ posPlayers: ["a", "b", "c"], chiichaPos: 1 });
    assert.deepEqual(r3, { seats: ["b", "c", "a"], bottomSeat: 2 });
    const pos3 = seatPositions(r3.bottomSeat, 3);
    assert.deepEqual(["bottom", "right", "top"].map((k) => r3.seats[pos3[k]]), ["a", "b", "c"]);
  });
});

describe("表示名", () => {
  test("局名", () => {
    assert.equal(kyokuName(0, 4), "東1局");
    assert.equal(kyokuName(7, 4), "南4局");
    assert.equal(kyokuName(8, 4), "西1局");
    assert.equal(kyokuName(3, 3), "南1局");
  });
  test("自風", () => {
    assert.equal(windName(0, 0, 4), "東");
    assert.equal(windName(0, 1, 4), "北");
    assert.equal(windName(2, 1, 3), "南");
  });
  test("点数の整形", () => {
    assert.equal(fmtPoints(25000), "25,000");
    assert.equal(fmtPoints(-1200), "−1,200");
    assert.equal(fmtDelta(0), "±0");
    assert.equal(fmtDelta(300), "+300");
  });
  test("翻の名称", () => {
    assert.equal(hanName(5), "満貫");
    assert.equal(hanName(6), "跳満");
    assert.equal(hanName(8), "倍満");
    assert.equal(hanName(11), "三倍満");
    assert.equal(hanName(13), "数え役満");
    assert.equal(hanName(3), "3翻");
  });
});
