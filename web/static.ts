const WEB_ROOT = new URL("./", import.meta.url);

const PAGE_ROUTES: Record<string, string> = {
  "/": "index.html",
  "/settings": "settings.html",
  "/privacy": "privacy.html",
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

const HTML_SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' http: https:; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
};

async function serveWebAsset(pathname: string): Promise<Response | null> {
  const assetPath = PAGE_ROUTES[pathname] ?? pathname.slice(1);
  const extension = assetPath.match(/\.[a-z0-9]+$/i)?.[0].toLowerCase();
  const contentType = extension ? CONTENT_TYPES[extension] : undefined;
  if (!contentType) return null;

  const url = new URL(assetPath, WEB_ROOT);
  if (!url.href.startsWith(WEB_ROOT.href)) return null;

  const file = Bun.file(url);
  if (!(await file.exists())) return null;

  return new Response(file, {
    headers: {
      "content-type": contentType,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...(contentType.startsWith("text/html") ? HTML_SECURITY_HEADERS : {}),
    },
  });
}

export function createWebFetch(apiFetch: (request: Request) => Promise<Response>) {
  return async function fetch(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD") return apiFetch(request);

    const asset = await serveWebAsset(new URL(request.url).pathname);
    if (!asset) return apiFetch(request);
    if (request.method === "HEAD") return new Response(null, { status: asset.status, headers: asset.headers });
    return asset;
  };
}
