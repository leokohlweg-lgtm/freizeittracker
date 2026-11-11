// Startseite: Gesamtersparnis, Kennzahlen, letzte Aktivitäten, Suche
import { api } from "../api.js";
import { S, activeSeason, go, loadFacilities } from "../state.js";
import { ring, animateRings } from "../charts.js";
import { openSearch, openVisitSheet } from "../sheets.js";
import { esc, fmtEUR, fmtNum, fmtSigned, fmtDate, relDate, catIcon, I, countUp, seasonLabel, CAT, cat, store } from "../util.js";

export function visitRow(v) {
  return `<button class="item" data-vid="${v.id}">${catIcon(v.category)}<div class="grow"><div class="t ellipsis">${esc(v.facility_name)}</div>
    <div class="s ellipsis">${esc(relDate(v.visit_date))} · ${esc(v.ticket_label)}${v.kind === "bonus" ? " · Bonus" : ""}${v.note ? " · " + esc(v.note) : ""}</div></div>
    <div class="amt pos num">+${esc(fmtEUR(v.saving))}</div></button>`;
}

export async function renderHome(root) {
  const sid = activeSeason();
  const u = S.user;
  root.innerHTML = `<div class="view with-dock"><div class="topbar"><div class="greeting">${greet()}<b>${esc(u.first_name)}</b></div>
    <button class="avatar" id="h-av" aria-label="Profil">${esc((u.first_name[0] || "") + (u.last_name[0] || ""))}</button></div>
    <div class="skeleton" style="height:250px;border-radius:28px"></div><div class="kpis">${'<div class="skeleton" style="height:86px"></div>'.repeat(4)}</div></div>`;
  root.querySelector("#h-av").onclick = () => go("#/profile");
  let st;
  try { st = await api(`/api/stats?season=${sid}`); }
  catch (e) { root.querySelector(".view").insertAdjacentHTML("beforeend", `<div class="empty">${esc(e.message)}</div>`); return; }
  const amort = !!st.amortized_on;
  const pct = Math.round(st.progress_raw * 100);
  const isCurrent = st.season.id === sid;
  root.innerHTML = `<div class="view with-dock">
    <div class="topbar"><div class="greeting">${greet()}<b>${esc(u.first_name)}</b></div>
      <div class="row"><button class="chip" id="h-season" aria-label="Saison wechseln">${I.calendar(15)} ${esc(st.season.label)}</button>
      <button class="avatar" id="h-av" aria-label="Profil">${esc((u.first_name[0] || "") + (u.last_name[0] || ""))}</button></div></div>
    ${st.__offline ? `<div class="warn" style="margin-bottom:12px">${I.warn()}<div>Offline – angezeigt werden die zuletzt synchronisierten Daten.</div></div>` : ""}
    <section class="hero" aria-label="Deine Gesamtersparnis">
      <div class="hero-bg" aria-hidden="true"></div>
      <div class="hero-row"><div class="grow">
        <div class="label">Deine Gesamtersparnis</div>
        <div class="amount num"><span id="h-amt">0,00</span><span class="cur">€</span></div>
        <div class="sub">Bruttoersparnis · ${st.visits} Besuch${st.visits === 1 ? "" : "e"} · Saison ${esc(st.season.label)}</div>
        ${amort ? `<div class="badge-amort">🎉 Amortisiert am ${esc(fmtDate(st.amortized_on))}</div>` : ""}
      </div>
      <div class="ring-wrap ${amort ? "done" : ""}">${ring(st.progress_raw)}<div class="ring-label"><div>${pct}%<small>AMORTISIERT</small></div></div></div></div>
      <div class="bar"><i id="h-bar"></i></div>
      <div class="bar-legend"><span>0 €</span><span>Ticketpreis ${esc(fmtEUR(st.purchase_price, true))}</span></div>
    </section>
    <div class="kpis">
      <div class="kpi"><div class="k">Bezahlter Ticketpreis</div><div class="v num">${esc(fmtEUR(st.purchase_price))}</div><div class="h">${esc(catLabel(st))}</div></div>
      <div class="kpi"><div class="k">Nettovorteil</div><div class="v num ${st.net >= 0 ? "pos" : "neg"}">${esc(fmtSigned(st.net))}</div><div class="h">Ersparnis − Ticketpreis</div></div>
      <div class="kpi"><div class="k">Besuche</div><div class="v num">${st.visits}</div><div class="h">${st.highlights.distinct_facilities || 0} verschiedene Orte</div></div>
      <div class="kpi"><div class="k">Ø Ersparnis pro Besuch</div><div class="v num">${esc(fmtEUR(st.avg))}</div><div class="h">${st.visits ? "über alle Besuche" : "noch keine Besuche"}</div></div>
      <div class="kpi wide"><div class="row between"><div><div class="k">${amort ? "Gewinn seit Amortisation" : "Noch bis zur Gewinnschwelle"}</div>
        <div class="v num ${amort ? "pos" : ""}">${amort ? esc(fmtSigned(st.net)) : esc(fmtEUR(st.remaining))}</div></div>
        <div class="h" style="text-align:right">${amort ? `nach ${st.amortized_after_visits} Besuchen<br>(${st.amortized_after_days} Tage)` : st.visits_to_break_even ? `ca. ${st.visits_to_break_even} weitere Besuche<br>bei Ø ${esc(fmtEUR(st.avg, true))}` : "Erfasse deinen<br>ersten Besuch"}</div></div>
        <div class="mini-bar"><i style="width:${Math.min(100, pct)}%"></i></div></div>
    </div>
    <div class="quick">
      <button id="q-map"><span class="qi" style="background:var(--blue-soft);color:var(--blue)">${I.map(20)}</span>Karte</button>
      <button id="q-hl"><span class="qi" style="background:var(--amber-soft);color:var(--amber)">${I.trophy(20)}</span>Highlights</button>
      <button id="q-wr"><span class="qi" style="background:var(--purple-soft);color:var(--purple)">${I.sparkle(20)}</span>Rückblick</button>
    </div>
    <div class="section"><div class="section-head"><h2>Letzte Aktivitäten</h2>${st.visits ? `<a href="#/visits">Alle</a>` : ""}</div>
      ${st.recent.length ? `<div class="list" id="h-recent">${st.recent.map(visitRow).join("")}</div>`
        : `<div class="card empty"><div class="big">🎿</div><b>Noch keine Besuche</b><br><span class="small">Tippe unten auf „Was hast du besucht?“ und erfasse deinen ersten Besuch.</span></div>`}
    </div>
    ${st.projection > st.gross && isCurrent ? `<div class="card" style="margin-top:14px"><div class="row" style="gap:14px"><span style="font-size:28px">📈</span><div class="grow">
      <div class="small muted" style="font-weight:600">Prognose bis Saisonende</div><div style="font-weight:800;font-size:20px" class="num">${esc(fmtEUR(st.projection, true))} Ersparnis</div>
      <div class="tiny muted">Bei gleichbleibendem Tempo · noch ${st.days_left} Tage</div></div></div></div>` : ""}
  </div>
  <div class="dock"><div class="dock-inner">
    <div class="chips" style="margin:0 -16px 10px" id="h-cats"></div>
    <button class="searchbar" id="h-search">${I.search(20)}<span class="ph">Was hast du besucht?</span><span class="plus">${I.plus(18)}</span></button>
  </div></div>`;
  // von der zuletzt gesehenen Ersparnis hochzählen (nach einem neuen Besuch sieht man den Zuwachs)
  const seenKey = "seen-gross:" + st.season.id;
  const prev = store.get(seenKey, 0);
  countUp(root.querySelector("#h-amt"), st.gross, { from: prev > st.gross ? 0 : prev, dur: prev && prev !== st.gross ? 1400 : 1100 });
  store.set(seenKey, st.gross);
  animateRings(root);
  requestAnimationFrame(() => setTimeout(() => (root.querySelector("#h-bar").style.width = Math.min(100, pct) + "%"), 40));
  root.querySelector("#h-av").onclick = () => go("#/profile");
  root.querySelector("#h-season").onclick = () => go("#/profile");
  root.querySelector("#h-search").onclick = () => openSearch();
  root.querySelector("#q-map").onclick = () => go("#/map");
  root.querySelector("#q-hl").onclick = () => go("#/stats/highlights");
  root.querySelector("#q-wr").onclick = () => go(`#/wrapped/${st.season.id}`);
  const rec = root.querySelector("#h-recent");
  if (rec) rec.onclick = (e) => {
    const b = e.target.closest("[data-vid]");
    if (!b) return;
    const v = st.recent.find((x) => x.id === +b.dataset.vid);
    openVisitSheet({ facility: { id: v.facility_id, name: v.facility_name, category: v.category, kind: v.kind, town: v.town }, visit: v });
  };
  // Kategorie-Schnellfilter über der Suche
  loadFacilities().then((list) => {
    const present = new Set(list.map((f) => f.category));
    const order = ["ski", "hallenbad", "freibad", "badesee", "eislaufen", "museum", "sehenswert", "bergbahn", "rodeln", "sauna", "sport"];
    const box = root.querySelector("#h-cats");
    if (!box) return;
    box.innerHTML = order.filter((k) => present.has(k)).map((k) => `<button class="chip" data-c="${k}">${cat(k).e} ${esc(cat(k).l.split(" ")[0])}</button>`).join("")
      + `<button class="chip" data-c="bonus">🎁 Bonus</button>`;
    box.onclick = (e) => { const b = e.target.closest("[data-c]"); if (b) openSearch("", b.dataset.c); };
  }).catch(() => {});
}

function catLabel(st) {
  const s = (S.user.seasons || []).find((x) => x.season_id === st.season.id);
  return s?.category_label ? `Kategorie ${s.category_label}` : "";
}

function greet() {
  const h = new Date().getHours();
  return h < 11 ? "Guten Morgen," : h < 18 ? "Servus," : "Guten Abend,";
}
