// Gemeinsamer Zustand der App
import { api } from "./api.js";
import { store } from "./util.js";

export const S = {
  user: null,
  facilities: null,
  facilitiesAt: 0,
  categories: [],
  ticketTypes: {},
  seasonsPublic: null,
  rerender: null,
};

export const go = (hash) => { if (location.hash === hash) S.rerender && S.rerender(); else location.hash = hash; };

export function activeSeason() {
  const u = S.user;
  if (!u) return null;
  return u.active_season_id || (u.seasons[0] && u.seasons[0].season_id);
}
export const userSeason = (id = activeSeason()) => (S.user?.seasons || []).find((s) => s.season_id === id);

export async function refreshUser() {
  const r = await api("/api/me");
  S.user = r.user;
  return S.user;
}

export async function loadFacilities(force = false) {
  if (S.facilities && !force && Date.now() - S.facilitiesAt < 120000) return S.facilities;
  const r = await api("/api/facilities");
  S.facilities = r.facilities;
  S.categories = r.categories;
  S.ticketTypes = r.ticket_types;
  S.facilitiesAt = Date.now();
  return S.facilities;
}
export const invalidate = () => { S.facilitiesAt = 0; };

export function setTheme(t) {
  store.set("theme", t);
  applyTheme();
}
export function applyTheme() {
  const t = store.get("theme", "system");
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}
