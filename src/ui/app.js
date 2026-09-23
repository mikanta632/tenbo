// アプリ本体。画面の切替、イベントの発行と保存、終局処理、ログの編集、精算、成績、設定、エクスポート。
// 状態は Game（イベント列）だけを持ち、表示はすべて reduce で導出する（§4.1）。
//
// 画面: 初期画面はタブ（対局・設定・戦績・その他）。対局中・ログ・結果・個人ページはタブ無しの全画面。

import { createStorage, prepareImport } from "../storage.js";
import { validateRule, normalizeRule, presetFor } from "../rules.js";
import { reduce, isEndOfKyoku, agariYameAvailableAfter, dealerOf, kyokuGroups } from "../reduce.js";
import { appendEvent, removeEvent, replaceEvent, insertEvent, insertIndexOf, deleteKyoku, withEvents } from "../edit.js";
import { computeSettlement } from "../settlement.js";
import { combineGames } from "../stats.js";
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
  openRateSheet,
  openCombinedSettlement,
} from "./sheets.js";
import { fmtElapsed, kyokuName, gameDateTime } from "./format.js";
import { ensurePresets, presetsFor, selectedPreset, selectedPresetId, selectPreset, updatePreset, addPreset, deletePreset } from "./prefs.js";
import {
  soundEnabled,
  setSoundEnabled,
  playRiichi,
  playRiichiCancel,
  playMeld,
  playTap,
  playNextKyoku,
  playNewWind,
  playRenchan,
  playGameOver,
  playTest,
} from "./sound.js";

// 版番号は version.js（index.html の classic script で読み込む）が唯一の定義。sw.js も同じファイルを読む
export const APP_VERSION = globalThis.APP_VERSION || "dev";

const storage = createStorage();
storage.init();
ensurePresets(); // ルールのプリセット（組み込みの種、旧 rules の取り込み。§7）

const root = document.getElementById("app");
let game = storage.loadCurrent();
let screen = game ? "table" : "game"; // game | settings | stats | misc | table | log | result | player
let logTarget = null; // { kind: "current" } | { kind: "finished", id }
let resultId = null; // 結果画面で見ている終了済み対局の id
let resultBack = "game"; // 結果画面の「戻る」先
let playerId = null; // 個人ページで見ているプレイヤー
let settingsPc = 4; // 設定タブで開いている人数
let statsTab = "games"; // 戦績タブで開いているタブ（対局一覧／個人成績）
let statsPc = 4; // 個人成績で見ている人数（個人ページもこれに合わせる）
let statsListState = { filter: "all", period: "all", selectedIds: [], scrollTop: 0 };
let openSheetHandle = null;
let elapsedTimer = null;
let diffSeat = null; // 点差を表示中の席
let diffTimer = null;

/** 新しい対局に使うルール。その人数で選んでいるプリセット（不足は標準で埋める。§7） */
function rulesFor(pc) {
  const preset = selectedPreset(pc);
  return normalizeRule(preset ? { ...preset.rule, playerCount: pc } : presetFor(pc));
}
/** 選んでいるプリセットが標準と違う設定になっているか */
function isCustomRule(pc) {
  return JSON.stringify(rulesFor(pc)) !== JSON.stringify(presetFor(pc));
}
/** プリセットの選択・管理。対局タブと設定タブで共有する */
const presetActions = {
  presetsFor,
  selectedId: (pc) => (selectedPreset(pc) || {}).id ?? selectedPresetId(pc),
  onSelectPreset: (pc, id) => selectPreset(pc, id),
};

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
  const statsScroller = root.querySelector(".stats-screen")?.closest(".tab-content");
  if (statsScroller) statsListState.scrollTop = statsScroller.scrollTop;
  if (next) screen = next;
  if (screen !== "table") releaseWakeLock();
  closeSheet();
  clear(root);
  window.scrollTo(0, 0);
  if (screen === "table" && game) renderTableScreen();
  else if (screen === "log" && logTarget) renderLogScreen();
  else if (screen === "result" && resultId) renderResultScreen();
  else if (screen === "player" && playerId) renderPlayerScreen();
  else renderTabScreen();
  // タブ画面のときだけ body のスクロールを止める（起動直後に下部バーが浮くのを防ぐ）
  document.body.classList.toggle("tabs-screen", TAB_SCREENS.has(screen));
  // 3人麻雀の対局中は横向き（§2, §10）。画面ごとに向きが変わるので、切り替えのたびに合わせ直す
  document.body.classList.toggle("app-landscape", landscapeWanted());
  applyOrientation();
}

