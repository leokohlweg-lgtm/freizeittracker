// Willkommen, Registrierung (4 Schritte) und Anmeldung
import { api } from "../api.js";
import { S, go } from "../state.js";
import { esc, fmtEUR, seasonLabel, todayISO, seasonOf, toast } from "../util.js";
import { trackEvent } from "../analytics.js";

const draft = { step: 0, first_name: "", last_name: "", birth_date: "", disability: false, season_id: null, purchase_price: "" };

export function renderWelcome(root) {
  root.innerHTML = `<div class="onb">
    <img class="onb-illu" src="img/welcome.webp" alt="" aria-hidden="true">
    <div class="logo hidden" id="w-logo">⛰️</div>
    <h1>Wie viel spart dein Freizeitticket wirklich?</h1>
    <p class="lead">FreizeitTracker kennt alle Partner des Freizeittickets Tirol, recherchiert die regulären Eintrittspreise und rechnet automatisch mit, wie viel du sparst.</p>
    <div class="stack" style="margin-bottom:12px">
      ${[["💶", "Ersparnis & Nettovorteil in Echtzeit"], ["🔎", "Alle Skigebiete, Bäder, Museen & Bonuspartner"], ["🎂", "Richtige Tarifkategorie anhand deines Jahrgangs"]]
        .map(([e, t]) => `<div class="row" style="gap:14px"><span style="font-size:24px">${e}</span><span style="font-weight:600">${t}</span></div>`).join("")}
    </div>
    <div class="spacer"></div>
    <button class="btn primary block" id="w-reg">Los geht's</button>
    <button class="btn block" style="margin-top:10px" id="w-login">Sicherung wiederherstellen</button>
    <p class="tiny muted center" style="margin-top:16px">Deine Daten bleiben nur auf diesem Gerät. Unabhängiges Projekt, kein offizielles Angebot des Freizeitticket Tirol. Preise stammen aus öffentlichen Quellen.</p>
  </div>`;
  // ohne Bild (z. B. noch nicht geladen/offline) das bisherige Logo zeigen
  const illu = root.querySelector(".onb-illu");
  illu.onerror = () => { illu.remove(); root.querySelector("#w-logo").classList.remove("hidden"); };
  root.querySelector("#w-reg").onclick = () => go("#/register");
  root.querySelector("#w-login").onclick = () => go("#/login");
}

// Neues Handy / neu installiert: Sicherungsdatei einlesen
export function renderLogin(root, onAuthed) {
  root.innerHTML = `<div class="onb">
    <button class="link-btn" id="back" style="align-self:flex-start;margin-bottom:24px">‹ Zurück</button>
    <h1>Sicherung wiederherstellen</h1>
    <p class="lead">Wähle die Sicherungsdatei (<b>freizeittracker-sicherung-….json</b>), die du früher unter Profil → Daten exportiert hast. Profil, Saisonen, Besuche und eigene Preise werden übernommen.</p>
    <label class="btn primary block" style="cursor:pointer">Datei auswählen<input type="file" id="rf" accept="application/json,.json" hidden></label>
    <div class="err" id="err"></div></div>`;
  root.querySelector("#back").onclick = () => go("#/welcome");
  root.querySelector("#rf").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const r = await api("/api/import", { method: "POST", body: data });
      S.user = (await api("/api/me")).user;
      trackEvent("sicherung-wiederhergestellt");
      onAuthed();
      setTimeout(() => toast(`${r.created} Besuche wiederhergestellt`), 500);
    } catch (err) { root.querySelector("#err").textContent = err.message || "Datei konnte nicht gelesen werden"; }
  };
}

