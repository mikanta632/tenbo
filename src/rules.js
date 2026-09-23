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
  tobiLine: 0, // 0 = マイナスで終局、1 = 0点ちょうどでも終局（§5.6）
  extension: false, // 延長戦（半荘は西入、東風は南入。§5.6）
  honbaPoints: 300, // 1本場あたりの加算（ロンで放銃者が払う額）。ツモは各支払者が 1/3 ずつ。0 も可
  nagashiMangan: true, // 偽なら特殊終局の入口に流し満貫を出さない
  riichiUnderThousand: false,

  // 点数
  kuitan: true, // 記録のみ。計算には影響しない
  akaDora: 3, // 同上
  kiriageMangan: true,
  kazoeYakuman: "yakuman",
  doubleYakuman: true,
  multiRon: true,
  multiRonKyotaku: "shimocha",
  multiRonHonba: "shimocha",
  sekinin: true,
  sekininRon: "half",
  ryuukyokuTenpaiTotal: 3000,
  chomboRule: "mangan", // mangan | fixed（§6.7）
  chomboPoints: 2000, // fixed のとき、他の各人に払う額
  sanmaScoring: "standard", // standard | noTsumoLoss | kansai（3人麻雀のみ。§6.3）

  // 終局
  finalKyotaku: "top",

  // 精算
  rate: 50,
  ptRounding: "round5", // 五捨六入。"none" なら小数のまま
  tieBreak: "chiicha", // chiicha | split（同点の扱い。§7）

  // 祝儀（単位はチップ枚数。§7）
  chips: false,
  chipRate: 100,
  tobiPrize: 0,
  yakitori: 0,
  yakitoriNagashi: true,
});

/** 選択肢を持つ項目の取りうる値。設定画面と検証で使う。 */
export const RULE_CHOICES = Object.freeze({
  renchan: ["tenpai", "agari"],
  kazoeYakuman: ["yakuman", "sanbaiman"],
  multiRonKyotaku: ["shimocha", "split"],
  multiRonHonba: ["shimocha", "each"],
  sekininRon: ["half", "full"],
  chomboRule: ["mangan", "fixed", "manual"], // manual は廃止。過去の対局の rule にだけ残る
  sanmaScoring: ["standard", "noTsumoLoss", "kansai"],
  finalKyotaku: ["top", "remain"],
  ptRounding: ["round5", "none"],
  tieBreak: ["chiicha", "split"],
});

const SANMA_BASE = Object.freeze({
  ...DEFAULT_RULE,
  playerCount: 3,
  length: 6,
  startPoints: 35000,
  returnPoints: 40000,
  uma: [30, -10, -20],
});

/** 組み込みのプリセット（§7）。 */
export const PRESETS = Object.freeze({
  "4人標準": DEFAULT_RULE,
  "3人標準": SANMA_BASE,
  関西三麻: Object.freeze({ ...SANMA_BASE, sanmaScoring: "kansai" }),
});

/** その人数の標準プリセット。 */
export function presetFor(playerCount) {
  return playerCount === 3 ? PRESETS["3人標準"] : PRESETS["4人標準"];
}

/** 既定値に部分指定を重ねて Rule を作る。 */
export function makeRule(overrides = {}) {
  return { ...DEFAULT_RULE, ...overrides };
}

/**
 * 保存済みのルールに不足があれば、その人数の標準プリセットで埋める（§7）。
 * 項目が増えたときに古いカスタムルールをそのまま使えるようにする。廃止した項目は落とす。
 */
export function normalizeRule(rule) {
  const base = presetFor(rule && rule.playerCount === 3 ? 3 : 4);
  const merged = { ...base };
  for (const key of Object.keys(base)) if (rule && rule[key] !== undefined) merged[key] = rule[key];
  if (merged.chomboRule === "manual") merged.chomboRule = "mangan"; // 廃止（§6.7）
  return merged;
}

/**
 * §7 の制約を検証する。問題があればメッセージの配列を返す。空配列なら合格。
 */
export function validateRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return ["Rule はオブジェクト"];
  const errors = [];
  for (const key of ["startPoints", "returnPoints", "rate", "ryuukyokuTenpaiTotal"]) {
    if (!Number.isFinite(rule[key])) errors.push(`${key} は有限の数値`);
  }
  // 古いルールでは無い項目。あれば数値であること（計算側は既定値で補う）
  for (const key of ["honbaPoints", "tobiLine", "chomboPoints", "chipRate", "tobiPrize", "yakitori", "akaDora"]) {
    if (rule[key] !== undefined && !Number.isFinite(rule[key])) errors.push(`${key} は有限の数値`);
  }
  for (const [key, values] of Object.entries(RULE_CHOICES)) {
    if (rule[key] !== undefined && !values.includes(rule[key])) errors.push(`${key} は ${values.join(" | ")}: ${rule[key]}`);
  }
  const n = rule.playerCount;
  if (n !== 3 && n !== 4) errors.push(`playerCount は 3 か 4: ${n}`);
  if (!Array.isArray(rule.uma)) {
    errors.push("uma は配列");
  } else {
    if (!rule.uma.every(Number.isFinite)) errors.push("uma の各値は有限の数値");
    if (rule.uma.length !== n) {
      errors.push(`uma の長さは playerCount と一致: ${rule.uma.length} !== ${n}`);
    }
    const sum = rule.uma.reduce((a, b) => a + b, 0);
    if (sum !== 0) errors.push(`uma の合計は 0: ${sum}`);
  }
  if (rule.length !== n && rule.length !== n * 2) {
    errors.push(`length は playerCount か playerCount×2: ${rule.length}`);
  }
  // ノーテン罰符（§6.4）: テンパイ者・ノーテン者が何人でも 1 人あたり 100点単位に割り切れる総点だけ（4人は 600、3人は 200 の倍数）
  const tenpaiUnit = n === 3 ? 200 : 600;
  if (Number.isFinite(rule.ryuukyokuTenpaiTotal) && (rule.ryuukyokuTenpaiTotal < 0 || rule.ryuukyokuTenpaiTotal % tenpaiUnit !== 0)) {
    errors.push(`ノーテン罰符の総点は ${tenpaiUnit} の倍数: ${rule.ryuukyokuTenpaiTotal}`);
  }
  return errors;
}

/** 検証に失敗したら例外を投げる。 */
export function assertRule(rule) {
  const errors = validateRule(rule);
  if (errors.length) throw new Error("Rule が不正: " + errors.join("; "));
  return rule;
}
