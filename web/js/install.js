// „App herunterladen“: FreizeitTracker auf den Startbildschirm holen
// - Android / Chrome / Edge: echtes Installationsfenster des Browsers (beforeinstallprompt)
// - iPhone / iPad: Apple erlaubt das nicht per Knopf → kurze Anleitung mit 3 Schritten
// - Browser ohne beides (z. B. Firefox, Instagram-Browser): passende Anleitung
import { esc, openSheet, store, toast, haptic } from "./util.js";
import { trackEvent } from "./analytics.js";

let deferred = null;
let waiters = [];
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();             // eigenes, schöneres Angebot statt der Browser-Leiste
  deferred = e;
  waiters.forEach((f) => f());
  waiters = [];
});
addEventListener("appinstalled", () => {
  deferred = null;
  store.set("install-done", true);
  trackEvent("app-installiert");
});

const ua = navigator.userAgent;
const IOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IPAD = /iPad/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const ANDROID = /Android/.test(ua);
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Snapchat|musical_ly|TikTok|LinkedInApp|Line\//i.test(ua);
const IOS_OTHER = IOS && /CriOS|FxiOS|EdgiOS/.test(ua);   // Chrome/Firefox/Edge auf dem iPhone

export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const canInstall = () => !isStandalone();

function waitForPrompt(ms) {
  if (deferred) return Promise.resolve(true);
  return new Promise((res) => {
    const t = setTimeout(() => res(false), ms);
    waiters.push(() => { clearTimeout(t); res(true); });
  });
}

