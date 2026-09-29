// 結果画面（src/ui/result.js）の持ち点の推移グラフ。docs/design.md §8.6

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { renderResult, pointsChart, spreadLabels } from "../src/ui/result.js";
import { pointsByKyoku } from "../src/reduce.js";
import { computeSettlement } from "../src/settlement.js";
import { appendEvent } from "../src/edit.js";
import { PRESETS } from "../src/rules.js";
import { Element, mockDom } from "./support/dom.js";

const rule = PRESETS["4人標準"];
const names = ["A", "B", "C", "D"];

/** svg() が作る要素の中身（マークアップ）を取り出せるようにする。標準のモックは捨ててしまう */
function captureSvg(t) {
  mockDom(t);
  const createElement = document.createElement;
  const markups = [];
  document.createElement = (tag) => {
    if (tag !== "template") return createElement(tag);
    return {
      set innerHTML(value) {
        markups.push(value);
      },
      get content() {
        const el = new Element("svg");
        el.markup = markups[markups.length - 1];
        return { firstChild: el };
      },
    };
  };
  return markups;
}

function events(...list) {
  return list.reduce((acc, e) => appendEvent(acc, e, rule), []);
}
const ron = { t: "agari", tsumo: false, from: 1, winners: [{ who: 0, han: 3, fu: 30, yakumanCount: 0, sekinin: null, chips: 0 }] };
const draw = { t: "ryuukyoku", type: "exhaustive", abortiveKind: null, tenpai: [0], nagashiBy: [] };

function resultOf(game) {
  const root = renderResult({ game, names, settlement: computeSettlement(game), title: "結果", onBack: () => {} });
  return root;
}

describe("spreadLabels", () => {
  test("離れていれば動かさない。近ければ間隔を空けて、順序を保つ", () => {
    assert.deepEqual(spreadLabels([20, 60, 100], 13, 10, 180), [20, 60, 100]);
    const out = spreadLabels([80, 82, 81, 200], 13, 10, 180);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 13 - 1e-9, `${sorted}`);
    assert.ok(sorted[0] >= 10 && sorted[3] <= 180);
    assert.ok(out[0] < out[2] && out[2] < out[1], "元の上下の順を保つ");
  });
});

describe("持ち点の推移", () => {
  test("席ごとに 1 本の線と名前、終点の丸を描き、席の色は順位に関わらず固定する", (t) => {
    const markups = captureSvg(t);
    const game = { id: "g", seats: ["a", "b", "c", "d"], rule, events: events(ron, draw) };
    const series = pointsByKyoku(game.events, rule);
    const el = pointsChart(series, names, rule.startPoints);
    const markup = el.markup;
    assert.equal((markup.match(/<polyline/g) || []).length, 4);
    assert.equal((markup.match(/<circle/g) || []).length, 4);
    const colors = [...markup.matchAll(/<polyline[^>]*stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    assert.deepEqual(colors, ["#3987e5", "#d95926", "#199e70", "#c98500"]);
    for (const name of names) assert.ok(markup.includes(`>${name}</text>`), name);
    assert.match(markup, /stroke-dasharray/, "開始点の破線");
    assert.match(markup, /aria-label="持ち点の推移。2局を終えて A /);
    assert.ok(markups.length >= 1);
  });

  test("名前の記号はエスケープする。長い名前は詰める", (t) => {
    captureSvg(t);
    const series = [[25000, 25000, 25000], [26000, 24000, 25000]];
    const markup = pointsChart(series, ["<b>&", "とても長い名前です", "C"], 25000).markup;
    assert.ok(!markup.includes("<b>"));
    assert.ok(markup.includes("&lt;b&gt;&amp;"));
    assert.ok(markup.includes("とても長…"));
  });

  test("局末が 1 つも無い対局には出さない。あれば出す", (t) => {
    captureSvg(t);
    const none = resultOf({ id: "g", seats: ["a", "b", "c", "d"], rule, events: [] });
    assert.ok(!none.textContent.includes("持ち点の推移"));
    const some = resultOf({ id: "g", seats: ["a", "b", "c", "d"], rule, events: events(ron) });
    assert.ok(some.textContent.includes("持ち点の推移"));
    // 凡例に名前と最終の持ち点
    assert.ok(some.textContent.includes("A 30,800B 19,200"));
  });
});
