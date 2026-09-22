const TOKEN_KEY = "tabsync.token";
const SERVER_URL_KEY = "tabsync.serverUrl";
const DEFAULT_SERVER_URL = window.location.origin;

const form = document.getElementById("settings-form");
const serverUrlInput = document.getElementById("server-url");
const status = document.getElementById("settings-status");
const serverSettings = document.getElementById("server-settings");
const accountSettings = document.getElementById("account-settings");
const deleteAccountForm = document.getElementById("delete-account-form");
const deleteAccountPassword = document.getElementById("delete-account-password");
const deleteAccountSubmit = document.getElementById("delete-account-submit");
const deleteAccountStatus = document.getElementById("delete-account-status");

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

function setDeleteAccountStatus(message, error = false) {
  deleteAccountStatus.textContent = message;
  deleteAccountStatus.hidden = !message;
  deleteAccountStatus.classList.toggle("is-error", error);
}

function storedServerUrl() {
  return normalizeServerUrl(localStorage.getItem(SERVER_URL_KEY) || DEFAULT_SERVER_URL);
}

function showSignedInSettings(isSignedIn) {
  serverSettings.hidden = isSignedIn;
  accountSettings.hidden = !isSignedIn;
}

serverUrlInput.value = localStorage.getItem(SERVER_URL_KEY) || DEFAULT_SERVER_URL;
showSignedInSettings(Boolean(localStorage.getItem(TOKEN_KEY)));

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (localStorage.getItem(TOKEN_KEY)) {
    setStatus("Sign out before changing the server.", true);
    return;
  }
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

deleteAccountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!deleteAccountForm.reportValidity()) return;

  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    setDeleteAccountStatus("Sign in before deleting your account.", true);
    return;
  }

  deleteAccountSubmit.disabled = true;
  setDeleteAccountStatus("Deleting your account and data…");
  try {
    const response = await fetch(`${storedServerUrl()}/api/v1/account`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ password: deleteAccountPassword.value }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message || "Could not delete your account.");
    }
    localStorage.removeItem(TOKEN_KEY);
    deleteAccountForm.reset();
    showSignedInSettings(false);
    setStatus("Your account and data have been deleted.");
  } catch (error) {
    setDeleteAccountStatus(error.message, true);
    deleteAccountSubmit.disabled = false;
  }
});
