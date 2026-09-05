// 対局画面（docs/design.md §8.2）。卓中央に置き、各パネルを席の方向に回転させる。

import { h, svg } from "./dom.js";
import { dealerOf, canRiichi } from "../reduce.js";
import { kyokuName, windName, fmtPoints, fmtElapsed, seatPositions } from "./format.js";

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
 *            onUndo(), onSpecial(), onMenu(), onLog() }
 * diffSeat: 点差を表示中の席（null なら通常表示）
 */
export function renderTable({ game, state, names, actions, diffSeat = null }) {
  const rule = game.rule;
  const n = rule.playerCount;
  const dealer = dealerOf(state.kyoku, n);
  const pos = seatPositions(game.bottomSeat ?? 0, n, rule.emptySeat);

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
    h("button", { type: "button", class: "btn-flat", onclick: actions.onUndo, disabled: game.events.length === 0 }, "戻す"),
  );

  const felt = h("div", { class: "felt" });
  for (const [position, seat] of Object.entries(pos)) {
    felt.append(renderPanel({ position, seat, state, rule, dealer, names, actions, diff: diffSeat === seat }));
  }
  felt.append(
    h(
      "button",
      { type: "button", class: "btn-special", onclick: actions.onSpecial },
      h("span", null, "特殊終局"),
      h("span", { class: "sub" }, "流局など"),
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

/** 押した人と他の人との点差（自分 − 相手）。正なら自分が上。 */
function renderDiffs(seat, state, names) {
  const items = [];
  for (let i = 0; i < state.points.length; i++) {
    if (i === seat) continue;
    const d = state.points[seat] - state.points[i];
    items.push(
      h(
        "span",
        { class: `diff${d > 0 ? " up" : d < 0 ? " down" : ""}` },
        h("span", { class: "diff-name" }, names[i]),
        h("span", { class: "diff-val" }, d > 0 ? `+${fmtPoints(d)}` : d < 0 ? fmtPoints(d) : "±0"),
      ),
    );
  }
  return h("div", { class: "diffs" }, items);
}

function renderPanel({ position, seat, state, rule, dealer, names, actions, diff = false }) {
  const n = rule.playerCount;
  const isDealer = seat === dealer;
  const riichiOn = state.round.riichi[seat];
  const melded = state.round.melded[seat];
  // リーチ中は再タップで解除できるので有効のまま。未リーチで 1000点未満なら不可
  const riichiDisabled = state.over || (!riichiOn && !canRiichi(state, seat, rule));

  const riichiBtn = h(
    "button",
    {
      type: "button",
      class: `ibtn riichi${riichiOn ? " on" : ""}`,
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
      class: `ibtn meld${melded ? " on" : ""}`,
      "aria-label": "副露",
      "aria-pressed": melded ? "true" : "false",
      disabled: state.over,
      onclick: () => actions.onMeld(seat, !melded),
    },
    svg(ICON_MELD),
  );

  const panel = h(
    "div",
    {
      class: `panel${isDealer ? " dealer" : ""}${diff ? " diff-mode" : ""}`,
      role: "button",
      tabindex: "0",
      "aria-label": diff ? `${names[seat]} の点差` : `${names[seat]} の和了入力`,
      // 点差表示中は本体タップで通常表示に戻す（誤って和了入力を開かない）
      onclick: () => (diff ? actions.onDiff(seat) : actions.onPanel(seat)),
    },
    h(
      "div",
      { class: "pmeta" },
      h("span", { class: "wind" }, windName(seat, state.kyoku, n)),
      seat === 0 ? h("span", { class: "chiicha" }, "起家") : null,
      h("span", { class: "pname" }, names[seat]),
      riichiOn ? h("span", { class: "flag" }, "リーチ") : null,
      melded ? h("span", { class: "flag" }, "副露") : null,
    ),
    h(
      "div",
      { class: "prow" },
      diff
        ? renderDiffs(seat, state, names)
        : h("span", { class: `pts${state.points[seat] < 0 ? " neg" : ""}` }, fmtPoints(state.points[seat])),
      h(
        "button",
        {
          type: "button",
          class: `adj${diff ? " on" : ""}`,
          "aria-label": "点差表示",
          "aria-pressed": diff ? "true" : "false",
          onclick: (e) => {
            e.stopPropagation();
            actions.onDiff(seat);
          },
        },
        "+/−",
      ),
    ),
  );

  return h(
    "div",
    { class: `pgroup pos-${position}`, dataset: { seat: String(seat) } },
    h("div", { class: "pbtns" }, riichiBtn, meldBtn),
    panel,
  );
}
