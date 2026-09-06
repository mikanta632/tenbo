// シート（和了入力・特殊処理・手動修正・メニュー・終局）。docs/design.md §8.3
//
// すべて確定を押すまで点数を動かさない。確定時に onConfirm(event) を呼ぶだけで、
// イベントの発行と保存は app.js が行う。event に deltas は含めない（app 側で埋める）。
// 各シートは initial（既存イベント）を受け取れる。ログ画面の編集で再利用する。

import { h, clear, append } from "./dom.js";
import { applyEvent, dealerOf, ranksOf } from "../reduce.js";
import { withDeltas } from "../edit.js";
import { fmtPoints, fmtDelta, hanName, windName, ABORTIVE_KIND_NAMES } from "./format.js";

// ---- 共通のシート枠 -----------------------------------------------------

/**
 * 画面下からのシート。body に追加する。戻り値の close() で閉じる。
 */
export function openSheet({ title, body, onClose, kind = "sheet", fixed = false }) {
  const overlay = h("div", { class: `overlay overlay-${kind}` });
  const box = h("div", { class: `${kind}${fixed ? " fixed" : ""}`, role: "dialog", "aria-label": title });
  const closeBtn = h("button", { class: "sheet-close", type: "button", onclick: () => close() }, "閉じる");
  const head = h("div", { class: "sheet-head" }, h("div", { class: "sheet-title" }, title), closeBtn);
  box.append(head, body);
  overlay.append(box);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  function close() {
    overlay.remove();
    if (onClose) onClose();
  }
  return { close, overlay, box };
}

/** 選択ボタンの列。value を選ぶと onSelect(value)。 */
function choice(items, selected, onSelect, { class: cls = "" } = {}) {
  return h(
    "div",
    { class: `choice ${cls}` },
    items.map((it) =>
      h(
        "button",
        {
          type: "button",
          class: `chip${it.value === selected ? " on" : ""}${it.disabled ? " dim" : ""}`,
          disabled: !!it.disabled,
          onclick: () => onSelect(it.value),
        },
        it.label,
      ),
    ),
  );
}

/** 複数選択のトグル列。set を直接書き換えて onChange() を呼ぶ。 */
function toggles(items, set, onChange, { class: cls = "" } = {}) {
  return h(
    "div",
    { class: `choice ${cls}` },
    items.map((it) =>
      h(
        "button",
        {
          type: "button",
          class: `chip${set.has(it.value) ? " on" : ""}${it.disabled ? " dim" : ""}`,
          disabled: !!it.disabled,
          onclick: () => {
            if (set.has(it.value)) set.delete(it.value);
            else set.add(it.value);
            onChange();
          },
        },
        it.label,
      ),
    ),
  );
}

/** 点数移動のプレビュー表（供託・リーチ棒の返却を含めた実際の増減） */
function previewTable({ state, event, rule, names }) {
  const filled = withDeltas(event, state, rule);
  const next = applyEvent(state, filled, rule);
  const n = rule.playerCount;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const d = next.points[i] - state.points[i];
    rows.push(
      h(
        "div",
        { class: `prow-line ${d > 0 ? "plus" : d < 0 ? "minus" : ""}` },
        h("span", { class: "pv-name" }, names[i]),
        h("span", { class: "pv-delta" }, fmtDelta(d)),
        h("span", { class: "pv-after" }, fmtPoints(next.points[i])),
      ),
    );
  }
  return { el: h("div", { class: "preview" }, rows), filled, next };
}

function placeholderPreview({ state, names }) {
  return h(
    "div",
    { class: "preview" },
    names.map((name, i) =>
      h("div", { class: "prow-line" }, h("span", { class: "pv-name" }, name), h("span", { class: "pv-delta" }, "—"), h("span", { class: "pv-after" }, fmtPoints(state.points[i]))),
    ),
  );
}

function seatLabel(i, state, names) {
  return `${windName(i, state.kyoku, state.points.length)} ${names[i]}`;
}

function seatItems(state, names, filter = () => true) {
  const items = [];
  for (let i = 0; i < state.points.length; i++) if (filter(i)) items.push({ value: i, label: seatLabel(i, state, names) });
  return items;
}

