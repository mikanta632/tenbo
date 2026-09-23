// イベント列の畳み込み（docs/design.md §4, §5）。純関数のみ。
//
// State は導出値であり保存しない。各イベントの適用は新しい State を返し、
// 引数の State を書き換えない。イベントの deltas はキャッシュとして信用する
// （再計算は edit.js の責務）。

import { effectiveWinners, nearestWinner, agariChips } from "./score.js";

/** 局末イベントの種別 */
export const END_OF_KYOKU = new Set(["agari", "ryuukyoku", "chombo"]);
/** 局中イベントの種別 */
export const IN_KYOKU = new Set(["riichi", "meld", "kita"]);

export function isEndOfKyoku(event) {
  return END_OF_KYOKU.has(event.t);
}

// ---- 導出ヘルパー（§5） --------------------------------------------------

/** 親の seatIndex */
export function dealerOf(kyoku, playerCount) {
  return kyoku % playerCount;
}
/** 自風。0 = 東、1 = 南、2 = 西、3 = 北 */
export function seatWind(seat, kyoku, playerCount) {
  return (seat - dealerOf(kyoku, playerCount) + playerCount) % playerCount;
}
/** 場。0 = 東場、1 = 南場 */
export function roundWind(kyoku, playerCount) {
  return Math.floor(kyoku / playerCount);
}
/** 局番号（1 始まり） */
export function kyokuNumber(kyoku, playerCount) {
  return (kyoku % playerCount) + 1;
}

/**
 * 順位（0 = トップ）。持ち点の多い順、同点なら seatIndex が小さい方が上位（§7）。
 * 返り値 ranks[i] は席 i の順位。
 */
export function ranksOf(points) {
  const order = points.map((p, i) => i).sort((a, b) => points[b] - points[a] || a - b);
  const ranks = new Array(points.length);
  order.forEach((seat, rank) => (ranks[seat] = rank));
  return ranks;
}

// ---- State ----------------------------------------------------------------

function emptyRound(n) {
  return {
    riichi: new Array(n).fill(false),
    melded: new Array(n).fill(false),
    kita: new Array(n).fill(0),
  };
}

/** 初期状態（§5） */
export function initialState(rule) {
  const n = rule.playerCount;
  return {
    points: new Array(n).fill(rule.startPoints),
    kyoku: 0,
    honba: 0,
    kyotaku: 0,
    over: false,
    chips: new Array(n).fill(0),
    round: emptyRound(n),
  };
}

function cloneState(state) {
  return {
    points: state.points.slice(),
    kyoku: state.kyoku,
    honba: state.honba,
    kyotaku: state.kyotaku,
    over: state.over,
    chips: (state.chips || new Array(state.points.length).fill(0)).slice(),
    round: {
      riichi: state.round.riichi.slice(),
      melded: state.round.melded.slice(),
      kita: state.round.kita.slice(),
    },
  };
}

function addDeltas(points, deltas) {
  if (!deltas) return;
  if (deltas.length !== points.length) {
    throw new Error(`deltas の長さが不正: ${deltas.length} !== ${points.length}`);
  }
  for (let i = 0; i < points.length; i++) points[i] += deltas[i];
}

function addChips(chips, deltas) {
  if (!deltas) return;
  if (deltas.length !== chips.length) {
    throw new Error(`chips の長さが不正: ${deltas.length} !== ${chips.length}`);
  }
  for (let i = 0; i < chips.length; i++) chips[i] += deltas[i];
}

/**
 * トビ賞（§5.2 手順6）。局末の points で tobiLine を割った各人が、各 winner に rule.tobiPrize 枚を払う。
 * rule.chips が偽か tobiPrize が 0 なら空。
 */
export function tobiPrizeChips(points, winnerSeats, rule) {
  const n = points.length;
  const chips = new Array(n).fill(0);
  const prize = rule.tobiPrize ?? 0;
  if (!rule.chips || prize <= 0 || !isTobi(points, rule)) return chips;
  for (let s = 0; s < n; s++) {
    if (points[s] >= (rule.tobiLine ?? 0)) continue;
    for (const w of winnerSeats) {
      if (w === s) continue;
      chips[s] -= prize;
      chips[w] += prize;
    }
  }
  return chips;
}

