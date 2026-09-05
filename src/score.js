// 点数計算（docs/design.md §6）。純関数のみ。DOM / localStorage / Date に触れない。
//
// すべての公開関数は deltas（席ごとの点数移動の配列、長さ = playerCount）を返す。
// deltas に供託の回収は含めない（供託は reduce.js の §5.2 手順2 で扱う）。

/** 100点単位に切り上げ */
export function ceil100(x) {
  return Math.ceil(x / 100) * 100;
}

function zeros(n) {
  return new Array(n).fill(0);
}

/** 放銃者から反時計回り（下家方向）に数えた距離。0 は放銃者自身。 */
function distanceFrom(from, who, n) {
  return (who - from + n) % n;
}

/**
 * 基本点（§6.1）。役満手と通常手でルートを分ける。
 * winner: { han, fu, yakumanCount }
 */
export function basePoints(winner, rule) {
  const yakumanCount = winner.yakumanCount || 0;
  if (yakumanCount > 0) {
    // 役満手。翻・符は使わない
    return 8000 * (rule.doubleYakuman ? yakumanCount : 1);
  }
  const han = winner.han;
  const fu = winner.fu;
  if (han >= 13) return rule.kazoeYakuman === "yakuman" ? 8000 : 6000; // 数え役満
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  if (han === 5) return 2000;
  let base = Math.min(fu * 2 ** (2 + han), 2000);
  if (rule.kiriageMangan && base === 1920) base = 2000;
  return base;
}

/** ロン時に放銃者が払う額（本場を含まない） */
function ronAmount(base, winnerIsDealer) {
  return ceil100(base * (winnerIsDealer ? 6 : 4));
}

/** ツモ時に 1人の支払者が払う額（本場を含まない） */
function tsumoAmount(base, winnerIsDealer, payerIsDealer) {
  if (winnerIsDealer) return ceil100(base * 2);
  return ceil100(base * (payerIsDealer ? 2 : 1));
}