function confirmRow(onConfirm, enabled = true) {
  return h(
    "div",
    { class: "sheet-actions" },
    h("button", { type: "button", class: "btn-primary", disabled: !enabled, onclick: onConfirm }, "確定"),
  );
}

// ---- 和了者フォーム（単独・複数で共用） ---------------------------------

const HAN_ITEMS = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
  { value: 5, label: "満貫" },
  { value: 6, label: "跳満" },
  { value: 8, label: "倍満" },
  { value: 11, label: "三倍満" },
  { value: 13, label: "数え役満" },
  { value: "yakuman", label: "役満" },
];
const FU_ITEMS = [20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 110].map((v) => ({ value: v, label: String(v) }));

/** Winner（イベント）→ フォーム状態 */
function winnerState(who, w = null) {
  const s = { who, han: 1, fu: 30, yakuman: false, yakumanCount: 1, sekininWho: null, sekininCount: 1 };
  if (w) {
    if (w.yakumanCount > 0) {
      s.yakuman = true;
      s.yakumanCount = w.yakumanCount;
      if (w.sekinin) {
        s.sekininWho = w.sekinin.who;
        s.sekininCount = w.sekinin.yakumanCount;
      }
    } else {
      s.han = w.han;
      s.fu = w.fu;
    }
  }
  return s;
}

/** フォーム状態 → Winner */
function winnerFromState(s, rule) {
  return {
    who: s.who,
    han: s.yakuman ? 0 : s.han,
    fu: s.yakuman ? 0 : s.fu,
    yakumanCount: s.yakuman ? s.yakumanCount : 0,
    sekinin:
      s.yakuman && rule.sekinin && s.sekininWho !== null
        ? { who: s.sekininWho, yakumanCount: Math.min(s.sekininCount, s.yakumanCount) }
        : null,
    chips: 0,
  };
}

function winnerSummary(s) {
  if (s.yakuman) return ["役満", "ダブル役満", "トリプル役満"][s.yakumanCount - 1];
  if (s.han >= 5) return hanName(s.han);
  return `${s.fu}符${s.han}翻`;
}

/**
 * 翻・符・役満の詳細を入力するフォーム。行は常に同じ位置に描画する。
 * 変更のたびに onChange() を呼ぶ（呼び出し側が再描画する）。
 */
function winnerForm({ s, state, rule, names, onChange }) {
  const n = rule.playerCount;
  const others = [];
  for (let i = 0; i < n; i++) if (i !== s.who) others.push(i);
  const frag = document.createDocumentFragment();

  append(frag,
    h("div", { class: "label" }, "翻"),
    choice(
      HAN_ITEMS,
      s.yakuman ? "yakuman" : s.han,
      (v) => {
        if (v === "yakuman") s.yakuman = true;
        else {
          s.yakuman = false;
          s.han = v;
        }
        onChange();
      },
      { class: "grid5" },
    ),
  );

  const slot = h("div", { class: "slot-detail" });
  if (!s.yakuman) {
    const fuDim = s.han >= 5;
    append(slot,
      h("div", { class: "label" }, fuDim ? `符（${hanName(s.han)}のため不要）` : "符"),
      choice(
        FU_ITEMS.map((it) => ({ ...it, disabled: fuDim })),
        fuDim ? undefined : s.fu,
        (v) => {
          s.fu = v;
          onChange();
        },
        { class: "grid4" },
      ),
    );
  } else {
    const sekininOn = rule.sekinin;
    append(slot,
      h("div", { class: "label" }, "役満"),
      h(
        "div",
        { class: "row-inline" },
        h("span", { class: "inline-label" }, "個数"),
        choice(
          [1, 2, 3].map((v) => ({ value: v, label: ["役満", "ダブル", "トリプル"][v - 1] })),
          s.yakumanCount,
          (v) => {
            s.yakumanCount = v;
            if (s.sekininCount > v) s.sekininCount = v;
            onChange();
          },
        ),
      ),
      h(
        "div",
        { class: "row-inline" },
        h("span", { class: "inline-label" }, "包"),
        choice(
          [{ value: null, label: "なし", disabled: !sekininOn }, ...others.map((i) => ({ value: i, label: names[i], disabled: !sekininOn }))],
          sekininOn ? s.sekininWho : undefined,
          (v) => {
            s.sekininWho = v;
            onChange();
          },
        ),
      ),
      h(
        "div",
        { class: "row-inline" },
        h("span", { class: "inline-label" }, "責任分"),
        choice(
          [1, 2, 3].map((v) => ({ value: v, label: String(v), disabled: !sekininOn || s.sekininWho === null || v > s.yakumanCount })),
          sekininOn && s.sekininWho !== null ? s.sekininCount : undefined,
          (v) => {
            s.sekininCount = v;
            onChange();
          },
        ),
      ),
    );
  }
  frag.append(slot);
  return frag;
}