/**
 * 横向きに見せる画面か（§10）。3人麻雀の対局が進行中なら、卓面もタブ画面（開始画面へ戻ったとき）も横向きのまま。
 * 行き来のたびに画面を回さないため。終了直後の結果とそのログも横向き。
 * 戦績タブから開いた過去の対局は、手に持って読むので縦向きのまま。
 */
function landscapeWanted() {
  let g = null;
  if (screen === "table" || TAB_SCREENS.has(screen)) g = game;
  else if (screen === "log" && logTarget) {
    if (logTarget.kind === "current") g = game;
    else if (resultBack === "game" && logTarget.id === resultId) g = storage.findGame(logTarget.id);
  } else if (screen === "result" && resultBack === "game") g = storage.findGame(resultId);
  return !!g && g.rule.playerCount === 3;
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
  const scroller = h("div", { class: "tab-content", onscroll: () => {
    if (screen === "stats" && scroller.isConnected) statsListState.scrollTop = scroller.scrollTop;
  } }, content);
  root.append(h("div", { class: "tab-shell" }, scroller, renderTabBar(screen, (key) => show(key))));
  if (screen === "stats") scroller.scrollTop = statsListState.scrollTop;
}

/** シートやダイアログが開いているか（背景のタップで閉じたものは開いていない扱い） */
function sheetOpen() {
  return !!openSheetHandle?.overlay?.isConnected;
}

/**
 * +/− の点差表示を戻す。再描画はシートを閉じるので、シートが開いているあいだは待つ
 * （流局の入力中やアガリやめの選択中に消さない）。
 */
function clearDiff() {
  diffTimer = null;
  if (screen !== "table") {
    diffSeat = null;
    return;
  }
  if (sheetOpen()) {
    diffTimer = setTimeout(clearDiff, 1000);
    return;
  }
  diffSeat = null;
  show();
}

function closeSheet() {
  if (openSheetHandle) {
    openSheetHandle.close();
    openSheetHandle = null;
  }
}

/**
 * 保存する。失敗（端末の保存領域が足りない等）したら知らせて false を返す。
 * 呼び出し側は、保存できたときだけ画面の状態を進める（保存されていない操作を画面に残さない）。
 */
function persist(write) {
  try {
    write();
    return true;
  } catch {
    alert("保存できませんでした。端末の保存領域が足りない可能性があります。この操作は反映していません。");
    return false;
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
    ...presetActions,
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
      if (!persist(() => storage.saveCurrent(g))) return;
      game = g;
      show("table");
    },
    onSettings: () => show("settings"),
  });
}

// ---- 設定タブ -----------------------------------------------------------

function settingsContent() {
  return renderSettings({
    rulesFor,
    isCustom: isCustomRule,
    presetsFor,
    selectedId: presetActions.selectedId,
    initialPc: settingsPc,
    version: APP_VERSION,
    onSelect: (pc, id) => {
      settingsPc = pc;
      selectPreset(pc, id);
    },
    onRename: (pc, id, name) => updatePreset(id, { name }),
    // 項目の変更は選んでいるプリセットに直接保存。null は標準に戻す
    onChange: (pc, rule) => {
      settingsPc = pc;
      const current = selectedPreset(pc);
      if (current) updatePreset(current.id, { rule: rule || presetFor(pc) });
    },
    onCreate: (pc) => {
      const created = addPreset(`${pc}人 新しいルール`, presetFor(pc));
      selectPreset(pc, created.id);
      return created;
    },
    onDuplicate: (pc) => {
      const current = selectedPreset(pc);
      if (!current) return null;
      const created = addPreset(`${current.name}のコピー`, current.rule);
      selectPreset(pc, created.id);
      return created;
    },
    onDelete: (pc, id) => deletePreset(id),
  });
}

