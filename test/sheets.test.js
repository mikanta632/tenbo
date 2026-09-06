import { test } from "node:test";
import assert from "node:assert/strict";
import { openAdjustSheet, openMenu, openOverDialog } from "../src/ui/sheets.js";
import { renderSettings } from "../src/ui/settings.js";
import { makeRule, PRESETS } from "../src/rules.js";
import { initialState } from "../src/reduce.js";

import { mockDom, button } from "./support/dom.js";

test("手動修正は空欄を拒否し、明示的な 0 点や負数は確定できる", (t) => {
  mockDom(t);
  const changes = [];
  const rule = makeRule();
  const { box } = openAdjustSheet({ state: initialState(rule), rule, names: ["A", "B", "C", "D"], onAdjust: (...args) => changes.push(args) });
  box.find((el) => el.tag === "button" && el.children[0] === "東 A 25,000").handlers.click();
  const input = box.querySelector(".points-input");
  const confirm = box.find((el) => el.tag === "button" && el.children[0] === "確定");
  for (const value of ["", " ", ",，", "abc", "12.5"]) {
    input.handlers.input({ target: { value } });
    assert.equal(confirm.disabled, true, JSON.stringify(value));
  }
  for (const [value, delta] of [["0", -25000], ["-1000", -26000], ["26,000", 1000]]) {
    input.handlers.input({ target: { value } });
    assert.equal(confirm.disabled, false);
    confirm.handlers.click();
    assert.deepEqual(changes.at(-1), [0, delta]);
  }
});

test("ウマは合計が 0 になっても自動保存せず、保存ボタンで全順位を反映する", (t) => {
  mockDom(t);
  const saved = [];
  const root = renderSettings({ presets: PRESETS, rulesFor: () => makeRule(), isCustom: () => false, onChange: (...args) => saved.push(args), version: "test" });
  const uma = () => root.querySelector(".uma-row").findAll((el) => el.tag === "input");
  uma()[0].handlers.input({ target: { value: "30" } });
  assert.deepEqual(saved, []);
  assert.equal(button(root, "ウマを保存").disabled, true);
  uma()[1].handlers.input({ target: { value: "0" } });
  assert.deepEqual(saved, []);
  assert.match(root.textContent, /未保存/);
  button(root, "ウマを保存").handlers.click();
  assert.deepEqual(saved, [[4, makeRule({ uma: [30, 0, -10, -20] })]]);
  assert.match(root.textContent, /保存済み/);
});

test("編集中のウマは他の設定の保存に混入せず、変更を戻せる", (t) => {
  mockDom(t);
  const saved = [];
  const root = renderSettings({ rulesFor: () => makeRule(), isCustom: () => false, onChange: (...args) => saved.push(args) });
  root.querySelector(".uma-row").querySelector("input").handlers.input({ target: { value: "30" } });
  root.find((el) => el.tag === "input" && el.type === "checkbox" && !el.disabled).handlers.change({ target: { checked: false } });
  assert.deepEqual(saved[0][1].uma, makeRule().uma);
  assert.match(root.textContent, /未保存/);
  button(root, "変更を戻す").handlers.click();
  assert.equal(root.querySelector(".uma-row").querySelector("input").value, "20");
  assert.equal(button(root, "ウマを保存").disabled, true);
});

test("三麻のウマは3順位を一括保存し、空欄では保存できない", (t) => {
  mockDom(t);
  const saved = [];
  const root = renderSettings({ initialPc: 3, rulesFor: () => PRESETS["3人標準"], isCustom: () => false, onChange: (...args) => saved.push(args) });
  const inputs = root.querySelector(".uma-row").findAll((el) => el.tag === "input");
  assert.equal(inputs.length, 3);
  inputs[0].handlers.input({ target: { value: "" } });
  assert.equal(button(root, "ウマを保存").disabled, true);
  [40, 0, -40].forEach((value, i) => inputs[i].handlers.input({ target: { value: String(value) } }));
  button(root, "ウマを保存").handlers.click();
  assert.equal(saved[0][0], 3);
  assert.deepEqual(saved[0][1].uma, [40, 0, -40]);
});

test("メニュー・終局画面に直前操作の取り消しを置かない", (t) => {
  mockDom(t);
  const rule = makeRule();
  for (const { box } of [openMenu({}), openOverDialog({ state: initialState(rule), rule, names: ["A", "B", "C", "D"] })]) {
    assert.equal(button(box, "戻す"), undefined);
    assert.equal(button(box, "直前の操作を取り消す"), undefined);
  }
});
