// Selbsttest der App-Logik (öffnen: selftest.html)
import * as E from "./engine.js";
import { handle, loadCatalog, listTickets, addTicket, switchTicket, removeTicket, activeTicketId } from "./local.js";

const results = [];
const out = document.getElementById("out");
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond, detail });
  const li = document.createElement("li");
  li.className = cond ? "ok" : "bad";
  li.textContent = `${cond ? "✓" : "✗"} ${name}${!cond && detail ? " – " + detail : ""}`;
  out.appendChild(li);
}
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `erwartet ${JSON.stringify(b)}, erhalten ${JSON.stringify(a)}`);
async function throwsCode(name, fn, code) {
  try { await fn(); check(name, false, "keine Fehlermeldung"); } catch (e) { eq(name, e.code, code); }
}

const CTX = {
  ticketTypes: { tageskarte: "Tageskarte", halbtag: "Halbtag", stundenkarte: "Stundenkarte", einzeleintritt: "Einzeleintritt", berg_tal: "Berg & Tal", bergfahrt: "Einzelfahrt", abend: "Abend/Nacht", sonstiges: "Sonstiges" },
  categories: { ski: { default_ticket: "tageskarte" }, hallenbad: { default_ticket: "einzeleintritt" }, museum: { default_ticket: "einzeleintritt" },
    freibad: { default_ticket: "einzeleintritt" }, sport: { default_ticket: "einzeleintritt" }, sonstiges: { default_ticket: "einzeleintritt" } },
  plausible: { ski: [8, 95], hallenbad: [1, 35], museum: [1, 45], freibad: [0.5, 30] },
};
let tid = 1;
const T = (price, o = {}) => ({ id: tid++, label: "T", price, status: "auto", ticket_type: "tageskarte", confidence: 0.9, day_type: "alle",
  season_type: "alle", age_group: "unbekannt", found_at: E.nowStamp(), last_confirmed_at: E.nowStamp(), ...o });
const F = (o = {}) => ({ id: 1, slug: "x", name: "X", kind: "included", category: "ski", tags: [], price_status: "ok", special_rules: {}, ...o });
const q = (f, ts, birth, iso = "2027-01-13", o = {}) => E.quote(CTX, f, ts, { birth_date: birth }, iso, o);

