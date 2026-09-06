// 表示用の純関数のテスト（席と画面位置の対応、局名）

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { seatPositions, positionsFor, kyokuName, windName, fmtPoints, fmtDelta, hanName, fmtDateTime, fmtDate, gameDateTime } from "../src/ui/format.js";
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
