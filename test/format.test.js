// 表示用の純関数のテスト（席と画面位置の対応、局名）

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { seatPositions, positionsFor, landscapePositions, bodyRotation, landscapeTarget, kyokuName, windName, fmtPoints, fmtDelta, fmtPt, fmtYen, fmtElapsed, rankBadgeClass, hanName, fmtDateTime, fmtDate, gameDateTime } from "../src/ui/format.js";
import { buildGame, seatsFromPositions } from "../src/ui/start.js";
import { makeRule } from "../src/rules.js";
import { createStorage, memoryStorage } from "../src/storage.js";

test("同じ時刻に開始した別対局を保存しても履歴を上書きしない", () => {
  const props = { rule: makeRule(), seats: ["a", "b", "c", "d"], bottomSeat: 0, now: new Date(2026, 8, 6, 12, 30) };
  const first = buildGame(props);
  const second = buildGame(props);
  const storage = createStorage(memoryStorage());
  storage.appendGame(first);
  storage.appendGame(second);
  assert.notEqual(first.id, second.id);
  assert.equal(storage.loadGames().length, 2);
});

describe("seatPositions", () => {
  test("4人: 下から反時計回りに 右・上・左", () => {
    assert.deepEqual(seatPositions(0, 4), { bottom: 0, right: 1, top: 2, left: 3 });
    assert.deepEqual(seatPositions(2, 4), { bottom: 2, right: 3, top: 0, left: 1 });
  });
  test("3人: 空席の位置を飛ばし、下から反時計回りに使う", () => {
    assert.deepEqual(positionsFor(3), ["bottom", "right", "top"]);
    assert.deepEqual(positionsFor(3, "top"), ["bottom", "right", "left"]);
    assert.deepEqual(positionsFor(3, "bottom"), ["right", "top", "left"]);
    assert.deepEqual(seatPositions(0, 3), { bottom: 0, right: 1, top: 2 });
    assert.deepEqual(seatPositions(2, 3), { bottom: 2, right: 0, top: 1 });
    assert.deepEqual(seatPositions(0, 3, "top"), { bottom: 0, right: 1, left: 2 });
    // 空席が下: 使う位置の先頭は右
    assert.deepEqual(seatPositions(1, 3, "bottom"), { right: 1, top: 2, left: 0 });
  });
  test("3人: 空席が上のとき、配置図の選択と往復が一致する", () => {
    // 使う位置の順は 下→右→左。下 a、右 b、左 c。起家は左（添字 2）→ seats c,a,b、先頭（下）は seats[1]
    const r = seatsFromPositions({ posPlayers: ["a", "b", "c"], chiichaPos: 2 });
    assert.deepEqual(r, { seats: ["c", "a", "b"], bottomSeat: 1 });
    const pos = seatPositions(r.bottomSeat, 3, "top");
    assert.deepEqual(["bottom", "right", "left"].map((k) => r.seats[pos[k]]), ["a", "b", "c"]);
    assert.equal(pos.top, undefined);
  });
  test("3人の横向き配置: 端末は自分の前。自分から見た位置がそのまま画面の位置になる", () => {
    // 自分 a（下）、右 b、対面 空席、左 c。下の長辺 a、右の短辺 b、左の短辺 c
    const pos = seatPositions(0, 3, "top"); // { bottom: 0, right: 1, left: 2 }
    assert.deepEqual(landscapePositions(pos, "top"), { bottom: 0, right: 1, left: 2 });
    // 空席が左: 自分 0 が下、右 1 が右の短辺、対面 2 が奥の長辺
    assert.deepEqual(landscapePositions(seatPositions(0, 3, "left"), "left"), { bottom: 0, right: 1, top: 2 });
    // 空席が右: 自分 0 が下、対面 1 が奥の長辺、左 2 が左の短辺
    assert.deepEqual(landscapePositions(seatPositions(0, 3, "right"), "right"), { bottom: 0, top: 1, left: 2 });
    // 旧記録の空席が下でも同じ規則で置ける: 対面は上（2）。その右手は左（0）、左手は右（1）
    assert.deepEqual(landscapePositions(seatPositions(1, 3, "bottom"), "bottom"), { bottom: 2, right: 0, left: 1 });
  });
  test("配置図の選択（下→右→上→左の順）と起家の位置から seats / bottomSeat を出し、往復が一致する", () => {
    // 4人: 下 a、右 b、上 c、左 d。起家は上（添字 2）→ seats は c,d,a,b、下は seats[2]
    const r4 = seatsFromPositions({ posPlayers: ["a", "b", "c", "d"], chiichaPos: 2 });
    assert.deepEqual(r4, { seats: ["c", "d", "a", "b"], bottomSeat: 2 });
    const pos4 = seatPositions(r4.bottomSeat, 4);
    assert.deepEqual(["bottom", "right", "top", "left"].map((k) => r4.seats[pos4[k]]), ["a", "b", "c", "d"]);
    // 3人: 下 a、右 b、上 c（左は空席）。起家は右（添字 1）→ seats は b,c,a、下は seats[2]
    const r3 = seatsFromPositions({ posPlayers: ["a", "b", "c"], chiichaPos: 1 });
    assert.deepEqual(r3, { seats: ["b", "c", "a"], bottomSeat: 2 });
    const pos3 = seatPositions(r3.bottomSeat, 3);
    assert.deepEqual(["bottom", "right", "top"].map((k) => r3.seats[pos3[k]]), ["a", "b", "c"]);
  });
});

