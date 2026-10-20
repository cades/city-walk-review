import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMinutes, routeIdFromHash } from "../lib.js";

test("formatMinutes uses 70 m per minute", () => {
  assert.equal(formatMinutes(780), "約 11 分鐘");
  assert.equal(formatMinutes(400), "約 6 分鐘");
});

test("routeIdFromHash decodes Chinese ids", () => {
  assert.equal(routeIdFromHash("#" + encodeURIComponent("新竹區-2")), "新竹區-2");
  assert.equal(routeIdFromHash(""), null);
  assert.equal(routeIdFromHash("#"), null);
});