/** トビ（§5.6）。rule.tobi が真で tobiLine 未満の者がいる */
export function isTobi(points, rule) {
  return !!rule.tobi && points.some((p) => p < (rule.tobiLine ?? 0));
}

/** 延長戦に入っているか（§5.6）。規定局数を超えた局にいる */
export function inExtension(kyoku, rule) {
  return !!rule.extension && kyoku >= rule.length;
}

/** 終局判定（§5.6）。局末イベントの適用後に呼ぶ。アガリやめは自動では終局させない。 */
function judgeOver(next, rule) {
  if (isTobi(next.points, rule)) return true;
  if (next.kyoku < rule.length) return false;
  if (!rule.extension) return true;
  // 延長戦: 誰かが返す点に届いたら終局。延長は 1 場まで
  if (Math.max(...next.points) >= rule.returnPoints) return true;
  if (next.kyoku >= rule.length + rule.playerCount) return true;
  return false;
}

/**
 * リーチを宣言できるか（§5.1）。rule.riichiUnderThousand が偽なら 1000点未満は不可。
 */
export function canRiichi(state, who, rule) {
  if (rule.riichiUnderThousand) return true;
  return state.points[who] >= 1000;
}

/**
 * アガリやめを選べる状態か（§5.6）。局末イベントの適用前後の State で判定する。
 * オーラスで親が連荘し（kyoku が length-1 のまま）、親がトップのとき真。
 */
export function agariYameAvailable(prev, next, rule) {
  if (!rule.agariYame) return false;
  const last = rule.length - 1;
  if (prev.kyoku !== last || next.kyoku !== last) return false;
  if (next.over) return false;
  // 延長戦が有効でトップが返す点に届いていなければ、やめても延長に入るべき状況なので出さない
  if (rule.extension && Math.max(...next.points) < rule.returnPoints) return false;
  const dealer = dealerOf(next.kyoku, rule.playerCount);
  return ranksOf(next.points)[dealer] === 0;
}

/**
 * イベント列の末尾の時点でアガリやめを選べるか。末尾が局末イベントでなければ偽。
 */
export function agariYameAvailableAfter(events, rule) {
  if (events.length === 0) return false;
  const lastEvent = events[events.length - 1];
  // 局の据置だけでは不十分。チョンボのやり直し・途中流局は和了／テンパイ連荘ではない。
  if (lastEvent.t !== "agari" && !(lastEvent.t === "ryuukyoku" && ["exhaustive", "nagashi"].includes(lastEvent.type))) return false;
  const prev = reduce(events.slice(0, -1), rule);
  const next = applyEvent(prev, lastEvent, rule);
  return agariYameAvailable(prev, next, rule);
}

/**
 * 供託の配分（§5.2 手順2）。和了者の deltas とは別に points に加える。
 * "shimocha": 放銃者から反時計回りに最も近い和了者（ツモなら和了者）が総取り
 * "split":    和了者で等分。100点単位で切り捨て、端数は下家取りの者へ
 */
function distributeKyotaku(points, kyotaku, winners, { tsumo, from, rule }) {
  if (kyotaku <= 0 || winners.length === 0) return;
  const total = kyotaku * 1000;
  const n = rule.playerCount;
  const taker = tsumo ? winners[0] : nearestWinner(winners, from, n);
  if (rule.multiRonKyotaku === "split" && winners.length > 1) {
    const share = Math.floor(total / winners.length / 100) * 100;
    let rest = total;
    for (const w of winners) {
      points[w.who] += share;
      rest -= share;
    }
    points[taker.who] += rest;
  } else {
    points[taker.who] += total;
  }
}

// ---- イベントの適用 ------------------------------------------------------

/**
 * 1イベントを適用して新しい State を返す。元の State は変更しない。
 */