describe("表示名", () => {
  test("局名", () => {
    assert.equal(kyokuName(0, 4), "東1局");
    assert.equal(kyokuName(7, 4), "南4局");
    assert.equal(kyokuName(8, 4), "西1局");
    assert.equal(kyokuName(3, 3), "南1局");
  });
  test("自風", () => {
    assert.equal(windName(0, 0, 4), "東");
    assert.equal(windName(0, 1, 4), "北");
    assert.equal(windName(2, 1, 3), "南");
  });
  test("点数の整形", () => {
    assert.equal(fmtPoints(25000), "25,000");
    assert.equal(fmtPoints(-1200), "−1,200");
    assert.equal(fmtDelta(0), "±0");
    assert.equal(fmtDelta(300), "+300");
  });
  test("翻の名称", () => {
    assert.equal(hanName(5), "満貫");
    assert.equal(hanName(6), "跳満");
    assert.equal(hanName(8), "倍満");
    assert.equal(hanName(11), "三倍満");
    assert.equal(hanName(13), "数え役満");
    assert.equal(hanName(3), "3翻");
  });
});

describe("pt・金額・経過時間・順位バッジ", () => {
  test("pt は 3桁区切りで符号を付け、端数だけ小数1桁にする", () => {
    assert.equal(fmtPt(2789), "+2,789");
    assert.equal(fmtPt(-1847), "−1,847");
    assert.equal(fmtPt(12.5), "+12.5");
    assert.equal(fmtPt(0), "0");
  });
  test("金額は 3桁区切りで符号を付け、単位は付けない", () => {
    assert.equal(fmtYen(68920), "+68,920");
    assert.equal(fmtYen(-51970), "−51,970");
    assert.equal(fmtYen(0), "0");
  });
  test("マイナス記号は fmtPoints と同じ（U+2212）", () => {
    assert.equal(fmtPt(-1)[0], fmtPoints(-1)[0]);
    assert.equal(fmtYen(-1)[0], fmtPoints(-1)[0]);
  });
  test("経過時間は 24時間を超えたら日で出す", () => {
    const m = (min) => fmtElapsed(min * 60000);
    assert.equal(m(12), "12m");
    assert.equal(m(65), "1h05m");
    assert.equal(m(23 * 60 + 59), "23h59m");
    assert.equal(m(24 * 60), "1日0h");
    assert.equal(m(38 * 60 + 9), "1日14h");
  });
  test("ラスの印は人数によって 3位／4位に付く", () => {
    assert.equal(rankBadgeClass(0, 4), "rank-badge r1");
    assert.equal(rankBadgeClass(3, 4), "rank-badge r4 last");
    assert.equal(rankBadgeClass(2, 3), "rank-badge r3 last");
    assert.equal(rankBadgeClass(2, 4), "rank-badge r3");
  });
});

describe("fmtDateTime", () => {
  const TZ = "Asia/Tokyo";
  test("UTC で保存した時刻を日本時間に直す", () => {
    // 21:30Z は日本では翌日の 06:30
    assert.equal(fmtDateTime("2026-09-01T21:30:00.000Z", TZ), "2026-09-02 06:30");
    // 15:00Z は日本では翌日の 00:00（24:00 にしない）
    assert.equal(fmtDateTime("2026-09-01T15:00:00.000Z", TZ), "2026-09-02 00:00");
    assert.equal(fmtDateTime("2026-01-05T03:04:00.000Z", TZ), "2026-01-05 12:04");
    assert.equal(fmtDate("2026-09-01T21:30:00.000Z", TZ), "2026-09-02");
  });

  test("値が無い・読めないときは空文字", () => {
    for (const v of [null, undefined, "", "not a date"]) assert.equal(fmtDateTime(v, TZ), "");
  });

  test("gameDateTime は終局時刻、無ければ開始時刻を使う", () => {
    assert.equal(gameDateTime({ startedAt: "2026-09-01T10:00:00.000Z", endedAt: "2026-09-01T12:00:00.000Z" }, TZ), "2026-09-01 21:00");
    assert.equal(gameDateTime({ startedAt: "2026-09-01T10:00:00.000Z", endedAt: null }, TZ), "2026-09-01 19:00");
  });
});

describe("画面の擬似固定（§10）", () => {
  test("縦に見せる画面は、iOS が横にしても逆に回して本体の縦を保つ", () => {
    assert.equal(bodyRotation(0, 0), 0);
    assert.equal(bodyRotation(0, 90), -90);
    assert.equal(bodyRotation(0, -90), 90);
    assert.equal(bodyRotation(0, 270), 90);
  });
  test("横に見せる画面は見せ始めたときの横向きで固定し、iOS が反対の横向きにしたら上下を入れ替える", () => {
    // 端末が縦のまま始めたら、中身の上を本体の左辺に
    const fromPortrait = landscapeTarget({ deviceLandscape: false, angle: 0 });
    assert.equal(fromPortrait, -90);
    assert.equal(bodyRotation(fromPortrait, 0), -90);
    assert.equal(bodyRotation(fromPortrait, -90), 0);
    assert.equal(Math.abs(bodyRotation(fromPortrait, 90)), 180);
    // 横に置いて始めたらその向き。あとで iOS が反対の横向きにしても中身は回らない（上下を入れ替えて打ち消す）
    const fromLandscape = landscapeTarget({ deviceLandscape: true, angle: 90 });
    assert.equal(fromLandscape, 90);
    assert.equal(bodyRotation(fromLandscape, 90), 0);
    assert.equal(Math.abs(bodyRotation(fromLandscape, -90)), 180);
    assert.equal(bodyRotation(fromLandscape, 0), 90);
    assert.equal(landscapeTarget({ deviceLandscape: true, angle: 270 }), -90);
  });
});
