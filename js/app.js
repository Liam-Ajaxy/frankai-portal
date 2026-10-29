import { session, api } from "./api.client.js";
import { h, clear, badge } from "./dom.util.js";
import { brand, confirmDialog } from "./ui.util.js";
import { icon } from "./icons.js";
import { initTheme, themeToggle } from "./theme.js";
import { KnotStreamer } from "./knot-streamer.js";
import { initRouter, navigate, resolve, redirectToLogin, nextTarget, consumeScroll } from "./router.js";
import * as login from "./pages/login.page.js";
import * as signup from "./pages/signup.page.js";
import * as forgot from "./pages/forgot.page.js";
import * as home from "./pages/home.page.js";
import * as keys from "./pages/keys.page.js";
import * as usage from "./pages/usage.page.js";
import * as docs from "./pages/docs.page.js";
import * as account from "./pages/account.page.js";
import * as connect from "./pages/connect.page.js";
import * as notfound from "./pages/notfound.page.js";

initTheme();

// The landing page (and its WebGL scene) loads only for visitors who are not logged in.
const loadLanding = () => import("./pages/landing.page.js");
const PUBLIC = { "": loadLanding, welcome: loadLanding, login, signup, forgot };
const PRIVATE = { home, keys, usage, docs, account, connect };
const LINKS = [["home", "Home", "home"], ["keys", "Keys", "key"], ["usage", "Usage", "chart"], ["docs", "Docs", "book"], ["account", "Account", "user"]];
const TITLES = { "": "Frank AI · Developers", welcome: "Frank AI · Developers", login: "Log in", signup: "Request access", forgot: "Reset password", home: "Home", keys: "Keys", usage: "Usage", docs: "Docs", account: "Account", connect: "Connect your terminal", notfound: "Page not found" };
const STATUS_KIND = { approved: "good", pending: "warn", suspended: "bad" };

const root = document.getElementById("app");
let stopPage = null;
let renderId = 0;
let lastRoute = null;

let lastProfile = null; // last known account, so the next private route can draw its shell instantly
let focusPending = false;
const announcer = h("div", { class: "sr-only", role: "status", "aria-live": "polite" }); // tells screen readers the page changed
document.body.append(announcer);

// Asks first. Only the confirm button ends the session; Cancel, Esc and a click outside leave it untouched.
async function logout() {
  const ok = await confirmDialog({
    title: "Log out?",
    body: "You'll need to log in again to manage your keys. Your API keys keep working.",
    confirmLabel: "Log out",
    cancelLabel: "Stay logged in",
    danger: false,
  });
  if (!ok) return;
  session.clear();
  lastProfile = null;
  navigate("/login", { replace: true });
}

// A calm stack of dimensional plates for the side of the login screens. Purely decorative.
function plateStack() {
  return h("div", { class: "plate-scene", "aria-hidden": "true" }, h("div", { class: "plates" }, [0, 1, 2, 3].map((i) => h("span", { class: `plate plate-${i}` }))), h("span", { class: "plate-orb" }));
}

function authShell(box) {
  return h(
    "div",
    { class: "auth" },
    h(
      "aside",
      { class: "auth-aside" },
      brand(),
      plateStack(),
      h("div", { class: "auth-pitch" }, h("h2", {}, "Chat, images and voice behind one key."), h("p", { class: "muted" }, "Public keys keep chat safe in the browser. Secret keys unlock image and speech on your server."))
    ),
    h("div", { class: "auth-main" }, h("div", { class: "auth-tools" }, themeToggle()), box)
  );
}

function fatal(err, id) {
  if (id !== renderId) return;
  clear(root);
  root.append(
    authShell(
      h("div", { class: "login-card portal-card" }, brand(), h("h1", {}, "Something went wrong"), h("p", { class: "error", role: "alert" }, err.message), h("div", { class: "actions" }, h("button", { class: "btn", onclick: () => show() }, "Try again")))
    )
  );
}

function sidebar(dev, active) {
  return h(
    "nav",
    { class: "sidebar", "aria-label": "Portal" },
    brand(),
    h(
      "div",
      { class: "nav-links" },
      LINKS.map(([name, label, ic]) =>
        h("a", { href: `/${name}`, class: name === active ? "nav-link active" : "nav-link", "aria-current": name === active ? "page" : null }, icon(ic, 20), h("span", {}, label))
      )
    ),
    h(
      "div",
      { class: "side-foot" },
      h("div", { class: "side-status" }, h("span", { class: "muted small" }, "Account"), badge(dev.status, STATUS_KIND[dev.status] ?? "muted")),
      h("div", { class: "actions" }, themeToggle(), h("button", { class: "btn btn-ghost btn-small side-logout", type: "button", onclick: logout }, icon("logout", 16), "Log out"))
    )
  );
}

function topbar(dev) {
  return h(
    "header",
    { class: "topbar" },
    brand(),
    h("div", { class: "topbar-tools" }, badge(dev.status, STATUS_KIND[dev.status] ?? "muted"), themeToggle(), h("button", { class: "icon-btn", type: "button", "aria-label": "Log out", onclick: logout }, icon("logout", 20)))
  );
}

