import type { Database } from "bun:sqlite";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const API_PREFIX = "/api/v1";
const MAX_BODY_BYTES = 256 * 1024;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
const KINDS = new Set(["committed", "history_state", "tab_url_change"]);

type JsonObject = Record<string, unknown>;

type AppOptions = {
  database: Database;
  now?: () => number;
  id?: () => string;
  token?: () => string;
};

type AuthenticatedUser = {
  id: string;
  username: string;
  tokenHash: Buffer;
};

type TabInput = {
  browserTabId: number;
  windowId: number;
  index: number;
  active: boolean;
  pinned: boolean;
  url: string;
  title: string;
};

type HistoryInput = {
  eventId: string;
  browserTabId: number;
  kind: string;
  url: string;
  title: string;
  visitedAt: number;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "cache-control": "no-store",
};

function response(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

function errorResponse(error: HttpError): Response {
  return response({ error: { code: error.code, message: error.message } }, error.status);
}

async function readJson(request: Request): Promise<JsonObject> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "PAYLOAD_TOO_LARGE", "request body exceeds 256 KiB");
  }

  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as JsonObject;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "request body must be a JSON object");
  }
}

function requiredString(body: JsonObject, key: string, max: number): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new HttpError(400, "VALIDATION_ERROR", `${key} must be a non-empty string of at most ${max} characters`);
  }
  return value;
}

function optionalTitle(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > 512) {
    throw new HttpError(400, "VALIDATION_ERROR", "title must be a string of at most 512 characters");
  }
  return value;
}

function integer(value: unknown, key: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new HttpError(400, "VALIDATION_ERROR", `${key} must be an integer of at least ${minimum}`);
  }
  return value as number;
}

function boolean(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") throw new HttpError(400, "VALIDATION_ERROR", `${key} must be a boolean`);
  return value;
}

function date(value: unknown, key: string): number {
  if (typeof value !== "string") throw new HttpError(400, "VALIDATION_ERROR", `${key} must be an ISO 8601 string`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new HttpError(400, "VALIDATION_ERROR", `${key} must be an ISO 8601 string`);
  return parsed;
}

function cleanUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) {
    throw new HttpError(400, "VALIDATION_ERROR", "url must be a non-empty string of at most 8192 characters");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "url must be valid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(400, "VALIDATION_ERROR", "url must use http or https");
  }
  parsed.username = "";
  parsed.password = "";
  return parsed.toString();
}

function digestToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

function cursorEncode(visitedAt: number, id: number): string {
  return Buffer.from(JSON.stringify({ visitedAt, id }), "utf8").toString("base64url");
}

function cursorDecode(value: string): { visitedAt: number; id: number } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Number.isSafeInteger(parsed.visitedAt) || !Number.isSafeInteger(parsed.id)) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, "VALIDATION_ERROR", "cursor is invalid");
  }
}

function validateTab(value: unknown): TabInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", "each tab must be an object");
  }
  const tab = value as JsonObject;
  return {
    browserTabId: integer(tab.browserTabId, "browserTabId"),
    windowId: integer(tab.windowId, "windowId", -1),
    index: integer(tab.index, "index"),
    active: boolean(tab.active, "active"),
    pinned: boolean(tab.pinned, "pinned"),
    url: cleanUrl(tab.url),
    title: optionalTitle(tab.title),
  };
}

function validateHistory(value: unknown): HistoryInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", "each history event must be an object");
  }
  const event = value as JsonObject;
  const eventId = requiredString(event, "eventId", 80);
  const kind = requiredString(event, "kind", 32);
  if (!KINDS.has(kind)) throw new HttpError(400, "VALIDATION_ERROR", "kind is invalid");
  return {
    eventId,
    browserTabId: integer(event.browserTabId, "browserTabId"),
    kind,
    url: cleanUrl(event.url),
    title: optionalTitle(event.title),
    visitedAt: date(event.visitedAt, "visitedAt"),
  };
}

