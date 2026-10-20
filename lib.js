const METERS_PER_MINUTE = 70;

export function formatMinutes(meters) {
  return `約 ${Math.round(meters / METERS_PER_MINUTE)} 分鐘`;
}

export function routeIdFromHash(hash) {
  const id = hash.replace(/^#/, "");
  return id ? decodeURIComponent(id) : null;
}
