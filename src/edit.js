// イベント列の編集と再計算（docs/design.md §4.5, §8.4）。
//
// イベント列は不変値として扱い、すべての関数は新しい配列を返す。
// 得点イベント（agari / ryuukyoku / chombo）の deltas は、保存された意味情報
// （winners の翻符、tenpai、tsumo、from など）から、その時点の State を使って計算する。
// adjust の deltas は意味情報を持たないため、そのまま保持する。

import { agariDeltas, tenpaiDeltas, nagashiDeltas, chomboDeltas } from "./score.js";
import { initialState, applyEvent, reduce, dealerOf, kyokuGroups, isEndOfKyoku } from "./reduce.js";

/**
 * イベントの意味情報と適用前の State から deltas を計算する。
 * deltas を持たないイベント（riichi / meld / kita / end）には undefined を返す。
 */
export function computeDeltas(event, state, rule) {
  const n = rule.playerCount;
  const dealer = dealerOf(state.kyoku, n);
  switch (event.t) {
    case "agari":
      return agariDeltas({
        rule,
        dealer,
        honba: state.honba,
        tsumo: event.tsumo,
        from: event.from,
        winners: event.winners,
      });
    case "ryuukyoku":
      if (event.type === "exhaustive") return tenpaiDeltas({ rule, tenpai: event.tenpai || [] });
      if (event.type === "abortive") return new Array(n).fill(0);
      if (event.type === "nagashi") return nagashiDeltas({ rule, dealer, nagashiBy: event.nagashiBy || [] });
      throw new Error(`未知の流局タイプ: ${event.type}`);
    case "chombo":
      return chomboDeltas({ rule, dealer, who: event.who, deltas: event.deltas });
    case "adjust":
      return event.deltas;
    default:
      return undefined;
  }
}

/** deltas を計算して埋めたイベントのコピーを返す。 */
export function withDeltas(event, state, rule) {
  const deltas = computeDeltas(event, state, rule);
  if (deltas === undefined) return { ...event };
  return { ...event, deltas };
}

/**
 * from 以降のすべての得点イベントの deltas を順に再計算する（§8.4）。
 * from より前はそのまま。新しい配列を返す。
 */
export function recalc(events, rule, from = 0) {
  const result = events.slice(0, from);
  let state = reduce(result, rule, initialState(rule));
  for (let i = from; i < events.length; i++) {
    const e = withDeltas(events[i], state, rule);
    result.push(e);
    state = applyEvent(state, e, rule);
  }
  return result;
}

/** 末尾にイベントを追加する。deltas は現在の状態から計算する。 */
export function appendEvent(events, event, rule) {
  const state = reduce(events, rule);
  return [...events, withDeltas(event, state, rule)];
}

/** index のイベントを差し替え、以降を再計算する。 */
export function replaceEvent(events, index, event, rule) {
  const next = events.slice();
  next[index] = event;
  return recalc(next, rule, index);
}

/** index の位置にイベントを挿入し、以降を再計算する。 */
export function insertEvent(events, index, event, rule) {
  const next = events.slice();
  next.splice(index, 0, event);
  return recalc(next, rule, index);
}

/** index のイベントを削除し、以降を再計算する。「戻す」は末尾の削除。 */
export function removeEvent(events, index, rule) {
  const next = events.slice();
  next.splice(index, 1);
  return recalc(next, rule, index);
}

/** 最後のイベントを削除する（「戻す」）。 */
export function undoLast(events, rule) {
  if (events.length === 0) return events.slice();
  return removeEvent(events, events.length - 1, rule);
}

/**
 * 局をまとめて削除する（§4.5, §8.4）。
 * groupIndex は kyokuGroups(events) の添字。その局に属する
 * riichi / meld / kita / adjust と局末イベントを全て削除し、以降を再計算する。
 */
export function deleteKyoku(events, groupIndex, rule) {
  const groups = kyokuGroups(events);
  const group = groups[groupIndex];
  if (!group) throw new Error(`局が存在しない: ${groupIndex}`);
  if (group.indices.length === 0) return events.slice();
  const drop = new Set(group.indices);
  const next = events.filter((_, i) => !drop.has(i));
  return recalc(next, rule, group.indices[0]);
}

/**
 * 局末イベントだけを差し替える（ログ画面の行編集）。
 * その局の局中イベントは保持し、以降を再計算する。
 */
export function replaceKyokuEnd(events, groupIndex, endEvent, rule) {
  const groups = kyokuGroups(events);
  const group = groups[groupIndex];
  if (!group) throw new Error(`局が存在しない: ${groupIndex}`);
  if (group.endIndex === null) {
    // 進行中の局: 末尾に追加する
    return appendEvent(events, endEvent, rule);
  }
  if (!isEndOfKyoku(endEvent)) throw new Error("局末イベントではない: " + endEvent.t);
  return replaceEvent(events, group.endIndex, endEvent, rule);
}

/**
 * Game に編集済みのイベント列を反映する。settlement は null に戻す（§8.4 手順4）。
 */
export function withEvents(game, events) {
  return { ...game, events, settlement: null };
}
