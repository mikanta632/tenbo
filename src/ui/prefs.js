// 端末だけの設定（docs/design.md §4.2 の mj.prefs）。対局データとは別で、エクスポートに含めない。
//
// { sound: "on" | "off", voice: string,
//   presets: [{ id, name, rule }],      // ルールのプリセット。人数は rule.playerCount（§7）
//   selected: { "4": id, "3": id },     // 人数ごとに選んでいるプリセット
//   presetsSeeded: true }               // 組み込みを一度入れたか（消しても戻さない）
// v0.31 までの rules（人数ごとのカスタムルール）は ensurePresets で取り込んで消す。

import { PRESETS, presetFor, normalizeRule } from "../rules.js";

export const PREFS_KEY = "mj.prefs";

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

export function savePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 保存できなくても動作には影響しない */
  }
}

const copy = (r) => JSON.parse(JSON.stringify(r));
const newId = () => "r_" + Math.random().toString(36).slice(2, 10);
const pcOf = (preset) => (preset.rule && preset.rule.playerCount === 3 ? 3 : 4);

/**
 * 起動時に呼ぶ。プリセットが無ければ組み込みから作り、旧 rules を取り込み、選択を有効な id に揃える。
 * 変更があれば保存する。
 */
export function ensurePresets() {
  const p = loadPrefs();
  const presets = Array.isArray(p.presets) ? p.presets.filter((x) => x && typeof x === "object" && x.rule) : [];
  const selected = { ...(p.selected || {}) };
  let changed = !Array.isArray(p.presets);
  if (!p.presetsSeeded) {
    for (const [name, rule] of Object.entries(PRESETS)) presets.push({ id: newId(), name, rule: copy(rule) });
    changed = true;
  }
  if (p.rules && typeof p.rules === "object") {
    for (const pc of [4, 3]) {
      const old = p.rules[String(pc)];
      if (!old) continue;
      const preset = { id: newId(), name: `${pc}人 カスタム`, rule: normalizeRule({ ...old, playerCount: pc }) };
      presets.push(preset);
      selected[String(pc)] = preset.id;
    }
    changed = true;
  }
  for (const pc of [4, 3]) {
    const mine = presets.filter((x) => pcOf(x) === pc);
    if (mine.length === 0) {
      const preset = { id: newId(), name: `${pc}人標準`, rule: copy(presetFor(pc)) };
      presets.push(preset);
      mine.push(preset);
      changed = true;
    }
    if (!mine.some((x) => x.id === selected[String(pc)])) {
      selected[String(pc)] = mine[0].id;
      changed = true;
    }
  }
  if (changed) {
    const next = { ...p, presets, selected, presetsSeeded: true };
    delete next.rules;
    savePrefs(next);
  }
}

export function loadPresets() {
  const list = loadPrefs().presets;
  return Array.isArray(list) ? list : [];
}

/** その人数のプリセット（保存順） */
export function presetsFor(playerCount) {
  return loadPresets().filter((x) => pcOf(x) === playerCount);
}

export function selectedPresetId(playerCount) {
  return (loadPrefs().selected || {})[String(playerCount)] ?? null;
}

/** その人数で選んでいるプリセット。無ければその人数の先頭 */
export function selectedPreset(playerCount) {
  const mine = presetsFor(playerCount);
  return mine.find((x) => x.id === selectedPresetId(playerCount)) || mine[0] || null;
}

export function selectPreset(playerCount, id) {
  const p = loadPrefs();
  savePrefs({ ...p, selected: { ...(p.selected || {}), [String(playerCount)]: id } });
}

/** 名前やルールを差し替える。patch: { name?, rule? } */
export function updatePreset(id, patch) {
  const p = loadPrefs();
  const presets = loadPresets().map((x) => (x.id === id ? { ...x, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.rule ? { rule: copy(patch.rule) } : {}) } : x));
  savePrefs({ ...p, presets });
  return presets.find((x) => x.id === id) || null;
}

/** 追加して、そのプリセットを返す。 */
export function addPreset(name, rule) {
  const p = loadPrefs();
  const preset = { id: newId(), name, rule: copy(rule) };
  savePrefs({ ...p, presets: [...loadPresets(), preset] });
  return preset;
}

/** 削除する。その人数の最後の 1つなら消さずに偽を返す。選択中だったら同じ人数の先頭を選ぶ。 */
export function deletePreset(id) {
  const target = loadPresets().find((x) => x.id === id);
  if (!target) return false;
  const pc = pcOf(target);
  if (presetsFor(pc).length <= 1) return false;
  const p = loadPrefs();
  const presets = loadPresets().filter((x) => x.id !== id);
  const selected = { ...(p.selected || {}) };
  if (selected[String(pc)] === id) selected[String(pc)] = presets.find((x) => pcOf(x) === pc).id;
  savePrefs({ ...p, presets, selected });
  return true;
}
