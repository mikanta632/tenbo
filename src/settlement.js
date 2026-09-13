// 精算（docs/design.md §7）。純関数。Date に触れない。
//
// 順位・pt・円・チップ・支払い経路・卓外差額を Game から導出する。

import { reduce, ranksOf, kyokuGroups } from "./reduce.js";
import { effectiveWinners } from "./score.js";

/**
 * 五捨六入。点差（点）を 1000 点単位の整数 pt にする。
 * 下 3桁が 500 以下なら切り捨て、600 以上なら切り上げ。負数は絶対値で丸めて符号を戻す。
 *   2500 → 2、2600 → 3、−2500 → −2、−2600 → −3
 */
export function round56(points) {
  const r = Math.floor((Math.abs(points) + 400) / 1000);
  if (r === 0) return 0; // −0 を作らない
  return points < 0 ? -r : r;
}

/**
 * 収支（円）から「誰が誰にいくら払うか」を貪欲法で作る。
 * balances[i] > 0 は受取、< 0 は支払。合計が 0 でない場合、残りは卓外との授受として
 * to / from を null にして返す。
 */
export function settleTransfers(balances) {
  const creditors = [];
  const debtors = [];
  balances.forEach((b, i) => {
    if (b > 0) creditors.push({ i, amt: b });
    else if (b < 0) debtors.push({ i, amt: -b });
  });
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);
  const transfers = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const amt = Math.min(c.amt, d.amt);
    transfers.push({ from: d.i, to: c.i, amount: amt });
    c.amt -= amt;
    d.amt -= amt;
    if (c.amt === 0) ci++;
    if (d.amt === 0) di++;
  }
  for (; ci < creditors.length; ci++) if (creditors[ci].amt > 0) transfers.push({ from: null, to: creditors[ci].i, amount: creditors[ci].amt });
  for (; di < debtors.length; di++) if (debtors[di].amt > 0) transfers.push({ from: debtors[di].i, to: null, amount: debtors[di].amt });
  return transfers;
}

/**
 * 順位のグループ（§7 同点の扱い）。上位から順に [seatIndex, ...] の配列。
 * tieBreak が "split" なら同点の者を同じグループにまとめ、それ以外は 1人ずつ。
 */
function rankGroups(points, ranks, rule) {
  const order = [...points.keys()].sort((a, b) => ranks[a] - ranks[b]);
  const groups = [];
  for (const seat of order) {
    const last = groups[groups.length - 1];
    if (rule.tieBreak === "split" && last && points[last[0]] === points[seat]) last.push(seat);
    else groups.push([seat]);
  }
  return groups;
}

/**
 * 焼き鳥（§7）。和了が 0 回の席が他の各人に rule.yakitori 枚を払う。
 * 戻り値 { chips: [枚の増減], seats: [焼き鳥の席] }
 */
export function yakitoriChips(game) {
  const rule = game.rule;
  const n = rule.playerCount;
  const chips = new Array(n).fill(0);
  const per = rule.yakitori ?? 0;
  if (!rule.chips || per <= 0) return { chips, seats: [] };
  const agari = new Array(n).fill(0);
  const events = game.events;
  for (const g of kyokuGroups(events)) {
    if (g.endIndex === null) continue;
    const end = events[g.endIndex];
    if (end.t === "agari") {
      for (const w of effectiveWinners(end.winners, { tsumo: end.tsumo, from: end.from, rule })) agari[w.who]++;
    } else if (end.t === "ryuukyoku" && end.type === "nagashi" && rule.yakitoriNagashi !== false) {
      for (const who of end.nagashiBy || []) agari[who]++;
    }
  }
  const seats = [];
  for (let s = 0; s < n; s++) {
    if (agari[s] > 0) continue;
    seats.push(s);
    for (let t = 0; t < n; t++) {
      if (t === s) continue;
      chips[s] -= per;
      chips[t] += per;
    }
  }
  return { chips, seats };
}

/**
 * 対局の精算を計算する。
 *
 * - 終局時の供託は rule.finalKyotaku === "top" ならトップの持ち点に加算する
 * - pt(i) = 丸め((points − returnPoints) / 1000) + 順位点
 *   順位点はウマ（トップならオカも）。tieBreak "split" なら同点の者で等分する
 *   ptRounding が "round5"（五捨六入）のときは、トップ（のグループ）の pt を他の合計の符号反転とし、
 *   丸めの端数とオカをトップが引き受ける。"none" のときは式のまま
 * - チップ = State.chips + 焼き鳥。円 = pt × rate + チップ × chipRate
 * - 卓外差額 = 全 adjust の deltas の合計（点）。表示用で、pt には反映しない
 */
export function computeSettlement(game) {
  const rule = game.rule;
  const n = rule.playerCount;
  const state = reduce(game.events, rule);
  const points = state.points.slice();

  let kyotakuToTop = 0;
  let kyotakuRemain = 0;
  if (state.kyotaku > 0) {
    if (rule.finalKyotaku === "remain") {
      kyotakuRemain = state.kyotaku;
    } else {
      const top = ranksOf(points).indexOf(0);
      kyotakuToTop = state.kyotaku * 1000;
      points[top] += kyotakuToTop;
    }
  }

  const ranks = ranksOf(points);
  const oka = ((rule.returnPoints - rule.startPoints) * n) / 1000;
  const rounding = rule.ptRounding === "none" ? (d) => d / 1000 : round56;
  const groups = rankGroups(points, ranks, rule);

  // 順位点: グループが占める順位のウマ（トップを含むならオカも）を人数で割る
  const share = new Array(n).fill(0);
  groups.forEach((group, gi) => {
    let total = group.reduce((sum, seat) => sum + rule.uma[ranks[seat]], 0);
    if (gi === 0) total += oka;
    for (const seat of group) share[seat] = total / group.length;
  });

  const pt = new Array(n).fill(0);
  const topGroup = groups[0];
  for (let i = 0; i < n; i++) {
    if (rule.ptRounding !== "none" && topGroup.includes(i)) continue;
    pt[i] = rounding(points[i] - rule.returnPoints) + share[i];
  }
  if (rule.ptRounding !== "none") {
    const rest = -pt.reduce((a, b) => a + b, 0) || 0; // −0 を作らない
    for (const seat of topGroup) pt[seat] = rest / topGroup.length;
  }

  // チップ（§7）。rule.chips が偽なら全て 0
  const yakitori = yakitoriChips(game);
  const chips = rule.chips ? state.chips.map((c, i) => c + yakitori.chips[i]) : new Array(n).fill(0);
  const chipRate = rule.chips ? rule.chipRate ?? 0 : 0;
  const chipYen = chips.map((c) => c * chipRate);
  const tobiSeats = rule.chips && (rule.tobiPrize ?? 0) > 0 && rule.tobi ? [...points.keys()].filter((i) => state.points[i] < (rule.tobiLine ?? 0)) : [];

  const yen = pt.map((p, i) => p * rule.rate + chipYen[i]);
  const rounded = yen.map((y) => Math.round(y));

  let outsideDiff = 0;
  for (const e of game.events) {
    if (e.t === "adjust" && e.deltas) outsideDiff += e.deltas.reduce((a, b) => a + b, 0);
  }

  return {
    points,
    ranks,
    pt,
    yen: rounded,
    chips,
    chipYen,
    yakitoriSeats: yakitori.seats,
    tobiSeats,
    oka,
    kyotakuToTop,
    kyotakuRemain,
    outsideDiff,
    transfers: settleTransfers(rounded),
  };
}
