# Tab Sync

This repository runs the Tab Sync API and its framework-free dashboard from one Bun server. The server entry point is `index.ts`, API routes live in `api/`, and dashboard files plus their static adapter live in `web/`.

## Requirements

Install [Bun](https://bun.sh/) version 1.2 or newer.

## Run locally


```sh
bun install
bun test
bun run dev
```

Open http://127.0.0.1:3000. The dashboard and API share this origin: the dashboard calls `/api/v1` on the same server by default. Use **Server settings** only when connecting the dashboard to a different Tab Sync API.

The server creates `tabsync.sqlite` in this folder.

Press Ctrl+C to stop the server.

## Run tests

The test suite covers API routes and dashboard asset serving.

## Configuration

You can set these variables before starting the server.

| Variable | Default | Use |
| --- | --- | --- |
| `PORT` | `3000` | Changes the API port. |
| `DATABASE_PATH` | `tabsync.sqlite` | Changes the SQLite database file. |

Example:

```sh
PORT=3001 DATABASE_PATH=./local.sqlite bun run dev
```

## More docs

Read [API.md](API.md) for the API reference.
