// Profil, Saisonen, Darstellung, Daten, Preisdatenbank, Prüfprozess
import { api } from "../api.js";
import { loadCatalog, listTickets } from "../local/local.js";
import { ticketRows, activateTicket, startNewTicket } from "./tickets.js";
import { trackEvent, statsAvailable, statsAllowed, setStatsAllowed } from "../analytics.js";
import { S, activeSeason, go, refreshUser, setTheme, invalidate } from "../state.js";
import { openFacility, facilityRow } from "../sheets.js";
import { esc, fmtEUR, fmtDate, seasonLabel, todayISO, seasonOf, I, toast, confirmDlg, dialog, download, store, openSheet } from "../util.js";

export async function renderProfile(root) {
  const u = S.user;
  const act = activeSeason();
  let status = null;
  try { status = await api("/api/status"); } catch { /* offline */ }
  const theme = store.get("theme", "system");
  const c = status?.counts || {};
  root.innerHTML = `<div class="view">
    <div class="topbar"><div><div class="eyebrow">Account</div><h1>Profil</h1></div></div>
    <div class="card row" style="gap:16px"><div class="avatar lg">${esc((u.first_name[0] || "") + (u.last_name[0] || ""))}</div>
      <div class="grow"><div style="font-size:22px;font-weight:800">${esc(u.first_name)} ${esc(u.last_name)}</div>
      <div class="small muted">Geboren ${esc(fmtDate(u.birth_date))}</div><div class="small muted">🔒 Daten nur auf diesem Gerät</div></div></div>
    ${exportWarning(status)}

    <div class="section"><div class="section-head"><h2>Tickets auf diesem Handy</h2><button id="p-addticket">+ Ticket</button></div>
      <div class="list">${ticketRows(listTickets())}</div>
      <p class="tiny muted" style="margin:8px 4px 0">Jedes Ticket hat eigene Besuche, Statistiken und Sicherungen – unabhängig voneinander. Alles unten bezieht sich auf das aktive Ticket.</p></div>

    <div class="section"><div class="section-head"><h2>Freizeitticket</h2><button id="p-addseason">+ Saison</button></div>
      <div class="list">${u.seasons.map((s) => `<div class="item" style="align-items:flex-start"><span class="ic" style="background:${s.season_id === act ? "var(--green-2)" : "var(--surface-3)"};color:${s.season_id === act ? "#fff" : "var(--text-2)"}">🎟️</span>
        <div class="grow"><div class="t">Saison ${esc(s.label)} ${s.season_id === act ? `<span class="badge green">aktiv</span>` : ""}${!s.verified ? ` <span class="badge amber">Regeln unbestätigt</span>` : ""}</div>
          <div class="s">Kategorie <b>${esc(s.category_label || s.category_key)}</b> · Kaufpreis ${esc(fmtEUR(s.purchase_price))}</div>
          <div class="tiny muted" style="margin-top:2px">${esc(s.category_explanation || "")}</div>
          ${s.amortized_on ? `<div class="tiny pos" style="margin-top:2px">Amortisiert am ${esc(fmtDate(s.amortized_on))}</div>` : ""}
          <div class="row" style="gap:16px;margin-top:8px">
            <button class="link-btn small" data-editprice="${s.season_id}">Kaufpreis ändern</button>
            ${s.season_id !== act ? `<button class="link-btn small" data-activate="${s.season_id}">Aktiv setzen</button>` : ""}
            ${u.seasons.length > 1 ? `<button class="link-btn small" style="color:var(--red)" data-delseason="${s.season_id}">Entfernen</button>` : ""}</div></div></div>`).join("")}</div></div>

    <div class="section"><div class="section-head"><h2>Persönliche Daten</h2></div>
      <form class="card" id="p-form">
        <div class="row" style="gap:10px"><label class="field grow"><span>Vorname</span><input class="input" name="first_name" value="${esc(u.first_name)}"></label>
          <label class="field grow"><span>Nachname</span><input class="input" name="last_name" value="${esc(u.last_name)}"></label></div>
        <label class="field"><span>Geburtsdatum</span><input class="input" type="date" name="birth_date" max="${todayISO()}" value="${esc(u.birth_date)}"></label>
        <label class="row" style="gap:12px;margin:0 4px 14px"><span class="toggle"><input type="checkbox" name="disability" ${u.disability ? "checked" : ""}><i></i></span><span class="small">Behindertenpass (GdB/MdE ab 60 %)</span></label>
        <button class="btn primary block" type="submit">Speichern</button>
        <p class="tiny muted" style="margin:10px 4px 0">Bei Änderung des Geburtsdatums wird die Kategorie aller Saisonen automatisch neu ermittelt.</p>
      </form></div>

    <div class="section"><div class="section-head"><h2>Darstellung</h2></div>
      <div class="card"><div class="seg" id="p-theme">${[["system", "System"], ["light", "Hell"], ["dark", "Dunkel"]].map(([k, l]) => `<button data-t="${k}" class="${theme === k ? "on" : ""}">${l}</button>`).join("")}</div></div></div>

    <div class="section"><div class="section-head"><h2>Preisdatenbank</h2><a href="#/review">Preisprüfung${c.review ? ` (${c.review})` : ""}</a></div>
      ${status ? `<div class="card">
        <div class="kpis" style="margin-top:0;grid-template-columns:1fr 1fr 1fr">
          ${mini("Partner", c.active)}${mini("Inkludiert", c.included)}${mini("Bonus", c.bonus)}
          ${mini("Mit Preisen", c.with_prices)}${mini("Ohne Preis", (c.not_found || 0) + (c.pending || 0))}${mini("Nicht erreichbar", c.unreachable)}</div>
        <div class="small muted" style="margin-top:12px">${c.tariffs} aktuelle Tarife · ${c.tariffs_archived} archivierte Preise · ${c.archived || 0} archivierte Partner${status.own_prices ? ` · ${status.own_prices} eigene Preise` : ""}</div>
        <div class="row between" style="padding:12px 0 4px;border-top:1px solid var(--sep);margin-top:12px"><div class="grow">
          <div style="font-weight:600">Stand der Preise: ${esc(fmtDate(status.generated_at.slice(0, 10)))}</div>
          <div class="tiny muted">Automatisches Update jeden Montag in der Cloud – die App lädt es beim nächsten Öffnen.</div>
          ${status.jobs.map((j) => `<div class="tiny muted">${j.name === "price_crawl" ? "Preisrecherche" : "Partner-Abgleich"}: ${esc(j.last_message || "–")}</div>`).join("")}</div>
          <button class="btn small" id="p-update" aria-label="Nach Updates suchen">${I.refresh(15)}</button></div>
        <details style="margin-top:6px"><summary class="link-btn small" style="cursor:pointer">Änderungsprotokoll</summary>
          <div style="margin-top:8px;max-height:260px;overflow:auto">${status.log.map((l) => `<div class="tiny" style="padding:5px 0;border-top:1px solid var(--sep)"><span class="muted">${esc(l.at.slice(0, 16))}</span> · ${esc(l.message)}</div>`).join("")}</div></details>
      </div>` : `<div class="card empty small">Offline – Status nicht verfügbar</div>`}</div>

    <div class="section"><div class="section-head"><h2>Daten</h2></div>
      <div class="list">
        <button class="item" id="p-exp-json"><span class="ic" style="background:#0a84ff">${I.download(18)}</span><div class="grow"><div class="t">Sicherung exportieren</div><div class="s">Alle Daten als JSON</div></div></button>
        <button class="item" id="p-exp-csv"><span class="ic" style="background:#34c759">${I.download(18)}</span><div class="grow"><div class="t">Besuche als CSV</div><div class="s">Für Excel & Numbers</div></div></button>
        <label class="item" style="cursor:pointer"><span class="ic" style="background:#ff9f0a">${I.upload(18)}</span><div class="grow"><div class="t">Sicherung importieren</div><div class="s">Doppelte Einträge werden übersprungen</div></div><input type="file" id="p-imp" accept="application/json,.json" hidden></label>
      </div></div>

    <div class="section"><div class="section-head"><h2>Datenschutz</h2></div>
      <div class="card small muted">Alle persönlichen Daten (Name, Geburtsdatum, Besuche) werden ausschließlich auf diesem Gerät gespeichert. Aus dem Internet geladen werden nur der öffentliche Preiskatalog und Kartenbilder.
        ${statsAvailable() ? `<br><br>Damit der Entwickler sieht, wie viele Leute die App nutzen, wird anonym gezählt, welche Ansichten geöffnet und wie viele Besuche erfasst werden (nur die Kategorie, z. B. „Skigebiet“). Keine Cookies, kein Name, keine Einrichtung, kein Betrag – über GoatCounter.` : ""}</div>
      ${statsAvailable() ? `<label class="card row between" style="gap:12px;margin-top:14px"><div><div style="font-weight:600">Anonyme Nutzungsstatistik</div><div class="small muted">Hilft, die App zu verbessern</div></div>
        <span class="toggle"><input type="checkbox" id="p-stats" ${statsAllowed() ? "checked" : ""}><i></i></span></label>` : ""}
      <div class="list" style="margin-top:14px">
        <button class="item" id="p-del"><span class="ic" style="background:#ff3b30">${I.trash(18)}</span><div class="grow"><div class="t" style="color:var(--red)">${listTickets().length > 1 ? "Dieses Ticket löschen" : "Alle Daten löschen"}</div><div class="s">Profil und Besuche von ${esc(u.first_name)} von diesem Gerät entfernen</div></div></button>
      </div>
      <p class="tiny muted center" style="margin-top:18px">FreizeitTracker · Datenquelle: freizeitticket.at und offizielle Websites der Partnerbetriebe.<br>Unabhängiges Projekt – keine Gewähr für Preisangaben.</p></div>
  </div>`;

  const reload = async () => { await refreshUser(); renderProfile(root); };
  root.querySelector("#p-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api("/api/me", { method: "PUT", body: { first_name: fd.get("first_name"), last_name: fd.get("last_name"), birth_date: fd.get("birth_date"), disability: fd.get("disability") === "on" } });
      toast("Gespeichert"); reload();
    } catch (err) { toast(err.message); }
  };
  root.querySelector("#p-theme").onclick = (e) => { const b = e.target.closest("[data-t]"); if (b) { setTheme(b.dataset.t); renderProfile(root); } };
  root.querySelectorAll("[data-editprice]").forEach((b) => (b.onclick = async () => {
    const s = u.seasons.find((x) => x.season_id === b.dataset.editprice);
    const v = await promptValue(`Kaufpreis Saison ${s.label}`, "Tatsächlich bezahlter Preis in €", s.purchase_price);
    if (v == null) return;
    try { await api(`/api/me/seasons/${s.season_id}`, { method: "PUT", body: { purchase_price: v } }); toast("Kaufpreis aktualisiert"); reload(); } catch (err) { toast(err.message); }
  }));
  root.querySelectorAll("[data-activate]").forEach((b) => (b.onclick = async () => { await api(`/api/me/seasons/${b.dataset.activate}`, { method: "PUT", body: { activate: true } }); reload(); }));
  root.querySelectorAll("[data-delseason]").forEach((b) => (b.onclick = async () => {
    const sid = b.dataset.delseason;
    if (!(await confirmDlg(`Saison ${seasonLabel(sid)} entfernen?`, "Alle Besuche dieser Saison werden gelöscht.", "Entfernen", true))) return;
    try { await api(`/api/me/seasons/${sid}`, { method: "DELETE", body: { confirm: true } }); reload(); } catch (err) { toast(err.message); }
  }));
  root.querySelector("#p-addseason").onclick = () => addSeasonSheet(reload);
  root.querySelector("#p-addticket").onclick = () => startNewTicket();
  root.querySelectorAll("[data-ticket]").forEach((b) => (b.onclick = () => { if (!b.classList.contains("on")) activateTicket(b.dataset.ticket); }));
  const upd = root.querySelector("#p-update");
  if (upd) upd.onclick = async () => {
    upd.innerHTML = `<span class="spin" style="width:15px;height:15px;border-width:2px"></span>`;
    try {
      const r = await loadCatalog();
      invalidate();
      toast(r.changed ? `Neue Preise geladen · Stand ${fmtDate(r.generated_at.slice(0, 10))}` : "Du hast bereits die neuesten Preise");
      renderProfile(root);
    } catch (e) { toast(e.message); renderProfile(root); }
  };
  root.querySelector("#p-exp-json").onclick = async () => { await exp("json"); renderProfile(root); };
  root.querySelector("#p-exp-csv").onclick = () => exp("csv");
  const ew = root.querySelector("#p-exp-now"); if (ew) ew.onclick = async () => { await exp("json"); renderProfile(root); };
  root.querySelector("#p-imp").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const r = await api("/api/import", { method: "POST", body: data });
      toast(`${r.created} Besuche importiert, ${r.skipped} übersprungen`); invalidate(); reload();
    } catch (err) { toast(err.message || "Import fehlgeschlagen"); }
  };
  const ps = root.querySelector("#p-stats");
  if (ps) ps.onchange = () => { setStatsAllowed(ps.checked); toast(ps.checked ? "Anonyme Statistik eingeschaltet" : "Anonyme Statistik ausgeschaltet"); };
  root.querySelector("#p-del").onclick = async () => {
    const ok = await dialog({ title: `Ticket von ${u.first_name} löschen?`, text: `Profil, ${status?.visits ?? 0} Besuche und eigene Preise werden von diesem Gerät entfernt. Das kann nicht rückgängig gemacht werden – exportiere vorher eine Sicherung, wenn du sie behalten willst.`,
      buttons: [{ label: "Endgültig löschen", value: true, cls: "danger" }, { label: "Abbrechen", value: false }] });
    if (!ok) return;
    const r = await api("/api/me", { method: "DELETE" });
    invalidate();
    if (r.has_profile) { await refreshUser(); toast(`Gelöscht – jetzt aktiv: Ticket von ${S.user.first_name}`); go("#/home"); }
    else { S.user = null; toast("Daten gelöscht"); go("#/welcome"); }
  };
}

