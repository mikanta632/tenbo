// 成績集計（docs/design.md §8.5）。純関数。
//
// 局レベルの指標は「有効局」（局末イベントのうち chombo を除いたもの）を分母にする。
// チョンボで流れた局は、その局のリーチ・副露も含めて集計に入れない。

import { kyokuGroups } from "./reduce.js";
import { effectiveWinners } from "./score.js";
import { computeSettlement, settleTransfers } from "./settlement.js";

function emptyAcc() {
  return {
    games: 0,
    rankSum: 0,
    rankDist: [0, 0, 0, 0],
    pointsSum: 0,
    ptSum: 0,
    yenSum: 0,
    effective: 0,
    agari: 0,
    houju: 0,
    riichi: 0,
    meld: 0,
    agariSum: 0,
    houjuSum: 0,
  };
}

/**
 * 1対局の席ごとの集計。
 * 返り値 seats[i] = { playerId, rank, points, pt, yen, effective, agari, houju, riichi, meld, agariSum, houjuSum }
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
    effective: 0,
    agari: 0,
    houju: 0,
    riichi: 0,
    meld: 0,
    agariSum: 0,
    houjuSum: 0,
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

    if (end.t === "agari") {
      const winners = effectiveWinners(end.winners, { tsumo: end.tsumo, from: end.from, rule });
      for (const w of winners) {
        seats[w.who].agari++;
        seats[w.who].agariSum += end.deltas ? end.deltas[w.who] : 0;
      }
      if (!end.tsumo && end.from !== null) {
        seats[end.from].houju++;
        seats[end.from].houjuSum += end.deltas ? -end.deltas[end.from] : 0;
      }
    }
  }
  return { seats, settlement };
}

/**
 * 複数対局をプレイヤーごとに合算する。Map<playerId, acc>
 */
export function aggregate(games) {
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
      a.yenSum += s.yen;
      a.effective += s.effective;
      a.agari += s.agari;
      a.houju += s.houju;
      a.riichi += s.riichi;
      a.meld += s.meld;
      a.agariSum += s.agariSum;
      a.houjuSum += s.houjuSum;
    }
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
      if (!map.has(s.playerId)) map.set(s.playerId, { playerId: s.playerId, games: 0, points: 0, pt: 0, yen: 0 });
      const a = map.get(s.playerId);
      a.games++;
      a.points += s.points;
      a.pt += s.pt;
      a.yen += s.yen;
    }
  }
  const players = [...map.values()].sort((a, b) => b.yen - a.yen);
  return { players, transfers: settleTransfers(players.map((p) => p.yen)) };
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
    yenSum: a.yenSum,
    effective: a.effective,
    agariRate: div(a.agari, a.effective),
    houjuRate: div(a.houju, a.effective),
    riichiRate: div(a.riichi, a.effective),
    meldRate: div(a.meld, a.effective),
    avgAgari: div(a.agariSum, a.agari),
    avgHouju: div(a.houjuSum, a.houju),
  };
}
