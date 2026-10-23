import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTimeline, describeMoment, escapeHtml, filterRoutes, formatMinutes, groupRoutes, isAuthError, isInAppBrowser, headingTo, latLngOf,
  metersPerPixel, minuteMarks, neighborRoutes, offsetPath, openCountsByRoute, positionAt, routeIdFromHash, stepTarget, timetable,
  trailPieces, walkedPart,
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

const searchGroups = [
  { name: "花東圈", routes: [
    { id: "花蓮區", district: "花蓮區", title: "花蓮區：美崙松園線" },
    { id: "台東區", district: "台東區", title: "台東區：臺東鐵花線" },
  ] },
  { name: "北三圈", routes: [
    { id: "北南一區", district: "北南一區", title: "北南一區：景美梘尾線" },
    { id: "北南二區", district: "北南二區", title: "北南二區：新店瑠公圳線" },
  ] },
  { name: "台南一圈", routes: [{ id: "台南北區", district: "台南北區", title: "台南北區：鹽水月津港線" }] },
  { name: "離島", routes: [{ id: "基宜圈_馬祖", district: "基宜圈_馬祖", title: "馬祖（基宜圈）：Niujiao Harbour Walk" }] },
];
const searchShape = (groups) => groups.map((g) => [g.name, g.routes.map((r) => r.id)]);

test("filterRoutes returns every group when the query is blank", () => {
  assert.equal(filterRoutes(searchGroups, ""), searchGroups);
  assert.equal(filterRoutes(searchGroups, " \u3000 "), searchGroups);
});

test("filterRoutes matches district or route name and drops empty circles", () => {
  assert.deepEqual(searchShape(filterRoutes(searchGroups, "景美")), [["北三圈", ["北南一區"]]]);
  assert.deepEqual(searchShape(filterRoutes(searchGroups, "基宜")), [["離島", ["基宜圈_馬祖"]]]);
  assert.deepEqual(filterRoutes(searchGroups, "不存在的地方"), []);
});

test("filterRoutes ignores surrounding spaces, including full-width ones", () => {
  assert.deepEqual(searchShape(filterRoutes(searchGroups, "  景美\u3000")), [["北三圈", ["北南一區"]]]);
});

test("filterRoutes ignores English case and full-width letters", () => {
  const harbour = [["離島", ["基宜圈_馬祖"]]];
  assert.deepEqual(searchShape(filterRoutes(searchGroups, "harbour")), harbour);
  assert.deepEqual(searchShape(filterRoutes(searchGroups, "HARBOUR walk")), harbour);
  assert.deepEqual(searchShape(filterRoutes(searchGroups, "ＨＡＲＢＯＵＲ")), harbour);
});

test("filterRoutes treats 臺 and 台 as the same character", () => {
  assert.deepEqual(searchShape(filterRoutes(searchGroups, "臺南北")), [["台南一圈", ["台南北區"]]]);
});

test("filterRoutes keeps a whole circle when the circle name matches", () => {
  assert.deepEqual(searchShape(filterRoutes(searchGroups, "花東")), [["花東圈", ["花蓮區", "台東區"]]]);
});

const neighborCircles = [
  { name: "花東圈", routes: ["花蓮區", "台東區"] },
  { name: "蘭陽圈", routes: ["宜蘭區", "羅東區", "蘇澳區"] },
  { name: "離島", routes: ["基宜圈_馬祖"] },
];

test("neighborRoutes gives the routes before and after inside a circle", () => {
  assert.deepEqual(neighborRoutes(neighborCircles, "羅東區"), { prev: "宜蘭區", next: "蘇澳區" });
});

test("neighborRoutes crosses into the next and previous circle", () => {
  assert.deepEqual(neighborRoutes(neighborCircles, "台東區"), { prev: "花蓮區", next: "宜蘭區" });
  assert.deepEqual(neighborRoutes(neighborCircles, "宜蘭區"), { prev: "台東區", next: "羅東區" });
});

test("neighborRoutes has no previous route for the first and no next route for the last", () => {
  assert.deepEqual(neighborRoutes(neighborCircles, "花蓮區"), { prev: null, next: "台東區" });
  assert.deepEqual(neighborRoutes(neighborCircles, "基宜圈_馬祖"), { prev: "蘇澳區", next: null });
});

