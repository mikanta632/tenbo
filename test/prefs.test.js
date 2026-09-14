// ルールのプリセット（src/ui/prefs.js）のテスト。docs/design.md §4.2, §7
//
// localStorage をメモリ上のもので差し替えて、初回の種まき・旧 rules の取り込み・選択・編集・削除を見る。

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { memoryStorage } from "../src/storage.js";
import { PRESETS, presetFor, makeRule } from "../src/rules.js";
import { ensurePresets, loadPresets, presetsFor, selectedPreset, selectPreset, updatePreset, addPreset, deletePreset, loadPrefs, savePrefs } from "../src/ui/prefs.js";

function withStorage(t, initial = null) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  });
  globalThis.localStorage = memoryStorage();
  if (initial) savePrefs(initial);
}

describe("ensurePresets", () => {
  test("初回は組み込みを人数ごとのプリセットとして入れ、先頭を選ぶ", (t) => {
    withStorage(t);
    ensurePresets();
    assert.deepEqual(loadPresets().map((p) => p.name), Object.keys(PRESETS));
    assert.deepEqual(presetsFor(4).map((p) => p.name), ["4人標準"]);
    assert.deepEqual(presetsFor(3).map((p) => p.name), ["3人標準", "関西三麻"]);
    assert.equal(selectedPreset(4).name, "4人標準");
    assert.equal(selectedPreset(3).name, "3人標準");
    assert.deepEqual(selectedPreset(3).rule, PRESETS["3人標準"]);
  });
  test("旧 rules は「N人 カスタム」として取り込んで選び、rules は消す", (t) => {
    withStorage(t, { sound: "off", rules: { 3: { playerCount: 3, length: 6, startPoints: 35000, returnPoints: 40000, uma: [30, -10, -20], sanmaScoring: "kansai", chips: true } } });
    ensurePresets();
    const custom = presetsFor(3).find((p) => p.name === "3人 カスタム");
    assert.ok(custom);
    assert.equal(custom.rule.sanmaScoring, "kansai");
    assert.equal(custom.rule.chips, true);
    assert.equal(custom.rule.rate, 50, "不足は標準で埋める");
    assert.equal(selectedPreset(3).id, custom.id);
    assert.equal(selectedPreset(4).name, "4人標準");
    assert.equal(loadPrefs().rules, undefined);
    assert.equal(loadPrefs().sound, "off", "他の設定は残す");
  });
  test("2回目以降は種をまき直さず、消した組み込みは戻さない。人数の最後の 1つが無ければ標準を作る", (t) => {
    withStorage(t);
    ensurePresets();
    const kansai = presetsFor(3).find((p) => p.name === "関西三麻");
    assert.equal(deletePreset(kansai.id), true);
    ensurePresets();
    assert.deepEqual(presetsFor(3).map((p) => p.name), ["3人標準"]);
    // 4人を全部消した状態（手で書き換え）でも起動できる
    savePrefs({ ...loadPrefs(), presets: presetsFor(3), selected: {} });
    ensurePresets();
    assert.deepEqual(presetsFor(4).map((p) => p.name), ["4人標準"]);
    assert.deepEqual(presetsFor(4)[0].rule, presetFor(4));
    assert.equal(selectedPreset(3).name, "3人標準");
  });
});

describe("プリセットの管理", () => {
  test("選択は人数ごと。無効な id なら先頭に戻る", (t) => {
    withStorage(t);
    ensurePresets();
    const kansai = presetsFor(3).find((p) => p.name === "関西三麻");
    selectPreset(3, kansai.id);
    assert.equal(selectedPreset(3).name, "関西三麻");
    assert.equal(selectedPreset(4).name, "4人標準");
    selectPreset(3, "zzz");
    assert.equal(selectedPreset(3).name, "3人標準");
  });
  test("名前とルールを差し替える", (t) => {
    withStorage(t);
    ensurePresets();
    const p = selectedPreset(4);
    updatePreset(p.id, { name: "うちのルール" });
    updatePreset(p.id, { rule: makeRule({ rate: 100 }) });
    assert.equal(selectedPreset(4).name, "うちのルール");
    assert.equal(selectedPreset(4).rule.rate, 100);
    assert.equal(updatePreset("zzz", { name: "x" }), null);
  });
  test("追加と削除。人数の最後の 1つは消せず、選択中を消したら同じ人数の先頭を選ぶ", (t) => {
    withStorage(t);
    ensurePresets();
    const added = addPreset("東風", makeRule({ length: 4 }));
    assert.deepEqual(presetsFor(4).map((p) => p.name), ["4人標準", "東風"]);
    selectPreset(4, added.id);
    assert.equal(deletePreset(added.id), true);
    assert.equal(selectedPreset(4).name, "4人標準");
    assert.equal(deletePreset(selectedPreset(4).id), false, "最後の 1つ");
    assert.equal(presetsFor(4).length, 1);
    assert.equal(deletePreset("zzz"), false);
  });
});