/** 放銃者から反時計回りに最も近い和了者 */
export function nearestWinner(winners, from, n) {
  let best = null;
  let bestDist = Infinity;
  for (const w of winners) {
    const d = distanceFrom(from, w.who, n);
    if (d < bestDist) {
      best = w;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 複数和了で実際に和了する者（§6.6）。
 * rule.multiRon が偽でロンなら、放銃者から反時計回りに最も近い 1人だけ（頭ハネ）。
 */
export function effectiveWinners(winners, { tsumo, from, rule }) {
  if (tsumo || rule.multiRon || winners.length <= 1) return winners.slice();
  return [nearestWinner(winners, from, rule.playerCount)];
}

/**
 * 1人の和了者の点数移動（§6.2, §6.3, §6.5）。
 *
 * @param {object} p
 * @param {object} p.rule
 * @param {number} p.dealer    親の seatIndex
 * @param {number} p.honba     この和了者が受け取る本場数（受け取らないなら 0）
 * @param {boolean} p.tsumo
 * @param {number|null} p.from 放銃者（ロンのみ）
 * @param {object} p.winner    Winner
 */
export function winnerDeltas({ rule, dealer, honba, tsumo, from, winner }) {
  const n = rule.playerCount;
  const who = winner.who;
  const isDealer = who === dealer;
  const deltas = zeros(n);
  const base = basePoints(winner, rule);

  // 責任払い（§6.5）。役満手でのみ有効。
  const sekinin =
    rule.sekinin &&
    (winner.yakumanCount || 0) > 0 &&
    winner.sekinin &&
    winner.sekinin.who !== who &&
    winner.sekinin.yakumanCount > 0
      ? winner.sekinin
      : null;
  // 責任分は基本点を超えない（doubleYakuman が偽のときの保険）
  const sekininBase = sekinin ? Math.min(8000 * sekinin.yakumanCount, base) : 0;
  const normalBase = base - sekininBase;
  // 本場（§6.2）: ロンは放銃者が honbaPoints × 本場、ツモは各支払者がその 1/3 ずつ。0 なら加算なし
  const honbaRon = rule.honbaPoints ?? 300;
  const honbaTsumo = honbaRon / 3;

  if (tsumo) {
    // 非責任分は通常のツモ配分。本場は各支払者が負担する
    for (let s = 0; s < n; s++) {
      if (s === who) continue;
      const pay = tsumoAmount(normalBase, isDealer, s === dealer) + honbaTsumo * honba;
      deltas[s] -= pay;
      deltas[who] += pay;
    }
    // 責任分は責任者が全額（ロン相当額）を負担
    if (sekininBase > 0) {
      const amt = ronAmount(sekininBase, isDealer);
      deltas[sekinin.who] -= amt;
      deltas[who] += amt;
    }
  } else {
    const normal = ronAmount(normalBase, isDealer) + honbaRon * honba;
    deltas[from] -= normal;
    deltas[who] += normal;
    if (sekininBase > 0) {
      const amt = ronAmount(sekininBase, isDealer);
      // "half": 折半。責任者側を切り上げ、放銃者側を残余とする
      const byResp = rule.sekininRon === "full" ? amt : ceil100(amt / 2);
      const byFrom = amt - byResp;
      deltas[sekinin.who] -= byResp;
      deltas[from] -= byFrom;
      deltas[who] += amt;
    }
  }
  return deltas;
}

/**
 * 和了イベント全体の点数移動（§6.2〜§6.6）。複数和了は各 winner の deltas を合算する。
 *
 * @param {object} p
 * @param {object} p.rule
 * @param {number} p.dealer
 * @param {number} p.honba    場の本場数
 * @param {boolean} p.tsumo
 * @param {number|null} p.from
 * @param {Winner[]} p.winners
 */
export function agariDeltas({ rule, dealer, honba, tsumo, from, winners }) {
  const n = rule.playerCount;
  const effective = effectiveWinners(winners, { tsumo, from, rule });
  const deltas = zeros(n);
  // 本場の帰属（§6.6）。ツモは和了者 1人なので常にその者。
  // null なら全員が受け取る（"each"、または和了者が 1人）
  const honbaTaker =
    tsumo || effective.length <= 1 || rule.multiRonHonba === "each"
      ? null
      : nearestWinner(effective, from, n);
  for (const w of effective) {
    const takesHonba = honbaTaker === null || honbaTaker.who === w.who;
    const d = winnerDeltas({
      rule,
      dealer,
      honba: takesHonba ? honba : 0,
      tsumo,
      from,
      winner: w,
    });
    for (let i = 0; i < n; i++) deltas[i] += d[i];
  }
  return deltas;
}

/**
 * テンパイ料（§6.4）。exhaustive のみ。
 * @param {number[]} p.tenpai テンパイ者の seatIndex
 */
export function tenpaiDeltas({ rule, tenpai }) {
  const n = rule.playerCount;
  const deltas = zeros(n);
  const set = new Set(tenpai);
  const t = set.size;
  if (t === 0 || t === n) return deltas;
  const total = rule.ryuukyokuTenpaiTotal;
  const gain = total / t;
  const loss = total / (n - t);
  for (let i = 0; i < n; i++) deltas[i] = set.has(i) ? gain : -loss;
  return deltas;
}

/**
 * 流し満貫（§5.3 nagashi）。成立者それぞれが独立に満貫（ツモ扱い）を受け取る。
 * テンパイ料・本場は発生させない。
 * @param {number[]} p.nagashiBy 成立者の seatIndex
 */
export function nagashiDeltas({ rule, dealer, nagashiBy }) {
  const n = rule.playerCount;
  const deltas = zeros(n);
  for (const who of nagashiBy) {
    const isDealer = who === dealer;
    for (let s = 0; s < n; s++) {
      if (s === who) continue;
      const pay = tsumoAmount(2000, isDealer, s === dealer);
      deltas[s] -= pay;
      deltas[who] += pay;
    }
  }
  return deltas;
}

/**
 * チョンボ（§6.7）。
 * "mangan": 満貫払い。親なら各子に 4000、子なら親に 4000・各子に 2000。
 *           3人麻雀は支払先が 1人減るだけ（北家分を差し引く）。
 * "manual": 渡された deltas をそのまま使う。
 */
export function chomboDeltas({ rule, dealer, who, deltas: manual }) {
  const n = rule.playerCount;
  if (rule.chomboRule === "manual") {
    if (!Array.isArray(manual) || manual.length !== n) {
      throw new Error("chomboRule が manual のときは deltas が必要");
    }
    return manual.slice();
  }
  const deltas = zeros(n);
  const isDealer = who === dealer;
  for (let s = 0; s < n; s++) {
    if (s === who) continue;
    const amt = isDealer || s === dealer ? 4000 : 2000;
    deltas[s] += amt;
    deltas[who] -= amt;
  }
  return deltas;
}
