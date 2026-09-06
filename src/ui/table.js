// 対局画面（docs/design.md §8.2）。卓中央に置き、各パネルを席の方向に回転させる。

import { h, svg } from "./dom.js";
import { dealerOf, canRiichi } from "../reduce.js";
import { kyokuName, windName, fmtPoints, fmtDelta, fmtElapsed, seatPositions } from "./format.js";

// 点差表示。プラスとマイナスを重ねた ± 。文字ではなく線画にして、リーチ棒の絵と調子を揃える
const ICON_DIFF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
  <path d="M12 4.5v10M7 9.5h10M7 19h10"/></svg>`;

const ICON_RIICHI = `<svg viewBox="0 0 64 24" width="56" height="21" aria-hidden="true">
  <rect x="1" y="4" width="62" height="16" rx="4" fill="#f4f4f4" stroke="#999"/>
  <circle cx="32" cy="12" r="4.5" fill="#d33"/>
</svg>`;

const ICON_MELD = `<svg viewBox="0 0 64 28" width="56" height="24" aria-hidden="true">
  <rect x="2" y="3" width="16" height="22" rx="3" fill="#f7f3e8" stroke="#888"/>
  <rect x="24" y="3" width="16" height="22" rx="3" fill="#f7f3e8" stroke="#888"/>
  <rect x="41" y="8" width="22" height="16" rx="3" fill="#f7f3e8" stroke="#888"/>
  <circle cx="10" cy="14" r="3" fill="#2a7"/>
  <circle cx="32" cy="14" r="3" fill="#2a7"/>
  <circle cx="52" cy="16" r="3" fill="#2a7"/>
