import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";

let database: Database;
let handle: ReturnType<typeof createApp>;
let sequence: number;

beforeEach(() => {
  database = createDatabase(":memory:");
  sequence = 0;
  handle = createApp({
    database,
    now: () => 1_780_000_000_000 + sequence++,
    id: () => `id-${sequence++}`,
    token: () => `ts_test-token-${sequence++}`,
  });
});

afterEach(() => database.close());

async function request(method: string, path: string, body?: unknown, token?: string) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await handle(new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
}

async function register(username = "alice", password = "correct horse battery") {
  const result = await request("POST", "/api/v1/auth/register", { username, password });
  expect(result.status).toBe(201);
  return result.body.token as string;
}

async function addDevice(token: string, installationId = "install-a", displayName = "Safari on iPhone") {
  const result = await request("POST", "/api/v1/devices", {
    installationId,
    displayName,
    browser: "safari",
    platform: "ios",
    extensionVersion: "1.0.0",
  }, token);
  expect([200, 201]).toContain(result.status);
  return result.body.device.id as string;
}

describe("authentication", () => {
  test("accepts any non-empty password", async () => {
    const token = await register("short-password", "x");
    expect(token).toBeTruthy();
    expect(await request("POST", "/api/v1/auth/login", { username: "short-password", password: "x" })).toMatchObject({ status: 200 });
  });

  test("registers, rejects duplicates, logs in, reads me, and logs out", async () => {
    const token = await register();
    const duplicate = await request("POST", "/api/v1/auth/register", { username: "ALICE", password: "correct horse battery" });
    expect(duplicate.status).toBe(409);

    const badLogin = await request("POST", "/api/v1/auth/login", { username: "alice", password: "wrong-password" });
    expect(badLogin.status).toBe(401);
    const login = await request("POST", "/api/v1/auth/login", { username: "ALICE", password: "correct horse battery" });
    expect(login.status).toBe(200);

    const me = await request("GET", "/api/v1/me", undefined, token);
    expect(me.body.user.username).toBe("alice");
    expect(await request("POST", "/api/v1/auth/logout", undefined, token)).toMatchObject({ status: 204 });
    expect(await request("GET", "/api/v1/me", undefined, token)).toMatchObject({ status: 401 });
  });

  test("hashes passwords and bearer tokens at rest", async () => {
    const token = await register();
    const user = database.query("SELECT password_hash FROM users").get() as { password_hash: string };
    const session = database.query("SELECT token_hash FROM auth_sessions").get() as { token_hash: Uint8Array };
    expect(user.password_hash).not.toContain("correct horse battery");
    expect(Buffer.from(session.token_hash).toString()).not.toContain(token);
  });
});

describe("devices and tabs", () => {
  test("upserts and lists devices, replaces tabs, and rejects stale revisions", async () => {
    const token = await register();
    const deviceId = await addDevice(token);
    const upsert = await request("POST", "/api/v1/devices", {
      installationId: "install-a",
      displayName: "Renamed iPhone",
      browser: "safari",
      platform: "ios",
      extensionVersion: "1.0.1",
    }, token);
    expect(upsert.status).toBe(200);
    expect(upsert.body.device.id).toBe(deviceId);

    const snapshot = await request("PUT", `/api/v1/devices/${deviceId}/tabs`, {
      revision: 2,
      observedAt: "2026-09-08T10:00:00.000Z",
      tabs: [{ browserTabId: 7, windowId: 1, index: 0, active: true, pinned: false, url: "https://user:pass@example.com/a?q=1#x", title: "A" }],
    }, token);
    expect(snapshot).toMatchObject({ status: 200, body: { acceptedRevision: 2, openTabCount: 1 } });

    const stale = await request("PUT", `/api/v1/devices/${deviceId}/tabs`, {
      revision: 1,
      observedAt: "2026-09-08T10:01:00.000Z",
      tabs: [],
    }, token);
    expect(stale.body).toEqual({ acceptedRevision: 2, openTabCount: 1 });

    const devices = await request("GET", "/api/v1/devices", undefined, token);
    expect(devices.body.devices).toHaveLength(1);
    expect(devices.body.devices[0]).toMatchObject({ displayName: "Renamed iPhone", openTabCount: 1 });
    const state = await request("GET", "/api/v1/state", undefined, token);
    expect(state.body.devices[0].openTabs[0].url).toBe("https://example.com/a?q=1#x");
  });

  test("isolates device ownership and cascades device deletion", async () => {
    const alice = await register("alice");
    const aliceDevice = await addDevice(alice);
    const bob = await register("bob");
    expect(await request("GET", `/api/v1/state?deviceId=${aliceDevice}`, undefined, bob)).toMatchObject({ status: 404 });
    expect(await request("DELETE", `/api/v1/devices/${aliceDevice}`, undefined, bob)).toMatchObject({ status: 404 });
    expect(await request("DELETE", `/api/v1/devices/${aliceDevice}`, undefined, alice)).toMatchObject({ status: 204 });
    expect((await request("GET", "/api/v1/devices", undefined, alice)).body.devices).toHaveLength(0);
  });
});

