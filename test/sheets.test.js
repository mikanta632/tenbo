import { test } from "node:test";
import assert from "node:assert/strict";
import { openAdjustSheet, openAbortiveSheet, openMenu, openOverDialog } from "../src/ui/sheets.js";
import { renderSettings } from "../src/ui/settings.js";
import { makeRule, PRESETS } from "../src/rules.js";
import { initialState } from "../src/reduce.js";

import { mockDom, button } from "./support/dom.js";

test("手動修正は空欄を拒否し、明示的な 0 点や負数は確定できる", (t) => {
  mockDom(t);
  const changes = [];
  const rule = makeRule();
  const { box } = openAdjustSheet({ state: initialState(rule), rule, names: ["A", "B", "C", "D"], onAdjust: (...args) => changes.push(args) });
  box.find((el) => el.tag === "button" && el.children[0] === "東 A 25,000").handlers.click();
  const input = box.querySelector(".points-input");
  const confirm = box.find((el) => el.tag === "button" && el.children[0] === "確定");
  for (const value of ["", " ", ",，", "abc", "12.5"]) {
    input.handlers.input({ target: { value } });
    assert.equal(confirm.disabled, true, JSON.stringify(value));
  }
  for (const [value, delta] of [["0", -25000], ["-1000", -26000], ["26,000", 1000]]) {
    input.handlers.input({ target: { value } });
    assert.equal(confirm.disabled, false);
    confirm.handlers.click();
    assert.deepEqual(changes.at(-1), [0, delta]);
  }
});

test("ウマは合計が 0 になっても自動保存せず、保存ボタンで全順位を反映する", (t) => {
  mockDom(t);
  const saved = [];
  const root = renderSettings({ presets: PRESETS, rulesFor: () => makeRule(), isCustom: () => false, onChange: (...args) => saved.push(args), version: "test" });
  const uma = () => root.querySelector(".uma-row").findAll((el) => el.tag === "input");
  uma()[0].handlers.input({ target: { value: "30" } });
  assert.deepEqual(saved, []);
  assert.equal(button(root, "ウマを保存").disabled, true);
  uma()[1].handlers.input({ target: { value: "0" } });
  assert.deepEqual(saved, []);
  assert.match(root.textContent, /未保存/);
  button(root, "ウマを保存").handlers.click();
  assert.deepEqual(saved, [[4, makeRule({ uma: [30, 0, -10, -20] })]]);
  assert.match(root.textContent, /保存済み/);
});

test("編集中のウマは他の設定の保存に混入せず、変更を戻せる", (t) => {
  mockDom(t);
  const saved = [];
  const root = renderSettings({ rulesFor: () => makeRule(), isCustom: () => false, onChange: (...args) => saved.push(args) });
  root.querySelector(".uma-row").querySelector("input").handlers.input({ target: { value: "30" } });
  root.find((el) => el.tag === "input" && el.type === "checkbox" && !el.disabled).handlers.change({ target: { checked: false } });
  assert.deepEqual(saved[0][1].uma, makeRule().uma);
  assert.match(root.textContent, /未保存/);
  button(root, "変更を戻す").handlers.click();
  assert.equal(root.querySelector(".uma-row").querySelector("input").value, "20");
  assert.equal(button(root, "ウマを保存").disabled, true);
});

test("三麻のウマは3順位を一括保存し、空欄では保存できない", (t) => {
  mockDom(t);
  const saved = [];
  const root = renderSettings({ initialPc: 3, rulesFor: () => PRESETS["3人標準"], isCustom: () => false, onChange: (...args) => saved.push(args) });
  const inputs = root.querySelector(".uma-row").findAll((el) => el.tag === "input");
  assert.equal(inputs.length, 3);
  inputs[0].handlers.input({ target: { value: "" } });
  assert.equal(button(root, "ウマを保存").disabled, true);
  [40, 0, -40].forEach((value, i) => inputs[i].handlers.input({ target: { value: String(value) } }));
  button(root, "ウマを保存").handlers.click();
  assert.equal(saved[0][0], 3);
  assert.deepEqual(saved[0][1].uma, [40, 0, -40]);
});

