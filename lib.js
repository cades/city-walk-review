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