// ---- 戦績タブ・個人ページ（§8.5） ----------------------------------------

function statsContent() {
  return renderStats({
    games: storage.loadGames(),
    roster: storage.loadRoster(),
    carry: storage.loadCarry(),
    onBack: null,
    initialTab: statsTab,
    onTab: (key) => (statsTab = key),
    initialPc: statsPc,
    initialListState: statsListState,
    onListState: (state) => (statsListState = state),
    onPc: (n) => (statsPc = n),
    onPlayer: (id) => {
      playerId = id;
      show("player");
    },
    onPickGame: (id) => pickGame(id),
    onSettle: (ids) => {
      const roster = storage.loadRoster();
      const nameOf = (id) => (roster.find((p) => p.id === id) || { name: "?" }).name;
      const picked = storage.loadGames().filter((g) => ids.includes(g.id));
      if (picked.length === 0) return;
      const { players, transfers } = combineGames(picked);
      closeSheet();
      openSheetHandle = openCombinedSettlement({
        count: picked.length,
        players: players.map((p) => ({ ...p, name: nameOf(p.playerId) })),
        transfers,
      });
    },
  });
}

/** 戦績タブの対局一覧で行を選んだとき。結果・編集・削除を選ばせる（§8.5）。 */
function pickGame(id) {
  const g = storage.findGame(id);
  if (!g) return;
  const date = gameDateTime(g);
  resultBack = "stats";
  closeSheet();
  openSheetHandle = openActionSheet({
    title: date,
    items: [
      {
        label: "結果を見る",
        onPick: () => {
          resultId = id;
          show("result");
        },
      },
      {
        label: "局を編集",
        sub: "ログ画面で局の内容を直す",
        onPick: () => {
          logTarget = { kind: "finished", id };
          show("log");
        },
      },
      {
        label: "レートを変更",
        sub: `${g.rule.rate}円 / pt`,
        onPick: () => {
          openSheetHandle = openRateSheet({
            rate: g.rule.rate,
            onConfirm: (rate) => {
              closeSheet();
              // 精算は焼き込み直す（収支・まとめて精算・個人成績は settlement から取る）
              const next = { ...g, rule: { ...g.rule, rate } };
              next.settlement = { ...computeSettlement(next), computedAt: new Date().toISOString() };
              if (persist(() => storage.updateGame(next))) show("stats");
            },
          });
        },
      },
      {
        label: "削除",
        sub: playerNames(g).join(" / "),
        danger: true,
        onPick: () => {
          openSheetHandle = openConfirm({
            title: "対局の削除",
            message: `${date} の対局を削除します。元に戻せません。`,
            okLabel: "削除する",
            onOk: () => {
              storage.deleteGame(id);
              show("stats");
            },
          });
        },
      },
    ],
  });
}


