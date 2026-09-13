// 対局タブ（docs/design.md §8.1）。席の配置図でプレイヤーを選び、起家を決めて対局を始める。
//
//     上（C）
//  左（D）  右（B）
//     下（A）
//
// 各位置の席をタップし、シートから既存のプレイヤーを選ぶか、その場で新しい名前を入れる。
// すでに他の席にいる人を選んだときは席を入れ替える。
// 終了した対局の一覧は戦績タブに置く（§8.5）。
// 3人麻雀は 4席のうち 1つを「空席」にする（どの位置でもよい）。起家は配置とは別に選ぶ。
// 画面上の配置はここで決めた位置がそのまま使われる。

import { h, clear } from "./dom.js";
import { validateRule } from "../rules.js";
import { reduce } from "../reduce.js";
import { kyokuName, gameId, positionsFor, POSITION_ORDER } from "./format.js";

const POS_LABEL = { bottom: "下", right: "右", top: "上", left: "左" };

/**
 * Game を作る。seats は起家順、bottomSeat は「使う位置の先頭（通常は下）」に置く席、
 * emptyPosition は 3人麻雀の空席の位置（4人は null）。
 */
export function buildGame({ rule, seats, bottomSeat, emptyPosition = null, now = new Date() }) {
  return {
    id: gameId(now),
    startedAt: now.toISOString(),
    endedAt: null,
    rule: JSON.parse(JSON.stringify(rule)),
    seats,
    bottomSeat,
    emptyPosition,
    events: [],
    settlement: null,
  };
}

/**
 * 使う位置（下から反時計回り）ごとの playerId と起家の位置（同じ順の添字）から seats / bottomSeat を出す。
 */
export function seatsFromPositions({ posPlayers, chiichaPos }) {
  const n = posPlayers.length;
  const seats = [];
  for (let i = 0; i < n; i++) seats.push(posPlayers[(chiichaPos + i) % n]);
  return { seats, bottomSeat: (n - chiichaPos) % n };
}

/**
 * 対局タブを描画する。
 * props: { storage, current, rulesFor(pc), onResume(), onStart(game), onDiscard(), openActions({ title, items }) }
 */
export function renderStart(props) {
  const { storage, current } = props;
  const root = h("div", { class: "start-screen" });

  let pc = 4;
  const posPlayers = { bottom: null, right: null, top: null, left: null }; // 画面位置 → playerId
  let emptyPosition = "left"; // 3人麻雀の空席
  let chiichaKey = "bottom";
  let editingPos = null; // 新しい名前を入力中の位置

  // 前回の席順を初期値にする
  const last = current || storage.loadGames()[0] || null;
  if (last && last.seats) {
    const n = last.seats.length;
    pc = n === 3 ? 3 : 4;
    if (pc === 3) emptyPosition = last.emptyPosition || "left";
    const order = positionsFor(pc, emptyPosition);
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
    const order = positionsFor(n, emptyPosition);
    if (!order.includes(chiichaKey)) chiichaKey = order[0];

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

    // 席をタップしたときの選択肢。他の席にいる人を選んだら入れ替える
    const pickSeat = (key) => {
      const isEmpty = n === 3 && key === emptyPosition;
      const here = isEmpty ? null : posPlayers[key];
      const place = (id) => {
        const from = Object.keys(posPlayers).find((k) => posPlayers[k] === id && k !== key);
        if (from) posPlayers[from] = here;
        posPlayers[key] = id;
        render();
      };
      const items = roster
        .filter((p) => p.id !== here)
        .map((p) => ({ label: p.name, onPick: () => place(p.id) }));
      items.push({ label: "＋ 新しい名前", onPick: () => { editingPos = key; render(); } });
      if (n === 3 && !isEmpty) items.push({ label: "空席にする", onPick: () => { emptyPosition = key; render(); } });
      if (here) items.push({ label: "外す", danger: true, onPick: () => { posPlayers[key] = null; render(); } });
      props.openActions({ title: `${POS_LABEL[key]}の席`, items });
    };

    // 位置ごとの席（タップで選ぶ）
    const seatControl = (key) => {
      const isEmpty = n === 3 && key === emptyPosition;
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
      const pid = isEmpty ? null : posPlayers[key];
      const isChiicha = chiichaKey === key && !isEmpty;
      return h(
        "button",
        {
          type: "button",
          class: `seat-slot${isChiicha ? " chiicha" : ""}${isEmpty ? " empty" : ""}${!pid && !isEmpty ? " unset" : ""}`,
          "aria-label": `${POS_LABEL[key]}の席`,
          onclick: () => pickSeat(key),
        },
        h("span", { class: "seat-pos" }, POS_LABEL[key]),
        h("span", { class: "seat-name" }, isEmpty ? "空席" : pid ? nameOf(pid) : "—"),
        isChiicha ? h("span", { class: "seat-tag" }, "起家") : null,
      );
    };

    // 配置図: 上 / 左 右 / 下
    sec.append(
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

    // 起家（空席は除く）
    sec.append(
      h("div", { class: "label" }, "起家"),
      h(
        "div",
        { class: "choice seat-choice" },
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
              props.onStart(buildGame({ rule, ...seatsInfo, emptyPosition: n === 3 ? emptyPosition : null }));
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

export { POSITION_ORDER };
