// 個人ページ（player.js）を最小 DOM で描く。指標カード・帯グラフ・対局一覧が揃うことを見る。

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPlayer } from "../src/ui/player.js";
import { PRESETS } from "../src/rules.js";
import { appendEvent } from "../src/edit.js";
import { mockDom } from "./support/dom.js";

const rule = PRESETS["4人標準"];
const seats = ["a", "b", "c", "d"];

function game(id, day) {
  const events = [
    { t: "riichi", who: 0 },
    { t: "agari", tsumo: false, from: 1, winners: [{ who: 0, han: 3, fu: 30, yakumanCount: 0, sekinin: null, chips: 0 }] },
    { t: "ryuukyoku", type: "exhaustive", abortiveKind: null, tenpai: [0], nagashiBy: [] },
  ].reduce((list, e) => appendEvent(list, e, rule), []);
  return { id, startedAt: `2026-09-0${day}T01:00:00Z`, endedAt: `2026-09-0${day}T03:00:00Z`, rule, seats, events, settlement: null };
}

const carry = {
  playerId: "a", playerCount: 4, games: 41, rankDist: [12, 9, 7, 13],
  pointsSum: 1007493, ptSum: 20, yenSum: 68920, maxPoints: 65100,
  effective: 442, agari: 89, houju: 57, riichi: 114, meld: 67, agariSum: 575999, houjuSum: 320699,
  tsumoAgari: 41, riichiAgari: 45, meldAgari: 21, damaAgari: 23,
  riichiAgariSum: 360500, meldAgariSum: 81600, damaAgariSum: 133899,
  riichiHouju: 15, meldHouju: 9, damaHouju: 33, riichiRyuukyoku: 27, meldRyuukyoku: 11,
  plus: 131, minus: 219, tobi: 5,
};

test("個人ページは指標・順位分布・pt推移・対局一覧を出す", (t) => {
  mockDom(t);
  const root = renderPlayer({
    playerId: "a",
    roster: seats.map((id) => ({ id, name: id.toUpperCase() })),
    games: [game("g2", 6), game("g1", 5)],
    carry: [carry],
    scopeLabel: "4人麻雀",
    scopePc: 4,
    onBack: () => {},
    onOpenResult: () => {},
    onRename: () => {},
  });
  const text = root.textContent;
  assert.match(text, /通算（43対局）/); // 繰越 41 + 新しい 2
  // 金額は 3桁区切りで、単位は付けない（繰越 68,920 + 新しい2対局 4,400）
  assert.match(text, /通算 円\+73,320/);
  assert.ok(!/\+\d{4,}(?!,)/.test(text), "桁区切りのない4桁以上の数が残っている");
  for (const label of ["連対率", "ラス率", "トビ率", "最高素点", "加点率", "ツモ率", "ダマ時", "リーチ中", "内訳"]) {
    assert.ok(text.includes(label), `${label} が無い`);
  }
  // 順位分布の帯と凡例
  assert.equal(root.findAll((el) => (el.className || "").startsWith("rank-seg")).length, 4);
  assert.match(text, /1位 14/); // 繰越 12 + 新しい 2
  // pt 推移（2対局あるので出る）と対局一覧
  assert.ok(root.find((el) => el.tag === "svg"), "pt の推移が無い");
  assert.equal(root.findAll((el) => el.tag === "button" && (el.className || "").includes("game-row")).length, 2);
  // ラスの印は 4人麻雀なら 4位に付く
  assert.equal(root.findAll((el) => (el.className || "").includes("rank-badge")).length, 2);
});
