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

test("ノーテン罰符の総点は、どの人数配分でも 100点単位に割り切れる値だけ（4人は 600、3人は 200 の倍数）", () => {
  const R3 = PRESETS["3人標準"];
  for (const total of [0, 600, 1200, 3000, 6000]) assert.deepEqual(validateRule(makeRule({ ryuukyokuTenpaiTotal: total })), [], String(total));
  for (const total of [1000, 1500, 2000, 100, -600]) assert.ok(validateRule(makeRule({ ryuukyokuTenpaiTotal: total })).length > 0, String(total));
  for (const total of [0, 200, 1000, 2000, 3000]) assert.deepEqual(validateRule({ ...R3, ryuukyokuTenpaiTotal: total }), [], String(total));
  for (const total of [100, 1500, 2500]) assert.ok(validateRule({ ...R3, ryuukyokuTenpaiTotal: total }).length > 0, String(total));
});