export async function renderRegister(root, onAuthed) {
  if (!S.seasonsPublic) S.seasonsPublic = await api("/api/public/seasons");
  const pub = S.seasonsPublic;
  if (!draft.season_id) draft.season_id = pub.current;
  const steps = 4;
  const header = (title, lead) => `<button class="link-btn" id="back" style="align-self:flex-start;margin-bottom:20px">‹ Zurück</button>
    <div class="steps">${Array.from({ length: steps }, (_, i) => `<i class="${i <= draft.step ? "on" : ""}"></i>`).join("")}</div>
    <h1 style="font-size:30px">${title}</h1><p class="lead">${lead}</p>`;
  const season = () => pub.seasons.find((s) => s.id === draft.season_id);
  const seasonChoices = () => {
    const ids = new Set(pub.seasons.map((s) => s.id));
    const cur = +pub.current.slice(0, 4);
    for (let y = cur; y >= cur - 3; y--) ids.add(`${y}-${String((y + 1) % 100).padStart(2, "0")}`);
    return [...ids].sort().reverse();
  };
  let html = "";
  if (draft.step === 0) {
    html = header("Wie heißt du?", "Dein Name erscheint nur in deinem persönlichen Profil.") + `
      <label class="field"><span>Vorname</span><input class="input" id="fn" autocomplete="given-name" value="${esc(draft.first_name)}"></label>
      <label class="field"><span>Nachname</span><input class="input" id="ln" autocomplete="family-name" value="${esc(draft.last_name)}"></label>`;
  } else if (draft.step === 1) {
    html = header("Wann bist du geboren?", "Die Ticketkategorie richtet sich nach deinem Geburtsjahrgang laut offiziellen Tarifbestimmungen – nicht nach deinem aktuellen Alter.") + `
      <label class="field"><span>Geburtsdatum</span><input class="input" id="bd" type="date" max="${todayISO()}" min="1900-01-01" value="${esc(draft.birth_date)}"></label>
      <label class="row" style="gap:12px;margin:4px 4px 16px"><span class="toggle"><input type="checkbox" id="dis" ${draft.disability ? "checked" : ""}><i></i></span><span class="small">Ich habe einen Behindertenpass (GdB/MdE ab 60 %)</span></label>
      <div id="catbox"></div>`;
  } else if (draft.step === 2) {
    const s = season();
    html = header("Dein Freizeitticket", "Welche Saison und welchen Preis hast du tatsächlich bezahlt?") + `
      <label class="field"><span>Saison (1. Oktober – 30. September)</span><select class="input" id="sea">${seasonChoices().map((id) => `<option value="${id}" ${id === draft.season_id ? "selected" : ""}>Saison ${seasonLabel(id)}${id === pub.current ? " (aktuell)" : ""}</option>`).join("")}</select></label>
      <div id="pricebox"></div>
      <label class="field"><span>Tatsächlich bezahlter Kaufpreis</span><div class="input-group"><input class="input num" id="pp" inputmode="decimal" placeholder="z. B. 789" value="${esc(draft.purchase_price)}"><span class="suffix">€</span></div></label>
      ${s && !s.verified ? `<p class="small muted">Für diese Saison liegen keine offiziellen Tarifdaten vor – die Jahrgangsgrenzen werden aus der nächstgelegenen Saison abgeleitet.</p>` : ""}`;
  } else {
    html = header("Fast geschafft", "Ein paar Dinge, die du wissen solltest:") + `
      <div class="stack">
        ${[["🔒", "Deine Daten bleiben auf diesem Handy", "Kein Account, kein Login, keine Cloud. Niemand außer dir sieht deine Besuche. Gezählt wird nur anonym, wie oft die App genutzt wird – abschaltbar im Profil."],
           ["🔄", "Preise aktualisieren sich von selbst", "Einmal pro Woche werden alle Partner und Preise automatisch neu recherchiert. Die App lädt sie beim Öffnen."],
           ["💾", "Sicherung nicht vergessen", "Exportiere ab und zu eine Sicherung (Profil → Daten). Damit kannst du alles auf einem neuen Handy wiederherstellen."]]
          .map(([e, t, s]) => `<div class="card row" style="gap:14px;align-items:flex-start"><span style="font-size:26px">${e}</span><div><b>${t}</b><div class="small muted">${s}</div></div></div>`).join("")}
      </div>`;
  }
  root.innerHTML = `<div class="onb">${html}<div class="err" id="err"></div><div class="spacer"></div>
    <button class="btn primary block" id="next">${draft.step === steps - 1 ? "Los geht's" : "Weiter"}</button></div>`;
  const err = (m) => (root.querySelector("#err").textContent = m || "");
  root.querySelector("#back").onclick = () => { if (draft.step === 0) go("#/welcome"); else { draft.step--; renderRegister(root, onAuthed); } };

  const updateCat = async () => {
    const box = root.querySelector("#catbox");
    if (!box) return;
    if (!draft.birth_date) { box.innerHTML = ""; return; }
    const sid = seasonOf(todayISO()) === draft.season_id ? draft.season_id : draft.season_id;
    try {
      const r = await api(`/api/public/category?season_id=${sid}&birth_date=${draft.birth_date}&disability=${draft.disability ? 1 : 0}`);
      box.innerHTML = r.category ? `<div class="cat-card"><div class="small muted" style="font-weight:700">Deine Kategorie · Saison ${seasonLabel(sid)}</div>
        <div class="cat">${esc(r.category.label)}</div><div class="small" style="margin-top:4px">${esc(r.explanation)}</div>
        ${r.category.price_regular ? `<div class="small muted" style="margin-top:8px">Offizieller Preis: ${r.category.price_presale ? esc(fmtEUR(r.category.price_presale, true)) + " (Vorverkauf) · " : ""}${esc(fmtEUR(r.category.price_regular, true))} (Normaltarif)</div>` : ""}</div>`
        : `<div class="warn">${esc(r.explanation)}</div>`;
    } catch (e) { box.innerHTML = ""; }
  };
  const updatePrices = async () => {
    const box = root.querySelector("#pricebox");
    if (!box || !draft.birth_date) return;
    try {
      const r = await api(`/api/public/category?season_id=${draft.season_id}&birth_date=${draft.birth_date}&disability=${draft.disability ? 1 : 0}`);
      const c = r.category;
      if (!c || (!c.price_presale && !c.price_regular)) { box.innerHTML = c ? `<p class="small muted">Kategorie: <b>${esc(c.label)}</b></p>` : ""; return; }
      const opts = [c.price_presale && ["Vorverkauf", c.price_presale], c.price_regular && ["Normaltarif", c.price_regular]].filter(Boolean);
      box.innerHTML = `<p class="small muted" style="margin:0 4px 8px">Kategorie <b>${esc(c.label)}</b> – offizielle Preise:</p><div class="price-choices">${opts.map(([l, p]) =>
        `<button class="price-choice ${+draft.purchase_price === p ? "on" : ""}" data-p="${p}"><span class="small muted">${l}</span><b>${esc(fmtEUR(p, true))}</b></button>`).join("")}</div>`;
      box.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { draft.purchase_price = b.dataset.p; root.querySelector("#pp").value = b.dataset.p; updatePrices(); }));
    } catch (e) { box.innerHTML = ""; }
  };

  if (draft.step === 1) {
    root.querySelector("#bd").onchange = (e) => { draft.birth_date = e.target.value; updateCat(); };
    root.querySelector("#dis").onchange = (e) => { draft.disability = e.target.checked; updateCat(); };
    updateCat();
  }
  if (draft.step === 2) {
    root.querySelector("#sea").onchange = (e) => { draft.season_id = e.target.value; updatePrices(); };
    root.querySelector("#pp").oninput = (e) => { draft.purchase_price = e.target.value; root.querySelectorAll(".price-choice").forEach((b) => b.classList.toggle("on", b.dataset.p === e.target.value)); };
    updatePrices();
  }
  root.querySelector("#next").onclick = async () => {
    err("");
    if (draft.step === 0) {
      draft.first_name = root.querySelector("#fn").value.trim();
      draft.last_name = root.querySelector("#ln").value.trim();
      if (!draft.first_name || !draft.last_name) return err("Bitte Vor- und Nachnamen angeben.");
    } else if (draft.step === 1) {
      if (!draft.birth_date) return err("Bitte dein Geburtsdatum angeben.");
    } else if (draft.step === 2) {
      draft.purchase_price = root.querySelector("#pp").value.replace(",", ".").trim();
      if (!draft.purchase_price || isNaN(+draft.purchase_price) || +draft.purchase_price < 0) return err("Bitte den tatsächlich bezahlten Kaufpreis eintragen.");
    } else {
      try {
        const r = await api("/api/auth/register", { method: "POST", body: { ...draft, step: undefined } });
        S.user = r.user;
        draft.step = 0;
        trackEvent("profil-angelegt", r.user.seasons[0]?.category_key || "");
        onAuthed(true);
      } catch (e) { err(e.message); }
      return;
    }
    draft.step++;
    renderRegister(root, onAuthed);
  };
}
