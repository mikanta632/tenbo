import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRule, PRESETS, validateRule } from "../src/rules.js";

test("プリセットとゼロを含む数値設定は有効", () => {
  for (const rule of Object.values(PRESETS)) assert.deepEqual(validateRule(rule), []);
  assert.deepEqual(validateRule(makeRule({ rate: 0, honbaPoints: 0, ryuukyokuTenpaiTotal: 0, tobiLine: -1000 })), []);
});

test("設定 JSON の欠落・文字列・非有限数は計算や保存の前に検出する", () => {
  for (const rule of [null, [], 4, { playerCount: 4, length: 8, uma: [20, 10, -10, -20] }]) {
    assert.ok(validateRule(rule).length > 0);
  }
  for (const key of ["startPoints", "returnPoints", "rate", "ryuukyokuTenpaiTotal", "honbaPoints", "tobiLine"]) {
    for (const value of [null, "1000", Infinity, NaN]) {
      assert.ok(validateRule(makeRule({ [key]: value })).length > 0, `${key}: ${value}`);
    }
  }
  assert.ok(validateRule(makeRule({ uma: [NaN, 0, 0, 0] })).length > 0);
});