function renderPlayerScreen() {
  stopElapsed();
  root.append(
    renderPlayer({
      playerId,
      roster: storage.loadRoster(),
      games: storage.loadGames().filter((g) => g.rule.playerCount === statsPc),
      carry: storage.loadCarry().filter((c) => c.playerCount === statsPc),
      scopeLabel: `${statsPc}人麻雀`,
      scopePc: statsPc,
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

/**
 * Service Worker のスクリプト URL。版を query に入れて、版ごとに別のスクリプトにする。
 * sw.js の中身は版が変わっても同じなので、これをしないとブラウザが更新を取り込まない。
 */
function swUrl(version) {
  return `./sw.js?v=${encodeURIComponent(version)}`;
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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // 新しい SW がインストール中なら、待機状態になるまで待つ
  const waitInstalled = (sw) =>
    new Promise((resolve) => {
      if (sw.state === "installed") return resolve();
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" || sw.state === "redundant") resolve();
      });
    });
  /** 登録して、取り込みが始まっていればその完了（待機）まで待つ。戻り値は { reg, started } */
  const registerAndWait = async (url) => {
    const reg = await navigator.serviceWorker.register(url, { updateViaCache: "none" });
    // iOS では register の解決時点で installing がまだ無いことがあるので、少し待って見直す
    for (let i = 0; i < 10 && !reg.installing && !reg.waiting; i++) await sleep(200);
    const started = !!reg.installing;
    if (reg.installing) {
      setStatus(`新しい版${latest ? ` ${latest}` : ""}をダウンロード中…`);
      await waitInstalled(reg.installing);
    }
    return { reg, started };
  };
  let reg;
  try {
    // 最新の版で登録し直す。版が上がっていればスクリプト URL が変わるので、確実に取り込まれる
    let r = await registerAndWait(swUrl(latest || APP_VERSION));
    if (!r.started && !r.reg.waiting && latest && latest !== APP_VERSION) {
      // SW の URL はすでに最新なのに動いているページが古い（以前の取り込みで配信元の古いファイルを掴んだ等）。
      // 別の URL で登録し直し、事前キャッシュを取り直す（キャッシュ名は同じ版なので中身が上書きされる）
      r = await registerAndWait(`${swUrl(latest)}&r=${Date.now()}`);
    }
    reg = r.reg;
  } catch {
    setStatus("更新の確認に失敗しました。ネットワークを確認してください。");
    return;
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
  setStatus(latest && latest !== APP_VERSION ? `新しい版 ${latest} を取り込み中です。少し待ってからもう一度押すか、アプリを開き直してください。` : `最新です（${APP_VERSION}）。`);
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
  // 手動修正。kind が "chips" ならチップ枚数の補正（点数は動かさない）
  const adjustAndEmit = (seat, delta, kind = "points") => {
    const deltas = new Array(rule.playerCount).fill(0);
    closeSheet();
    if (kind === "chips") {
      const chips = new Array(rule.playerCount).fill(0);
      chips[seat] = delta;
      emit({ t: "adjust", note: "チップ修正", deltas, chips });
      return;
    }
    deltas[seat] = delta;
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
        const next = withEvents(game, removeEvent(game.events, idx, rule));
        if (!persist(() => storage.saveCurrent(next))) return;
        playRiichiCancel();
        game = next;
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
      if (diffSeat !== null) diffTimer = setTimeout(clearDiff, 8000);
      show();
    },
    onSpecial: () => {
      // 終局後は終局ダイアログを開き直す（閉じてしまっても保存できるように）
      if (state.over) {
        showOver(state, names);
        return;
      }
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
  const prev = reduce(game.events, game.rule);
  const prevKyoku = prev.kyoku;
  let events;
  try {
    events = appendEvent(game.events, event, game.rule);
  } catch (e) {
    alert(e.message);
    return;
  }
  const next = withEvents(game, events);
  if (!persist(() => storage.saveCurrent(next))) return; // 保存できなければ操作ごと取り消す
  game = next;
  const state = reduce(game.events, game.rule);
  if (state.over) {
    if (!prev.over) playGameOver(); // 終局後の手動修正では鳴らさない
  } else if (isEndOfKyoku(event)) {
    // 局が進んだか、親が続いた（連荘・チョンボ）かで音を変える
    if (state.kyoku === prevKyoku) playRenchan();
    else if (Math.floor(state.kyoku / game.rule.playerCount) !== Math.floor(prevKyoku / game.rule.playerCount)) playNewWind(); // 南入・西入
    else playNextKyoku();
  }
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
  if (rule.tobi && state.points.some((p) => p < (rule.tobiLine ?? 0))) reason = "トビで終局";
  else if (last && last.t === "end") reason = "終局（アガリやめ／手動）";
  else if (rule.extension && state.kyoku >= rule.length) {
    reason = Math.max(...state.points) >= rule.returnPoints ? "延長戦で返す点に到達" : "延長戦を終えました";
  }
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
      if (!persist(() => storage.appendGame(finished))) return;
      storage.clearCurrent();
      game = null;
      resultId = finished.id;
      resultBack = "game";
      show("result");
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
  try {
    storage.updateGame({ ...g, settlement: s });
  } catch {
    /* 焼き込めなくても表示はできる。次に開いたときにまた計算する */
  }
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
      title: `結果 ${gameDateTime(g)}`,
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
    const next = withEvents(game, events);
    if (persist(() => storage.saveCurrent(next))) game = next;
  } else {
    const g = withEvents(logGame(), events);
    persist(() => storage.updateGame(g));
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
  const title = logTarget.kind === "current" ? "ログ（進行中）" : `ログ ${gameDateTime(g).slice(0, 10)}`;

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
        const idx = insertIndexOf(g.events, gi);
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
                    openSheetHandle = openAgariSheet({ state: before, rule, names, seat: i, onConfirm, selectSeat: true });
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
    const head = `対局 ${data.games.length}件、プレイヤー ${data.roster.length}人`;
    openSheetHandle = openActionSheet({
      title: "インポート",
      items: [
        {
          label: "マージ（今のデータに追加）",
          sub: `${head}。無い対局と人を足す。進行中の対局は今のまま`,
          onPick: () => {
            let summary;
            try {
              summary = storage.mergeAll(data);
            } catch (error) {
              alert("インポートに失敗しました: " + error.message);
              return;
            }
            const parts = [`対局 ${summary.games}件を追加`];
            if (summary.skippedGames) parts.push(`同じ対局 ${summary.skippedGames}件は飛ばした`);
            if (summary.players) parts.push(`プレイヤー ${summary.players}人を追加`);
            if (summary.mergedPlayers) parts.push(`同名 ${summary.mergedPlayers}人は同一人物として寄せた`);
            if (summary.carry) parts.push(`繰越 ${summary.carry}件を追加`);
            game = storage.loadCurrent();
            show(game ? "table" : "stats");
            alert("マージしました。" + parts.join("、") + "。");
          },
        },
        {
          label: "置き換え（今のデータを捨てる）",
          sub: `${head}で全部入れ替える。元に戻せない`,
          danger: true,
          onPick: () => {
            openSheetHandle = openConfirm({
              title: "置き換え",
              message: `${head}を読み込み、今のデータ（進行中の対局を含む）をすべて置き換えます。`,
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
          },
        },
      ],
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
// iOS では向きを固定できないため、端末の向きと見せたい向きが違うときは中身（body）を 90° 回す。
// 縦向きに見せたい画面で端末が横なら逆に回して縦に、横向きに見せたい画面（3人麻雀の対局中）で
// 端末が縦なら回して横に見せる。本体（body）を回すので、body の中に fixed で置くシートも一緒に回る。
// CSS の 100vh は実際の viewport を指すため、回転後の幅・高さは --app-w / --app-h で渡す。
// セーフエリアも回転に合わせて --sat / --sar / --sab / --sal を並べ替える。

/** CSS の env(safe-area-inset-*) を JS から読む（style.css の --env-* 経由） */
function safeInsets() {
  const cs = getComputedStyle(document.documentElement);
  const px = (name) => parseFloat(cs.getPropertyValue(name)) || 0;
  return { top: px("--env-sat"), right: px("--env-sar"), bottom: px("--env-sab"), left: px("--env-sal") };
}

function applyOrientation() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!w || !h) return; // 読み込み直後などで寸法が取れないときは触らない（CSS の既定 100vh のまま）
  const deviceLandscape = w > h;
  const wantLandscape = landscapeWanted();
  let angle = 0;
  // 注意: このファイルの screen は画面状態の変数。端末の向きは window.screen から取る
  const so = window.screen && window.screen.orientation;
  if (so && typeof so.angle === "number") angle = so.angle;
  else if (typeof window.orientation === "number") angle = window.orientation;
  const body = document.body;
  const rootEl = document.documentElement;
  const setInsets = (t, r, b, l) => {
    rootEl.style.setProperty("--sat", `${t}px`);
    rootEl.style.setProperty("--sar", `${r}px`);
    rootEl.style.setProperty("--sab", `${b}px`);
    rootEl.style.setProperty("--sal", `${l}px`);
  };
  let deg = 0;
  if (deviceLandscape && !wantLandscape && (angle === 90 || angle === -90 || angle === 270)) {
    // 端末を左に倒した（angle 90）なら中身を右に回す
    deg = angle === 90 ? -90 : 90;
  } else if (!deviceLandscape && wantLandscape) {
    // 端末は縦のまま横向きに見せる。中身の上を端末の左辺へ（iOS の landscape-primary と同じ向き）
    deg = -90;
  }
  if (deg !== 0) {
    body.classList.add("rotated");
    body.style.width = `${h}px`;
    body.style.height = `${w}px`;
    body.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
    rootEl.style.setProperty("--app-w", `${h}px`);
    rootEl.style.setProperty("--app-h", `${w}px`);
    // 中身を -90° 回すと、中身の上辺は端末の左辺、右辺は端末の上辺になる。+90° はその逆
    const s = safeInsets();
    if (deg === -90) setInsets(s.left, s.top, s.right, s.bottom);
    else setInsets(s.right, s.bottom, s.left, s.top);
  } else {
    body.classList.remove("rotated");
    body.style.width = "";
    body.style.height = "";
    body.style.transform = "";
    rootEl.style.removeProperty("--app-w");
    for (const name of ["--sat", "--sar", "--sab", "--sal"]) rootEl.style.removeProperty(name);
    // ホーム画面から起動したとき（standalone）は 100dvh が実際の画面より小さく出て、
    // 下部のタブバーの下に隙間が残る。ツールバーの伸縮が無いので実測値をそのまま使う。
    // Safari のタブでは上下のツールバーに追従する必要があるので CSS の 100dvh に任せる。
    if (isStandalone() && !deviceLandscape) rootEl.style.setProperty("--app-h", `${viewportHeight()}px`);
    else rootEl.style.removeProperty("--app-h");
  }
}

/** ホーム画面に追加したアイコンから起動したか */
function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

/**
 * 縦向きの表示領域の高さ（px）。
 *
 * ホーム画面から起動すると、status-bar-style=black-translucent でウェブビューは画面全体を
 * 覆うのに、iOS はステータスバーの分だけ小さい高さを返すことがある。100dvh も innerHeight も
 * 同じ値なので、画面の高さのほうが大きければそちらを採る。差がステータスバー程度（80px）を
 * 超えるときは、画面全体を覆っていないとみて実測値のままにする（バーを画面外へ押し出さない）。
 */
function viewportHeight() {
  const measured = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0);
  const screenHeight = (window.screen && window.screen.height) || 0;
  const diff = screenHeight - measured;
  return diff > 0 && diff <= 80 ? screenHeight : measured;
}
window.addEventListener("resize", applyOrientation);
window.addEventListener("orientationchange", () => setTimeout(applyOrientation, 50));
window.addEventListener("load", applyOrientation);
window.addEventListener("pageshow", () => setTimeout(applyOrientation, 100));
if (window.visualViewport) window.visualViewport.addEventListener("resize", applyOrientation);
applyOrientation();
setTimeout(applyOrientation, 300);

// ---- Screen Wake Lock（§10） --------------------------------------------

// 対局中（卓面）だけ画面を維持する。卓面を離れたら手放す
let wakeLock = null;
let wakeLockPending = false; // 再描画が続いても要求を重ねない
async function requestWakeLock() {
  if (!("wakeLock" in navigator) || wakeLock || wakeLockPending) return;
  wakeLockPending = true;
  try {
    const lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => {
      if (wakeLock === lock) wakeLock = null;
    });
    wakeLock = lock;
    if (screen !== "table") releaseWakeLock(); // 取得を待つあいだに卓面を離れた
  } catch {
    wakeLock = null;
  } finally {
    wakeLockPending = false;
  }
}
function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  if (lock) lock.release().catch(() => {});
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && screen === "table") requestWakeLock();
});

// ---- Service Worker（§10） ----------------------------------------------
// 更新は次回起動時に適用する（skipWaiting は使わない）。localhost / https 以外では登録できない。
// このページの版（キャッシュから読んだ version.js）で登録すると、SW の URL が古い版のままになり、
// 新しい版を取り込めない（取り込もうとした SW は配信元の版と合わずに install を失敗させる）。
// そこで公開中の版を読み、その版で登録する。新しい SW は待機し、ページを全部閉じたあと（次回起動時）に有効になる。

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    const latest = navigator.onLine ? await fetchLatestVersion() : null;
    navigator.serviceWorker.register(swUrl(latest || APP_VERSION), { updateViaCache: "none" }).catch(() => {
      /* 登録できなくても動作には影響しない（オフラインで開けないだけ） */
    });
  });
}

// ---- 起動 -----------------------------------------------------------------

show();
