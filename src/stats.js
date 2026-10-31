// 成績集計（docs/design.md §8.5）。純関数。
//
// 局レベルの指標は「有効局」（局末イベントのうち chombo を除いたもの）を分母にする。
// チョンボで流れた局は、その局のリーチ・副露も含めて集計に入れない。

import { kyokuGroups } from "./reduce.js";
import { effectiveWinners } from "./score.js";
import { computeSettlement, settleTransfers } from "./settlement.js";

/** 集計値の項目。emptyAcc / aggregate / Carry で同じ並びを使う（§8.5） */
export const COUNTERS = Object.freeze([
  "effective", "agari", "houju", "riichi", "meld", "agariSum", "houjuSum",
  "tsumoAgari", "riichiAgari", "meldAgari", "damaAgari", "riichiAgariSum", "meldAgariSum", "damaAgariSum",
  "riichiHouju", "meldHouju", "damaHouju", "riichiRyuukyoku", "meldRyuukyoku",
  "plus", "minus", "tobi", "chipSum",
]);

function emptyAcc() {
  const acc = {
    games: 0,
    rankSum: 0,
    rankDist: [0, 0, 0, 0],
    pointsSum: 0,
    ptSum: 0,
    yenSum: 0,
    maxPoints: null, // 歴代最高素点。記録が無ければ null
  };
  for (const key of COUNTERS) acc[key] = 0;
  return acc;
}

/**
 * 1対局の席ごとの集計。
 * 返り値 seats[i] = { playerId, rank, points, pt, yen, ...COUNTERS }
 *
 * リーチ・副露・ダマの分類は排他ではない（同じ局で両方立つことは実戦では無いが、
 * 記録上はありうる）。ダマは「どちらも無い」局を指す。
 */
export function gameStats(game) {
  const rule = game.rule;
  const n = rule.playerCount;
  const settlement = game.settlement || computeSettlement(game);
  const events = game.events;
  const seats = game.seats.map((playerId, i) => ({
    playerId,
    rank: settlement.ranks[i],
    points: settlement.points[i],
    pt: settlement.pt[i],
    yen: settlement.yen[i],
    // トビ（飛んだ対局を1と数える）。トビ無しルールでは常に 0
    tobi: rule.tobi && settlement.points[i] < (rule.tobiLine ?? 0) ? 1 : 0,
    // チップ収支（枚）。チップ無しルールや古い精算では 0
    chipSum: (settlement.chips && settlement.chips[i]) || 0,
    ...Object.fromEntries(COUNTERS.filter((k) => k !== "tobi" && k !== "chipSum").map((k) => [k, 0])),
  }));

  for (const g of kyokuGroups(events)) {
    if (g.endIndex === null) continue;
    const end = events[g.endIndex];
    if (end.t === "chombo") continue;
    for (const s of seats) s.effective++;

    const riichi = new Set();
    const melded = new Array(n).fill(false);
    for (const i of g.indices) {
      const e = events[i];
      if (e.t === "riichi") riichi.add(e.who);
      else if (e.t === "meld") melded[e.who] = !!e.value;
    }
    for (const who of riichi) seats[who].riichi++;
    melded.forEach((m, i) => {
      if (m) seats[i].meld++;
    });

    // 加点・失点した局
    if (end.deltas) {
      end.deltas.forEach((d, i) => {
        if (d > 0) seats[i].plus++;
        else if (d < 0) seats[i].minus++;
      });
    }

    if (end.t === "ryuukyoku") {
      for (const who of riichi) seats[who].riichiRyuukyoku++;
      melded.forEach((m, i) => {
        if (m) seats[i].meldRyuukyoku++;
      });
    }

    if (end.t === "agari") {
      const winners = effectiveWinners(end.winners, { tsumo: end.tsumo, from: end.from, rule });
      for (const w of winners) {
        const s = seats[w.who];
        const amount = end.deltas ? end.deltas[w.who] : 0;
        s.agari++;
        s.agariSum += amount;
        if (end.tsumo) s.tsumoAgari++;
        if (riichi.has(w.who)) {
          s.riichiAgari++;
          s.riichiAgariSum += amount;
        }
        if (melded[w.who]) {
          s.meldAgari++;
          s.meldAgariSum += amount;
        }
        if (!riichi.has(w.who) && !melded[w.who]) {
          s.damaAgari++;
          s.damaAgariSum += amount;
        }
      }
      if (!end.tsumo && end.from !== null) {
        const s = seats[end.from];
        s.houju++;
        s.houjuSum += end.deltas ? -end.deltas[end.from] : 0;
        if (riichi.has(end.from)) s.riichiHouju++;
        if (melded[end.from]) s.meldHouju++;
        if (!riichi.has(end.from) && !melded[end.from]) s.damaHouju++;
      }
    }
  }
  return { seats, settlement };
}

