// DOM 生成の小さな補助。フレームワークは使わない。

/**
 * h("div", { class: "x", onclick: fn }, "text", child, [children])
 * 属性: class / on* / dataset / style(文字列) / その他は setAttribute。
 * 値が false / null / undefined の属性は付けない。true は空文字の属性。
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

/** append(el, ...children)。配列は展開し、null / undefined / false は無視する。 */
export function append(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** SVG 要素を文字列から作る */
export function svg(markup) {
  const tpl = document.createElement("template");
  tpl.innerHTML = markup.trim();
  return tpl.content.firstChild;
}
