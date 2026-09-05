// 表示用の整形。純関数。

import { roundWind, kyokuNumber, seatWind } from "../reduce.js";

const WINDS = ["東", "南", "西", "北"];

/** 局名。「東1局」など。編集で length を超えた場合は西・北場も出す。 */
export function kyokuName(kyoku, playerCount) {
  const w = WINDS[roundWind(kyoku, playerCount) % 4];
  return `${w}${kyokuNumber(kyoku, playerCount)}局`;
}

/** 自風の文字 */
export function windName(seat, kyoku, playerCount) {
  return WINDS[seatWind(seat, kyoku, playerCount)];
}

/** 3桁区切り。負数は −（マイナス記号）で。 */
export function fmtPoints(n) {
  const abs = Math.abs(n).toLocaleString("ja-JP");
  return n < 0 ? `−${abs}` : abs;
}

/** 符号付き */
export function fmtDelta(n) {
  if (n > 0) return `+${fmtPoints(n)}`;
  if (n < 0) return fmtPoints(n);
  return "±0";
}

/** 経過時間。「12m」「1h05m」 */
export function fmtElapsed(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${min}m`;
  const hh = Math.floor(min / 60);
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}h${mm}m`;
}

/** 対局 ID。g_YYYYMMDD_HHMM */
export function gameId(date) {
  const p = (x) => String(x).padStart(2, "0");
  return `g_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}`;
}

/** 翻数の表示名。役満は別扱い。 */
export function hanName(han) {
  if (han >= 13) return "数え役満";
  if (han >= 11) return "三倍満";
  if (han >= 8) return "倍満";
  if (han >= 6) return "跳満";
  if (han === 5) return "満貫";
  return `${han}翻`;
}