// ---------------------------------------------------------------- Symbole
const shareIc = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M7 11H5.5A1.5 1.5 0 0 0 4 12.5v7A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H17"/></svg>`;
const addIc = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`;
const dotsIc = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>`;
const moreIc = `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

const head = (title, text) => `<div class="inst-head"><img src="icon-192.png" alt="" class="inst-icon"><div><h2>${esc(title)}</h2><p>${text}</p></div></div>`;
const step = (n, ic, html) => `<div class="inst-step"><span class="inst-n">${n}</span><span class="inst-ic">${ic}</span><div>${html}</div></div>`;

function dataNote(hasData) {
  if (!hasData || !IOS) return "";
  return `<div class="inst-note">Auf dem iPhone hat die App einen eigenen Speicher. Deine bisherigen Einträge aus dem Browser:
    zuerst unter <b>Profil → Sicherung exportieren</b> speichern und in der App mit <b>„Sicherung wiederherstellen“</b> holen.</div>`;
}

// ---------------------------------------------------------------- Anleitungen
function guideHTML(hasData) {
  if (IN_APP) {
    return head("Im richtigen Browser öffnen", "Aus dieser App heraus lässt sich nichts installieren.")
      + step(1, moreIc, `Tippe oben auf <b>•••</b> bzw. <b>⋮</b>`)
      + step(2, shareIc, `Wähle <b>„Im Browser öffnen“</b> (${IOS ? "Safari" : "Chrome"})`)
      + step(3, addIc, `Dort erscheint <b>„App herunterladen“</b> wieder`)
      + `<button class="btn block" id="inst-copy" style="margin-top:14px">Link kopieren</button>`;
  }
  if (IOS) {
    const where = IOS_OTHER ? "oben in der Adressleiste" : IPAD ? "oben rechts" : "unten in der Leiste";
    return head("Auf den Home-Bildschirm", "Apple erlaubt das nur über das Teilen-Menü – dauert 10 Sekunden.")
      + step(1, shareIc, `Tippe ${where} auf <b>Teilen</b>${IOS_OTHER ? "" : `<div class="tiny muted">Neuere iPhones: zuerst auf <b>•••</b> tippen, dann <b>Teilen</b></div>`}`)
      + step(2, addIc, `Wähle <b>„Zum Home-Bildschirm“</b><div class="tiny muted">Falls nicht sichtbar: im Menü nach unten wischen bzw. „Mehr“</div>`)
      + step(3, `<b style="font-size:13px">Hinzu&shy;fügen</b>`, `Tippe oben rechts auf <b>„Hinzufügen“</b> – fertig!`)
      + dataNote(hasData)
      + `<button class="btn primary block" id="inst-ok" style="margin-top:16px">Verstanden</button>`
      + (!IOS_OTHER && !IPAD ? `<div class="inst-arrow" aria-hidden="true">↓</div>` : "");
  }
  return head("Als App installieren", "In deinem Browser geht es über das Menü:")
    + step(1, dotsIc, `Tippe auf <b>⋮</b> bzw. <b>☰</b> (Menü des Browsers)`)
    + step(2, addIc, `Wähle <b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b>`)
    + step(3, `<b style="font-size:13px">OK</b>`, `Bestätigen – das Symbol erscheint auf dem Startbildschirm`)
    + `<button class="btn primary block" id="inst-ok" style="margin-top:16px">Verstanden</button>`;
}

function showGuide(sheet, hasData) {
  sheet.set(guideHTML(hasData));
  const ok = sheet.body.querySelector("#inst-ok");
  if (ok) ok.onclick = () => { store.set("install-done", true); sheet.close(); };
  const cp = sheet.body.querySelector("#inst-copy");
  if (cp) cp.onclick = async () => {
    try { await navigator.clipboard.writeText(location.href.split("#")[0]); toast("Link kopiert – im Browser einfügen"); }
    catch { toast(location.href.split("#")[0], 6000); }
  };
}

// Knopf „App herunterladen“ gedrückt
async function install(sheet, hasData) {
  haptic();
  trackEvent("installieren-angetippt", IOS ? "ios" : ANDROID ? "android" : "andere");
  if (!IOS && !IN_APP && await waitForPrompt(deferred ? 0 : 1500)) {
    const ev = deferred;
    deferred = null;            // ein Angebot kann nur einmal benutzt werden
    sheet.close();
    try {
      ev.prompt();
      const choice = await ev.userChoice;
      if (choice?.outcome === "accepted") toast("App wird installiert – gleich auf deinem Startbildschirm 🎉", 4000);
    } catch { /* Browser hat abgelehnt */ }
    return;
  }
  showGuide(sheet, hasData);
}

// ---------------------------------------------------------------- Angebote
export function openInstallSheet({ hasData = false } = {}) {
  const sheet = openSheet(`${head("FreizeitTracker als App", "Mit eigenem Symbol auf dem Startbildschirm – öffnet ohne Browserleiste und funktioniert auch offline.")}
    <div class="inst-perks"><span>📲 1 Tipp zum Öffnen</span><span>✈️ Offline</span><span>🔒 Daten bleiben am Handy</span></div>
    ${dataNote(hasData)}
    <button class="btn primary block" id="inst-go">App herunterladen</button>
    <button class="btn block" id="inst-later" style="margin-top:10px">Im Browser weiter</button>`);
  sheet.body.querySelector("#inst-go").onclick = () => install(sheet, hasData);
  sheet.body.querySelector("#inst-later").onclick = () => {
    store.set("install-later", Date.now() + 3 * 864e5);   // in 3 Tagen wieder fragen
    sheet.close();
  };
  return sheet;
}

// Beim Start einmal fragen, wenn die Seite im Browser offen ist
export async function offerInstallOnStart({ hasData = false } = {}) {
  if (isStandalone() || store.get("install-done", false)) return;
  if (Date.now() < store.get("install-later", 0)) return;
  if (/selftest/.test(location.pathname)) return;
  // Android/PC: nur anbieten, wenn der Browser die Installation erlaubt (sonst ist sie meist schon erfolgt)
  if (!IOS && !IN_APP && !ANDROID && !(await waitForPrompt(2500))) return;
  if (ANDROID && !IN_APP) await waitForPrompt(2500);
  if (document.querySelector(".sheet")) return;   // nicht über ein anderes Fenster legen
  openInstallSheet({ hasData });
}
