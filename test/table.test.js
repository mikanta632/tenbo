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
