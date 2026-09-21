import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTable } from "../src/ui/table.js";
import { initialState } from "../src/reduce.js";
import { PRESETS } from "../src/rules.js";
import { mockDom, button } from "./support/dom.js";

test("各相手の点数欄に基準席からの点差を表示し、基準席は持ち点を残す", (t) => {
  mockDom(t);
  for (const rule of Object.values(PRESETS)) {
    const state = { ...initialState(rule), points: [25000, 20000, 25000, 35000].slice(0, rule.playerCount) };
    const game = { rule, events: [], startedAt: "2026-09-06T00:00:00Z", bottomSeat: 0 };
    let diffSeat = 0;
    let panelCalls = 0;
    const actions = { onDiff: (seat) => { diffSeat = diffSeat === seat ? null : seat; }, onPanel: () => panelCalls++ };
    const render = () => renderTable({ game, state, names: ["A", "B", "C", "D"].slice(0, rule.playerCount), actions, diffSeat });
    const root = render();
    const groups = root.findAll((el) => el.dataset.seat !== undefined);
    const score = (seat) => groups.find((el) => el.dataset.seat === String(seat)).querySelector(".pts");
    assert.equal(score(0).textContent, "25,000");
    assert.equal(score(1).textContent, "+5,000");
    assert.match(score(1).className, /ahead/);
    assert.equal(score(2).textContent, "±0");
    if (rule.playerCount === 4) {
      assert.equal(score(3).textContent, "−10,000");
      assert.match(score(3).className, /behind/);
    }
    groups[1].querySelector(".panel").handlers.click();
    assert.equal(diffSeat, null);
    assert.equal(panelCalls, 0);
    assert.equal(render().findAll((el) => el.matches(".point-diff")).length, 0);
    groups[1].querySelector(".adj").handlers.click({ stopPropagation() {} });
    assert.equal(diffSeat, 1);
    assert.equal(render().find((el) => el.dataset.seat === "0").querySelector(".pts").textContent, "−5,000");
    assert.equal(button(root, "戻す"), undefined);
    assert.deepEqual(state.points, [25000, 20000, 25000, 35000].slice(0, rule.playerCount));
  }
});

test("3人麻雀は横向き配置（対面を上、左右を短辺、手前に局の情報）で、4人は縦向きのまま", (t) => {
  mockDom(t);
  const names = ["A", "B", "C", "D"];
  const posOf = (root) => Object.fromEntries(root.findAll((el) => el.dataset.seat !== undefined).map((el) => [el.className.match(/pos-(\w+)/)[1], Number(el.dataset.seat)]));

  const rule3 = PRESETS["3人標準"];
  // 自分 0（下）、右 1、対面 空席、左 2 → 端末は対面に横置き。右の短辺 2、上の長辺 0、左の短辺 1
  const game3 = { rule: rule3, events: [], startedAt: "2026-09-21T00:00:00Z", bottomSeat: 0, emptyPosition: "top" };
  const root3 = renderTable({ game: game3, state: initialState(rule3), names: names.slice(0, 3), actions: {} });
  assert.match(root3.className, /landscape/);
  assert.deepEqual(posOf(root3), { right: 2, top: 0, left: 1 });
  assert.ok(root3.querySelector(".near"), "手前の行がない");
  assert.match(root3.querySelector(".near").textContent, /東1局/);
  assert.ok(button(root3, "ログ") && button(root3, "メニュー"));

  const rule4 = PRESETS["4人標準"] || Object.values(PRESETS).find((r) => r.playerCount === 4);
  const game4 = { rule: rule4, events: [], startedAt: "2026-09-21T00:00:00Z", bottomSeat: 0 };
  const root4 = renderTable({ game: game4, state: initialState(rule4), names, actions: {} });
  assert.ok(!/landscape/.test(root4.className));
  assert.deepEqual(posOf(root4), { bottom: 0, right: 1, top: 2, left: 3 });
  assert.equal(root4.querySelector(".near"), undefined);
});
