// プレイヤー個人ページ（docs/design.md §8.5）。通算成績、対局一覧、改名。

import { h, clear, svg } from "./dom.js";
import { aggregate, derive, playerGames } from "../stats.js";
import { fmtPoints, fmtDelta, gameDateTime, fmtPt, fmtYen, rankBadgeClass } from "./format.js";

const pct = (x) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const num = (x, d = 1) => (x === null ? "—" : x.toFixed(d));

/**
 * 累積 pt の系列。list は新しい順なので古い順に直し、0 から積み上げる。
 * 繰越（旧アプリ分）は対局単位を持たないので、この系列には入らない。
 */
export function ptSeries(list) {
  const values = [0];
  let sum = 0;
  for (const x of [...list].reverse()) values.push((sum += x.pt));
  return values;
}

/** 順位分布の帯グラフ（§8.5）。ラス（人数によって3位か4位）だけ赤にする */
function rankBar(rankDist, pc, games) {
  if (!games) return null;
  const dist = rankDist.slice(0, pc);
  const cls = (i) => `r${i + 1}${i === pc - 1 ? " last" : ""}`;
  return h(
    "div",
    { class: "rank-bar-wrap" },
    h("div", { class: "rank-bar" }, dist.map((count, i) => h("span", { class: `rank-seg ${cls(i)}`, style: `flex: ${count} 0 0` }))),
    h(
      "div",
      { class: "rank-legend" },
      dist.map((count, i) => h("span", { class: "rank-legend-item" }, h("i", { class: `rank-dot ${cls(i)}` }), `${i + 1}位 ${count}`)),
    ),
  );
}

/**
 * 目盛り（§8.5）。min〜max をおよそ target 個に区切る 1・2・5×10^k の刻みと、それで広げた範囲を返す。
 */
export function niceTicks(min, max, target = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((x) => x >= raw - 1e-9);
  const lo = Math.floor(min / step + 1e-9) * step;
  const hi = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let k = Math.round(lo / step); k <= Math.round(hi / step); k++) ticks.push(Number((k * step).toPrecision(12)));
  return { lo, hi, step, ticks };
}

/**
 * 累積 pt の折れ線（§8.5）。SVG を組み立てるだけ。
 * 縦軸は pt の目盛りと格子線（0 の線だけ濃く）、横軸は対局数。終点に丸と今の累積 pt を添える。
 */
function ptChart(list) {
  const W = 320;
  const H = 170;
  const T = 10;
  const B = 22; // 横軸の目盛りの高さ
  const values = ptSeries(list);
  const n = values.length - 1; // 対局数。系列は 0 から始まる
  const y = niceTicks(Math.min(...values), Math.max(...values), 5); // 0 は必ず範囲に入る
  const last = values[n];
  // 左は縦軸の目盛り、右は終点の値の幅。桁が増えてもはみ出さないよう文字数で決める
  const L = 12 + Math.max(...y.ticks.map((v) => fmtPt(v).length)) * 6;
  const R = 16 + fmtPt(last).length * 8;
  const xStep = Math.max(1, Math.ceil(niceTicks(0, n).step));
  const px = (i) => L + (i * (W - L - R)) / Math.max(n, 1);
  const py = (v) => T + ((y.hi - v) * (H - T - B)) / (y.hi - y.lo);
  const color = last > 0 ? "#7fe3a1" : last < 0 ? "#ff9d8c" : "#b9c9bf";
  const muted = "#b9c9bf";
  const f = (v) => v.toFixed(1);

  const grid = y.ticks
    .map((v) => {
      const yy = f(py(v));
      const stroke = v === 0 ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)";
      return `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="${stroke}" stroke-width="1"/>
    <text x="${L - 6}" y="${yy}" font-size="10" fill="${muted}" text-anchor="end" dominant-baseline="middle">${fmtPt(v)}</text>`;
    })
    .join("");
  const xTicks = [];
  for (let i = 0; i <= n; i += xStep) xTicks.push(i);
  const xAxis = xTicks
    .map((i, k) => `<text x="${f(px(i))}" y="${H - 6}" font-size="10" fill="${muted}" text-anchor="middle">${i}${k === xTicks.length - 1 ? "局" : ""}</text>`)
    .join("");
  const points = values.map((v, i) => `${f(px(i))},${f(py(v))}`).join(" ");
  // 今の値は終点の右に置く。上下にはみ出さないよう寄せる
  const labelY = Math.min(Math.max(py(last), T + 6), H - B - 4);
  return svg(`<svg class="pt-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="累積 pt の推移。${n}対局で ${fmtPt(last)}">
    ${grid}
    ${xAxis}
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${f(px(n))}" cy="${f(py(last))}" r="4.5" fill="${color}" stroke="#0e2a1c" stroke-width="2"/>
    <text class="pt-chart-now" x="${f(px(n) + 9)}" y="${f(labelY)}" font-size="13" font-weight="700" fill="#f4f4f4" dominant-baseline="middle">${fmtPt(last)}</text>
  </svg>`);
}