function whoLine(seat, state, names, extra = []) {
  const n = state.points.length;
  const dealer = dealerOf(state.kyoku, n);
  return h(
    "div",
    { class: "who-line" },
    seat !== null ? h("span", { class: "who-wind" }, windName(seat, state.kyoku, n)) : null,
    seat !== null ? h("span", { class: "who-name" }, names[seat]) : null,
    seat === dealer ? h("span", { class: "tag" }, "親") : null,
    state.honba > 0 ? h("span", { class: "tag" }, `${state.honba}本場`) : null,
    state.kyotaku > 0 ? h("span", { class: "tag" }, `供託${state.kyotaku}`) : null,
    ...extra,
  );
}

// ---- 和了入力（§8.3、単独） -----------------------------------------------

/**
 * 和了入力シート。seat の和了を入力する。initial に既存の agari イベントを渡せる。
 */
export function openAgariSheet({ state, rule, names, seat, onConfirm, initial = null }) {
  const n = rule.playerCount;
  const w0 = initial && initial.winners.find((w) => w.who === seat);
  const s = winnerState(seat, w0);
  const f = { tsumo: initial ? initial.tsumo : true, from: initial ? initial.from : null };
  const body = h("div", { class: "sheet-body agari-body" });
  const others = [];
  for (let i = 0; i < n; i++) if (i !== seat) others.push(i);

  function buildEvent() {
    return { t: "agari", tsumo: f.tsumo, from: f.tsumo ? null : f.from, winners: [winnerFromState(s, rule)] };
  }
  const valid = () => f.tsumo || f.from !== null;

  function render() {
    clear(body);
    append(body, whoLine(seat, state, names));

    append(body,
      h("div", { class: "label" }, "和了の形"),
      choice(
        [
          { value: true, label: "ツモ" },
          { value: false, label: "ロン" },
        ],
        f.tsumo,
        (v) => {
          f.tsumo = v;
          render();
        },
        { class: "big" },
      ),
      h("div", { class: "label" }, f.tsumo ? "放銃者（ツモのため不要）" : "放銃者"),
      choice(
        others.map((i) => ({ value: i, label: seatLabel(i, state, names), disabled: f.tsumo })),
        f.tsumo ? undefined : f.from,
        (v) => {
          f.from = v;
          render();
        },
        { class: "grid3" },
      ),
      winnerForm({ s, state, rule, names, onChange: render }),
    );

    if (valid()) {
      const ev = buildEvent();
      const pv = previewTable({ state, event: ev, rule, names });
      const gain = pv.next.points[seat] - state.points[seat];
      append(body,
        h("div", { class: "summary" }, winnerSummary(s), h("span", { class: "summary-gain" }, ` ${fmtDelta(gain)}`)),
        pv.el,
        confirmRow(() => onConfirm(ev)),
      );
    } else {
      append(body,
        h("div", { class: "summary" }, winnerSummary(s), h("span", { class: "summary-gain dim" }, " 放銃者を選んでください")),
        placeholderPreview({ state, names }),
        confirmRow(null, false),
      );
    }
  }

  render();
  return openSheet({ title: initial ? "和了の編集" : "和了入力", body, fixed: true });
}

// ---- 複数和了（ダブロン・トリロン） -----------------------------------------

/**
 * 複数和了シート。放銃者と、和了者ごとの翻符を入力する。
 */
