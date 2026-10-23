import { cssVar, el } from "./dom.js?v=202610240010";
import {
  buildTimeline, describeMoment, metersPerPixel, minuteMarks, offsetPath, positionAt, timetable, trailPieces, walkedPart,
} from "./lib.js?v=202610240010";

const LEG2_SHIFT_PX = 6;
const SLIDER_STEPS_PER_MINUTE = 10;
const PLAY_TICK_MS = 30;
const PLAY_TICKS = 333;
const BACKTRACK_NOTE = "● 走回頭路（跟前面走過的是同一條路）";
const VIEWS = [["glance", "一眼看"], ["drag", "拖拉看"]];

function clearLayer(mapView, layer) {
  layer.clear();
  // Lines asked for before Google Maps finished loading are drawn after this point, so clear once more after them.
  mapView.draw(() => layer.clear());
}

function timetableView(route, timeline, jumpTo) {
  const rows = timetable(route, timeline).map((row) => {
    const minute = Math.round(row.minute);
    const label = `第 ${minute} 分鐘：${row.text}，在地圖上看`;
    const button = el("button", { type: "button", class: `timetable-row ${row.kind}`, "aria-label": label },
      el("span", { class: "timetable-minute" }, `${minute}′`),
      el("span", { class: "timetable-text" }, row.text));
    button.addEventListener("click", () => jumpTo(row.minute));
    return el("li", {}, button);
  });
  return el("section", { class: "timetable", "aria-labelledby": "timetable-title" },
    el("div", { class: "timetable-head" },
      el("h2", { id: "timetable-title" }, "第幾分鐘到哪裡"),
      el("p", { class: "timetable-hint" }, "點一列，在地圖上看那一分鐘")),
    el("ol", { class: "timetable-rows" }, rows));
}

function showGlance({ route, timeline, mapView, layer, panel, colors, jumpTo }) {
  const [leg1, leg2] = timeline.legs;
  layer.line(leg1.path, { color: colors.leg1, weight: 6, opacity: 0.8, arrows: true });
  const leg2Line = layer.line(leg2.path, { color: colors.leg2, weight: 4, opacity: 0.95, dashed: true, arrows: true, zIndex: 1 });
  const shiftLeg2 = (zoom, lat) => leg2Line.then((line) =>
    line?.setPoints(offsetPath(leg2.path, LEG2_SHIFT_PX * metersPerPixel(lat, zoom))));
  mapView.zoomInfo().then((info) => info && shiftLeg2(info.zoom, info.lat));
  const stopShifting = mapView.onZoom(shiftLeg2);
  for (const mark of minuteMarks(timeline)) {
    layer.label(mark.point, { text: String(mark.minute), className: `leg${mark.legIndex + 1}` });
  }
  panel.replaceChildren(timetableView(route, timeline, jumpTo));
  return () => {
    stopShifting();
    clearLayer(mapView, layer);
  };
}

function band(timeline, pieces) {
  const stop = { kind: "stop", fromMin: timeline.stop.fromMin, toMin: timeline.stop.toMin };
  const segments = [...pieces, stop].sort((a, b) => a.fromMin - b.fromMin);
  return el("div", { class: "timeline-band", "aria-hidden": "true" },
    segments.map((segment) => el("span", { class: segment.kind, style: `flex-grow: ${segment.toMin - segment.fromMin}` })));
}

function dragLegend(timeline) {
  return el("p", { class: "legend timeline-legend" },
    el("span", { class: "l1" }, "第一段"),
    el("span", { class: "ls" }, "停留點一"),
    el("span", { class: "l2" }, "第二段"),
    timeline.backtrack.length ? el("span", { class: "lb" }, "走回頭路") : null);
}

function showDrag({ route, timeline, mapView, layer, panel, colors, legend, minute: jumpedTo }) {
  const pieces = trailPieces(timeline);
  timeline.legs.forEach((leg, index) => layer.line(leg.path, { color: colors[`leg${index + 1}`], weight: 6, opacity: 0.35 }));
  const trail = pieces.map((piece) => layer.line([], { color: colors[piece.kind], weight: 5, zIndex: 1 }));
  const dot = layer.mover(timeline.legs[0].path[0]);

  const status = el("p", { class: "timeline-status" });
  let minute = jumpedTo ?? 0;
  const slider = el("input", {
    type: "range", min: "0", max: String(timeline.totalMin * SLIDER_STEPS_PER_MINUTE), step: "1",
    value: String(Math.round(minute * SLIDER_STEPS_PER_MINUTE)), "aria-label": "第幾分鐘",
  });
  const play = el("button", { type: "button", class: "timeline-play" }, "▶ 播放");
  let timer = null;

  function render() {
    const { text, backtracking } = describeMoment(route, timeline, minute);
    status.replaceChildren(text, ...(backtracking ? ["　", el("span", { class: "timeline-back" }, BACKTRACK_NOTE)] : []));
    slider.setAttribute("aria-valuetext", text);
    pieces.forEach((piece, index) => trail[index].then((line) => line?.setPoints(walkedPart(timeline, piece, minute))));
    dot.then((mover) => mover?.moveTo(positionAt(timeline, minute).point));
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    play.textContent = "▶ 播放";
  }

  function tick() {
    if (!mapView.active || !panel.isConnected) return stop();
    minute = Math.min(timeline.totalMin, minute + timeline.totalMin / PLAY_TICKS);
    slider.value = String(minute * SLIDER_STEPS_PER_MINUTE);
    render();
    if (minute >= timeline.totalMin) stop();
  }

  play.addEventListener("click", () => {
    if (timer) return stop();
    if (minute >= timeline.totalMin) minute = 0;
    play.textContent = "❚❚ 暫停";
    timer = setInterval(tick, PLAY_TICK_MS);
  });
  slider.addEventListener("input", () => {
    minute = Number(slider.value) / SLIDER_STEPS_PER_MINUTE;
    render();
  });

  panel.replaceChildren(status, el("div", { class: "timeline-controls" }, play, slider, band(timeline, pieces)), dragLegend(timeline));
  legend?.classList.add("drag-view");
  render();
  if (jumpedTo != null) slider.focus({ preventScroll: true });
  return () => {
    stop();
    legend?.classList.remove("drag-view");
    clearLayer(mapView, layer);
  };
}

export function mountTimeline(route, mapView, { toolbar, panel, legend }) {
  const timeline = buildTimeline(route);
  if (!timeline) {
    panel.replaceChildren(el("p", { class: "notice" }, "這條路線缺座標，排不出時間表。"));
    return;
  }
  const views = { glance: showGlance, drag: showDrag };
  const layers = { glance: mapView.layer(), drag: mapView.layer() };
  const colors = { leg1: cssVar("--leg1"), leg2: cssVar("--leg2"), back: cssVar("--back") };
  let shown = null;
  let teardown = () => {};

  const buttons = VIEWS.map(([key, label]) => {
    const button = el("button", { type: "button", "aria-pressed": "false" }, label);
    button.addEventListener("click", () => show(key));
    return [key, button];
  });

  function show(key, minute) {
    if (key === shown && minute == null) return;
    teardown();
    shown = key;
    for (const [candidate, button] of buttons) button.setAttribute("aria-pressed", String(candidate === key));
    teardown = views[key]({ route, timeline, mapView, layer: layers[key], panel, colors, legend, minute, jumpTo });
  }

  function jumpTo(minute) {
    show("drag", minute);
    toolbar.scrollIntoView({ block: "nearest" });
  }

  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "時間軸看法");
  toolbar.append(...buttons.map(([, button]) => button));
  show("glance");
}
