/**
 * MDH-API — shared page chrome.
 *
 * Loaded on every page: year stamp, mobile nav toggle, Auth0 sign-in/out,
 * the account dropdown, the profile settings dialog, and the one-time
 * onboarding gate that runs between a first sign-in and seeing any page's
 * content. Page-specific behavior (the request lab, dashboard, inbox,
 * chat) lives in its own script and talks to this one only through the
 * mdh:authenticated / mdh:data events and window.MDHSync.
 */

document.querySelector("#year").textContent = new Date().getFullYear();

const menuButton = document.querySelector(".menu-button");
const nav = document.querySelector("nav");
menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!open));
  nav.classList.toggle("open", !open);
});

nav.addEventListener("click", (event) => {
  if (!event.target.closest("a")) return;
  nav.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
});

// Auth0's network round trips are usually slow enough that every deferred
// script (sync.js in particular) has already registered its listeners by
// the time initializeAuth() below is ready to dispatch — but not always: a
// fast/cached response can resolve before the browser has finished running
// later <script defer> tags, and a CustomEvent dispatched before a listener
// exists is just lost. DOMContentLoaded only fires once every deferred
// script's top-level code has run, so waiting for it guarantees no listener
// is registered too late. document.readyState is NOT a reliable proxy for
// "has DOMContentLoaded already fired" — it flips to "interactive" as soon
// as deferred scripts START running, well before the event actually fires —
// so this tracks it directly with a flag registered at the very top of this
// script's own synchronous execution, before any other deferred script (or
// this one's own async continuations) can possibly run.
let domContentLoaded = false;
document.addEventListener("DOMContentLoaded", () => { domContentLoaded = true; }, { once: true });

function dispatchWhenReady(type, detail) {
  const fire = () => window.dispatchEvent(new CustomEvent(type, { detail }));
  if (domContentLoaded) {
    fire();
  } else {
    document.addEventListener("DOMContentLoaded", fire, { once: true });
  }
}

/* ------------------------------------------------------------------ Auth0 */
const AUTH0_DOMAIN = "dev-k8fshtox4w7pm3ah.us.auth0.com";
const AUTH0_CLIENT_ID = "QwA1u0OF6OVAjQvUs8CxusnaOTtIekq9";
const THEMES = ["default", "cyan", "amber", "violet", "rose", "blue"];

const authButton = document.querySelector("#auth-button");
const authLabel = document.querySelector("#auth-label");
const authGate = document.querySelector("#auth-gate");
const appShell = document.querySelector("#app-shell");
const authLoading = document.querySelector("#auth-loading");
const authLoginView = document.querySelector("#auth-login-view");
const authErrorView = document.querySelector("#auth-error-view");
const authError = document.querySelector("#auth-error");
const accountControl = document.querySelector(".account-control");
const accountName = document.querySelector("#account-name");
const accountEmail = document.querySelector("#account-email");
const profileDialog = document.querySelector("#profile-dialog");
const onboardingGate = document.querySelector("#onboarding-gate");
const onboardingForm = document.querySelector("#onboarding-form");
const onboardingStatus = document.querySelector("#onboarding-status");

let authClient;
let signedIn = false;
let currentUser;
let onboardingResolved = false;
let userSettings = {
  displayName: "", theme: "default", saveHistory: false,
  dob: "", githubRepo: "", social: "", aboutMe: "",
  hasAvatar: false, profileComplete: false
};

function settingsKey() {
  return currentUser?.sub ? `mdh-api.settings.${currentUser.sub}` : null;
}

function applySettings() {
  document.documentElement.dataset.theme = userSettings.theme || "default";
  const name = userSettings.displayName.trim() || currentUser?.name || currentUser?.nickname || currentUser?.email || "Account";
  authLabel.textContent = name;
  accountName.textContent = name;
}

function loadSettings() {
  const key = settingsKey();
  if (!key) return;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "{}");
    userSettings = { ...userSettings, ...saved };
  } catch {
    localStorage.removeItem(key);
  }
  applySettings();
}

function persistSettings(settings) {
  userSettings = { ...userSettings, ...settings };
  const key = settingsKey();
  if (key) localStorage.setItem(key, JSON.stringify(userSettings));
  applySettings();
}

function showLogin() {
  authLoading.hidden = true;
  authErrorView.hidden = true;
  authLoginView.hidden = false;
  authGate.hidden = false;
  onboardingGate.hidden = true;
  appShell.hidden = true;
}

function showWorkspace() {
  authGate.hidden = true;
  onboardingGate.hidden = true;
  appShell.hidden = false;
}

