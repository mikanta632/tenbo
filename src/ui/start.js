// 開始画面（docs/design.md §8.1）。プレイヤー選択、ルールプリセット選択、対局開始／再開。

import { h, clear } from "./dom.js";
import { validateRule } from "../rules.js";
import { reduce } from "../reduce.js";
import { kyokuName, gameId } from "./format.js";

// 画面位置の順。bottom から反時計回り（bottom の下家が right）。
const POSITIONS = [
  { key: "bottom", label: "下（自分）" },
  { key: "right", label: "右（下家）" },
  { key: "top", label: "上（対面）" },
  { key: "left", label: "左（上家）" },
];

/**
 * 画面位置ごとの playerId と起家の位置から Game を作る。
 * seats は起家順。bottomSeat は自家（画面下）の seatIndex。
 */
export function buildGame({ rule, posPlayers, chiichaPos, now = new Date() }) {
  const n = rule.playerCount;
  const seats = [];
  for (let i = 0; i < n; i++) seats.push(posPlayers[(chiichaPos + i) % n]);
  return {
    id: gameId(now),
    startedAt: now.toISOString(),
    endedAt: null,
    rule: JSON.parse(JSON.stringify(rule)),
    seats,
    bottomSeat: (n - chiichaPos) % n,
    events: [],
    settlement: null,
  };
}

/**
 * 開始画面を描画する。
 * props: { storage, current, presets, version, onResume(), onStart(game), onDiscard() }
 */
export function renderStart(props) {
  const { storage, current, presets, version } = props;
  const root = h("div", { class: "start-screen" });

  // 段階2は 4人麻雀のみ
  const presetNames = Object.keys(presets).filter((k) => presets[k].playerCount === 4);
  let presetName = presetNames[0];

  // 前回の席順を初期値にする
  const last = current || storage.loadGames()[0] || null;
  const posPlayers = [null, null, null, null];
  let chiichaPos = 0;
  if (last && last.seats && last.seats.length === 4) {
    const b = last.bottomSeat ?? 0;
    for (let k = 0; k < 4; k++) posPlayers[k] = last.seats[(b + k) % 4];
    chiichaPos = (4 - b) % 4;
  }

  const message = h("div", { class: "hint error", hidden: true });

  function render() {
    clear(root);
    const roster = storage.loadRoster();

    root.append(h("h1", null, "麻雀 点数表示器", h("span", { class: "ver" }, ` v${version}`)));

    if (current) {
      const st = reduce(current.events, current.rule);
      const names = current.seats.map((id) => (roster.find((p) => p.id === id) || { name: "?" }).name);
      root.append(
        h(
          "section",
          { class: "card" },
          h("h2", null, "進行中の対局"),
          h("div", null, `${kyokuName(st.kyoku, current.rule.playerCount)} ${st.honba}本場 ・ ${names.join(" / ")}`),
          h(
            "div",
            { class: "sheet-actions two" },
            h("button", { type: "button", class: "btn-secondary", onclick: props.onDiscard }, "破棄"),
            h("button", { type: "button", class: "btn-primary", onclick: props.onResume }, "再開"),
          ),
        ),
      );
    }

    const sec = h("section", { class: "card" }, h("h2", null, "新しい対局"));

    // プリセット
    const presetSel = h(
      "select",
      { onchange: (e) => (presetName = e.target.value) },
      presetNames.map((k) => h("option", { value: k, selected: k === presetName }, k)),
    );
    sec.append(h("label", { class: "row" }, h("span", null, "ルール"), presetSel));

    // プレイヤー追加
    const nameInput = h("input", { type: "text", placeholder: "名前", autocomplete: "off", enterkeyhint: "done" });
    const addBtn = h(
      "button",
      {
        type: "button",
        class: "btn-secondary",
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) return;
          const p = storage.addPlayer(name);
          const empty = posPlayers.indexOf(null);
          if (empty >= 0) posPlayers[empty] = p.id;
          render();
        },
      },
      "追加",
    );
    sec.append(h("div", { class: "row" }, h("span", null, "プレイヤー"), nameInput, addBtn));

    // 席
    for (let k = 0; k < 4; k++) {
      const sel = h(
        "select",
        { onchange: (e) => (posPlayers[k] = e.target.value || null) },
        h("option", { value: "", selected: posPlayers[k] === null }, "—"),
        roster.map((p) => h("option", { value: p.id, selected: posPlayers[k] === p.id }, p.name)),
      );
      const radio = h("input", {
        type: "radio",
        name: "chiicha",
        value: String(k),
        checked: chiichaPos === k,
        onchange: () => (chiichaPos = k),
      });
      sec.append(
        h(
          "div",
          { class: "row seat-row" },
          h("span", { class: "pos-label" }, POSITIONS[k].label),
          sel,
          h("label", { class: "chiicha-label" }, radio, "起家"),
        ),
      );
    }

    sec.append(
      message,
      h(
        "div",
        { class: "sheet-actions" },
        h(
          "button",
          {
            type: "button",
            class: "btn-primary",
            onclick: () => {
              const rule = presets[presetName];
              const errors = validateRule(rule);
              if (posPlayers.some((p) => p === null)) errors.push("4人全員を選んでください");
              if (new Set(posPlayers).size !== posPlayers.length) errors.push("同じプレイヤーが重複しています");
              if (errors.length) {
                message.textContent = errors.join(" / ");
                message.hidden = false;
                return;
              }
              props.onStart(buildGame({ rule, posPlayers, chiichaPos }));
            },
          },
          current ? "進行中を破棄して開始" : "対局開始",
        ),
      ),
    );

    root.append(sec);
  }

  render();
  return root;
}
