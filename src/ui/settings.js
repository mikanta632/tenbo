// 設定タブ（docs/design.md §7, §8.9）。新しい対局に使うルールを 4人／3人それぞれ編集する。
//
// ウマは全順位をまとめて保存し、その他の変更はその場で保存する（mj.prefs.rules）。
// 仕様が決まっていない項目（西入・チップ・同点の扱い）は表示だけして無効にする。

import { h, clear } from "./dom.js";
import { validateRule } from "../rules.js";

/**
 * props: { presets, rulesFor(pc) → Rule, isCustom(pc) → bool, onChange(pc, rule|null), version }
 */
export function renderSettings(props) {
  const root = h("div", { class: "plain-screen settings-screen" });
  let pc = props.initialPc || 4;
  const copy = (r) => JSON.parse(JSON.stringify(r));
  let rule = copy(props.rulesFor(pc));
  let umaDraft = rule.uma.map(String);
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
      h("div", { class: "label" }, "ウマ"),
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

  function render() {
    clear(root);
    const n = pc;

    const numInput = (key, { step = 1000, min = null } = {}) =>
      h("input", {
        type: "number",
        inputmode: "numeric",
        step: String(step),
        min: min === null ? false : String(min),
        value: String(rule[key]),
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

    root.append(
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
                rule = copy(props.rulesFor(pc));
                umaDraft = rule.uma.map(String);
                setMsg("");
                render();
              },
            },
            `${k}人麻雀`,
          ),
        ),
      ),
      h("div", { class: "hint" }, `${n}人麻雀${props.isCustom(pc) ? "（標準から変更あり）" : "の標準ルール"}。ウマは「ウマを保存」、その他は変更時に保存され、次の対局から使われます。`),
      msg,
    );

    // ---- 対局進行 ----
    root.append(
      section(
        "対局進行",
        row("対局の長さ", selectInput("length", [[n * 2, "半荘（東南）"], [n, "東風（東場のみ）"]], { parse: Number })),
        row("西入", boolInput("nishiIri", { disabled: true }), "未実装"),
        row("トビ終了", boolInput("tobi")),
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
      ),
    );

    // ---- 結果関連 ----
    root.append(
      section(
        "結果関連",
        umaEditor(),
        row("端数処理", selectInput("ptRounding", [["round5", "五捨六入"], ["none", "小数のまま"]])),
        row("同点の扱い", selectInput("tieBreak", [["chiicha", "起家に近い方が上位"]], { disabled: true }), "これのみ"),
      ),
    );

    // ---- 賭け関連 ----
    root.append(
      section(
        "賭け関連",
        row("レート（円/pt）", numInput("rate", { step: 10, min: 0 })),
        row("チップ", h("input", { type: "number", value: "0", disabled: true }), "未実装"),
      ),
    );

    // ---- その他のルール ----
    root.append(
      section(
        "その他のルール",
        row("箱下リーチ", boolInput("riichiUnderThousand"), "1000点未満でもリーチ可"),
        row("親の和了やめ", boolInput("agariYame"), "オーラスでトップなら選べる"),
        row("終局時の供託", selectInput("finalKyotaku", [["top", "トップが受け取る"], ["remain", "誰も受け取らない"]]), "リーチ棒の受け取り者"),
        row("連荘", selectInput("renchan", [["tenpai", "テンパイ連荘"], ["agari", "和了連荘"]])),
        row("切り上げ満貫", boolInput("kiriageMangan")),
        row("数え役満", selectInput("kazoeYakuman", [["yakuman", "役満"], ["sanbaiman", "三倍満"]])),
        row("ダブル役満", boolInput("doubleYakuman")),
        row("複数和了", boolInput("multiRon")),
        row("責任払い", boolInput("sekinin")),
      ),
    );

    // ---- 標準に戻す ----
    root.append(
      section(
        "リセット",
        h("div", { class: "hint" }, `${n}人麻雀のルールをプリセットの値に戻します。`),
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
                rule = copy(props.rulesFor(pc));
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