function showOnboarding() {
  authGate.hidden = true;
  appShell.hidden = true;
  onboardingGate.hidden = false;
  const nameField = document.querySelector("#onboarding-name");
  if (nameField && !nameField.value) {
    nameField.value = currentUser?.name || currentUser?.nickname || "";
  }
}

function showAuthError(message) {
  authLoading.hidden = true;
  authLoginView.hidden = true;
  authError.textContent = message;
  authErrorView.hidden = false;
  authGate.hidden = false;
  onboardingGate.hidden = true;
  appShell.hidden = true;
}

async function initializeAuth() {
  try {
    authClient = await auth0.createAuth0Client({
      domain: AUTH0_DOMAIN,
      clientId: AUTH0_CLIENT_ID,
      authorizationParams: {
        // Deliberately NOT the current page's URL: Auth0's Allowed Callback
        // URLs list only has the site origin whitelisted, and adding every
        // page here would need a matching dashboard change. Auth0 always
        // calls back to the origin; the mdh:redirect handling below bounces
        // the browser on to appState.returnTo itself.
        redirect_uri: window.location.origin,
        scope: "openid profile email offline_access",
        // Must match the audience getTokenSilently() requests below. Without
        // it here, the refresh token gets minted for "no audience" at login
        // and later asking it for the api.mdh-api.com audience is a mismatch
        // that auth0-spa-js's rotating-refresh-token flow fails on Safari
        // with login_required (auth0/auth0-spa-js#469) instead of silently
        // refreshing.
        audience: "https://api.mdh-api.com"
      },
      // getTokenSilently defaults to a hidden-iframe SSO check, which Safari's
      // Intelligent Tracking Prevention blocks (it treats Auth0's domain as a
      // third party and won't let the iframe read its session cookie). That
      // silently drops the access token chat and cross-device sync need on
      // iOS/Safari. Refresh tokens avoid the iframe entirely.
      useRefreshTokens: true,
      cacheLocation: "localstorage"
    });

    const params = new URLSearchParams(window.location.search);
    if (params.has("error")) {
      const message = params.get("error_description") || params.get("error");
      history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      throw new Error(message);
    }

    if (params.has("code") && params.has("state")) {
      const { appState } = await authClient.handleRedirectCallback();
      const returnTo = appState?.returnTo || window.location.pathname;
      if (returnTo !== window.location.pathname + window.location.hash) {
        // The callback always lands back on the origin (see redirect_uri
        // above); if login started from a different page, actually navigate
        // there instead of just rewriting the address bar over this page's
        // DOM. That reload re-runs this same script and completes normally.
        window.location.replace(returnTo);
        return;
      }
      history.replaceState({}, document.title, returnTo);
    }

    signedIn = await authClient.isAuthenticated();
    if (signedIn) {
      const user = await authClient.getUser();
      currentUser = user;
      authLabel.textContent = user?.name || user?.email || "Account";
      authButton.title = "Open account menu";
      authButton.classList.add("signed-in");
      accountName.textContent = user?.name || user?.nickname || "MDH-API user";
      accountEmail.textContent = user?.email || "No email available";
      loadSettings();
      authLoading.hidden = false;
      authLoginView.hidden = true;
      authErrorView.hidden = true;
      authGate.hidden = false;
      appShell.hidden = true;

      let accessToken = null;
      try {
        accessToken = await authClient.getTokenSilently({
          authorizationParams: { audience: "https://api.mdh-api.com" }
        });
      } catch (error) {
        console.warn("Cross-device sync is not configured yet:", error.message);
      }
      window.MDHAccessToken = accessToken;
      dispatchWhenReady("mdh:authenticated", { user, token: accessToken });
    } else {
      authLabel.textContent = "Sign in";
      authButton.title = "Sign in to MDH-API";
      showLogin();
    }
    authButton.disabled = false;
  } catch (error) {
    console.error("Auth0 initialization failed:", error);
    authLabel.textContent = "Sign in unavailable";
    authButton.title = error.message;
    showAuthError(error.message || "Authentication could not be initialized.");
  }
}

// The very first mdh:data tells us whether this account still needs to
// finish onboarding. Later events (polling, saving settings) must not
// re-decide this — once resolved, the gate stays out of the way.
window.addEventListener("mdh:data", (event) => {
  if (onboardingResolved || !signedIn) return;
  const { data, status } = event.detail;
  onboardingResolved = true;
  if (!window.MDHSync.hasToken()) {
    // Can't confirm profile status without the API — fail open rather than
    // locking a signed-in user out because sync is unavailable.
    console.warn("Skipping the onboarding check:", status);
    showWorkspace();
    return;
  }
  persistSettings(data.settings || {});
  if (userSettings.profileComplete) {
    showWorkspace();
  } else {
    showOnboarding();
  }
});

