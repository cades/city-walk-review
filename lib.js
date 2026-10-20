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
