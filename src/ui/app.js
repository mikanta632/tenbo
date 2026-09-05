// アプリ本体。画面の切替、イベントの発行と保存、終局処理。
// 状態は Game（イベント列）だけを持ち、表示はすべて reduce で導出する（§4.1）。

import { createStorage } from "../storage.js";
import { PRESETS, validateRule } from "../rules.js";
import { reduce, isEndOfKyoku, agariYameAvailableAfter, dealerOf } from "../reduce.js";
import { appendEvent, undoLast, removeEvent, withEvents } from "../edit.js";
import { clear } from "./dom.js";
import { renderStart } from "./start.js";
import { renderTable } from "./table.js";
import {
  openAgariSheet,
  openRyuukyokuSheet,
  openAdjustSheet,
  openMenu,
  openOverDialog,
  openAgariYameDialog,
  openConfirm,
} from "./sheets.js";
import { fmtElapsed } from "./format.js";

export const APP_VERSION = "0.2.0";

const storage = createStorage();
storage.init();

const root = document.getElementById("app");
let game = storage.loadCurrent();
let screen = game ? "table" : "start";
let openSheetHandle = null;
let elapsedTimer = null;
let diffSeat = null; // 点差を表示中の席
let diffTimer = null;

// ---- 画面の切替 ---------------------------------------------------------

function show(next) {
  if (next) screen = next;
  closeSheet();
  clear(root);
  if (screen === "table" && game) renderTableScreen();
  else renderStartScreen();
}

function closeSheet() {
  if (openSheetHandle) {
    openSheetHandle.close();
    openSheetHandle = null;
  }
}

/** 現在局（最後の局末イベントより後）にある seat の riichi イベントの添字。無ければ -1。 */
function findCurrentRiichiIndex(events, seat) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (isEndOfKyoku(e)) return -1;
    if (e.t === "riichi" && e.who === seat) return i;
  }
  return -1;
}

function playerNames(g) {
  const roster = storage.loadRoster();
  return g.seats.map((id) => (roster.find((p) => p.id === id) || { name: "?" }).name);
}

// ---- 開始画面 -----------------------------------------------------------

function renderStartScreen() {
  stopElapsed();
  root.append(
    renderStart({
      storage,
      current: game,
      presets: PRESETS,
      version: APP_VERSION,
      onResume: () => show("table"),
      onDiscard: () => {
        openSheetHandle = openConfirm({
          title: "破棄",
          message: "進行中の対局を破棄します。保存されません。",
          okLabel: "破棄する",
          onOk: () => {
            game = null;
            storage.clearCurrent();
            show("start");
          },
        });
      },
      onStart: (g) => {
        const errors = validateRule(g.rule);
        if (errors.length) {
          alert("ルールが不正: " + errors.join("; "));
          return;
        }
        game = g;
        storage.saveCurrent(game);
        show("table");
      },
    }),
  );
}

// ---- 対局画面 -----------------------------------------------------------