const mini = (k, v) => `<div class="kpi" style="padding:10px"><div class="k">${esc(k)}</div><div class="v num" style="font-size:20px">${v ?? 0}</div></div>`;

function exportWarning(status) {
  if (!status || !status.visits) return "";
  const last = status.last_export_at;
  const days = last ? Math.floor((Date.now() - new Date(last.replace(" ", "T")).getTime()) / 86400000) : null;
  if (days != null && days < 30) return "";
  return `<div class="warn" style="margin-top:14px">${I.warn()}<div class="grow"><b>${last ? `Letzte Sicherung vor ${days} Tagen` : "Noch keine Sicherung"}</b><br>
    <span class="small">Deine ${status.visits} Besuche liegen nur auf diesem Gerät. Exportiere eine Sicherung, damit nichts verloren geht.</span><br>
    <button class="link-btn" id="p-exp-now" style="margin-top:6px">Jetzt sichern</button></div></div>`;
}

async function exp(fmt) {
  try {
    const f = await api(`/api/export?format=${fmt}`);
    trackEvent("export", fmt);
    const blob = new Blob([f.data], { type: f.type });
    // Am Handy: Teilen-Menü (in Dateien sichern, per Mail senden …), sonst Download
    const file = typeof File === "function" ? new File([blob], f.name, { type: f.type }) : null;
    if (file && navigator.canShare?.({ files: [file] }) && matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ files: [file], title: f.name }); toast("Sicherung erstellt"); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    download(f.name, blob);
    toast("Sicherung heruntergeladen");
  } catch (e) { toast(e.message); }
}

