import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStats } from "../src/ui/stats.js";
import { PRESETS } from "../src/rules.js";
import { fmtDate } from "../src/ui/format.js";
import { Element, mockDom, button } from "./support/dom.js";

function fixture() {
  const now = new Date(2026, 8, 6, 20);
  const make = (id, day, n) => ({
    id, endedAt: new Date(2026, 8, day, 14).toISOString(),
    rule: PRESETS[`${n}人標準`], seats: ["a", "b", "c", "d"].slice(0, n), events: [], settlement: null,
  });
  return { now, games: [make("g1", 6, 4), make("g2", 6, 3), make("g3", 5, 4)], roster: ["a", "b", "c", "d"].map((id) => ({ id, name: id })) };
}

test("今日・人数で絞り込んだ対局だけを日単位で選択して精算する", (t) => {
  mockDom(t);
  let picked;
  let state;
  const props = { ...fixture(), onSettle: (ids) => (picked = ids), onListState: (s) => (state = s) };
  const root = renderStats(props);
  button(root, "今日").handlers.click();
  assert.equal(root.findAll((el) => el.matches(".game-card")).length, 2);
  button(root, "この日をすべて選択").handlers.click();
  button(root, "まとめて精算").handlers.click();
  assert.deepEqual(picked, ["g1", "g2"]);
  button(root, "4人").handlers.click();
  assert.deepEqual(state.selectedIds, ["g1"]);
  button(root, "この日の選択解除").handlers.click();
  assert.equal(button(root, "まとめて精算").disabled, true);
  button(root, "全期間").handlers.click();
  const yesterday = fmtDate(new Date(2026, 8, 5).toISOString());
  root.find((el) => el["aria-label"] === `${yesterday}の対局をすべて選択`).handlers.click();
  assert.deepEqual(state.selectedIds, ["g3"]);
});

test("戦績画面を作り直しても絞り込み・選択が戻り、削除された対局は除外する", (t) => {
  mockDom(t);
  let state;
  const props = { ...fixture(), onListState: (s) => (state = s) };
  const root = renderStats(props);
  button(root, "4人").handlers.click();
  button(root, "すべて選択").handlers.click();
  const back = renderStats({ ...props, initialListState: state });
  assert.match(button(back, "4人").className, /on/);
  assert.equal(back.findAll((el) => el.tag === "input" && el.checked).length, 2);
  const removed = renderStats({ ...props, games: props.games.slice(1), initialListState: state });
  assert.equal(removed.findAll((el) => el.tag === "input" && el.checked).length, 1);
  assert.deepEqual(state.selectedIds, ["g3"]);
});

test("チェック操作ではスクロール位置を維持し、絞り込み変更では先頭へ戻す", (t) => {
  mockDom(t);
  let state;
  const root = renderStats({ ...fixture(), onListState: (s) => (state = s) });
  const scroller = new Element("div");
  scroller.className = "tab-content";
  scroller.append(root);
  scroller.scrollTop = 700;
  root.find((el) => el.tag === "input").handlers.change({ target: { checked: true } });
  assert.equal(scroller.scrollTop, 700);
  assert.equal(state.scrollTop, 700);
  button(root, "今日").handlers.click();
  assert.equal(scroller.scrollTop, 0);
  assert.equal(state.scrollTop, 0);
});

test("記録の無い登録プレイヤーも個人成績に出し、名前から個人ページへ入れる", (t) => {
  mockDom(t);
  const base = fixture();
  const opened = [];
  const props = { ...base, roster: [...base.roster, { id: "e", name: "新人" }], initialTab: "players", onPlayer: (id) => opened.push(id) };
  const root = renderStats(props);
  const rows = root.querySelector("tbody").findAll((el) => el.tag === "tr");
  const cells = rows.map((r) => r.findAll((el) => el.tag === "td").map((td) => td.textContent));
  // 記録のある4人が先、記録の無い「新人」は最後
  assert.equal(cells.length, 5);
  assert.equal(cells.at(-1)[0], "新人 ›");
  assert.deepEqual(cells.at(-1).slice(1), ["0", "—", "—", "—"]);
  for (const row of cells.slice(0, 4)) assert.equal(row[1], "2");
  button(root, "新人 ›").handlers.click();
  assert.deepEqual(opened, ["e"]);
});

test("対局が1つも無くても登録プレイヤーの一覧を出す", (t) => {
  mockDom(t);
  const base = fixture();
  const root = renderStats({ ...base, games: [], initialTab: "players" });
  const rows = root.querySelector("tbody").findAll((el) => el.tag === "tr");
  assert.deepEqual(rows.map((r) => r.querySelector(".name").textContent), ["a ›", "b ›", "c ›", "d ›"]);
  // 対局一覧タブは従来どおり空の案内を出す
  const list = renderStats({ ...base, games: [] });
  assert.match(list.textContent, /終了した対局がありません/);
});
