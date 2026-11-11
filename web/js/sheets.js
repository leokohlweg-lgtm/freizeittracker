// Suche, Besuch erfassen/bearbeiten, Einrichtungsdetails
import { api } from "./api.js";
import { S, loadFacilities, invalidate, go, refreshUser } from "./state.js";
import {
  esc, fmtEUR, fmtDate, relDate, todayISO, addDays, norm, debounce, uid, cat, catIcon, I, CAT, SEARCH_ALIASES,
  openSheet, toast, dialog, confirmDlg, confetti, seasonLabel, haptic,
} from "./util.js";

// ------------------------------------------------------------ Suche
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}

export function searchFacilities(q, list, catFilter = null) {
  let items = list.filter((f) => !catFilter || (catFilter === "bonus" ? f.kind === "bonus" : f.category === catFilter));
  const nq = norm(q);
  if (!nq) return items.sort((a, b) => (b.favorite - a.favorite) || (b.n_visits - a.n_visits) || a.name.localeCompare(b.name, "de"));
  const words = nq.split(" ").filter(Boolean);
  const aliasCats = new Set();
  for (const w of words) for (const [k, cats] of Object.entries(SEARCH_ALIASES)) if (k === w || (w.length >= 4 && k.startsWith(w))) cats.forEach((c) => aliasCats.add(c));
  const scored = [];
  for (const f of items) {
    const n = norm(f.name), toks = n.split(" "), town = norm(f.town), cl = norm(f.category_label + " " + (f.tags || []).join(" "));
    let s = 0;
    if (n.startsWith(nq)) s += 100; else if (n.includes(nq)) s += 70;
    let miss = 0;
    for (const w of words) {
      if (toks.some((t) => t.startsWith(w))) s += 25;
      else if (n.includes(w)) s += 12;
      else if (town.startsWith(w)) s += 15;
      else if (cl.includes(w)) s += 10;
      else if (w.length >= 4 && toks.some((t) => lev(w, t.slice(0, w.length + 1)) <= (w.length >= 7 ? 2 : 1))) s += 8;
      else if (aliasCats.has(f.category)) s += 0;
      else miss++;
    }
    if (aliasCats.has(f.category)) s += 40;
    if (miss && !aliasCats.has(f.category)) s -= 40 * miss;
    if (s <= 0) continue;
    s += Math.min(f.n_visits, 10) * 1.5 + (f.favorite ? 5 : 0);
    scored.push([s, f]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

function highlight(name, q) {
  const t = q.trim();
  if (!t) return esc(name);
  const i = name.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return esc(name);
  return esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + t.length)) + "</mark>" + esc(name.slice(i + t.length));
}

export function facilityRow(f, q = "") {
  const right = f.kind === "bonus" ? `<span class="badge purple">${esc(f.discount_label || "Bonus")}</span>`
    : f.n_visits ? `<span class="badge green">${f.n_visits}×</span>` : (f.n_tariffs ? "" : `<span class="badge gray">kein Preis</span>`);
  return `<button class="item" data-fid="${f.id}">${catIcon(f.category)}<div class="grow"><div class="t ellipsis">${highlight(f.name, q)}${f.favorite ? ` <span style="color:#ff9f0a">★</span>` : ""}</div>
    <div class="s ellipsis">${esc(f.category_label)}${f.town ? " · " + esc(f.town) : ""}</div></div>${right}</button>`;
}

export async function openSearch(initial = "", initialCat = null) {
  const ov = document.createElement("div");
  ov.className = "search-overlay";
  ov.innerHTML = `<div class="so-head"><div class="row"><div class="search-field grow">${I.search(18)}
      <input type="search" placeholder="Was hast du besucht?" autocomplete="off" enterkeyhint="search" aria-label="Einrichtung suchen" value="${esc(initial)}"></div>
      <button class="cancel-btn">Abbrechen</button></div><div class="chips" style="margin-top:12px" id="so-chips"></div></div>
    <div class="so-body" id="so-body"><div class="center" style="padding:40px"><span class="spin"></span></div></div>`;
  document.getElementById("overlays").appendChild(ov);
  const input = ov.querySelector("input");
  setTimeout(() => input.focus(), 60);
  const close = () => ov.remove();
  ov.querySelector(".cancel-btn").onclick = close;
  let catF = initialCat;
  const list = await loadFacilities();
  const present = [...new Set(list.map((f) => (f.kind === "bonus" ? null : f.category)).filter(Boolean))];
  const chips = ov.querySelector("#so-chips");
  const renderChips = () => {
    chips.innerHTML = `<button class="chip ${!catF ? "on" : ""}" data-c="">Alle</button>` +
      Object.keys(CAT).filter((k) => present.includes(k)).map((k) => `<button class="chip ${catF === k ? "on" : ""}" data-c="${k}">${cat(k).e} ${esc(cat(k).l)}</button>`).join("") +
      `<button class="chip ${catF === "bonus" ? "on" : ""}" data-c="bonus">🎁 Bonuspartner</button>`;
  };
  chips.onclick = (e) => { const b = e.target.closest("[data-c]"); if (!b) return; catF = b.dataset.c || null; renderChips(); render(); };
  const body = ov.querySelector("#so-body");
  const render = () => {
    const q = input.value;
    const res = searchFacilities(q, list, catF);
    if (!q.trim() && !catF) {
      const fav = list.filter((f) => f.favorite);
      const recent = list.filter((f) => f.last_visit).sort((a, b) => b.last_visit.localeCompare(a.last_visit)).slice(0, 5);
      const sugg = ["Axamer Lizum", "Stubaier Gletscher", "Hallenbad", "Museum", "Eislaufplatz", "Bergbahn"];
      body.innerHTML = `<div class="chips" style="margin:4px -16px 18px">${sugg.map((s) => `<button class="chip" data-s="${esc(s)}">${I.search(14)} ${esc(s)}</button>`).join("")}</div>
        ${fav.length ? `<div class="section-head"><h2 style="font-size:18px">Favoriten</h2></div><div class="list">${fav.map((f) => facilityRow(f)).join("")}</div>` : ""}
        ${recent.length ? `<div class="section-head" style="margin-top:20px"><h2 style="font-size:18px">Zuletzt besucht</h2></div><div class="list">${recent.map((f) => facilityRow(f)).join("")}</div>` : ""}
        <div class="section-head" style="margin-top:20px"><h2 style="font-size:18px">Alle ${list.length} Einrichtungen</h2></div><div class="list">${res.slice(0, 200).map((f) => facilityRow(f)).join("")}</div>`;
    } else if (!res.length) {
      body.innerHTML = `<div class="empty"><div class="big">🔎</div>Keine Einrichtung gefunden.<br><span class="small">Tipp: Versuche „Schwimmbad“, „Museum“ oder den Ort.</span></div>`;
    } else {
      body.innerHTML = `<div class="list">${res.slice(0, 80).map((f) => facilityRow(f, q)).join("")}</div>`;
    }
  };
  renderChips();
  render();
  input.addEventListener("input", debounce(render, 80));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { const f = searchFacilities(input.value, list, catF)[0]; if (f) { close(); openVisitSheet({ facility: f }); } } });
  body.addEventListener("click", (e) => {
    const s = e.target.closest("[data-s]");
    if (s) { input.value = s.dataset.s; render(); return; }
    const b = e.target.closest("[data-fid]");
    if (!b) return;
    const f = list.find((x) => x.id === +b.dataset.fid);
    close();
    openVisitSheet({ facility: f });
  });
}

