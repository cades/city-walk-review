import { cssVar, el } from "./dom.js?v=202610210100";
import { feedbackEnabled, homeCommentCounts, renderComments } from "./feedback.js?v=202610210100";
import { filterRoutes, formatMinutes, groupRoutes, neighborRoutes, routeIdFromHash } from "./lib.js?v=202610210100";
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
let routeTab = "time";

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

function factsSection(route) {
  const flags = flagBadges(route);
  return [
    flags ? el("section", { class: "side-section" }, el("h2", {}, "警示"), flags) : null,
    el("section", { class: "side-section" }, el("h2", {}, "距離"), factList(route)),
  ];
}

function googleLink(route) {
  if (!route.google) return null;
  return el("a", { class: "map-link", href: route.google.open, target: "_blank", rel: "noopener" },
    el("span", { class: "wide-only" }, "在 "), "Google 地圖", el("span", { class: "wide-only" }, "開啟步行路線"), " ↗");
}

function textSection(route) {
  const keys = [...TEXT_ORDER.filter((key) => key in route.text), ...Object.keys(route.text).filter((key) => !TEXT_ORDER.includes(key))];
  return el("section", { class: "side-section text" },
    el("h2", {}, "路線包內容"),
    el("dl", {}, keys.map((key) => [el("dt", {}, key), el("dd", {}, route.text[key])])));
}

function todoSection(route) {
  return el("section", { class: "side-section todo" },
    el("h2", {}, "待確認事項"),
    route.todo?.length
      ? el("ul", {}, route.todo.map((line) => el("li", {}, line.replace(/^-\s*/, ""))))
      : el("p", { class: "meta" }, "沒有待確認事項。"));
}

function circleOf(route) {
  return data.circles.find((circle) => circle.routes.includes(route.id))?.name;
}

function routeStep(rel, id) {
  const label = rel === "prev" ? "上一區" : "下一區";
  if (!id) return el("span", { class: "route-step", "data-rel": rel, "aria-disabled": "true" }, rel === "prev" ? "已是第一區" : "已是最後一區");
  // Island routes are titled like 馬祖（基宜圈）; the place name alone keeps both buttons on one line on phones.
  const district = splitTitle(data.routes.find((route) => route.id === id).title).district.replace(/（.*?）/, "");
  return el("a", { class: "route-step", "data-rel": rel, href: routeHref(id), rel, "aria-label": `${label}：${district}` },
    el("span", { class: "route-step-label" }, label), el("span", {}, district));
}

function flagCountButton(route, onClick) {
  if (!route.flags?.length) return null;
  const button = el("button", { type: "button", class: "badge badge-warn flag-count", "aria-controls": "tabpanel-facts" },
    `警示 ${route.flags.length}`);
  button.addEventListener("click", onClick);
  return button;
}

function routeHead(route, showFlags) {
  const { district, line } = splitTitle(route.title);
  const { prev, next } = neighborRoutes(data.circles, route.id);
  const meta = [circleOf(route), `路線包序號 ${route.seq}`, route.confidence ? `座標信心 ${route.confidence}` : null]
    .filter(Boolean).join("・");
  return el("header", { class: "route-head" },
    el("a", { class: "route-back", href: "#" }, "← 全部路線"),
    el("div", { class: "route-heading" },
      el("h1", { class: "route-title" }, el("strong", {}, district), line ? [" ", el("span", {}, line)] : null),
      flagCountButton(route, showFlags),
      el("p", { class: "meta" }, meta)),
    el("nav", { class: "route-steps", "aria-label": "上一區、下一區" }, routeStep("prev", prev), routeStep("next", next)));
}