function renderTableScreen() {
  const state = reduce(game.events, game.rule);
  const names = playerNames(game);
  const rule = game.rule;

  const actions = {
    onPanel: (seat) => {
      if (state.over) return;
      closeSheet();
      openSheetHandle = openAgariSheet({
        state,
        rule,
        names,
        seat,
        onConfirm: (ev) => {
          closeSheet();
          emit(ev);
        },
      });
    },
    // リーチ。再タップでその局の riichi イベントを削除して解除する
    onRiichi: (seat) => {
      if (state.round.riichi[seat]) {
        const idx = findCurrentRiichiIndex(game.events, seat);
        if (idx < 0) return;
        game = withEvents(game, removeEvent(game.events, idx, rule));
        storage.saveCurrent(game);
        show();
        return;
      }
      emit({ t: "riichi", who: seat });
    },
    onMeld: (seat, value) => emit({ t: "meld", who: seat, value }),
    // +/−: 押した人と他の人との点差を表示する。点数は動かさない。一定時間で戻る
    onDiff: (seat) => {
      if (diffTimer) clearTimeout(diffTimer);
      diffTimer = null;
      diffSeat = diffSeat === seat ? null : seat;
      if (diffSeat !== null) {
        diffTimer = setTimeout(() => {
          diffSeat = null;
          diffTimer = null;
          if (screen === "table") show();
        }, 8000);
      }
      show();
    },
    onUndo: () => {
      game = withEvents(game, undoLast(game.events, rule));
      storage.saveCurrent(game);
      show();
    },
    onSpecial: () => {
      if (state.over) return;
      closeSheet();
      openSheetHandle = openRyuukyokuSheet({
        state,
        rule,
        names,
        onConfirm: (ev) => {
          closeSheet();
          emit(ev);
        },
      });
    },
    onMenu: () => {
      closeSheet();
      openSheetHandle = openMenu({
        version: APP_VERSION,
        onAdjust: () => {
          closeSheet();
          openSheetHandle = openAdjustSheet({
            state,
            rule,
            names,
            onAdjust: (seat, delta) => {
              const deltas = new Array(rule.playerCount).fill(0);
              deltas[seat] = delta;
              closeSheet();
              emit({ t: "adjust", note: "手動修正", deltas });
            },
          });
        },
        onEndGame: () => {
          closeSheet();
          openSheetHandle = openConfirm({
            title: "手動終局",
            message: "この対局をここで終了します。",
            okLabel: "終了する",
            onOk: () => emit({ t: "end" }),
          });
        },
        onBackToStart: () => show("start"),
      });
    },
    onLog: null, // 段階3
  };

  root.append(renderTable({ game, state, names, actions, diffSeat }));
  startElapsed();
  requestWakeLock();

  if (state.over) showOver(state, names);
}

/** イベントを発行して保存し、再描画する。局末なら終局・アガリやめを確認する。 */
function emit(event) {
  let events;
  try {
    events = appendEvent(game.events, event, game.rule);
  } catch (e) {
    alert(e.message);
    return;
  }
  game = withEvents(game, events);
  storage.saveCurrent(game);
  show();
  const state = reduce(game.events, game.rule);
  if (state.over) return; // show() 内で終局ダイアログを出している
  if (isEndOfKyoku(event) && agariYameAvailableAfter(game.events, game.rule)) {
    const names = playerNames(game);
    const dealer = dealerOf(state.kyoku, game.rule.playerCount);
    closeSheet();
    openSheetHandle = openAgariYameDialog({
      dealerName: names[dealer],
      onYame: () => {
        closeSheet();
        emit({ t: "end" });
      },
      onContinue: () => closeSheet(),
    });
  }
}

function showOver(state, names) {
  const rule = game.rule;
  let reason = "規定局数を終えました";
  const last = game.events[game.events.length - 1];
  if (rule.tobi && state.points.some((p) => p < rule.tobiLine)) reason = "トビで終局";
  else if (last && last.t === "end") reason = "終局（アガリやめ／手動）";
  closeSheet();
  openSheetHandle = openOverDialog({
    state,
    rule,
    names,
    reason,
    onSave: () => {
      const finished = { ...game, endedAt: new Date().toISOString() };
      storage.appendGame(finished);
      storage.clearCurrent();
      game = null;
      show("start");
    },
    onUndo: () => {
      game = withEvents(game, undoLast(game.events, rule));
      storage.saveCurrent(game);
      show();
    },
  });
}

// ---- 経過時間 -----------------------------------------------------------

function startElapsed() {
  stopElapsed();
  elapsedTimer = setInterval(() => {
    const el = document.getElementById("elapsed");
    if (el && game) el.textContent = fmtElapsed(Date.now() - Date.parse(game.startedAt));
  }, 30000);
}
function stopElapsed() {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
}

// ---- Screen Wake Lock（§10） --------------------------------------------

let wakeLock = null;
async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => (wakeLock = null));
  } catch {
    wakeLock = null;
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && screen === "table") requestWakeLock();
});

// ---- 起動 -----------------------------------------------------------------

show();
