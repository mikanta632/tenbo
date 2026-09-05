// 効果音（docs/design.md §8.2）。
//
// 端末内の音声合成（speechSynthesis）と Web Audio だけを使い、音声ファイルは持たない。
// どちらもユーザー操作（タップ）の中から呼ぶ必要があるため、ボタンのハンドラから同期的に呼ぶ。
// 設定はこの端末だけの好みなので localStorage の mj.prefs に置く（対局データとは別）。

import { loadPrefs, savePrefs } from "./prefs.js";

export function soundEnabled() {
  return loadPrefs().sound !== "off";
}
export function setSoundEnabled(on) {
  savePrefs({ ...loadPrefs(), sound: on ? "on" : "off" });
}
export function voiceName() {
  return loadPrefs().voice || "";
}
export function setVoiceName(name) {
  savePrefs({ ...loadPrefs(), voice: name });
}

// ---- Web Audio ----------------------------------------------------------

let ctx = null;
function audio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** 短い音。when は現在からの遅れ（秒）。type は波形。 */
function tone(freq, dur, when = 0, { gain = 0.25, type = "sine", decay = true } = {}) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  if (decay) g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  else g.gain.setValueAtTime(gain, t0 + dur - 0.02), g.gain.linearRampToValueAtTime(0, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** 自動卓風のチャイム（ピンポーン） */
function chime(when = 0) {
  tone(1319, 0.35, when, { gain: 0.3, type: "triangle" });
  tone(1047, 0.55, when + 0.18, { gain: 0.3, type: "triangle" });
}

// ---- 音声合成 -----------------------------------------------------------

const PREFERRED = ["Hattori", "Otoya", "O-ren", "O-Ren", "Kyoko"];
let voices = [];
function refreshVoices() {
  if (!("speechSynthesis" in window)) return;
  voices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("ja"));
}
if ("speechSynthesis" in window) {
  refreshVoices();
  speechSynthesis.addEventListener("voiceschanged", refreshVoices);
}

/** 使える日本語の声の一覧 */
export function jaVoices() {
  refreshVoices();
  return voices.map((v) => ({ name: v.name, lang: v.lang }));
}

function pickVoice() {
  refreshVoices();
  const want = voiceName();
  if (want) {
    const v = voices.find((x) => x.name === want);
    if (v) return v;
  }
  for (const p of PREFERRED) {
    const v = voices.find((x) => x.name.includes(p));
    if (v) return v;
  }
  return voices[0] || null;
}

/**
 * 日本語で発声する。自動卓の発声に寄せて、やや速く・低く・張った調子にする。
 * 使えなければ false。
 */
function speak(text, { rate = 1.15, pitch = 0.9, delay = 0 } = {}) {
  if (!("speechSynthesis" in window)) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = rate;
    u.pitch = pitch;
    u.volume = 1.0;
    if (delay > 0) setTimeout(() => speechSynthesis.speak(u), delay);
    else speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

// ---- 公開 -----------------------------------------------------------------

/** リーチ宣言: チャイムのあと「リーチ！」。音声合成が無ければチャイムだけ */
export function playRiichi() {
  if (!soundEnabled()) return;
  chime();
  speak("リーチ！", { rate: 1.15, pitch: 0.9, delay: 380 });
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

/** 操作音（シートを開く・確定など） */
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