const stepRoutes = [
  { id: "北南一區", district: "北南一區", title: "北南一區：景美溪線" },
  { id: "基隆北區", district: "基隆北區", title: "基隆北區：梓桑古厝線" },
  { id: "基隆北區-2", district: "基隆北區", title: "基隆北區：三連棟線" },
  { id: "基隆東區", district: "基隆東區", title: "基隆東區：正濱港灣線" },
  { id: "基宜圈_馬祖", district: "基宜圈_馬祖", title: "馬祖（基宜圈）：牛角聚落線" },
];

test("stepTarget names the line when the neighbor route is in the same district", () => {
  assert.deepEqual(stepTarget(stepRoutes, "基隆北區", "基隆北區-2"), { sameDistrict: true, name: "三連棟線" });
  assert.deepEqual(stepTarget(stepRoutes, "基隆北區-2", "基隆北區"), { sameDistrict: true, name: "梓桑古厝線" });
});

test("stepTarget names the district when the neighbor route is in another district", () => {
  assert.deepEqual(stepTarget(stepRoutes, "北南一區", "基隆北區"), { sameDistrict: false, name: "基隆北區" });
  assert.deepEqual(stepTarget(stepRoutes, "基隆北區-2", "基隆東區"), { sameDistrict: false, name: "基隆東區" });
});

test("stepTarget drops the circle in brackets from island names", () => {
  assert.deepEqual(stepTarget(stepRoutes, "基隆東區", "基宜圈_馬祖"), { sameDistrict: false, name: "馬祖" });
});

