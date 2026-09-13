// 点数計算（docs/design.md §6）。純関数のみ。DOM / localStorage / Date に触れない。
//
// すべての公開関数は deltas（席ごとの点数移動の配列、長さ = playerCount）を返す。
// deltas に供託の回収は含めない（供託は reduce.js の §5.2 手順2 で扱う）。
//
// 支払いは「単価」（ロンの額、ツモの各支払者の額）に抽象化し、3人麻雀の点数方式（§6.3）は
// 単価の作り方だけが違う。和了・流し満貫・チョンボの満貫払いはすべて同じ単価を使う。

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

// ---- 支払い単価（§6.2, §6.3） ------------------------------------------------

/** 4人麻雀と 3人麻雀ツモ損あり。ロン 親6倍・子4倍、ツモ 親2倍オール・子は親2倍/子1倍 */
function standardUnit(base) {
  return {
    ron: (isDealer) => ceil100(base * (isDealer ? 6 : 4)),
    tsumo: (isDealer, payerIsDealer) => (isDealer ? ceil100(base * 2) : ceil100(base * (payerIsDealer ? 2 : 1))),
  };
}

/** 3人麻雀ツモ損なし。北家分（子1人分）を、子ツモなら親が、親ツモなら子2人で折半（切り上げ）して負担する */
function noTsumoLossUnit(base) {
  const ko = ceil100(base);
  const oya = ceil100(base * 2);
  return {
    ron: (isDealer) => ceil100(base * (isDealer ? 6 : 4)),
    tsumo: (isDealer, payerIsDealer) => (isDealer ? oya + ceil100(oya / 2) : payerIsDealer ? oya + ko : ko),
  };
}

/**
 * 関西式の点数表（§6.3）。行は 1翻・2翻・3翻・満貫・跳満・倍満・三倍満・役満。
 * 列は [親ロン, 親ツモ（オール）, 子ロン, 子ツモの子の支払い, 子ツモの親の支払い]
 */
export const KANSAI_TABLE = Object.freeze([
  [2000, 1000, 1000, 1000, 1000],
  [3000, 2000, 2000, 1000, 1000],
  [6000, 3000, 4000, 1000, 3000],
  [12000, 6000, 8000, 3000, 5000],
  [18000, 9000, 12000, 4000, 8000],
  [24000, 12000, 16000, 6000, 10000],
  [36000, 18000, 24000, 8000, 16000],
  [48000, 24000, 32000, 12000, 20000],
]);
const KANSAI_MANGAN = 3;
const KANSAI_SANBAIMAN = 6;
const KANSAI_YAKUMAN = 7;

/** 関西式の行番号。符は見ない。 */
function kansaiRow(han, rule) {
  if (han >= 13) return rule.kazoeYakuman === "yakuman" ? KANSAI_YAKUMAN : KANSAI_SANBAIMAN;
  if (han >= 11) return KANSAI_SANBAIMAN;
  if (han >= 8) return 5;
  if (han >= 6) return 4;
  if (han >= 4) return KANSAI_MANGAN;
  return Math.max(1, han) - 1;
}

function kansaiUnit(row, mult = 1) {
  const r = KANSAI_TABLE[row];
  return {
    ron: (isDealer) => (isDealer ? r[0] : r[2]) * mult,
    tsumo: (isDealer, payerIsDealer) => (isDealer ? r[1] : payerIsDealer ? r[4] : r[3]) * mult,
  };
}

const ZERO_UNIT = Object.freeze({ ron: () => 0, tsumo: () => 0 });

function scoringMode(rule) {
  return rule.playerCount === 3 ? rule.sanmaScoring || "standard" : "standard";
}

/** 役満 m 個分の単価（m は doubleYakuman を考慮した後の個数）。0 なら支払い無し */
function unitOfYakuman(m, rule) {
  if (m <= 0) return ZERO_UNIT;
  const mode = scoringMode(rule);
  if (mode === "kansai") return kansaiUnit(KANSAI_YAKUMAN, m);
  return mode === "noTsumoLoss" ? noTsumoLossUnit(8000 * m) : standardUnit(8000 * m);
}

/**
 * 1手の支払い単価（§6.2, §6.3）。winner: { han, fu, yakumanCount }
 * 戻り値 { ron(isDealer), tsumo(isDealer, payerIsDealer) }
 */
export function scoreUnit(winner, rule) {
  const yakumanCount = winner.yakumanCount || 0;
  if (yakumanCount > 0) return unitOfYakuman(rule.doubleYakuman ? yakumanCount : 1, rule);
  const mode = scoringMode(rule);
  if (mode === "kansai") return kansaiUnit(kansaiRow(winner.han, rule));
  const base = basePoints(winner, rule);
  return mode === "noTsumoLoss" ? noTsumoLossUnit(base) : standardUnit(base);
}

