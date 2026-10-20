import { CONFIG } from "./config.js?v=202610210100";
import { el } from "./dom.js?v=202610210100";
import { headingTo, latLngOf } from "./lib.js?v=202610210100";

const TAIWAN = { lat: 23.7, lng: 121.0 };
const FRAME_PADDING = 24;
const STREET_VIEW_RADIUS_M = 80;
const READY_CALLBACK = "cwrMapsReady";

// Every new google.maps.Map is a billed map load, so one map moves between pages instead of being rebuilt.
let loading = null;
let map = null;
let canvas = null;
let infoWindow = null;
let current = null;

function loadLibraries() {
  loading ??= new Promise((resolve, reject) => {
    window[READY_CALLBACK] = resolve;
    const params = new URLSearchParams({
      key: CONFIG.mapsKey, v: "weekly", loading: "async", callback: READY_CALLBACK,
      language: "zh-TW", region: "TW", auth_referrer_policy: "origin",
    });
    const script = el("script", { src: `https://maps.googleapis.com/maps/api/js?${params}`, async: "" });
    script.addEventListener("error", () => reject(new Error("Google 地圖載入失敗，請重新整理頁面。")));
    document.head.append(script);
  })
    .then(() => Promise.all(["core", "maps", "marker", "streetView"].map((name) => google.maps.importLibrary(name))))
    .then((libraries) => Object.assign({}, ...libraries));
  return loading;
}

function toLatLng(point) {
  return Array.isArray(point) ? { lat: point[0], lng: point[1] } : { lat: point.lat, lng: point.lon };
}

function detach(item) {
  if (item.setMap) item.setMap(null);
  else if ("map" in item) item.map = null;
  else item.remove();
}

function streetViewButton(lib, position) {
  const button = el("button", { type: "button", class: "link-button" }, "看這裡的街景");
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const { data } = await new lib.StreetViewService().getPanorama({
        location: position, radius: STREET_VIEW_RADIUS_M, sources: [lib.StreetViewSource.GOOGLE],
      });
      infoWindow.close();
      const panorama = map.getStreetView();
      panorama.setPano(data.location.pano);
      panorama.setPov({ heading: headingTo(latLngOf(data.location.latLng), position), pitch: 0 });
      panorama.setVisible(true);
    } catch {
      button.textContent = "這附近沒有街景";
    }
  });
  return button;
}

class Layer {
  constructor(view) {
    this.view = view;
    this.items = [];
  }

  track(item) {
    this.items.push(item);
    return item;
  }

  clear() {
    for (const item of this.items.splice(0)) detach(item);
  }

  path(points, options) {
    return this.line(points, options);
  }

  line(points, { color, weight, opacity = 1, dashed = false, arrows = false, zIndex = 0 }) {
    return this.view.draw((lib) => {
      const icons = [];
      if (dashed) {
        icons.push({ icon: { path: "M 0,-1 0,1", strokeColor: color, strokeOpacity: opacity, strokeWeight: weight, scale: weight }, offset: "0", repeat: `${weight * 4}px` });
      }
      if (arrows) {
        icons.push({
          // A white outline keeps the arrow visible on top of a line of the same colour.
          icon: { path: lib.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: "#fff", strokeWeight: 1.5, strokeOpacity: 1, fillColor: color, fillOpacity: 1 },
          offset: "40px",
          repeat: "80px",
        });
      }
      const polyline = this.track(new lib.Polyline({
        map,
        path: points.map(toLatLng),
        strokeColor: color,
        strokeWeight: weight,
        strokeOpacity: dashed ? 0 : opacity,
        zIndex,
        icons,
        clickable: false,
      }));
      return { setPoints: (next) => polyline.setPath(next.map(toLatLng)) };
    });
  }

  label(point, { text, className = "", zIndex = 50 }) {
    return this.view.draw((lib) => this.track(new lib.AdvancedMarkerElement({
      map, position: toLatLng(point), content: el("div", { class: `minute-mark ${className}` }, text), zIndex, gmpClickable: false,
    })));
  }

