// 戦績画面（docs/design.md §8.5）。「対局一覧」と「個人成績」の2つのタブを持つ。
//
// 対局一覧: 人数（4人／3人／すべて）で絞り込み、対局ごとに順位・素点・pt・収支を出す。
//           複数選んで「まとめて精算」すると、その範囲の収支と支払いを見られる。
// 個人成績: 4人麻雀と3人麻雀を分けて集計する（平均順位は人数が違うと比べられない）。
//           表には名前・対局数・平均順位・通算pt・収支だけを出し、
//           和了率などの細かい数字は名前をタップして個人ページで見る。

import { h, clear } from "./dom.js";
import { aggregate, derive, gameStats } from "../stats.js";
import { fmtPoints, fmtDate, gameDateTime } from "./format.js";

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
 *   games, roster, onBack, initialTab, onTab(key), initialPc, onPc(n),
 *   onPlayer(playerId), onPickGame(gameId), onSettle(gameIds), initialListState, onListState(state), now
 * }
 */
export function renderStats(props) {
  const root = h("div", { class: "plain-screen stats-screen" });
  const { games, roster } = props;
  const nameOf = (id) => (roster.find((p) => p.id === id) || { name: "?" }).name;

  let tab = props.initialTab === "players" ? "players" : "games";
  const initial = props.initialListState || {};
  let filter = FILTERS.some((f) => f.key === initial.filter) ? initial.filter : "all";
  let period = initial.period === "today" ? "today" : "all";
  let pc = props.initialPc === 3 ? 3 : 4; // 個人成績の人数
  const selected = new Set((initial.selectedIds || []).filter((id) => games.some((g) => g.id === id)));
  const today = fmtDate((props.now || new Date()).toISOString());

  function render(resetScroll = false) {
    const scroller = root.closest(".tab-content");
    const scrollTop = resetScroll ? 0 : (scroller?.scrollTop ?? initial.scrollTop ?? 0);
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

    if (tab === "games") renderGameList();
    else renderPlayerStats();
    if (scroller) scroller.scrollTop = scrollTop;
    props.onListState?.({ filter, period, selectedIds: [...selected], scrollTop });
  }

  // ---- 対局一覧 ----------------------------------------------------------

  function renderGameList() {
    if (games.length === 0) {
      root.append(h("section", { class: "card" }, h("div", { class: "hint" }, "終了した対局がありません")));
      return;
    }
    const shown = games.filter((g) => FILTERS.find((f) => f.key === filter).match(g) && (period !== "today" || gameDateTime(g).slice(0, 10) === today));
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
                render(true);
              },
            },
            f.label,
          ),
        ),
      ),
      h("div", { class: "choice grid2" }, [["all", "全期間"], ["today", "今日"]].map(([key, label]) => h("button", {
        type: "button", class: `chip${period === key ? " on" : ""}`,
        onclick: () => { period = key; render(true); },
      }, label))),
    );

    // 選択バーは常に出す。左のボタンは「すべて選択」と「選択解除」を状態で入れ替える
    if (shown.length > 0) {
      const allPicked = shown.every((g) => selected.has(g.id));
      root.append(
        h(
          "section",
          { class: "card select-bar" },
          h("div", { class: "summary" }, selected.size > 0 ? `${selected.size}対局を選択中` : `${shown.length}対局。選んでまとめて精算できます`),
          h(
            "div",
            { class: "sheet-actions two" },
            h(
              "button",
              {
                type: "button",
                class: "btn-secondary",
                onclick: () => {
                  if (allPicked) selected.clear();
                  else for (const g of shown) selected.add(g.id);
                  render();
                },
              },
              allPicked ? "選択解除" : "すべて選択",
            ),
            h(
              "button",
              { type: "button", class: "btn-primary", disabled: selected.size === 0, onclick: () => props.onSettle([...selected]) },
              "まとめて精算",
            ),
          ),
        ),
      );
    }

    if (shown.length === 0) {
      root.append(h("section", { class: "card" }, h("div", { class: "hint" }, "この条件の対局はありません")));
      return;
    }
    const days = new Map();
    for (const game of shown) {
      const day = gameDateTime(game).slice(0, 10) || "日付不明";
      if (!days.has(day)) days.set(day, []);
      days.get(day).push(game);
    }
    for (const [day, dayGames] of days) {
      const allPicked = dayGames.every((g) => selected.has(g.id));
      root.append(h("div", { class: "game-day" },
        h("b", null, `${day}${day === today ? "（今日）" : ""} ・ ${dayGames.length}対局`),
        h("button", {
          type: "button", class: "btn-secondary small",
          "aria-label": `${day}の対局を${allPicked ? "選択解除" : "すべて選択"}`,
          onclick: () => {
            for (const g of dayGames) {
              if (allPicked) selected.delete(g.id);
              else selected.add(g.id);
            }
            render();
          },
        }, allPicked ? "この日の選択解除" : "この日をすべて選択"),
      ));
      for (const game of dayGames) root.append(gameCard(game));
    }
  }

  /** 1対局のカード。左のチェックで選択、日付をタップで操作（結果・編集・削除）。 */
  function gameCard(g) {
    const n = g.rule.playerCount;
    const st = gameSeats(g);
    const date = gameDateTime(g);
    const check = h("input", {
      type: "checkbox",
      "aria-label": `${date}の対局を選択`,
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
    const target = games.filter((g) => g.rule.playerCount === pc);
    root.append(
      h(
        "div",
        { class: "choice grid2" },
        [4, 3].map((k) =>
          h(
            "button",
            {
              type: "button",
              class: `chip${pc === k ? " on" : ""}`,
              onclick: () => {
                pc = k;
                if (props.onPc) props.onPc(k);
                render();
              },
            },
            `${k}人麻雀`,
          ),
        ),
      ),
    );

    // 記録が無くても、登録してあるプレイヤーは名前を直せるように一覧へ出す。
    // roster から消えたが対局には残っている ID も落とさない。
    const map = aggregate(target);
    const ids = [...new Set([...roster.map((p) => p.id), ...map.keys()])];
    const rows = ids.map((id) => ({ id, name: nameOf(id), d: map.has(id) ? derive(map.get(id)) : null }));
    // 記録のある人を通算 pt の多い順に。記録の無い人はその後ろへ roster の順で並べる
    rows.sort((x, y) => (x.d ? 0 : 1) - (y.d ? 0 : 1) || (x.d && y.d ? y.d.ptSum - x.d.ptSum : 0));

    if (rows.length === 0) {
      root.append(h("section", { class: "card" }, h("div", { class: "hint" }, "プレイヤーがいません。対局タブで名前を追加してください。")));
      return;
    }

    root.append(
      h(
        "section",
        { class: "card" },
        h("h2", null, `${pc}人麻雀（${target.length}対局）`),
        h(
          "table",
          { class: "rtable" },
          h("thead", null, h("tr", null, h("th", null, "名前"), h("th", null, "対局"), h("th", null, "平均順位"), h("th", null, "通算pt"), h("th", null, "収支"))),
          h(
            "tbody",
            null,
            rows.map((r) =>
              h(
                "tr",
                null,
                h("td", { class: "name" }, h("button", { type: "button", class: "link-btn", onclick: () => props.onPlayer(r.id) }, r.name, " ›")),
                h("td", null, r.d ? String(r.d.games) : "0"),
                h("td", null, r.d ? num(r.d.avgRank, 2) : "—"),
                h("td", { class: "pt" }, r.d ? signed(Math.round(r.d.ptSum * 10) / 10) : "—"),
                h("td", { class: r.d ? signClass(r.d.yenSum) : "" }, r.d ? yen(r.d.yenSum) : "—"),
              ),
            ),
          ),
        ),
        h("div", { class: "hint" }, "名前をタップすると、有効局・和了率・放銃率などの細かい数字と対局一覧を見られます。改名もそこで行います。"),
      ),
      h("div", { class: "hint" }, "対局数が少ないうちは率の差に意味はほとんどありません。対局数と併せて見てください。"),
    );
  }

  render();
  return root;
}
