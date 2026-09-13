// 結果画面（docs/design.md §7, §8.1, §8.6）。順位・素点・pt・チップ・金額・支払い経路・卓外差額。

import { h } from "./dom.js";
import { fmtPoints, fmtDelta, fmtPt, fmtYen } from "./format.js";

/**
 * props: { game, names, settlement, title, onBack, onLog, onExport }
 */
export function renderResult({ game, names, settlement: s, title, onBack, onLog, onExport }) {
  const rule = game.rule;
  const n = rule.playerCount;
  const order = [...Array(n).keys()].sort((a, b) => s.ranks[a] - s.ranks[b]);
  const chips = !!rule.chips;
  const chipOf = (i) => (s.chips && s.chips[i]) || 0;

  const table = h(
    "table",
    { class: "rtable" },
    h(
      "thead",
      null,
      h("tr", null, h("th", null, "順位"), h("th", null, "素点"), h("th", null, "pt"), chips ? h("th", null, "チップ") : null, h("th", null, "金額（円）")),
    ),
    h(
      "tbody",
      null,
      order.map((i) =>
        h(
          "tr",
          null,
          h("td", { class: "name" }, `${s.ranks[i] + 1}位 ${names[i]}`),
          h("td", null, fmtPoints(s.points[i])),
          h("td", { class: "pt" }, fmtPt(s.pt[i])),
          chips ? h("td", null, fmtDelta(chipOf(i))) : null,
          h("td", { class: s.yen[i] > 0 ? "plus" : s.yen[i] < 0 ? "minus" : "" }, fmtYen(s.yen[i])),
        ),
      ),
    ),
  );

  const label = (i) => (i === null ? "卓外" : names[i]);
  const transfers = s.transfers.length
    ? s.transfers.map((t) => h("div", { class: "transfer" }, h("span", null, `${label(t.from)} → ${label(t.to)}`), h("span", { class: "amt" }, `${t.amount.toLocaleString("ja-JP")}円`)))
    : [h("div", { class: "hint" }, "支払いはありません")];

  const seatsText = (list) => (list && list.length ? list.map((i) => names[i]).join("・") : "なし");
  const notes = [
    h("div", { class: "kv" }, h("span", null, "レート"), h("b", null, `${rule.rate}円 / pt`)),
    h("div", { class: "kv" }, h("span", null, "ウマ"), h("b", null, rule.uma.join(" / "))),
    h("div", { class: "kv" }, h("span", null, "オカ"), h("b", null, `${s.oka}（トップ${rule.tieBreak === "split" ? "。同点なら等分" : ""}）`)),
    s.kyotakuToTop > 0 ? h("div", { class: "kv" }, h("span", null, "残り供託"), h("b", null, `${fmtPoints(s.kyotakuToTop)} をトップに加算`)) : null,
    s.kyotakuRemain > 0 ? h("div", { class: "kv" }, h("span", null, "残り供託"), h("b", null, `${s.kyotakuRemain}本（場に残す）`)) : null,
    chips ? h("div", { class: "kv" }, h("span", null, "チップ単価"), h("b", null, `${rule.chipRate ?? 0}円 / 枚`)) : null,
    chips && rule.yakitori > 0 ? h("div", { class: "kv" }, h("span", null, `焼き鳥（各人に${rule.yakitori}枚）`), h("b", null, seatsText(s.yakitoriSeats))) : null,
    chips && rule.tobiPrize > 0 ? h("div", { class: "kv" }, h("span", null, `トビ賞（和了者に${rule.tobiPrize}枚）`), h("b", null, seatsText(s.tobiSeats))) : null,
    h("div", { class: "kv" }, h("span", null, "卓外差額（手動修正の合計）"), h("b", null, fmtDelta(s.outsideDiff))),
    chips && s.outsideChips ? h("div", { class: "kv" }, h("span", null, "卓外差額（チップ）"), h("b", null, `${fmtDelta(s.outsideChips)}枚`)) : null,
  ];

  return h(
    "div",
    { class: "plain-screen result-screen" },
    h(
      "header",
      { class: "plain-top" },
      h("button", { type: "button", class: "btn-flat", onclick: onBack }, "戻る"),
      h("div", { class: "plain-title" }, title),
      onLog ? h("button", { type: "button", class: "btn-flat", onclick: onLog }, "ログ") : null,
    ),
    h("section", { class: "card" }, h("h2", null, "結果"), table),
    h("section", { class: "card" }, h("h2", null, "支払い"), transfers),
    h("section", { class: "card" }, h("h2", null, "内訳"), notes),
    onExport
      ? h(
          "section",
          { class: "card" },
          h("h2", null, "バックアップ"),
          h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn-secondary", onclick: onExport }, "JSON をエクスポート")),
        )
      : null,
  );
}
