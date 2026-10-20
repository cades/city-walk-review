import { formatMinutes, routeIdFromHash } from "./lib.js";

const TILE_URL = "https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}";
const TILE_ATTRIBUTION = "© 內政部國土測繪中心";
const TAIWAN_CENTER = [23.7, 121.0];
const TEXT_ORDER = ["集合點", "停車", "路線", "停留點一", "介紹詞", "終點", "回程", "廁所", "雨天備案", "選配", "備註"];
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

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child != null) node.append(child);
  }
  return node;
}

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
  if (map) {
    map.remove();
    map = null;
    window.routeMap = null;
  }
  app.replaceChildren();
  window.scrollTo(0, 0);
}

function drawMap(container, route) {
  map = L.map(container, { scrollWheelZoom: false });
  window.routeMap = map;
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
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
  if (bounds.length) map.fitBounds(bounds, { padding: [24, 24] });
  else map.setView(TAIWAN_CENTER, 7);
}

function flagList(route) {
  const chips = [
    ...(route.flags || []).map((flag) => el("li", { class: "chip chip-warn" }, flag.label)),
    ...(route.notes || []).map((note) => el("li", { class: "chip chip-info" }, note)),
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

export function showRoute(id) {
  const route = data.routes.find((candidate) => candidate.id === id);
  if (!route) return showHome();
  resetView();
  document.title = `${route.title}｜城市散步路線檢閱`;
  const mapBox = el("div", { class: "map", role: "region", "aria-label": `${route.title} 地圖` });
  const meta = [`路線包序號 ${route.seq}`, route.confidence ? `座標信心 ${route.confidence}` : null].filter(Boolean).join("・");
  app.append(
    el("section", {},
      el("p", { class: "crumb" }, el("a", { href: "#" }, "← 全部路線")),
      el("h1", {}, route.title),
      el("p", { class: "meta" }, meta)),
    flagList(route),
    el("div", { class: "route-body" },
      el("div", { class: "stack" },
        el("section", {},
          route.legs.length ? null : el("p", { class: "notice" }, "這條路線缺座標，地圖不完整"),
          mapBox,
          el("p", { class: "legend" },
            el("span", { class: "l1" }, "第一段"), el("span", { class: "l2" }, "第二段"), el("span", { class: "lv" }, "沿途經過的點"))),
        googleMap(route)),
      el("div", { class: "stack" },
        el("section", { class: "panel" }, el("h2", {}, "距離"), factList(route)),
        textSection(route),
        todoSection(route),
        el("section", { class: "panel", id: "comments", hidden: "" }))),
  );
  drawMap(mapBox, route);
}

export function showHome() {
  resetView();
  document.title = "城市散步路線檢閱";
  const routes = [...data.routes].sort((a, b) => a.seq - b.seq);
  app.append(
    el("h1", {}, "全部路線"),
    el("ol", { class: "route-list" }, routes.map((route) =>
      el("li", {}, el("a", { href: routeHref(route.id) }, route.title),
        route.flags?.length ? `（${route.flags.length} 個警示）` : null))));
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
