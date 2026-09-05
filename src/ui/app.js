// アプリ本体。画面の切替、イベントの発行と保存、終局処理、ログの編集、精算、成績、エクスポート。
// 状態は Game（イベント列）だけを持ち、表示はすべて reduce で導出する（§4.1）。

import { createStorage, SCHEMA_VERSION } from "../storage.js";
import { PRESETS, validateRule } from "../rules.js";
import { reduce, isEndOfKyoku, agariYameAvailableAfter, dealerOf, kyokuGroups } from "../reduce.js";
import { appendEvent, undoLast, removeEvent, replaceEvent, insertEvent, deleteKyoku, withEvents } from "../edit.js";
import { computeSettlement } from "../settlement.js";
import { clear } from "./dom.js";
import { renderStart } from "./start.js";
import { renderTable } from "./table.js";
import { renderLog } from "./log.js";
import { renderResult } from "./result.js";
import { renderStats } from "./stats.js";
import {
  openAgariSheet,
  openMultiRonSheet,
  openRyuukyokuSheet,
  openAbortiveSheet,
  openNagashiSheet,
  openChomboSheet,
  openSpecialMenu,
  openEventEditor,
  openAdjustSheet,
  openMenu,
  openOverDialog,
  openAgariYameDialog,
  openConfirm,
  openActionSheet,
} from "./sheets.js";
import { fmtElapsed, kyokuName } from "./format.js";
import { soundEnabled, setSoundEnabled, playRiichi, playRiichiCancel, playMeld, playTest } from "./sound.js";

// 版番号は version.js（index.html の classic script で読み込む）が唯一の定義。sw.js も同じファイルを読む
export const APP_VERSION = globalThis.APP_VERSION || "dev";

const storage = createStorage();
storage.init();

const root = document.getElementById("app");
let game = storage.loadCurrent();
let screen = game ? "table" : "start";
let logTarget = null; // { kind: "current" } | { kind: "finished", id }
let resultId = null; // 結果画面で見ている終了済み対局の id
let openSheetHandle = null;
let elapsedTimer = null;
let diffSeat = null; // 点差を表示中の席
let diffTimer = null;

// ---- 画面の切替 ---------------------------------------------------------

function show(next) {
  if (next) screen = next;
  closeSheet();
  clear(root);
  window.scrollTo(0, 0);
  if (screen === "table" && game) renderTableScreen();
  else if (screen === "log" && logTarget) renderLogScreen();
  else if (screen === "result" && resultId) renderResultScreen();
  else if (screen === "stats") renderStatsScreen();
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
      onOpenResult: (id) => {
        resultId = id;
        show("result");
      },
      onStats: () => show("stats"),
      onExport: () => exportJson(),
      onImport: (file) => importJson(file),
    }),
  );
}

// ---- 対局画面 -----------------------------------------------------------

/** 特殊終局の種類に応じたシートを開く。共通の onConfirm で確定する。 */
function openSpecialSheet(kind, { state, rule, names, onConfirm, onAdjust, initial = null }) {
  const p = { state, rule, names, onConfirm, initial };
  switch (kind) {
    case "ryuukyoku":
      return openRyuukyokuSheet(p);
    case "abortive":
      return openAbortiveSheet(p);
    case "nagashi":
      return openNagashiSheet(p);
    case "multiRon":
      return openMultiRonSheet(p);
    case "chombo":
      return openChomboSheet(p);
    case "adjust":
      return openAdjustSheet({ state, rule, names, onAdjust });
    default:
      throw new Error("未知の特殊終局: " + kind);
  }
}

