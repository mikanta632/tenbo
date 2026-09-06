import { test } from "node:test";
import assert from "node:assert/strict";
import { openAdjustSheet } from "../src/ui/sheets.js";
import { renderSettings } from "../src/ui/settings.js";
import { makeRule, PRESETS } from "../src/rules.js";
import { initialState } from "../src/reduce.js";

// このシートが使う DOM 操作だけを実装し、実際の入力ハンドラと確定処理を検証する。
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.disabled = false; }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this[key] = key === "disabled" ? true : value; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  get firstChild() { return this.children[0]; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  select() {}
  querySelector() { return this.find((el) => el.className === "points-input"); }
  find(predicate) {
    if (predicate(this)) return this;
    for (const child of this.children) {
      if (child instanceof Element) {
        const found = child.find(predicate);
        if (found) return found;
      }
    }
  }
}

function mockDom(t) {
  const previous = Object.fromEntries(["Node", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.Node = Element;
  globalThis.document = { createElement: (tag) => new Element(tag), body: new Element("body") };
}

test("手動修正は空欄を拒否し、明示的な 0 点や負数は確定できる", (t) => {
  mockDom(t);
  const changes = [];
  const rule = makeRule();
  const { box } = openAdjustSheet({ state: initialState(rule), rule, names: ["A", "B", "C", "D"], onAdjust: (...args) => changes.push(args) });
  box.find((el) => el.tag === "button" && el.children[0] === "東 A 25,000").handlers.click();
  const input = box.querySelector();
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

test("不正な設定 JSON を反映してもフォームが壊れず、修正して保存できる", (t) => {
  mockDom(t);
  const saved = [];
  const root = renderSettings({ presets: PRESETS, rulesFor: () => makeRule(), isCustom: () => false, onChange: (...args) => saved.push(args), version: "test" });
  const area = () => root.find((el) => el.tag === "textarea");
  const apply = () => root.find((el) => el.tag === "button" && el.children[0] === "JSON を反映").handlers.click();
  area().value = JSON.stringify(makeRule({ uma: null }));
  apply();
  assert.deepEqual(saved, []);
  assert.ok(area(), "入力フォームを保持する");
  area().value = JSON.stringify(makeRule({ rate: 0 }));
  apply();
  assert.deepEqual(saved, [[4, makeRule({ rate: 0 })]]);
});
