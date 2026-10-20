import { cssVar, el } from "./dom.js?v=202610210100";
import { homeCommentCounts, renderComments } from "./feedback.js?v=202610210100";
import { filterRoutes, formatMinutes, groupRoutes, routeIdFromHash } from "./lib.js?v=202610210100";
import { showMap } from "./map.js?v=202610210100";
import { mountTimeline } from "./timeline.js?v=202610210100";

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
let onlyFlagged = false;
let query = "";
let commentCounts = null;

function routeHref(id) {
  return `#${encodeURIComponent(id)}`;
}

function describeDistance(meters) {
  return meters == null ? "算不出" : `${meters.toLocaleString("zh-TW")} 公尺（${formatMinutes(meters)}）`;
}

function describePlace(point, meters) {
  return point ? `${point.name}，${describeDistance(meters)}` : "還沒有資料";
}

function resetView(view) {
  app.dataset.view = view;
  app.replaceChildren();
  window.scrollTo(0, 0);
}

function drawRouteMap(container, route) {
  const view = showMap(container);
  const bounds = [];
  const [first, second] = route.legs;
  if (first) {
    if (!route.timeline) {
      view.path(first.path, { color: cssVar("--leg1"), weight: 6, opacity: 0.8 });
      view.path(second.path, { color: cssVar("--leg2"), weight: 4, opacity: 0.95, dashed: true });
    }
    bounds.push(...first.path, ...second.path);
  }
  for (const point of route.via.flat().filter(Boolean)) {
    view.dot(point, { title: point.name });
    bounds.push([point.lat, point.lon]);
  }
  PINS.forEach(([key, badge, label], order) => {
    const point = route.points[key];
    if (!point) return;
    view.pin(point, { className: `pin-${key}`, badge, title: `${label}：${point.name}`, zIndex: order + 1 });
    if (key !== "station") bounds.push([point.lat, point.lon]);
  });
  view.frame(bounds);
  return view;
}

function drawOverviewMap(container) {
  const view = showMap(container);
  const bounds = [];
  for (const route of data.routes) {
    const point = route.points.start;
    if (!point) continue;
    view.dot(point, {
      className: route.flags?.length ? "marker-dot-route marker-dot-warn" : "marker-dot-route",
      title: route.title,
      onClick: () => { location.hash = routeHref(route.id); },
    });
    bounds.push([point.lat, point.lon]);
  }
  view.frame(bounds);
}

