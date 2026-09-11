const TOKEN_KEY = "tabsync.token";
const SERVER_URL_KEY = "tabsync.serverUrl";
const DEFAULT_SERVER_URL = "https://tabsync.nkson.com";
const HISTORY_PAGE_SIZE = 20;

const state = {
  token: localStorage.getItem(TOKEN_KEY) ?? "",
  user: null,
  devices: [],
  selectedDeviceId: null,
  history: [],
  historyTotal: 0,
  nextCursor: null,
  authMode: "login",
  busy: false,
  loadingMore: false,
};

const elements = {
  hero: document.getElementById("hero"),
  authPanel: document.getElementById("auth-panel"),
  authForm: document.getElementById("auth-form"),
  authModeButtons: Array.from(document.querySelectorAll("[data-auth-mode]")),
  authStatus: document.getElementById("auth-status"),
  authTitle: document.getElementById("auth-title"),
  authSubmit: document.getElementById("auth-submit"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  main: document.getElementById("main-content"),
  welcome: document.getElementById("welcome"),
  refreshButton: document.getElementById("refresh-button"),
  accountMenuWrap: document.getElementById("account-menu-wrap"),
  accountMenuButton: document.getElementById("account-menu-button"),
  accountMenu: document.getElementById("account-menu"),
  signOutButton: document.getElementById("sign-out-button"),
  signupOnboarding: document.getElementById("signup-onboarding"),
  pageStatus: document.getElementById("page-status"),
  devicesEmpty: document.getElementById("devices-empty"),
  deviceTabs: document.getElementById("device-tabs"),
  devicePanel: document.getElementById("device-panel"),
  openTabsEmpty: document.getElementById("open-tabs-empty"),
  openTabsTruncated: document.getElementById("open-tabs-truncated"),
  openTabsList: document.getElementById("open-tabs-list"),
  historyCount: document.getElementById("history-count"),
  historyEmpty: document.getElementById("history-empty"),
  historyTableWrap: document.getElementById("history-table-wrap"),
  historyBody: document.getElementById("history-body"),
  loadMoreButton: document.getElementById("load-more-button"),
};

function plural(count, singular) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function safeHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function deviceName(device) {
  return device.displayName || `${device.browser} on ${device.platform}`;
}

function defaultDeviceId(devices) {
  if (devices.length < 2) return devices[0]?.id ?? null;
  return devices.reduce((mostRecent, device) => (
    Date.parse(device.lastSeenAt) > Date.parse(mostRecent.lastSeenAt) ? device : mostRecent
  )).id;
}

function apiRoot() {
  const configured = localStorage.getItem(SERVER_URL_KEY) || DEFAULT_SERVER_URL;
  try {
    const url = new URL(configured);
    url.search = "";
    url.hash = "";
    const base = url.toString().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    return `${base}/api/v1`;
  } catch {
    return `${DEFAULT_SERVER_URL}/api/v1`;
  }
}

function setMessage(node, message, kind = "") {
  node.textContent = message;
  node.hidden = !message;
  node.classList.toggle("is-error", kind === "error");
}

function setBusy(isBusy) {
  state.busy = isBusy;
  elements.refreshButton.disabled = isBusy;
  elements.accountMenuButton.disabled = isBusy;
  elements.signOutButton.disabled = isBusy;
  elements.loadMoreButton.disabled = isBusy || state.loadingMore || !state.nextCursor;
  elements.authSubmit.disabled = isBusy;
  for (const button of elements.authModeButtons) {
    button.disabled = isBusy;
  }
  for (const button of elements.deviceTabs.querySelectorAll("button")) {
    button.disabled = isBusy;
  }
}

function setAccountMenu(open) {
  elements.accountMenu.hidden = !open;
  elements.accountMenuButton.setAttribute("aria-expanded", String(open));
}

function showAuth(message = "", kind = "") {
  elements.hero.hidden = false;
  elements.authPanel.hidden = false;
  elements.main.hidden = true;
  setMessage(elements.authStatus, message, kind);
}

function showApp() {
  elements.hero.hidden = true;
  elements.authPanel.hidden = true;
  elements.main.hidden = false;
}

function setAuthMode(mode) {
  state.authMode = mode;
  for (const button of elements.authModeButtons) {
    const active = button.dataset.authMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  elements.authSubmit.textContent = mode === "login" ? "Sign in" : "Create account";
  elements.authTitle.textContent = "Start syncing your tabs"
  elements.authForm.action = `${apiRoot()}/auth/${mode === "login" ? "login" : "register"}`;
  elements.authForm.dataset.formType = mode === "login" ? "login" : "register";
  elements.password.setAttribute("autocomplete", mode === "login" ? "current-password" : "new-password");
  elements.password.placeholder = mode === "login" ? "Your password" : "Create a password";
}

async function requestJson(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (options.auth !== false && state.token) {
    headers.set("authorization", `Bearer ${state.token}`);
  }

  const response = await fetch(`${apiRoot()}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!response.ok) {
    const message = data?.error?.message ?? `Request failed with ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

function renderOpenTab(tab) {
  const item = document.createElement("li");
  item.className = "open-tab";

  const link = document.createElement("a");
  link.href = tab.url;
  link.target = "_blank";
  link.rel = "noreferrer noopener";
  link.textContent = tab.title || tab.url;

  const url = document.createElement("div");
  url.className = "tab-url";
  url.textContent = safeHost(tab.url);
  item.append(link, url);

  const chips = document.createElement("div");
  chips.className = "chip-row";
  if (tab.active) {
    const active = document.createElement("span");
    active.className = "chip success";
    active.textContent = "Active";
    chips.append(active);
  }
  if (tab.pinned) {
    const pinned = document.createElement("span");
    pinned.className = "chip warning";
    pinned.textContent = "Pinned";
    chips.append(pinned);
  }
  if (chips.childElementCount) item.append(chips);

  return item;
}

function renderHistoryRow(item) {
  const row = document.createElement("tr");

  const timeCell = document.createElement("td");
  timeCell.dataset.label = "Time";
  const time = document.createElement("time");
  time.dateTime = item.visitedAt;
  time.textContent = formatDateTime(item.visitedAt);
  timeCell.append(time);

  const urlCell = document.createElement("td");
  urlCell.className = "history-url-cell";
  urlCell.dataset.label = "Website URL";
  const urlLink = document.createElement("a");
  urlLink.href = item.url;
  urlLink.target = "_blank";
  urlLink.rel = "noreferrer noopener";
  urlLink.textContent = item.url;
  urlLink.title = item.url;
  urlCell.append(urlLink);

  const titleCell = document.createElement("td");
  titleCell.className = "history-title-cell";
  titleCell.dataset.label = "Website title";
  titleCell.textContent = item.title || "Untitled page";

  row.append(timeCell, urlCell, titleCell);
  return row;
}

function renderDeviceTabs() {
  elements.deviceTabs.replaceChildren();

  for (const device of state.devices) {
    const button = document.createElement("button");
    const active = device.id === state.selectedDeviceId;
    button.type = "button";
    button.id = `device-tab-${device.id}`;
    button.className = `device-tab${active ? " is-active" : ""}`;
    button.role = "tab";
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-controls", "device-panel");
    button.tabIndex = active ? 0 : -1;
    button.disabled = state.busy;

    const label = document.createElement("span");
    label.textContent = deviceName(device);
    const count = document.createElement("span");
    count.className = "device-tab-count";
    // `openTabCount` is the device's true open-tab count; `openTabs` may be
    // truncated by the server's `tabLimit` default, so the badge must not
    // just count the (possibly shorter) array.
    count.textContent = plural(device.openTabCount ?? device.openTabs.length, "tab");
    button.append(label, count);
    button.addEventListener("click", () => selectDevice(device.id));
    elements.deviceTabs.append(button);
  }
}

function renderState() {
  if (!state.user) return;

  elements.welcome.textContent = `Welcome, ${state.user.username}`;
  document.title = `Tab Sync · ${state.user.username}`;
  elements.signupOnboarding.hidden = state.devices.length > 0;
  renderDeviceTabs();

  const device = state.devices.find((item) => item.id === state.selectedDeviceId);
  elements.devicesEmpty.hidden = state.devices.length > 0;
  elements.deviceTabs.hidden = state.devices.length === 0;
  elements.devicePanel.hidden = !device;
  if (!device) return;

  elements.devicePanel.setAttribute("aria-labelledby", `device-tab-${device.id}`);
  elements.openTabsList.replaceChildren(...device.openTabs.map(renderOpenTab));
  elements.openTabsEmpty.hidden = device.openTabs.length > 0;
  const openTabCount = device.openTabCount ?? device.openTabs.length;
  const isTruncated = openTabCount > device.openTabs.length;
  elements.openTabsTruncated.hidden = !isTruncated;
  if (isTruncated) {
    elements.openTabsTruncated.textContent = `Showing ${device.openTabs.length} of ${openTabCount}`;
  }

  elements.historyCount.textContent = plural(state.historyTotal, "event");
  elements.historyBody.replaceChildren(...state.history.map(renderHistoryRow));
  elements.historyEmpty.hidden = state.history.length > 0;
  elements.historyTableWrap.hidden = state.history.length === 0;
  elements.loadMoreButton.hidden = !state.nextCursor;
  elements.loadMoreButton.disabled = state.loadingMore || state.busy || !state.nextCursor;
}

function statePath(deviceId, cursor = null) {
  const params = new URLSearchParams({ historyLimit: String(HISTORY_PAGE_SIZE) });
  if (deviceId) params.set("deviceId", deviceId);
  if (cursor) params.set("cursor", cursor);
  return `/state?${params}`;
}

async function refreshState({ appendHistory = false, quiet = false } = {}) {
  if (!state.token || (appendHistory && !state.nextCursor)) return false;

  const previousHistory = appendHistory ? state.history.slice() : [];
  if (appendHistory) state.loadingMore = true;
  setBusy(true);
  if (!quiet) {
    setMessage(elements.pageStatus, appendHistory ? "Loading more history…" : "Loading latest state…");
  }

  try {
    let requestedDeviceId = state.selectedDeviceId;
    let data;
    try {
      data = await requestJson(statePath(requestedDeviceId, appendHistory ? state.nextCursor : null));
    } catch (error) {
      if (error.status !== 404 || !requestedDeviceId || appendHistory) throw error;
      requestedDeviceId = null;
      state.selectedDeviceId = null;
      data = await requestJson(statePath(null));
    }

    state.devices = data.devices ?? [];
    const selectedStillExists = state.devices.some((device) => device.id === state.selectedDeviceId);
    state.selectedDeviceId = selectedStillExists ? state.selectedDeviceId : defaultDeviceId(state.devices);

    if (!appendHistory && state.selectedDeviceId && state.selectedDeviceId !== requestedDeviceId) {
      data = await requestJson(statePath(state.selectedDeviceId));
      state.devices = data.devices ?? [];
    }

    state.nextCursor = data.history?.nextCursor ?? null;
    state.historyTotal = data.history?.total ?? 0;
    state.history = appendHistory
      ? previousHistory.concat(data.history?.items ?? [])
      : (data.history?.items ?? []);
    renderState();
    setMessage(elements.pageStatus, "");
    return true;
  } catch (error) {
    if (error.status === 401) {
      await signOut({ silent: true, message: "Your session expired. Please sign in again." });
      return false;
    }
    setMessage(elements.pageStatus, error.message, "error");
    renderState();
    return false;
  } finally {
    state.loadingMore = false;
    setBusy(false);
    renderState();
  }
}

async function selectDevice(deviceId) {
  if (deviceId === state.selectedDeviceId) return;
  state.selectedDeviceId = deviceId;
  state.history = [];
  state.historyTotal = 0;
  state.nextCursor = null;
  renderState();
  await refreshState();
}

async function restoreSession() {
  if (!state.token) {
    showAuth();
    return;
  }

  showAuth("Checking your saved session…");
  setBusy(true);
  try {
    const data = await requestJson("/me");
    state.user = data.user;
    showApp();
    renderState();
    await refreshState({ quiet: true });
  } catch (error) {
    if (error.status === 401) {
      await signOut({ silent: true, message: "Your saved session expired. Please sign in again." });
      return;
    }
    showAuth(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function signOut({ silent = false, message = "Signed out." } = {}) {
  setAccountMenu(false);
  const token = state.token;
  state.token = "";
  state.user = null;
  state.devices = [];
  state.selectedDeviceId = null;
  state.history = [];
  state.historyTotal = 0;
  state.nextCursor = null;
  localStorage.removeItem(TOKEN_KEY);
  if (token) {
    try {
      await requestJson("/auth/logout", {
        method: "POST",
        auth: false,
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      // Session revocation is best-effort for expired or already-invalid tokens.
    }
  }
  setAuthMode("login");
  showAuth(message, silent ? "" : "info");
  setMessage(elements.pageStatus, "");
}

async function onAuthSubmit(event) {
  event.preventDefault();
  if (!elements.authForm.reportValidity()) return;

  const username = elements.username.value.trim();
  const password = elements.password.value;
  const isRegistration = state.authMode === "register";
  const path = isRegistration ? "/auth/register" : "/auth/login";
  elements.signupOnboarding.hidden = true;

  setBusy(true);
  setMessage(elements.authStatus, state.authMode === "login" ? "Signing in…" : "Creating account…");
  try {
    const data = await requestJson(path, {
      method: "POST",
      auth: false,
      body: JSON.stringify({ username, password }),
    });
    state.token = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);
    await restoreSession();
  } catch (error) {
    setMessage(elements.authStatus, error.message, "error");
  } finally {
    setBusy(false);
  }
}

function bindEvents() {
  for (const button of elements.authModeButtons) {
    button.addEventListener("click", () => {
      setAuthMode(button.dataset.authMode);
      setMessage(elements.authStatus, "");
    });
  }

  elements.authForm.addEventListener("submit", onAuthSubmit);
  elements.refreshButton.addEventListener("click", () => refreshState());
  elements.accountMenuButton.addEventListener("click", () => {
    setAccountMenu(elements.accountMenu.hidden);
  });
  elements.signOutButton.addEventListener("click", () => signOut({ message: "Signed out." }));
  elements.loadMoreButton.addEventListener("click", () => refreshState({ appendHistory: true }));
  document.addEventListener("click", (event) => {
    if (!elements.accountMenu.hidden && !elements.accountMenuWrap.contains(event.target)) {
      setAccountMenu(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setAccountMenu(false);
      elements.accountMenuButton.focus();
    }
  });
}

bindEvents();
setAuthMode("login");
showAuth();
restoreSession();
