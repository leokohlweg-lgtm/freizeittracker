// Statistiken, persönliche Highlights, Saisonvergleich
import { api } from "../api.js";
import { S, activeSeason, go } from "../state.js";
import { areaChart, barChart, donut, hbars, compareChart } from "../charts.js";
import { esc, fmtEUR, fmtSigned, fmtDate, cat, I, store } from "../util.js";

export async function renderStats(root, sub) {
  const seasons = S.user.seasons;
  let sid = store.get("stats:season", activeSeason());
  if (!seasons.some((s) => s.season_id === sid)) sid = activeSeason();
  let mode = "saving";
  root.innerHTML = `<div class="view"><div class="topbar"><div><div class="eyebrow">Auswertung</div><h1>Statistiken</h1></div></div>
    <div id="st-body"><div class="skeleton" style="height:420px"></div></div></div>`;
  const body = root.querySelector("#st-body");
  let st, cmp;
  const load = async () => {
    [st, cmp] = await Promise.all([api(`/api/stats?season=${sid}`), api("/api/compare")]);
    render();
    if (sub === "highlights") { root.querySelector("#highlights")?.scrollIntoView({ behavior: "smooth", block: "start" }); sub = null; }
  };
  const render = () => {
    const h = st.highlights;
    const catItems = st.by_category.map((c) => ({ label: c.label, value: c.saving, visits: c.visits, color: cat(c.category).c }));
    body.innerHTML = `
      ${seasons.length > 1 ? `<div class="seg" style="margin-bottom:14px">${seasons.map((s) => `<button data-s="${s.season_id}" class="${sid === s.season_id ? "on" : ""}">${esc(s.label)}</button>`).join("")}</div>` : ""}
      <div class="kpis" style="margin-top:0">
        <div class="kpi"><div class="k">Gesamtersparnis</div><div class="v num pos">${esc(fmtEUR(st.gross))}</div><div class="h">brutto</div></div>
        <div class="kpi"><div class="k">Nettovorteil</div><div class="v num ${st.net >= 0 ? "pos" : "neg"}">${esc(fmtSigned(st.net))}</div><div class="h">nach Ticketpreis ${esc(fmtEUR(st.purchase_price, true))}</div></div>
        <div class="kpi"><div class="k">Gesamtbesuche</div><div class="v num">${st.visits}</div><div class="h">${h.distinct_facilities || 0} Einrichtungen</div></div>
        <div class="kpi"><div class="k">Ø pro Besuch</div><div class="v num">${esc(fmtEUR(st.avg))}</div><div class="h">Rendite ${st.purchase_price ? Math.round(st.progress_raw * 100) : 0} %</div></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>Entwicklung der Amortisation</h3>
        <div class="small muted" style="margin:-6px 0 10px">${st.amortized_on ? `Gewinnschwelle erreicht am <b>${esc(fmtDate(st.amortized_on))}</b>` : `Noch ${esc(fmtEUR(st.remaining))} bis zur Gewinnschwelle`}</div>
        ${areaChart(st.cumulative, { threshold: st.purchase_price, start: st.season.start_date, end: st.season.end_date })}</div>
      <div class="card"><div class="row between" style="margin-bottom:10px"><h3 style="margin:0">Pro Monat</h3>
        <div class="seg" style="width:auto"><button data-m="saving" class="${mode === "saving" ? "on" : ""}">Ersparnis</button><button data-m="visits" class="${mode === "visits" ? "on" : ""}">Besuche</button></div></div>
        ${barChart(st.monthly, mode === "saving" ? {} : { key: "visits", fmt: (v) => v, color: "#0a84ff" })}</div>
      <div class="card"><h3>Nach Kategorien</h3>${catItems.length ? `<div class="donut-wrap">${donut(catItems)}<div class="legend">${catItems.map((c) =>
        `<div class="lg"><span class="sw" style="background:${c.color}"></span><span class="ellipsis">${esc(c.label)} <span class="muted small">${c.visits}×</span></span><b class="small">${esc(fmtEUR(c.value, true))}</b></div>`).join("")}</div></div>`
        : `<div class="empty small">Noch keine Daten</div>`}</div>
      <div class="card"><h3>Meistbesuchte Einrichtungen</h3>${st.top_facilities.length ? hbars(st.top_facilities.slice(0, 8).map((f) => ({ label: f.name, value: f.visits, saving: f.saving, color: cat(f.category).c })),
        { fmt: (v, i) => `${v}× · ${fmtEUR(i.saving, true)}` }) : `<div class="empty small">Noch keine Daten</div>`}</div>
      <div class="card"><h3>Besuche pro Kategorie</h3>${catItems.length ? hbars(catItems.map((c) => ({ label: c.label, value: c.visits, color: c.color })), { fmt: (v) => `${v}×` }) : `<div class="empty small">Noch keine Daten</div>`}</div>

      <div class="section" id="highlights"><div class="section-head"><h2>Persönliche Highlights</h2></div>
        ${st.visits ? `<div class="hl-grid">
          ${hl("🏆", h.most_visited.name, `Meistbesucht · ${h.most_visited.visits}×`)}
          ${hl("💎", fmtEUR(h.most_expensive.regular_price), `Teuerster Eintritt · ${h.most_expensive.facility_name}`)}
          ${hl("📅", h.best_month.label_long, `Erfolgreichster Monat · ${fmtEUR(h.best_month.saving, true)}`)}
          ${hl("⚡", fmtEUR(h.best_day.saving), `Höchste Tagesersparnis · ${fmtDate(h.best_day.date)}`)}
          ${hl("⛷️", h.ski_days, "Skitage")}
          ${hl("🏊", h.swim_visits, "Schwimmbad- & Badebesuche")}
          ${hl("📍", h.distinct_facilities, "Verschiedene Einrichtungen")}
          ${hl("🔥", h.week_streak + (h.week_streak === 1 ? " Woche" : " Wochen"), "Längste Serie in Folge")}
          ${hl("💰", fmtEUR(st.max_single.saving), `Höchste Einzelersparnis · ${st.max_single.facility_name}`)}
          ${hl("🗓️", h.favorite_weekday, "Lieblings-Wochentag")}
        </div>` : `<div class="card empty">Erfasse Besuche, um deine Rekorde zu sehen.</div>`}
        <button class="wrapped-banner" id="st-wr" style="margin-top:14px"><span style="font-size:34px">✨</span><div class="grow"><b>Dein Saisonrückblick ${esc(st.season.label)}</b>
          <span class="small" style="opacity:.9">Deine Saison als Story – ${new Date() > new Date(st.season.end_date) ? "jetzt ansehen" : "Vorschau ansehen"}</span></div>${I.chev(18)}</button>
      </div>

      <div class="section"><div class="section-head"><h2>Saisonvergleich</h2></div>
        ${cmp.seasons.length > 1 ? `<div class="card">${compareChart(cmp.seasons)}
          <div class="legend" style="grid-template-columns:1fr 1fr;margin-top:8px"><div class="lg small"><span class="sw" style="background:var(--surface-3)"></span>Ticketpreis</div><div class="lg small"><span class="sw" style="background:#34c759"></span>Ersparnis</div></div>
          <table class="tariffs" style="margin-top:12px"><tr><td class="muted small">Saison</td><td class="p muted small">Besuche</td><td class="p muted small">Netto</td><td class="p muted small">Amortisiert</td></tr>
          ${cmp.seasons.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td class="p">${s.visits}</td><td class="p ${s.net >= 0 ? "pos" : "neg"}">${esc(fmtSigned(s.net))}</td><td class="p small">${s.days_to_amortize ? `nach ${s.days_to_amortize} T.` : "–"}</td></tr>`).join("")}</table></div>`
          : `<div class="card"><div class="row" style="gap:14px"><span style="font-size:30px">📊</span><div class="grow small">Vergleiche, wie intensiv du dein Ticket in verschiedenen Jahren genutzt hast. Lege dafür vergangene Saisonen im Profil an.</div></div>
            <button class="btn small" style="margin-top:12px" id="st-addseason">Saison hinzufügen</button></div>`}
      </div>`;
    body.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { sid = b.dataset.s; store.set("stats:season", sid); load(); }));
    body.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mode = b.dataset.m; render(); }));
    body.querySelector("#st-wr").onclick = () => go(`#/wrapped/${sid}`);
    const as = body.querySelector("#st-addseason"); if (as) as.onclick = () => go("#/profile");
  };
  try { await load(); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}

const hl = (ic, v, k) => `<div class="hl"><div class="hl-ic">${ic}</div><div><div class="hl-v">${esc(v)}</div><div class="hl-k">${esc(k)}</div></div></div>`;
