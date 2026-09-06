// アプリ本体。画面の切替、イベントの発行と保存、終局処理、ログの編集、精算、成績、設定、エクスポート。
// 状態は Game（イベント列）だけを持ち、表示はすべて reduce で導出する（§4.1）。
//
// 画面: 初期画面はタブ（対局・設定・戦績・その他）。対局中・ログ・結果・個人ページはタブ無しの全画面。

import { createStorage, prepareImport } from "../storage.js";
import { PRESETS, validateRule } from "../rules.js";
import { reduce, isEndOfKyoku, agariYameAvailableAfter, dealerOf, kyokuGroups } from "../reduce.js";
import { appendEvent, undoLast, removeEvent, replaceEvent, insertEvent, deleteKyoku, withEvents } from "../edit.js";
import { computeSettlement } from "../settlement.js";
import { clear, h } from "./dom.js";
import { renderStart } from "./start.js";
import { renderTable } from "./table.js";
import { renderLog } from "./log.js";
import { renderResult } from "./result.js";
import { renderStats } from "./stats.js";
import { renderPlayer } from "./player.js";
import { renderSettings } from "./settings.js";
import { renderMisc } from "./misc.js";
import { renderTabBar } from "./tabs.js";
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
import { customRules, saveCustomRule } from "./prefs.js";
import {
  soundEnabled,
  setSoundEnabled,
  playRiichi,
  playRiichiCancel,
  playMeld,
  playTap,
  playNextKyoku,
  playGameOver,
  playTest,
} from "./sound.js";

// 版番号は version.js（index.html の classic script で読み込む）が唯一の定義。sw.js も同じファイルを読む
export const APP_VERSION = globalThis.APP_VERSION || "dev";

const storage = createStorage();
storage.init();

const root = document.getElementById("app");
let game = storage.loadCurrent();
let screen = game ? "table" : "game"; // game | settings | stats | misc | table | log | result | player
let logTarget = null; // { kind: "current" } | { kind: "finished", id }
let resultId = null; // 結果画面で見ている終了済み対局の id
let resultBack = "game"; // 結果画面の「戻る」先
let playerId = null; // 個人ページで見ているプレイヤー
let settingsPc = 4; // 設定タブで開いている人数
let openSheetHandle = null;
let elapsedTimer = null;
let diffSeat = null; // 点差を表示中の席
let diffTimer = null;

/** 新しい対局に使うルール。設定タブで変更していればそれ、なければプリセット */
function rulesFor(pc) {
  const custom = customRules()[String(pc)];
  if (custom) return custom;
  return Object.values(PRESETS).find((r) => r.playerCount === pc);
}
function isCustomRule(pc) {
  return !!customRules()[String(pc)];
}

// ---- 効果音: すべてのボタン操作 ---------------------------------------------
// 有効なボタン（と role=button のパネル）のクリックで共通の操作音を鳴らす。
// 専用の音を持つボタン（リーチ・副露）は data-no-sound で除く。capture で拾うので、
// ハンドラ内で要素が作り直されても取りこぼさない。

document.addEventListener(
  "click",
  (e) => {
    const b = e.target.closest("button, [role=button]");
    if (!b || b.disabled || b.dataset.noSound !== undefined) return;
    playTap();
  },
  true,
);

// ---- 画面の切替 ---------------------------------------------------------

const TAB_SCREENS = new Set(["game", "settings", "stats", "misc"]);

function show(next) {
  if (next) screen = next;
  closeSheet();
  clear(root);
  window.scrollTo(0, 0);
  if (screen === "table" && game) renderTableScreen();
  else if (screen === "log" && logTarget) renderLogScreen();
  else if (screen === "result" && resultId) renderResultScreen();
  else if (screen === "player" && playerId) renderPlayerScreen();
  else renderTabScreen();
}

