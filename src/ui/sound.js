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

let ctx = null;

function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx || ctx.state === "closed") {
    try {
      ctx = new AC();
    } catch {
      ctx = null;
      return null;
    }
  }
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  return ctx;
}

/** 画面に戻ったときやタッチで、止まっていた音声を起こす */
function wake() {
  if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
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

/** 操作音（すべてのボタン） */
export function playTap() {
  if (!soundEnabled()) return;
  tone(1500, 0.04, 0, { gain: 0.12, type: "square" });
}

/** 局が終わり次の局へ: 上昇する3音 */
export function playNextKyoku() {
  if (!soundEnabled()) return;
  tone(784, 0.12, 0, { type: "triangle" });
  tone(988, 0.12, 0.13, { type: "triangle" });
  tone(1319, 0.3, 0.26, { type: "triangle" });
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
