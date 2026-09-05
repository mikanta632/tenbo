// ログ画面（docs/design.md §8.4）。局一覧と修正。
//
// 表示はイベント列から導出する。各局の「局・本場」は局末イベント適用前の状態、
// 「局末の持ち点」は適用後の状態から取る。

import { h } from "./dom.js";
import { initialState, reduceAll, kyokuGroups, dealerOf } from "../reduce.js";
import { kyokuName, fmtPoints, fmtDelta, hanName, ABORTIVE_KIND_NAMES } from "./format.js";
import { openActionSheet } from "./sheets.js";

function winnerText(w) {
  if (w.yakumanCount > 0) return ["役満", "ダブル役満", "トリプル役満"][w.yakumanCount - 1] + (w.sekinin ? "（包）" : "");
  if (w.han >= 5) return hanName(w.han);
  return `${w.fu}符${w.han}翻`;
}

/** 局末イベントの1行説明 */
export function describeEvent(e, names) {
  if (e.t === "agari") {
    const ws = e.winners.map((w) => `${names[w.who]} ${winnerText(w)}`).join("、");
    return e.tsumo ? `ツモ ${ws}` : `ロン ${ws} ← ${names[e.from]}`;
  }
  if (e.t === "ryuukyoku") {
    if (e.type === "abortive") return `途中流局（${ABORTIVE_KIND_NAMES[e.abortiveKind] || e.abortiveKind || "—"}）`;
    if (e.type === "nagashi") return `流し満貫 ${e.nagashiBy.map((i) => names[i]).join("、")}`;
    const t = e.tenpai.length ? e.tenpai.map((i) => names[i]).join("、") : "全員ノーテン";
    return `流局（テンパイ: ${t}）`;
  }
  if (e.t === "chombo") return `チョンボ ${names[e.who]}`;
  if (e.t === "adjust") return `修正 ${e.deltas.map((d, i) => (d ? `${names[i]} ${fmtDelta(d)}` : null)).filter(Boolean).join(" ")}`;
  if (e.t === "riichi") return `リーチ ${names[e.who]}`;
  if (e.t === "meld") return `${e.value ? "副露" : "副露解除"} ${names[e.who]}`;
  if (e.t === "kita") return `北 ${names[e.who]} ${e.delta > 0 ? "+" : ""}${e.delta}`;
  if (e.t === "end") return "終局";
  return e.t;
}

/**
 * ログ画面を描画する。
 * props: { game, names, title, onBack, onEdit(gi), onInsert(gi), onDelete(gi) }
 */
export function renderLog({ game, names, title, onBack, onEdit, onInsert, onDelete }) {
  const rule = game.rule;
  const n = rule.playerCount;
  const events = game.events;
  const states = reduceAll(events, rule);
  const groups = kyokuGroups(events);
  const init = initialState(rule);
  const stateAt = (i) => (i < 0 ? init : states[i]);

  const list = h("div", { class: "log-list" });

  groups.forEach((g, gi) => {
    const first = g.indices[0];
    const before = first === undefined ? stateAt(events.length - 1) : stateAt(first - 1);
    const done = g.endIndex !== null;
    const after = done ? states[g.endIndex] : null;
    const endEvent = done ? events[g.endIndex] : null;

    const head = h(
      "div",
      { class: "log-head" },
      h("span", { class: "log-kyoku" }, kyokuName(before.kyoku, n)),
      h("span", { class: "log-honba" }, `${before.honba}本場`),
      before.kyotaku > 0 ? h("span", { class: "log-honba" }, `供託${before.kyotaku}`) : null,
      h("span", { class: "log-desc" }, done ? describeEvent(endEvent, names) : "進行中"),
    );

    const subs = g.indices
      .filter((i) => i !== g.endIndex && (events[i].t === "adjust" || events[i].t === "riichi"))
      .map((i) => h("div", { class: "log-sub" }, describeEvent(events[i], names)));

    let pointsRow = null;
    if (done) {
      pointsRow = h(
        "div",
        { class: "log-points" },
        names.map((name, i) => {
          const d = after.points[i] - before.points[i];
          return h(
            "div",
            { class: `log-cell${d > 0 ? " plus" : d < 0 ? " minus" : ""}${i === dealerOf(before.kyoku, n) ? " dealer" : ""}` },
            h("div", { class: "log-name" }, name),
            h("div", { class: "log-delta" }, fmtDelta(d)),
            h("div", { class: "log-after" }, fmtPoints(after.points[i])),
          );
        }),
      );
    }

    const row = h(
      "div",
      {
        class: `log-row${done ? "" : " current"}`,
        role: "button",
        tabindex: "0",
        onclick: () => {
          const items = [];
          if (done) items.push({ label: "この局を編集", sub: describeEvent(endEvent, names), onPick: () => onEdit(gi) });
          items.push({ label: "この局の前に挿入", sub: "局末イベントを1つ挟む", onPick: () => onInsert(gi) });
          if (done) items.push({ label: "この局を削除", sub: "局中のリーチ・副露・修正もまとめて消す", danger: true, onPick: () => onDelete(gi) });
          openActionSheet({ title: `${kyokuName(before.kyoku, n)} ${before.honba}本場`, items });
        },
      },
      head,
      subs,
      pointsRow,
    );
    list.append(row);
  });

  const hasEnd = events.some((e) => e.t === "end");
  if (hasEnd) list.append(h("div", { class: "log-row plain" }, h("div", { class: "log-head" }, h("span", { class: "log-desc" }, "終局（手動／アガリやめ）"))));

  return h(
    "div",
    { class: "log-screen" },
    h(
      "header",
      { class: "log-top" },
      h("button", { type: "button", class: "btn-flat", onclick: onBack }, "戻る"),
      h("div", { class: "log-title" }, title),
      h("span", { class: "log-count" }, `${groups.filter((g) => g.endIndex !== null).length}局`),
    ),
    list,
    h("div", { class: "hint log-hint" }, "行をタップして編集・挿入・削除。編集後は以降の局を再計算します。"),
  );
}