/** タブ付きの初期画面 */
function renderTabScreen() {
  stopElapsed();
  if (!TAB_SCREENS.has(screen)) screen = "game";
  let content;
  if (screen === "settings") content = settingsContent();
  else if (screen === "stats") content = statsContent();
  else if (screen === "misc") content = miscContent();
  else content = gameTabContent();
  root.append(h("div", { class: "tab-shell" }, h("div", { class: "tab-content" }, content), renderTabBar(screen, (key) => show(key))));
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

// ---- 対局タブ -----------------------------------------------------------

function gameTabContent() {
  return renderStart({
    storage,
    current: game,
    rulesFor,
    onResume: () => show("table"),
    onDiscard: () => {
      openSheetHandle = openConfirm({
        title: "破棄",
        message: "進行中の対局を破棄します。保存されません。",
        okLabel: "破棄する",
        onOk: () => {
          game = null;
          storage.clearCurrent();
          show("game");
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
      resultBack = "game";
      show("result");
    },
    onSettings: () => show("settings"),
  });
}

// ---- 設定タブ -----------------------------------------------------------

function settingsContent() {
  return renderSettings({
    presets: PRESETS,
    rulesFor,
    isCustom: isCustomRule,
    initialPc: settingsPc,
    version: APP_VERSION,
    onChange: (pc, rule) => {
      settingsPc = pc;
      saveCustomRule(pc, rule);
    },
  });
}

// ---- 戦績タブ・個人ページ（§8.5） ----------------------------------------

function statsContent() {
  return renderStats({
    games: storage.loadGames(),
    roster: storage.loadRoster(),
    onBack: null,
    onPlayer: (id) => {
      playerId = id;
      show("player");
    },
  });
}

function renderPlayerScreen() {
  stopElapsed();
  root.append(
    renderPlayer({
      playerId,
      roster: storage.loadRoster(),
      games: storage.loadGames(),
      onBack: () => show("stats"),
      onOpenResult: (id) => {
        resultId = id;
        resultBack = "player";
        show("result");
      },
      onRename: (id, name) => {
        storage.renamePlayer(id, name);
        show("player");
      },
    }),
  );
}

// ---- その他タブ -----------------------------------------------------------

function miscContent() {
  return renderMisc({
    sound: { enabled: soundEnabled() },
    version: APP_VERSION,
    gamesCount: storage.loadGames().length,
    onSound: ({ enabled }) => {
      setSoundEnabled(enabled);
      show("misc");
    },
    onTestSound: () => playTest(),
    onExport: () => exportJson(),
    onImport: (file) => importJson(file),
    onCheckUpdate: (setStatus) => checkForUpdate(setStatus),
  });
}

// ---- 更新の確認（§10） ---------------------------------------------------
// 新しい版があれば Service Worker に SKIP_WAITING を送り、切り替わったら再読み込みする。
// 通常の更新は次回起動時だが、ここではユーザーが明示的に頼んだので即時に適用する。

let reloadingForUpdate = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) location.reload();
  });
}