// ------------------------------------------------------------ Besuch erfassen / bearbeiten
const STATUS_BADGE = {
  verified: `<span class="badge green">${I.check(11)} Bestätigt</span>`,
  auto: `<span class="badge blue">Automatisch recherchiert</span>`,
  user: `<span class="badge purple">Von dir ergänzt</span>`,
};

export function openVisitSheet({ facility, visit = null, date = null, onDone = null }) {
  const st = {
    date: visit?.visit_date || date || todayISO(),
    ticket_type: visit?.ticket_type || null,
    tariff_id: visit?.tariff_id || null,
    regular: visit?.manual_price ? visit.regular_price : null,
    saving: visit?.manual_price && visit?.kind === "bonus" ? visit.saving : null,
    share: visit?.inclusion_share ?? 1,
    note: visit?.note || "",
    showAlt: false, editPrice: false, savePrice: true, q: null, loading: true, busy: false,
  };
  const clientId = uid();
  const isBonus = facility.kind === "bonus";
  const sheet = openSheet(`<div class="center" style="padding:40px"><span class="spin"></span></div>`);

  const loadQuote = async () => {
    st.loading = true;
    const p = new URLSearchParams({ date: st.date });
    if (st.ticket_type) p.set("ticket_type", st.ticket_type);
    if (st.tariff_id) p.set("tariff_id", st.tariff_id);
    if (st.regular != null && st.regular !== "") p.set("regular_price", st.regular);
    if (st.saving != null && st.saving !== "") p.set("saving", st.saving);
    if (st.share < 1) p.set("inclusion_share", st.share);
    if (visit) p.set("exclude_visit", visit.id);
    try {
      st.q = await api(`/api/facilities/${facility.id}/quote?${p}`);
      if (!st.ticket_type) st.ticket_type = st.q.ticket_type;
    } catch (e) {
      st.q = null;
      toast(e.message);
    }
    st.loading = false;
    render();
  };
  const reload = debounce(loadQuote, 250);

  const render = () => {
    const q = st.q;
    const rules = q?.special_rules || {};
    const badges = (isBonus ? `<span class="badge purple">Bonuspartner${facility.discount_label ? " · " + esc(facility.discount_label) : ""}</span>` : `<span class="badge green">Im Freizeitticket inkludiert</span>`)
      + (rules.special ? ` <span class="badge amber">Sonderregelung</span>` : "");
    const yest = addDays(todayISO(), -1);
    const types = q?.ticket_types || [];
    let priceHtml = "";
    if (!q) priceHtml = `<div class="price-card"><div class="center muted">Preis konnte nicht geladen werden.</div></div>`;
    else if (q.status === "unavailable" && (st.regular == null || st.regular === "")) {
      priceHtml = `<div class="price-card">
        <div class="row" style="gap:8px;margin-bottom:6px">${I.info(18)}<b>Kein regulärer Preis verfügbar</b></div>
        <p class="small muted" style="margin:0 0 12px">Für diese Einrichtung wurde noch kein offizieller Preis gefunden. Trage ein, was du ohne Freizeitticket bezahlt hättest – es werden niemals Preise geschätzt.</p>
        <label class="field"><span>Regulärer Preis</span><div class="input-group"><input class="input num" id="v-reg" inputmode="decimal" placeholder="z. B. 12,50"><span class="suffix">€</span></div></label>
        <label class="row small" style="gap:10px"><span class="toggle"><input type="checkbox" id="v-saveprice" ${st.savePrice ? "checked" : ""}><i></i></span>Preis für diese Einrichtung merken (für zukünftige Besuche)</label>
        ${q.warnings.filter((w) => !/Kein regulärer/.test(w)).map((w) => `<div class="warn">${I.warn()}<div>${esc(w)}</div></div>`).join("")}
      </div>`;
    } else {
      const t = q.tariff;
      const sav = q.saving;
      priceHtml = `<div class="price-card">
        <div class="small muted" style="font-weight:600">Deine Ersparnis</div>
        <div class="big-saving num">${sav == null ? "–" : "+" + esc(fmtEUR(sav))}</div>
        <div style="margin-top:12px">
          <div class="line"><span>Regulärer Preis</span><b>${esc(fmtEUR(q.regular_price))} <button class="link-btn" id="v-editprice" aria-label="Preis anpassen" style="margin-left:6px">${I.edit(15)}</button></b></div>
          ${isBonus ? `<div class="line"><span>Rabatt</span><b>${q.discount?.percent ? esc(q.discount.percent + " %") : q.discount?.amount ? esc(fmtEUR(q.discount.amount)) : esc(q.discount?.label || "–")}</b></div>
            <div class="line"><span>Du zahlst</span><b>${q.paid_price == null ? "–" : esc(fmtEUR(q.paid_price))}</b></div>`
            : `<div class="line"><span>Mit Freizeitticket</span><b>${esc(fmtEUR(q.paid_price ?? 0))}</b></div>`}
        </div>
        ${st.editPrice || (isBonus && sav == null) ? `<div style="margin-top:12px" class="stack">
          <label class="field" style="margin:0"><span>Regulärer Preis anpassen</span><div class="input-group"><input class="input num" id="v-reg" inputmode="decimal" value="${st.regular ?? q.regular_price ?? ""}"><span class="suffix">€</span></div></label>
          ${isBonus ? `<label class="field" style="margin:0"><span>Tatsächliche Ersparnis</span><div class="input-group"><input class="input num" id="v-sav" inputmode="decimal" value="${st.saving ?? sav ?? ""}" placeholder="z. B. 6,00"><span class="suffix">€</span></div></label>` : ""}
          ${st.regular != null ? `<button class="link-btn" id="v-resetprice">Automatischen Preis verwenden</button>` : ""}</div>` : ""}
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:6px">${t ? STATUS_BADGE[t.status] || "" : q.status === "manual" ? `<span class="badge gray">Manuell</span>` : ""}
          ${q.status === "uncertain" ? `<span class="badge amber">Bitte prüfen</span>` : ""}${q.possibly_outdated ? `<span class="badge amber">Möglicherweise veraltet</span>` : ""}</div>
        ${t ? `<div class="small" style="margin-top:8px"><b>${esc(t.label)}</b></div>` : ""}
        ${q.warnings.map((w) => `<div class="warn">${I.warn()}<div>${esc(w)}</div></div>`).join("")}
        <details class="explain"><summary>Wie wurde der Preis ermittelt?</summary><ul>${q.explanation.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
          ${t?.source_url ? `<div style="margin-top:8px">${I.link(13)} <a href="${esc(t.source_url)}" target="_blank" rel="noopener noreferrer">Quelle öffnen</a>${t.last_confirmed_at ? ` · zuletzt bestätigt ${esc(fmtDate(t.last_confirmed_at.slice(0, 10)))}` : ""}</div>` : ""}
          ${t?.source_snippet ? `<div class="tiny muted" style="margin-top:6px;font-style:italic">„${esc(t.source_snippet.slice(0, 220))}“</div>` : ""}</details>
        ${q.alternatives.length > 1 ? `<button class="link-btn" id="v-alt" style="margin-top:12px">${st.showAlt ? "Tarifliste ausblenden" : `Anderen Tarif wählen (${q.alternatives.length})`}</button>
          ${st.showAlt ? `<div style="margin-top:6px">${q.alternatives.map((a) => `<button class="tariff-pick ${t && a.id === t.id ? "on" : ""}" data-tid="${a.id}"><span>${esc(a.label)}${a.day_type !== "alle" ? ` <span class="badge gray">${esc(a.day_type)}</span>` : ""}</span><b class="num">${esc(fmtEUR(a.price))}</b></button>`).join("")}</div>` : ""}` : ""}
        ${!isBonus ? `<label class="row small" style="gap:10px;margin-top:14px"><span class="toggle"><input type="checkbox" id="v-partial" ${st.share < 1 ? "checked" : ""}><i></i></span>Nur teilweise im Freizeitticket inkludiert</label>
          ${st.share < 1 ? `<label class="field" style="margin:10px 0 0"><span>Inkludierter Anteil</span><div class="input-group"><input class="input num" id="v-share" inputmode="numeric" value="${Math.round(st.share * 100)}"><span class="suffix">%</span></div></label>` : ""}` : ""}
      </div>`;
    }
    const canSave = q && (q.saving != null || (st.regular != null && st.regular !== "")) && !st.busy;
    sheet.set(`
      <div class="sheet-title">${catIcon(facility.category, 52)}<div class="grow"><h2>${esc(facility.name)}</h2>
        <div class="small muted">${esc(facility.category_label || cat(facility.category).l)}${facility.town ? " · " + esc(facility.town) : ""}</div>
        <div style="margin-top:6px">${badges}</div></div>
        <button class="close-x" id="v-close" aria-label="Schließen">${I.close()}</button></div>
      <div class="field"><span>Besuchsdatum</span><div class="seg">
        <button data-d="${todayISO()}" class="${st.date === todayISO() ? "on" : ""}">Heute</button>
        <button data-d="${yest}" class="${st.date === yest ? "on" : ""}">Gestern</button>
        <button id="v-date-btn" class="${st.date !== todayISO() && st.date !== yest ? "on" : ""}">${st.date !== todayISO() && st.date !== yest ? esc(relDate(st.date)) : `${I.calendar(14)} Datum`}</button></div>
        <input type="date" id="v-date" class="input" style="margin-top:8px;${st.date !== todayISO() && st.date !== yest ? "" : "display:none"}" value="${st.date}" max="${todayISO()}"></div>
      ${q && !q.has_season ? `<div class="warn" style="margin-bottom:12px">${I.warn()}<div>Für die Saison ${esc(seasonLabel(q.season_id))} ist noch kein Freizeitticket in deinem Profil hinterlegt.</div></div>` : ""}
      ${q?.duplicates?.length && !visit ? `<div class="warn info" style="margin-bottom:12px">${I.info()}<div>Du hast hier an diesem Tag bereits ${q.duplicates.length} Besuch${q.duplicates.length > 1 ? "e" : ""} erfasst.</div></div>` : ""}
      ${types.length > 1 ? `<div class="field"><span>Ticketart</span><div class="seg">${types.map((t) => `<button data-tt="${t.key}" class="${st.ticket_type === t.key ? "on" : ""}">${esc(t.label)}</button>`).join("")}</div></div>` : ""}
      ${st.loading && !q ? `<div class="skeleton" style="height:180px"></div>` : priceHtml}
      <label class="field" style="margin-top:14px"><span>Notiz (optional)</span><textarea class="input" id="v-note" maxlength="1000" placeholder="z. B. Pulverschnee, mit Freunden …">${esc(st.note)}</textarea></label>
      <button class="btn primary block" id="v-save" ${canSave ? "" : "disabled"}>${st.busy ? `<span class="spin" style="border-top-color:#fff"></span>` : visit ? "Änderungen speichern" : `Besuch speichern${q?.saving != null ? " · +" + esc(fmtEUR(q.saving)) : ""}`}</button>
      <div class="row" style="justify-content:center;gap:22px;margin-top:14px">
        <button class="link-btn" id="v-info">Details & Preise</button>
        ${visit ? `<button class="link-btn" id="v-del" style="color:var(--red)">Besuch löschen</button>` : ""}</div>`);
    bind();
  };

  const bind = () => {
    const b = sheet.body;
    b.querySelector("#v-close").onclick = () => sheet.close();
    b.querySelectorAll("[data-d]").forEach((x) => (x.onclick = () => { st.date = x.dataset.d; st.tariff_id = null; render(); loadQuote(); }));
    const di = b.querySelector("#v-date");
    b.querySelector("#v-date-btn").onclick = () => { di.style.display = ""; di.showPicker ? di.showPicker() : di.focus(); };
    di.onchange = () => { if (di.value) { st.date = di.value > todayISO() ? todayISO() : di.value; st.tariff_id = null; loadQuote(); } };
    b.querySelectorAll("[data-tt]").forEach((x) => (x.onclick = () => { st.ticket_type = x.dataset.tt; st.tariff_id = null; loadQuote(); }));
    b.querySelectorAll("[data-tid]").forEach((x) => (x.onclick = () => { st.tariff_id = +x.dataset.tid; st.regular = null; loadQuote(); }));
    const alt = b.querySelector("#v-alt"); if (alt) alt.onclick = () => { st.showAlt = !st.showAlt; render(); };
    const ep = b.querySelector("#v-editprice"); if (ep) ep.onclick = () => { st.editPrice = !st.editPrice; render(); };
    const rp = b.querySelector("#v-resetprice"); if (rp) rp.onclick = () => { st.regular = null; st.saving = null; st.editPrice = false; loadQuote(); };
    const reg = b.querySelector("#v-reg");
    if (reg) reg.oninput = () => { st.regular = reg.value.replace(",", ".").trim() || null; updateSaveState(); reload(); };
    const sv = b.querySelector("#v-sav"); if (sv) sv.oninput = () => { st.saving = sv.value.replace(",", ".").trim() || null; reload(); };
    const sp = b.querySelector("#v-saveprice"); if (sp) sp.onchange = () => (st.savePrice = sp.checked);
    const pa = b.querySelector("#v-partial"); if (pa) pa.onchange = () => { st.share = pa.checked ? 0.5 : 1; loadQuote(); };
    const sh = b.querySelector("#v-share"); if (sh) sh.oninput = () => { const v = Math.max(0, Math.min(100, +sh.value || 0)); st.share = v / 100; reload(); };
    b.querySelector("#v-note").oninput = (e) => (st.note = e.target.value);
    b.querySelector("#v-save").onclick = save;
    b.querySelector("#v-info").onclick = () => openFacility(facility.id);
    const del = b.querySelector("#v-del");
    if (del) del.onclick = async () => {
      if (!(await confirmDlg("Besuch löschen?", `${facility.name} am ${fmtDate(visit.visit_date)} wird entfernt.`, "Löschen", true))) return;
      try { await api(`/api/visits/${visit.id}`, { method: "DELETE" }); toast("Besuch gelöscht"); sheet.close(); done(); }
      catch (e) { toast(e.message); }
    };
  };
  const updateSaveState = () => {
    const btn = sheet.body.querySelector("#v-save");
    if (btn) btn.disabled = !(st.q && (st.q.saving != null || (st.regular != null && st.regular !== "")));
  };

  const done = (v) => { invalidate(); onDone ? onDone(v) : S.rerender && S.rerender(); };

  const save = async (allowDup = false) => {
    if (st.busy) return;
    const body = {
      facility_id: facility.id, visit_date: st.date, ticket_type: st.ticket_type, tariff_id: st.tariff_id,
      inclusion_share: st.share, note: st.note, client_id: clientId, allow_duplicate: allowDup === true,
    };
    if (st.regular != null && st.regular !== "") body.regular_price = st.regular;
    if (st.saving != null && st.saving !== "") body.saving = st.saving;
    if (visit && st.regular == null) body.reset_price = true;
    st.busy = true; render();
    try {
      const unavailable = st.q?.status === "unavailable" || (st.q && !st.q.tariff);
      const v = visit ? await api(`/api/visits/${visit.id}`, { method: "PUT", body }) : await api("/api/visits", { method: "POST", body });
      if (!visit && unavailable && st.savePrice && body.regular_price) {
        api(`/api/facilities/${facility.id}/tariffs`, { method: "POST", body: { price: body.regular_price, label: "Von dir ergänzt", ticket_type: st.ticket_type, age_group: "alle" } }).catch(() => {});
      }
      // kurzes Erfolgs-Feedback im Button, dann schließen
      const btn = sheet.body.querySelector("#v-save");
      if (btn) { btn.classList.add("saved"); btn.innerHTML = `${I.check(22)} Gespeichert`; }
      haptic(15);
      await new Promise((r) => setTimeout(r, 520));
      sheet.close();
      toast(visit ? "Besuch aktualisiert" : `+${fmtEUR(v.saving)} gespart`);
      if (v.amortized_now) {
        confetti();
        setTimeout(() => dialog({ title: "🎉 Ticket amortisiert!", text: `Mit diesem Besuch hat sich dein Freizeitticket bezahlt gemacht. Ab jetzt ist jeder Besuch reiner Gewinn.`, buttons: [{ label: "Wie cool!", value: true, cls: "primary" }] }), 600);
      }
      refreshUser().catch(() => {});
      done(v);
    } catch (e) {
      st.busy = false;
      if (e.code === "duplicate") {
        render();
        const ok = await dialog({ title: "Bereits erfasst", text: `${facility.name} ist am ${fmtDate(st.date)} schon eingetragen. Möchtest du einen weiteren Besuch am selben Tag speichern?`,
          buttons: [{ label: "Weiteren Besuch speichern", value: true, cls: "primary" }, { label: "Abbrechen", value: false }] });
        if (ok) save(true);
      } else if (e.code === "no_season") {
        render();
        const ok = await dialog({ title: "Saison fehlt", text: e.message + ". Möchtest du die Saison im Profil anlegen?", buttons: [{ label: "Zum Profil", value: true, cls: "primary" }, { label: "Abbrechen", value: false }] });
        if (ok) { sheet.close(); go("#/profile"); }
      } else { render(); toast(e.message); }
    }
  };

  loadQuote();
  return sheet;
}

