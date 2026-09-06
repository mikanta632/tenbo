// UI のイベントハンドラを Node 上で検証するための最小 DOM。
export class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.disabled = false; this.scrollTop = 0; this.dataset = {}; }
  append(...children) {
    for (const child of children) {
      if (child instanceof Element) child.parentElement = this;
      this.children.push(child);
    }
  }
  setAttribute(key, value) { this[key] = ["disabled", "checked"].includes(key) ? true : value; }
  addEventListener(type, fn) { this.handlers[type] = fn; }
  get firstChild() { return this.children[0]; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  remove() { this.parentElement?.removeChild(this); }
  select() {}
  set innerHTML(value) { this.content = { firstChild: new Element("svg") }; }
  get textContent() { return this.children.map((c) => c instanceof Element ? c.textContent : String(c)).join(""); }
  set textContent(value) { this.children = [String(value)]; }
  matches(selector) { return selector.startsWith(".") ? (this.className || "").split(" ").includes(selector.slice(1)) : this.tag === selector; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  querySelector(selector) { return this.find((el) => el.matches(selector)); }
  find(predicate) { return this.findAll(predicate)[0]; }
  findAll(predicate) { return [...(predicate(this) ? [this] : []), ...this.children.flatMap((c) => c instanceof Element ? c.findAll(predicate) : [])]; }
}

export function mockDom(t) {
  const previous = Object.fromEntries(["Node", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  globalThis.Node = Element;
  globalThis.document = { createElement: (tag) => new Element(tag), body: new Element("body") };
}

export const button = (root, text) => root.find((el) => el.tag === "button" && el.textContent === text);
