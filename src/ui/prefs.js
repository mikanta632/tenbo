// 端末だけの設定（docs/design.md §4.2 の mj.prefs）。対局データとは別で、エクスポートに含めない。
//
// { sound: "on" | "off", voice: string, rules: { "4": Rule, "3": Rule }, presets: [{ id, name, rule }] }
// rules は設定画面で作るカスタムルール。プレイヤー数ごとに 1つ。
// presets は名前を付けて保存したルール（§7）。

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

/** カスタムルールを保存する。null なら削除。 */
export function saveCustomRule(playerCount, rule) {
  const p = loadPrefs();
  const rules = { ...(p.rules || {}) };
  if (rule) rules[String(playerCount)] = rule;
  else delete rules[String(playerCount)];
  savePrefs({ ...p, rules });
}

export function customRules() {
  return loadPrefs().rules || {};
}

// ---- 名前付きプリセット（§7） ----------------------------------------------

export function loadPresets() {
  const list = loadPrefs().presets;
  return Array.isArray(list) ? list : [];
}

/** 今のルールに名前を付けて保存し、新しい一覧を返す。 */
export function savePreset(name, rule) {
  const p = loadPrefs();
  const id = "r_" + Math.random().toString(36).slice(2, 10);
  const presets = [...loadPresets(), { id, name, rule: JSON.parse(JSON.stringify(rule)) }];
  savePrefs({ ...p, presets });
  return presets;
}

/** id のプリセットを消し、新しい一覧を返す。 */
export function deletePreset(id) {
  const p = loadPrefs();
  const presets = loadPresets().filter((x) => x.id !== id);
  savePrefs({ ...p, presets });
  return presets;
}
