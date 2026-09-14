// 設定タブ（docs/design.md §7, §8.9）。人数ごとのプリセットを選んで編集する。
//
// 選択は対局タブと共有する（mj.prefs.selected）。項目の変更はそのプリセットに直接保存し、
// ウマだけは全順位をまとめて保存する。親の項目がオフのとき意味を持たない下位項目は無効にして残す。

import { h, clear, append } from "./dom.js";
import { validateRule, normalizeRule } from "../rules.js";

/**
 * props: {
 *   rulesFor(pc) → Rule（選んでいるプリセットのルール）, isCustom(pc) → bool（標準と違うか）,
 *   presetsFor(pc) → [{ id, name, rule }], selectedId(pc) → id,
 *   onSelect(pc, id), onRename(pc, id, name), onCreate(pc) → preset, onDuplicate(pc) → preset, onDelete(pc, id) → bool,
 *   onChange(pc, rule|null)（null は標準に戻す）, initialPc, version
 * }
 */
export function renderSettings(props) {
  const root = h("div", { class: "plain-screen settings-screen" });
  let pc = props.initialPc || 4;
  const copy = (r) => JSON.parse(JSON.stringify(r));
  let rule = copy(normalizeRule(props.rulesFor(pc)));
  let umaDraft = rule.uma.map(String);
  const msg = h("div", { class: "hint", hidden: true });
  const presets = () => (props.presetsFor ? props.presetsFor(pc) : []);
  const selectedId = () => (props.selectedId ? props.selectedId(pc) : null);

  function setMsg(text, error = false) {
    msg.textContent = text;
    msg.className = `hint${error ? " error" : ""}`;
    msg.hidden = !text;
  }

  /** 選んでいるプリセットを読み直す */
  function reload() {
    rule = copy(normalizeRule(props.rulesFor(pc)));
    umaDraft = rule.uma.map(String);
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

  /** プリセットの選択と管理（§8.9） */
  function presetSection() {
    const list = presets();
    const current = list.find((x) => x.id === selectedId()) || list[0] || null;
    const picker = h(
      "select",
      {
        "aria-label": "プリセット",
        onchange: (e) => {
          if (props.onSelect) props.onSelect(pc, e.target.value);
          reload();
          setMsg("");
          render();
        },
      },
      list.map((x) => h("option", { value: x.id, selected: current && x.id === current.id }, x.name)),
    );
    const nameInput = h("input", {
      type: "text", value: current ? current.name : "", placeholder: "名前", autocomplete: "off", enterkeyhint: "done", "aria-label": "プリセットの名前",
      onchange: (e) => {
        const name = e.target.value.trim();
        if (!current || !name) {
          render();
          return;
        }
        if (props.onRename) props.onRename(pc, current.id, name);
        setMsg("");
        render();
      },
    });
    const action = (label, cls, fn, disabled = false) => h("button", { type: "button", class: cls, disabled, onclick: fn }, label);
    return h("section", { class: "card" },
      h("h2", null, "プリセット"),
      h("div", { class: "row preset-pick" }, h("span", null, "選択"), picker),
      h("div", { class: "row preset-name" }, h("span", null, "名前"), nameInput),
      h(
        "div",
        { class: "sheet-actions three" },
        action("新規作成", "btn-secondary", () => {
          if (!props.onCreate) return;
          const created = props.onCreate(pc);
          reload();
          setMsg(created ? `「${created.name}」を作りました（${pc}人の標準から）。` : "");
          render();
        }),
        action("複製", "btn-secondary", () => {
          if (!props.onDuplicate) return;
          const created = props.onDuplicate(pc);
          reload();
          setMsg(created ? `「${created.name}」を作りました。` : "");
          render();
        }, !current),
        action("削除", "btn-secondary danger", () => {
          if (!props.onDelete || !current) return;
          const ok = props.onDelete(pc, current.id);
          reload();
          setMsg(ok ? `「${current.name}」を削除しました。` : "最後の 1つは削除できません。", !ok);
          render();
        }, !current || list.length <= 1),
      ),
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
                reload();
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
                reload();
                setMsg(`このプリセットを${n}人麻雀の標準に戻しました。`);
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
