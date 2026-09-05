// 成績画面（docs/design.md §8.5）。集計と対局履歴。

import { h } from "./dom.js";
import { aggregate, derive } from "../stats.js";
import { fmtPoints } from "./format.js";

const pct = (x) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (x, d = 1) => (x === null ? "—" : x.toFixed(d));
const signed = (x) => (x > 0 ? `+${x}` : String(x));

/**
 * props: { games, roster, onBack }
 */
export function renderStats({ games, roster, onBack }) {
  const nameOf = (id) => (roster.find((p) => p.id === id) || { name: "?" }).name;
  const map = aggregate(games);
  const rows = [...map.entries()].map(([id, a]) => ({ id, name: nameOf(id), d: derive(a) })).sort((x, y) => y.d.ptSum - x.d.ptSum);

  const gameTable = h(
    "table",
    { class: "rtable" },
    h(
      "thead",
      null,
      h("tr", null, h("th", null, "名前"), h("th", null, "対局"), h("th", null, "平均順位"), h("th", null, "1/2/3/4位"), h("th", null, "平均素点"), h("th", null, "通算pt"), h("th", null, "通算円")),
    ),
    h(
      "tbody",
      null,
      rows.map((r) =>
        h(
          "tr",
          null,
          h("td", { class: "name" }, r.name),
          h("td", null, String(r.d.games)),
          h("td", null, num(r.d.avgRank, 2)),
          h("td", null, r.d.rankDist.join("/")),
          h("td", null, r.d.avgPoints === null ? "—" : fmtPoints(Math.round(r.d.avgPoints))),
          h("td", { class: `pt` }, signed(Math.round(r.d.ptSum * 10) / 10)),
          h("td", { class: r.d.yenSum > 0 ? "plus" : r.d.yenSum < 0 ? "minus" : "" }, `${signed(r.d.yenSum)}`),
        ),
      ),
    ),
  );

  const kyokuTable = h(
    "table",
    { class: "rtable" },
    h(
      "thead",
      null,
      h("tr", null, h("th", null, "名前"), h("th", null, "有効局"), h("th", null, "和了率"), h("th", null, "放銃率"), h("th", null, "リーチ率"), h("th", null, "副露率"), h("th", null, "平均和了"), h("th", null, "平均放銃")),
    ),
    h(
      "tbody",
      null,
      rows.map((r) =>
        h(
          "tr",
          null,
          h("td", { class: "name" }, r.name),
          h("td", null, String(r.d.effective)),
          h("td", null, pct(r.d.agariRate)),
          h("td", null, pct(r.d.houjuRate)),
          h("td", null, pct(r.d.riichiRate)),
          h("td", null, pct(r.d.meldRate)),
          h("td", null, r.d.avgAgari === null ? "—" : fmtPoints(Math.round(r.d.avgAgari))),
          h("td", null, r.d.avgHouju === null ? "—" : fmtPoints(Math.round(r.d.avgHouju))),
        ),
      ),
    ),
  );

  return h(
    "div",
    { class: "plain-screen stats-screen" },
    h("header", { class: "plain-top" }, h("button", { type: "button", class: "btn-flat", onclick: onBack }, "戻る"), h("div", { class: "plain-title" }, `成績（${games.length}対局）`)),
    games.length === 0
      ? h("section", { class: "card" }, h("div", { class: "hint" }, "終了した対局がありません"))
      : [
          h("section", { class: "card" }, h("h2", null, "対局"), h("div", { class: "stats-wrap" }, gameTable)),
          h("section", { class: "card" }, h("h2", null, "局（チョンボの局は分母に含めない）"), h("div", { class: "stats-wrap" }, kyokuTable)),
          h("div", { class: "hint" }, "対局数が少ないうちは率の差に意味はほとんどありません。対局数と併せて見てください。"),
        ],
  );
}