export function createApp({ database, now = Date.now, id = randomUUID, token }: AppOptions) {
  const makeToken = token ?? (() => `ts_${randomBytes(32).toString("base64url")}`);

  function authenticate(request: Request): AuthenticatedUser {
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ") || header.length <= 7) {
      throw new HttpError(401, "UNAUTHORIZED", "authentication required");
    }
    const tokenHash = digestToken(header.slice(7));
    const row = database
      .query(`SELECT users.id, users.username, auth_sessions.expires_at
              FROM auth_sessions JOIN users ON users.id = auth_sessions.user_id
              WHERE auth_sessions.token_hash = ?`)
      .get(tokenHash) as { id: string; username: string; expires_at: number } | null;
    if (!row || row.expires_at <= now()) {
      if (row) database.query("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
      throw new HttpError(401, "UNAUTHORIZED", "authentication required");
    }
    database.query("UPDATE auth_sessions SET last_used_at = ? WHERE token_hash = ?").run(now(), tokenHash);
    return { id: row.id, username: row.username, tokenHash };
  }

  function createSession(userId: string): string {
    const value = makeToken();
    const createdAt = now();
    database
      .query("INSERT INTO auth_sessions(token_hash, user_id, created_at, expires_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
      .run(digestToken(value), userId, createdAt, createdAt + SESSION_TTL_MS, createdAt);
    return value;
  }

  function ownedDevice(deviceId: string, userId: string) {
    const row = database
      .query("SELECT id, tabs_revision FROM devices WHERE id = ? AND user_id = ?")
      .get(deviceId, userId) as { id: string; tabs_revision: number } | null;
    if (!row) throw new HttpError(404, "NOT_FOUND", "resource not found");
    return row;
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    try {
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === "GET" && path === "/health") return response({ status: "ok" });

      if (request.method === "POST" && path === `${API_PREFIX}/auth/register`) {
        const body = await readJson(request);
        const username = requiredString(body, "username", 32);
        const password = requiredString(body, "password", 128);
        if (!USERNAME.test(username)) {
          throw new HttpError(400, "VALIDATION_ERROR", "username must be 3-32 ASCII letters, digits, dots, dashes, or underscores");
        }
        const canonical = username.toLowerCase();
        if (database.query("SELECT 1 FROM users WHERE username_canonical = ?").get(canonical)) {
          throw new HttpError(409, "USERNAME_TAKEN", "username is already registered");
        }
        const userId = `usr_${id()}`;
        const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
        database
          .query("INSERT INTO users(id, username, username_canonical, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(userId, username, canonical, passwordHash, now());
        return response({ token: createSession(userId), user: { id: userId, username } }, 201);
      }

      if (request.method === "POST" && path === `${API_PREFIX}/auth/login`) {
        const body = await readJson(request);
        const username = requiredString(body, "username", 32).toLowerCase();
        const password = requiredString(body, "password", 128);
        const user = database
          .query("SELECT id, username, password_hash FROM users WHERE username_canonical = ?")
          .get(username) as { id: string; username: string; password_hash: string } | null;
        if (!user || !(await Bun.password.verify(password, user.password_hash))) {
          throw new HttpError(401, "INVALID_CREDENTIALS", "invalid username or password");
        }
        return response({ token: createSession(user.id), user: { id: user.id, username: user.username } });
      }

      if (request.method === "POST" && path === `${API_PREFIX}/auth/logout`) {
        const user = authenticate(request);
        database.query("DELETE FROM auth_sessions WHERE token_hash = ?").run(user.tokenHash);
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method === "GET" && path === `${API_PREFIX}/me`) {
        const user = authenticate(request);
        return response({ user: { id: user.id, username: user.username } });
      }

      if (request.method === "POST" && path === `${API_PREFIX}/devices`) {
        const user = authenticate(request);
        const body = await readJson(request);
        const installationId = requiredString(body, "installationId", 128);
        const displayName = requiredString(body, "displayName", 80);
        const browser = requiredString(body, "browser", 16);
        const platform = requiredString(body, "platform", 16);
        const extensionVersion = requiredString(body, "extensionVersion", 32);
        if (!new Set(["chrome", "safari"]).has(browser) || !new Set(["macos", "ios"]).has(platform)) {
          throw new HttpError(400, "VALIDATION_ERROR", "browser or platform is invalid");
        }
        const existing = database
          .query("SELECT id, created_at, tabs_revision FROM devices WHERE user_id = ? AND installation_id = ?")
          .get(user.id, installationId) as { id: string; created_at: number; tabs_revision: number } | null;
        const seenAt = now();
        if (existing) {
          database
            .query("UPDATE devices SET display_name = ?, browser = ?, platform = ?, extension_version = ?, last_seen_at = ? WHERE id = ?")
            .run(displayName, browser, platform, extensionVersion, seenAt, existing.id);
          return response({ device: { id: existing.id, installationId, displayName, browser, platform, extensionVersion, tabsRevision: existing.tabs_revision, lastSeenAt: iso(seenAt), createdAt: iso(existing.created_at) } });
        }
        const deviceId = `dev_${id()}`;
        database
          .query(`INSERT INTO devices(id, user_id, installation_id, display_name, browser, platform, extension_version, last_seen_at, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(deviceId, user.id, installationId, displayName, browser, platform, extensionVersion, seenAt, seenAt);
        return response({ device: { id: deviceId, installationId, displayName, browser, platform, extensionVersion, tabsRevision: 0, lastSeenAt: iso(seenAt), createdAt: iso(seenAt) } }, 201);
      }

      if (request.method === "GET" && path === `${API_PREFIX}/devices`) {
        const user = authenticate(request);
        const rows = database
          .query(`SELECT devices.*, COUNT(open_tabs.browser_tab_id) AS open_tab_count
                  FROM devices LEFT JOIN open_tabs ON open_tabs.device_id = devices.id
                  WHERE devices.user_id = ? GROUP BY devices.id ORDER BY devices.last_seen_at DESC`)
          .all(user.id) as Array<Record<string, string | number>>;
        return response({ devices: rows.map((row) => ({
          id: row.id,
          installationId: row.installation_id,
          displayName: row.display_name,
          browser: row.browser,
          platform: row.platform,
          extensionVersion: row.extension_version,
          tabsRevision: row.tabs_revision,
          openTabCount: row.open_tab_count,
          lastSeenAt: iso(row.last_seen_at as number),
          createdAt: iso(row.created_at as number),
        })) });
      }

      const tabsMatch = path.match(/^\/api\/v1\/devices\/([^/]+)\/tabs$/);
      if (request.method === "PUT" && tabsMatch) {
        const user = authenticate(request);
        const device = ownedDevice(decodeURIComponent(tabsMatch[1]!), user.id);
        const body = await readJson(request);
        const revision = integer(body.revision, "revision", 1);
        const observedAt = date(body.observedAt, "observedAt");
        if (!Array.isArray(body.tabs) || body.tabs.length > 500) {
          throw new HttpError(400, "VALIDATION_ERROR", "tabs must be an array of at most 500 items");
        }
        const tabs = body.tabs.map(validateTab);
        if (new Set(tabs.map((tab) => tab.browserTabId)).size !== tabs.length) {
          throw new HttpError(400, "VALIDATION_ERROR", "browserTabId values must be unique");
        }
        if (revision <= device.tabs_revision) {
          const count = database.query("SELECT COUNT(*) AS count FROM open_tabs WHERE device_id = ?").get(device.id) as { count: number };
          return response({ acceptedRevision: device.tabs_revision, openTabCount: count.count });
        }
        database.exec("BEGIN IMMEDIATE");
        try {
          database.query("DELETE FROM open_tabs WHERE device_id = ?").run(device.id);
          const insert = database.query(`INSERT INTO open_tabs
            (device_id, browser_tab_id, window_id, tab_index, url, title, active, pinned, observed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          for (const tab of tabs) {
            insert.run(device.id, tab.browserTabId, tab.windowId, tab.index, tab.url, tab.title, Number(tab.active), Number(tab.pinned), observedAt);
          }
          database.query("UPDATE devices SET tabs_revision = ?, last_seen_at = ? WHERE id = ?").run(revision, now(), device.id);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        return response({ acceptedRevision: revision, openTabCount: tabs.length });
      }

      const historyMatch = path.match(/^\/api\/v1\/devices\/([^/]+)\/history$/);
      if (request.method === "POST" && historyMatch) {
        const user = authenticate(request);
        const device = ownedDevice(decodeURIComponent(historyMatch[1]!), user.id);
        const body = await readJson(request);
        if (!Array.isArray(body.events) || body.events.length > 100) {
          throw new HttpError(400, "VALIDATION_ERROR", "events must be an array of at most 100 items");
        }
        const events = body.events.map(validateHistory);
        let accepted = 0;
        database.exec("BEGIN IMMEDIATE");
        try {
          const insert = database.query(`INSERT OR IGNORE INTO history_entries
            (event_id, device_id, browser_tab_id, url, title, kind, visited_at, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
          for (const event of events) {
            accepted += insert.run(event.eventId, device.id, event.browserTabId, event.url, event.title, event.kind, event.visitedAt, now()).changes;
          }
          database.query("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now(), device.id);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
        return response({ accepted, duplicates: events.length - accepted });
      }

      if (request.method === "GET" && path === `${API_PREFIX}/state`) {
        const user = authenticate(request);
        const rawLimit = url.searchParams.get("historyLimit") ?? "100";
        const limit = Number(rawLimit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
          throw new HttpError(400, "VALIDATION_ERROR", "historyLimit must be an integer from 1 to 100");
        }
        const deviceRows = database.query("SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC").all(user.id) as Array<Record<string, string | number>>;
        const tabQuery = database.query("SELECT * FROM open_tabs WHERE device_id = ? ORDER BY window_id, tab_index");
        const devices = deviceRows.map((row) => ({
          id: row.id,
          installationId: row.installation_id,
          displayName: row.display_name,
          browser: row.browser,
          platform: row.platform,
          extensionVersion: row.extension_version,
          tabsRevision: row.tabs_revision,
          lastSeenAt: iso(row.last_seen_at as number),
          createdAt: iso(row.created_at as number),
          openTabs: (tabQuery.all(row.id) as Array<Record<string, string | number>>).map((tab) => ({
            browserTabId: tab.browser_tab_id,
            windowId: tab.window_id,
            index: tab.tab_index,
            url: tab.url,
            title: tab.title,
            active: Boolean(tab.active),
            pinned: Boolean(tab.pinned),
            observedAt: iso(tab.observed_at as number),
          })),
        }));
        const historyDeviceId = url.searchParams.get("deviceId");
        if (historyDeviceId) ownedDevice(historyDeviceId, user.id);
        const historyTotal = historyDeviceId
          ? (database.query("SELECT COUNT(*) AS total FROM history_entries WHERE device_id = ?").get(historyDeviceId) as { total: number }).total
          : (database.query(`SELECT COUNT(*) AS total FROM history_entries
              JOIN devices ON devices.id = history_entries.device_id
              WHERE devices.user_id = ?`).get(user.id) as { total: number }).total;
        const cursorValue = url.searchParams.get("cursor");
        const cursor = cursorValue ? cursorDecode(cursorValue) : null;
        const params: Array<string | number> = [user.id];
        let deviceSql = "";
        if (historyDeviceId) {
          deviceSql = "AND history_entries.device_id = ?";
          params.push(historyDeviceId);
        }
        let cursorSql = "";
        if (cursor) {
          cursorSql = "AND (history_entries.visited_at < ? OR (history_entries.visited_at = ? AND history_entries.id < ?))";
          params.push(cursor.visitedAt, cursor.visitedAt, cursor.id);
        }
        params.push(limit + 1);
        const rows = database.query(`SELECT history_entries.*, devices.display_name, devices.browser, devices.platform
          FROM history_entries JOIN devices ON devices.id = history_entries.device_id
          WHERE devices.user_id = ? ${deviceSql} ${cursorSql}
          ORDER BY history_entries.visited_at DESC, history_entries.id DESC LIMIT ?`).all(...params) as Array<Record<string, string | number>>;
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        const last = page.at(-1);
        return response({
          devices,
          history: {
            total: historyTotal,
            items: page.map((row) => ({
              id: row.id,
              eventId: row.event_id,
              deviceId: row.device_id,
              deviceName: row.display_name,
              browser: row.browser,
              platform: row.platform,
              browserTabId: row.browser_tab_id,
              url: row.url,
              title: row.title,
              kind: row.kind,
              visitedAt: iso(row.visited_at as number),
              receivedAt: iso(row.received_at as number),
            })),
            nextCursor: hasMore && last ? cursorEncode(last.visited_at as number, last.id as number) : null,
          },
        });
      }

      if (request.method === "DELETE" && path === `${API_PREFIX}/history`) {
        const user = authenticate(request);
        const deviceId = url.searchParams.get("deviceId");
        if (deviceId) {
          ownedDevice(deviceId, user.id);
          const result = database.query("DELETE FROM history_entries WHERE device_id = ?").run(deviceId);
          return response({ deleted: result.changes });
        }
        const result = database.query("DELETE FROM history_entries WHERE device_id IN (SELECT id FROM devices WHERE user_id = ?)").run(user.id);
        return response({ deleted: result.changes });
      }

      const deviceMatch = path.match(/^\/api\/v1\/devices\/([^/]+)$/);
      if (request.method === "DELETE" && deviceMatch) {
        const user = authenticate(request);
        const device = ownedDevice(decodeURIComponent(deviceMatch[1]!), user.id);
        database.query("DELETE FROM devices WHERE id = ?").run(device.id);
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      throw new HttpError(404, "NOT_FOUND", "route not found");
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error);
      console.error(error);
      return errorResponse(new HttpError(500, "INTERNAL_ERROR", "unexpected server error"));
    }
  };
}