test("メニュー・終局画面に直前操作の取り消しを置かない", (t) => {
  mockDom(t);
  const rule = makeRule();
  for (const { box } of [openMenu({}), openOverDialog({ state: initialState(rule), rule, names: ["A", "B", "C", "D"] })]) {
    assert.equal(button(box, "戻す"), undefined);
    assert.equal(button(box, "直前の操作を取り消す"), undefined);
  }
});

// ---- v0.31 のオプションルール（§8.3, §8.9） ---------------------------------------

import { openAgariSheet, openSpecialMenu } from "../src/ui/sheets.js";
import { renderTable } from "../src/ui/table.js";

test("設定: 人数ごとのプリセットを選んで編集し、名前の変更・新規作成・複製・削除ができる", (t) => {
  mockDom(t);
  // 人数ごとのプリセット一覧と選択を、アプリと同じ形で模す
  let presets = [
    { id: "a4", name: "4人標準", rule: makeRule() },
    { id: "a3", name: "3人標準", rule: PRESETS["3人標準"] },
    { id: "k3", name: "関西三麻", rule: PRESETS["関西三麻"] },
  ];
  const selected = { 4: "a4", 3: "a3" };
  const forPc = (pc) => presets.filter((p) => p.rule.playerCount === pc);
  const current = (pc) => forPc(pc).find((p) => p.id === selected[pc]) || forPc(pc)[0];
  const changes = [];
  let seq = 0;
  const root = renderSettings({
    rulesFor: (pc) => current(pc).rule,
    isCustom: (pc) => JSON.stringify(current(pc).rule) !== JSON.stringify(pc === 3 ? PRESETS["3人標準"] : makeRule()),
    presetsFor: forPc,
    selectedId: (pc) => current(pc).id,
    onSelect: (pc, id) => (selected[pc] = id),
    onRename: (pc, id, name) => (presets = presets.map((p) => (p.id === id ? { ...p, name } : p))),
    onChange: (pc, rule) => {
      changes.push([pc, rule]);
      presets = presets.map((p) => (p.id === current(pc).id ? { ...p, rule: rule || (pc === 3 ? PRESETS["3人標準"] : makeRule()) } : p));
    },
    onCreate: (pc) => {
      const p = { id: `n${++seq}`, name: `${pc}人 新しいルール`, rule: pc === 3 ? PRESETS["3人標準"] : makeRule() };
      presets = [...presets, p];
      selected[pc] = p.id;
      return p;
    },
    onDuplicate: (pc) => {
      const p = { id: `d${++seq}`, name: `${current(pc).name}のコピー`, rule: current(pc).rule };
      presets = [...presets, p];
      selected[pc] = p.id;
      return p;
    },
    onDelete: (pc, id) => {
      if (forPc(pc).length <= 1) return false;
      presets = presets.filter((p) => p.id !== id);
      if (selected[pc] === id) selected[pc] = forPc(pc)[0].id;
      return true;
    },
    version: "test",
  });
  const picker = () => root.find((el) => el.tag === "select" && el["aria-label"] === "プリセット");
  const options = () => picker().children.map((o) => o.children[0]);
  // 4人の一覧だけが出る。最後の 1つは削除できない
  assert.deepEqual(options(), ["4人標準"]);
  assert.equal(button(root, "削除").disabled, true);
  // 3人に切り替えると 3人の一覧。関西三麻を選ぶと関西式が編集対象になる
  button(root, "3人麻雀").handlers.click();
  assert.deepEqual(options(), ["3人標準", "関西三麻"]);
  picker().handlers.change({ target: { value: "k3" } });
  assert.equal(selected[3], "k3");
  assert.match(root.textContent, /標準から変更あり/);
  const scoring = root.find((el) => el.matches(".row") && el.children[0]?.textContent === "点数方式").find((el) => el.tag === "select");
  assert.equal(scoring.children.find((o) => o.selected !== undefined).value, "kansai");
  // 項目を変えると選んでいるプリセットに保存される
  root.find((el) => el.matches(".row") && el.children[0]?.textContent === "チップ").find((el) => el.tag === "input").handlers.change({ target: { checked: true } });
  assert.equal(changes.at(-1)[0], 3);
  assert.equal(presets.find((p) => p.id === "k3").rule.chips, true);
  // 名前の変更
  root.find((el) => el.tag === "input" && el["aria-label"] === "プリセットの名前").handlers.change({ target: { value: "うちの三麻" } });
  assert.equal(presets.find((p) => p.id === "k3").name, "うちの三麻");
  assert.deepEqual(options(), ["3人標準", "うちの三麻"]);
  // 複製 → 選択が移る。削除 → 先頭に戻る
  button(root, "複製").handlers.click();
  assert.deepEqual(options(), ["3人標準", "うちの三麻", "うちの三麻のコピー"]);
  assert.equal(selected[3], "d1");
  button(root, "削除").handlers.click();
  assert.deepEqual(options(), ["3人標準", "うちの三麻"]);
  assert.equal(selected[3], "a3");
  // 新規作成は標準から。「標準に戻す」はそのプリセットの中身を戻す
  button(root, "新規作成").handlers.click();
  assert.equal(selected[3], "n2");
  assert.ok(!root.textContent.includes("標準から変更あり"));
  picker().handlers.change({ target: { value: "k3" } });
  button(root, "標準に戻す").handlers.click();
  assert.deepEqual(changes.at(-1), [3, null]);
  assert.equal(presets.find((p) => p.id === "k3").rule.sanmaScoring, "standard");
});