export function openMultiRonSheet({ state, rule, names, onConfirm, initial = null }) {
  const n = rule.playerCount;
  let from = initial ? initial.from : null;
  const forms = new Map(); // who → winnerState
  if (initial) for (const w of initial.winners) forms.set(w.who, winnerState(w.who, w));
  const body = h("div", { class: "sheet-body" });

  function buildEvent() {
    const winners = [...forms.values()].sort((a, b) => a.who - b.who).map((s) => winnerFromState(s, rule));
    return { t: "agari", tsumo: false, from, winners };
  }
  const valid = () => from !== null && forms.size >= 1 && !forms.has(from);

  function render() {
    clear(body);
    append(body,
      whoLine(null, state, names),
      h("div", { class: "label" }, "放銃者"),
      choice(
        seatItems(state, names),
        from,
        (v) => {
          from = v;
          forms.delete(v);
          render();
        },
        { class: "grid2" },
      ),
      h("div", { class: "label" }, "和了者（タップで追加・解除）"),
    );
    for (let i = 0; i < n; i++) {
      if (i === from) continue;
      const on = forms.has(i);
      append(body,
        h(
          "button",
          {
            type: "button",
            class: `chip wide${on ? " on" : ""}`,
            onclick: () => {
              if (on) forms.delete(i);
              else forms.set(i, winnerState(i));
              render();
            },
          },
          seatLabel(i, state, names),
          on ? h("span", { class: "chip-sub" }, ` ${winnerSummary(forms.get(i))}`) : null,
        ),
      );
      if (on) {
        append(body, h("div", { class: "subform" }, winnerForm({ s: forms.get(i), state, rule, names, onChange: render })));
      }
    }
    if (!rule.multiRon && forms.size > 1) {
      append(body, h("div", { class: "hint" }, "ルールは頭ハネです。放銃者に最も近い1人だけが和了します"));
    }
    if (valid()) {
      const ev = buildEvent();
      const pv = previewTable({ state, event: ev, rule, names });
      append(body, h("div", { class: "summary" }, `${forms.size}人和了`), pv.el, confirmRow(() => onConfirm(ev)));
    } else {
      append(body,
        h("div", { class: "hint" }, from === null ? "放銃者を選んでください" : "和了者を1人以上選んでください"),
        placeholderPreview({ state, names }),
        confirmRow(null, false),
      );
    }
  }

  render();
  return openSheet({ title: "複数和了", body });
}

// ---- 流局 ------------------------------------------------------------------

/** 通常の流局。テンパイ者を選ぶ。 */
export function openRyuukyokuSheet({ state, rule, names, onConfirm, initial = null }) {
  const n = rule.playerCount;
  const tenpai = new Set(initial ? initial.tenpai : []);
  const body = h("div", { class: "sheet-body" });

  function buildEvent() {
    return { t: "ryuukyoku", type: "exhaustive", abortiveKind: null, tenpai: [...tenpai].sort((a, b) => a - b), nagashiBy: [] };
  }

  function render() {
    clear(body);
    append(body, whoLine(null, state, names), h("div", { class: "label" }, "テンパイ者（タップで切替）"));
    const row = h("div", { class: "choice" });
    for (let i = 0; i < n; i++) {
      row.append(
        h(
          "button",
          {
            type: "button",
            class: `chip tall${tenpai.has(i) ? " on" : ""}`,
            onclick: () => {
              if (tenpai.has(i)) tenpai.delete(i);
              else tenpai.add(i);
              render();
            },
          },
          h("span", { class: "chip-wind" }, windName(i, state.kyoku, n)),
          h("span", null, names[i]),
          h("span", { class: "chip-sub" }, tenpai.has(i) ? "テンパイ" : "ノーテン"),
        ),
      );
    }
    const ev = buildEvent();
    const pv = previewTable({ state, event: ev, rule, names });
    const dealer = dealerOf(state.kyoku, n);
    const stays = rule.renchan === "tenpai" && tenpai.has(dealer);
    append(body,
      row,
      h("div", { class: "summary" }, stays ? "親テンパイ: 連荘" : "親流れ", `（${state.honba + 1}本場）`),
      pv.el,
      confirmRow(() => onConfirm(ev)),
    );
  }

  render();
  return openSheet({ title: initial ? "流局の編集" : "流局", body });
}

