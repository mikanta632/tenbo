// 効果音（docs/design.md §8.2）。Web Audio だけを使い、音声ファイルも音声合成も持たない。
//
// iOS では AudioContext がユーザー操作の外では動かず、画面ロックや他アプリの音で
// "interrupted" / "suspended" になる。鳴らすたびに resume し、画面復帰やタッチでも resume する。
// 設定はこの端末だけの好みなので localStorage の mj.prefs に置く（対局データとは別）。

import { loadPrefs, savePrefs } from "./prefs.js";

export function soundEnabled() {
  return loadPrefs().sound !== "off";
}
export function setSoundEnabled(on) {
  savePrefs({ ...loadPrefs(), sound: on ? "on" : "off" });
}

// ---- Web Audio ----------------------------------------------------------

// iOS は割り込み（着信・Siri・他アプリの音・長いロック）のあと、AudioContext が
// "interrupted" のまま resume に応えなくなったり、"running" を名乗ったまま時刻が進まず
// 無音になったりする。こうなると resume では戻らないので、捨てて作り直す（再起動で治るのと同じ）。
// 作り直しは次の audio() 呼び出し、つまりタップの処理の中で行うので、新しい文脈もそのまま鳴る。

let ctx = null;
let broken = false; // resume が効かなかった。次の audio() で作り直す
let probe = null; // 前回 audio() を呼んだときの文脈の時刻と実時間（running のときだけ）

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (ctx && (broken || ctx.state === "closed" || stalled(ctx))) discard();
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      ctx = null;
      return null;
    }
  }
  if (ctx.state !== "running") revive(ctx);
  probe = ctx.state === "running" ? { time: ctx.currentTime, wall: performance.now() } : null;
  return ctx;
}

/** running なのに、前回から実時間ほど文脈の時刻が進んでいない（音が出ない状態） */
function stalled(c) {
  if (!probe || c.state !== "running") return false;
  const wall = (performance.now() - probe.wall) / 1000;
  return wall > 1 && c.currentTime - probe.time < wall / 2;
}

/** resume を試み、失敗するか、しばらくしても running にならなければ壊れたとみなす */
function revive(c) {
  const giveUp = () => {
    if (c === ctx && c.state !== "running") broken = true;
  };
  c.resume().then(giveUp, giveUp);
  setTimeout(giveUp, 500); // interrupted の間は resume の約束が解決しないことがある
}

function discard() {
  const old = ctx;
  ctx = null;
  broken = false;
  probe = null;
  old.close().catch(() => {});
}

/** 画面に戻ったときやタッチで、止まっていた音声を起こす */
function wake() {
  if (ctx && ctx.state !== "running") revive(ctx);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") wake();
});
window.addEventListener("pageshow", wake);
document.addEventListener("touchend", wake, { passive: true });

/** 短い音。when は現在からの遅れ（秒）。type は波形。 */
function tone(freq, dur, when = 0, { gain = 0.25, type = "sine" } = {}) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// ---- 公開 -----------------------------------------------------------------

/** リーチ宣言: 自動卓風のチャイム（ピンポーン） */
export function playRiichi() {
  if (!soundEnabled()) return;
  tone(1319, 0.35, 0, { gain: 0.3, type: "triangle" });
  tone(1047, 0.6, 0.18, { gain: 0.3, type: "triangle" });
}

/** リーチ取り消し: 下降音 */
export function playRiichiCancel() {
  if (!soundEnabled()) return;
  tone(520, 0.1);
  tone(390, 0.16, 0.1);
}

/** 副露: オンで二連の短い音、オフで低い音1つ */
export function playMeld(on) {
  if (!soundEnabled()) return;
  if (on) {
    tone(880, 0.07);
    tone(1175, 0.09, 0.08);
  } else {
    tone(440, 0.12);
  }
}

/** 操作音（すべてのボタン）: 低めの短い「コッ」。矩形波の高音は耳に刺さるので三角波で柔らかく */
export function playTap() {
  if (!soundEnabled()) return;
  tone(740, 0.045, 0, { gain: 0.16, type: "triangle" });
}

/** 局が終わり次の局へ: 上昇する3音 */
export function playNextKyoku() {
  if (!soundEnabled()) return;
  tone(784, 0.12, 0, { type: "triangle" });
  tone(988, 0.12, 0.13, { type: "triangle" });
  tone(1319, 0.3, 0.26, { type: "triangle" });
}

/** 局が終わり親が続く（連荘・チョンボ）: 「テッテレー」。3音刻んで最後を伸ばす、大当たり風のファンファーレ */
export function playRenchan() {
  if (!soundEnabled()) return;
  const sq = { type: "square", gain: 0.13 }; // 矩形波は大きく聞こえるので控えめに
  tone(784, 0.1, 0, sq);
  tone(880, 0.1, 0.11, sq);
  tone(988, 0.1, 0.22, sq);
  tone(1319, 0.45, 0.36, { type: "square", gain: 0.14 });
  tone(1319, 0.45, 0.36, { type: "triangle", gain: 0.2 }); // 矩形波だけだと痩せるので三角波を重ねる
}

/** 場が変わる（南入・西入）: 次局の3音のあと、間を置いて高い2音のチャイムを足す */
export function playNewWind() {
  if (!soundEnabled()) return;
  tone(784, 0.12, 0, { type: "triangle" });
  tone(988, 0.12, 0.13, { type: "triangle" });
  tone(1319, 0.3, 0.26, { type: "triangle" });
  tone(1568, 0.18, 0.7, { type: "triangle", gain: 0.28 });
  tone(2093, 0.5, 0.9, { type: "triangle", gain: 0.28 });
}

/** 終局: 長めの2音 */
export function playGameOver() {
  if (!soundEnabled()) return;
  tone(659, 0.3, 0, { type: "triangle" });
  tone(523, 0.7, 0.3, { type: "triangle" });
}

/** 設定画面の試聴 */
export function playTest() {
  playNextKyoku();
  setTimeout(() => playRiichi(), 700);
}
