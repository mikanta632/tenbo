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

/** 画面位置の順。下（自家）から反時計回り。 */
export const POSITION_ORDER = ["bottom", "right", "top", "left"];

/**
 * 使う画面位置。3人麻雀は空席を常に画面の左（長辺）に置き、下・右・上を使う。
 */
export function positionsFor(playerCount) {
  if (playerCount === 3) return ["bottom", "right", "top"];
  return POSITION_ORDER.slice();
}

/**
 * 席 → 画面位置。bottomSeat を下に置き、反時計回りに席順を割り当てる。
 * 戻り値は { bottom: seatIndex, right: ..., ... }（3人麻雀は left を含まない）。
 */
export function seatPositions(bottomSeat, playerCount) {
  const order = positionsFor(playerCount);
  const pos = {};
  order.forEach((p, k) => (pos[p] = (bottomSeat + k) % playerCount));
  return pos;
}


/** 途中流局の種別名 */
export const ABORTIVE_KIND_NAMES = Object.freeze({
  kyuushu: "九種九牌",
  suufon: "四風連打",
  suucha_riichi: "四家立直",
  suukaikan: "四開槓",
  sanchaho: "三家和",
});

/** 翻数の表示名。役満は別扱い。 */
export function hanName(han) {
  if (han >= 13) return "数え役満";
  if (han >= 11) return "三倍満";
  if (han >= 8) return "倍満";
  if (han >= 6) return "跳満";
  if (han === 5) return "満貫";
  return `${han}翻`;
}
