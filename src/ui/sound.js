// 効果音（docs/design.md §8.2）。リーチは音声合成で「リーチ」、副露は短い電子音。
//
// 端末内の音声合成（speechSynthesis）と Web Audio だけを使い、音声ファイルは持たない。
// どちらもユーザー操作（タップ）の中から呼ぶ必要があるため、ボタンのハンドラから同期的に呼ぶ。
// 設定はこの端末だけの好みなので localStorage の mj.prefs に置く（対局データとは別）。

const PREFS_KEY = "mj.prefs";

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function savePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 保存できなくても動作には影響しない */
  }
}

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
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

/** 短い正弦波。when は現在からの遅れ（秒）。 */
function beep(freq, dur, when = 0, gain = 0.25) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// ---- 音声合成 -----------------------------------------------------------

let jaVoice = null;
function pickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  jaVoice = voices.find((v) => v.lang === "ja-JP") || voices.find((v) => v.lang && v.lang.startsWith("ja")) || null;
  return jaVoice;
}
if ("speechSynthesis" in window) {
  // 声の一覧は非同期に揃うので、先に読んでおく
  pickVoice();
  speechSynthesis.addEventListener("voiceschanged", pickVoice);
}

/** 日本語で発声する。使えなければ false。 */
function speak(text) {
  if (!("speechSynthesis" in window)) return false;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    const v = jaVoice || pickVoice();
    if (v) u.voice = v;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

// ---- 公開 -----------------------------------------------------------------

/** リーチ宣言: 「リーチ」と発声。音声合成が無ければ上昇音 */
export function playRiichi() {
  if (!soundEnabled()) return;
  if (!speak("リーチ")) {
    beep(660, 0.12);
    beep(990, 0.18, 0.12);
  }
}

/** リーチ取り消し: 下降音 */
export function playRiichiCancel() {
  if (!soundEnabled()) return;
  beep(520, 0.1);
  beep(390, 0.16, 0.1);
}

/** 副露: オンで二連の短い音、オフで低い音1つ */
export function playMeld(on) {
  if (!soundEnabled()) return;
  if (on) {
    beep(880, 0.07);
    beep(1175, 0.09, 0.08);
  } else {
    beep(440, 0.12);
  }
}

/** 設定画面の試聴 */
export function playTest() {
  playMeld(true);
  setTimeout(() => speak("リーチ"), 250);
}
