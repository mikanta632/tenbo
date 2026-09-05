// Rule の型・既定値・プリセット・検証（docs/design.md §7）

/** 4人麻雀の既定ルール。設計書 §7 の値をそのまま持つ。 */
export const DEFAULT_RULE = Object.freeze({
  // 卓
  playerCount: 4,
  length: 8,
  startPoints: 25000,
  returnPoints: 30000,
  uma: [20, 10, -10, -20],

  // 進行
  renchan: "tenpai",
  agariYame: true,
  tobi: true,
  tobiLine: 0,
  abortiveRyuukyoku: ["kyuushu", "suufon", "suucha_riichi", "suukaikan", "sanchaho"],
  nagashiMangan: false,
  riichiUnderThousand: false,

  // 点数
  kuitan: true,
  akaDora: 3,
  kiriageMangan: true,
  kazoeYakuman: "yakuman",
  doubleYakuman: true,
  multiRon: true,
  multiRonKyotaku: "shimocha",
  multiRonHonba: "shimocha",
  sekinin: true,
  sekininRon: "half",
  ryuukyokuTenpaiTotal: 3000,
  chomboRule: "mangan",

  // 3人麻雀のみ
  kitaNuki: true,
  emptySeat: "left",

  // 終局
  finalKyotaku: "top",

  // 精算
  rate: 50,
  rateBase: "point",
  ptRounding: "round5",
  chipValue: 0,
});

/**
 * プリセット。具体値は §11 で未決のため暫定値。
 * 3人麻雀は playerCount / length / 持ち点 / uma のみ既定から変える。
 */
export const PRESETS = Object.freeze({
  "4人標準": DEFAULT_RULE,
  "3人標準": Object.freeze({
    ...DEFAULT_RULE,
    playerCount: 3,
    length: 6,
    startPoints: 35000,
    returnPoints: 40000,
    uma: [20, 0, -20],
  }),
});

/** 既定値に部分指定を重ねて Rule を作る。 */
export function makeRule(overrides = {}) {
  return { ...DEFAULT_RULE, ...overrides };
}

/**
 * §7 の制約を検証する。問題があればメッセージの配列を返す。空配列なら合格。
 */
export function validateRule(rule) {
  const errors = [];
  const n = rule.playerCount;
  if (n !== 3 && n !== 4) errors.push(`playerCount は 3 か 4: ${n}`);
  if (!Array.isArray(rule.uma)) {
    errors.push("uma は配列");
  } else {
    if (rule.uma.length !== n) {
      errors.push(`uma の長さは playerCount と一致: ${rule.uma.length} !== ${n}`);
    }
    const sum = rule.uma.reduce((a, b) => a + b, 0);
    if (sum !== 0) errors.push(`uma の合計は 0: ${sum}`);
  }
  if (rule.length !== n && rule.length !== n * 2) {
    errors.push(`length は playerCount か playerCount×2: ${rule.length}`);
  }
  return errors;
}

/** 検証に失敗したら例外を投げる。 */
export function assertRule(rule) {
  const errors = validateRule(rule);
  if (errors.length) throw new Error("Rule が不正: " + errors.join("; "));
  return rule;
}
