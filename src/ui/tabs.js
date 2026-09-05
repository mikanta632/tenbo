// 初期画面下部のタブバー（docs/design.md §8.1）。対局・設定・戦績・その他。

import { h } from "./dom.js";

export const TABS = [
  { key: "game", label: "対局", icon: "🀄" },
  { key: "settings", label: "設定", icon: "⚙" },
  { key: "stats", label: "戦績", icon: "📊" },
  { key: "misc", label: "その他", icon: "…" },
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
        h("span", { class: "tab-icon", "aria-hidden": "true" }, t.icon),
        h("span", { class: "tab-label" }, t.label),
      ),
    ),
  );
}
