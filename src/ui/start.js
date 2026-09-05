// 開始画面（docs/design.md §8.1）。プレイヤー選択、ルールプリセット選択、対局開始／再開、履歴、成績、バックアップ。

import { h, clear } from "./dom.js";
import { validateRule } from "../rules.js";
import { reduce, ranksOf } from "../reduce.js";
import { kyokuName, gameId, positionsFor, fmtPoints } from "./format.js";

const POSITION_LABELS = { bottom: "下（自分）", right: "右（下家）", top: "上（対面）", left: "左（上家）" };
const EMPTY_LABELS = { left: "左", top: "上", right: "右" };

/**
 * 画面位置ごとの playerId（下から反時計回りの順）と起家の位置から Game を作る。
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
 * props: { storage, current, presets, version, onResume(), onStart(game), onDiscard(),
 *          onOpenResult(gameId), onStats(), onExport(), onImport(file) }
 */
export function renderStart(props) {
  const { storage, current, presets, version } = props;
  const root = h("div", { class: "start-screen" });

  const presetNames = Object.keys(presets);
  let presetName = presetNames[0];
  let emptySeat = presets[presetName].emptySeat || "left";

  // 前回の席順を初期値にする
  const last = current || storage.loadGames()[0] || null;
  const posPlayers = [null, null, null, null];
  let chiichaPos = 0;
  if (last && last.seats) {
    const n = last.seats.length;
    const b = last.bottomSeat ?? 0;
    for (let k = 0; k < n; k++) posPlayers[k] = last.seats[(b + k) % n];
    chiichaPos = (n - b) % n;
    const found = presetNames.find((k) => presets[k].playerCount === n);
    if (found) presetName = found;
    if (last.rule && last.rule.emptySeat) emptySeat = last.rule.emptySeat;
  }

  const message = h("div", { class: "hint error", hidden: true });

  function currentRule() {
    const base = presets[presetName];
    return base.playerCount === 3 ? { ...base, emptySeat } : { ...base };
  }

  function render() {
    clear(root);
    const roster = storage.loadRoster();
    const nameOf = (id) => (roster.find((p) => p.id === id) || { name: "?" }).name;
    const rule = currentRule();
    const n = rule.playerCount;
    const positions = positionsFor(n, emptySeat);

    root.append(h("h1", null, "麻雀 点数表示器", h("span", { class: "ver" }, ` v${version}`)));

    if (current) {
      const st = reduce(current.events, current.rule);
      root.append(
        h(
          "section",
          { class: "card" },
          h("h2", null, "進行中の対局"),
          h("div", null, `${kyokuName(st.kyoku, current.rule.playerCount)} ${st.honba}本場 ・ ${current.seats.map(nameOf).join(" / ")}`),
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
      {
        onchange: (e) => {
          presetName = e.target.value;
          emptySeat = presets[presetName].emptySeat || emptySeat;
          render();
        },
      },
      presetNames.map((k) => h("option", { value: k, selected: k === presetName }, k)),
    );
    sec.append(h("label", { class: "row" }, h("span", null, "ルール"), presetSel));

    if (n === 3) {
      const emptySel = h(
        "select",
        {
          onchange: (e) => {
            emptySeat = e.target.value;
            render();
          },
        },
        Object.keys(EMPTY_LABELS).map((k) => h("option", { value: k, selected: k === emptySeat }, EMPTY_LABELS[k])),
      );
      sec.append(h("label", { class: "row" }, h("span", null, "空席"), emptySel));
    }

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
          const empty = posPlayers.slice(0, n).indexOf(null);
          if (empty >= 0) posPlayers[empty] = p.id;
          render();
        },
      },
      "追加",
    );
    sec.append(h("div", { class: "row" }, h("span", null, "プレイヤー"), nameInput, addBtn));

    // 席
    for (let k = 0; k < n; k++) {
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
          h("span", { class: "pos-label" }, POSITION_LABELS[positions[k]]),
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
              const rule = currentRule();
              const n = rule.playerCount;
              const chosen = posPlayers.slice(0, n);
              const errors = validateRule(rule);
              if (chosen.some((p) => p === null)) errors.push(`${n}人全員を選んでください`);
              if (new Set(chosen).size !== chosen.length) errors.push("同じプレイヤーが重複しています");
              if (chiichaPos >= n) chiichaPos = 0;
              if (errors.length) {
                message.textContent = errors.join(" / ");
                message.hidden = false;
                return;
              }
              props.onStart(buildGame({ rule, posPlayers: chosen, chiichaPos }));
            },
          },
          current ? "進行中を破棄して開始" : "対局開始",
        ),
      ),
    );
    root.append(sec);

    // 終了した対局
    const games = storage.loadGames();
    if (games.length) {
      const list = h("div", { class: "menu-list" });
      for (const g of games.slice(0, 20)) {
        const st = reduce(g.events, g.rule);
        const ranks = ranksOf(st.points);
        const order = [...Array(g.rule.playerCount).keys()].sort((a, b) => ranks[a] - ranks[b]);
        const date = (g.endedAt || g.startedAt || "").slice(0, 16).replace("T", " ");
        list.append(
          h(
            "button",
            { type: "button", class: "menu-item", onclick: () => props.onOpenResult(g.id) },
            h("span", null, date),
            h("span", { class: "menu-sub" }, order.map((i) => `${nameOf(g.seats[i])} ${fmtPoints(st.points[i])}`).join(" / ")),
          ),
        );
      }
      root.append(
        h(
          "section",
          { class: "card" },
          h("h2", null, `終了した対局（${games.length}）`),
          h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn-secondary", onclick: props.onStats }, "成績を見る")),
          list,
          h("div", { class: "hint" }, "タップで結果を開きます。結果画面のログから修正できます"),
        ),
      );
    }

    // バックアップ
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
    root.append(
      h(
        "section",
        { class: "card" },
        h("h2", null, "バックアップ"),
        h("div", { class: "hint" }, "データは端末内だけにあります。ホーム画面から削除すると消えるので、JSON を書き出して残してください。"),
        h(
          "div",
          { class: "sheet-actions two" },
          h("button", { type: "button", class: "btn-secondary", onclick: props.onExport }, "エクスポート"),
          h("button", { type: "button", class: "btn-secondary", onclick: () => fileInput.click() }, "インポート"),
        ),
        fileInput,
      ),
    );
  }

  render();
  return root;
}
