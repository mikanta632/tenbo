// シート（和了入力・流局・手動修正・メニュー・終局）。docs/design.md §8.3
//
// すべて確定を押すまで点数を動かさない。確定時に onConfirm(event) を呼ぶだけで、
// イベントの発行と保存は app.js が行う。

import { h, clear, append } from "./dom.js";
import { applyEvent, dealerOf, ranksOf } from "../reduce.js";
import { withDeltas } from "../edit.js";
import { fmtPoints, fmtDelta, hanName, windName } from "./format.js";

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

/** 点数移動のプレビュー表 */
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

// ---- 和了入力（§8.3） -----------------------------------------------------
//
// 画面ががたつかないよう、行はすべて常に描画し（使わない行は無効化）、
// 符と役満の詳細は同じ高さのスロットに入れる。シートの高さは固定。

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

function seatLabel(i, state, names) {
  return `${windName(i, state.kyoku, state.points.length)} ${names[i]}`;
}

/**
 * 和了入力シート。seat の和了を入力する。
 * onConfirm(agariEvent) を呼ぶ。event に deltas は含めない（app 側で埋める）。
 */
export function openAgariSheet({ state, rule, names, seat, onConfirm, initial = null }) {
  const n = rule.playerCount;
  const dealer = dealerOf(state.kyoku, n);
  const s = {
    tsumo: true,
    from: null,
    han: 1,
    fu: 30,
    yakuman: false,
    yakumanCount: 1,
    sekininWho: null,
    sekininCount: 1,
    ...(initial || {}),
  };
  const body = h("div", { class: "sheet-body agari-body" });
  const isDealer = seat === dealer;
  const others = [];
  for (let i = 0; i < n; i++) if (i !== seat) others.push(i);

  function buildEvent() {
    const winner = {
      who: seat,
      han: s.yakuman ? 0 : s.han,
      fu: s.yakuman ? 0 : s.fu,
      yakumanCount: s.yakuman ? s.yakumanCount : 0,
      sekinin:
        s.yakuman && rule.sekinin && s.sekininWho !== null
          ? { who: s.sekininWho, yakumanCount: Math.min(s.sekininCount, s.yakumanCount) }
          : null,
      chips: 0,
    };
    return { t: "agari", tsumo: s.tsumo, from: s.tsumo ? null : s.from, winners: [winner] };
  }

  function valid() {
    return s.tsumo || s.from !== null;
  }

  function summaryText() {
    if (s.yakuman) return ["役満", "ダブル役満", "トリプル役満"][s.yakumanCount - 1];
    if (s.han >= 5) return hanName(s.han);
    return `${s.fu}符${s.han}翻`;
  }

  function render() {
    clear(body);

    append(body,
      h(
        "div",
        { class: "who-line" },
        h("span", { class: "who-wind" }, windName(seat, state.kyoku, n)),
        h("span", { class: "who-name" }, names[seat]),
        isDealer ? h("span", { class: "tag" }, "親") : null,
        state.honba > 0 ? h("span", { class: "tag" }, `${state.honba}本場`) : null,
        state.kyotaku > 0 ? h("span", { class: "tag" }, `供託${state.kyotaku}`) : null,
      ),
    );

    // 和了の形
    append(body,
      h("div", { class: "label" }, "和了の形"),
      choice(
        [
          { value: true, label: "ツモ" },
          { value: false, label: "ロン" },
        ],
        s.tsumo,
        (v) => {
          s.tsumo = v;
          render();
        },
        { class: "big" },
      ),
    );

    // 放銃者（ツモのときは無効化して残す）
    append(body,
      h("div", { class: "label" }, s.tsumo ? "放銃者（ツモのため不要）" : "放銃者"),
      choice(
        others.map((i) => ({ value: i, label: seatLabel(i, state, names), disabled: s.tsumo })),
        s.tsumo ? undefined : s.from,
        (v) => {
          s.from = v;
          render();
        },
        { class: "grid3" },
      ),
    );

    // 翻
    append(body,
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
          render();
        },
        { class: "grid5" },
      ),
    );

    // 符 または 役満の詳細（同じ高さのスロット）
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
            render();
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
              render();
            },
          ),
        ),
        h(
          "div",
          { class: "row-inline" },
          h("span", { class: "inline-label" }, "包"),
          choice(
            [
              { value: null, label: "なし", disabled: !sekininOn },
              ...others.map((i) => ({ value: i, label: names[i], disabled: !sekininOn })),
            ],
            sekininOn ? s.sekininWho : undefined,
            (v) => {
              s.sekininWho = v;
              render();
            },
          ),
        ),
        h(
          "div",
          { class: "row-inline" },
          h("span", { class: "inline-label" }, "責任分"),
          choice(
            [1, 2, 3].map((v) => ({
              value: v,
              label: String(v),
              disabled: !sekininOn || s.sekininWho === null || v > s.yakumanCount,
            })),
            sekininOn && s.sekininWho !== null ? s.sekininCount : undefined,
            (v) => {
              s.sekininCount = v;
              render();
            },
          ),
        ),
      );
    }
    append(body, slot);

    // 要約とプレビュー（常に同じ行数）
    let confirmBtn;
    if (valid()) {
      const ev = buildEvent();
      const pv = previewTable({ state, event: ev, rule, names });
      const gain = pv.next.points[seat] - state.points[seat];
      append(body,
        h("div", { class: "summary" }, summaryText(), h("span", { class: "summary-gain" }, ` ${fmtDelta(gain)}`)),
        pv.el,
      );
      confirmBtn = h("button", { type: "button", class: "btn-primary", onclick: () => onConfirm(ev) }, "確定");
    } else {
      append(body,
        h("div", { class: "summary" }, summaryText(), h("span", { class: "summary-gain dim" }, " 放銃者を選んでください")),
        h(
          "div",
          { class: "preview" },
          names.map((name, i) =>
            h("div", { class: "prow-line" }, h("span", { class: "pv-name" }, name), h("span", { class: "pv-delta" }, "—"), h("span", { class: "pv-after" }, fmtPoints(state.points[i]))),
          ),
        ),
      );
      confirmBtn = h("button", { type: "button", class: "btn-primary", disabled: true }, "確定");
    }
    append(body, h("div", { class: "sheet-actions" }, confirmBtn));
  }

  render();
  return openSheet({ title: "和了入力", body, fixed: true });
}

