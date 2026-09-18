import { createApp } from "./api/src/app";
import { createDatabase } from "./api/src/db";
import { createWebFetch } from "./web/static";

const port = Number(Bun.env.PORT ?? 3000);
const databasePath = Bun.env.DATABASE_PATH ?? "tabsync.sqlite";
const database = createDatabase(databasePath);
const api = createApp({ database });
const fetch = createWebFetch(api);

Bun.serve({ hostname: "127.0.0.1", port, fetch });
console.log(`Tab Sync API listening on http://127.0.0.1:${port}`);