describe("history and validation", () => {
  test("appends idempotently, paginates, and deletes history", async () => {
    const token = await register();
    const deviceId = await addDevice(token);
    const event = (eventId: string, visitedAt: string) => ({ eventId, browserTabId: 7, kind: "committed", url: `https://example.com/${eventId}`, title: eventId, visitedAt });
    const first = await request("POST", `/api/v1/devices/${deviceId}/history`, {
      events: [event("evt-1", "2026-09-08T10:00:00.000Z"), event("evt-2", "2026-09-08T11:00:00.000Z")],
    }, token);
    expect(first.body).toEqual({ accepted: 2, duplicates: 0 });
    const retry = await request("POST", `/api/v1/devices/${deviceId}/history`, {
      events: [event("evt-1", "2026-09-08T10:00:00.000Z")],
    }, token);
    expect(retry.body).toEqual({ accepted: 0, duplicates: 1 });

    const page1 = await request("GET", "/api/v1/state?historyLimit=1", undefined, token);
    expect(page1.body.history.items[0].eventId).toBe("evt-2");
    expect(page1.body.history.total).toBe(2);
    expect(page1.body.history.nextCursor).toBeString();
    const page2 = await request("GET", `/api/v1/state?historyLimit=1&cursor=${page1.body.history.nextCursor}`, undefined, token);
    expect(page2.body.history.items[0].eventId).toBe("evt-1");
    expect(page2.body.history.nextCursor).toBeNull();

    const otherDeviceId = await addDevice(token, "install-b", "Other Safari");
    await request("POST", `/api/v1/devices/${otherDeviceId}/history`, {
      events: [event("evt-other", "2026-09-08T12:00:00.000Z")],
    }, token);
    const filteredPage1 = await request("GET", `/api/v1/state?historyLimit=1&deviceId=${deviceId}`, undefined, token);
    expect(filteredPage1.body.history.items[0]).toMatchObject({ eventId: "evt-2", deviceId });
    expect(filteredPage1.body.history.total).toBe(2);
    const filteredPage2 = await request(
      "GET",
      `/api/v1/state?historyLimit=1&deviceId=${deviceId}&cursor=${filteredPage1.body.history.nextCursor}`,
      undefined,
      token,
    );
    expect(filteredPage2.body.history.items[0]).toMatchObject({ eventId: "evt-1", deviceId });
    expect(filteredPage2.body.history.nextCursor).toBeNull();

    const deleted = await request("DELETE", `/api/v1/history?deviceId=${deviceId}`, undefined, token);
    expect(deleted.body.deleted).toBe(2);
    expect((await request("GET", "/api/v1/state", undefined, token)).body.history.items).toEqual([
      expect.objectContaining({ eventId: "evt-other", deviceId: otherDeviceId }),
    ]);
  });

  test("validates URL schemes, limits, authorization, CORS, and unknown routes", async () => {
    expect(await request("GET", "/api/v1/me")).toMatchObject({ status: 401 });
    const token = await register();
    const deviceId = await addDevice(token);
    const invalid = await request("PUT", `/api/v1/devices/${deviceId}/tabs`, {
      revision: 1,
      observedAt: "2026-09-08T10:00:00.000Z",
      tabs: [{ browserTabId: 1, windowId: 1, index: 0, active: true, pinned: false, url: "chrome://settings", title: "Settings" }],
    }, token);
    expect(invalid).toMatchObject({ status: 400, body: { error: { code: "VALIDATION_ERROR" } } });
    expect(await request("GET", "/api/v1/state?historyLimit=101", undefined, token)).toMatchObject({ status: 400 });
    const options = await request("OPTIONS", "/api/v1/state");
    expect(options.status).toBe(204);
    expect(options.headers.get("access-control-allow-origin")).toBe("*");
    expect(await request("GET", "/api/v1/nope", undefined, token)).toMatchObject({ status: 404 });
    expect(await request("GET", "/")).toMatchObject({ status: 404 });
    expect(await request("GET", "/health")).toMatchObject({ status: 200, body: { status: "ok" } });
  });
});
