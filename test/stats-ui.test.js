import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStats } from "../src/ui/stats.js";
import { PRESETS } from "../src/rules.js";
import { fmtDateTime } from "../src/ui/format.js";
import { Element, mockDom, button } from "./support/dom.js";

function fixture() {
  const now = new Date(2026, 8, 6, 20);
  const make = (id, day, n) => ({
    id, endedAt: new Date(2026, 8, day, 14).toISOString(),
    rule: PRESETS[`${n}人標準`], seats: ["a", "b", "c", "d"].slice(0, n), events: [], settlement: null,
  });
  return { now, games: [make("g1", 6, 4), make("g2", 6, 3), make("g3", 5, 4)], roster: ["a", "b", "c", "d"].map((id) => ({ id, name: id })) };
}

test("今日・人数で絞り込んだ対局だけをまとまり単位で選択して精算する", (t) => {
  mockDom(t);
  let picked;
  let state;
  const props = { ...fixture(), onSettle: (ids) => (picked = ids), onListState: (s) => (state = s) };
  const root = renderStats(props);
  button(root, "今日").handlers.click();
  assert.equal(root.findAll((el) => el.matches(".game-card")).length, 2);
  button(root, "このまとまりをすべて選択").handlers.click();
  button(root, "まとめて精算").handlers.click();
  assert.deepEqual(picked, ["g1", "g2"]);
  button(root, "4人").handlers.click();
  assert.deepEqual(state.selectedIds, ["g1"]);
  button(root, "このまとまりの選択解除").handlers.click();
  assert.equal(button(root, "まとめて精算").disabled, true);
  button(root, "全期間").handlers.click();
  const yesterday = fmtDateTime(new Date(2026, 8, 5, 14).toISOString());
  root.find((el) => el["aria-label"] === `${yesterday}〜${yesterday.slice(11)}の対局をすべて選択`).handlers.click();
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
  assert.deepEqual(cells.at(-1).slice(1), ["0", "—", "—", "—", "—"]);
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

test("各カードの「未精算」ボタンで印を付け外しし、付いている対局だけ押した状態にする", (t) => {
  mockDom(t);
  const toggled = [];
  const f = { ...fixture(), onToggleUnsettled: (id) => toggled.push(id) };
  f.games[1] = { ...f.games[1], unsettled: true };
  const root = renderStats(f);
  const toggles = root.findAll((el) => el.matches(".settle-toggle"));
  assert.equal(toggles.length, 3, "対局ごとに 1 つ");
  assert.deepEqual(toggles.map((b) => b.textContent), ["未精算", "未精算", "未精算"]);
  assert.deepEqual(toggles.map((b) => b["aria-pressed"]), ["false", "true", "false"]);
  toggles[1].handlers.click();
  toggles[0].handlers.click();
  assert.deepEqual(toggled, ["g2", "g1"]);
});

test("「未精算を選択」は選択を表示中の未精算の対局だけに置き換え、無ければ押せない", (t) => {
  mockDom(t);
  let state;
  const f = { ...fixture(), onListState: (s) => (state = s) };
  f.games[1] = { ...f.games[1], unsettled: true };
  f.games[2] = { ...f.games[2], unsettled: true };
  const root = renderStats(f);
  root.find((el) => el.tag === "input").handlers.change({ target: { checked: true } }); // g1 を選ぶ
  button(root, "未精算を選択").handlers.click();
  assert.deepEqual(state.selectedIds.sort(), ["g2", "g3"]);
  button(root, "4人").handlers.click();
  button(root, "未精算を選択").handlers.click();
  assert.deepEqual(state.selectedIds, ["g3"]);
  button(root, "今日").handlers.click();
  assert.equal(button(root, "未精算を選択").disabled, true);
});

test("まとまりごとに見出しと人ごとの合計を出し、まとまりは絞り込み前の対局で決める", (t) => {
  mockDom(t);
  const base = fixture();
  const make = (id, start, end, n = 4) => ({
    id, startedAt: new Date(2026, 8, 6, ...start).toISOString(), endedAt: new Date(2026, 8, 6, ...end).toISOString(),
    rule: base.games[0].rule, seats: ["a", "b", "c", "d"].slice(0, n), events: [], settlement: null,
  });
  // g1・g2（3人）・g3 は続けて、g0 は 4時間後
  const games = [make("g0", [23, 0], [23, 30]), make("g3", [17, 0], [19, 0]), { ...make("g2", [15, 0], [16, 30], 3), rule: fixture().games[1].rule }, make("g1", [13, 0], [14, 30])];
  const root = renderStats({ ...base, games });
  const heads = root.findAll((el) => el.matches(".game-day")).map((el) => el.querySelector("b").textContent);
  assert.equal(heads.length, 2);
  assert.match(heads[0], /23:00〜23:30（今日） ・ 1対局$/);
  assert.match(heads[1], /13:00〜19:00（今日） ・ 3対局$/);
  const sums = root.findAll((el) => el.matches(".session-sum"));
  const rows = sums[1].querySelector("tbody").findAll((el) => el.tag === "tr");
  const games4 = rows.map((r) => r.findAll((el) => el.tag === "td")[1].textContent);
  assert.deepEqual(games4.sort(), ["2", "3", "3", "3"]); // d は 3人の対局にいない
  // 4人で絞ると 3人の対局が消えても、まとまりは g1・g3 のまま
  button(root, "4人").handlers.click();
  const heads4 = root.findAll((el) => el.matches(".game-day")).map((el) => el.querySelector("b").textContent);
  assert.equal(heads4.length, 2);
  assert.match(heads4[1], /13:00〜19:00（今日） ・ 2対局$/);
});
