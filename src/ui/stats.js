// 戦績画面（docs/design.md §8.5）。「対局一覧」と「個人成績」の2つのタブを持つ。
//
// 対局一覧: 人数（4人／3人／すべて）で絞り込み、対局ごとに順位・素点・pt・収支を出す。
//           複数選んで「まとめて精算」すると、その範囲の収支と支払いを見られる。
// 個人成績: プレイヤーごとの対局レベル・局レベルの集計。

import { h, clear } from "./dom.js";
import { aggregate, derive, gameStats } from "../stats.js";
import { fmtPoints } from "./format.js";

const pct = (x) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (x, d = 1) => (x === null ? "—" : x.toFixed(d));
const signed = (x) => (x > 0 ? `+${x}` : String(x));
const yen = (x) => `${signed(x)}円`;
const signClass = (x) => (x > 0 ? "plus" : x < 0 ? "minus" : "");

const FILTERS = [
  { key: "all", label: "4人+3人", match: () => true },
  { key: "4", label: "4人", match: (g) => g.rule.playerCount === 4 },
  { key: "3", label: "3人", match: (g) => g.rule.playerCount === 3 },
];

/**
 * props: {
 *   games, roster, onBack, initialTab, onTab(key),
 *   onPlayer(playerId), onPickGame(gameId), onSettle(gameIds)
 * }
 */
