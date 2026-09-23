// 表示用の整形（対局 ID の生成以外は純関数）。

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

/**
 * pt。符号付き・3桁区切り。端数があれば小数1桁まで。単位は付けない。
 *   2789 → "+2,789" / −12.5 → "−12.5" / 0 → "0"
 */
export function fmtPt(p) {
  const abs = Math.abs(p);
  const s = Number.isInteger(abs) ? abs.toLocaleString("ja-JP") : abs.toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return p > 0 ? `+${s}` : p < 0 ? `−${s}` : "0";
}

/** 金額。符号付き・3桁区切り。単位（円）は見出しに置くのでここでは付けない。 */
export function fmtYen(y) {
  const s = Math.abs(y).toLocaleString("ja-JP");
  return y > 0 ? `+${s}` : y < 0 ? `−${s}` : "0";
}

/** 順位バッジの class。トップは金、ラス（人数によって3位か4位）は赤にする */
export function rankBadgeClass(rank, playerCount) {
  return `rank-badge r${rank + 1}${rank === playerCount - 1 ? " last" : ""}`;
}

/** 経過時間。「12m」「1h05m」「2日3h」。対局を閉じ忘れても桁が伸びない */
export function fmtElapsed(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${min}m`;
  const hh = Math.floor(min / 60);
  if (hh >= 24) return `${Math.floor(hh / 24)}日${hh % 24}h`;
  const mm = String(min % 60).padStart(2, "0");
  return `${hh}h${mm}m`;
}

/**
 * 保存してある ISO 文字列（UTC）を、端末のタイムゾーンで "YYYY-MM-DD HH:MM" にする。
 * timeZone を渡すとそのゾーンで出す（テスト用）。読めない値なら空文字。
 */
export function fmtDateTime(iso, timeZone) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type) => (parts.find((x) => x.type === type) || { value: "" }).value;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 同じく日付だけ "YYYY-MM-DD" */
export function fmtDate(iso, timeZone) {
  return fmtDateTime(iso, timeZone).slice(0, 10);
}

/** 対局の日時。終局時刻、無ければ開始時刻 */
export function gameDateTime(game, timeZone) {
  return fmtDateTime(game.endedAt || game.startedAt, timeZone);
}

/** 対局 ID。同じ時刻に開始しても別対局になるよう一意な接尾辞を付ける。 */
export function gameId(date) {
  const p = (x) => String(x).padStart(2, "0");
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `g_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}_${suffix}`;
}

/** 画面位置の順。下（自家）から反時計回り。 */
export const POSITION_ORDER = ["bottom", "right", "top", "left"];

/**
 * 使う画面位置を、下から反時計回りの順で返す。
 * 3人麻雀は emptyPosition（既定 left）を飛ばす。空席が下なら 右→上→左 の順になる。
 */
export function positionsFor(playerCount, emptyPosition = "left") {
  if (playerCount === 3) return POSITION_ORDER.filter((p) => p !== emptyPosition);
  return POSITION_ORDER.slice();
}

/**
 * 席 → 画面位置。bottomSeat を「使う位置の先頭（通常は下）」に置き、反時計回りに席順を割り当てる。
 * 戻り値は { bottom: seatIndex, right: ..., ... }（3人麻雀は空席の位置を含まない）。
 */
export function seatPositions(bottomSeat, playerCount, emptyPosition = "left") {
  const order = positionsFor(playerCount, emptyPosition);
  const pos = {};
  order.forEach((p, k) => (pos[p] = (bottomSeat + k) % playerCount));
  return pos;
}

/**
 * 3人麻雀の横向き配置（§2）。端末は「自分」の前に横向きに置き、自分が操作する。
 * 自分から見た位置がそのまま画面の位置になる: 自分 → bottom（手前の長辺）、右 → right（短辺）、
 * 対面 → top（奥の長辺）、左 → left（短辺）。空席の位置には局の情報と操作を置く。pos は seatPositions の戻り値。
 * 自分を空席にできた頃の記録（emptyPosition が "bottom"）だけは、空席の対面の人を下にする旧来の割り当てを使う。
 */
export function landscapePositions(pos, emptyPosition = "left") {
  if (emptyPosition !== "bottom") return { ...pos };
  const i = POSITION_ORDER.indexOf(emptyPosition);
  const at = (k) => pos[POSITION_ORDER[(i + k) % 4]];
  return { bottom: at(2), right: at(3), left: at(1) };
}


/** 角度を −180〜180 に直す（−180 と 180 は同じ向き） */
function normAngle(d) {
  const r = (((d % 360) + 360) % 360);
  return r > 180 ? r - 360 : r;
}

/**
 * 画面の擬似固定（§10）。端末本体に対する中身の向き target（0 = 本体の縦、±90 = 横）を保つために、
 * body を何度回すかを返す。angle は iOS が今表示している向き（screen.orientation.angle。0 / 90 / −90 / 270 / 180）。
 * iOS が表示を回しても、その分を逆に回して打ち消すので、中身は本体に対して回らない。
 */
export function bodyRotation(target, angle) {
  return normAngle(target - normAngle(angle));
}

/**
 * 横向きに見せる画面の、本体に対する向き（§10）。横向きに見せ始めたときに決めて、そのあいだは変えない。
 * 端末がすでに横なら iOS が表示しているその横向き、縦なら中身の上を本体の左辺にした横向き（−90）。
 */
export function landscapeTarget({ deviceLandscape, angle }) {
  const a = normAngle(angle);
  return deviceLandscape && (a === 90 || a === -90) ? a : -90;
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
