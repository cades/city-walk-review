// Backend for the city walk route review site. Paste into the Apps Script editor bound to the
// 「城市散步路線檢閱_意見」 spreadsheet. Script properties: CLIENT_ID (OAuth web client ID) and
// TOKEN_SECRET (created by setup()). Nothing secret lives in this file.

const COMMENTS_SHEET = "意見";
const MEMBERS_SHEET = "成員";
const COMMENT_HEADERS = ["編號", "時間", "路線檔名", "路線名稱", "名字", "Email", "緯度", "經度", "內容", "狀態", "回覆", "回覆時間"];
const MEMBER_HEADERS = ["Email", "名字", "備註"];
const COL = Object.fromEntries(COMMENT_HEADERS.map((name, index) => [name, index]));
const TOKEN_DAYS = 30;
const MAX_TEXT = 2000;
const DELETED = "已刪除";

function setup() {
  const book = SpreadsheetApp.getActive();
  for (const [name, headers] of [[COMMENTS_SHEET, COMMENT_HEADERS], [MEMBERS_SHEET, MEMBER_HEADERS]]) {
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  }
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("TOKEN_SECRET")) props.setProperty("TOKEN_SECRET", Utilities.getUuid() + Utilities.getUuid());
}

function doGet() {
  return json({ ok: true, service: "city-walk-review" });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: "bad_request" });
  }
  try {
    switch (body.action) {
      case "login": return json(login(body));
      case "list": return json(withMember(body, listComments));
      case "add": return json(withMember(body, addComment));
      case "delete": return json(withMember(body, deleteComment));
      default: return json({ ok: false, error: "bad_request" });
    }
  } catch (err) {
    console.error(err);
    return json({ ok: false, error: "server_error" });
  }
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function findMember(email) {
  const rows = SpreadsheetApp.getActive().getSheetByName(MEMBERS_SHEET).getDataRange().getValues().slice(1);
  const row = rows.find((r) => normalizeEmail(r[0]) === email);
  return row ? { email, name: String(row[1] || "") } : null;
}

function login({ idToken }) {
  if (typeof idToken !== "string" || !idToken) return { ok: false, error: "auth" };
  const response = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return { ok: false, error: "auth" };
  const info = JSON.parse(response.getContentText());
  const clientId = PropertiesService.getScriptProperties().getProperty("CLIENT_ID");
  if (info.aud !== clientId || info.email_verified !== "true" || Number(info.exp) * 1000 < Date.now()) {
    return { ok: false, error: "auth" };
  }
  const email = normalizeEmail(info.email);
  const member = findMember(email);
  if (!member) return { ok: false, error: "not_member" };
  const name = info.name || member.name || email;
  return { ok: true, token: issueToken({ email, name }), name };
}

function encode(text) {
  return Utilities.base64EncodeWebSafe(text, Utilities.Charset.UTF_8);
}

function sign(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty("TOKEN_SECRET");
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret));
}

function issueToken(user) {
  const payload = encode(JSON.stringify({ email: user.email, name: user.name, exp: Date.now() + TOKEN_DAYS * 86400000 }));
  return payload + "." + sign(payload);
}

function readToken(token) {
  if (typeof token !== "string") return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) return null;
  const user = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payload)).getDataAsString("UTF-8"));
  return user.exp > Date.now() ? user : null;
}

function withMember(body, handler) {
  const user = readToken(body.token);
  if (!user) return { ok: false, error: "auth" };
  if (!findMember(normalizeEmail(user.email))) return { ok: false, error: "not_member" };
  return handler(body, user);
}

function commentsSheet() {
  return SpreadsheetApp.getActive().getSheetByName(COMMENTS_SHEET);
}

function toComment(row, user) {
  const time = row[COL["時間"]];
  const replyTime = row[COL["回覆時間"]];
  return {
    id: String(row[COL["編號"]]),
    time: time instanceof Date ? time.toISOString() : String(time),
    routeId: String(row[COL["路線檔名"]]),
    routeTitle: String(row[COL["路線名稱"]]),
    name: String(row[COL["名字"]]),
    lat: row[COL["緯度"]] === "" ? null : Number(row[COL["緯度"]]),
    lon: row[COL["經度"]] === "" ? null : Number(row[COL["經度"]]),
    text: String(row[COL["內容"]]),
    status: String(row[COL["狀態"]] || "未處理"),
    reply: String(row[COL["回覆"]] || ""),
    replyTime: replyTime instanceof Date ? replyTime.toISOString() : String(replyTime || ""),
    mine: normalizeEmail(row[COL["Email"]]) === normalizeEmail(user.email),
  };
}

function listComments(body, user) {
  const rows = commentsSheet().getDataRange().getValues().slice(1);
  const comments = rows.filter((row) => row[COL["編號"]] && row[COL["狀態"]] !== DELETED).map((row) => toComment(row, user));
  return { ok: true, comments };
}

// A leading = + - @ would make Sheets treat user text as a formula.
function literal(text) {
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function addComment(body, user) {
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
  const routeTitle = typeof body.routeTitle === "string" ? body.routeTitle.trim() : "";
  const hasLat = body.lat !== undefined && body.lat !== null;
  const hasLon = body.lon !== undefined && body.lon !== null;
  const validPoint = hasLat === hasLon && (!hasLat || (Number.isFinite(body.lat) && Number.isFinite(body.lon)));
  if (!text || text.length > MAX_TEXT || !routeId || routeId.length > 50 || routeTitle.length > 100 || !validPoint) {
    return { ok: false, error: "bad_request" };
  }
  const values = [Utilities.getUuid(), new Date(), routeId, routeTitle, user.name,
    normalizeEmail(user.email), hasLat ? body.lat : "", hasLon ? body.lon : "", text, "未處理", "", ""];
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    commentsSheet().appendRow(values.map((value) => (typeof value === "string" ? literal(value) : value)));
  } finally {
    lock.releaseLock();
  }
  return { ok: true, comment: toComment(values, user) };
}

function deleteComment(body, user) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = commentsSheet();
    const rows = sheet.getDataRange().getValues();
    const index = rows.findIndex((row, i) => i > 0 && String(row[COL["編號"]]) === String(body.id));
    if (index < 0) return { ok: false, error: "bad_request" };
    if (normalizeEmail(rows[index][COL["Email"]]) !== normalizeEmail(user.email)) return { ok: false, error: "bad_request" };
    sheet.getRange(index + 1, COL["狀態"] + 1).setValue(DELETED);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