function promptValue(title, text, value = "", type = "text") {
  return new Promise((resolve) => {
    const sh = openSheet(`<h2 style="margin:6px 0 6px">${esc(title)}</h2><p class="small muted" style="margin:0 0 14px">${esc(text)}</p>
      <input class="input" id="pv" type="${type}" ${type === "text" ? 'inputmode="decimal"' : ""} value="${esc(value)}">
      <div class="row" style="gap:10px;margin-top:14px"><button class="btn grow" id="pv-c">Abbrechen</button><button class="btn primary grow" id="pv-ok">OK</button></div>`,
      { onClose: () => resolve(null) });
    const i = sh.body.querySelector("#pv");
    setTimeout(() => i.focus(), 300);
    sh.body.querySelector("#pv-c").onclick = () => sh.close();
    sh.body.querySelector("#pv-ok").onclick = () => { const v = i.value; resolve(v); sh.close(); };
  });
}

function addSeasonSheet(done) {
  const cur = seasonOf(todayISO());
  const y0 = +cur.slice(0, 4);
  const existing = new Set(S.user.seasons.map((s) => s.season_id));
  const opts = [];
  for (let y = y0; y >= y0 - 6; y--) { const id = `${y}-${String((y + 1) % 100).padStart(2, "0")}`; if (!existing.has(id)) opts.push(id); }
  const sh = openSheet(`<h2 style="margin:6px 0 14px">Saison hinzufügen</h2>
    ${opts.length ? `<label class="field"><span>Saison</span><select class="input" id="as-s">${opts.map((o) => `<option value="${o}">${seasonLabel(o)}</option>`).join("")}</select></label>
    <label class="field"><span>Tatsächlich bezahlter Kaufpreis</span><div class="input-group"><input class="input num" id="as-p" inputmode="decimal" placeholder="z. B. 789"><span class="suffix">€</span></div></label>
    <label class="row" style="gap:12px;margin:0 4px 16px"><span class="toggle"><input type="checkbox" id="as-a" checked><i></i></span><span class="small">Als aktive Saison verwenden</span></label>
    <p class="tiny muted">Für vergangene Saisonen ohne offizielle Daten werden die Jahrgangsgrenzen aus der nächstgelegenen bekannten Saison abgeleitet und als unbestätigt markiert.</p>
    <button class="btn primary block" id="as-ok">Hinzufügen</button>` : `<div class="empty">Alle verfügbaren Saisonen sind bereits angelegt.</div>`}`);
  const ok = sh.body.querySelector("#as-ok");
  if (ok) ok.onclick = async () => {
    try {
      await api("/api/me/seasons", { method: "POST", body: { season_id: sh.body.querySelector("#as-s").value, purchase_price: sh.body.querySelector("#as-p").value, activate: sh.body.querySelector("#as-a").checked } });
      sh.close(); toast("Saison angelegt"); done();
    } catch (e) { toast(e.message); }
  };
}