test("設定: 東風なら延長戦は「南入」、下位項目は親がオフなら無効", (t) => {
  mockDom(t);
  const root = renderSettings({ rulesFor: () => makeRule({ length: 4, sekinin: false, multiRon: false, chips: false, chomboRule: "mangan" }), isCustom: () => false, onChange: () => {}, version: "test" });
  const text = root.textContent;
  assert.match(text, /南入/);
  assert.ok(!text.includes("西入"));
  assert.ok(!text.includes("未実装"), "未実装の表示が残っている");
  const rowOf = (label) => root.find((el) => el.matches(".row") && el.children[0]?.textContent === label);
  for (const label of ["ロン時の負担", "供託の帰属", "本場の帰属", "定額の点", "チップ単価（円/枚）", "トビ賞（枚）"]) {
    const control = rowOf(label).find((el) => el.tag === "select" || el.tag === "input");
    assert.equal(control.disabled, true, label);
  }
  assert.equal(rowOf("トビの基準").find((el) => el.tag === "select").disabled, false);
  assert.equal(root.find((el) => el.matches(".row") && el.children[0]?.textContent === "点数方式"), undefined, "4人麻雀に3人の項目が出ている");
});

/** 段階入力の今の画面の選択肢を押す */
const pickStep = (box, label) => {
  const el = box.find((e) => e.tag === "button" && e.closest(".wz-grid") && e.textContent === label);
  assert.ok(el, `選択肢「${label}」がない: ${box.textContent.slice(0, 80)}`);
  el.handlers.click();
};
const stepTitle = (box) => box.querySelector(".wz-title")?.textContent ?? "確認";
const confirmItem = (box, label) => box.find((e) => e.tag === "button" && e.matches(".wz-item") && e.children[0].textContent === label);

