import { CONFIG } from "./config.js?v=202610210100";
import { el } from "./dom.js?v=202610210100";
import { isAuthError, isInAppBrowser, openCountsByRoute } from "./lib.js?v=202610210100";

const TOKEN_KEY = "cwr_token";
const NAME_KEY = "cwr_name";
const GSI_SRC = "https://accounts.google.com/gsi/client";
const HANDLED = new Set(["已處理", "不處理"]);

let gsiLoading = null;
let commentLayer = null;
let pickLayer = null;
let stopPicking = null;

class LoginExpired extends Error {}
class NotMember extends Error {}

export function feedbackEnabled() {
  return Boolean(CONFIG.apiUrl && CONFIG.clientId);
}

function stored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private browsing: the login lasts for this page only.
  }
}

function logout() {
  store(TOKEN_KEY, null);
  store(NAME_KEY, null);
}

async function api(action, payload = {}) {
  const response = await fetch(CONFIG.apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!response.ok) throw new Error(`伺服器回應 ${response.status}`);
  const result = await response.json();
  if (isAuthError(result)) {
    logout();
    throw new LoginExpired();
  }
  if (result.error === "not_member") throw new NotMember();
  if (!result.ok) throw new Error(result.error);
  return result;
}

async function loadComments() {
  const { comments } = await api("list", { token: stored(TOKEN_KEY) });
  return comments;
}

function loadGsi() {
  gsiLoading ??= new Promise((resolve, reject) => {
    const script = el("script", { src: GSI_SRC, async: "" });
    script.addEventListener("load", resolve);
    script.addEventListener("error", () => reject(new Error("Google 登入元件載入失敗")));
    document.head.append(script);
  });
  return gsiLoading;
}

function stopPinMode() {
  stopPicking?.();
  stopPicking = null;
}

function resetPicking() {
  stopPinMode();
  pickLayer?.clear();
}

async function showLogin(panel, onLogin, message) {
  commentLayer?.clear();
  commentLayer = null;
  resetPicking();
  panel.replaceChildren(el("h2", {}, "意見"));
  if (message) panel.append(el("p", { class: "notice" }, message));
  if (isInAppBrowser(navigator.userAgent)) {
    panel.append(el("p", { class: "notice" }, "請改用 Safari 或 Chrome 開啟這個網頁，才能登入留意見。"));
    return;
  }
  panel.append(el("p", {}, "用 Google 帳號登入後，可以看大家的意見，也可以留意見。"));
  const button = el("div", {});
  panel.append(button);
  try {
    await loadGsi();
  } catch (error) {
    panel.append(el("p", { class: "notice" }, error.message));
    return;
  }
  google.accounts.id.initialize({
    client_id: CONFIG.clientId,
    callback: async ({ credential }) => {
      try {
        const { token, name } = await api("login", { idToken: credential });
        store(TOKEN_KEY, token);
        store(NAME_KEY, name);
        onLogin();
      } catch (error) {
        showLogin(panel, onLogin, error instanceof NotMember ? "你還不是成員，請找企劃室加入。" : "登入失敗，請再試一次。");
      }
    },
  });
  google.accounts.id.renderButton(button, { theme: "outline", size: "large", text: "signin_with", locale: "zh-TW" });
}

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" });
}

function drawCommentMarkers(comments, mapView) {
  commentLayer?.clear();
  commentLayer = mapView.layer();
  for (const comment of comments) {
    if (comment.lat == null || comment.lon == null) continue;
    const handled = HANDLED.has(comment.status);
    commentLayer.pin(comment, {
      className: `pin-comment${handled ? " pin-handled" : ""}`, badge: "意", title: `${comment.name}：${comment.text}`, zIndex: 50,
    });
  }
}

function commentItem(comment, onDelete) {
  const handled = HANDLED.has(comment.status);
  const meta = [comment.name, formatTime(comment.time), comment.lat != null ? "有標位置" : null, handled ? comment.status : null]
    .filter(Boolean).join("・");
  const item = el("li", { class: `comment${handled ? " comment-handled" : ""}` },
    el("p", { class: "comment-meta" }, meta),
    el("p", { class: "comment-text" }, comment.text),
    comment.reply ? el("p", { class: "comment-reply" }, `回覆：${comment.reply}`) : null);
  if (comment.mine && !handled) {
    const remove = el("button", { type: "button", class: "link-button" }, "刪除");
    remove.addEventListener("click", () => onDelete(comment, remove));
    item.append(remove);
  }
  return item;
}

