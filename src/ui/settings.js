// 設定画面（docs/design.md §7, §8.9）。効果音と、カスタムルールの編集。
//
// ルールはプリセットを土台に、頻繁に変える項目だけを入力欄で編集し、残りは JSON を直接編集する。
// 保存先は端末設定 mj.prefs.rules（プレイヤー数ごとに 1つ）。対局開始時に「4人カスタム」などとして選べる。

import { h, clear } from "./dom.js";
import { validateRule } from "../rules.js";

const RENCHAN = [
  ["tenpai", "テンパイ連荘"],
  ["agari", "和了連荘"],
];
const KAZOE = [
  ["yakuman", "役満"],
  ["sanbaiman", "三倍満"],
];
const FINAL_KYOTAKU = [
  ["top", "トップに加算"],
  ["remain", "場に残す"],
];
const ROUNDING = [
  ["round5", "五捨六入"],
  ["none", "小数のまま"],
];

/**
 * props: { presets, customRules, sound: { enabled, voice, voices }, version,
 *          onBack, onSound({enabled, voice}), onTestSound, onSaveRule(playerCount, rule|null) }
 */
export function renderSettings(props) {
  const root = h("div", { class: "plain-screen settings-screen" });
  const presetNames = Object.keys(props.presets);
  let baseName = presetNames[0];
  let rule = JSON.parse(JSON.stringify(props.customRules[String(props.presets[baseName].playerCount)] || props.presets[baseName]));
  const msg = h("div", { class: "hint error", hidden: true });

  function setMsg(text, error = true) {
    msg.textContent = text;
    msg.className = `hint${error ? " error" : ""}`;
    msg.hidden = !text;
  }

  function numInput(key, { step = 1000, min = null } = {}) {
    return h("input", {
      type: "number",
      inputmode: "numeric",
      step: String(step),
      min: min === null ? false : String(min),
      value: String(rule[key]),
      onchange: (e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) rule[key] = v;
        render();
      },
    });
  }
  function boolInput(key) {
    return h("input", {
      type: "checkbox",
      checked: !!rule[key],
      onchange: (e) => {
        rule[key] = e.target.checked;
        render();
      },
    });
  }
  function selectInput(key, options) {
    return h(
      "select",
      {
        onchange: (e) => {
          rule[key] = e.target.value;
          render();
        },
      },
      options.map(([v, label]) => h("option", { value: v, selected: rule[key] === v }, label)),
    );
  }
  const row = (label, control) => h("label", { class: "row" }, h("span", null, label), control);

  function render() {
    clear(root);
    const n = rule.playerCount;

    root.append(
      h("header", { class: "plain-top" }, h("button", { type: "button", class: "btn-flat", onclick: props.onBack }, "戻る"), h("div", { class: "plain-title" }, "設定")),
    );

    // ---- 効果音 ----
    const s = props.sound;
    const voiceSel = h(
      "select",
      { onchange: (e) => props.onSound({ enabled: s.enabled, voice: e.target.value }) },
      h("option", { value: "", selected: !s.voice }, "自動（端末の既定）"),
      s.voices.map((v) => h("option", { value: v.name, selected: v.name === s.voice }, `${v.name} (${v.lang})`)),
    );
    root.append(
      h(
        "section",
        { class: "card" },
        h("h2", null, "効果音"),
        row("効果音", h("input", { type: "checkbox", checked: s.enabled, onchange: (e) => props.onSound({ enabled: e.target.checked, voice: s.voice }) })),
        row("リーチの声", voiceSel),
        h("div", { class: "hint" }, s.voices.length ? "声は端末に入っている日本語音声から選びます。" : "この端末では日本語の音声合成が見つかりません。チャイムだけ鳴ります。"),
        h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn-secondary", disabled: !s.enabled, onclick: props.onTestSound }, "試しに鳴らす")),
      ),
    );

    // ---- ルール ----
    const baseSel = h(
      "select",
      {
        onchange: (e) => {
          baseName = e.target.value;
          const pc = props.presets[baseName].playerCount;
          rule = JSON.parse(JSON.stringify(props.customRules[String(pc)] || props.presets[baseName]));
          setMsg("");
          render();
        },
      },
      presetNames.map((k) => h("option", { value: k, selected: k === baseName }, k)),
    );
    const umaInputs = h(
      "div",
      { class: "uma-row" },
      rule.uma.map((u, i) =>
        h("input", {
          type: "number",
          inputmode: "numeric",
          value: String(u),
          onchange: (e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) rule.uma[i] = v;
            render();
          },
        }),
      ),
    );
    const jsonArea = h("textarea", { rows: "10", spellcheck: "false" }, JSON.stringify(rule, null, 2));
    const errors = validateRule(rule);

    root.append(
      h(
        "section",
        { class: "card" },
        h("h2", null, `ルール（${n}人カスタム）`),
        row("土台", baseSel),
        h("div", { class: "hint" }, props.customRules[String(n)] ? `保存済みの ${n}人カスタムを編集しています。` : `${baseName} を土台に編集します。保存すると「${n}人カスタム」として選べます。`),
        row("持ち点", numInput("startPoints")),
        row("返し", numInput("returnPoints")),
        row("ウマ", umaInputs),
        row("レート（円/pt）", numInput("rate", { step: 10, min: 0 })),
        row("pt の丸め", selectInput("ptRounding", ROUNDING)),
        row("連荘", selectInput("renchan", RENCHAN)),
        row("アガリやめ", boolInput("agariYame")),
        row("トビ", boolInput("tobi")),
        row("トビ線", numInput("tobiLine", { step: 100 })),
        row("切り上げ満貫", boolInput("kiriageMangan")),
        row("数え役満", selectInput("kazoeYakuman", KAZOE)),
        row("ダブル役満", boolInput("doubleYakuman")),
        row("複数和了", boolInput("multiRon")),
        row("責任払い", boolInput("sekinin")),
        row("流し満貫", boolInput("nagashiMangan")),
        row("残り供託", selectInput("finalKyotaku", FINAL_KYOTAKU)),
        row("ノーテン罰符 合計", numInput("ryuukyokuTenpaiTotal", { step: 1000, min: 0 })),
        h("div", { class: "label" }, "JSON（全項目。直接編集して「JSON を反映」）"),
        jsonArea,
        h(
          "div",
          { class: "sheet-actions two" },
          h(
            "button",
            {
              type: "button",
              class: "btn-secondary",
              onclick: () => {
                try {
                  const parsed = JSON.parse(jsonArea.value);
                  const errs = validateRule(parsed);
                  if (errs.length) {
                    setMsg("不正: " + errs.join(" / "));
                    return;
                  }
                  rule = parsed;
                  setMsg("JSON を反映しました。保存を押すと残ります。", false);
                  render();
                } catch (e) {
                  setMsg("JSON として読めません: " + e.message);
                }
              },
            },
            "JSON を反映",
          ),
          h(
            "button",
            {
              type: "button",
              class: "btn-primary",
              disabled: errors.length > 0,
              onclick: () => {
                props.onSaveRule(n, rule);
                setMsg(`${n}人カスタムとして保存しました。対局開始のルールで選べます。`, false);
                render();
              },
            },
            "保存",
          ),
        ),
        errors.length ? h("div", { class: "hint error" }, errors.join(" / ")) : null,
        msg,
        props.customRules[String(n)]
          ? h(
              "div",
              { class: "sheet-actions" },
              h(
                "button",
                {
                  type: "button",
                  class: "btn-secondary",
                  onclick: () => {
                    props.onSaveRule(n, null);
                    rule = JSON.parse(JSON.stringify(props.presets[baseName]));
                    setMsg(`${n}人カスタムを削除しました。`, false);
                    render();
                  },
                },
                `${n}人カスタムを削除`,
              ),
            )
          : null,
      ),
    );

    root.append(h("div", { class: "hint" }, `版 ${props.version}`));
  }

  render();
  return root;
}