// ------------------------------------------------------------ Einrichtungsdetails
const TT_ORDER = ["tageskarte", "halbtag", "stundenkarte", "einzeleintritt", "berg_tal", "bergfahrt", "abend", "sonstiges"];
const AGE_LABEL = { kind: "Kinder", jugend: "Jugend", u23: "U23", student: "Studierende", erwachsene: "Erwachsene", senior: "Senioren", alle: "Alle", unbekannt: "ohne Angabe", ermaessigt: "Ermäßigt" };

function ageText(t) {
  if (t.birth_year_from || t.birth_year_to) return t.birth_year_from && t.birth_year_to ? `Jg. ${t.birth_year_from}–${t.birth_year_to}` : t.birth_year_from ? `Jg. ${t.birth_year_from} u. jünger` : `Jg. ${t.birth_year_to} u. älter`;
  if (t.age_min != null || t.age_max != null) return t.age_min != null && t.age_max != null ? `${t.age_min}–${t.age_max} J.` : t.age_min != null ? `ab ${t.age_min} J.` : `bis ${t.age_max} J.`;
  return "";
}

export async function openFacility(id) {
  const sheet = openSheet(`<div class="center" style="padding:40px"><span class="spin"></span></div>`);
  let f;
  const load = async () => { f = await api(`/api/facilities/${id}`); render(); };
  const render = () => {
    const groups = {};
    f.tariffs.forEach((t) => (groups[t.ticket_type] = groups[t.ticket_type] || []).push(t));
    const tt = Object.keys(groups).sort((a, b) => TT_ORDER.indexOf(a) - TT_ORDER.indexOf(b));
    const rules = f.special_rules || {};
    const statusTxt = { ok: ["green", "Preise aktuell"], pending: ["gray", "Noch nicht geprüft"], not_found: ["amber", "Keine Preise gefunden"],
      unreachable: ["red", "Website nicht erreichbar"], blocked: ["red", "Automatischer Abruf gesperrt"], stale: ["amber", "Möglicherweise veraltet"] }[f.price_status] || ["gray", f.price_status];
    sheet.set(`
      <div class="sheet-title">${catIcon(f.category, 52)}<div class="grow"><h2>${esc(f.name)}</h2>
        <div class="small muted">${esc(f.category_label)}${f.town ? " · " + esc(f.town) : ""}</div></div>
        <button class="close-x" id="f-fav" aria-label="Favorit" style="color:${f.favorite ? "#ff9f0a" : "var(--text-2)"}">${I.star(17, f.favorite)}</button>
        <button class="close-x" id="f-close" aria-label="Schließen">${I.close()}</button></div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${f.kind === "bonus" ? `<span class="badge purple">Bonuspartner · ${esc(f.discount_label || "Rabatt")}</span>` : `<span class="badge green">Inkludiert</span>`}
        ${rules.special ? `<span class="badge amber">Sonderregelung</span>` : ""}${f.status === "archived" ? `<span class="badge red">Nicht mehr im Angebot</span>` : ""}
        ${(f.tag_labels || []).map((t) => `<span class="badge gray">${esc(t)}</span>`).join("")}</div>
      <div class="card"><div class="row between"><div><div class="small muted">Deine Nutzung</div><div style="font-size:22px;font-weight:800" class="num">${f.usage.visits}× · ${esc(fmtEUR(f.usage.saving))}</div>
        ${f.usage.last ? `<div class="small muted">Zuletzt ${esc(fmtDate(f.usage.last))}</div>` : ""}</div><button class="btn primary small" id="f-add">${I.plus(16)} Besuch</button></div></div>
      ${f.kind === "bonus" || f.conditions || rules.note ? `<div class="card"><h3 style="font-size:17px">Freizeitticket-Konditionen</h3>
        ${rules.note ? `<p class="small" style="margin:0 0 8px"><b>Sonderregelung:</b> ${esc(rules.note)}</p>` : ""}
        ${rules.max_entries ? `<p class="small" style="margin:0 0 8px">Inkludierte Zutritte pro Saison: <b>${rules.max_entries}</b></p>` : ""}
        ${f.conditions ? `<p class="small muted" style="margin:0">${esc(f.conditions)}</p>` : ""}
        ${rules.weekdays ? `<p class="small" style="margin:8px 0 0">Gültig: ${rules.weekdays.map((d) => ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][d]).join(", ")}</p>` : ""}
        ${rules.valid_from ? `<p class="small" style="margin:8px 0 0">Aktionszeitraum: ${esc(fmtDate(rules.valid_from))} – ${esc(fmtDate(rules.valid_to))}${rules.approximate_dates ? " (ca.)" : ""}</p>` : ""}
        ${rules.code ? `<p class="small" style="margin:8px 0 0">Code: <b>${esc(rules.code)}</b></p>` : ""}</div>` : ""}
      <div class="card"><div class="row between" style="margin-bottom:10px"><h3 style="margin:0;font-size:17px">Reguläre Preise</h3><span class="badge ${statusTxt[0]}">${esc(statusTxt[1])}</span></div>
        ${tt.length ? tt.map((k) => `<div class="small muted" style="font-weight:700;margin:12px 0 2px;text-transform:uppercase;letter-spacing:.05em">${esc(S.ticketTypes[k] || k)}</div>
          <table class="tariffs">${groups[k].map((t) => `<tr><td><div>${esc(t.label)}</div><div class="tiny muted">${esc(AGE_LABEL[t.age_group] || t.age_group)}${ageText(t) ? " · " + esc(ageText(t)) : ""}${t.day_type !== "alle" ? " · " + esc(t.day_type) : ""}${t.season_type !== "alle" ? " · " + (t.season_type === "haupt" ? "Hauptsaison" : "Nebensaison") : ""}
            · ${t.status === "verified" ? "bestätigt" : t.status === "user" ? "ergänzt" : `automatisch (${Math.round((t.confidence || 0) * 100)} %)`}${t.outdated ? " · <span style='color:var(--amber)'>veraltet?</span>" : ""}
            ${t.source_url ? ` · <a href="${esc(t.source_url)}" target="_blank" rel="noopener noreferrer">Quelle</a>` : ""}</div>
            ${t.note ? `<div class="tiny" style="color:var(--amber)">${esc(t.note)}</div>` : ""}
            ${t.status === "auto" ? `<div class="row" style="gap:14px;margin-top:4px"><button class="link-btn tiny" data-verify="${t.id}">✓ Bestätigen</button><button class="link-btn tiny" style="color:var(--red)" data-reject="${t.id}">✕ Verwerfen</button></div>` : ""}</td>
            <td class="p">${esc(fmtEUR(t.price))}</td></tr>`).join("")}</table>`).join("")
          : `<div class="empty small">Keine regulären Preise verfügbar. Es werden keine Preise geschätzt – du kannst den Preis unten selbst ergänzen.</div>`}
        <div class="tiny muted" style="margin-top:10px">${f.price_checked_at ? `Letzte Prüfung: ${esc(fmtDate(f.price_checked_at.slice(0, 10)))} · ${esc(f.price_check_message || "")}` : "Noch nicht geprüft"}</div>
        <div class="tiny muted" style="margin-top:4px">Die Preise werden jeden Montag automatisch neu recherchiert.</div>
        <div class="row" style="gap:10px;margin-top:12px;flex-wrap:wrap">
          <button class="btn small" id="f-addprice">${I.plus(16)} Preis ergänzen</button></div>
        <div id="f-form"></div></div>
      ${f.history.length ? `<details class="card"><summary style="font-weight:700;cursor:pointer">Preisverlauf & Archiv (${f.history.length})</summary>
        <table class="tariffs" style="margin-top:10px">${f.history.map((t) => `<tr><td><div>${esc(t.label)}</div><div class="tiny muted">${esc(t.archive_reason || "")} · ${esc(fmtDate((t.archived_at || "").slice(0, 10)))}</div></td><td class="p muted">${esc(fmtEUR(t.price))}</td></tr>`).join("")}</table></details>` : ""}
      <div class="card"><h3 style="font-size:17px">Informationen</h3><dl class="kv">
        ${f.address ? `<dt>${I.pin(14)} Adresse</dt><dd>${esc(f.address)}</dd>` : ""}
        ${f.website ? `<dt>${I.globe(14)} Website</dt><dd><a href="${esc(f.website)}" target="_blank" rel="noopener noreferrer">${esc(f.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 34))}</a></dd>` : ""}
        ${f.phone ? `<dt>${I.phone(14)} Telefon</dt><dd><a href="tel:${esc(f.phone.replace(/[^\d+]/g, ""))}">${esc(f.phone)}</a></dd>` : ""}
        ${f.hours_url ? `<dt>${I.clock(14)} Öffnungszeiten</dt><dd><a href="${esc(f.hours_url)}" target="_blank" rel="noopener noreferrer">ansehen</a></dd>` : ""}
        <dt>Quelle</dt><dd><a href="${esc(f.source_url)}" target="_blank" rel="noopener noreferrer">freizeitticket.at</a></dd>
        <dt>Aktualisiert</dt><dd>${esc(fmtDate((f.last_seen || f.updated_at || "").slice(0, 10)))}</dd></dl>
        ${f.description ? `<p class="small muted" style="margin:14px 0 0;white-space:pre-line">${esc(f.description)}</p>` : ""}</div>`);
    const b = sheet.body;
    b.querySelector("#f-close").onclick = () => sheet.close();
    b.querySelector("#f-add").onclick = () => { sheet.close(); openVisitSheet({ facility: f }); };
    b.querySelector("#f-fav").onclick = async () => { const r = await api(`/api/facilities/${f.id}/favorite`, { method: "POST" }); f.favorite = r.favorite; invalidate(); render(); toast(r.favorite ? "Zu Favoriten hinzugefügt" : "Aus Favoriten entfernt"); };
    b.querySelector("#f-addprice").onclick = () => {
      b.querySelector("#f-form").innerHTML = `<div style="margin-top:14px">
        <label class="field"><span>Bezeichnung</span><input class="input" id="np-label" placeholder="z. B. Tageskarte Erwachsene"></label>
        <div class="row" style="gap:10px"><label class="field grow"><span>Ticketart</span><select class="input" id="np-tt">${Object.entries(S.ticketTypes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
          <label class="field grow"><span>Altersgruppe</span><select class="input" id="np-ag">${["erwachsene", "jugend", "kind", "senior", "student", "alle"].map((k) => `<option value="${k}">${AGE_LABEL[k]}</option>`).join("")}</select></label></div>
        <div class="row" style="gap:10px"><label class="field grow"><span>Alter von</span><input class="input" id="np-amin" inputmode="numeric" placeholder="optional"></label>
          <label class="field grow"><span>Alter bis</span><input class="input" id="np-amax" inputmode="numeric" placeholder="optional"></label></div>
        <label class="field"><span>Preis</span><div class="input-group"><input class="input num" id="np-price" inputmode="decimal" placeholder="0,00"><span class="suffix">€</span></div></label>
        <label class="field"><span>Quelle (optional)</span><input class="input" id="np-src" type="url" placeholder="https://…"></label>
        <button class="btn primary block" id="np-save">Preis speichern</button></div>`;
      const tt0 = tt[0] || null; if (tt0) b.querySelector("#np-tt").value = tt0;
      b.querySelector("#np-save").onclick = async () => {
        try {
          await api(`/api/facilities/${f.id}/tariffs`, { method: "POST", body: {
            label: b.querySelector("#np-label").value, ticket_type: b.querySelector("#np-tt").value, age_group: b.querySelector("#np-ag").value,
            age_min: b.querySelector("#np-amin").value, age_max: b.querySelector("#np-amax").value,
            price: b.querySelector("#np-price").value, source_url: b.querySelector("#np-src").value } });
          toast("Preis gespeichert"); invalidate(); load();
        } catch (err) { toast(err.message); }
      };
    };
    b.querySelectorAll("[data-verify]").forEach((x) => (x.onclick = async () => { await api(`/api/tariffs/${x.dataset.verify}/verify`, { method: "POST", body: {} }); toast("Preis bestätigt"); load(); }));
    b.querySelectorAll("[data-reject]").forEach((x) => (x.onclick = async () => { await api(`/api/tariffs/${x.dataset.reject}`, { method: "DELETE", body: {} }); toast("Preis verworfen"); load(); }));
  };
  try { await load(); } catch (e) { sheet.set(`<div class="empty">${esc(e.message)}</div>`); }
  return sheet;
}
