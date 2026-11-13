// FreizeitTracker – Einstieg, Routing, Navigation (läuft komplett auf dem Gerät)
import { S, refreshUser, applyTheme, loadFacilities } from "./state.js";
import { loadCatalog, hasProfile, requestPersist, listTickets } from "./local/local.js";
import { I, esc, toast, closeAllSheets, fmtDate, stagger } from "./util.js";
import { trackView, trackEvent, reportTickets } from "./analytics.js";
import { renderWelcome, renderLogin, renderRegister } from "./views/onboarding.js";
import { renderHome } from "./views/home.js";
import { renderVisits } from "./views/visits.js";
import { renderStats } from "./views/stats.js";
import { renderProfile, renderReview } from "./views/profile.js";
import { renderMap } from "./views/map.js";
import { renderWrapped } from "./views/wrapped.js";

const app = document.getElementById("app");
applyTheme();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);

const TABS = [
  ["home", "Home", I.home],
  ["visits", "Besuche", I.list],
  ["stats", "Statistiken", I.chart],
  ["profile", "Profil", I.person],
];

function tabbar(active) {
  let bar = document.getElementById("tabbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "tabbar";
    bar.className = "tabbar";
    document.body.appendChild(bar);
  }
  bar.innerHTML = `<nav aria-label="Hauptnavigation">${TABS.map(([k, l, ic]) => `<a href="#/${k}" class="${active === k ? "on" : ""}" ${active === k ? 'aria-current="page"' : ""}>${ic(26)}<span>${l}</span></a>`).join("")}</nav>`;
  bar.style.display = "";
}
const hideTabbar = () => { const b = document.getElementById("tabbar"); if (b) b.style.display = "none"; };

async function route() {
  closeAllSheets();
  document.querySelectorAll(".search-overlay").forEach((o) => o.remove());
  const [path, sub] = (location.hash.replace(/^#\/?/, "") || "home").split("/");
  S.rerender = route;
  window.scrollTo(0, 0);
  const open = ["welcome", "login", "register"];
  if (!S.user && !open.includes(path)) { location.replace("#/welcome"); return; }
  if (S.user && open.includes(path)) { location.replace("#/home"); return; }
  const authed = (isNew) => {
    loadFacilities(true).catch(() => {});
    location.hash = "#/home";
    if (isNew) setTimeout(() => toast(`Willkommen, ${S.user.first_name}! 🎉`), 400);
  };
  try {
    await renderRoute(path, sub, authed);
    stagger(app.querySelector(".view"));
    trackView(path);
  } catch (e) {
    console.error(e);
    if (e.status === 401) { S.user = null; location.replace("#/welcome"); return; }
    app.innerHTML = `<div class="view"><div class="card empty"><div class="big">⚠️</div>${esc(e.message || "Unerwarteter Fehler")}<br><button class="btn small" style="margin-top:12px" id="reload-btn">Neu laden</button></div></div>`;
    app.querySelector("#reload-btn").onclick = () => location.reload();
  }
}

async function renderRoute(path, sub, authed) {
  switch (path) {
    case "welcome": hideTabbar(); return renderWelcome(app);
    case "login": hideTabbar(); return renderLogin(app, authed);
    case "register": hideTabbar(); return await renderRegister(app, authed);
    case "visits": tabbar("visits"); return await renderVisits(app);
    case "stats": tabbar("stats"); return await renderStats(app, sub);
    case "profile": tabbar("profile"); return await renderProfile(app);
    case "review": tabbar("profile"); return await renderReview(app);
    case "map": tabbar("home"); return await renderMap(app);
    case "wrapped": hideTabbar(); return await renderWrapped(app, sub);
    default: tabbar("home"); return await renderHome(app);
  }
}

async function boot() {
  app.innerHTML = `<div class="onb" style="align-items:center;justify-content:center"><div class="logo">⛰️</div><span class="spin"></span></div>`;
  try {
    const info = await loadCatalog();
    if (info.changed && hasProfile()) setTimeout(() => toast(`Preise aktualisiert · Stand ${fmtDate(info.generated_at.slice(0, 10))}`, 3500), 800);
  } catch (e) {
    app.innerHTML = `<div class="onb" style="justify-content:center;text-align:center"><div class="logo" style="margin:0 auto 20px">⛰️</div>
      <h1 style="font-size:26px">Keine Verbindung</h1><p class="lead">${esc(e.message)}</p><button class="btn primary block" id="retry">Erneut versuchen</button></div>`;
    app.querySelector("#retry").onclick = () => location.reload();
    return;
  }
  if (hasProfile()) {
    try { await refreshUser(); requestPersist(); } catch { S.user = null; }
  }
  trackEvent("app-start", hasProfile() ? "mit-profil" : "neu");
  reportTickets(listTickets());
  window.addEventListener("hashchange", route);
  route();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

boot();
