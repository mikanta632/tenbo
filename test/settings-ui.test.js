// 設定タブ（settings.js）を最小 DOM で描く。null が文字として混ざらないことも見る。

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSettings } from "../src/ui/settings.js";
import { PRESETS, makeRule } from "../src/rules.js";
import { mockDom } from "./support/dom.js";

function render(isCustom) {
  return renderSettings({
    presets: PRESETS,
    rulesFor: () => makeRule(),
    isCustom: () => isCustom,
    initialPc: 4,
    version: "9.9.9",
    onChange: () => {},
  });
}

test("標準のままなら人数の下に説明を出さない", (t) => {
  mockDom(t);
  const text = render(false).textContent;
  assert.ok(!text.includes("null"), `null が混ざっている: ${text.slice(0, 80)}`);
  assert.ok(!text.includes("undefined"), "undefined が混ざっている");
  assert.ok(!text.includes("標準から変更あり"));
  assert.ok(text.includes("ウマ"), "ウマの節が無い");
  assert.ok(!text.includes("結果関連"), "節の名前が古い");
});

test("標準から変えていればその印だけ出す", (t) => {
  mockDom(t);
  const text = render(true).textContent;
  assert.ok(text.includes("標準から変更あり"));
  assert.ok(!text.includes("null"), "null が混ざっている");
});