test("和了入力: 1画面に1項目。チップを使うルールでは枚数の画面を出し、Winner.chips に入る。関西式は符を飛ばす", (t) => {
  mockDom(t);
  const events = [];
  const rule = makeRule({ chips: true });
  const { box } = openAgariSheet({ state: initialState(rule), rule, names: ["A", "B", "C", "D"], seat: 1, onConfirm: (ev) => events.push(ev) });
  assert.equal(stepTitle(box), "ツモ／ロン");
  // まだ選んでいない画面では既定値を塗らない
  const onChips = () => box.findAll((e) => e.tag === "button" && e.closest(".wz-grid") && / on/.test(e.className));
  assert.equal(onChips().length, 0);
  pickStep(box, "ツモ");
  assert.equal(stepTitle(box), "翻");
  assert.equal(onChips().length, 0);
  pickStep(box, "3");
  assert.equal(stepTitle(box), "符");
  pickStep(box, "40");
  assert.equal(stepTitle(box), "チップ（枚）");
  pickStep(box, "2");
  assert.equal(stepTitle(box), "確認");
  assert.match(box.textContent, /チップ2枚/);
  button(box, "確定").handlers.click();
  assert.deepEqual(events[0].winners[0], { who: 1, han: 3, fu: 40, yakumanCount: 0, sekinin: null, chips: 2 });
  assert.equal(events[0].tsumo, true);

  // チップを使わないルールではチップの画面を通らない。満貫以上は符を飛ばす
  const plain = openAgariSheet({ state: initialState(makeRule()), rule: makeRule(), names: ["A", "B", "C", "D"], seat: 1, onConfirm: () => {} });
  pickStep(plain.box, "ロン");
  assert.equal(stepTitle(plain.box), "放銃者");
  pickStep(plain.box, "西 C");
  pickStep(plain.box, "満貫");
  assert.equal(stepTitle(plain.box), "確認");
  assert.ok(!plain.box.textContent.includes("チップ"));

  // 関西式は符を使わないので、翻のあとは確認
  const kansai = makeRule({ playerCount: 3, length: 6, uma: [30, -10, -20], sanmaScoring: "kansai" });
  const k = openAgariSheet({ state: initialState(kansai), rule: kansai, names: ["A", "B", "C"], seat: 1, onConfirm: () => {} });
  pickStep(k.box, "ツモ");
  pickStep(k.box, "2");
  assert.equal(stepTitle(k.box), "確認");
  assert.equal(confirmItem(k.box, "符"), undefined);
});

test("和了入力: 役満は符の代わりに 数 → 包 → 責任分。「戻る」で1つ前の画面に戻る", (t) => {
  mockDom(t);
  const events = [];
  const rule = makeRule();
  const { box } = openAgariSheet({ state: initialState(rule), rule, names: ["A", "B", "C", "D"], seat: 1, onConfirm: (ev) => events.push(ev) });
  pickStep(box, "ロン");
  pickStep(box, "西 C");
  pickStep(box, "3");
  assert.equal(stepTitle(box), "符");
  button(box, "戻る").handlers.click();
  assert.equal(stepTitle(box), "翻");
  pickStep(box, "役満");
  assert.equal(stepTitle(box), "役満の数");
  pickStep(box, "ダブル役満");
  assert.equal(stepTitle(box), "包（責任払い）");
  pickStep(box, "北 D");
  assert.equal(stepTitle(box), "責任分");
  pickStep(box, "1個分");
  assert.equal(stepTitle(box), "確認");
  button(box, "確定").handlers.click();
  assert.deepEqual(events[0].winners[0], { who: 1, han: 0, fu: 0, yakumanCount: 2, sekinin: { who: 3, yakumanCount: 1 }, chips: 0 });
});

test("特殊終局: 流し満貫をオフにすると入口から消える", (t) => {
  mockDom(t);
  const on = openSpecialMenu({ rule: makeRule(), onPick: () => {} });
  assert.ok(button(on.box, "流し満貫成立者に満貫"));
  const off = openSpecialMenu({ rule: makeRule({ nagashiMangan: false }), onPick: () => {} });
  assert.equal(button(off.box, "流し満貫成立者に満貫"), undefined);
});