function engineTests() {
  // Saisonen & Kategorie über Jahrgang
  eq("Saison 1.10.", E.seasonIdForDate("2026-10-01"), "2026-27");
  eq("Saison 30.9.", E.seasonIdForDate("2027-09-30"), "2026-27");
  const season = { label: "2026/27", categories: [
    { key: "kinder", label: "Kinder", birth_year_from: 2011, birth_year_to: null }, { key: "jugend", label: "Jugend", birth_year_from: 2008, birth_year_to: 2010 },
    { key: "u23", label: "U23", birth_year_from: 2003, birth_year_to: 2007 }, { key: "erwachsene", label: "Erwachsene", birth_year_from: 1962, birth_year_to: 2002 },
    { key: "senioren", label: "Senioren", birth_year_from: null, birth_year_to: 1961 }, { key: "behinderung", label: "Behinderung", requires_flag: "disability" }] };
  for (const [b, k] of [["2011-12-31", "kinder"], ["2010-01-01", "jugend"], ["2007-12-31", "u23"], ["2002-12-31", "erwachsene"], ["1961-12-31", "senioren"]])
    eq(`Kategorie Jahrgang ${b.slice(0, 4)}`, E.categoryFor(season, b)[0].key, k);
  eq("Kategorie Behindertenpass", E.categoryFor(season, "1980-01-01", true)[0].key, "behinderung");
  eq("Feiertag Ostermontag 2027", E.isHoliday("2027-03-29"), true);
  eq("Alter am Besuchstag", E.ageOn("1990-05-05", "2027-05-04"), 36);

  // Jahrgangsbänder des Betreibers
  const ski = [T(67, { age_group: "erwachsene", birth_year_from: 1962, birth_year_to: 2002 }), T(53.5, { age_group: "jugend", birth_year_from: 2008, birth_year_to: 2010 }),
    T(40, { age_group: "kind", birth_year_from: 2011, birth_year_to: 2020 }), T(60.5, { age_group: "senior", birth_year_to: 1961 }),
    T(55, { ticket_type: "halbtag", age_group: "erwachsene", birth_year_from: 1962, birth_year_to: 2002 })];
  eq("Ski Erwachsene", q(F(), ski, "1990-03-01").regular_price, 67);
  eq("Ski Jugend", q(F(), ski, "2009-03-01").regular_price, 53.5);
  eq("Ski Kind", q(F(), ski, "2014-03-01").regular_price, 40);
  eq("Ski Senior", q(F(), ski, "1955-03-01").regular_price, 60.5);
  eq("Ticketart Halbtag", q(F(), ski, "1990-03-01", "2027-01-13", { ticket_type: "halbtag" }).regular_price, 55);

  // Überlappende offene Altersbänder
  const pool = ["erwachsene:19:9.5", "jugend:15:5.7", "kind:6:3.8", "senior:65:7.6"].map((s) => { const [g, a, p] = s.split(":"); return T(+p, { age_group: g, age_min: +a, ticket_type: "stundenkarte" }); });
  const fp = F({ category: "hallenbad" });
  eq("Bad Erwachsene", q(fp, pool, "1990-01-01").regular_price, 9.5);
  eq("Bad Jugend (17)", q(fp, pool, "2010-01-01").regular_price, 5.7);
  eq("Bad Kind (10)", q(fp, pool, "2017-01-01").regular_price, 3.8);
  eq("Bad Senior", q(fp, pool, "1950-01-01").regular_price, 7.6);

  // Ermäßigt und unplausible Funde nicht automatisch
  const mus = [T(6, { ticket_type: "einzeleintritt", age_group: "erwachsene" }), T(3, { ticket_type: "einzeleintritt", age_group: "ermaessigt" }),
    T(999, { ticket_type: "einzeleintritt", age_group: "erwachsene" })];
  const rm = q(F({ category: "museum" }), mus, "1990-01-01");
  eq("Museum Standardpreis", [rm.regular_price, rm.status], [6, "ok"]);
  const empty = q(F({ category: "museum" }), [], "1990-01-01");
  eq("Ohne Preis: nichts erfunden", [empty.regular_price, empty.status], [null, "unavailable"]);

  // Haupt-/Nebensaison ohne Zeitraum -> niedriger, unsicher
  const hs = q(F(), [T(67, { age_group: "erwachsene", season_type: "haupt" }), T(60.5, { age_group: "erwachsene", season_type: "neben" })], "1990-01-01");
  eq("HS/NS niedriger Preis + Prüfhinweis", [hs.regular_price, hs.status], [60.5, "uncertain"]);

  // Wochenende / Feiertag
  const we = [T(6, { ticket_type: "einzeleintritt", age_group: "erwachsene", day_type: "werktag" }), T(8, { ticket_type: "einzeleintritt", age_group: "erwachsene", day_type: "wochenende" })];
  const ff = F({ category: "freibad" });
  eq("Werktag", q(ff, we, "1990-01-01", "2027-06-16").regular_price, 6);
  eq("Samstag", q(ff, we, "1990-01-01", "2027-06-19").regular_price, 8);
  eq("Staatsfeiertag", q(ff, we, "1990-01-01", "2027-05-01").regular_price, 8);

  // Bonuspartner
  const fb = F({ kind: "bonus", category: "sport", discount_percent: 20, discount_label: "20 %", special_rules: { weekdays: [1, 2, 3, 4] } });
  const bt = [T(30, { ticket_type: "einzeleintritt", age_group: "erwachsene" })];
  const b1 = q(fb, bt, "1990-01-01", "2027-01-13");
  eq("Bonus 20 % von 30 €", [b1.regular_price, b1.saving, b1.paid_price], [30, 6, 24]);
  eq("Bonus nicht am Montag", q(fb, bt, "1990-01-01", "2027-01-11").saving, 0);

  // Teilweise inkludiert, Zutrittsgrenze, Gletscher-Saison
  eq("Teilweise inkludiert 50 %", q(F({ category: "museum" }), mus, "1990-01-01", "2027-01-13", { inclusion_share: 0.5 }).saving, 3);
  const fx = F({ category: "museum", special_rules: { max_entries: 1 } });
  eq("Zutrittsgrenze erreicht", q(fx, mus, "1990-01-01", "2027-01-13", { prior_visits: 1 }).saving, 0);
  eq("Gletscher im Oktober = Skitag", E.defaultTicketType("ski", ["sommer:wandern"], "2026-10-10", "Stubaier Gletscher", CTX.categories), "tageskarte");
  eq("Skigebiet im Juli = Bergbahn", E.defaultTicketType("ski", ["sommer:wandern"], "2027-07-10", "Kühtai", CTX.categories), "berg_tal");
}

