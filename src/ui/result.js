// 結果画面（docs/design.md §7, §8.1）。順位・素点・pt・金額・支払い経路・卓外差額。

import { h } from "./dom.js";
import { fmtPoints, fmtDelta } from "./format.js";

function fmtPt(p) {
  const s = Number.isInteger(p) ? String(Math.abs(p)) : Math.abs(p).toFixed(1);
  return p > 0 ? `+${s}` : p < 0 ? `−${s}` : "0";
}
function fmtYen(y) {
  const s = Math.abs(y).toLocaleString("ja-JP");
  return y > 0 ? `+${s}円` : y < 0 ? `−${s}円` : "0円";
}

/**
 * props: { game, names, settlement, title, onBack, onLog, onExport }
 */
export function renderResult({ game, names, settlement: s, title, onBack, onLog, onExport }) {
  const rule = game.rule;
  const n = rule.playerCount;
  const order = [...Array(n).keys()].sort((a, b) => s.ranks[a] - s.ranks[b]);

  const table = h(
    "table",
    { class: "rtable" },
    h("thead", null, h("tr", null, h("th", null, "順位"), h("th", null, "素点"), h("th", null, "pt"), h("th", null, "金額"))),
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
          h("td", { class: s.yen[i] > 0 ? "plus" : s.yen[i] < 0 ? "minus" : "" }, fmtYen(s.yen[i])),
        ),
      ),
    ),
  );

  const label = (i) => (i === null ? "卓外" : names[i]);
  const transfers = s.transfers.length
    ? s.transfers.map((t) => h("div", { class: "transfer" }, h("span", null, `${label(t.from)} → ${label(t.to)}`), h("span", { class: "amt" }, `${t.amount.toLocaleString("ja-JP")}円`)))
    : [h("div", { class: "hint" }, "支払いはありません")];

  const notes = [
    h("div", { class: "kv" }, h("span", null, "レート"), h("b", null, `${rule.rate}円 / pt`)),
    h("div", { class: "kv" }, h("span", null, "ウマ"), h("b", null, rule.uma.join(" / "))),
    h("div", { class: "kv" }, h("span", null, "オカ"), h("b", null, `${s.oka}（トップ）`)),
    s.kyotakuToTop > 0 ? h("div", { class: "kv" }, h("span", null, "残り供託"), h("b", null, `${fmtPoints(s.kyotakuToTop)} をトップに加算`)) : null,
    s.kyotakuRemain > 0 ? h("div", { class: "kv" }, h("span", null, "残り供託"), h("b", null, `${s.kyotakuRemain}本（場に残す）`)) : null,
    h("div", { class: "kv" }, h("span", null, "卓外差額（手動修正の合計）"), h("b", null, fmtDelta(s.outsideDiff))),
    rule.ptRounding === "none" ? null : h("div", { class: "hint" }, "pt は五捨六入。端数とオカはトップが引き受けます。"),
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
          h("div", { class: "hint" }, "データは端末内だけにあります。終局ごとにエクスポートしておくと安全です。"),
          h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn-secondary", onclick: onExport }, "JSON をエクスポート")),
        )
      : null,
  );
}
