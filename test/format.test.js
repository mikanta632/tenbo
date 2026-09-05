// 表示用の純関数のテスト（席と画面位置の対応、局名）

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { seatPositions, positionsFor, kyokuName, windName, fmtPoints, fmtDelta, hanName } from "../src/ui/format.js";

describe("seatPositions", () => {
  test("4人: 下から反時計回りに 右・上・左", () => {
    assert.deepEqual(seatPositions(0, 4), { bottom: 0, right: 1, top: 2, left: 3 });
    assert.deepEqual(seatPositions(2, 4), { bottom: 2, right: 3, top: 0, left: 1 });
  });
  test("3人: 空席の位置を飛ばして反時計回り", () => {
    assert.deepEqual(positionsFor(3, "left"), ["bottom", "right", "top"]);
    assert.deepEqual(positionsFor(3, "top"), ["bottom", "right", "left"]);
    assert.deepEqual(positionsFor(3, "right"), ["bottom", "top", "left"]);
    assert.deepEqual(seatPositions(0, 3, "left"), { bottom: 0, right: 1, top: 2 });
    assert.deepEqual(seatPositions(1, 3, "top"), { bottom: 1, right: 2, left: 0 });
    assert.deepEqual(seatPositions(2, 3, "right"), { bottom: 2, top: 0, left: 1 });
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