/**
 * 複数対局をプレイヤーごとに合算する。Map<playerId, acc>
 *
 * carry は旧アプリからの繰越（§8.5）。対局単位の記録を持たないので、集計値のまま足し込む。
 * 呼び出し側で人数（playerCount）を games と揃えておくこと。
 * 未精算の印（unsettled）が付いた対局の円は、まだ払っていないので yenSum に入れない（pt などは入れる）。
 */
export function aggregate(games, carry = []) {
  const map = new Map();
  for (const game of games) {
    const { seats } = gameStats(game);
    for (const s of seats) {
      if (!map.has(s.playerId)) map.set(s.playerId, emptyAcc());
      const a = map.get(s.playerId);
      a.games++;
      a.rankSum += s.rank + 1;
      a.rankDist[s.rank]++;
      a.pointsSum += s.points;
      a.ptSum += s.pt;
      if (!game.unsettled) a.yenSum += s.yen;
      a.maxPoints = a.maxPoints === null ? s.points : Math.max(a.maxPoints, s.points);
      for (const key of COUNTERS) a[key] += s[key];
    }
  }
  for (const c of carry) {
    if (!map.has(c.playerId)) map.set(c.playerId, emptyAcc());
    const a = map.get(c.playerId);
    a.games += c.games;
    c.rankDist.forEach((count, rank) => {
      a.rankDist[rank] += count;
      a.rankSum += (rank + 1) * count;
    });
    for (const key of ["pointsSum", "ptSum", "yenSum"]) a[key] += c[key];
    for (const key of COUNTERS) a[key] += c[key] ?? 0;
    if (c.maxPoints != null) a.maxPoints = a.maxPoints === null ? c.maxPoints : Math.max(a.maxPoints, c.maxPoints);
  }
  return map;
}

/**
 * あるプレイヤーの対局一覧（新しい順のまま）。各要素は
 * { game, seat, rank, points, pt, yen, agari, houju, effective }
 */
export function playerGames(games, playerId) {
  const out = [];
  for (const game of games) {
    const seat = game.seats.indexOf(playerId);
    if (seat < 0) continue;
    const { seats } = gameStats(game);
    const s = seats[seat];
    out.push({ game, seat, rank: s.rank, points: s.points, pt: s.pt, yen: s.yen, agari: s.agari, houju: s.houju, effective: s.effective });
  }
  return out;
}

/**
 * 選んだ複数の対局の収支をプレイヤーごとに合算し、支払い経路を作る（§8.5）。
 * 人数の違う対局（4人と3人）を混ぜてもよい。返り値:
 *   { players: [{ playerId, games, points, pt, yen }], transfers: [{ from, to, amount }] }
 * players は収支の多い順。transfers の from / to は players の添字で、卓外は null。
 */
export function combineGames(games) {
  const map = new Map();
  for (const game of games) {
    for (const s of gameStats(game).seats) {
      if (!map.has(s.playerId)) map.set(s.playerId, { playerId: s.playerId, games: 0, points: 0, pt: 0, yen: 0, chips: 0 });
      const a = map.get(s.playerId);
      a.games++;
      a.points += s.points;
      a.pt += s.pt;
      a.yen += s.yen;
      a.chips += s.chipSum;
    }
  }
  const players = [...map.values()].sort((a, b) => b.yen - a.yen);
  return { players, transfers: settleTransfers(players.map((p) => p.yen)) };
}