/** 途中流局。種別を選ぶ。点数移動なし、親は連荘。 */
export function openAbortiveSheet({ state, rule, names, onConfirm, initial = null }) {
  const kinds = (rule.abortiveRyuukyoku && rule.abortiveRyuukyoku.length ? rule.abortiveRyuukyoku : Object.keys(ABORTIVE_KIND_NAMES)).map((k) => ({
    value: k,
    label: ABORTIVE_KIND_NAMES[k] || k,
  }));
  let kind = initial ? initial.abortiveKind : kinds[0].value;
  const body = h("div", { class: "sheet-body" });

  function buildEvent() {
    return { t: "ryuukyoku", type: "abortive", abortiveKind: kind, tenpai: [], nagashiBy: [] };
  }
  function render() {
    clear(body);
    append(body,
      whoLine(null, state, names),
      h("div", { class: "label" }, "種別"),
      choice(kinds, kind, (v) => {
        kind = v;
        render();
      }, { class: "grid2" }),
      h("div", { class: "summary" }, `点数移動なし・親は連荘（${state.honba + 1}本場）`),
      h("div", { class: "hint" }, "供託はそのまま場に残ります"),
      confirmRow(() => onConfirm(buildEvent())),
    );
  }
  render();
  return openSheet({ title: initial ? "途中流局の編集" : "途中流局", body });
}

/** 流し満貫。成立者と（連荘判定用の）テンパイ者を選ぶ。 */
export function openNagashiSheet({ state, rule, names, onConfirm, initial = null }) {
  const n = rule.playerCount;
  const by = new Set(initial ? initial.nagashiBy : []);
  const tenpai = new Set(initial ? initial.tenpai : []);
  const body = h("div", { class: "sheet-body" });

  function buildEvent() {
    return {
      t: "ryuukyoku",
      type: "nagashi",
      abortiveKind: null,
      tenpai: [...tenpai].sort((a, b) => a - b),
      nagashiBy: [...by].sort((a, b) => a - b),
    };
  }
  function render() {
    clear(body);
    const items = seatItems(state, names);
    append(body,
      whoLine(null, state, names),
      h("div", { class: "label" }, "流し満貫の成立者"),
      toggles(items, by, render, { class: "grid2" }),
      h("div", { class: "label" }, "テンパイ者（連荘の判定に使う。テンパイ料は発生しない）"),
      toggles(items, tenpai, render, { class: "grid2" }),
    );
    if (by.size > 0) {
      const ev = buildEvent();
      const pv = previewTable({ state, event: ev, rule, names });
      const dealer = dealerOf(state.kyoku, n);
      const stays = rule.renchan === "tenpai" && tenpai.has(dealer);
      append(body, h("div", { class: "summary" }, stays ? "親テンパイ: 連荘" : "親流れ", `（${state.honba + 1}本場）`), pv.el, confirmRow(() => onConfirm(ev)));
    } else {
      append(body, h("div", { class: "hint" }, "成立者を選んでください"), placeholderPreview({ state, names }), confirmRow(null, false));
    }
  }
  render();
  return openSheet({ title: initial ? "流し満貫の編集" : "流し満貫", body });
}

// ---- チョンボ ----------------------------------------------------------------

