const METERS_PER_MINUTE = 70;
const IN_APP_BROWSER = /\bLine\/|FBAN|FBAV|Instagram/;
const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function formatMinutes(meters) {
  return `約 ${Math.round(meters / METERS_PER_MINUTE)} 分鐘`;
}

export function routeIdFromHash(hash) {
  const id = hash.replace(/^#/, "");
  return id ? decodeURIComponent(id) : null;
}

export function groupRoutes(routes, circles, onlyFlagged = false) {
  const byId = new Map(routes.map((route) => [route.id, route]));
  return circles
    .map((circle) => ({
      name: circle.name,
      routes: circle.routes.map((id) => byId.get(id)).filter((route) => route && (!onlyFlagged || route.flags?.length)),
    }))
    .filter((group) => group.routes.length);
}

export function isInAppBrowser(userAgent) {
  return IN_APP_BROWSER.test(userAgent);
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function openCountsByRoute(comments) {
  const counts = new Map();
  for (const comment of comments) {
    if (comment.status === "未處理") counts.set(comment.routeId, (counts.get(comment.routeId) || 0) + 1);
  }
  return counts;
}

export function isAuthError(result) {
  return result?.ok === false && result.error === "auth";
}

export function latLngOf(position) {
  const read = (value) => (typeof value === "function" ? value.call(position) : value);
  return { lat: read(position.lat), lng: read(position.lng) };
}

export function headingTo(from, to) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const [lat1, lat2, deltaLng] = [radians(from.lat), radians(to.lat), radians(to.lng - from.lng)];
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const EARTH_RADIUS_M = 6371000;
const TIMETABLE_KIND_ORDER = ["start", "via", "stop", "depart", "back", "end"];

function haversineMeters([lat1, lon1], [lat2, lon2]) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

function cumulativeMeters(path) {
  const cum = [0];
  for (let i = 1; i < path.length; i += 1) cum.push(cum[i - 1] + haversineMeters(path[i - 1], path[i]));
  return cum;
}

export function buildTimeline(route) {
  const { timeline, legs } = route;
  if (!timeline || !legs || legs.length < 2) return null;
  const [minutes1, minutes2] = timeline.legMinutes;
  const stopFrom = minutes1;
  const stopTo = minutes1 + timeline.stopMinutes;
  const cums = legs.slice(0, 2).map((leg) => cumulativeMeters(leg.path));
  const leg1Meters = cums[0].at(-1);
  const total = stopTo + minutes2;
  const built = {
    legs: [
      { path: legs[0].path, cum: cums[0], m: legs[0].m, fromMin: 0, toMin: minutes1, fromM: 0 },
      { path: legs[1].path, cum: cums[1], m: legs[1].m, fromMin: stopTo, toMin: total, fromM: leg1Meters },
    ],
    stop: { fromMin: stopFrom, toMin: stopTo },
    totalMin: total,
    backtrack: [],
  };
  built.backtrack = (timeline.backtrack || []).map(([fromM, toM]) => ({
    fromM, toM, fromMin: minuteAtMeter(built, fromM), toMin: minuteAtMeter(built, toM),
  }));
  return built;
}

function legSpan(leg) {
  return leg.cum.at(-1);
}

export function minuteAtMeter(timeline, meters) {
  const [leg1, leg2] = timeline.legs;
  const along = (leg, local) => {
    const span = legSpan(leg);
    const fraction = span ? Math.min(Math.max(local / span, 0), 1) : 0;
    return leg.fromMin + fraction * (leg.toMin - leg.fromMin);
  };
  return meters <= leg2.fromM ? along(leg1, meters) : along(leg2, meters - leg2.fromM);
}

function pointAtLeg(leg, localMeters) {
  const { path, cum } = leg;
  const distance = Math.min(Math.max(localMeters, 0), legSpan(leg));
  let vertex = cum.findIndex((value) => value > distance);
  if (vertex === -1) return { point: path.at(-1), vertex: path.length - 1 };
  vertex = Math.max(vertex, 1);
  const segment = cum[vertex] - cum[vertex - 1];
  const t = segment ? (distance - cum[vertex - 1]) / segment : 0;
  const [lat1, lon1] = path[vertex - 1];
  const [lat2, lon2] = path[vertex];
  return { point: [lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t], vertex };
}

function isBacktrackingAt(timeline, meters) {
  return timeline.backtrack.some((range) => meters >= range.fromM && meters <= range.toM);
}

export function positionAt(timeline, minute) {
  const [leg1, leg2] = timeline.legs;
  const t = Math.min(Math.max(minute, 0), timeline.totalMin);
  const localMeters = (leg) => ((t - leg.fromMin) / (leg.toMin - leg.fromMin)) * legSpan(leg);
  if (t >= timeline.totalMin) {
    const { point, vertex } = pointAtLeg(leg2, legSpan(leg2));
    return { point, phase: "end", legIndex: 1, vertex, backtracking: false };
  }
  if (t < timeline.stop.fromMin) {
    const local = localMeters(leg1);
    const { point, vertex } = pointAtLeg(leg1, local);
    return { point, phase: "leg1", legIndex: 0, vertex, backtracking: isBacktrackingAt(timeline, local) };
  }
  if (t <= timeline.stop.toMin) {
    return { point: leg1.path.at(-1), phase: "stop", legIndex: 0, vertex: leg1.path.length - 1, backtracking: false };
  }
  const local = localMeters(leg2);
  const { point, vertex } = pointAtLeg(leg2, local);
  return { point, phase: "leg2", legIndex: 1, vertex, backtracking: isBacktrackingAt(timeline, leg2.fromM + local) };
}

export function minuteMarks(timeline, every = 5) {
  const marks = [];
  for (let minute = every; minute < timeline.totalMin; minute += every) {
    if (minute >= timeline.stop.fromMin && minute < timeline.stop.toMin) continue;
    const { point } = positionAt(timeline, minute);
    marks.push({ minute, point, legIndex: minute < timeline.stop.fromMin ? 0 : 1 });
  }
  return marks;
}

function nearestVertexMeters(path, cum, place) {
  let best = 0;
  let bestDistance = Infinity;
  path.forEach((vertex, index) => {
    const distance = haversineMeters(vertex, [place.lat, place.lon]);
    if (distance < bestDistance) [best, bestDistance] = [index, distance];
  });
  return cum[best];
}

export function timetable(route, timeline) {
  const { start, stop1, end } = route.points;
  const rows = [{ minute: 0, text: `從${start.name}出發（第一段）`, kind: "start" }];
  timeline.legs.forEach((leg, index) => {
    for (const place of route.via?.[index] || []) {
      const meters = leg.fromM + nearestVertexMeters(leg.path, leg.cum, place);
      rows.push({ minute: minuteAtMeter(timeline, meters), text: `經過 ${place.name}`, kind: "via" });
    }
  });
  const stopMinutes = timeline.stop.toMin - timeline.stop.fromMin;
  rows.push({ minute: timeline.stop.fromMin, text: `到${stop1.name}（停留點一），停 ${stopMinutes} 分鐘`, kind: "stop" });
  rows.push({ minute: timeline.stop.toMin, text: "出發第二段", kind: "depart" });
  for (const range of timeline.backtrack) {
    const meters = Math.round(range.toM - range.fromM);
    rows.push({
      minute: range.fromMin,
      text: `第 ${Math.round(range.fromMin)}～${Math.round(range.toMin)} 分鐘走回頭路（約 ${meters} 公尺，跟前面走過的是同一條路）`,
      kind: "back",
    });
  }
  rows.push({ minute: timeline.totalMin, text: `抵達終點${end.name}`, kind: "end" });
  return rows.sort((a, b) => a.minute - b.minute || TIMETABLE_KIND_ORDER.indexOf(a.kind) - TIMETABLE_KIND_ORDER.indexOf(b.kind));
}

export function describeMoment(route, timeline, minute) {
  const { stop1, end } = route.points;
  const { phase, backtracking } = positionAt(timeline, minute);
  const n = Math.round(minute);
  const texts = {
    leg1: `第 ${n} 分鐘｜第一段，往${stop1.name}走`,
    stop: `第 ${n} 分鐘｜在${stop1.name}：念介紹詞、故事卡`,
    leg2: `第 ${n} 分鐘｜第二段，往${end.name}走`,
    end: `第 ${n} 分鐘｜抵達終點${end.name}`,
  };
  return { text: texts[phase], backtracking };
}

export function offsetPath(path, meters) {
  const metersPerDegreeLat = (EARTH_RADIUS_M * Math.PI) / 180;
  return path.map(([lat, lon], index) => {
    const [prevLat, prevLon] = path[Math.max(index - 1, 0)];
    const [nextLat, nextLon] = path[Math.min(index + 1, path.length - 1)];
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const east = (nextLon - prevLon) * cosLat;
    const north = nextLat - prevLat;
    const length = Math.hypot(east, north);
    if (!length) return [lat, lon];
    const [rightEast, rightNorth] = [north / length, -east / length];
    return [lat + (rightNorth * meters) / metersPerDegreeLat, lon + (rightEast * meters) / (metersPerDegreeLat * cosLat)];
  });
}

export function metersPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}
