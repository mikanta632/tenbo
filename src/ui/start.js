// 開始画面（docs/design.md §8.1）。プレイヤー選択、ルール選択、対局開始／再開、履歴、成績、設定、バックアップ。

import { h, clear } from "./dom.js";
import { validateRule } from "../rules.js";
import { reduce, ranksOf } from "../reduce.js";
import { kyokuName, gameId, fmtPoints } from "./format.js";

const POSITION_LABELS = { bottom: "下（自分）", right: "右（下家）", top: "上（対面）", left: "左（上家）" };
const POSITIONS4 = ["bottom", "right", "top", "left"];
const SEAT_NAMES3 = ["起家（東）", "南家", "西家"];

/**
 * Game を作る。seats は起家順、bottomSeat は画面下に置く席（対局画面の「回転」で変えられる）。
 */
export function buildGame({ rule, seats, bottomSeat, now = new Date() }) {
  return {
    id: gameId(now),
    startedAt: now.toISOString(),
    endedAt: null,
    rule: JSON.parse(JSON.stringify(rule)),
    seats,
    bottomSeat,
    events: [],
    settlement: null,
  };
}

/** 4人: 画面位置ごとの playerId（下から反時計回り）と起家の位置から seats / bottomSeat を出す */
export function seatsFrom4({ posPlayers, chiichaPos }) {
  const n = 4;
  const seats = [];
  for (let i = 0; i < n; i++) seats.push(posPlayers[(chiichaPos + i) % n]);
  return { seats, bottomSeat: (n - chiichaPos) % n };
}

/**
 * 開始画面を描画する。
 * props: { storage, current, presets, version, onResume(), onStart(game), onDiscard(),
 *          onOpenResult(gameId), onStats(), onSettings(), onExport(), onImport(file) }
 */
export function renderStart(props) {
  const { storage, current, presets, version } = props;
  const root = h("div", { class: "start-screen" });

  const presetNames = Object.keys(presets);
  let presetName = presetNames[0];

  // 4人: 画面位置ごとのプレイヤー。3人: 起家順のプレイヤー
  const posPlayers = [null, null, null, null];
  let chiichaPos = 0;
  const seatPlayers3 = [null, null, null];
  let bottomSeat3 = 0;

  // 前回の席順を初期値にする
  const last = current || storage.loadGames()[0] || null;
  if (last && last.seats) {
    const n = last.seats.length;
    const found = presetNames.find((k) => presets[k].playerCount === n);
    if (found) presetName = found;
    if (n === 4) {
      const b = last.bottomSeat ?? 0;
      for (let k = 0; k < 4; k++) posPlayers[k] = last.seats[(b + k) % 4];
      chiichaPos = (4 - b) % 4;
    } else {
      for (let k = 0; k < 3; k++) seatPlayers3[k] = last.seats[k];
      bottomSeat3 = last.bottomSeat ?? 0;
    }
  }

  const message = h("div", { class: "hint error", hidden: true });

  function render() {
    clear(root);
    const roster = storage.loadRoster();
    const nameOf = (id) => (roster.find((p) => p.id === id) || { name: "?" }).name;
    const rule = presets[presetName];
    const n = rule.playerCount;

    root.append(
      h(
        "header",
        { class: "start-top" },
        h("h1", null, "麻雀 点数表示器", h("span", { class: "ver" }, ` v${version}`)),
        h(
          "div",
          { class: "start-nav" },
          h("button", { type: "button", class: "btn-flat", onclick: props.onStats }, "成績・分析"),
          h("button", { type: "button", class: "btn-flat", onclick: props.onSettings }, "設定"),
        ),
      ),
    );

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

    // ルール
    const presetSel = h(
      "select",
      {
        onchange: (e) => {
          presetName = e.target.value;
          render();
        },
      },
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
          const list = n === 4 ? posPlayers : seatPlayers3;
          const empty = list.slice(0, n).indexOf(null);
          if (empty >= 0) list[empty] = p.id;
          render();
        },
      },
      "追加",
    );
    sec.append(h("div", { class: "row" }, h("span", null, "プレイヤー"), nameInput, addBtn));

    const playerSelect = (value, onChange) =>
      h(
        "select",
        { onchange: (e) => onChange(e.target.value || null) },
        h("option", { value: "", selected: value === null }, "—"),
        roster.map((p) => h("option", { value: p.id, selected: value === p.id }, p.name)),
      );

    if (n === 4) {
      // 画面位置ごとに選ぶ
      for (let k = 0; k < 4; k++) {
        const radio = h("input", { type: "radio", name: "chiicha", value: String(k), checked: chiichaPos === k, onchange: () => (chiichaPos = k) });
        sec.append(
          h(
            "div",
            { class: "row seat-row" },
            h("span", { class: "pos-label" }, POSITION_LABELS[POSITIONS4[k]]),
            playerSelect(posPlayers[k], (v) => (posPlayers[k] = v)),
            h("label", { class: "chiicha-label" }, radio, "起家"),
          ),
        );
      }
    } else {
      // 起家順に選ぶ。画面上の配置は対局画面の「回転」で合わせる
      for (let k = 0; k < 3; k++) {
        sec.append(h("div", { class: "row seat-row" }, h("span", { class: "pos-label" }, SEAT_NAMES3[k]), playerSelect(seatPlayers3[k], (v) => (seatPlayers3[k] = v))));
      }
      sec.append(h("div", { class: "hint" }, "空席が画面の左側（長辺）に来る向きで置きます。誰が下に来るかは対局画面の「回転」で合わせます。"));
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
              const n = rule.playerCount;
              const errors = validateRule(rule);
              const seatsInfo = n === 4 ? seatsFrom4({ posPlayers, chiichaPos }) : { seats: seatPlayers3.slice(), bottomSeat: bottomSeat3 % 3 };
              if (seatsInfo.seats.some((p) => p === null)) errors.push(`${n}人全員を選んでください`);
              if (new Set(seatsInfo.seats).size !== seatsInfo.seats.length) errors.push("同じプレイヤーが重複しています");
              if (errors.length) {
                message.textContent = errors.join(" / ");
                message.hidden = false;
                return;
              }
              props.onStart(buildGame({ rule, ...seatsInfo }));
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
      root.append(h("section", { class: "card" }, h("h2", null, `終了した対局（${games.length}）`), list, h("div", { class: "hint" }, "タップで結果を開きます。結果画面のログから修正できます")));
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