export function applyEvent(state, event, rule) {
  const n = rule.playerCount;
  const next = cloneState(state);
  const dealer = dealerOf(state.kyoku, n);

  switch (event.t) {
    // --- 局中の操作（§5.1） ---
    case "riichi":
      next.points[event.who] -= 1000;
      next.kyotaku += 1;
      next.round.riichi[event.who] = true;
      return next;

    case "meld":
      next.round.melded[event.who] = !!event.value;
      return next;

    case "kita":
      next.round.kita[event.who] += event.delta;
      return next;

    // --- 和了（§5.2） ---
    case "agari": {
      const winners = effectiveWinners(event.winners, { tsumo: event.tsumo, from: event.from, rule });
      // 1. 全 winner 分を合算した deltas を一括適用（原子的）
      addDeltas(next.points, event.deltas);
      // 2. 供託の配分
      distributeKyotaku(next.points, next.kyotaku, winners, { tsumo: event.tsumo, from: event.from, rule });
      next.kyotaku = 0;
      // 3. 連荘判定
      const dealerWon = winners.some((w) => w.who === dealer);
      if (dealerWon) {
        next.honba += 1;
      } else {
        next.kyoku += 1;
        next.honba = 0;
      }
      // 4. round リセット
      next.round = emptyRound(n);
      // 5. 終局判定（アガリやめは agariYameAvailable で別途判定し、end イベントで終局する）
      next.over = state.over || judgeOver(next, rule); // 一度終局したら（end を含む）戻らない
      // 6. チップ: 和了時の枚数と、トビで終局したときのトビ賞
      addChips(next.chips, agariChips({ rule, tsumo: event.tsumo, from: event.from, winners: event.winners }));
      addChips(next.chips, tobiPrizeChips(next.points, winners.map((w) => w.who), rule));
      return next;
    }

    // --- 流局（§5.3） ---
    case "ryuukyoku": {
      const type = event.type;
      if (type === "abortive") {
        // 点数移動なし、親は常に連荘、供託は場に残す
        next.honba += 1;
      } else {
        // exhaustive / nagashi: deltas（テンパイ料 or 満貫）を適用
        addDeltas(next.points, event.deltas);
        next.honba += 1;
        const tenpai = event.tenpai || [];
        const dealerStays = rule.renchan === "tenpai" && tenpai.includes(dealer);
        if (!dealerStays) next.kyoku += 1;
      }
      next.round = emptyRound(n);
      next.over = state.over || judgeOver(next, rule);
      // 流し満貫で飛んだら成立者を和了者とみなしてトビ賞（§5.3）
      if (type === "nagashi") addChips(next.chips, tobiPrizeChips(next.points, event.nagashiBy || [], rule));
      return next;
    }

    // --- チョンボ（§5.4） ---
    case "chombo": {
      // その局のリーチ棒を宣言者に返却
      for (let i = 0; i < n; i++) {
        if (state.round.riichi[i]) {
          next.points[i] += 1000;
          next.kyotaku -= 1;
        }
      }
      addDeltas(next.points, event.deltas);
      next.round = emptyRound(n);
      next.over = state.over || judgeOver(next, rule);
      return next;
    }

    // --- 手動修正（§5.5）。chips があればチップ枚数の補正 ---
    case "adjust":
      addDeltas(next.points, event.deltas);
      if (event.chips) addChips(next.chips, event.chips);
      return next;

    // --- 手動終局 ---
    case "end":
      next.over = true;
      return next;

    default:
      throw new Error(`未知のイベント: ${event.t}`);
  }
}

/** イベント列を畳み込んで最終状態を返す。 */
export function reduce(events, rule, from = initialState(rule)) {
  let state = from;
  for (const e of events) state = applyEvent(state, e, rule);
  return state;
}

/**
 * 各イベント適用後の状態を配列で返す（ログ画面用）。
 * states[i] は events[i] を適用した後の状態。states.length === events.length。
 */
export function reduceAll(events, rule) {
  const states = [];
  let state = initialState(rule);
  for (const e of events) {
    state = applyEvent(state, e, rule);
    states.push(state);
  }
  return states;
}

/**
 * イベント列を局に区切る（§4.5）。
 * 各局は { indices: number[], endIndex: number|null } で、
 * indices は局に属するイベントの添字（局中イベントと局末イベントと adjust）、
 * endIndex は局末イベントの添字（未完の局なら null）。
 * `end` イベントはどの局にも属さない。
 * 最後の要素は「進行中の局」で、イベントが無ければ indices は空。
 */
export function kyokuGroups(events) {
  const groups = [];
  let current = { indices: [], endIndex: null };
  events.forEach((e, i) => {
    if (e.t === "end") return;
    current.indices.push(i);
    if (isEndOfKyoku(e)) {
      current.endIndex = i;
      groups.push(current);
      current = { indices: [], endIndex: null };
    }
  });
  groups.push(current);
  return groups;
}
