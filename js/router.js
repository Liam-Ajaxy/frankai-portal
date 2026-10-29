// History API router. Owns the URL and nothing else: clean paths ("/keys"), never hashes.
// app.js owns what is on screen; it is called synchronously on every URL change so the two cannot disagree.
// No imports on purpose: api.client.js uses this too, and a dependency here would create a cycle.

const ROUTES = {
  "/": { name: "", access: "public" },
  "/login": { name: "login", access: "public" },
  "/signup": { name: "signup", access: "public" },
  "/forgot": { name: "forgot", access: "public" },
  "/home": { name: "home", access: "private" },
  "/keys": { name: "keys", access: "private" },
  "/usage": { name: "usage", access: "private" },
  "/docs": { name: "docs", access: "private" },
  "/account": { name: "account", access: "private" },
  "/connect": { name: "connect", access: "private" },
};
const ALIASES = { "/welcome": "/", "/index.html": "/" };

let handler = null;
let nav = { type: "load", y: 0 }; // how we got here: load | push | replace | pop, plus the scroll position to restore

// "/Keys/" and "//keys" become "/keys", "/welcome" becomes "/". Unknown paths stay exactly as typed (they get the 404 page).
export function canonicalPath(pathname) {
  let p = pathname.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/, "");
  const lower = p.toLowerCase();
  const target = ALIASES[lower] ?? lower;
  return Object.hasOwn(ROUTES, target) ? target : pathname;
}

// Looks at the address bar, tidies it in place (replaceState, so no history entry), and says which route it is.
export function resolve() {
  const path = canonicalPath(location.pathname);
  if (path !== location.pathname || location.hash) history.replaceState(history.state, "", path + location.search);
  const entry = Object.hasOwn(ROUTES, path) ? ROUTES[path] : null;
  return { path, known: Boolean(entry), name: entry?.name ?? null, access: entry?.access ?? null };
}

function saveScroll() {
  history.replaceState({ ...(history.state ?? {}), y: window.scrollY }, "");
}

// Go to a path. Pushes a history entry (or replaces the current one) and renders it immediately.
export function navigate(to, { replace = false } = {}) {
  let url;
  try {
    url = new URL(to, location.origin);
  } catch {
    return;
  }
  if (url.origin !== location.origin) {
    location.assign(url.href);
    return;
  }
  const target = canonicalPath(url.pathname) + url.search; // never a hash
  if (target === location.pathname + location.search) {
    if (!replace && window.scrollY > 0) window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return; // already here: no duplicate history entry
  }
  if (!replace) saveScroll();
  history[replace ? "replaceState" : "pushState"]({ y: 0 }, "", target);
  nav = { type: replace ? "replace" : "push", y: 0 };
  handler?.();
}

// Only paths that are real private pages, and only as a bare path, so "?next=" can never become an open redirect.
export function safeNext(raw) {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return null;
  let url;
  try {
    url = new URL(raw, location.origin);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  const p = canonicalPath(url.pathname);
  if (!Object.hasOwn(ROUTES, p) || ROUTES[p].access !== "private") return null;
  // The terminal sign-in page needs its code to survive the trip through the login page
  const code = p === "/connect" ? (url.searchParams.get("code") ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12) : "";
  return code ? `${p}?code=${code}` : p;
}
export const nextTarget = () => safeNext(new URLSearchParams(location.search).get("next"));

// Sends a visitor to the login page, remembering the private page they wanted so login can bring them back.
export function redirectToLogin() {
  const here = canonicalPath(location.pathname);
  const wanted = Object.hasOwn(ROUTES, here) && ROUTES[here].access === "private" && here !== "/home";
  const back = here === "/connect" ? here + location.search : here; // keep ?code= for the terminal sign-in page
  navigate(wanted ? `/login?next=${encodeURIComponent(back)}` : "/login", { replace: true });
}

// The scroll position to restore after back/forward or a reload; handed out once.
export function consumeScroll() {
  const y = nav.y;
  nav.y = 0;
  return y;
}

// Ordinary same-origin links navigate without a page load. New-tab clicks, downloads, assets and anything else are left alone.
function onClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
  if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.relList?.contains("external")) return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return;
  if (url.hash && url.pathname === location.pathname) return;
  if (/\.[a-z0-9]+$/i.test(url.pathname)) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
}

export function initRouter(onRoute) {
  handler = onRoute;
  history.scrollRestoration = "manual";
  // Old bookmarks such as /#/keys or /index.html#/keys become /keys.
  if (location.hash.startsWith("#/")) history.replaceState(null, "", location.hash.slice(1));
  nav = { type: "load", y: history.state?.y ?? 0 };
  window.addEventListener("popstate", () => {
    nav = { type: "pop", y: history.state?.y ?? 0 };
    handler?.();
  });
  // Remember the scroll position as the person scrolls (debounced) so back/forward and reloads can return to it.
  let timer;
  window.addEventListener("scroll", () => { clearTimeout(timer); timer = setTimeout(saveScroll, 100); }, { passive: true });
  window.addEventListener("pagehide", saveScroll);
  document.addEventListener("click", onClick);
}
