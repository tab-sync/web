# Tab Sync web app

This is the framework-free dashboard for viewing synced devices, tabs, and history. It can run on its own and connect to any Tab Sync API from the Server settings page.

## Run locally

Requirements: [Bun](https://bun.sh/) 1.2 or newer. The dashboard has no dependencies or build step.

Start the standalone web server from this directory:

```sh
cd web
bun run dev
```

Then open <http://127.0.0.1:3001/>. Use `bun run start` to run without file watching. Set `HOST` or `PORT` to change the bind address or port, for example `PORT=4173 bun run dev`.

The standalone server only serves the dashboard. It does not start an API or use any backend source code. Refresh the browser after changing `index.html`, `app.css`, `app.js`, `settings.html`, or `settings.js`; no web build is required.

## Server selection

The dashboard defaults to <https://tabsync.nkson.com>. Open **Server settings** at <http://127.0.0.1:3001/settings> to use another Tab Sync API, for example `https://tabs.example.com` or `http://127.0.0.1:3000`. A URL ending in `/api/v1` also works. Changing the server clears the saved session, so sign in again before viewing synced data.

If the dashboard and API use different origins, allow the dashboard origin in the API's CORS configuration. For the default standalone server and a local API, start the API with:

```sh
ALLOWED_ORIGINS=http://127.0.0.1:3001 bun run dev
```

Use HTTPS for remote deployments. The API accepts the dashboard's requests only when its exact origin appears in `ALLOWED_ORIGINS`.