/** 満貫ツモの単価（流し満貫・チョンボの満貫払い） */
function manganUnit(rule) {
  return scoreUnit({ han: 5, fu: 30, yakumanCount: 0 }, rule);
}

// ---- 和了 ----------------------------------------------------------------

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

  // 責任払い（§6.5）。役満手でのみ有効。責任分と非責任分を役満の個数で分ける
  const yakumanCount = winner.yakumanCount || 0;
  const sekinin =
    rule.sekinin && yakumanCount > 0 && winner.sekinin && winner.sekinin.who !== who && winner.sekinin.yakumanCount > 0
      ? winner.sekinin
      : null;
  let unitNormal;
  let unitResp = ZERO_UNIT;
  if (sekinin) {
    const effectiveCount = rule.doubleYakuman ? yakumanCount : 1;
    // 責任分は役満全体を超えない（doubleYakuman が偽のときの保険）
    const respCount = Math.min(sekinin.yakumanCount, effectiveCount);
    unitResp = unitOfYakuman(respCount, rule);
    unitNormal = unitOfYakuman(effectiveCount - respCount, rule);
  } else {
    unitNormal = scoreUnit(winner, rule);
  }
  // 本場（§6.2）: ロンは放銃者が honbaPoints × 本場、ツモは各支払者がその 1/3 ずつ。0 なら加算なし
  const honbaRon = rule.honbaPoints ?? 300;
  const honbaTsumo = honbaRon / 3;

  if (tsumo) {
    // 非責任分は通常のツモ配分。本場は各支払者が負担する
    for (let s = 0; s < n; s++) {
      if (s === who) continue;
      const pay = unitNormal.tsumo(isDealer, s === dealer) + honbaTsumo * honba;
      deltas[s] -= pay;
      deltas[who] += pay;
    }
    // 責任分は責任者が全額（ロン相当額）を負担
    const amt = unitResp.ron(isDealer);
    if (amt > 0) {
      deltas[sekinin.who] -= amt;
      deltas[who] += amt;
    }
  } else {
    const normal = unitNormal.ron(isDealer) + honbaRon * honba;
    deltas[from] -= normal;
    deltas[who] += normal;
    const amt = unitResp.ron(isDealer);
    if (amt > 0) {
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
 * 和了時のチップの移動（枚。§5.2 手順6）。rule.chips が偽なら全て 0。
 * 各和了者は winner.chips を、ツモなら和了者以外の全員から、ロンなら放銃者から受け取る。
 */
export function agariChips({ rule, tsumo, from, winners }) {
  const n = rule.playerCount;
  const chips = zeros(n);
  if (!rule.chips) return chips;
  for (const w of effectiveWinners(winners, { tsumo, from, rule })) {
    const c = w.chips || 0;
    if (c <= 0) continue;
    if (tsumo) {
      for (let s = 0; s < n; s++) {
        if (s === w.who) continue;
        chips[s] -= c;
        chips[w.who] += c;
      }
    } else {
      chips[from] -= c;
      chips[w.who] += c;
    }
  }
  return chips;
}

// ---- 流局 ----------------------------------------------------------------

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
 * テンパイ料・本場は発生させない。3人麻雀は点数方式の満貫ツモの額に従う。
 * @param {number[]} p.nagashiBy 成立者の seatIndex
 */
export function nagashiDeltas({ rule, dealer, nagashiBy }) {
  const n = rule.playerCount;
  const deltas = zeros(n);
  const unit = manganUnit(rule);
  for (const who of nagashiBy) {
    const isDealer = who === dealer;
    for (let s = 0; s < n; s++) {
      if (s === who) continue;
      const pay = unit.tsumo(isDealer, s === dealer);
      deltas[s] -= pay;
      deltas[who] += pay;
    }
  }
  return deltas;
}

// ---- チョンボ --------------------------------------------------------------

/**
 * チョンボ（§6.7）。
 * "mangan": 満貫払い。満貫ツモの支払いを逆向きに払う（親なら各子に 4000、子なら親に 4000・各子に 2000）。
 *           3人麻雀は点数方式の満貫ツモの額に従う。
 * "fixed":  定額。他の各人に rule.chomboPoints ずつ払う。
 * "manual": 廃止。過去の対局の rule に残っていれば、渡された deltas をそのまま使う。
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
  const unit = manganUnit(rule);
  const fixed = rule.chomboPoints ?? 2000;
  for (let s = 0; s < n; s++) {
    if (s === who) continue;
    const amt = rule.chomboRule === "fixed" ? fixed : unit.tsumo(isDealer, s === dealer);
    deltas[s] += amt;
    deltas[who] -= amt;
  }
  return deltas;
}
