// 精算（docs/design.md §7）。純関数。Date に触れない。
//
// 順位・pt・円・支払い経路・卓外差額を Game から導出する。

import { reduce, ranksOf } from "./reduce.js";

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
 * 対局の精算を計算する。
 *
 * - 終局時の供託は rule.finalKyotaku === "top" ならトップの持ち点に加算する
 * - pt(i) = 丸め((points − returnPoints) / 1000) + uma[rank]
 *   ptRounding が "round5"（五捨六入）のときは、トップの pt を他の合計の符号反転とし、
 *   丸めの端数とオカをトップが引き受ける。"none" のときはトップに オカ を加える
 * - 円 = pt × rate（rateBase "point"）。"rawScore" は (points − startPoints)/1000 × rate（暫定）
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
  const top = ranks.indexOf(0);
  const oka = ((rule.returnPoints - rule.startPoints) * n) / 1000;
  const rounding = rule.ptRounding === "none" ? (d) => d / 1000 : round56;

  const pt = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === top) continue;
    pt[i] = rounding(points[i] - rule.returnPoints) + rule.uma[ranks[i]];
  }
  if (rule.ptRounding === "none") {
    pt[top] = rounding(points[top] - rule.returnPoints) + rule.uma[0] + oka;
  } else {
    pt[top] = -pt.reduce((a, b) => a + b, 0);
  }

  const yen = pt.map((p, i) => (rule.rateBase === "rawScore" ? ((points[i] - rule.startPoints) / 1000) * rule.rate : p * rule.rate));
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
    oka,
    kyotakuToTop,
    kyotakuRemain,
    outsideDiff,
    transfers: settleTransfers(rounded),
  };
}