test("手動修正: チップの枚数を補正すると kind \"chips\" で差分を渡す", (t) => {
  mockDom(t);
  const changes = [];
  const rule = makeRule({ chips: true });
  const state = { ...initialState(rule), chips: [2, -1, -1, 0] };
  const { box } = openAdjustSheet({ state, rule, names: ["A", "B", "C", "D"], onAdjust: (...args) => changes.push(args) });
  box.find((el) => el.tag === "button" && el.textContent === "チップ").handlers.click();
  box.find((el) => el.tag === "button" && el.children[0] === "東 A +2枚").handlers.click();
  const input = box.querySelector(".points-input");
  input.handlers.input({ target: { value: "3" } });
  box.find((el) => el.tag === "button" && el.children[0] === "確定").handlers.click();
  assert.deepEqual(changes.at(-1), [0, 1, "chips"]);
  // 点数モードは従来どおり 2 引数
  const plain = openAdjustSheet({ state: initialState(makeRule()), rule: makeRule(), names: ["A", "B", "C", "D"], onAdjust: (...args) => changes.push(args) });
  assert.equal(plain.box.find((el) => el.tag === "button" && el.textContent === "チップ"), undefined);
});

test("対局画面: チップの収支を名前の行に出す（0 は出さない）", (t) => {
  mockDom(t);
  const rule = makeRule({ chips: true });
  const state = { ...initialState(rule), chips: [3, 0, -2, -1] };
  const game = { rule, events: [], startedAt: "2026-09-06T00:00:00Z", bottomSeat: 0 };
  const root = renderTable({ game, state, names: ["A", "B", "C", "D"], actions: {}, diffSeat: null });
  const tagOf = (seat) => root.find((el) => el.dataset.seat === String(seat)).querySelector(".chipcount");
  assert.equal(tagOf(0).textContent, "+3枚");
  assert.equal(tagOf(1), undefined);
  assert.equal(tagOf(2).textContent, "−2枚");
});

// ---- ログからの編集（§8.4） ---------------------------------------------------

import { openMultiRonSheet, openEventEditor } from "../src/ui/sheets.js";

test("和了の編集: 確認画面から開き、和了者を変えられ、放銃者と重なったら入れ替える。通常の和了入力には出さない", (t) => {
  mockDom(t);
  const rule = makeRule();
  const names = ["A", "B", "C", "D"];
  const events = [];
  const initial = { t: "agari", tsumo: false, from: 2, winners: [{ who: 1, han: 3, fu: 40, yakumanCount: 0, sekinin: null, chips: 0 }] };
  const { box } = openEventEditor({ event: initial, state: initialState(rule), rule, names, onConfirm: (ev) => events.push(ev) });
  assert.equal(stepTitle(box), "確認");
  const who = confirmItem(box, "和了者");
  assert.ok(who, "和了者の項目がない");
  who.handlers.click();
  pickStep(box, "西 C");
  // 選び直したら確認へ戻る
  assert.equal(stepTitle(box), "確認");
  button(box, "確定").handlers.click();
  assert.equal(events[0].winners[0].who, 2);
  assert.equal(events[0].from, 1);
  assert.equal(events[0].winners[0].han, 3);
  assert.equal(events[0].winners[0].fu, 40);

  const plain = openAgariSheet({ state: initialState(rule), rule, names, seat: 1, onConfirm: () => {} });
  pickStep(plain.box, "ツモ");
  pickStep(plain.box, "1");
  pickStep(plain.box, "30");
  assert.equal(confirmItem(plain.box, "和了者"), undefined);
});