  mover(point, { className = "" } = {}) {
    return this.view.draw((lib) => {
      const marker = this.track(new lib.AdvancedMarkerElement({
        map, position: toLatLng(point), content: el("div", { class: `moving-dot ${className}` }), zIndex: 90, gmpClickable: false,
      }));
      return { moveTo: (next) => { marker.position = toLatLng(next); } };
    });
  }

  marker(point, { content, title, zIndex = 0, onClick }) {
    return this.view.draw((lib) => {
      const position = toLatLng(point);
      const marker = new lib.AdvancedMarkerElement({ map, position, content, title, zIndex, gmpClickable: true });
      marker.addEventListener("gmp-click", () => {
        if (onClick) return onClick();
        infoWindow.setContent(el("div", { class: "info" }, el("p", {}, title), streetViewButton(lib, position)));
        infoWindow.open({ map, anchor: marker });
      });
      return this.track(marker);
    });
  }

  pin(point, { className, badge, title, zIndex }) {
    return this.marker(point, { content: el("div", { class: `pin ${className}` }, badge), title, zIndex });
  }

  dot(point, { className = "", title, onClick }) {
    return this.marker(point, { content: el("div", { class: `marker-dot ${className}` }), title, onClick });
  }

  draggablePin(position, { className, badge }) {
    return this.view.draw((lib) => {
      const marker = this.track(new lib.AdvancedMarkerElement({
        map, position, content: el("div", { class: `pin ${className}` }, badge), gmpDraggable: true, zIndex: 100,
      }));
      return { position: () => latLngOf(marker.position) };
    });
  }
}

class MapView extends Layer {
  constructor(container) {
    super(null);
    this.view = this;
    this.container = container;
    this.layers = [];
    this.resizeObserver = null;
    this.ready = loadLibraries()
      .then((lib) => {
        if (this.active) this.attach(lib);
        return lib;
      })
      .catch((error) => {
        if (this.active) container.replaceChildren(el("p", { class: "notice" }, error.message));
        return null;
      });
  }

  get active() {
    return current === this;
  }

  attach(lib) {
    canvas ??= el("div", { class: "map-canvas" });
    this.container.replaceChildren(canvas);
    if (map) return;
    map = new lib.Map(canvas, {
      mapId: CONFIG.mapId,
      center: TAIWAN,
      zoom: 7,
      colorScheme: lib.ColorScheme.FOLLOW_SYSTEM,
      gestureHandling: "cooperative",
      mapTypeControl: false,
    });
    infoWindow = new lib.InfoWindow();
  }

  async draw(callback) {
    const lib = await this.ready;
    return lib && this.active ? callback(lib) : null;
  }

  layer() {
    const layer = new Layer(this);
    this.layers.push(layer);
    return layer;
  }

  frame(points) {
    return this.draw((lib) => {
      const fit = () => {
        if (!points.length) {
          map.setOptions({ center: TAIWAN, zoom: 7 });
          return;
        }
        const bounds = new lib.LatLngBounds();
        for (const point of points) bounds.extend(toLatLng(point));
        map.fitBounds(bounds, FRAME_PADDING);
      };
      fit();
      this.resizeObserver = new ResizeObserver(() => this.active && fit());
      this.resizeObserver.observe(this.container);
    });
  }

  onClick(handler) {
    const listener = this.draw(() => this.track(map.addListener("click", (event) => {
      event.stop();
      handler(latLngOf(event.latLng));
    })));
    return () => listener.then((handle) => handle?.remove());
  }

  onZoom(handler) {
    const listener = this.draw(() => this.track(map.addListener("zoom_changed", () => handler(map.getZoom(), map.getCenter().lat()))));
    return () => listener.then((handle) => handle?.remove());
  }

  zoomInfo() {
    return this.draw(() => ({ zoom: map.getZoom(), lat: map.getCenter().lat() }));
  }

  close() {
    this.resizeObserver?.disconnect();
    for (const layer of this.layers) layer.clear();
    this.clear();
    infoWindow?.close();
    map?.getStreetView().setVisible(false);
  }
}

export function showMap(container) {
  current?.close();
  current = new MapView(container);
  return current;
}
