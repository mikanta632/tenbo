// 端末だけの設定（docs/design.md §4.2 の mj.prefs）。対局データとは別で、エクスポートに含めない。
//
// { sound: "on" | "off", voice: string, rules: { "4": Rule, "3": Rule } }
// rules は設定画面で作るカスタムルール。プレイヤー数ごとに 1つ。

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