</svg>`;

export { seatPositions };

function sticks(count) {
  const shown = Math.min(count, 6);
  const el = h("span", { class: "sticks", "aria-label": `供託${count}本` });
  for (let i = 0; i < shown; i++) el.append(svg(ICON_RIICHI));
  if (count > shown) el.append(h("span", { class: "sticks-more" }, `×${count}`));
  return el;
}

/**
 * 対局画面を描画して要素を返す。
 * actions: { onPanel(seat), onRiichi(seat), onMeld(seat, value), onDiff(seat),
 *            onSpecial(), onMenu(), onLog() }
 * diffSeat: 点差を表示中の席（null なら通常表示）
 */
export function renderTable({ game, state, names, actions, diffSeat = null }) {
  const rule = game.rule;
  const n = rule.playerCount;
  const dealer = dealerOf(state.kyoku, n);
  const pos = seatPositions(game.bottomSeat ?? 0, n, game.emptyPosition || "left");

  const header = h(
    "header",
    { class: "top" },
    h("div", { class: "kyoku" }, kyokuName(state.kyoku, n), " ", h("span", { class: "honba" }, `${state.honba}本場`)),
    h("div", { class: "kyotaku" }, "供託 ", sticks(state.kyotaku)),
  );

  const elapsed = h("span", { class: "elapsed", id: "elapsed" }, fmtElapsed(Date.now() - Date.parse(game.startedAt)));
  const bar = h(
    "div",
    { class: "bar" },
    h("div", { class: "bar-left" }, h("button", { type: "button", class: "btn-flat", onclick: actions.onLog, disabled: !actions.onLog }, "ログ"), elapsed),
  );

  const felt = h("div", { class: "felt" });
  for (const [position, seat] of Object.entries(pos)) {
    felt.append(renderPanel({ position, seat, state, rule, dealer, names, actions, diffSeat }));
  }
  felt.append(
    h(
      "button",
      { type: "button", class: "btn-special", onclick: actions.onSpecial },
      "終局",
    ),
  );

  const footer = h(
    "footer",
    { class: "bottom" },
    h("div", { class: "over-note" }, state.over ? "終局" : ""),
    h("button", { type: "button", class: "btn-flat", onclick: actions.onMenu }, "メニュー"),
  );

  return h("div", { class: "table-screen" }, header, bar, felt, footer);
}

function renderPanel({ position, seat, state, rule, dealer, names, actions, diffSeat }) {
  const n = rule.playerCount;
  const isDealer = seat === dealer;
  const riichiOn = state.round.riichi[seat];
  const melded = state.round.melded[seat];
  const diffMode = diffSeat !== null;
  const isReference = diffSeat === seat;
  const delta = diffMode && !isReference ? state.points[diffSeat] - state.points[seat] : null;
  // リーチ中は再タップで解除できるので有効のまま。未リーチで 1000点未満なら不可
  const riichiDisabled = state.over || (!riichiOn && !canRiichi(state, seat, rule));

  const riichiBtn = h(
    "button",
    {
      type: "button",
      class: `ibtn riichi${riichiOn ? " on" : ""}`,
      "data-no-sound": true, // 共通のクリック音ではなく専用の音を鳴らす
      "aria-label": "リーチ",
      "aria-pressed": riichiOn ? "true" : "false",
      disabled: riichiDisabled,
      onclick: () => actions.onRiichi(seat),
    },
    svg(ICON_RIICHI),
  );
  const meldBtn = h(
    "button",
    {
      type: "button",
      class: `ibtn meld text${melded ? " on" : ""}`,
      "data-no-sound": true,
      "aria-label": "副露",
      "aria-pressed": melded ? "true" : "false",
      disabled: state.over,
      onclick: () => actions.onMeld(seat, !melded),
    },
    "副露",
  );

  const panel = h(
    "div",
    {
      class: `panel${isDealer ? " dealer" : ""}${isReference ? " diff-reference" : ""}`,
      role: "button",
      tabindex: "0",
      "aria-label": diffMode ? `${names[diffSeat]}から見た${names[seat]}との点差表示。タップで持ち点に戻る` : `${names[seat]} の和了入力`,
      // 点差表示中は本体タップで通常表示に戻す（誤って和了入力を開かない）
      onclick: () => (diffMode ? actions.onDiff(diffSeat) : actions.onPanel(seat)),
    },
    h(
      "div",
      { class: "pmeta" },
      h("span", { class: "wind" }, windName(seat, state.kyoku, n)),
      h("span", { class: "pname" }, names[seat]),
      isReference ? h("span", { class: "diff-label" }, "基準") : null,
      riichiOn ? h("span", { class: "flag" }, "リーチ") : null,
      melded ? h("span", { class: "flag" }, "副露") : null,
    ),
    h(
      "div",
      { class: "prow" },
      delta !== null
        ? h("span", { class: `pts point-diff${delta > 0 ? " ahead" : delta < 0 ? " behind" : " tied"}` }, fmtDelta(delta))
        : h("span", { class: `pts${state.points[seat] < 0 ? " neg" : ""}` }, fmtPoints(state.points[seat])),
    ),
  );

  // 点差表示は点数枠の外、パネルの横に置く。枠の中に入れると点数の行の高さを押し上げ、
  // 枠を縮めるとボタンも小さくなってしまう。外に出すとパネルの高さいっぱいの的になる
  const diffBtn = h(
    "button",
    {
      type: "button",
      class: `adj${isReference ? " on" : ""}`,
      "aria-label": "点差表示",
      "aria-pressed": isReference ? "true" : "false",
      onclick: () => actions.onDiff(seat),
    },
    svg(ICON_DIFF),
  );

  // 起家の印。点差ボタンと同じ形の赤いブロックをパネルの左に置く。
  // 起家でない席にも同じ幅の透明な枠を置いて、どの席もパネルの幅をそろえる
  const isChiicha = seat === 0;
  const chiichaSlot = h(
    "span",
    { class: `chiicha-mark${isChiicha ? "" : " off"}`, "aria-hidden": isChiicha ? false : "true" },
    isChiicha ? "起家" : "",
  );

  return h(
    "div",
    { class: `pgroup pos-${position}`, dataset: { seat: String(seat) } },
    h("div", { class: "pbtns" }, riichiBtn, meldBtn),
    h("div", { class: "prow-outer" }, chiichaSlot, panel, diffBtn),
  );
}