async function storeTests() {
  await loadCatalog();
  await handle("/api/me", "DELETE");
  await handle("/api/auth/register", "POST", { first_name: "Test", last_name: "Lauf", birth_date: "1990-05-05", season_id: "2026-27", purchase_price: "100" });
  const me = (await handle("/api/me", "GET")).user;
  eq("Profil: Kategorie Erwachsene", me.seasons[0].category_key, "erwachsene");
  const facs = (await handle("/api/facilities", "GET")).facilities;
  // Einrichtung ohne Zutrittsbegrenzung wählen (z. B. Swarovski/Audioversum haben "max. Zutritte")
  let mus = null;
  for (const f of facs.filter((x) => x.kind === "included" && x.category === "museum")) {
    const d = await handle(`/api/facilities/${f.id}`, "GET");
    if (!d.special_rules?.max_entries) { mus = f; break; }
  }
  await handle(`/api/facilities/${mus.id}/tariffs`, "POST", { price: "40", label: "Test", ticket_type: "einzeleintritt", age_group: "alle" });
  const add = (d, o = {}) => handle("/api/visits", "POST", { facility_id: mus.id, visit_date: d, ticket_type: "einzeleintritt", ...o });
  const v1 = await add("2026-11-01");
  eq("Eigener Preis hat Vorrang", v1.regular_price, 40);
  await add("2026-11-05");
  let st = await handle("/api/stats?season=2026-27", "GET");
  eq("Brutto / Netto / Besuche / Ø", [st.gross, st.net, st.visits, st.avg], [80, -20, 2, 40]);
  const v3 = await add("2026-11-08");
  eq("Amortisation erreicht", v3.amortized_now, true);
  st = await handle("/api/stats?season=2026-27", "GET");
  eq("Amortisationsdatum", st.amortized_on, "2026-11-08");
  await add("2026-10-15");
  eq("Rückwirkender Besuch verschiebt Datum", (await handle("/api/stats?season=2026-27", "GET")).amortized_on, "2026-11-05");
  await throwsCode("Doppelzählung verhindert", () => add("2026-11-01"), "duplicate");
  const vd = await add("2026-11-01", { allow_duplicate: true });
  check("Zweiter Besuch nach Bestätigung", vd.id > 0);
  const a = await add("2026-11-02", { client_id: "abc" }), b = await add("2026-11-02", { client_id: "abc" });
  eq("Doppelt abgeschickt = ein Besuch", a.id, b.id);
  await throwsCode("Zukunftsdatum abgelehnt", () => add("2099-01-01"), "future_date");
  await throwsCode("Saison fehlt", () => add("2024-01-10"), "no_season");
  const man = await add("2026-11-03", { regular_price: "55,50" });
  eq("Manueller Preis", [man.regular_price, man.saving, man.manual_price], [55.5, 55.5, 1]);
  await handle(`/api/visits/${man.id}`, "DELETE");
  // Sicherung: exportieren, alles löschen, wiederherstellen
  const amortBefore = (await handle("/api/stats?season=2026-27", "GET")).amortized_on;
  eq("Zusätzlicher Besuch am 1.11. zieht Amortisation vor", amortBefore, "2026-11-01");
  const exp = await handle("/api/export?format=json", "GET");
  const backup = JSON.parse(exp.data);
  const n = (await handle("/api/visits?season=all", "GET")).visits.length;
  await handle("/api/me", "DELETE");
  const r = await handle("/api/import", "POST", backup);
  eq("Wiederherstellung vollständig", r.created, n);
  eq("Import ohne Doppelungen", (await handle("/api/import", "POST", backup)).created, 0);
  eq("Amortisation nach Wiederherstellung", (await handle("/api/stats?season=2026-27", "GET")).amortized_on, amortBefore);
  const csv = await handle("/api/export?format=csv", "GET");
  check("CSV-Export", csv.data.includes("Datum;Saison;Einrichtung"));
  await handle("/api/me", "DELETE");
}

