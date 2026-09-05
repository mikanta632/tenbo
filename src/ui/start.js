// 対局タブ（docs/design.md §8.1）。席の配置図でプレイヤーを選び、起家を決めて対局を始める。
//
//     上（C）
//  左（D）  右（B）
//     下（A）
//
// 各位置で既存のプレイヤーを選ぶか、その場で新しい名前を入れる。3人麻雀は左（D）が空席。
// 起家は配置とは別に選ぶ。画面上の配置はここで決めた位置がそのまま使われる。

import { h, clear } from "./dom.js";
import { validateRule } from "../rules.js";
import { reduce, ranksOf } from "../reduce.js";
import { kyokuName, gameId, fmtPoints, positionsFor } from "./format.js";

const POS_LABEL = { bottom: "下", right: "右", top: "上", left: "左" };
const NEW_PLAYER = "__new__";

/**
 * Game を作る。seats は起家順、bottomSeat は画面下に置く席。
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

/**
 * 画面位置ごとの playerId（下から反時計回りの順）と起家の位置（同じ順の添字）から seats / bottomSeat を出す。
 * 4人は 下→右→上→左、3人は 下→右→上（左は空席）。
 */
export function seatsFromPositions({ posPlayers, chiichaPos }) {
  const n = posPlayers.length;
  const seats = [];
  for (let i = 0; i < n; i++) seats.push(posPlayers[(chiichaPos + i) % n]);
  return { seats, bottomSeat: (n - chiichaPos) % n };
}

/**
 * 対局タブを描画する。
 * props: { storage, current, rulesFor(pc), onResume(), onStart(game), onDiscard(), onOpenResult(gameId) }
 */
export function renderStart(props) {
  const { storage, current } = props;
  const root = h("div", { class: "start-screen" });

  let pc = 4;
  // 画面位置 → playerId。順は positionsFor(pc)（下→右→上→左）
  const posPlayers = { bottom: null, right: null, top: null, left: null };
  let chiichaKey = "bottom";
  let editingPos = null; // 新しい名前を入力中の位置

  // 前回の席順を初期値にする
  const last = current || storage.loadGames()[0] || null;
  if (last && last.seats) {
    const n = last.seats.length;
    pc = n === 3 ? 3 : 4;
    const order = positionsFor(pc);
    const b = last.bottomSeat ?? 0;
    order.forEach((key, k) => (posPlayers[key] = last.seats[(b + k) % n]));
    chiichaKey = order[(n - b) % n];
  }

  const message = h("div", { class: "hint error", hidden: true });

  function render() {
    clear(root);
    const roster = storage.loadRoster();
    const nameOf = (id) => (roster.find((p) => p.id === id) || { name: "?" }).name;
    const n = pc;
    const order = positionsFor(n);
    if (!order.includes(chiichaKey)) chiichaKey = "bottom";

    root.append(h("header", { class: "plain-top" }, h("div", { class: "plain-title" }, "対局")));

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

    // 人数
    sec.append(
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
                editingPos = null;
                render();
              },
            },
            `${k}人麻雀`,
          ),
        ),
      ),
    );

    // 位置ごとの選択部品
    const seatControl = (key) => {
      if (n === 3 && key === "left") return h("div", { class: "seat-slot empty" }, h("span", { class: "seat-pos" }, "左"), h("span", { class: "seat-empty" }, "空席"));
      if (editingPos === key) {
        const input = h("input", { type: "text", placeholder: "新しい名前", autocomplete: "off", enterkeyhint: "done" });
        const commit = () => {
          const name = input.value.trim();
          if (name) {
            const p = storage.addPlayer(name);
            posPlayers[key] = p.id;
          }
          editingPos = null;
          render();
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit();
        });
        const el = h(
          "div",
          { class: "seat-slot editing" },
          h("span", { class: "seat-pos" }, POS_LABEL[key]),
          input,
          h("button", { type: "button", class: "btn-secondary small", onclick: commit }, "決定"),
        );
        setTimeout(() => input.focus(), 0);
        return el;
      }
      const sel = h(
        "select",
        {
          onchange: (e) => {
            const v = e.target.value;
            if (v === NEW_PLAYER) {
              editingPos = key;
              render();
              return;
            }
            posPlayers[key] = v || null;
            render();
          },
        },
        h("option", { value: "", selected: posPlayers[key] === null }, "—"),
        roster.map((p) => h("option", { value: p.id, selected: posPlayers[key] === p.id }, p.name)),
        h("option", { value: NEW_PLAYER }, "＋ 新しい名前"),
      );
      return h("div", { class: `seat-slot${chiichaKey === key ? " chiicha" : ""}` }, h("span", { class: "seat-pos" }, POS_LABEL[key]), sel);
    };

    // 配置図: 上 / 左 右 / 下
    sec.append(
      h("div", { class: "label" }, "座っている位置で選ぶ（画面はこの向きで置く）"),
      h(
        "div",
        { class: "seat-grid" },
        h("div", { class: "seat-cell top" }, seatControl("top")),
        h("div", { class: "seat-cell left" }, seatControl("left")),
        h("div", { class: "seat-cell center" }, h("span", { class: "seat-center" }, "卓")),
        h("div", { class: "seat-cell right" }, seatControl("right")),
        h("div", { class: "seat-cell bottom" }, seatControl("bottom")),
      ),
    );

    // 起家
    sec.append(
      h("div", { class: "label" }, "起家"),
      h(
        "div",
        { class: "choice grid4" },
        order.map((key) =>
          h(
            "button",
            {
              type: "button",
              class: `chip${chiichaKey === key ? " on" : ""}`,
              onclick: () => {
                chiichaKey = key;
                render();
              },
            },
            `${POS_LABEL[key]} ${posPlayers[key] ? nameOf(posPlayers[key]) : "—"}`,
          ),
        ),
      ),
    );

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
              const rule = props.rulesFor(pc);
              const errors = validateRule(rule);
              const list = order.map((key) => posPlayers[key]);
              const seatsInfo = seatsFromPositions({ posPlayers: list, chiichaPos: order.indexOf(chiichaKey) });
              if (list.some((p) => p === null)) errors.push(`${n}人全員を選んでください`);
              if (new Set(list).size !== list.length) errors.push("同じプレイヤーが重複しています");
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
        const ord = [...Array(g.rule.playerCount).keys()].sort((a, b) => ranks[a] - ranks[b]);
        const date = (g.endedAt || g.startedAt || "").slice(0, 16).replace("T", " ");
        list.append(
          h(
            "button",
            { type: "button", class: "menu-item", onclick: () => props.onOpenResult(g.id) },
            h("span", null, date),
            h("span", { class: "menu-sub" }, ord.map((i) => `${nameOf(g.seats[i])} ${fmtPoints(st.points[i])}`).join(" / ")),
          ),
        );
      }
      root.append(h("section", { class: "card" }, h("h2", null, `終了した対局（${games.length}）`), list));
    }
  }

  render();
  return root;
}