// The Frank AI knot draws, fades and repeats while a page loads. Colours are theme variables, so it follows light and dark.
function loading() {
  const slot = h("div", { class: "page page-loading", role: "status", "aria-busy": "true" }, h("span", { class: "sr-only" }, "Loading"));
  new KnotStreamer(slot, { size: "96px", colorOuter: "var(--accent-2)", colorInner: "var(--accent)", strokeOuter: 3, strokeInner: 2.2, cycleDuration: 2.4, autoStart: true }).mount();
  return slot;
}

// ---------------------------------------------------------------------------
// Routing glue. router.js owns the URL; this file owns the screen. The rule is: commit first.
// The moment the URL changes, the screen for that URL is drawn in the same tick (a loading frame or the page's
// shell), so the address bar and the page can never disagree while data loads. Late answers for an old URL are dropped.
// ---------------------------------------------------------------------------
function setRobots(noindex) {
  let meta = document.querySelector('meta[name="robots"]');
  if (!noindex) return meta?.remove();
  if (!meta) document.head.append((meta = h("meta", { name: "robots" })));
  meta.setAttribute("content", "noindex");
}

// Shown at once when there is nothing correct to show yet: first load, or the landing page's lazy chunk.
function boot() {
  clear(root);
  root.append(h("div", { class: "boot" }, loading()));
}

function mountShell(profile, pageName) {
  const body = h("main", { class: "main page-enter", id: "main", tabindex: "-1" }, loading());
  const skip = h("button", { class: "skip-link", type: "button", onclick: () => body.focus() }, "Skip to content");
  clear(root);
  root.append(h("div", { class: "shell" }, skip, topbar(profile.developer), sidebar(profile.developer, pageName), body));
  return body;
}

// On a real route change: a fitting title (also announced), back to the top, and focus moved to the new content once it exists.
function arrive(name, target) {
  const t = TITLES[name];
  const full = !t || t === "Frank AI · Developers" ? "Frank AI · Developers" : `${t} · Frank AI`;
  document.title = full;
  announcer.textContent = full;
  if (name !== lastRoute) {
    lastRoute = name;
    focusPending = true;
    window.scrollTo(0, 0);
  }
  if (focusPending && target) {
    target.focus?.({ preventScroll: true });
    focusPending = false;
  }
}

// Back/forward and reloads return to where the person was, once the page has rendered.
function restoreScroll() {
  const y = consumeScroll();
  if (y) window.scrollTo(0, y);
}

async function show() {
  const id = ++renderId;
  stopPage?.(); // stop the previous page's refresh timer
  stopPage = null;
  const route = resolve(); // tidies the address bar in place and says which route this is
  setRobots(!route.known);

  // An address that is not a page says so. It never quietly shows some other page.
  if (!route.known) {
    const box = h("div", { class: "login-card portal-card" });
    clear(root);
    root.append(authShell(box));
    arrive("notfound", null);
    try {
      await notfound.render(box);
      if (id === renderId) restoreScroll();
    } catch (err) {
      fatal(err, id);
    }
    return;
  }
  const name = route.name;

  if (route.access === "public") {
    if (session.token) {
      navigate(nextTarget() ?? "/home", { replace: true });
      return;
    }
    lastProfile = null;
    let mod = PUBLIC[name];
    if (typeof mod === "function") {
      boot(); // commit now: the URL and the screen already agree while the chunk loads
      arrive(name, null);
      try {
        mod = await mod();
      } catch (err) {
        fatal(err, id);
        return;
      }
      if (id !== renderId) return;
    }
    const full = mod.layout === "full";
    const box = h("div", full ? { class: "landing" } : { class: "login-card portal-card" });
    clear(root);
    root.append(full ? box : authShell(box));
    arrive(name, null);
    try {
      const stop = await mod.render(box);
      if (id === renderId) {
        stopPage = stop ?? null;
        restoreScroll();
      } else stop?.();
    } catch (err) {
      fatal(err, id);
    }
    return;
  }

  if (!session.token) {
    redirectToLogin();
    return;
  }
  const pageName = name;

  // Commit first: draw this route's frame now, from the last known account if there is one.
  let body = lastProfile ? mountShell(lastProfile, pageName) : (boot(), null);
  arrive(pageName, body);

  let profile;
  try {
    profile = await api("/me"); // fresh status on every page
  } catch (err) {
    if (err.code !== "login_required") fatal(err, id);
    return;
  }
  if (id !== renderId) return;
  if (!body || profile.developer.status !== lastProfile?.developer.status) body = mountShell(profile, pageName);
  lastProfile = profile;
  arrive(pageName, body);

  try {
    const stop = await PRIVATE[pageName].render(body, { profile, refresh: show });
    if (id === renderId) {
      stopPage = stop ?? null;
      restoreScroll();
    } else stop?.();
  } catch (err) {
    if (id !== renderId || err.code === "login_required") return;
    clear(body);
    body.append(h("div", { class: "page" }, h("div", { class: "callout callout-bad", role: "alert" }, icon("alert", 20), h("div", {}, h("strong", {}, "This page could not load"), h("span", {}, err.message))), h("div", { class: "actions retry" }, h("button", { class: "btn btn-ghost", type: "button", onclick: () => show() }, "Try again"))));
  }
}

initRouter(() => show());
show();