/** まとまりの区切り（§8.5）。前の対局の終わりから次の開始までがこれ以内なら同じまとまり */
export const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

/**
 * 連続して行われた対局のまとまり（§8.5）。
 * 開始（無ければ終局）の順に並べ、それまでの終局（無ければ開始）の最も遅いものから
 * 次の開始までが gap 以内なら同じまとまりにする。日時の無い対局は 1つでまとまりにする。
 * 返り値はまとまりの配列で、まとまりも中の対局も新しい順。
 */
export function sessionGroups(games, gap = SESSION_GAP_MS) {
  const time = (iso) => (iso ? Date.parse(iso) : NaN);
  const items = [...games]
    .reverse() // 保存は新しい順。同時刻の対局は最後に裏返したとき保存の順に戻るようにする
    .map((game) => {
      const start = time(game.startedAt || game.endedAt);
      const end = time(game.endedAt || game.startedAt);
      return { game, start, end };
    })
    .sort((a, b) => Number.isNaN(a.start) - Number.isNaN(b.start) || a.start - b.start || 0);
  const groups = [];
  let last = null; // 今のまとまりの最も遅い終わり
  for (const it of items) {
    if (last !== null && !Number.isNaN(it.start) && it.start - last <= gap) {
      groups.at(-1).push(it.game);
      last = Math.max(last, it.end);
    } else {
      groups.push([it.game]);
      last = Number.isNaN(it.start) ? null : it.end;
    }
  }
  return groups.reverse().map((g) => g.reverse());
}

/** 合算値から率と平均を出す。分母が 0 のときは null。 */
export function derive(a) {
  const div = (x, y) => (y > 0 ? x / y : null);
  return {
    games: a.games,
    avgRank: div(a.rankSum, a.games),
    rankDist: a.rankDist,
    avgPoints: div(a.pointsSum, a.games),
    ptSum: a.ptSum,
    avgPt: div(a.ptSum, a.games),
    yenSum: a.yenSum,
    chipSum: a.chipSum,
    effective: a.effective,
    agariCount: a.agari,
    houjuCount: a.houju,
    riichiCount: a.riichi,
    meldCount: a.meld,
    agariRate: div(a.agari, a.effective),
    houjuRate: div(a.houju, a.effective),
    riichiRate: div(a.riichi, a.effective),
    meldRate: div(a.meld, a.effective),
    avgAgari: div(a.agariSum, a.agari),
    avgHouju: div(a.houjuSum, a.houju),
    maxPoints: a.maxPoints,
    tobiRate: div(a.tobi, a.games),
    tsumoRate: div(a.tsumoAgari, a.agari),
    // 立直・副露した局を分母にした内訳
    riichiAgariRate: div(a.riichiAgari, a.riichi),
    riichiHoujuRate: div(a.riichiHouju, a.riichi),
    riichiRyuukyokuRate: div(a.riichiRyuukyoku, a.riichi),
    meldAgariRate: div(a.meldAgari, a.meld),
    meldHoujuRate: div(a.meldHouju, a.meld),
    meldRyuukyokuRate: div(a.meldRyuukyoku, a.meld),
    // 和了・放銃の内訳
    avgRiichiAgari: div(a.riichiAgariSum, a.riichiAgari),
    avgMeldAgari: div(a.meldAgariSum, a.meldAgari),
    avgDamaAgari: div(a.damaAgariSum, a.damaAgari),
    houjuRiichiRate: div(a.riichiHouju, a.houju),
    houjuMeldRate: div(a.meldHouju, a.houju),
    houjuDamaRate: div(a.damaHouju, a.houju),
    plusRate: div(a.plus, a.effective),
    minusRate: div(a.minus, a.effective),
  };
}
