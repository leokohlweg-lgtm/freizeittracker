// Anonyme Nutzungsstatistik über GoatCounter (https://www.goatcounter.com)
// - keine Cookies, keine persönlichen Daten, kein fremdes Skript (nur ein Zähl-Aufruf)
// - gezählt werden nur: geöffnete Ansichten und wenige Ereignisse (z. B. "Besuch erfasst · Skigebiet")
// - in der App unter Profil → Datenschutz abschaltbar
import { store } from "./util.js";

// Dein GoatCounter-Code (aus https://DEINCODE.goatcounter.com). Leer = Statistik aus.
export const GOATCOUNTER_CODE = "freizeittracker";

const isDev = ["localhost", "127.0.0.1", ""].includes(location.hostname) || /selftest/.test(location.pathname);

export const statsAvailable = () => !!GOATCOUNTER_CODE && !isDev;
export const statsAllowed = () => statsAvailable() && !store.get("analytics-off", false);
export const setStatsAllowed = (on) => store.set("analytics-off", !on);

function send(path, title, isEvent) {
  if (!statsAllowed() || !navigator.onLine) return;
  const q = new URLSearchParams({ p: path, t: title, e: isEvent ? "true" : "false", s: String(screen.width), rnd: Math.random().toString(36).slice(2) });
  try {
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.src = `https://${GOATCOUNTER_CODE}.goatcounter.com/count?${q}`;
  } catch { /* Statistik darf nie die App stören */ }
}

// Ansicht geöffnet (nur der Name der Ansicht, z. B. "/home")
let last = "";
export function trackView(view) {
  const p = "/" + (view || "home");
  if (p === last) return;
  last = p;
  send(p, "Ansicht " + p, false);
}

// Ereignis, z. B. trackEvent("besuch-erfasst", "ski")
export function trackEvent(name, detail = "") {
  const p = detail ? `${name}/${detail}` : name;
  send(p, p, true);
}

// Geräte und Freizeittickets einmalig melden (für die Gesamtzahl im Entwickler-Dashboard).
// - "geraet-angemeldet": einmal pro Gerät, sobald dort mindestens ein Ticket angelegt ist
// - "ticket-angelegt/<n>": einmal pro Ticket; n zählt je Gerät hoch, damit GoatCounter zwei Tickets
//   aus derselben Sitzung nicht als eines zählt. Bereits vorhandene Tickets werden beim nächsten Öffnen nachgemeldet.
export function reportTickets(tickets) {
  if (!statsAllowed() || !navigator.onLine) return;
  const own = (tickets || []).filter((t) => t.has_profile);
  if (!own.length) return;
  const seen = store.get("reported-tickets", []);
  let n = store.get("reported-ticket-no", seen.length);
  if (!store.get("reported-device", false)) { trackEvent("geraet-angemeldet"); store.set("reported-device", true); }
  for (const t of own) {
    if (seen.includes(t.id)) continue;
    seen.push(t.id);
    trackEvent("ticket-angelegt", String(++n));
  }
  store.set("reported-tickets", seen);
  store.set("reported-ticket-no", n);
}
