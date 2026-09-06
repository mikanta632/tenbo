// 初期画面下部のタブバー（docs/design.md §8.1）。対局・設定・戦績・その他。
//
// アイコンは単色の線画（currentColor）にする。絵文字は端末のフォント任せで色も変えられず、
// 選択中の色が乗らないため使わない。選択中はアイコンの後ろに角丸の面を敷く。

import { h, svg } from "./dom.js";

const ICONS = {
  game: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
    <rect x="5.5" y="3" width="13" height="18" rx="2.6"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3.1"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  stats: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true">
    <path d="M6 20v-5M12 20V9M18 20V4"/></svg>`,
  misc: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5.5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18.5" cy="12" r="1.7"/></svg>`,
};

export const TABS = [
  { key: "game", label: "対局" },
  { key: "settings", label: "設定" },
  { key: "stats", label: "戦績" },
  { key: "misc", label: "その他" },
];

/** active のタブを強調したタブバー。onSelect(key) */
export function renderTabBar(active, onSelect) {
  return h(
    "nav",
    { class: "tabbar", role: "tablist" },
    TABS.map((t) =>
      h(
        "button",
        {
          type: "button",
          role: "tab",
          class: `tab${t.key === active ? " on" : ""}`,
          "aria-selected": t.key === active ? "true" : "false",
          onclick: () => onSelect(t.key),
        },
        h("span", { class: "tab-icon", "aria-hidden": "true" }, svg(ICONS[t.key])),
        h("span", { class: "tab-label" }, t.label),
      ),
    ),
  );
}
