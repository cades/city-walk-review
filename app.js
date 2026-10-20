import { el } from "./dom.js?v=202610201240";
import { homeCommentCounts, renderComments } from "./feedback.js?v=202610201240";
import { formatMinutes, groupRoutes, routeIdFromHash } from "./lib.js?v=202610201240";

const TILE_URL = "https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}";
const TILE_ATTRIBUTION = "© 內政部國土測繪中心";
const TAIWAN_CENTER = [23.7, 121.0];
const TEXT_ORDER = ["集合點", "停車", "路線", "停留點一", "介紹詞", "建議故事卡", "終點", "回程", "廁所", "雨天備案", "選配", "備註"];
const PINS = [
  ["station", "站", "最近車站"],
  ["cafe", "咖", "咖啡店"],
  ["end", "終", "終點"],
  ["stop1", "一", "停留點一"],
  ["start", "集", "集合點"],
];

const app = document.getElementById("app");
let data;
let map = null;
let mapResizeObserver = null;
let onlyFlagged = false;
let commentCounts = null;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function routeHref(id) {
  return `#${encodeURIComponent(id)}`;
}

function describeDistance(meters) {
  return meters == null ? "算不出" : `${meters.toLocaleString("zh-TW")} 公尺（${formatMinutes(meters)}）`;
}

function describePlace(point, meters) {
  return point ? `${point.name}，${describeDistance(meters)}` : "還沒有資料";
}

function resetView() {
  mapResizeObserver?.disconnect();
  mapResizeObserver = null;
  if (map) {
    map.remove();
    map = null;
    window.routeMap = null;
  }
  app.replaceChildren();
  window.scrollTo(0, 0);
}

function createMap(container) {
  map = L.map(container, { scrollWheelZoom: false });
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
  return map;
}

function keepFramed(container, bounds) {
  const frame = () => {
    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
    else map.setView(TAIWAN_CENTER, 7);
  };
  frame();
  mapResizeObserver = new ResizeObserver(() => {
    if (!map) return;
    map.invalidateSize();
    frame();
  });
  mapResizeObserver.observe(container);
}

function drawRouteMap(container, route) {
  createMap(container);
  window.routeMap = map;
  const bounds = [];
  const [first, second] = route.legs;
  if (first) {
    L.polyline(first.path, { color: cssVar("--leg1"), weight: 6, opacity: 0.8 }).addTo(map);
    L.polyline(second.path, { color: cssVar("--leg2"), weight: 4, opacity: 0.95, dashArray: "8 8" }).addTo(map);
    bounds.push(...first.path, ...second.path);
  }
  for (const point of route.via.flat().filter(Boolean)) {
    L.circleMarker([point.lat, point.lon], { radius: 4, color: cssVar("--via"), weight: 2, fillOpacity: 0.9 })
      .bindTooltip(el("span", {}, point.name))
      .addTo(map);
    bounds.push([point.lat, point.lon]);
  }
  for (const [key, badge, label] of PINS) {
    const point = route.points[key];
    if (!point) continue;
    const icon = L.divIcon({ className: `pin pin-${key}`, html: badge, iconSize: [26, 26] });
    L.marker([point.lat, point.lon], { icon, title: `${label}：${point.name}` })
      .bindPopup(el("span", {}, `${label}：${point.name}`))
      .addTo(map);
    bounds.push([point.lat, point.lon]);
  }
  keepFramed(container, bounds);
}

function drawOverviewMap(container) {
  createMap(container);
  const bounds = [];
  for (const route of data.routes) {
    const point = route.points.start;
    if (!point) continue;
    const flagged = Boolean(route.flags?.length);
    L.circleMarker([point.lat, point.lon], {
      radius: 7, color: cssVar("--surface"), weight: 2, fillOpacity: 0.95,
      fillColor: cssVar(flagged ? "--warn-fg" : "--leg1"),
    })
      .bindTooltip(el("span", {}, route.title))
      .on("click", () => { location.hash = routeHref(route.id); })
      .addTo(map);
    bounds.push([point.lat, point.lon]);
  }
  keepFramed(container, bounds);
}

function flagChips(route, withNotes) {
  const chips = [
    ...(route.flags || []).map((flag) => el("li", { class: "chip chip-warn" }, flag.label)),
    ...(withNotes ? route.notes || [] : []).map((note) => el("li", { class: "chip chip-info" }, note)),
  ];
  return chips.length ? el("ul", { class: "chips", "aria-label": "警示" }, chips) : null;
}

function factList(route) {
  const [first, second] = route.legs;
  const rows = [
    ["第一段", describeDistance(first?.m)],
    ["第二段", describeDistance(second?.m)],
    ["全程", describeDistance(route.totalM)],
    ["終點走回集合點", describeDistance(route.endToStartM)],
    ["終點到最近車站", describePlace(route.points.station, route.stationM)],
    ["終點到咖啡店", describePlace(route.points.cafe, route.cafeM)],
  ];
  return el("dl", { class: "facts" }, rows.map(([term, value]) => [el("dt", {}, term), el("dd", {}, value)]));
}

function googleMap(route) {
  if (!route.google) return null;
  return el("section", { class: "panel gmap" },
    el("h2", {}, "Google 地圖步行路線"),
    el("iframe", { src: route.google.embed, loading: "lazy", title: `${route.title} 的 Google 地圖步行路線` }),
    el("p", {}, el("a", { href: route.google.open, target: "_blank", rel: "noopener" }, "在 Google 地圖開啟")));
}

