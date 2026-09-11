const TOKEN_KEY = "tabsync.token";
const SERVER_URL_KEY = "tabsync.serverUrl";
const DEFAULT_SERVER_URL = "https://tabsync.nkson.com";

const form = document.getElementById("settings-form");
const serverUrlInput = document.getElementById("server-url");
const status = document.getElementById("settings-status");

function normalizeServerUrl(value) {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use HTTP or HTTPS.");
  }
  if (url.protocol === "http:" && !isSupportedLocalServer(url)) {
    throw new Error("Use HTTPS for a remote server. HTTP is available only for localhost:3000 during development.");
  }
  if (url.username || url.password) {
    throw new Error("Server URL cannot include credentials.");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

function isSupportedLocalServer(url) {
  return (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "3000";
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("is-error", error);
}

serverUrlInput.value = localStorage.getItem(SERVER_URL_KEY) || DEFAULT_SERVER_URL;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  try {
    const serverUrl = normalizeServerUrl(serverUrlInput.value);
    const previous = normalizeServerUrl(localStorage.getItem(SERVER_URL_KEY) || DEFAULT_SERVER_URL);
    localStorage.setItem(SERVER_URL_KEY, serverUrl);
    if (serverUrl !== previous) localStorage.removeItem(TOKEN_KEY);
    serverUrlInput.value = serverUrl;
    setStatus(serverUrl === previous ? "Server settings saved." : "Server changed. Sign in to continue.");
  } catch (error) {
    setStatus(error.message, true);
  }
});
