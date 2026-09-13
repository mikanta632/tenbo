// 設定タブ（docs/design.md §7, §8.9）。新しい対局に使うルールを 4人／3人それぞれ編集する。
//
// ウマは全順位をまとめて保存し、その他の変更はその場で保存する（mj.prefs.rules）。
// 親の項目がオフのとき意味を持たない下位項目（責任払いのロン時の負担など）は無効にして残す。
// 名前付きプリセット（mj.prefs.presets）と組み込みのプリセットは同じ一覧から読み込む。

import { h, clear, append } from "./dom.js";
import { validateRule, normalizeRule, PRESETS } from "../rules.js";

/**
 * props: {
 *   presets, userPresets: [{ id, name, rule }], rulesFor(pc) → Rule, isCustom(pc) → bool,
 *   onChange(pc, rule|null), onSavePreset(name, rule) → 新しい一覧, onDeletePreset(id) → 新しい一覧,
 *   initialPc, version
 * }
 */
export function renderSettings(props) {
  const root = h("div", { class: "plain-screen settings-screen" });
  let pc = props.initialPc || 4;
  const copy = (r) => JSON.parse(JSON.stringify(r));
  const builtin = props.presets || PRESETS;
  let userPresets = props.userPresets || [];
  let rule = copy(normalizeRule(props.rulesFor(pc)));
  let umaDraft = rule.uma.map(String);
  let presetName = "";
  const msg = h("div", { class: "hint", hidden: true });

  function setMsg(text, error = false) {
    msg.textContent = text;
    msg.className = `hint${error ? " error" : ""}`;
    msg.hidden = !text;
  }

  /** ルールを保存して再描画 */
  function commit() {
    const errs = validateRule(rule);
    if (errs.length) {
      setMsg("不正: " + errs.join(" / "), true);
      render();
      return;
    }
    props.onChange(pc, copy(rule));
    setMsg("");
    render();
  }

  /** プリセットのルールをその人数のカスタムルールとして反映する */
  function loadRule(name, source) {
    rule = copy(normalizeRule(source));
    pc = rule.playerCount;
    umaDraft = rule.uma.map(String);
    props.onChange(pc, copy(rule));
    setMsg(`「${name}」を読み込みました。`);
    render();
  }

  function umaEditor() {
    const status = h("div", { class: "hint", "aria-live": "polite" });
    const values = () => umaDraft.map((value) => value.trim() === "" ? NaN : Number(value));
    const save = h("button", {
      type: "button", class: "btn-primary", onclick: () => {
        const candidate = { ...rule, uma: values() };
        const errors = validateRule(candidate);
        if (errors.length) {
          status.textContent = errors.join(" / ");
          return;
        }
        rule = candidate;
        umaDraft = rule.uma.map(String);
        commit();
      },
    }, "ウマを保存");
    const reset = h("button", {
      type: "button", class: "btn-secondary", onclick: () => {
        umaDraft = rule.uma.map(String);
        render();
      },
    }, "変更を戻す");
    const update = () => {
      const parsed = values();
      const valid = parsed.every(Number.isFinite);
      const total = valid ? parsed.reduce((a, b) => a + b, 0) : null;
      const dirty = umaDraft.some((v, i) => v !== String(rule.uma[i]));
      const sum = total === null ? "全順位に数値を入力してください" : `合計：${total > 0 ? "+" : ""}${total}${total === 0 ? "" : "（0にしてください）"}`;
      status.textContent = `${sum} ・ ${dirty ? "未保存" : "保存済み"}`;
      save.disabled = !dirty || total !== 0;
      reset.disabled = !dirty;
    };
    const editor = h("div", { class: "uma-editor" },
      h("div", { class: "uma-row" }, umaDraft.map((value, i) => h("label", null, `${i + 1}位`, h("input", {
        type: "number", step: "any", inputmode: "decimal", value, "aria-label": `${i + 1}位のウマ`,
        oninput: (e) => { umaDraft[i] = e.target.value; update(); },
      })))),
      status,
      h("div", { class: "sheet-actions two" }, reset, save),
    );
    update();
    return editor;
  }

  function presetSection() {
    const rows = [];
    for (const [name, r] of Object.entries(builtin)) {
      rows.push(
        h("div", { class: "row preset-row" },
          h("span", null, name),
          h("span", { class: "row-note" }, `${r.playerCount}人`),
          h("button", { type: "button", class: "btn-secondary", onclick: () => loadRule(name, r) }, "読み込む"),
        ),
      );
    }
    for (const p of userPresets) {
      rows.push(
        h("div", { class: "row preset-row" },
          h("span", null, p.name),
          h("span", { class: "row-note" }, `${p.rule && p.rule.playerCount === 3 ? 3 : 4}人`),
          h("button", { type: "button", class: "btn-secondary", onclick: () => loadRule(p.name, p.rule) }, "読み込む"),
          h("button", {
            type: "button", class: "btn-flat danger", onclick: () => {
              if (props.onDeletePreset) userPresets = props.onDeletePreset(p.id) || userPresets.filter((x) => x.id !== p.id);
              setMsg(`「${p.name}」を削除しました。`);
              render();
            },
          }, "削除"),
        ),
      );
    }
    const nameInput = h("input", {
      type: "text", value: presetName, placeholder: "プリセットの名前", autocomplete: "off", enterkeyhint: "done",
      oninput: (e) => { presetName = e.target.value; saveBtn.disabled = presetName.trim() === ""; },
    });
    const saveBtn = h("button", {
      type: "button", class: "btn-primary", disabled: presetName.trim() === "", onclick: () => {
        const name = presetName.trim();
        if (!name) return;
        if (props.onSavePreset) userPresets = props.onSavePreset(name, copy(rule)) || userPresets;
        presetName = "";
        setMsg(`「${name}」として保存しました。`);
        render();
      },
    }, "今の設定を保存");
    return h("section", { class: "card" },
      h("h2", null, "プリセット"),
      rows,
      h("div", { class: "row preset-save" }, nameInput, saveBtn),
    );
  }

  function render() {
    clear(root);
    const n = pc;

    const numInput = (key, { step = 1000, min = null, disabled = false } = {}) =>
      h("input", {
        type: "number",
        inputmode: "numeric",
        step: String(step),
        min: min === null ? false : String(min),
        value: String(rule[key]),
        disabled,
        onchange: (e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) rule[key] = v;
          commit();
        },
      });
    const boolInput = (key, { disabled = false } = {}) =>
      h("input", {
        type: "checkbox",
        checked: !!rule[key],
        disabled,
        onchange: (e) => {
          rule[key] = e.target.checked;
          commit();
        },
      });
    const selectInput = (key, options, { disabled = false, parse = (v) => v } = {}) =>
      h(
        "select",
        {
          disabled,
          onchange: (e) => {
            rule[key] = parse(e.target.value);
            commit();
          },
        },
        options.map(([v, label]) => h("option", { value: String(v), selected: String(rule[key]) === String(v) }, label)),
      );
    const row = (label, control, note = null) =>
      h("label", { class: "row" }, h("span", null, label), control, note ? h("span", { class: "row-note" }, note) : null);
    const section = (title, ...rows) => h("section", { class: "card" }, h("h2", null, title), ...rows);

    append(
      root,
      h("header", { class: "plain-top" }, h("div", { class: "plain-title" }, "設定")),
      h(
        "div",
        { class: "choice big segmented" },
        [4, 3].map((k) =>
          h(
            "button",
            {
              type: "button",
              class: `chip${pc === k ? " on" : ""}`,
              onclick: () => {
                pc = k;
                rule = copy(normalizeRule(props.rulesFor(pc)));
                umaDraft = rule.uma.map(String);
                setMsg("");
                render();
              },
            },
            `${k}人麻雀`,
          ),
        ),
      ),
      props.isCustom(pc) ? h("div", { class: "hint" }, "標準から変更あり") : null,
      msg,
    );

    // ---- プリセット ----
    root.append(presetSection());

    // ---- 対局進行 ----
    const tonpuu = rule.length === n;
    root.append(
      section(
        "対局進行",
        row("対局の長さ", selectInput("length", [[n * 2, "半荘（東南）"], [n, "東風（東場のみ）"]], { parse: Number })),
        row(tonpuu ? "南入" : "西入", boolInput("extension"), "延長戦"),
        row("トビ終了", boolInput("tobi")),
        row("トビの基準", selectInput("tobiLine", [[0, "0点未満で終了"], [1, "0点以下で終了"]], { parse: Number, disabled: !rule.tobi })),
        row("連荘", selectInput("renchan", [["tenpai", "テンパイ連荘"], ["agari", "和了連荘"]])),
        row("親の和了やめ", boolInput("agariYame"), "オーラスでトップなら選べる"),
        row("流し満貫", boolInput("nagashiMangan")),
        row("終局時の供託", selectInput("finalKyotaku", [["top", "トップが受け取る"], ["remain", "誰も受け取らない"]]), "リーチ棒の受け取り者"),
      ),
    );

    // ---- 点数 ----
    root.append(
      section(
        "点数",
        row("最初の持ち点", numInput("startPoints")),
        row("返す点", numInput("returnPoints")),
        row("ノーテン罰符の総点", numInput("ryuukyokuTenpaiTotal", { min: 0 })),
        row(
          "本場（1本場あたり）",
          selectInput(
            "honbaPoints",
            [
              [0, "なし（0点）"],
              [300, "300点（ツモは各100）"],
              [600, "600点（ツモは各200）"],
              [1500, "1500点（ツモは各500）"],
            ],
            { parse: Number },
          ),
        ),
        row("箱下リーチ", boolInput("riichiUnderThousand"), "1000点未満でもリーチ可"),
        row("切り上げ満貫", boolInput("kiriageMangan")),
        row("数え役満", selectInput("kazoeYakuman", [["yakuman", "役満"], ["sanbaiman", "三倍満"]])),
        row("ダブル役満", boolInput("doubleYakuman")),
        row("責任払い", boolInput("sekinin")),
        row("ロン時の負担", selectInput("sekininRon", [["half", "責任者と放銃者で折半"], ["full", "責任者が全額"]], { disabled: !rule.sekinin })),
        row("複数和了", boolInput("multiRon"), "オフなら頭ハネ"),
        row("供託の帰属", selectInput("multiRonKyotaku", [["shimocha", "下家取り"], ["split", "和了者で等分"]], { disabled: !rule.multiRon })),
        row("本場の帰属", selectInput("multiRonHonba", [["shimocha", "下家取り"], ["each", "各和了者に"]], { disabled: !rule.multiRon })),
        row("チョンボ", selectInput("chomboRule", [["mangan", "満貫払い"], ["fixed", "定額"]])),
        row("定額の点", numInput("chomboPoints", { min: 0, disabled: rule.chomboRule !== "fixed" }), "他の各人に"),
        row("喰いタン", boolInput("kuitan"), "記録のみ"),
        row("赤ドラ", numInput("akaDora", { step: 1, min: 0 }), "記録のみ"),
      ),
    );

    // ---- 3人麻雀 ----
    if (n === 3) {
      root.append(
        section(
          "3人麻雀",
          row("点数方式", selectInput("sanmaScoring", [["standard", "ツモ損あり"], ["noTsumoLoss", "ツモ損なし"], ["kansai", "関西式（符なし）"]])),
        ),
      );
    }

    // ---- ウマ ----
    root.append(
      section(
        "ウマ",
        umaEditor(),
        row("端数処理", selectInput("ptRounding", [["round5", "五捨六入"], ["none", "小数のまま"]])),
        row("同点の扱い", selectInput("tieBreak", [["chiicha", "起家に近い方が上位"], ["split", "同点者で等分"]])),
      ),
    );

    // ---- 賭け関連 ----
    const chipsOff = !rule.chips;
    root.append(
      section(
        "賭け関連",
        row("レート（円/pt）", numInput("rate", { step: 10, min: 0 })),
        row("チップ", boolInput("chips"), "枚数で数える"),
        row("チップ単価（円/枚）", numInput("chipRate", { step: 100, min: 0, disabled: chipsOff })),
        row("トビ賞（枚）", numInput("tobiPrize", { step: 1, min: 0, disabled: chipsOff }), "飛んだ人が和了者に"),
        row("焼き鳥（枚）", numInput("yakitori", { step: 1, min: 0, disabled: chipsOff }), "和了ゼロの人が各人に"),
        row("焼き鳥で流し満貫を和了に数える", boolInput("yakitoriNagashi", { disabled: chipsOff || !(rule.yakitori > 0) })),
      ),
    );

    // ---- 標準に戻す ----
    root.append(
      section(
        "リセット",
        h(
          "div",
          { class: "sheet-actions" },
          h(
            "button",
            {
              type: "button",
              class: "btn-secondary",
              disabled: !props.isCustom(pc),
              onclick: () => {
                props.onChange(pc, null);
                rule = copy(normalizeRule(props.rulesFor(pc)));
                umaDraft = rule.uma.map(String);
                setMsg(`${n}人麻雀を標準に戻しました。`);
                render();
              },
            },
            "標準に戻す",
          ),
        ),
      ),
      h("div", { class: "hint" }, `バージョン ${props.version}`),
    );
  }

  render();
  return root;
}