// ---- 流局（段階2は通常の流局のみ） -----------------------------------------

/**
 * 流局入力シート。テンパイ者を選んで確定する。
 */
export function openRyuukyokuSheet({ state, rule, names, onConfirm }) {
  const n = rule.playerCount;
  const tenpai = new Set();
  const body = h("div", { class: "sheet-body" });

  function buildEvent() {
    return {
      t: "ryuukyoku",
      type: "exhaustive",
      abortiveKind: null,
      tenpai: [...tenpai].sort((a, b) => a - b),
      nagashiBy: [],
    };
  }

  function render() {
    clear(body);
    append(body, h("div", { class: "label" }, "テンパイ者（タップで切替）"));
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
    append(body, row);
    const ev = buildEvent();
    const pv = previewTable({ state, event: ev, rule, names });
    const dealer = dealerOf(state.kyoku, n);
    const stays = rule.renchan === "tenpai" && tenpai.has(dealer);
    append(body,
      h("div", { class: "summary" }, stays ? "親テンパイ: 連荘" : "親流れ", `（${state.honba + 1}本場）`),
      pv.el,
      h("div", { class: "sheet-actions" }, h("button", { type: "button", class: "btn-primary", onclick: () => onConfirm(ev) }, "確定")),
    );
  }

  render();
  return openSheet({ title: "流局", body });
}

// ---- 手動修正 -------------------------------------------------------------

/**
 * メニューから開く。対象者を選び、1タップで adjust イベントを発行する。
 * onAdjust(seat, delta)
 */
export function openAdjustSheet({ state, rule, names, onAdjust }) {
  const n = rule.playerCount;
  let seat = null;
  const body = h("div", { class: "sheet-body" });
  const steps = [-1000, -100, 100, 1000];

  function render() {
    clear(body);
    append(body,
      h("div", { class: "label" }, "対象者"),
      choice(
        Array.from({ length: n }, (_, i) => ({ value: i, label: `${seatLabel(i, state, names)} ${fmtPoints(state.points[i])}` })),
        seat,
        (v) => {
          seat = v;
          render();
        },
        { class: "grid2" },
      ),
      h("div", { class: "label" }, "物理点棒に合わせて修正（相手方は指定しない）"),
      h(
        "div",
        { class: "choice big" },
        steps.map((d) =>
          h("button", { type: "button", class: "chip", disabled: seat === null, onclick: () => onAdjust(seat, d) }, fmtDelta(d)),
        ),
      ),
      h("div", { class: "hint" }, "精算時に卓外差額として表示されます"),
    );
  }

  render();
  return openSheet({ title: "手動修正", body });
}

// ---- メニュー ------------------------------------------------------------

export function openMenu({ version, onAdjust, onEndGame, onBackToStart }) {
  const body = h("div", { class: "sheet-body" });
  append(body,
    h(
      "div",
      { class: "menu-list" },
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
export function openOverDialog({ state, rule, names, reason, onSave, onUndo }) {
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
        h(
          "div",
          { class: "prow-line" },
          h("span", { class: "pv-name" }, `${ranks[i] + 1}位 ${names[i]}`),
          h("span", { class: "pv-after" }, fmtPoints(state.points[i])),
        ),
      ),
    ),
    state.kyotaku > 0 ? h("div", { class: "hint" }, `供託 ${state.kyotaku}本が残っています（精算は段階4で扱います）`) : null,
    h(
      "div",
      { class: "sheet-actions two" },
      h("button", { type: "button", class: "btn-secondary", onclick: onUndo }, "戻す"),
      h("button", { type: "button", class: "btn-primary", onclick: onSave }, "保存して終了"),
    ),
  );
  return openSheet({ title: "終局", body, kind: "dialog" });
}

/**
 * アガリやめの選択（§5.6）。
 */
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