/** チョンボ。誰がチョンボしたかを選ぶ。manual ルールなら deltas を直接指定する。 */
export function openChomboSheet({ state, rule, names, onConfirm, initial = null }) {
  const n = rule.playerCount;
  let who = initial ? initial.who : null;
  const manual = rule.chomboRule === "manual";
  const deltas = initial && manual && initial.deltas ? initial.deltas.slice() : new Array(n).fill(0);
  const body = h("div", { class: "sheet-body" });

  function buildEvent() {
    const ev = { t: "chombo", who };
    if (manual) ev.deltas = deltas.slice();
    return ev;
  }
  function render() {
    clear(body);
    append(body,
      whoLine(null, state, names),
      h("div", { class: "label" }, "チョンボした人"),
      choice(seatItems(state, names), who, (v) => {
        who = v;
        render();
      }, { class: "grid2" }),
    );
    if (manual) {
      append(body, h("div", { class: "label" }, "点数移動を直接指定"));
      for (let i = 0; i < n; i++) {
        append(body,
          h(
            "div",
            { class: "row-inline" },
            h("span", { class: "inline-label" }, names[i]),
            h(
              "div",
              { class: "choice nowrap" },
              [-1000, -100, 100, 1000].map((d) =>
                h("button", { type: "button", class: "chip", onclick: () => {
                  deltas[i] += d;
                  render();
                } }, fmtDelta(d)),
              ),
            ),
            h("span", { class: "inline-value" }, fmtDelta(deltas[i])),
          ),
        );
      }
    }
    if (who !== null) {
      const ev = buildEvent();
      const pv = previewTable({ state, event: ev, rule, names });
      const riichiBack = state.round.riichi.filter(Boolean).length;
      append(body,
        h("div", { class: "summary" }, "この局はなかったことにする（局・本場は据え置き）"),
        riichiBack > 0 ? h("div", { class: "hint" }, `この局のリーチ棒 ${riichiBack}本は宣言者に戻ります`) : null,
        pv.el,
        confirmRow(() => onConfirm(ev)),
      );
    } else {
      append(body, h("div", { class: "hint" }, "チョンボした人を選んでください"), placeholderPreview({ state, names }), confirmRow(null, false));
    }
  }
  render();
  return openSheet({ title: initial ? "チョンボの編集" : "チョンボ", body });
}

// ---- 特殊終局の入口 ----------------------------------------------------------

/**
 * 特殊終局の種類を選ぶ。onPick(kind) の kind は
 * "ryuukyoku" | "abortive" | "nagashi" | "multiRon" | "chombo" | "adjust"
 */
export function openSpecialMenu({ rule, onPick, title = "特殊終局", withAdjust = true, withAgari = false }) {
  const items = [
    withAgari ? ["agari", "和了（1人）", "ツモ・ロン"] : null,
    ["ryuukyoku", "流局", "テンパイ料と連荘"],
    ["abortive", "途中流局", "九種九牌・四風連打など"],
    ["nagashi", "流し満貫", "成立者に満貫"],
    ["multiRon", "複数和了", "ダブロン・トリロン"],
    ["chombo", "チョンボ", "罰符を払って局をやり直す"],
    withAdjust ? ["adjust", "手動修正", "点棒とのズレを直す"] : null,
  ].filter(Boolean);
  const body = h("div", { class: "sheet-body" });
  append(body,
    h(
      "div",
      { class: "menu-list" },
      items.map(([kind, label, sub]) =>
        h("button", { type: "button", class: "menu-item", onclick: () => onPick(kind) }, label, h("span", { class: "menu-sub" }, sub)),
      ),
    ),
  );
  return openSheet({ title, body });
}

/**
 * 既存の局末イベントを編集するシートを、イベントの種類に応じて開く。
 */
export function openEventEditor({ event, state, rule, names, onConfirm }) {
  const p = { state, rule, names, onConfirm, initial: event };
  if (event.t === "agari") {
    if (event.tsumo || event.winners.length === 1) return openAgariSheet({ ...p, seat: event.winners[0].who });
    return openMultiRonSheet(p);
  }
  if (event.t === "ryuukyoku") {
    if (event.type === "abortive") return openAbortiveSheet(p);
    if (event.type === "nagashi") return openNagashiSheet(p);
    return openRyuukyokuSheet(p);
  }
  if (event.t === "chombo") return openChomboSheet(p);
  throw new Error("編集できないイベント: " + event.t);
}

// ---- 手動修正 -------------------------------------------------------------

/**
 * 対象者を選び、実際の持ち点を直接入力する。差分を adjust イベントとして発行する。onAdjust(seat, delta)
 */
