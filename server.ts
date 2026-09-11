const WEB_ROOT = import.meta.dir;

const ASSETS: Record<string, { file: string; contentType: string }> = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/settings": { file: "settings.html", contentType: "text/html; charset=utf-8" },
  "/settings.html": { file: "settings.html", contentType: "text/html; charset=utf-8" },
  "/privacy": { file: "privacy.html", contentType: "text/html; charset=utf-8" },
  "/privacy.html": { file: "privacy.html", contentType: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", contentType: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", contentType: "application/javascript; charset=utf-8" },
  "/settings.js": { file: "settings.js", contentType: "application/javascript; charset=utf-8" },
  "/icon.svg": { file: "icon.svg", contentType: "image/svg+xml" },
  "/favicon-16.png": { file: "favicon-16.png", contentType: "image/png" },
  "/favicon-32.png": { file: "favicon-32.png", contentType: "image/png" },
  "/apple-touch-icon.png": { file: "apple-touch-icon.png", contentType: "image/png" },
  "/fonts/manrope-vietnamese.woff2": { file: "fonts/manrope-vietnamese.woff2", contentType: "font/woff2" },
  "/fonts/manrope-latin-ext.woff2": { file: "fonts/manrope-latin-ext.woff2", contentType: "font/woff2" },
  "/fonts/manrope-latin.woff2": { file: "fonts/manrope-latin.woff2", contentType: "font/woff2" },
};

const HTML_SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' http: https:; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
};

const port = Number(Bun.env.PORT ?? 3001);
const hostname = Bun.env.HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const asset = ASSETS[new URL(request.url).pathname];
    if (!asset) return new Response("Not Found", { status: 404 });

    const file = Bun.file(`${WEB_ROOT}/${asset.file}`);
    if (!(await file.exists())) return new Response("Not Found", { status: 404 });

    return new Response(request.method === "HEAD" ? null : file, {
      headers: {
        "content-type": asset.contentType,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        ...(asset.contentType.startsWith("text/html") ? HTML_SECURITY_HEADERS : {}),
      },
    });
  },
});

console.log(`Tab Sync web app listening on http://${server.hostname}:${server.port}`);
