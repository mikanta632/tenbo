// 対局タブ（docs/design.md §8.1）。一人を基準（自分）にして、その人から見た 右・対面・左 を選び、起家を決めて対局を始める。
//
//   自分   → 画面位置 bottom
//   右     → right（下家側）
//   対面   → top
//   左     → left（上家側）
//
// 各行をタップすると iOS の選択肢（ドラムロール）が開き、既存のプレイヤーを選ぶか、その場で新しい名前を入れる。
// すでに他の席にいる人を選んだときは席を入れ替える。
// 3人麻雀は 右・対面・左 のどれか 1つを「空席」にする（自分は空席にできない）。端末はその空席に横向きに置く（§2）。
// 起家は配置とは別に選ぶ。終了した対局の一覧は戦績タブに置く（§8.5）。

import { h, clear } from "./dom.js";
import { validateRule } from "../rules.js";
import { reduce } from "../reduce.js";
import { kyokuName, gameId, positionsFor, POSITION_ORDER } from "./format.js";

const POS_LABEL = { bottom: "自分", right: "右", top: "対面", left: "左" };
const NEW_PLAYER = "__new__";
const EMPTY = "__empty__";

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
 * props: { storage, current, rulesFor(pc), onResume(), onStart(game), onDiscard() }
 */
export function renderStart(props) {
  const { storage, current } = props;
  const root = h("div", { class: "start-screen" });

  let pc = 4;
  const posPlayers = { bottom: null, right: null, top: null, left: null }; // 画面位置 → playerId
  let emptyPosition = null; // 3人麻雀の空席（右・対面・左のどれか）。未定なら対局を始められない
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
    // 旧記録で自分（下）が空席なら、相対配置を保ったまま卓を回して自分に人を置く
    if (emptyPosition === "bottom") {
      const prev = { ...posPlayers };
      POSITION_ORDER.forEach((key, k) => (posPlayers[key] = prev[POSITION_ORDER[(k + 1) % 4]]));
      chiichaKey = POSITION_ORDER[(POSITION_ORDER.indexOf(chiichaKey) + 3) % 4];
      emptyPosition = "left";
    }
  }

  const message = h("div", { class: "hint error", hidden: true });

  function render() {
    clear(root);
    const roster = storage.loadRoster();
    const nameOf = (id) => (roster.find((p) => p.id === id) || { name: "?" }).name;
    const n = pc;
    // 使う位置。3人麻雀で空席が未定なら 4つとも出す（開始時に空席を求める）
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
                if (k === 3) emptyPosition = null; // 空席を選び直してもらう
                editingPos = null;
                render();
              },
            },
            `${k}人麻雀`,
          ),
        ),
      ),
    );

    // ルール（その人数のプリセット）。選択は設定タブと共有する（§7）
    if (props.presetsFor) {
      const presets = props.presetsFor(pc);
      const selectedId = props.selectedId ? props.selectedId(pc) : null;
      sec.append(
        h(
          "div",
          { class: "row rule-row" },
          h("span", null, "ルール"),
          h(
            "select",
            {
              "aria-label": "ルール",
              onchange: (e) => {
                if (props.onSelectPreset) props.onSelectPreset(pc, e.target.value);
                render();
              },
            },
            presets.map((p) => h("option", { value: p.id, selected: p.id === selectedId }, p.name)),
          ),
        ),
      );
    }

    // 他の席にいる人を選んだら入れ替える
    const place = (key, id) => {
      const here = posPlayers[key];
      const from = Object.keys(posPlayers).find((k) => posPlayers[k] === id && k !== key);
      if (from) posPlayers[from] = here;
      posPlayers[key] = id;
    };

    // 位置ごとの席。select をそのまま置く（タップで iOS のドラムロール）
    const seatControl = (key) => {
      const isEmpty = n === 3 && key === emptyPosition;
      const canBeEmpty = n === 3 && key !== "bottom"; // 自分は空席にできない
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
      const sel = h(
        "select",
        {
          "aria-label": `${POS_LABEL[key]}の席`,
          onchange: (e) => {
            const v = e.target.value;
            if (v === NEW_PLAYER) editingPos = key;
            else if (v === EMPTY) {
              // 空席は1つだけ。前の空席は「—」に戻る
              emptyPosition = key;
              posPlayers[key] = null;
            } else {
              if (isEmpty) emptyPosition = null; // 空席に人を入れたら、空席を選び直してもらう
              if (v) place(key, v);
              else posPlayers[key] = null;
            }
            render();
          },
        },
        h("option", { value: "", selected: !isEmpty && pid === null }, "—"),
        canBeEmpty ? h("option", { value: EMPTY, selected: isEmpty }, "空席") : null,
        roster.map((p) => h("option", { value: p.id, selected: !isEmpty && pid === p.id }, p.name)),
        h("option", { value: NEW_PLAYER }, "＋ 新しい名前"),
      );
      return h(
        "div",
        { class: `seat-slot${isChiicha ? " chiicha" : ""}${isEmpty ? " empty" : ""}` },
        h("span", { class: "seat-pos" }, POS_LABEL[key]),
        sel,
      );
    };

    // 自分 → 右 → 対面 → 左 の順（反時計回り＝打牌順）に行で並べる
    sec.append(h("div", { class: "seat-rows" }, POSITION_ORDER.map((key) => seatControl(key))));

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
            POS_LABEL[key],
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
              if (n === 3 && emptyPosition === null) errors.push("右・対面・左のどれかを空席にしてください");
              else if (list.some((p) => p === null)) errors.push(`${n}人全員を選んでください`);
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
