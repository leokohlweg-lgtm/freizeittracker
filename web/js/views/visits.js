// Besuchsliste: nach Monaten gruppiert, filterbar, bearbeiten/löschen
import { api } from "../api.js";
import { S, activeSeason } from "../state.js";
import { openSearch, openVisitSheet } from "../sheets.js";
import { visitRow } from "./home.js";
import { esc, fmtEUR, fmtMonth, norm, I, cat, debounce, store } from "../util.js";

export async function renderVisits(root) {
  const seasons = S.user.seasons;
  let sid = store.get("visits:season", activeSeason());
  if (sid !== "all" && !seasons.some((s) => s.season_id === sid)) sid = activeSeason();
  let filter = null, q = "";
  root.innerHTML = `<div class="view"><div class="topbar"><div><div class="eyebrow">Freizeitticket</div><h1>Besuche</h1></div>
    <button class="round-btn" id="vi-add" aria-label="Besuch hinzufügen" style="background:var(--green-2);color:#fff">${I.plus(20)}</button></div>
    <div id="vi-body"><div class="skeleton" style="height:300px"></div></div></div>`;
  root.querySelector("#vi-add").onclick = () => openSearch();
  let visits = [];
  const load = async () => {
    const r = await api(`/api/visits?season=${sid}`);
    visits = r.visits;
    render();
  };
  const render = () => {
    const nq = norm(q);
    const list = visits.filter((v) => (!filter || (filter === "bonus" ? v.kind === "bonus" : v.category === filter)) &&
      (!nq || norm(v.facility_name + " " + (v.note || "") + " " + (v.town || "")).includes(nq)));
    const cats = [...new Set(visits.map((v) => v.category))];
    const total = list.reduce((s, v) => s + v.saving, 0);
    const groups = {};
    list.forEach((v) => (groups[v.visit_date.slice(0, 7)] = groups[v.visit_date.slice(0, 7)] || []).push(v));
    const body = root.querySelector("#vi-body");
    body.innerHTML = `
      ${seasons.length > 1 ? `<div class="seg" style="margin-bottom:12px">${seasons.map((s) => `<button data-s="${s.season_id}" class="${sid === s.season_id ? "on" : ""}">${esc(s.label)}</button>`).join("")}
        <button data-s="all" class="${sid === "all" ? "on" : ""}">Alle</button></div>` : ""}
      <div class="search-field" style="margin-bottom:12px">${I.search(18)}<input type="search" id="vi-q" placeholder="Besuche durchsuchen" value="${esc(q)}" aria-label="Besuche durchsuchen"></div>
      ${cats.length > 1 ? `<div class="chips" style="margin-bottom:6px"><button class="chip ${!filter ? "on" : ""}" data-c="">Alle</button>
        ${cats.map((c) => `<button class="chip ${filter === c ? "on" : ""}" data-c="${c}">${cat(c).e} ${esc(cat(c).l)}</button>`).join("")}</div>` : ""}
      <div class="card row between" style="margin:12px 0 4px"><div><div class="small muted" style="font-weight:600">${list.length} Besuch${list.length === 1 ? "" : "e"}</div>
        <div style="font-size:24px;font-weight:800" class="num pos">+${esc(fmtEUR(total))}</div></div><span style="font-size:30px">🧾</span></div>
      ${list.length ? Object.entries(groups).map(([m, vs]) => `<div class="month-head"><b>${esc(fmtMonth(m))}</b><span class="num">+${esc(fmtEUR(vs.reduce((s, v) => s + v.saving, 0)))}</span></div>
        <div class="list">${vs.map(visitRow).join("")}</div>`).join("")
        : `<div class="card empty" style="margin-top:14px"><div class="big">🗓️</div>${visits.length ? "Keine Besuche für diesen Filter." : "Noch keine Besuche in dieser Saison."}<br>
          <button class="btn primary small" style="margin-top:14px" id="vi-first">${I.plus(16)} Besuch erfassen</button></div>`}`;
    body.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { sid = b.dataset.s; store.set("visits:season", sid); load(); }));
    body.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => { filter = b.dataset.c || null; render(); }));
    const qi = body.querySelector("#vi-q");
    qi.oninput = debounce(() => { q = qi.value; render(); const n = root.querySelector("#vi-q"); n.focus(); n.setSelectionRange(q.length, q.length); }, 200);
    const first = body.querySelector("#vi-first"); if (first) first.onclick = () => openSearch();
    body.onclick = (e) => {
      const b = e.target.closest("[data-vid]");
      if (!b) return;
      const v = visits.find((x) => x.id === +b.dataset.vid);
      openVisitSheet({ facility: { id: v.facility_id, name: v.facility_name, category: v.category, kind: v.kind, town: v.town, category_label: v.category_label }, visit: v, onDone: load });
    };
  };
  try { await load(); } catch (e) { root.querySelector("#vi-body").innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