async function ticketTests() {
  // Ausgangslage: nur ein Ticket
  for (const t of listTickets()) if (t.id !== "main") removeTicket(t.id);
  switchTicket("main");
  await handle("/api/me", "DELETE");
  await handle("/api/auth/register", "POST", { first_name: "Anna", last_name: "A", birth_date: "1990-01-01", season_id: "2026-27", purchase_price: "100" });
  const fac = (await handle("/api/facilities", "GET")).facilities.find((f) => f.n_tariffs > 0 && f.kind === "included");
  await handle(`/api/facilities/${fac.id}/tariffs`, "POST", { price: "30", label: "Test", age_group: "alle" });
  await handle("/api/visits", "POST", { facility_id: fac.id, visit_date: "2026-11-01" });
  const idA = activeTicketId();
  const idB = addTicket();
  check("Neues Ticket ist leer", (await handle("/api/me", "GET").catch((e) => e.code)) === "auth");
  await handle("/api/auth/register", "POST", { first_name: "Ben", last_name: "B", birth_date: "2010-05-05", season_id: "2026-27", purchase_price: "200" });
  const sB = await handle("/api/stats?season=2026-27", "GET");
  eq("Ticket B unabhängig (0 Besuche, eigener Preis)", [sB.visits, sB.purchase_price, sB.category_key], [0, 200, "jugend"]);
  eq("Zwei Tickets aufgelistet", listTickets().filter((t) => t.has_profile).map((t) => t.name).sort(), ["Anna A", "Ben B"]);
  switchTicket(idA);
  const sA = await handle("/api/stats?season=2026-27", "GET");
  eq("Ticket A unverändert", [sA.visits, sA.gross, sA.purchase_price], [1, 30, 100]);
  switchTicket(idB);
  const del = await handle("/api/me", "DELETE");
  eq("Ticket B gelöscht, A wieder aktiv", [del.has_profile, activeTicketId(), listTickets().length], [true, idA, 1]);
  eq("A nach Löschen von B intakt", (await handle("/api/stats?season=2026-27", "GET")).visits, 1);
  await handle("/api/me", "DELETE");
}

(async () => {
  try { engineTests(); await storeTests(); await ticketTests(); }
  catch (e) { check("Unerwarteter Fehler", false, e.message + "\n" + e.stack); }
  const bad = results.filter((r) => !r.ok);
  document.getElementById("sum").textContent = bad.length ? `${bad.length} von ${results.length} Tests fehlgeschlagen` : `Alle ${results.length} Tests bestanden ✓`;
  document.getElementById("sum").className = bad.length ? "bad" : "ok";
  window.__selftest = { total: results.length, failed: bad };
})();
