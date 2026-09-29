// その他タブのバックアップ欄（src/ui/misc.js）。最後のエクスポートの状態を出し、未エクスポートの対局があれば強調する。docs/design.md §8.1, §9.4

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMisc } from "../src/ui/misc.js";
import { mockDom } from "./support/dom.js";

const props = (backup) => ({
  sound: { enabled: true },
  version: "0.0.0",
  gamesCount: 3,
  backup,
  onSound: () => {},
  onTestSound: () => {},
  onExport: () => {},
  onImport: () => {},
  onCheckUpdate: async () => {},
});

test("最後のエクスポートの状態を出す。未エクスポートの対局があれば強調する", (t) => {
  mockDom(t);
  const warned = renderMisc(props({ text: "2026-09-10 12:00（その後 2件）", warn: true }));
  assert.match(warned.textContent, /最後のエクスポート2026-09-10 12:00（その後 2件）/);
  assert.equal(warned.findAll((el) => el.matches(".warn")).length, 1);

  const calm = renderMisc(props({ text: "2026-09-10 12:00（新しい対局なし）", warn: false }));
  assert.equal(calm.findAll((el) => el.matches(".warn")).length, 0);
});