function mountTabs(sections, initial) {
  const tablist = el("div", { class: "tabs route-tabs", role: "tablist", "aria-label": "路線資料" });
  const panels = el("div", { class: "tab-panels" });
  const tabs = sections.map(({ key, label, extra }) => {
    const tab = el("button", {
      type: "button", class: "tab", role: "tab", id: `tab-${key}`, "aria-controls": `tabpanel-${key}`, "aria-selected": "false",
    }, label, extra);
    tab.addEventListener("click", () => select(key));
    return tab;
  });
  const tabPanels = sections.map(({ key, content }) =>
    el("div", { class: "tab-panel", role: "tabpanel", id: `tabpanel-${key}`, "aria-labelledby": `tab-${key}`, hidden: "" }, content));
  tablist.append(...tabs);
  panels.append(...tabPanels,
    // The site footer would sit below the sticky phone map and push it off at the end of the page, so the panel carries it.
    el("p", { class: "side-footer" }, el("a", { href: "privacy.html" }, "隱私權說明")));

  function select(key, { focus = false } = {}) {
    routeTab = key;
    sections.forEach((section, index) => {
      const chosen = section.key === key;
      tabs[index].setAttribute("aria-selected", String(chosen));
      tabPanels[index].hidden = !chosen;
      if (chosen && focus) tabs[index].focus({ preventScroll: true });
    });
    panels.scrollTop = 0;
    // On phones the page scrolls under the sticky map and tabs; bring the new panel's first line back into view.
    const hiddenBehindTabs = tablist.getBoundingClientRect().bottom - panels.getBoundingClientRect().top;
    if (hiddenBehindTabs > 0) window.scrollBy(0, -hiddenBehindTabs);
  }

  tablist.addEventListener("keydown", (event) => {
    const last = tabs.length - 1;
    const current = tabs.indexOf(document.activeElement);
    const target = {
      ArrowLeft: current === 0 ? last : current - 1, ArrowRight: current === last ? 0 : current + 1, Home: 0, End: last,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(sections[target].key, { focus: true });
  });

  select(sections.some((section) => section.key === initial) ? initial : sections[0].key);
  return { tablist, panels, select };
}

function openCommentBadge(commentsPanel) {
  const badge = el("span", { class: "badge badge-info", hidden: "" });
  // feedback.js lists each comment as .comment and marks the handled ones .comment-handled.
  new MutationObserver(() => {
    const open = commentsPanel.querySelectorAll(".comment:not(.comment-handled)").length;
    badge.hidden = !open;
    badge.replaceChildren(String(open), el("span", { class: "sr-only" }, " 則未處理"));
  }).observe(commentsPanel, { childList: true, subtree: true });
  return badge;
}

export function showRoute(id) {
  const route = data.routes.find((candidate) => candidate.id === id);
  if (!route) return showHome();
  // Keyboard users stepping through routes keep their place on the 上一區／下一區 link.
  const steppedFrom = document.activeElement?.closest(".route-step")?.dataset.rel;
  resetView("route");
  document.title = `${route.title}｜城市散步路線檢閱`;
  const mapBox = el("div", { class: "map", role: "region", "aria-label": `${route.title} 地圖` });
  const toolbar = el("div", { class: "segmented timeline-toolbar" });
  const panel = el("div", { class: "timeline-panel" });
  const legend = el("p", { class: "legend route-legend" },
    el("span", { class: "l1" }, "第一段"), el("span", { class: "l2" }, "第二段"), el("span", { class: "lv" }, "沿途經過的點"),
    el("span", { class: "hint wide-only" }, "點標記可看街景"));
  const comments = el("section", { class: "side-section", id: "comments", hidden: "" });
  const tabs = mountTabs([
    { key: "time", label: "時間", content: [toolbar, panel] },
    { key: "pack", label: "路線包", content: textSection(route) },
    { key: "facts", label: "距離・警示", content: factsSection(route) },
    { key: "todo", label: "待確認", content: todoSection(route) },
    feedbackEnabled() ? { key: "comments", label: "意見", extra: openCommentBadge(comments), content: comments } : null,
  ].filter(Boolean), routeTab);

  const head = routeHead(route, () => tabs.select("facts", { focus: true }));
  app.append(
    head,
    el("div", { class: "route-work" },
      // The panel comes first so Tab reaches the timetable before the map's markers and controls; CSS shows the map first.
      el("div", { class: "route-side" }, tabs.tablist, tabs.panels),
      el("div", { class: "route-map" },
        route.legs.length ? null : el("p", { class: "notice map-notice" }, "這條路線缺座標，地圖不完整"),
        mapBox,
        el("div", { class: "map-foot" }, legend, googleLink(route)))),
  );
  if (steppedFrom) head.querySelector(`a[data-rel="${steppedFrom}"]`)?.focus();
  const mapView = drawRouteMap(mapBox, route);
  mountTimeline(route, mapView, { toolbar, panel, legend });
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
  routeTab = "time";
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
