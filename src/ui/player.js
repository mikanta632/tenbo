// プレイヤー個人ページ（docs/design.md §8.5）。通算成績、対局一覧、改名。

import { h, clear } from "./dom.js";
import { aggregate, derive, playerGames } from "../stats.js";
import { fmtPoints, gameDateTime } from "./format.js";

const pct = (x) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (x, d = 1) => (x === null ? "—" : x.toFixed(d));
const signed = (x) => (x > 0 ? `+${x}` : String(x));

/**
 * props: { playerId, roster, games, scopeLabel, scopePc, onBack, onOpenResult(gameId), onRename(playerId, name) }
 * games は戦績タブで選んだ人数（4人／3人）に絞ったもの。scopeLabel はその見出し。
 */
export function renderPlayer(props) {
  const root = h("div", { class: "plain-screen player-screen" });
  let editing = false;

  function render() {
    clear(root);
    const player = props.roster.find((p) => p.id === props.playerId) || { id: props.playerId, name: "?" };
    const nameOf = (id) => (props.roster.find((p) => p.id === id) || { name: "?" }).name;
    const acc = aggregate(props.games).get(props.playerId);
    const d = acc ? derive(acc) : null;
    const list = playerGames(props.games, props.playerId);

    const nameInput = h("input", { type: "text", value: player.name, autocomplete: "off", enterkeyhint: "done" });
    const nameBlock = editing
      ? h(
          "div",
          { class: "row" },
          nameInput,
          h(
            "button",
            {
              type: "button",
              class: "btn-secondary",
              onclick: () => {
                const v = nameInput.value.trim();
                if (v && v !== player.name) props.onRename(player.id, v);
                editing = false;
                render();
              },
            },
            "保存",
          ),
        )
      : h(
          "div",
          { class: "row" },
          h("span", { class: "player-name" }, player.name),
          h("button", { type: "button", class: "btn-flat", onclick: () => {
            editing = true;
            render();
          } }, "改名"),
        );

    root.append(
      h("header", { class: "plain-top" }, h("button", { type: "button", class: "btn-flat", onclick: props.onBack }, "戻る"), h("div", { class: "plain-title" }, "プレイヤー")),
      h("section", { class: "card" }, nameBlock, h("div", { class: "hint" }, "改名しても過去の対局は同じプレイヤーとして扱われます（ID で参照しています）")),
    );

    if (!d) {
      root.append(h("section", { class: "card" }, h("div", { class: "hint" }, `${props.scopeLabel || ""}の対局がありません`)));
      return;
    }

    const kv = (k, v) => h("div", { class: "kv" }, h("span", null, k), h("b", null, v));
    root.append(
      h(
        "section",
        { class: "card" },
        h("h2", null, `${props.scopeLabel ? props.scopeLabel + " " : ""}通算（${d.games}対局）`),
        h(
          "div",
          { class: "kv-grid" },
          kv("平均順位", num(d.avgRank, 2)),
          kv("順位分布", d.rankDist.slice(0, props.scopePc || d.rankDist.length).join(" / ")),
          kv("平均素点", fmtPoints(Math.round(d.avgPoints))),
          kv("通算 pt", signed(Math.round(d.ptSum * 10) / 10)),
          kv("通算 円", signed(d.yenSum)),
          kv("有効局", String(d.effective)),
          kv("和了率", pct(d.agariRate)),
          kv("放銃率", pct(d.houjuRate)),
          kv("リーチ率", pct(d.riichiRate)),
          kv("副露率", pct(d.meldRate)),
          kv("平均和了", d.avgAgari === null ? "—" : fmtPoints(Math.round(d.avgAgari))),
          kv("平均放銃", d.avgHouju === null ? "—" : fmtPoints(Math.round(d.avgHouju))),
        ),
        h("div", { class: "hint" }, "対局数が少ないうちは率の差に意味はほとんどありません。"),
      ),
    );

    const rows = list.map((x) => {
      const g = x.game;
      const date = gameDateTime(g);
      const others = g.seats.filter((id) => id !== props.playerId).map(nameOf).join(" / ");
      return h(
        "button",
        { type: "button", class: "menu-item game-row", onclick: () => props.onOpenResult(g.id) },
        h(
          "span",
          { class: "game-row-main" },
          h("span", { class: `rank-badge r${x.rank + 1}` }, `${x.rank + 1}位`),
          h("span", null, fmtPoints(x.points)),
          h("span", { class: x.pt > 0 ? "plus" : x.pt < 0 ? "minus" : "" }, `${signed(x.pt)}pt`),
          h("span", { class: x.yen > 0 ? "plus" : x.yen < 0 ? "minus" : "" }, `${signed(x.yen)}円`),
        ),
        h("span", { class: "menu-sub" }, `${date} ・ ${g.rule.playerCount}人 ・ ${others}`),
      );
    });
    root.append(h("section", { class: "card" }, h("h2", null, "対局一覧（新しい順）"), h("div", { class: "menu-list" }, rows)));
  }

  render();
  return root;
}