export function openAdjustSheet({ state, rule, names, onAdjust }) {
  const n = rule.playerCount;
  let seat = null;
  let text = "";
  const body = h("div", { class: "sheet-body" });

  function parsed() {
    const normalized = String(text).replace(/[,，\s]/g, "");
    if (!normalized) return null;
    const v = Number(normalized);
    return Number.isSafeInteger(v) ? v : null;
  }

  function render() {
    clear(body);
    const v = parsed();
    const delta = seat !== null && v !== null ? v - state.points[seat] : null;
    const input = h("input", {
      type: "text",
      inputmode: "numeric",
      class: "points-input",
      placeholder: seat === null ? "先に対象者を選ぶ" : "実際の点数",
      value: text,
      disabled: seat === null,
      oninput: (e) => {
        text = e.target.value;
        // 再描画せずに差分表示だけ更新する（入力中のキーボードを閉じない）
        const p = parsed();
        deltaEl.textContent = p === null ? "—" : fmtDelta(p - state.points[seat]);
        confirmBtn.disabled = p === null || p === state.points[seat];
      },
    });
    const deltaEl = h("span", { class: "inline-value" }, delta === null ? "—" : fmtDelta(delta));
    const confirmBtn = h(
      "button",
      { type: "button", class: "btn-primary", disabled: delta === null || delta === 0, onclick: () => onAdjust(seat, parsed() - state.points[seat]) },
      "確定",
    );
    append(body,
      h("div", { class: "label" }, "対象者"),
      choice(
        Array.from({ length: n }, (_, i) => ({ value: i, label: `${seatLabel(i, state, names)} ${fmtPoints(state.points[i])}` })),
        seat,
        (s) => {
          seat = s;
          text = String(state.points[s]);
          render();
          body.querySelector(".points-input")?.select();
        },
        { class: "grid2" },
      ),
      h("div", { class: "label" }, "実際の点数（物理点棒の額をそのまま入力）"),
      h("div", { class: "row-inline" }, input, h("span", { class: "inline-label" }, "差分"), deltaEl),
      h("div", { class: "hint" }, "相手方は指定しません。差分は精算時に卓外差額として表示されます"),
      h("div", { class: "sheet-actions" }, confirmBtn),
    );
  }

  render();
  return openSheet({ title: "手動修正", body });
}

// ---- メニュー ------------------------------------------------------------

export function openMenu({ version, soundOn, onToggleSound, onTestSound, onAdjust, onEndGame, onBackToStart }) {
  const body = h("div", { class: "sheet-body" });
  append(body,
    h(
      "div",
      { class: "menu-list" },
      h(
        "button",
        { type: "button", class: "menu-item", onclick: onToggleSound },
        `効果音: ${soundOn ? "オン" : "オフ"}`,
        h("span", { class: "menu-sub" }, "リーチは音声、副露は電子音。タップで切替"),
      ),
      soundOn ? h("button", { type: "button", class: "menu-item", onclick: onTestSound }, "効果音を試す") : null,
      h("button", { type: "button", class: "menu-item", onclick: onAdjust }, "手動修正（点棒とのズレを直す）"),
      h("button", { type: "button", class: "menu-item", onclick: onEndGame }, "対局を終了する（手動終局）"),
      h("button", { type: "button", class: "menu-item", onclick: onBackToStart }, "開始画面へ戻る（対局は保持）"),
    ),
    h("div", { class: "hint" }, `版 ${version}`),
  );
  return openSheet({ title: "メニュー", body });
}

// ---- 終局 -----------------------------------------------------------------

/**
 * 終局ダイアログ。順位と持ち点を表示し、保存して終了するか、戻すかを選ぶ。
 */
export function openOverDialog({ state, rule, names, reason, onSave, onUndo, onDiscard }) {
  const n = rule.playerCount;
  const ranks = ranksOf(state.points);
  const order = [...Array(n).keys()].sort((a, b) => ranks[a] - ranks[b]);
  const body = h("div", { class: "sheet-body" });
  append(body,
    h("div", { class: "summary" }, reason),
    h(
      "div",
      { class: "preview" },
      order.map((i) =>
        h("div", { class: "prow-line" }, h("span", { class: "pv-name" }, `${ranks[i] + 1}位 ${names[i]}`), h("span", { class: "pv-after" }, fmtPoints(state.points[i]))),
      ),
    ),
    state.kyotaku > 0 ? h("div", { class: "hint" }, `供託 ${state.kyotaku}本が残っています（${rule.finalKyotaku === "remain" ? "場に残します" : "トップに加算します"}）`) : null,
    h(
      "div",
      { class: "sheet-actions two" },
      h("button", { type: "button", class: "btn-secondary", onclick: onUndo }, "戻す"),
      h("button", { type: "button", class: "btn-primary", onclick: onSave }, "保存して終了"),
    ),
    onDiscard
      ? h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn-secondary danger", onclick: onDiscard }, "保存せずに終了（この対局を破棄）"))
      : null,
  );
  return openSheet({ title: "終局", body, kind: "dialog" });
}

