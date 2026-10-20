import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml, formatMinutes, groupRoutes, isAuthError, isInAppBrowser, openCountsByRoute, routeIdFromHash,
} from "../lib.js";

test("formatMinutes uses 70 m per minute", () => {
  assert.equal(formatMinutes(780), "約 11 分鐘");
  assert.equal(formatMinutes(400), "約 6 分鐘");
});

test("routeIdFromHash decodes Chinese ids", () => {
  assert.equal(routeIdFromHash("#" + encodeURIComponent("新竹區-2")), "新竹區-2");
  assert.equal(routeIdFromHash(""), null);
  assert.equal(routeIdFromHash("#"), null);
});

test("groupRoutes follows circle order and can keep only flagged routes", () => {
  const routes = [{ id: "A", flags: [] }, { id: "B", flags: [{}] }, { id: "C", flags: [] }];
  const circles = [{ name: "甲圈", routes: ["B", "A"] }, { name: "乙圈", routes: ["C"] }];
  const shape = (groups) => groups.map((g) => [g.name, g.routes.map((r) => r.id)]);
  assert.deepEqual(shape(groupRoutes(routes, circles)), [["甲圈", ["B", "A"]], ["乙圈", ["C"]]]);
  assert.deepEqual(shape(groupRoutes(routes, circles, true)), [["甲圈", ["B"]]]);
});

test("isInAppBrowser detects LINE, Facebook, Instagram", () => {
  assert.ok(isInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.18.0"));
  assert.ok(isInAppBrowser("Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/430.0]"));
  assert.ok(isInAppBrowser("Mozilla/5.0 (Linux; Android 14) Instagram 300.0"));
  assert.ok(!isInAppBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"));
});

test("escapeHtml neutralises markup", () => {
  assert.equal(escapeHtml('<script>alert("x")</script>&'), "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;");
});

test("openCountsByRoute counts only unhandled comments", () => {
  const comments = [{ routeId: "A", status: "未處理" }, { routeId: "A", status: "已處理" }, { routeId: "B", status: "未處理" }];
  assert.deepEqual([...openCountsByRoute(comments)], [["A", 1], ["B", 1]]);
});

test("isAuthError", () => {
  assert.ok(isAuthError({ ok: false, error: "auth" }));
  assert.ok(!isAuthError({ ok: false, error: "not_member" }));
});
