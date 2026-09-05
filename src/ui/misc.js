// その他タブ（docs/design.md §8.1）。効果音、バックアップ、アプリ情報。

import { h } from "./dom.js";

/**
 * props: { sound: { enabled }, version, gamesCount, onSound({enabled}), onTestSound, onExport, onImport(file) }
 */
export function renderMisc(props) {
  const s = props.sound;
  const fileInput = h("input", {
    type: "file",
    accept: "application/json,.json",
    class: "file-input",
    onchange: (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (f) props.onImport(f);
    },
  });

  return h(
    "div",
    { class: "plain-screen misc-screen" },
    h("header", { class: "plain-top" }, h("div", { class: "plain-title" }, "その他")),
    h(
      "section",
      { class: "card" },
      h("h2", null, "効果音"),
      h("label", { class: "row" }, h("span", null, "効果音"), h("input", { type: "checkbox", checked: s.enabled, onchange: (e) => props.onSound({ enabled: e.target.checked }) })),
      h("div", { class: "hint" }, "本体の消音スイッチが入っていると鳴りません。"),
      h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn-secondary", disabled: !s.enabled, onclick: props.onTestSound }, "試しに鳴らす")),
    ),
    h(
      "section",
      { class: "card" },
      h("h2", null, "バックアップ"),
      h("div", { class: "hint" }, `データは端末内だけにあります（終了した対局 ${props.gamesCount}件）。ホーム画面から削除すると消えるので、JSON を書き出して「ファイル」に残してください。復元は「インポート」で、今のデータをすべて置き換えます。`),
      h(
        "div",
        { class: "sheet-actions two" },
        h("button", { type: "button", class: "btn-secondary", onclick: props.onExport }, "エクスポート"),
        h("button", { type: "button", class: "btn-secondary", onclick: () => fileInput.click() }, "インポート"),
      ),
      fileInput,
    ),
    h(
      "section",
      { class: "card" },
      h("h2", null, "アプリ情報"),
      h("div", { class: "kv" }, h("span", null, "版"), h("b", null, props.version)),
      updateBlock(props),
    ),
  );
}

/** 「更新を確認」。onCheckUpdate(setStatus) を呼び、進み具合を文で出す */
function updateBlock(props) {
  const status = h("div", { class: "hint", "aria-live": "polite" }, "更新は通常、次にホーム画面から起動し直したときに反映されます。今すぐ確認するにはボタンを押してください。");
  const btn = h(
    "button",
    {
      type: "button",
      class: "btn-secondary",
      onclick: async () => {
        btn.disabled = true;
        try {
          await props.onCheckUpdate((text) => (status.textContent = text));
        } finally {
          btn.disabled = false;
        }
      },
    },
    "更新を確認",
  );
  return h("div", null, h("div", { class: "sheet-actions" }, btn), status);
}
