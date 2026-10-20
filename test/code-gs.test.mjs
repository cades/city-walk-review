import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
const gs = vm.createContext({});
vm.runInContext(source, gs);

test("literal keeps every string as plain text in Sheets", () => {
  assert.equal(gs.literal("3/4 這段沒有人行道"), "'3/4 這段沒有人行道");
  assert.equal(gs.literal("0912345678"), "'0912345678");
  assert.equal(gs.literal("TRUE"), "'TRUE");
  assert.equal(gs.literal("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"x\")");
  assert.equal(gs.literal("終點可以換成公園"), "'終點可以換成公園");
});