async function beginLogin(screenHint) {
  if (!authClient) return;
  await authClient.loginWithRedirect({
    authorizationParams: {
      prompt: "select_account",
      ...(screenHint ? { screen_hint: screenHint } : {})
    },
    appState: { returnTo: window.location.pathname + window.location.hash }
  });
}

authButton.addEventListener("click", () => {
  const open = accountControl.classList.toggle("open");
  authButton.setAttribute("aria-expanded", String(open));
});

document.querySelector("#auth-logout").addEventListener("click", async () => {
  if (!authClient) return;
  await authClient.logout({ logoutParams: { returnTo: window.location.origin } });
});

/* ------------------------------------------------------------- avatars */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

async function uploadAvatar(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw new Error("Choose a PNG, JPEG, or WEBP image.");
  }
  if (file.size > 500 * 1024) {
    throw new Error("Image must be under 500KB.");
  }
  const dataUrl = await readFileAsDataUrl(file);
  const token = window.MDHAccessToken;
  if (!token) throw new Error("Cross-device sync needs the Auth0 API to be enabled.");
  const response = await fetch("/api/avatar", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Avatar upload failed.");
  userSettings.hasAvatar = true;
}

async function removeAvatar() {
  const token = window.MDHAccessToken;
  if (!token) throw new Error("Cross-device sync needs the Auth0 API to be enabled.");
  const response = await fetch("/api/avatar", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw new Error("Could not remove the photo.");
  userSettings.hasAvatar = false;
}

async function fetchAvatarObjectUrl() {
  const token = window.MDHAccessToken;
  if (!token || !userSettings.hasAvatar) return null;
  try {
    const response = await fetch("/api/avatar", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}

function setAvatarPreview(imageEl, fallbackEl, src, fallbackChar) {
  fallbackEl.textContent = fallbackChar;
  if (src) {
    imageEl.src = src;
    imageEl.hidden = false;
    fallbackEl.hidden = true;
  } else {
    imageEl.hidden = true;
    fallbackEl.hidden = false;
  }
}

/* --------------------------------------------------------- onboarding */

document.querySelector("#onboarding-avatar")?.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const preview = document.querySelector("#onboarding-avatar-preview");
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
});

onboardingForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = onboardingForm.querySelector("button[type=submit]");
  submitButton.disabled = true;
  onboardingStatus.textContent = "";
  try {
    const avatarFile = document.querySelector("#onboarding-avatar").files[0];
    if (avatarFile) await uploadAvatar(avatarFile);

    const settings = {
      displayName: document.querySelector("#onboarding-name").value.trim(),
      dob: document.querySelector("#onboarding-dob").value,
      githubRepo: document.querySelector("#onboarding-github").value.trim(),
      social: document.querySelector("#onboarding-social").value.trim(),
      aboutMe: document.querySelector("#onboarding-about").value.trim(),
      theme: document.querySelector("#onboarding-theme").value,
      saveHistory: userSettings.saveHistory,
      profileComplete: true
    };
    if (!settings.displayName) throw new Error("A name is required.");
    if (!settings.dob) throw new Error("A date of birth is required.");

    const data = await window.MDHSync.saveSettings(settings);
    persistSettings(data.settings);
    showWorkspace();
  } catch (error) {
    onboardingStatus.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

/* ------------------------------------------------------ profile dialog */

document.querySelector("#profile-settings").addEventListener("click", async () => {
  if (!currentUser) return;
  document.querySelector("#profile-name").textContent = currentUser.name || currentUser.nickname || "Not provided";
  document.querySelector("#profile-email").textContent = currentUser.email || "Not provided";
  document.querySelector("#profile-email-status").textContent = currentUser.email_verified ? "Verified" : "Not verified";

  const avatarImage = document.querySelector("#profile-avatar-image");
  const avatarFallback = document.querySelector("#profile-avatar-fallback");
  const initial = (userSettings.displayName || currentUser.name || currentUser.email || "U").trim().charAt(0).toUpperCase();
  const ownAvatar = await fetchAvatarObjectUrl();
  setAvatarPreview(avatarImage, avatarFallback, ownAvatar || currentUser.picture || null, initial);

  document.querySelector("#display-name").value = userSettings.displayName;
  document.querySelector("#profile-dob").value = userSettings.dob || "";
  document.querySelector("#profile-github").value = userSettings.githubRepo || "";
  document.querySelector("#profile-social").value = userSettings.social || "";
  document.querySelector("#profile-about").value = userSettings.aboutMe || "";
  document.querySelector("#interface-theme").value = userSettings.theme;
  document.querySelector("#save-history").checked = userSettings.saveHistory;
  document.querySelector("#avatar-remove").hidden = !userSettings.hasAvatar;
  document.querySelector("#settings-status").textContent = "";
  accountControl.classList.remove("open");
  authButton.setAttribute("aria-expanded", "false");
  profileDialog.showModal();
});

document.querySelector("#profile-avatar-image").addEventListener("error", (event) => {
  event.currentTarget.hidden = true;
  document.querySelector("#profile-avatar-fallback").hidden = false;
});

document.querySelector("#avatar-upload-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const status = document.querySelector("#settings-status");
  try {
    status.textContent = "Uploading photo…";
    await uploadAvatar(file);
    setAvatarPreview(
      document.querySelector("#profile-avatar-image"),
      document.querySelector("#profile-avatar-fallback"),
      URL.createObjectURL(file),
      (userSettings.displayName || currentUser?.name || "U").trim().charAt(0).toUpperCase()
    );
    document.querySelector("#avatar-remove").hidden = false;
    status.textContent = "Photo updated.";
  } catch (error) {
    status.textContent = error.message;
  }
});

document.querySelector("#avatar-remove").addEventListener("click", async () => {
  const status = document.querySelector("#settings-status");
  try {
    await removeAvatar();
    setAvatarPreview(
      document.querySelector("#profile-avatar-image"),
      document.querySelector("#profile-avatar-fallback"),
      currentUser?.picture || null,
      (userSettings.displayName || currentUser?.name || "U").trim().charAt(0).toUpperCase()
    );
    document.querySelector("#avatar-remove").hidden = true;
    status.textContent = "Photo removed.";
  } catch (error) {
    status.textContent = error.message;
  }
});

function previewSettings() {
  const displayName = document.querySelector("#display-name").value.trim();
  const theme = document.querySelector("#interface-theme").value;
  document.documentElement.dataset.theme = theme;
  const previewName = displayName || currentUser?.name || currentUser?.nickname || currentUser?.email || "Account";
  authLabel.textContent = previewName;
  accountName.textContent = previewName;
  document.querySelector("#profile-avatar-fallback").textContent = previewName.charAt(0).toUpperCase();
  document.querySelector("#settings-status").textContent = "Previewing unsaved changes.";
}

document.querySelector("#display-name").addEventListener("input", previewSettings);
document.querySelector("#interface-theme").addEventListener("change", previewSettings);

document.querySelector("#profile-settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#settings-status");
  try {
    const settings = {
      displayName: document.querySelector("#display-name").value.trim(),
      theme: document.querySelector("#interface-theme").value,
      saveHistory: document.querySelector("#save-history").checked,
      dob: document.querySelector("#profile-dob").value,
      githubRepo: document.querySelector("#profile-github").value.trim(),
      social: document.querySelector("#profile-social").value.trim(),
      aboutMe: document.querySelector("#profile-about").value.trim()
    };
    const data = window.MDHSync?.hasToken()
      ? await window.MDHSync.saveSettings(settings)
      : { settings };
    persistSettings(data.settings);
    status.textContent = "Settings saved.";
  } catch (error) {
    status.textContent = error.message;
  }
});

document.querySelector("#clear-history").addEventListener("click", async () => {
  await window.MDHSync?.clearHistory();
  document.querySelector("#settings-status").textContent = "Request history cleared.";
});

window.addEventListener("mdh:synced-settings", (event) => {
  if (!event.detail || !Object.keys(event.detail).length) return;
  persistSettings(event.detail);
});

document.querySelector("#profile-close").addEventListener("click", () => profileDialog.close());
profileDialog.addEventListener("click", (event) => {
  if (event.target === profileDialog) profileDialog.close();
});
document.addEventListener("click", (event) => {
  if (!accountControl.contains(event.target)) {
    accountControl.classList.remove("open");
    authButton.setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !profileDialog.open) {
    accountControl.classList.remove("open");
    authButton.setAttribute("aria-expanded", "false");
    authButton.focus();
  }
});

document.querySelector("#auth-login").addEventListener("click", () => beginLogin());
document.querySelector("#auth-signup").addEventListener("click", () => beginLogin("signup"));
document.querySelector("#auth-retry").addEventListener("click", () => window.location.assign(window.location.pathname));

initializeAuth();