function renderTableScreen() {
  const state = reduce(game.events, game.rule);
  const names = playerNames(game);
  const rule = game.rule;

  const confirmAndEmit = (ev) => {
    closeSheet();
    emit(ev);
  };
  const adjustAndEmit = (seat, delta) => {
    const deltas = new Array(rule.playerCount).fill(0);
    deltas[seat] = delta;
    closeSheet();
    emit({ t: "adjust", note: "手動修正", deltas });
  };

  const actions = {
    onPanel: (seat) => {
      if (state.over) return;
      closeSheet();
      openSheetHandle = openAgariSheet({ state, rule, names, seat, onConfirm: confirmAndEmit });
    },
    // リーチ。再タップでその局の riichi イベントを削除して解除する
    onRiichi: (seat) => {
      if (state.round.riichi[seat]) {
        const idx = findCurrentRiichiIndex(game.events, seat);
        if (idx < 0) return;
        playRiichiCancel();
        game = withEvents(game, removeEvent(game.events, idx, rule));
        storage.saveCurrent(game);
        show();
        return;
      }
      // 音はタップの同期処理の中で鳴らす（iOS はユーザー操作外の再生を許さない）
      playRiichi();
      emit({ t: "riichi", who: seat });
    },
    onMeld: (seat, value) => {
      playMeld(value);
      emit({ t: "meld", who: seat, value });
    },
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
      openSheetHandle = openSpecialMenu({
        rule,
        onPick: (kind) => {
          closeSheet();
          openSheetHandle = openSpecialSheet(kind, { state, rule, names, onConfirm: confirmAndEmit, onAdjust: adjustAndEmit });
        },
      });
    },
    onMenu: () => {
      closeSheet();
      openSheetHandle = openMenu({
        version: APP_VERSION,
        soundOn: soundEnabled(),
        onToggleSound: () => {
          setSoundEnabled(!soundEnabled());
          actions.onMenu(); // 開き直して表示を更新
        },
        onTestSound: () => playTest(),
        onAdjust: () => {
          closeSheet();
          openSheetHandle = openAdjustSheet({ state, rule, names, onAdjust: adjustAndEmit });
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
    onLog: () => {
      logTarget = { kind: "current" };
      show("log");
    },
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
      // 精算を確定して焼き込み、終了した対局に移す（§7, §9.2）
      const finished = { ...game, endedAt: new Date().toISOString() };
      finished.settlement = { ...computeSettlement(finished), computedAt: finished.endedAt };
      storage.appendGame(finished);
      storage.clearCurrent();
      game = null;
      resultId = finished.id;
      show("result");
    },
    onUndo: () => {
      game = withEvents(game, undoLast(game.events, rule));
      storage.saveCurrent(game);
      show();
    },
  });
}

// ---- 結果画面（§7） ------------------------------------------------------

/** 終了した対局の精算。編集で null に戻っていれば再計算して保存する。 */
function settlementOf(g) {
  if (g.settlement) return g.settlement;
  const s = { ...computeSettlement(g), computedAt: new Date().toISOString() };
  storage.updateGame({ ...g, settlement: s });
  return s;
}

function renderResultScreen() {
  stopElapsed();
  const g = storage.findGame(resultId);
  if (!g) {
    show("start");
    return;
  }
  root.append(
    renderResult({
      game: g,
      names: playerNames(g),
      settlement: settlementOf(g),
      title: `結果 ${(g.endedAt || g.startedAt || "").slice(0, 16).replace("T", " ")}`,
      onBack: () => show("start"),
      onLog: () => {
        logTarget = { kind: "finished", id: g.id };
        show("log");
      },
      onExport: () => exportJson(),
    }),
  );
}

// ---- 成績画面（§8.5） ----------------------------------------------------

function renderStatsScreen() {
  stopElapsed();
  root.append(renderStats({ games: storage.loadGames(), roster: storage.loadRoster(), onBack: () => show("start") }));
}

// ---- ログ画面（§8.4） ---------------------------------------------------

function logGame() {
  if (logTarget.kind === "current") return game;
  return storage.findGame(logTarget.id);
}

/** 編集結果を保存する。進行中なら mj.current、終了済みなら mj.games を更新する（settlement は null に戻る）。 */
function saveLogGame(events) {
  if (logTarget.kind === "current") {
    game = withEvents(game, events);
    storage.saveCurrent(game);
  } else {
    const g = withEvents(logGame(), events);
    storage.updateGame(g);
  }
}

function renderLogScreen() {
  stopElapsed();
  const g = logGame();
  if (!g) {
    show("start");
    return;
  }
  const rule = g.rule;
  const names = playerNames(g);
  const title = logTarget.kind === "current" ? "ログ（進行中）" : `ログ ${(g.endedAt || g.startedAt || "").slice(0, 10)}`;

  /** 挿入位置。空の進行中グループなら末尾（end イベントの前）。 */
  const insertIndexOf = (group) => {
    if (group.indices.length) return group.indices[0];
    const endIdx = g.events.findIndex((e) => e.t === "end");
    return endIdx >= 0 ? endIdx : g.events.length;
  };

  root.append(
    renderLog({
      game: g,
      names,
      title,
      onBack: () => {
        if (logTarget.kind === "current") show("table");
        else {
          resultId = logTarget.id;
          show("result");
        }
      },
      onEdit: (gi) => {
        const group = kyokuGroups(g.events)[gi];
        const idx = group.endIndex;
        const before = reduce(g.events.slice(0, idx), rule);
        closeSheet();
        openSheetHandle = openEventEditor({
          event: g.events[idx],
          state: before,
          rule,
          names,
          onConfirm: (ev) => {
            closeSheet();
            saveLogGame(replaceEvent(g.events, idx, ev, rule));
            show();
          },
        });
      },
      onInsert: (gi) => {
        const group = kyokuGroups(g.events)[gi];
        const idx = insertIndexOf(group);
        const before = reduce(g.events.slice(0, idx), rule);
        const onConfirm = (ev) => {
          closeSheet();
          saveLogGame(insertEvent(g.events, idx, ev, rule));
          show();
        };
        closeSheet();
        openSheetHandle = openSpecialMenu({
          rule,
          title: `${kyokuName(before.kyoku, rule.playerCount)} の前に挿入`,
          withAdjust: false,
          withAgari: true,
          onPick: (kind) => {
            closeSheet();
            if (kind === "agari") {
              // 和了者を選んでから和了入力を開く
              openSheetHandle = openActionSheet({
                title: "和了者",
                items: names.map((name, i) => ({
                  label: name,
                  onPick: () => {
                    openSheetHandle = openAgariSheet({ state: before, rule, names, seat: i, onConfirm });
                  },
                })),
              });
              return;
            }
            openSheetHandle = openSpecialSheet(kind, { state: before, rule, names, onConfirm });
          },
        });
      },
      onDelete: (gi) => {
        const group = kyokuGroups(g.events)[gi];
        const before = reduce(g.events.slice(0, group.indices[0]), rule);
        closeSheet();
        openSheetHandle = openConfirm({
          title: "局の削除",
          message: `${kyokuName(before.kyoku, rule.playerCount)} ${before.honba}本場 を削除します。局中のリーチ・副露・修正も消えます。`,
          okLabel: "削除する",
          onOk: () => {
            saveLogGame(deleteKyoku(g.events, gi, rule));
            show();
          },
        });
      },
    }),
  );
}

// ---- エクスポート／インポート（§9.4） ------------------------------------

function exportFilename() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `mj-export-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/** 全データを JSON で書き出す。共有シートが使えればそれを、なければダウンロードリンクを使う。 */
async function exportJson() {
  const data = storage.exportAll();
  const json = JSON.stringify(data, null, 1);
  const name = exportFilename();
  const file = new File([json], name, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** JSON を読み込んで全データを置き換える。確認してから反映する。 */
function importJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(String(reader.result));
    } catch {
      alert("JSON として読めませんでした");
      return;
    }
    if (!data || typeof data !== "object" || !Array.isArray(data.games) || !Array.isArray(data.roster)) {
      alert("形式が違います（roster と games が必要です）");
      return;
    }
    const ver = (data.meta && data.meta.schemaVersion) || 0;
    if (ver > SCHEMA_VERSION) {
      alert(`このアプリより新しい形式です（schemaVersion ${ver}）`);
      return;
    }
    closeSheet();
    openSheetHandle = openConfirm({
      title: "インポート",
      message: `対局 ${data.games.length}件、プレイヤー ${data.roster.length}人を読み込み、今のデータをすべて置き換えます。`,
      okLabel: "置き換える",
      onOk: () => {
        storage.importAll(data);
        game = storage.loadCurrent();
        show(game ? "table" : "start");
      },
    });
  };
  reader.readAsText(file);
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

// ---- Service Worker（§10） ----------------------------------------------
// 更新は次回起動時に適用する（skipWaiting は使わない）。localhost / https 以外では登録できない。

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      /* 登録できなくても動作には影響しない（オフラインで開けないだけ） */
    });
  });
}

// ---- 起動 -----------------------------------------------------------------

show();
