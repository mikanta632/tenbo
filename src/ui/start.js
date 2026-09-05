// 対局タブ（docs/design.md §8.1）。プレイヤー選択、人数の選択、対局開始／再開、終了した対局の一覧。
// ルールの中身は設定タブで編集し、ここでは 4人／3人を選ぶだけ。

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

/** ルールの要点を 1行にする */
function ruleSummary(rule) {
  const n = rule.playerCount;
  const len = rule.length === n ? "東風" : "半荘";
  return `${len} ・ ${fmtPoints(rule.startPoints)}持ち ${fmtPoints(rule.returnPoints)}返し ・ ウマ ${rule.uma.join("/")} ・ ${rule.rate}円/pt`;
}

/**
 * 対局タブを描画する。
 * props: { storage, current, rulesFor(pc), onResume(), onStart(game), onDiscard(), onOpenResult(gameId), onSettings() }
 */
export function renderStart(props) {
  const { storage, current } = props;
  const root = h("div", { class: "start-screen" });

  let pc = 4;
  const posPlayers = [null, null, null, null];
  let chiichaPos = 0;
  const seatPlayers3 = [null, null, null];
  let bottomSeat3 = 0;

  // 前回の席順を初期値にする
  const last = current || storage.loadGames()[0] || null;
  if (last && last.seats) {
    const n = last.seats.length;
    pc = n === 3 ? 3 : 4;
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
    const rule = props.rulesFor(pc);
    const n = pc;

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
                render();
              },
            },
            `${k}人麻雀`,
          ),
        ),
      ),
      h("div", { class: "rule-summary" }, ruleSummary(rule), " ", h("button", { type: "button", class: "link-btn", onclick: props.onSettings }, "設定で変更 ›")),
    );

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
              const rule = props.rulesFor(pc);
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
  }

  render();
  return root;
}