// ------------------------------------------------------------ Prüfprozess für Preise
export async function renderReview(root) {
  root.innerHTML = `<div class="view"><div class="topbar"><button class="round-btn" id="rv-back" aria-label="Zurück">${I.back()}</button>
    <div class="grow"><div class="eyebrow">Prüfprozess</div><h1 style="font-size:26px">Preisprüfung</h1></div></div>
    <p class="small muted" style="margin:-6px 4px 16px">Hier landen Einrichtungen, deren Preise nicht automatisch ermittelt werden konnten, deren Website nicht erreichbar war oder deren Funde unsicher sind. Du kannst Preise bestätigen, verwerfen oder selbst ergänzen – das gilt dann auf deinem Gerät. Die Recherche läuft jede Woche automatisch neu. Erfundene Preise gibt es nicht.</p>
    <div id="rv-body"><div class="skeleton" style="height:300px"></div></div></div>`;
  root.querySelector("#rv-back").onclick = () => history.length > 1 ? history.back() : go("#/profile");
  const load = async () => {
    const r = await api("/api/review");
    const label = { not_found: ["amber", "Kein Preis gefunden"], unreachable: ["red", "Nicht erreichbar"], blocked: ["red", "Gesperrt (robots.txt)"],
      stale: ["amber", "Möglicherweise veraltet"], pending: ["gray", "Noch nicht geprüft"], ok: ["blue", "Unsichere Funde"] };
    const groups = { included: r.items.filter((i) => i.kind === "included"), bonus: r.items.filter((i) => i.kind === "bonus") };
    root.querySelector("#rv-body").innerHTML = r.items.length ? Object.entries(groups).filter(([, l]) => l.length).map(([k, l]) => `
      <div class="section-head" style="margin-top:8px"><h2 style="font-size:18px">${k === "included" ? "Inkludierte Angebote" : "Bonuspartner"} (${l.length})</h2></div>
      <div class="list" style="margin-bottom:18px">${l.map((f) => `<button class="item" data-fid="${f.id}" style="align-items:flex-start">${`<span class="ic" style="background:var(--surface-2);font-size:19px">${f.kind === "bonus" ? "🎁" : "🔎"}</span>`}
        <div class="grow"><div class="t ellipsis">${esc(f.name)}</div><div class="s">${esc(f.category_label)}${f.town ? " · " + esc(f.town) : ""}</div>
        <div style="margin-top:4px"><span class="badge ${label[f.price_status]?.[0] || "gray"}">${esc(label[f.price_status]?.[1] || f.price_status)}</span>${f.n_tariffs ? ` <span class="badge gray">${f.n_tariffs} Tarife</span>` : ""}${f.n_unsure ? ` <span class="badge amber">${f.n_unsure} unsicher</span>` : ""}</div>
        <div class="tiny muted" style="margin-top:4px">${esc(f.price_check_message || "")}</div></div>${I.chev()}</button>`).join("")}</div>`).join("")
      : `<div class="card empty"><div class="big">✅</div>Alles geprüft – keine offenen Punkte.</div>`;
    root.querySelector("#rv-body").onclick = (e) => { const b = e.target.closest("[data-fid]"); if (b) openFacility(+b.dataset.fid); };
  };
  try { await load(); } catch (e) { root.querySelector("#rv-body").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