export function renderStats(props) {
  const root = h("div", { class: "plain-screen stats-screen" });
  const { games, roster } = props;
  const nameOf = (id) => (roster.find((p) => p.id === id) || { name: "?" }).name;

  let tab = props.initialTab === "players" ? "players" : "games";
  let filter = "all";
  const selected = new Set(); // 選択中の対局 id

  function render() {
    clear(root);
    root.append(
      h(
        "header",
        { class: "plain-top" },
        props.onBack ? h("button", { type: "button", class: "btn-flat", onclick: props.onBack }, "戻る") : null,
        h("div", { class: "plain-title" }, `戦績（${games.length}対局）`),
      ),
      h(
        "div",
        { class: "choice big segmented" },
        [
          ["games", "対局一覧"],
          ["players", "個人成績"],
        ].map(([key, label]) =>
          h(
            "button",
            {
              type: "button",
              class: `chip${tab === key ? " on" : ""}`,
              onclick: () => {
                tab = key;
                if (props.onTab) props.onTab(key);
                render();
              },
            },
            label,
          ),
        ),
      ),
    );

    if (games.length === 0) {
      root.append(h("section", { class: "card" }, h("div", { class: "hint" }, "終了した対局がありません")));
      return;
    }
    if (tab === "games") renderGameList();
    else renderPlayerStats();
  }

  // ---- 対局一覧 ----------------------------------------------------------

  function renderGameList() {
    const shown = games.filter(FILTERS.find((f) => f.key === filter).match);
    // 絞り込みで消えた対局は選択から外す
    for (const id of [...selected]) if (!shown.some((g) => g.id === id)) selected.delete(id);

    root.append(
      h(
        "div",
        { class: "choice grid3" },
        FILTERS.map((f) =>
          h(
            "button",
            {
              type: "button",
              class: `chip${filter === f.key ? " on" : ""}`,
              onclick: () => {
                filter = f.key;
                render();
              },
            },
            f.label,
          ),
        ),
      ),
    );

    if (selected.size > 0) {
      root.append(
        h(
          "section",
          { class: "card select-bar" },
          h("div", { class: "summary" }, `${selected.size}対局を選択中`),
          h(
            "div",
            { class: "sheet-actions two" },
            h(
              "button",
              {
                type: "button",
                class: "btn-secondary",
                onclick: () => {
                  selected.clear();
                  render();
                },
              },
              "選択解除",
            ),
            h("button", { type: "button", class: "btn-primary", onclick: () => props.onSettle([...selected]) }, "まとめて精算"),
          ),
        ),
      );
    }

    if (shown.length === 0) {
      root.append(h("section", { class: "card" }, h("div", { class: "hint" }, "この人数の対局はありません")));
      return;
    }
    for (const g of shown) root.append(gameCard(g));
  }

  /** 1対局のカード。左のチェックで選択、日付をタップで操作（結果・編集・削除）。 */
  function gameCard(g) {
    const n = g.rule.playerCount;
    const st = gameSeats(g);
    const date = (g.endedAt || g.startedAt || "").slice(0, 16).replace("T", " ");
    const check = h("input", {
      type: "checkbox",
      checked: selected.has(g.id),
      onchange: (e) => {
        if (e.target.checked) selected.add(g.id);
        else selected.delete(g.id);
        render();
      },
    });

    return h(
      "section",
      { class: "card game-card" },
      h(
        "div",
        { class: "game-card-head" },
        h("label", { class: "pick" }, check),
        h("button", { type: "button", class: "link-btn", onclick: () => props.onPickGame(g.id) }, `${date} ・ ${n}人 ›`),
      ),
      h(
        "table",
        { class: "rtable game-rtable" },
        h("thead", null, h("tr", null, h("th", null, "順位"), h("th", null, "名前"), h("th", null, "素点"), h("th", null, "pt"), h("th", null, "収支"))),
        h(
          "tbody",
          null,
          st.map((s) =>
            h(
              "tr",
              null,
              h("td", { class: "rank" }, h("span", { class: `rank-badge r${s.rank + 1}` }, `${s.rank + 1}位`)),
              h("td", { class: "name" }, nameOf(s.playerId)),
              h("td", null, fmtPoints(s.points)),
              h("td", null, signed(Math.round(s.pt * 10) / 10)),
              h("td", { class: signClass(s.yen) }, yen(s.yen)),
            ),
          ),
        ),
      ),
    );
  }

  /** 順位順に並べた席の精算値。settlement が無ければ計算する（編集後など） */
  function gameSeats(g) {
    return gameStats(g).seats.map((s) => ({ playerId: s.playerId, rank: s.rank, points: s.points, pt: s.pt, yen: s.yen })).sort((a, b) => a.rank - b.rank);
  }

  // ---- 個人成績 ----------------------------------------------------------

  function renderPlayerStats() {
    const map = aggregate(games);
    const rows = [...map.entries()].map(([id, a]) => ({ id, name: nameOf(id), d: derive(a) })).sort((x, y) => y.d.ptSum - x.d.ptSum);
    const nameCell = (r) => h("td", { class: "name" }, h("button", { type: "button", class: "link-btn", onclick: () => props.onPlayer(r.id) }, r.name, " ›"));

    const gameTable = h(
      "table",
      { class: "rtable" },
      h(
        "thead",
        null,
        h("tr", null, h("th", null, "名前"), h("th", null, "対局"), h("th", null, "平均順位"), h("th", null, "1/2/3/4位"), h("th", null, "平均素点"), h("th", null, "通算pt"), h("th", null, "通算円")),
      ),
      h(
        "tbody",
        null,
        rows.map((r) =>
          h(
            "tr",
            null,
            nameCell(r),
            h("td", null, String(r.d.games)),
            h("td", null, num(r.d.avgRank, 2)),
            h("td", null, r.d.rankDist.join("/")),
            h("td", null, r.d.avgPoints === null ? "—" : fmtPoints(Math.round(r.d.avgPoints))),
            h("td", { class: "pt" }, signed(Math.round(r.d.ptSum * 10) / 10)),
            h("td", { class: signClass(r.d.yenSum) }, signed(r.d.yenSum)),
          ),
        ),
      ),
    );

    const kyokuTable = h(
      "table",
      { class: "rtable" },
      h(
        "thead",
        null,
        h("tr", null, h("th", null, "名前"), h("th", null, "有効局"), h("th", null, "和了率"), h("th", null, "放銃率"), h("th", null, "リーチ率"), h("th", null, "副露率"), h("th", null, "平均和了"), h("th", null, "平均放銃")),
      ),
      h(
        "tbody",
        null,
        rows.map((r) =>
          h(
            "tr",
            null,
            nameCell(r),
            h("td", null, String(r.d.effective)),
            h("td", null, pct(r.d.agariRate)),
            h("td", null, pct(r.d.houjuRate)),
            h("td", null, pct(r.d.riichiRate)),
            h("td", null, pct(r.d.meldRate)),
            h("td", null, r.d.avgAgari === null ? "—" : fmtPoints(Math.round(r.d.avgAgari))),
            h("td", null, r.d.avgHouju === null ? "—" : fmtPoints(Math.round(r.d.avgHouju))),
          ),
        ),
      ),
    );

    root.append(
      h("section", { class: "card" }, h("h2", null, "対局ごとの成績"), h("div", { class: "stats-wrap" }, gameTable)),
      h(
        "section",
        { class: "card" },
        h("h2", null, "局ごとの成績"),
        h("div", { class: "hint" }, "チョンボで流れた局は、その局のリーチ・副露も含めて分母に入れません。"),
        h("div", { class: "stats-wrap" }, kyokuTable),
      ),
      h("div", { class: "hint" }, "対局数が少ないうちは率の差に意味はほとんどありません。対局数と併せて見てください。"),
    );
  }

  render();
  return root;
}