test("複数和了: 和了者が1人では確定できず、2人以上で確定できる", (t) => {
  mockDom(t);
  const rule = makeRule();
  const names = ["A", "B", "C", "D"];
  const events = [];
  const { box } = openMultiRonSheet({ state: initialState(rule), rule, names, onConfirm: (ev) => events.push(ev) });
  box.find((el) => el.matches(".grid2")).find((el) => el.tag === "button" && el.textContent === "東 A").handlers.click();
  box.find((el) => el.tag === "button" && el.matches(".wide") && el.textContent.startsWith("南 B")).handlers.click();
  assert.equal(button(box, "確定").disabled, true);
  assert.match(box.textContent, /2人以上/);
  box.find((el) => el.tag === "button" && el.matches(".wide") && el.textContent.startsWith("西 C")).handlers.click();
  assert.equal(button(box, "確定").disabled, false);
  button(box, "確定").handlers.click();
  assert.deepEqual(events[0].winners.map((w) => w.who), [1, 2]);
});

test("途中流局は古い rule に abortiveRyuukyoku が残っていても全種別を出す", (t) => {
  mockDom(t);
  const rule = { ...makeRule(), abortiveRyuukyoku: ["kyuushu"] };
  const { box } = openAbortiveSheet({ state: initialState(rule), rule, names: ["A", "B", "C", "D"], onConfirm: () => {}, initial: { abortiveKind: "suufon" } });
  const labels = box.findAll((el) => el.tag === "button" && (el.className || "").includes("chip")).map((el) => el.textContent);
  assert.deepEqual(labels, ["九種九牌", "四風連打", "四家立直", "四開槓", "三家和"]);
});

test("和了入力はありえない符を選べず、確認画面からロンに変えると放銃者を聞き、20符を 30符に寄せる", (t) => {
  mockDom(t);
  const rule = makeRule();
  const confirmed = [];
  const { box } = openAgariSheet({ state: initialState(rule), rule, names: ["A", "B", "C", "D"], seat: 1, onConfirm: (ev) => confirmed.push(ev) });
  const fu = (label) => box.find((e) => e.tag === "button" && e.closest(".wz-grid") && e.textContent === label);
  pickStep(box, "ツモ");
  pickStep(box, "1");
  // ツモ・1翻: 20符と 25符は選べない
  assert.equal(fu("20").disabled, true);
  assert.equal(fu("25").disabled, true);
  button(box, "戻る").handlers.click();
  pickStep(box, "2");
  assert.equal(fu("20").disabled, false);
  pickStep(box, "20");
  assert.equal(stepTitle(box), "確認");
  // 確認画面から ツモ／ロン を直す → 放銃者の画面を通って確認へ。20符のロンはありえないので 30符になる
  confirmItem(box, "ツモ／ロン").handlers.click();
  pickStep(box, "ロン");
  assert.equal(stepTitle(box), "放銃者");
  pickStep(box, "西 C");
  assert.equal(stepTitle(box), "確認");
  assert.equal(confirmItem(box, "符").children[1].textContent, "30符");
  button(box, "確定").handlers.click();
  assert.equal(confirmed.at(-1).winners[0].fu, 30);
  assert.equal(confirmed.at(-1).from, 2);
});

test("レートの変更は 0 以上の数だけ確定でき、今と同じ値では確定しない", async (t) => {
  mockDom(t);
  const { openRateSheet } = await import("../src/ui/sheets.js");
  const picked = [];
  const { box } = openRateSheet({ rate: 50, onConfirm: (v) => picked.push(v) });
  const input = box.querySelector(".points-input");
  const confirm = button(box, "確定");
  assert.equal(confirm.disabled, true);
  for (const value of ["", "abc", "-10", "50"]) {
    input.handlers.input({ target: { value } });
    assert.equal(confirm.disabled, true, JSON.stringify(value));
  }
  for (const [value, rate] of [["100", 100], ["0", 0], [" 2.5 ", 2.5]]) {
    input.handlers.input({ target: { value } });
    assert.equal(confirm.disabled, false, value);
    confirm.handlers.click();
    assert.equal(picked.at(-1), rate);
  }
});