function textSection(route) {
  const keys = [...TEXT_ORDER.filter((key) => key in route.text), ...Object.keys(route.text).filter((key) => !TEXT_ORDER.includes(key))];
  return el("section", { class: "panel text" },
    el("h2", {}, "路線包內容"),
    el("dl", {}, keys.map((key) => [el("dt", {}, key), el("dd", {}, route.text[key])])));
}

function todoSection(route) {
  if (!route.todo?.length) return null;
  return el("section", { class: "panel todo" },
    el("h2", {}, "待確認事項"),
    el("ul", {}, route.todo.map((line) => el("li", {}, line.replace(/^-\s*/, "")))));
}

function circleOf(route) {
  return data.circles.find((circle) => circle.routes.includes(route.id))?.name;
}

export function showRoute(id) {
  const route = data.routes.find((candidate) => candidate.id === id);
  if (!route) return showHome();
  resetView();
  document.title = `${route.title}｜城市散步路線檢閱`;
  const mapBox = el("div", { class: "map", role: "region", "aria-label": `${route.title} 地圖` });
  const meta = [circleOf(route), `路線包序號 ${route.seq}`, route.confidence ? `座標信心 ${route.confidence}` : null]
    .filter(Boolean).join("・");
  app.append(
    el("section", {},
      el("p", { class: "crumb" }, el("a", { href: "#" }, "← 全部路線")),
      el("h1", {}, route.title),
      el("p", { class: "meta" }, meta)),
    flagChips(route, true),
    el("div", { class: "route-body" },
      el("section", { class: "map-col" },
        route.legs.length ? null : el("p", { class: "notice" }, "這條路線缺座標，地圖不完整"),
        mapBox,
        el("p", { class: "legend" },
          el("span", { class: "l1" }, "第一段"), el("span", { class: "l2" }, "第二段"), el("span", { class: "lv" }, "沿途經過的點"))),
      el("div", { class: "stack" },
        el("section", { class: "panel" }, el("h2", {}, "距離"), factList(route)),
        googleMap(route),
        textSection(route),
        todoSection(route),
        el("section", { class: "panel", id: "comments", hidden: "" }))),
  );
  drawRouteMap(mapBox, route);
  renderComments(route);
}

function routeSummary(route) {
  const total = route.totalM == null ? "全程算不出" : `全程 ${(route.totalM / 1000).toFixed(1)} 公里`;
  const back = route.endToStartM == null ? null : `終點走回集合點 ${route.endToStartM} 公尺`;
  return [total, back].filter(Boolean).join("・");
}

function routeRow(route) {
  const open = commentCounts?.get(route.id);
  return el("li", { class: "route-row" },
    el("a", { href: routeHref(route.id) }, route.title),
    el("span", { class: "row-meta" }, routeSummary(route)),
    open ? el("span", { class: "chip chip-info" }, `${open} 則未處理意見`) : null,
    flagChips(route, false) || el("span", { class: "row-meta" }, "沒有警示"));
}

function groupList() {
  const groups = groupRoutes(data.routes, data.circles, onlyFlagged);
  if (!groups.length) return el("p", { class: "notice" }, "目前沒有路線有警示。");
  return el("div", { class: "groups" }, groups.map((group) =>
    el("section", { class: "panel group" },
      el("h2", {}, group.name, el("span", { class: "count" }, `${group.routes.length} 區`)),
      el("ul", { class: "route-rows" }, group.routes.map(routeRow)))));
}

export function showHome() {
  resetView();
  document.title = "城市散步路線檢閱";
  const flaggedCount = data.routes.filter((route) => route.flags?.length).length;
  const mapBox = el("div", { class: "map", role: "region", "aria-label": "全部路線地圖" });
  const listBox = el("div", {}, groupList());
  const toggleLabel = () => (onlyFlagged ? "顯示全部路線" : `只看有警示的（${flaggedCount} 條）`);
  const toggle = el("button", { type: "button", class: "toggle", "aria-pressed": String(onlyFlagged) }, toggleLabel());
  toggle.addEventListener("click", () => {
    onlyFlagged = !onlyFlagged;
    toggle.setAttribute("aria-pressed", String(onlyFlagged));
    toggle.textContent = toggleLabel();
    listBox.replaceChildren(groupList());
  });
  app.append(
    el("section", {},
      el("h1", {}, "全部路線"),
      el("p", { class: "meta" }, `${data.routes.length} 區，各一條環狀路線，依圈排列。點地圖上的點或路線名稱看細節。`)),
    el("div", { class: "route-body home-body" },
      el("section", { class: "map-col" },
        mapBox,
        el("p", { class: "legend" }, el("span", { class: "dot-ok" }, "沒有警示"), el("span", { class: "dot-warn" }, "有警示"))),
      el("div", { class: "stack" }, el("div", { class: "toolbar" }, toggle), listBox)),
  );
  drawOverviewMap(mapBox);
  homeCommentCounts().then((counts) => {
    if (!counts || !listBox.isConnected) return;
    commentCounts = counts;
    listBox.replaceChildren(groupList());
  });
}

function render() {
  const id = routeIdFromHash(location.hash);
  if (id) showRoute(id);
  else showHome();
}

async function start() {
  try {
    const response = await fetch("data/routes.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(response.statusText);
    data = await response.json();
  } catch {
    app.replaceChildren(el("p", { class: "notice" }, "讀不到路線資料，請重新整理頁面。"));
    return;
  }
  const generated = new Date(data.generated).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" });
  document.getElementById("generated").textContent = `資料更新：${generated}`;
  window.addEventListener("hashchange", render);
  render();
}

start();
