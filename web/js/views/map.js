// Interaktive Karte aller Freizeitticket-Standorte (Leaflet + OpenStreetMap)
import { api } from "../api.js";
import { loadFacilities, go } from "../state.js";
import { openFacility, openVisitSheet } from "../sheets.js";
import { esc, fmtEUR, fmtDate, catIcon, I, todayISO } from "../util.js";

let leafletReady = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((res, rej) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    css.crossOrigin = "";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.crossOrigin = "";
    s.onload = res;
    s.onerror = () => { leafletReady = null; rej(new Error("Kartenbibliothek konnte nicht geladen werden (offline?)")); };
    document.head.appendChild(s);
  });
  return leafletReady;
}

export async function renderMap(root) {
  let filter = "all";
  root.innerHTML = `<div class="map-view"><div id="map"></div>
    <div class="map-top"><button class="round-btn" id="m-back" aria-label="Zurück">${I.back()}</button>
      <div class="chips grow" id="m-chips"></div></div>
    <div class="map-legend"><span><i class="pin visited"></i>Besucht</span><span><i class="pin unvisited"></i>Noch nicht besucht</span><span><i class="pin fav"></i>Favorit</span><span><i class="pin bonus"></i>Bonuspartner</span></div>
    <div id="m-card"></div></div>`;
  root.querySelector("#m-back").onclick = () => (history.length > 1 ? history.back() : go("#/home"));
  let list;
  try { [list] = await Promise.all([loadFacilities(true), loadLeaflet()]); }
  catch (e) { root.querySelector("#map").innerHTML = `<div class="empty" style="padding-top:120px">${esc(e.message)}</div>`; return; }
  const L = window.L;
  const map = L.map("map", { zoomControl: false, attributionControl: true }).setView([47.2, 11.4], 9);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende' }).addTo(map);
  if (innerWidth >= 640) L.control.zoom({ position: "bottomright" }).addTo(map);  // auf dem Handy: Pinch-Zoom
  const layer = L.layerGroup().addTo(map);
  // nur Standorte in Tirol (Schutz vor fehlerhafter Geokodierung)
  const geo = list.filter((f) => f.lat && f.lon && f.lat > 46.6 && f.lat < 47.8 && f.lon > 10.0 && f.lon < 13.0);
  const kindOf = (f) => (f.favorite ? "fav" : f.kind === "bonus" ? "bonus" : f.n_visits ? "visited" : "unvisited");
  const chips = root.querySelector("#m-chips");
  const counts = { all: geo.length, visited: geo.filter((f) => f.n_visits).length, unvisited: geo.filter((f) => !f.n_visits && f.kind !== "bonus").length,
    fav: geo.filter((f) => f.favorite).length, bonus: geo.filter((f) => f.kind === "bonus").length };
  const renderChips = () => {
    chips.innerHTML = [["all", "Alle"], ["visited", "Besucht"], ["unvisited", "Nicht besucht"], ["fav", "Favoriten"], ["bonus", "Bonus"]]
      .map(([k, l]) => `<button class="chip ${filter === k ? "on" : ""}" data-f="${k}" style="box-shadow:0 4px 14px rgba(0,0,0,.15)">${l} <span class="muted">${counts[k]}</span></button>`).join("");
  };
  const draw = () => {
    layer.clearLayers();
    const sel = geo.filter((f) => filter === "all" || (filter === "visited" ? f.n_visits : filter === "unvisited" ? !f.n_visits && f.kind !== "bonus" : filter === "fav" ? f.favorite : f.kind === "bonus"));
    sel.forEach((f) => {
      const k = kindOf(f);
      const m = L.marker([f.lat, f.lon], { icon: L.divIcon({ className: "", html: `<i class="pin ${k}"></i>`, iconSize: k === "fav" ? [22, 22] : [18, 18] }), title: f.name, riseOnHover: true });
      m.on("click", () => showCard(f));
      m.addTo(layer);
    });
    if (sel.length) {
      const b = L.latLngBounds(sel.map((f) => [f.lat, f.lon]));
      const z = Math.max(8, Math.min(12, map.getBoundsZoom(b, false, L.point(40, 40))));
      // ganz Tirol passt am Handy erst bei Zoom 7 – dann lieber auf den dichten Raum Innsbruck zentrieren
      const center = z === 8 && sel.length > 5 ? L.latLng(47.22, 11.3) : b.getCenter();
      map.setView(center, z, { animate: false });
    }
  };
  const card = root.querySelector("#m-card");
  const showCard = async (f) => {
    card.innerHTML = `<div class="map-card"><div class="row" style="gap:12px">${catIcon(f.category, 44)}<div class="grow"><div style="font-weight:750;font-size:17px" class="ellipsis">${esc(f.name)}</div>
      <div class="small muted">${esc(f.category_label)}${f.town ? " · " + esc(f.town) : ""}</div></div><button class="close-x" id="mc-x">${I.close()}</button></div>
      <div id="mc-price" class="small muted" style="margin:12px 0"><span class="spin" style="width:14px;height:14px;border-width:2px"></span></div>
      <div class="row" style="gap:10px"><button class="btn small grow" id="mc-info">Details</button><button class="btn small primary grow" id="mc-add">${I.plus(16)} Besuch</button></div></div>`;
    card.querySelector("#mc-x").onclick = () => (card.innerHTML = "");
    card.querySelector("#mc-info").onclick = () => openFacility(f.id);
    card.querySelector("#mc-add").onclick = () => openVisitSheet({ facility: f, onDone: () => { loadFacilities(true).then((l) => { list = l; }); } });
    try {
      const q = await api(`/api/facilities/${f.id}/quote?date=${todayISO()}`);
      card.querySelector("#mc-price").innerHTML = `<div class="row between"><span>Dein regulärer Preis heute</span><b class="num" style="color:var(--text)">${q.regular_price != null ? esc(fmtEUR(q.regular_price)) : "nicht verfügbar"}</b></div>
        ${f.kind === "bonus" ? `<div class="row between"><span>Bonus</span><b style="color:var(--purple)">${esc(f.discount_label || "–")}</b></div>` : ""}
        <div class="row between"><span>Deine Nutzung</span><b style="color:var(--text)">${f.n_visits ? `${f.n_visits}× · zuletzt ${esc(fmtDate(f.last_visit))}` : "noch nicht besucht"}</b></div>`;
    } catch { card.querySelector("#mc-price").textContent = ""; }
  };
  chips.onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; renderChips(); draw(); card.innerHTML = ""; } };
  renderChips();
  draw();
  // Container hat erst nach dem Layout seine endgültige Größe -> danach neu einpassen
  setTimeout(() => { map.invalidateSize(); draw(); }, 120);
}