function commentForm(route, mapView, onAdded) {
  const textarea = el("textarea", { id: "comment-text", rows: "3", maxlength: "2000", placeholder: "例如：這段沒有人行道" });
  const pinButton = el("button", { type: "button", class: "toggle", "aria-pressed": "false" }, "在地圖上標位置");
  const send = el("button", { type: "submit", class: "primary" }, "送出");
  const status = el("p", { class: "form-status", role: "status" });
  const form = el("form", { class: "comment-form" },
    el("label", { for: "comment-text" }, "留意見"), textarea, el("div", { class: "form-row" }, pinButton, send), status);
  let pin = null;
  resetPicking();
  pickLayer = mapView.layer();

  const clearPin = () => {
    pickLayer.clear();
    pin = null;
  };
  const onMapClick = async (position) => {
    clearPin();
    pin = await pickLayer.draggablePin(position, { className: "pin-comment", badge: "意" });
    status.textContent = "已標好位置，可以拖動標記微調。";
  };
  pinButton.addEventListener("click", () => {
    const active = pinButton.getAttribute("aria-pressed") !== "true";
    pinButton.setAttribute("aria-pressed", String(active));
    if (active) {
      stopPicking = mapView.onClick(onMapClick);
      status.textContent = "請在地圖上點一下要標的位置。";
    } else {
      stopPinMode();
      clearPin();
      status.textContent = "";
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = textarea.value.trim();
    if (!text) {
      status.textContent = "請先寫內容。";
      return;
    }
    send.disabled = true;
    status.textContent = "送出中…";
    const position = pin?.position();
    try {
      const { comment } = await api("add", {
        token: stored(TOKEN_KEY), routeId: route.id, routeTitle: route.title, text,
        lat: position ? Number(position.lat.toFixed(6)) : null, lon: position ? Number(position.lng.toFixed(6)) : null,
      });
      textarea.value = "";
      stopPinMode();
      pinButton.setAttribute("aria-pressed", "false");
      clearPin();
      status.textContent = "已送出。";
      onAdded(comment);
    } catch (error) {
      status.textContent = error instanceof LoginExpired ? "登入已過期，請重新登入。" : `沒有送出：${error.message}。剛才寫的內容還在，可以再按一次送出。`;
      if (error instanceof LoginExpired) onAdded(null);
    } finally {
      send.disabled = false;
    }
  });
  return form;
}

export async function renderComments(route, mapView) {
  const panel = document.getElementById("comments");
  if (!panel || !feedbackEnabled()) return;
  panel.hidden = false;
  const stillShowing = () => panel.isConnected && mapView.active;
  const rerender = () => stillShowing() && renderComments(route, mapView);
  if (!stored(TOKEN_KEY)) {
    showLogin(panel, rerender);
    return;
  }
  panel.replaceChildren(el("h2", {}, "意見"), el("p", {}, "讀取意見中…"));
  let all;
  try {
    all = await loadComments();
  } catch (error) {
    if (!stillShowing()) return;
    if (error instanceof LoginExpired) return showLogin(panel, rerender, "登入已過期，請重新登入。");
    if (error instanceof NotMember) return showLogin(panel, rerender, "你還不是成員，請找企劃室加入。");
    panel.replaceChildren(el("h2", {}, "意見"), el("p", { class: "notice" }, `讀不到意見：${error.message}`));
    return;
  }
  if (!stillShowing()) return;
  const comments = all.filter((comment) => comment.routeId === route.id);
  const heading = el("h2", {});
  const list = el("ul", { class: "comments" });
  const refresh = el("button", { type: "button", class: "link-button" }, "重新整理意見");
  refresh.addEventListener("click", rerender);
  const signOut = el("button", { type: "button", class: "link-button" }, "登出");
  signOut.addEventListener("click", () => {
    logout();
    rerender();
  });

  const onDelete = async (comment, button) => {
    button.disabled = true;
    try {
      await api("delete", { token: stored(TOKEN_KEY), id: comment.id });
      rerender();
    } catch (error) {
      if (error instanceof LoginExpired) return showLogin(panel, rerender, "登入已過期，請重新登入。");
      button.disabled = false;
      button.textContent = "刪除失敗，再試一次";
    }
  };
  const fill = () => {
    heading.textContent = `意見（${comments.length}）`;
    list.replaceChildren(...(comments.length
      ? [...comments].reverse().map((comment) => commentItem(comment, onDelete))
      : [el("li", { class: "comment-empty" }, "這條路線還沒有意見。")]));
    drawCommentMarkers(comments, mapView);
  };
  const form = commentForm(route, mapView, (comment) => {
    if (!comment) return showLogin(panel, rerender, "登入已過期，請重新登入。");
    comments.push(comment);
    fill();
  });
  fill();
  panel.replaceChildren(
    heading,
    el("p", { class: "comment-tools" }, `以 ${stored(NAME_KEY) || "你的帳號"} 登入・`, refresh, "・", signOut),
    form,
    list,
  );
}

export async function homeCommentCounts() {
  if (!feedbackEnabled() || !stored(TOKEN_KEY)) return null;
  try {
    return openCountsByRoute(await loadComments());
  } catch {
    return null;
  }
}