test("neighborRoutes gives neither neighbour for an unknown route", () => {
  assert.deepEqual(neighborRoutes(neighborCircles, "不存在的區"), { prev: null, next: null });
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

test("latLngOf reads both Google LatLng objects and plain literals", () => {
  const googleLatLng = { lat() { return 25.1; }, lng() { return 121.5; } };
  assert.deepEqual(latLngOf(googleLatLng), { lat: 25.1, lng: 121.5 });
  assert.deepEqual(latLngOf({ lat: 22.6, lng: 120.3 }), { lat: 22.6, lng: 120.3 });
});

test("headingTo points the camera from the panorama towards the marker", () => {
  const here = { lat: 25.0, lng: 121.5 };
  assert.equal(Math.round(headingTo(here, { lat: 25.01, lng: 121.5 })), 0);
  assert.equal(Math.round(headingTo(here, { lat: 25.0, lng: 121.51 })), 90);
  assert.equal(Math.round(headingTo(here, { lat: 24.99, lng: 121.5 })), 180);
  assert.equal(Math.round(headingTo(here, { lat: 25.0, lng: 121.49 })), 270);
});

const METERS_PER_DEGREE_LAT = (6371000 * Math.PI) / 180;
const northOf = (meters) => 25 + meters / METERS_PER_DEGREE_LAT;
const eastOf = (meters) => 121.5 + meters / (METERS_PER_DEGREE_LAT * Math.cos((25 * Math.PI) / 180));

const sampleRoute = {
  points: {
    start: { name: "南邊車站", lat: 25, lon: 121.5 },
    stop1: { name: "北邊公園", lat: northOf(980), lon: 121.5 },
    end: { name: "東邊廣場", lat: 25, lon: eastOf(420) },
  },
  via: [[{ name: "中途路口", lat: northOf(490), lon: 121.5 }], []],
  legs: [
    { m: 980, path: [[25, 121.5], [northOf(490), 121.5], [northOf(980), 121.5]] },
    { m: 1400, path: [[northOf(980), 121.5], [northOf(490), 121.5], [25, 121.5], [25, eastOf(420)]] },
  ],
  timeline: { legMinutes: [14, 20], stopMinutes: 10, minutesFrom: ["distance", "distance"], backtrack: [[1010, 1960]] },
};

test("buildTimeline lays out leg1, stop, leg2", () => {
  const tl = buildTimeline(sampleRoute);
  assert.equal(tl.legs[0].toMin, 14);
  assert.deepEqual([tl.stop.fromMin, tl.stop.toMin], [14, 24]);
  assert.equal(tl.totalMin, 44);
  assert.ok(Math.abs(tl.legs[1].fromM - 980) < 15);
  assert.equal(buildTimeline({ ...sampleRoute, timeline: undefined }), null);
});

test("positionAt boundaries", () => {
  const tl = buildTimeline(sampleRoute);
  assert.equal(positionAt(tl, -3).phase, "leg1");
  assert.deepEqual(positionAt(tl, 0).point, sampleRoute.legs[0].path[0]);
  assert.equal(positionAt(tl, 14).phase, "stop");
  assert.equal(positionAt(tl, 24).phase, "stop");
  assert.equal(positionAt(tl, 24.5).phase, "leg2");
  assert.equal(positionAt(tl, 44).phase, "end");
  assert.equal(positionAt(tl, 99).phase, "end");
  assert.equal(positionAt(tl, 30).backtracking, true);
  assert.equal(positionAt(tl, 43).backtracking, false);
});

test("minuteMarks skip the stop and the ends", () => {
  const minutes = minuteMarks(buildTimeline(sampleRoute)).map((mark) => mark.minute);
  assert.deepEqual(minutes, [5, 10, 25, 30, 35, 40]);
});

test("timetable rows in order with fixed wording", () => {
  const rows = timetable(sampleRoute, buildTimeline(sampleRoute));
  assert.deepEqual(rows.map((r) => r.kind), ["start", "via", "stop", "depart", "back", "end"]);
  assert.equal(rows[2].text, "到北邊公園（停留點一），停 10 分鐘");
  assert.match(rows[4].text, /^第 \d+～\d+ 分鐘走回頭路（約 950 公尺，跟前面走過的是同一條路）$/);
  assert.equal(rows.at(-1).text, "抵達終點東邊廣場");
});

test("describeMoment wording", () => {
  const tl = buildTimeline(sampleRoute);
  assert.equal(describeMoment(sampleRoute, tl, 7).text, "第 7 分鐘｜第一段，往北邊公園走");
  assert.equal(describeMoment(sampleRoute, tl, 20).text, "第 20 分鐘｜在北邊公園：念介紹詞、故事卡");
  assert.equal(describeMoment(sampleRoute, tl, 44).text, "第 44 分鐘｜抵達終點東邊廣場");
});

test("offsetPath and metersPerPixel", () => {
  const north = [[25, 121.5], [25.001, 121.5]];
  const shifted = offsetPath(north, 10);
  assert.ok(shifted[0][1] > 121.5);
  assert.ok(Math.abs(metersPerPixel(0, 0) - 156543.03392) < 1e-6);
});

test("trailPieces split each leg where the route backtracks", () => {
  const tl = buildTimeline(sampleRoute);
  const pieces = trailPieces(tl);
  assert.deepEqual(pieces.map((piece) => [piece.kind, piece.legIndex]), [["leg1", 0], ["leg2", 1], ["back", 1], ["leg2", 1]]);
  assert.deepEqual([pieces[2].fromM, pieces[2].toM], [1010, 1960]);
  assert.ok(Math.abs(pieces[2].toMin - 38) < 0.5);
  assert.equal(pieces.at(-1).toMin, 44);

  const across = buildTimeline({ ...sampleRoute, timeline: { ...sampleRoute.timeline, backtrack: [[500, 700], [950, 1050]] } });
  assert.deepEqual(trailPieces(across).map((piece) => [piece.kind, piece.legIndex]),
    [["leg1", 0], ["back", 0], ["leg1", 0], ["back", 0], ["back", 1], ["leg2", 1]]);
});

test("walkedPart ends where the moving dot is", () => {
  const near = (a, b) => assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, `${a} vs ${b}`);
  const tl = buildTimeline(sampleRoute);
  const [first, beforeBack, back, afterBack] = trailPieces(tl);
  const halfway = walkedPart(tl, first, 7);
  assert.deepEqual(halfway[0], sampleRoute.legs[0].path[0]);
  near(halfway.at(-1), positionAt(tl, 7).point);
  assert.deepEqual(walkedPart(tl, first, 20), sampleRoute.legs[0].path);
  assert.deepEqual(walkedPart(tl, beforeBack, 20), []);
  near(walkedPart(tl, back, 30).at(-1), positionAt(tl, 30).point);
  assert.deepEqual(walkedPart(tl, afterBack, 30), []);
  near(walkedPart(tl, afterBack, 44).at(-1), sampleRoute.legs[1].path.at(-1));
});
