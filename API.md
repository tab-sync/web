# Tab Sync API

All JSON endpoints start with `/api/v1`.

Authenticated requests need these headers:

```http
Authorization: Bearer ts_...
Content-Type: application/json
```

Times use ISO 8601 strings.

Unknown fields are ignored.

Errors use this shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "human-readable detail"
  }
}
```

## Authentication

### `POST /api/v1/auth/register`

Creates a user and a 30-day session.

Usernames use 3 to 32 ASCII letters, digits, `.`, `_`, or `-`.

Usernames ignore letter case.

Passwords use 12 to 128 characters.

```json
{ "username": "alice", "password": "correct horse battery" }
```

Returns `201`:

```json
{
  "token": "ts_...",
  "user": { "id": "usr_...", "username": "alice" }
}
```

### `POST /api/v1/auth/login`

Uses the same request body as registration.

Returns `200` and a new session.

Invalid credentials always return `401`.

The response does not reveal whether the username exists.

An account can have up to 40 active sessions.

A new login removes the least recently used session when needed.

### `POST /api/v1/auth/logout`

Requires authentication.

Revokes the current session.

Returns `204`.

Use `POST /api/v1/auth/logout?all=true` to revoke all account sessions.

### `GET /api/v1/me`

Checks the current session.

Returns:

```json
{ "user": { "id": "usr_...", "username": "alice" } }
```

## Devices

### `POST /api/v1/devices`

Registers a browser installation.

A later request with the same user and `installationId` updates that device.

```json
{
  "installationId": "local-random-id",
  "displayName": "Safari on iPhone",
  "browser": "safari",
  "platform": "ios",
  "extensionVersion": "1.0.0"
}
```

`browser` must be `chrome`, `firefox`, or `safari`.

`platform` must be `macos` or `ios`.

A new device returns `201`.

An existing device returns `200`.

An account can have up to 32 devices.

A 33rd device returns `409 DEVICE_LIMIT_REACHED`.

### `GET /api/v1/devices`

Lists the user's devices.

Each item includes its last seen time.

Each item includes its accepted tab revision.

Each item includes its open tab count.

### `DELETE /api/v1/devices/:deviceId`

Deletes an owned device.

It also deletes that device's tabs and history.

Returns `204`.

A missing or unowned device returns `404`.

## Open tabs

### `PUT /api/v1/devices/:deviceId/tabs`

Replaces all tabs for one device.

The change runs in one transaction.

`revision` must increase for each new snapshot.

`revision` must be lower than 2^40.

A stale retry succeeds without changing the saved tabs.

A stale retry returns the latest accepted revision.

```json
{
  "revision": 42,
  "observedAt": "2026-09-08T11:24:31.402Z",
  "tabs": [
    {
      "browserTabId": 91,
      "windowId": 1,
      "index": 3,
      "active": true,
      "pinned": false,
      "url": "https://example.com/work?id=7",
      "title": "Work item 7"
    }
  ]
}
```

Returns:

```json
{ "acceptedRevision": 42, "openTabCount": 1 }
```

A snapshot can contain up to 500 tabs.

Only HTTP and HTTPS URLs are accepted.

URL usernames and passwords are removed.

Query strings and fragments stay.

Titles longer than 512 Unicode code points are shortened.

A tab URL can be up to 8192 characters.

A tab with a longer URL is skipped.

The response lists skipped tabs when there are any.

```json
{
  "acceptedRevision": 42,
  "openTabCount": 1,
  "skipped": [{ "index": 3, "reason": "url must be at most 8192 characters" }]
}
```

Other validation errors fail the whole request with `400`.

## History

### `POST /api/v1/devices/:deviceId/history`

Adds up to 100 history events.

`eventId` is the client idempotency key.

It is safe to retry a request with the same event ID.

```json
{
  "events": [
    {
      "eventId": "72902c6f-4109-4ca2-83e7-2a06ce0d09bd",
      "browserTabId": 91,
      "kind": "committed",
      "url": "https://example.com/work?id=7",
      "title": "Work item 7",
      "visitedAt": "2026-09-08T11:24:29.018Z"
    }
  ]
}
```

`kind` must be `committed`, `history_state`, or `tab_url_change`.

Returns:

```json
{ "accepted": 1, "duplicates": 0 }
```

Titles longer than 512 Unicode code points are shortened.

Events with URLs longer than 8192 characters are skipped.

The response lists skipped events when there are any.

### `DELETE /api/v1/history?deviceId=...`

Deletes history for one owned device.

Leave out `deviceId` to delete all history for the current user.

An empty `deviceId` is invalid.

For example, `?deviceId=` returns `400 VALIDATION_ERROR`.

Returns:

```json
{ "deleted": 3 }
```

Old history is deleted automatically.

`HISTORY_RETENTION_DAYS` controls how long history stays.

The default is 90 days.

The server uses the received time for this cleanup.

It does not use the event's `visitedAt` time.

## Combined state

### `GET /api/v1/state?historyLimit=100&tabLimit=200&deviceId=...&cursor=...`

Returns all owned devices.

Returns a page of history in newest-first order.

`history.total` is the full number of matching events.

It does not change with pagination.

`historyLimit` must be from 1 to 100.

Use `deviceId` to limit history to one owned device.

An empty `deviceId` returns `400`.

Pass `nextCursor` back unchanged to load the next history page.

Do not try to read or build a cursor.

The cursor stays valid after a server restart.

`tabLimit` limits open tabs for each device.

The default `tabLimit` is 200.

The maximum `tabLimit` is 500.

`openTabCount` is the full tab count.

It can be larger than the returned `openTabs` list.

```json
{
  "devices": [
    {
      "id": "dev_...",
      "displayName": "Safari on iPhone",
      "browser": "safari",
      "platform": "ios",
      "lastSeenAt": "2026-09-08T11:24:31.402Z",
      "openTabCount": 1,
      "openTabs": []
    }
  ],
  "history": {
    "total": 0,
    "items": [],
    "nextCursor": null
  }
}
```

## Status codes and limits

| Status | Meaning |
| --- | --- |
| `200`, `201`, `204` | Success. |
| `400` | Invalid JSON, field, cursor, or limit. |
| `401` | The bearer session is missing, invalid, or expired. |
| `403` | Registration is disabled. |
| `404` | The route or resource is missing, or the user does not own it. |
| `405` | The method is not allowed. The `Allow` header lists valid methods. |
| `409` | The username exists, a device request raced, or the device limit was reached. |
| `413` | The request body is too large for that route. |
| `415` | The `Content-Type` header is not `application/json`. |
| `429` | There were too many failed login attempts. Check `Retry-After`. |
| `503` | Too many password checks are running. Check `Retry-After`. |
| `500` | An unexpected server error occurred. |

Login and registration requests allow up to 4 KiB.

Device registration requests allow up to 8 KiB.

History requests allow about 2.7 MiB.

Tab snapshot requests allow about 12.5 MiB.

## CORS

The API only sends `access-control-allow-origin` for origins in `ALLOWED_ORIGINS`.

See [readme.md](readme.md) for server configuration.

The bundled dashboard uses the same origin.

The browser extensions use `host_permissions`.

They do not need CORS.