/** 公開されている最新の版番号を読む（キャッシュを通さない）。取れなければ null */
async function fetchLatestVersion() {
  try {
    const res = await fetch(`./version.js?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const m = (await res.text()).match(/APP_VERSION\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function checkForUpdate(setStatus) {
  if (!("serviceWorker" in navigator)) {
    setStatus("この環境では更新機能が使えません。");
    return;
  }
  if (!navigator.onLine) {
    setStatus("オフラインです。ネットワークにつないでからもう一度押してください。");
    return;
  }
  setStatus("確認中…");
  const latest = await fetchLatestVersion();
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    setStatus(latest && latest !== APP_VERSION ? `新しい版 ${latest} があります。アプリを開き直すと反映されます。` : `最新です（${APP_VERSION}）。`);
    return;
  }
  try {
    await reg.update();
  } catch {
    setStatus("更新の確認に失敗しました。ネットワークを確認してください。");
    return;
  }
  // 新しい SW がインストール中なら、待機状態になるまで待つ
  const waitInstalled = (sw) =>
    new Promise((resolve) => {
      if (sw.state === "installed") return resolve();
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" || sw.state === "redundant") resolve();
      });
    });
  if (reg.installing) {
    setStatus(`新しい版${latest ? ` ${latest}` : ""}をダウンロード中…`);
    await waitInstalled(reg.installing);
  }
  if (reg.waiting) {
    const apply = () => {
      setStatus("切り替えています…");
      reloadingForUpdate = true;
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
      // controllerchange が来なければ 3秒後に自力で再読み込み
      setTimeout(() => location.reload(), 3000);
    };
    if (game) {
      closeSheet();
      openSheetHandle = openConfirm({
        title: "更新",
        message: `新しい版${latest ? ` ${latest}` : ""}に切り替えて再読み込みします。進行中の対局は保存されているので消えません。`,
        okLabel: "切り替える",
        onOk: apply,
      });
      setStatus("新しい版があります。");
      return;
    }
    apply();
    return;
  }
  setStatus(latest && latest !== APP_VERSION ? `新しい版 ${latest} が見つかりましたが、まだ取り込めていません。もう一度押してください。` : `最新です（${APP_VERSION}）。`);
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
        onBackToStart: () => show("game"),
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
  const state = reduce(game.events, game.rule);
  if (state.over) playGameOver();
  else if (isEndOfKyoku(event)) playNextKyoku();
  show();
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
      resultBack = "game";
      show("result");
    },
    onUndo: () => {
      game = withEvents(game, undoLast(game.events, rule));
      storage.saveCurrent(game);
      show();
    },
    onDiscard: () => {
      closeSheet();
      openSheetHandle = openConfirm({
        title: "保存せずに終了",
        message: "この対局を保存せずに破棄します。成績にも残りません。",
        okLabel: "破棄する",
        onOk: () => {
          game = null;
          storage.clearCurrent();
          show("game");
        },
      });
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
    show("game");
    return;
  }
  root.append(
    renderResult({
      game: g,
      names: playerNames(g),
      settlement: settlementOf(g),
      title: `結果 ${(g.endedAt || g.startedAt || "").slice(0, 16).replace("T", " ")}`,
      onBack: () => show(resultBack),
      onLog: () => {
        logTarget = { kind: "finished", id: g.id };
        show("log");
      },
      onExport: () => exportJson(),
    }),
  );
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
    show("game");
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
    try {
      data = prepareImport(data);
    } catch (error) {
      alert(error.message);
      return;
    }
    closeSheet();
    openSheetHandle = openConfirm({
      title: "インポート",
      message: `対局 ${data.games.length}件、プレイヤー ${data.roster.length}人を読み込み、今のデータをすべて置き換えます。`,
      okLabel: "置き換える",
      onOk: () => {
        try {
          storage.importAll(data);
        } catch (error) {
          alert("インポートに失敗しました: " + error.message);
          return;
        }
        game = storage.loadCurrent();
        show(game ? "table" : "game");
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

// ---- 画面の向き（§10） --------------------------------------------------
// iOS では向きを固定できないため、横向きになったら中身を逆に回して縦向きのまま見せる。
// 本体（body）を回すので、body の中に fixed で置くシートも一緒に回る。
// CSS の 100vh は実際の viewport を指すため、回転後の高さは --app-h / --app-w で渡す。

function applyOrientation() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!w || !h) return; // 読み込み直後などで寸法が取れないときは触らない（CSS の既定 100vh のまま）
  const landscape = w > h;
  let angle = 0;
  // 注意: このファイルの screen は画面状態の変数。端末の向きは window.screen から取る
  const so = window.screen && window.screen.orientation;
  if (so && typeof so.angle === "number") angle = so.angle;
  else if (typeof window.orientation === "number") angle = window.orientation;
  const body = document.body;
  const rootEl = document.documentElement;
  if (landscape && (angle === 90 || angle === -90 || angle === 270)) {
    // 端末を左に倒した（angle 90）なら中身を右に回す
    const deg = angle === 90 ? -90 : 90;
    body.classList.add("rotated");
    body.style.width = `${h}px`;
    body.style.height = `${w}px`;
    body.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
    rootEl.style.setProperty("--app-w", `${h}px`);
    rootEl.style.setProperty("--app-h", `${w}px`);
  } else {
    // 縦向きでは CSS の 100dvh に任せる。起動直後の innerHeight はホーム画面起動時に
    // 実際より小さいことがあり、JS で固定すると下部のタブバーが浮く
    body.classList.remove("rotated");
    body.style.width = "";
    body.style.height = "";
    body.style.transform = "";
    rootEl.style.removeProperty("--app-w");
    rootEl.style.removeProperty("--app-h");
  }
}
window.addEventListener("resize", applyOrientation);
window.addEventListener("orientationchange", () => setTimeout(applyOrientation, 50));
window.addEventListener("load", applyOrientation);
window.addEventListener("pageshow", () => setTimeout(applyOrientation, 100));
if (window.visualViewport) window.visualViewport.addEventListener("resize", applyOrientation);
applyOrientation();
setTimeout(applyOrientation, 300);

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