function flagBadges(route) {
  const badges = [
    ...(route.flags || []).map((flag) => el("li", { class: "badge badge-warn" }, flag.label)),
    ...(route.notes || []).map((note) => el("li", { class: "badge badge-info" }, note)),
  ];
  return badges.length ? el("ul", { class: "badge-list", "aria-label": "警示" }, badges) : null;
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

function googleLink(route) {
  if (!route.google) return null;
  return el("p", { class: "map-link" },
    el("a", { href: route.google.open, target: "_blank", rel: "noopener" }, "在 Google 地圖開啟步行路線"));
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
  resetView("route");
  document.title = `${route.title}｜城市散步路線檢閱`;
  const mapBox = el("div", { class: "map", role: "region", "aria-label": `${route.title} 地圖` });
  const toolbar = el("div", { class: "segmented timeline-toolbar" });
  const panel = el("div", { class: "timeline-panel" });
  const meta = [circleOf(route), `路線包序號 ${route.seq}`, route.confidence ? `座標信心 ${route.confidence}` : null]
    .filter(Boolean).join("・");
  app.append(
    el("section", {},
      el("p", { class: "crumb" }, el("a", { href: "#" }, "← 全部路線")),
      el("h1", {}, route.title),
      el("p", { class: "meta" }, meta)),
    flagBadges(route) ?? "",
    el("div", { class: "route-body" },
      el("section", { class: "map-col" },
        route.legs.length ? null : el("p", { class: "notice" }, "這條路線缺座標，地圖不完整"),
        toolbar,
        mapBox,
        el("p", { class: "legend" },
          el("span", { class: "l1" }, "第一段"), el("span", { class: "l2" }, "第二段"), el("span", { class: "lv" }, "沿途經過的點"),
          el("span", { class: "hint" }, "點標記可看街景")),
        panel,
        googleLink(route)),
      el("div", { class: "stack" },
        el("section", { class: "panel" }, el("h2", {}, "距離"), factList(route)),
        textSection(route),
        todoSection(route),
        el("section", { class: "panel", id: "comments", hidden: "" }))),
  );
  const mapView = drawRouteMap(mapBox, route);
  mountTimeline(route, mapView, { toolbar, panel });
  renderComments(route, mapView);
}

function splitTitle(title) {
  const cut = title.indexOf("：");
  return cut === -1 ? { district: title, line: "" } : { district: title.slice(0, cut), line: title.slice(cut + 1) };
}

function legBar(route, longest) {
  const [first, second] = route.legs;
  if (!first || !second || !route.totalM) return el("span", { class: "leg-track" });
  return el("span", { class: "leg-track", "aria-hidden": "true" },
    el("span", { class: "leg-bar", style: `width: ${Math.min(route.totalM / longest, 1) * 100}%` },
      el("span", { class: "l1", style: `flex-grow: ${first.m}` }),
      el("span", { class: "l2", style: `flex-grow: ${second.m}` })));
}

function routeCard(route, longest) {
  const { district, line } = splitTitle(route.title);
  const flags = route.flags || [];
  const open = commentCounts?.get(route.id);
  const distance = route.totalM == null
    ? "全程算不出"
    : `${(route.totalM / 1000).toFixed(1)} 公里・${formatMinutes(route.totalM)}`;
  return el("li", {},
    el("a", { class: "card route-card", href: routeHref(route.id) },
      el("span", { class: "route-card-name" }, el("strong", {}, district), line ? el("span", {}, line) : null),
      el("span", { class: "route-card-meta" }, legBar(route, longest), distance),
      el("span", { class: "route-card-badges" },
        flags.length
          ? el("span", { class: "badge badge-warn", title: flags.map((flag) => flag.label).join("\n") }, `警示 ${flags.length}`)
          : null,
        open ? el("span", { class: "badge badge-info" }, `${open} 則未處理意見`) : null)));
}

function emptyMessage() {
  const wanted = query.trim();
  if (!wanted) return "目前沒有路線有警示。";
  if (onlyFlagged) return `有警示的路線裡找不到「${wanted}」。取消「只看有警示的」再找找看。`;
  return `找不到「${wanted}」。可以輸入區名、路線名或圈名，例如景美、花東。`;
}

function groupList(groups, longest) {
  if (!groups.length) return [el("p", { class: "notice" }, emptyMessage())];
  return groups.map((group) =>
    el("section", { class: "route-group" },
      el("h2", { class: "group-label" }, group.name, el("span", { class: "count" }, `${group.routes.length} 區`)),
      el("ul", { class: "route-cards" }, group.routes.map((route) => routeCard(route, longest)))));
}

// Filtering while scrolled down would leave the first results above the screen, hidden under the sticky search box.
function scrollToResults(intro) {
  const headerBottom = Math.max(0, document.querySelector(".bar").getBoundingClientRect().bottom);
  const resultsTop = intro.getBoundingClientRect().bottom + window.scrollY - headerBottom;
  if (window.scrollY > resultsTop) window.scrollTo(0, resultsTop);
}

function countText(shown) {
  const total = data.routes.length;
  return shown === total ? `共 ${total} 條路線` : `${shown} 條符合（共 ${total} 條）`;
}

export function showHome() {
  resetView("home");
  document.title = "城市散步路線檢閱";
  const flaggedCount = data.routes.filter((route) => route.flags?.length).length;
  const longest = Math.max(...data.routes.map((route) => route.totalM || 0));
  const mapBox = el("div", { class: "map", role: "region", "aria-label": "全部路線地圖" });
  const listBox = el("div", { class: "route-groups" });
  const count = el("p", { class: "result-count", role: "status" });
  const search = el("input", {
    type: "search", "aria-label": "搜尋區名、路線名或圈名", placeholder: "搜尋區名、路線名或圈名",
    autocomplete: "off", enterkeyhint: "search",
  });
  search.value = query;
  const toggle = el("button", { type: "button", class: "toggle", "aria-pressed": String(onlyFlagged) },
    `只看有警示的（${flaggedCount} 條）`);
  const intro = el("div", { class: "home-intro" },
    el("h1", { id: "home-title" }, "全部路線"),
    el("p", { class: "meta" }, `${data.routes.length} 區，各一條環狀路線，依圈排列。點地圖上的點或路線名稱看細節。`));

  const refresh = () => {
    const groups = filterRoutes(groupRoutes(data.routes, data.circles, onlyFlagged), query);
    count.textContent = countText(groups.reduce((sum, group) => sum + group.routes.length, 0));
    listBox.replaceChildren(...groupList(groups, longest));
  };
  const showResults = () => {
    refresh();
    scrollToResults(intro);
  };
  const searchFor = () => {
    query = search.value;
    showResults();
  };
  // Zhuyin and Pinyin keyboards send half-typed syllables while composing; filter once the characters are chosen.
  search.addEventListener("input", (event) => event.isComposing || searchFor());
  search.addEventListener("compositionend", searchFor);
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) search.blur();
  });
  toggle.addEventListener("click", () => {
    onlyFlagged = !onlyFlagged;
    toggle.setAttribute("aria-pressed", String(onlyFlagged));
    showResults();
  });

  // The list comes first in the page so Tab reaches the search box before the 61 map markers; CSS shows the map first.
  app.append(
    el("section", { class: "home-list", "aria-labelledby": "home-title" },
      intro,
      el("div", { class: "list-tools" },
        el("label", { class: "search" }, search),
        el("div", { class: "list-tools-row" }, toggle, count)),
      listBox,
      // The page footer would sit below the sticky map and push it up at the end of the list, so home keeps its own.
      el("p", { class: "list-footer" }, el("a", { href: "privacy.html" }, "隱私權說明"))),
    el("div", { class: "home-map" },
      mapBox,
      el("p", { class: "legend map-legend" }, el("span", { class: "dot-ok" }, "沒有警示"), el("span", { class: "dot-warn" }, "有警示"))),
  );
  refresh();
  drawOverviewMap(mapBox);
  homeCommentCounts().then((counts) => {
    if (!counts || !listBox.isConnected) return;
    commentCounts = counts;
    refresh();
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
