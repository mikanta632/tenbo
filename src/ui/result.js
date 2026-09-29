// 結果画面（docs/design.md §7, §8.1, §8.6）。順位・素点・pt・チップ・金額・支払い経路・卓外差額。

import { h, svg } from "./dom.js";
import { pointsByKyoku } from "../reduce.js";
import { niceTicks } from "./player.js";
import { fmtPoints, fmtDelta, fmtPt, fmtYen } from "./format.js";
import { backupRow } from "./misc.js";

// 席ごとの線の色。席の順に固定し、順位では変えない（検証済みの並び。暗い面に合わせた段）
const SEAT_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500"];

/** 名前の描画幅の見積り（全角は 11px、半角は 6.5px の文字として） */
const textWidth = (text) => [...text].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 11 : 6.5), 0);
const shortName = (name) => ([...name].length > 5 ? [...name].slice(0, 4).join("") + "…" : name);

/**
 * 系列名の縦位置。終点が近い系列の名前が重ならないよう、上から順に最小の間隔を空けて範囲内に収める。
 * ys は各系列の終点の y。戻り値は同じ並びの y。
 */
export function spreadLabels(ys, gap, min, max) {
  const order = ys.map((y, i) => i).sort((a, b) => ys[a] - ys[b]);
  const out = [...ys];
  let prev = min - gap;
  for (const i of order) {
    out[i] = Math.max(ys[i], prev + gap);
    prev = out[i];
  }
  let next = max + gap;
  for (const i of [...order].reverse()) {
    out[i] = Math.min(out[i], next - gap);
    next = out[i];
  }
  return out;
}

/**
 * 局の終わりごとの持ち点の折れ線（§8.6）。SVG を組み立てるだけ。
 * 縦軸は持ち点の目盛りと格子線（開始点の線だけ破線）、横軸は局の終わりの回数。終点に丸と名前を添える。
 * series は pointsByKyoku の戻り値（時点ごとの席ごとの持ち点）。
 */
export function pointsChart(series, names, startPoints) {
  const n = names.length;
  const K = series.length - 1;
  const all = series.flat();
  const y = niceTicks(Math.min(...all), Math.max(...all), 5);
  const W = 320;
  const H = 190;
  const T = 10;
  const B = 22;
  const L = 12 + Math.max(...y.ticks.map((v) => fmtPoints(v).length)) * 6;
  const R = 14 + Math.min(80, Math.max(...names.map((name) => textWidth(shortName(name)))));
  const xStep = Math.max(1, Math.ceil(niceTicks(0, K).step));
  const px = (i) => L + (i * (W - L - R)) / Math.max(K, 1);
  const py = (v) => T + ((y.hi - v) * (H - T - B)) / (y.hi - y.lo);
  const muted = "#b9c9bf";
  const f = (v) => v.toFixed(1);
  const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  const grid = y.ticks
    .map((v) => {
      const yy = f(py(v));
      return `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
    <text x="${L - 6}" y="${yy}" font-size="10" fill="${muted}" text-anchor="end" dominant-baseline="middle">${fmtPoints(v)}</text>`;
    })
    .join("");
  const startY = f(py(startPoints));
  const startLine = `<line x1="${L}" y1="${startY}" x2="${W - R}" y2="${startY}" stroke="rgba(255,255,255,0.45)" stroke-width="1" stroke-dasharray="3 3"/>`;
  const xAxis = [];
  for (let i = 0; i <= K; i += xStep) xAxis.push(`<text x="${f(px(i))}" y="${H - 6}" font-size="10" fill="${muted}" text-anchor="middle">${i}</text>`);

  const seats = [...Array(n).keys()];
  const lines = seats
    .map((s) => {
      const color = SEAT_COLORS[s % SEAT_COLORS.length];
      const points = series.map((p, i) => `${f(px(i))},${f(py(p[s]))}`).join(" ");
      return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    })
    .join("");
  const ends = series[K];
  const labelYs = spreadLabels(seats.map((s) => py(ends[s])), 13, T + 6, H - B - 4);
  const marks = seats
    .map((s) => {
      const color = SEAT_COLORS[s % SEAT_COLORS.length];
      return `<circle cx="${f(px(K))}" cy="${f(py(ends[s]))}" r="4" fill="${color}" stroke="#0e2a1c" stroke-width="2"/>
    <text class="points-chart-name" x="${f(px(K) + 9)}" y="${f(labelYs[s])}" font-size="11" fill="#f4f4f4" dominant-baseline="middle">${escape(shortName(names[s]))}</text>`;
    })
    .join("");
  const summary = seats.map((s) => `${names[s]} ${fmtPoints(ends[s])}`).join("、");
  return svg(`<svg class="points-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(`持ち点の推移。${K}局を終えて ${summary}`)}">
    ${grid}
    ${startLine}
    ${xAxis.join("")}
    ${lines}
    ${marks}
  </svg>`);
}

/** 凡例。線の色と名前と今の持ち点 */
function pointsLegend(series, names) {
  const ends = series[series.length - 1];
  return h(
    "div",
    { class: "rank-legend" },
    names.map((name, s) => h("span", { class: "rank-legend-item" }, h("i", { class: "pts-dot", style: `background:${SEAT_COLORS[s % SEAT_COLORS.length]}` }), `${name} ${fmtPoints(ends[s])}`)),
  );
}

/**
 * props: { game, names, settlement, title, backup, onBack, onLog, onExport }
 */
export function renderResult({ game, names, settlement: s, title, backup, onBack, onLog, onExport }) {
  const rule = game.rule;
  const n = rule.playerCount;
  const order = [...Array(n).keys()].sort((a, b) => s.ranks[a] - s.ranks[b]);
  const chips = !!rule.chips;
  const series = pointsByKyoku(game.events, rule);
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
    series.length >= 2
      ? h("section", { class: "card" }, h("h2", null, "持ち点の推移（局の終わりごと）"), pointsChart(series, names, rule.startPoints), pointsLegend(series, names))
      : null,
    h("section", { class: "card" }, h("h2", null, "支払い"), transfers),
    h("section", { class: "card" }, h("h2", null, "内訳"), notes),
    onExport
      ? h(
          "section",
          { class: "card" },
          h("h2", null, "バックアップ"),
          backupRow(backup),
          h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn-secondary", onclick: onExport }, "JSON をエクスポート")),
        )
      : null,
  );
}