/**
 * props: { playerId, roster, games, carry, scopeLabel, scopePc, onBack, onOpenResult(gameId), onRename(playerId, name) }
 * games は戦績タブで選んだ人数（4人／3人）に絞ったもの。carry も同じ人数に絞る。scopeLabel はその見出し。
 */
export function renderPlayer(props) {
  const root = h("div", { class: "plain-screen player-screen" });
  let editing = false;

  function render() {
    clear(root);
    const player = props.roster.find((p) => p.id === props.playerId) || { id: props.playerId, name: "?" };
    const nameOf = (id) => (props.roster.find((p) => p.id === id) || { name: "?" }).name;
    const acc = aggregate(props.games, props.carry || []).get(props.playerId);
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
          } }, "名前を編集"),
        );

    root.append(
      h("header", { class: "plain-top" }, h("button", { type: "button", class: "btn-flat", onclick: props.onBack }, "戻る"), h("div", { class: "plain-title" }, "プレイヤー")),
      h("section", { class: "card" }, nameBlock),
    );

    if (!d) {
      root.append(h("section", { class: "card" }, h("div", { class: "hint" }, `${props.scopeLabel || ""}の対局がありません`)));
      return;
    }

    const kv = (k, v) => h("div", { class: "kv" }, h("span", null, k), h("b", null, v));
    const pts = (x) => (x === null ? "—" : fmtPoints(Math.round(x)));
    const pc = props.scopePc || 4;
    const renRate = d.games > 0 ? (d.rankDist[0] + d.rankDist[1]) / d.games : null;
    const lastRate = d.games > 0 ? d.rankDist[pc - 1] / d.games : null;
    const grid = (...items) => h("div", { class: "kv-grid" }, items);
    const card = (title, ...body) => h("section", { class: "card" }, h("h2", null, title), body);
    const sub = (title) => h("h3", null, title);

    root.append(
      card(
        `${props.scopeLabel ? props.scopeLabel + " " : ""}通算（${d.games}対局）`,
        grid(
          kv("平均順位", num(d.avgRank, 2)),
          kv("連対率", pct(renRate)),
          kv("ラス率", pct(lastRate)),
          kv("トビ率", pct(d.tobiRate)),
          kv("平均素点", pts(d.avgPoints)),
          kv("最高素点", pts(d.maxPoints)),
          kv("通算 pt", fmtPt(Math.round(d.ptSum * 10) / 10)),
          kv("通算 円", fmtYen(d.yenSum)),
          kv("通算チップ", `${fmtDelta(d.chipSum || 0)}枚`),
        ),
        rankBar(d.rankDist, pc, d.games),
      ),
      card(
        `局（有効局 ${d.effective}）`,
        grid(
          kv("和了率", pct(d.agariRate)),
          kv("放銃率", pct(d.houjuRate)),
          kv("リーチ率", pct(d.riichiRate)),
          kv("副露率", pct(d.meldRate)),
          kv("加点率", pct(d.plusRate)),
          kv("失点率", pct(d.minusRate)),
        ),
      ),
      card(
        "内訳",
        sub(`和了（${d.agariCount}回）`),
        grid(
          kv("ツモ率", pct(d.tsumoRate)),
          kv("平均打点", pts(d.avgAgari)),
          kv("リーチ時", pts(d.avgRiichiAgari)),
          kv("副露時", pts(d.avgMeldAgari)),
          kv("ダマ時", pts(d.avgDamaAgari)),
        ),
        sub(`放銃（${d.houjuCount}回）`),
        grid(
          kv("平均放銃", pts(d.avgHouju)),
          kv("リーチ中", pct(d.houjuRiichiRate)),
          kv("副露中", pct(d.houjuMeldRate)),
          kv("ダマ", pct(d.houjuDamaRate)),
        ),
        sub(`リーチ（${d.riichiCount}局）`),
        grid(kv("和了", pct(d.riichiAgariRate)), kv("放銃", pct(d.riichiHoujuRate)), kv("流局", pct(d.riichiRyuukyokuRate))),
        sub(`副露（${d.meldCount}局）`),
        grid(kv("和了", pct(d.meldAgariRate)), kv("放銃", pct(d.meldHoujuRate)), kv("流局", pct(d.meldRyuukyokuRate))),
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
          h("span", { class: rankBadgeClass(x.rank, g.rule.playerCount) }, `${x.rank + 1}位`),
          h("span", null, fmtPoints(x.points)),
          h("span", { class: x.pt > 0 ? "plus" : x.pt < 0 ? "minus" : "" }, `${fmtPt(x.pt)}pt`),
          h("span", { class: x.yen > 0 ? "plus" : x.yen < 0 ? "minus" : "" }, `${fmtYen(x.yen)}円`),
        ),
        h("span", { class: "menu-sub" }, `${date} ・ ${g.rule.playerCount}人 ・ ${others}`),
      );
    });

    if (list.length >= 2) {
      root.append(h("section", { class: "card" }, h("h2", null, `pt の推移（${list.length}対局）`), ptChart(list)));
    }
    if (rows.length > 0) root.append(h("section", { class: "card" }, h("h2", null, "対局一覧（新しい順）"), h("div", { class: "menu-list" }, rows)));
  }

  render();
  return root;
}