/** アガリやめの選択（§5.6）。 */
export function openAgariYameDialog({ dealerName, onYame, onContinue }) {
  const body = h("div", { class: "sheet-body" });
  append(body,
    h("div", { class: "summary" }, `オーラスで親（${dealerName}）がトップです`),
    h("div", { class: "hint" }, "アガリやめにしますか？ 続ける場合はそのまま次局へ進みます。"),
    h(
      "div",
      { class: "sheet-actions two" },
      h("button", { type: "button", class: "btn-secondary", onclick: onContinue }, "続ける"),
      h("button", { type: "button", class: "btn-primary", onclick: onYame }, "やめる（終局）"),
    ),
  );
  return openSheet({ title: "アガリやめ", body, kind: "dialog" });
}

/** 確認ダイアログ */
export function openConfirm({ title, message, okLabel = "OK", onOk }) {
  const body = h("div", { class: "sheet-body" });
  let sheet;
  append(body,
    h("div", { class: "summary" }, message),
    h(
      "div",
      { class: "sheet-actions two" },
      h("button", { type: "button", class: "btn-secondary", onclick: () => sheet.close() }, "キャンセル"),
      h(
        "button",
        {
          type: "button",
          class: "btn-primary",
          onclick: () => {
            sheet.close();
            onOk();
          },
        },
        okLabel,
      ),
    ),
  );
  sheet = openSheet({ title, body, kind: "dialog" });
  return sheet;
}

/**
 * 選んだ対局をまとめた収支と支払い（§8.5）。
 * props: { count, players: [{ name, games, pt, yen }], transfers: [{from,to,amount}] }
 * transfers の from / to は players の添字。null は卓外。
 */
export function openCombinedSettlement({ count, players, transfers }) {
  const signed = (x) => (x > 0 ? `+${x}` : String(x));
  const label = (i) => (i === null ? "卓外" : players[i].name);
  const body = h("div", { class: "sheet-body" });
  append(body,
    h("div", { class: "hint" }, `選んだ ${count}対局の合計です。`),
    h(
      "table",
      { class: "rtable" },
      h("thead", null, h("tr", null, h("th", null, "名前"), h("th", null, "対局"), h("th", null, "pt"), h("th", null, "収支"))),
      h(
        "tbody",
        null,
        players.map((p) =>
          h(
            "tr",
            null,
            h("td", { class: "name" }, p.name),
            h("td", null, String(p.games)),
            h("td", null, signed(Math.round(p.pt * 10) / 10)),
            h("td", { class: p.yen > 0 ? "plus" : p.yen < 0 ? "minus" : "" }, `${signed(p.yen)}円`),
          ),
        ),
      ),
    ),
    h("div", { class: "summary" }, "支払い"),
    transfers.length
      ? transfers.map((t) => h("div", { class: "transfer" }, h("span", null, `${label(t.from)} → ${label(t.to)}`), h("span", { class: "amt" }, `${t.amount.toLocaleString("ja-JP")}円`)))
      : h("div", { class: "hint" }, "支払いはありません"),
  );
  return openSheet({ title: "まとめて精算", body });
}

/** 選択肢だけのシート（ログ画面の行操作など）。items: [{ label, sub?, onPick, danger? }] */
export function openActionSheet({ title, items }) {
  const body = h("div", { class: "sheet-body" });
  let sheet;
  append(body,
    h(
      "div",
      { class: "menu-list" },
      items.map((it) =>
        h(
          "button",
          {
            type: "button",
            class: `menu-item${it.danger ? " danger" : ""}`,
            onclick: () => {
              sheet.close();
              it.onPick();
            },
          },
          it.label,
          it.sub ? h("span", { class: "menu-sub" }, it.sub) : null,
        ),
      ),
    ),
  );
  sheet = openSheet({ title, body });
  return sheet;
}
