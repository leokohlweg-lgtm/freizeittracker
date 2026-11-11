// Lokaler Datenbestand ohne Server:
//  - Preiskatalog (öffentlich, wöchentlich automatisch aktualisiert): data/catalog.json
//  - Persönliche Daten (Profil, Saisonen, Besuche, eigene Preise): nur auf diesem Gerät (localStorage)
// Stellt dieselben Endpunkte bereit wie früher die Server-API, damit die Oberfläche unverändert bleibt.
import * as E from "./engine.js";

export class ApiErr extends Error {
  constructor(status, body) {
    super(body?.message || `Fehler ${status}`);
    this.status = status;
    this.code = body?.error;
    this.body = body || {};
  }
}
const fail = (status, error, message, extra = {}) => { throw new ApiErr(status, { error, message, ...extra }); };

// ============================================================ Katalog
let CAT = null;
const IDX = { fac: new Map(), slug: new Map(), tariffs: new Map(), history: new Map(), log: new Map() };
const CTX = { ticketTypes: {}, categories: {}, plausible: {} };

function indexCatalog(c) {
  CAT = c;
  IDX.fac.clear(); IDX.slug.clear(); IDX.tariffs.clear(); IDX.history.clear(); IDX.log.clear();
  for (const f of c.facilities) {
    if (typeof f.tags === "string") f.tags = JSON.parse(f.tags || "[]");
    if (typeof f.special_rules === "string" || f.special_rules == null) { try { f.special_rules = JSON.parse(f.special_rules || "{}"); } catch { f.special_rules = {}; } }
    IDX.fac.set(f.id, f); IDX.slug.set(f.slug, f);
  }
  for (const t of c.tariffs) (IDX.tariffs.get(t.facility_id) || IDX.tariffs.set(t.facility_id, []).get(t.facility_id)).push(t);
  for (const t of c.history || []) (IDX.history.get(t.facility_id) || IDX.history.set(t.facility_id, []).get(t.facility_id)).push(t);
  for (const l of c.log || []) if (l.facility_id) (IDX.log.get(l.facility_id) || IDX.log.set(l.facility_id, []).get(l.facility_id)).push(l);
  CTX.ticketTypes = c.ticket_types;
  CTX.categories = Object.fromEntries(c.categories.map((x) => [x.key, x]));
  CTX.plausible = c.plausible;
}

export async function loadCatalog() {
  let fresh = null;
  try {
    const r = await fetch("data/catalog.json", { cache: "no-cache" });
    if (r.ok) fresh = await r.json();
  } catch { /* offline: Service Worker liefert die letzte Version */ }
  if (!fresh) throw new ApiErr(0, { error: "offline", message: "Preiskatalog konnte nicht geladen werden. Bitte einmal mit Internet öffnen." });
  const prev = DB.catalog_seen;
  indexCatalog(fresh);
  const changed = prev && prev !== fresh.generated_at;
  DB.catalog_seen = fresh.generated_at;
  save();
  return { generated_at: fresh.generated_at, changed };
}
export const catalogInfo = () => CAT && { generated_at: CAT.generated_at, facilities: CAT.facilities.length };

// ============================================================ Persönliche Daten
// Selbsttest (selftest.html) arbeitet in einem eigenen Speicherbereich und berührt keine echten Daten
const KEY = /selftest/.test(location.pathname) ? "ft:selftest-db" : "ft:local-db";
const empty = () => ({ version: 1, profile: null, seasons: [], visits: [], favorites: [], user_tariffs: [], tariff_status: {}, derived_seasons: {},
  next_id: 1, created_at: E.nowStamp(), last_export_at: null, catalog_seen: null });
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...empty(), ...JSON.parse(raw) }; } catch { /* privat */ }
  return empty();
}
export let DB = load();
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (e) { fail(507, "storage", "Speicher voll oder gesperrt – bitte eine Sicherung exportieren"); }
}
export const hasProfile = () => !!DB.profile;
// Browser bitten, die Daten nicht automatisch zu löschen
export const requestPersist = () => navigator.storage?.persist?.().catch(() => false);

// ------------------------------------------------------------ Saisonen
function allSeasons() {
  const list = [...(CAT?.seasons || [])];
  for (const s of Object.values(DB.derived_seasons)) if (!list.some((x) => x.id === s.id)) list.push(s);
  return list.sort((a, b) => b.start_date.localeCompare(a.start_date));
}
const getSeason = (id) => allSeasons().find((s) => s.id === id) || null;
function ensureSeason(id) {
  const s = getSeason(id);
  if (s) return s;
  const d = E.deriveSeason(id, allSeasons());
  if (!d) fail(400, "bad_season", "Keine Referenzsaison vorhanden");
  DB.derived_seasons[id] = d;
  return d;
}

// ------------------------------------------------------------ Tarife (Katalog + eigene Ergänzungen)
function effectiveTariffs(f) {
  const st = DB.tariff_status;
  const base = (IDX.tariffs.get(f.id) || []).filter((t) => st[t.id] !== "rejected")
    .map((t) => (st[t.id] === "verified" ? { ...t, status: "verified", confidence: 1 } : t));
  const own = DB.user_tariffs.filter((t) => t.facility_slug === f.slug).map((t) => ({ ...t, facility_id: f.id }));
  return [...base, ...own];
}
const pubTariff = (t, f) => ({ ...t, outdated: f ? E.isOutdated(t, f) : false });

// ------------------------------------------------------------ Hilfen
const TT = () => CTX.ticketTypes;
const catLabel = (k) => (CTX.categories[k] || CTX.categories.sonstiges || { label: k }).label;
function facilityPublic(f, light = false) {
  const o = { id: f.id, slug: f.slug, kind: f.kind, name: f.name, category: f.category, town: f.town, lat: f.lat, lon: f.lon,
    discount_label: f.discount_label, discount_percent: f.discount_percent, discount_amount: f.discount_amount, price_status: f.price_status,
    status: f.status, website: f.website, tags: f.tags || [], category_label: catLabel(f.category) };
  if (light) return o;
  return { ...o, address: f.address, description: f.description, phone: f.phone, hours_url: f.hours_url, conditions: f.conditions,
    special_rules: f.special_rules || {}, source_url: f.source_url, first_seen: f.first_seen, last_seen: f.last_seen, archived_at: f.archived_at,
    updated_at: f.updated_at, price_checked_at: f.price_checked_at, price_check_message: f.price_check_message, review_needed: f.review_needed,
    price_url: f.price_url, tag_labels: (f.tags || []).map((t) => CAT.tag_labels[t] || t) };
}
function getFacility(id) {
  const f = IDX.fac.get(+id);
  if (!f) fail(404, "not_found", "Einrichtung nicht gefunden");
  return f;
}
function parseNum(v, key, lo = 0, hi = 10000) {
  if (v == null || v === "") return null;
  const n = +String(v).replace(",", ".");
  if (isNaN(n)) fail(400, "bad_number", `Ungültiger Wert für ${key}`);
  if (n < lo || n > hi) fail(400, "bad_number", `Wert für ${key} außerhalb des gültigen Bereichs`);
  return n;
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ------------------------------------------------------------ Profil
function publicUser() {
  const p = DB.profile;
  if (!p) fail(401, "auth", "Noch kein Profil angelegt");
  const seasons = DB.seasons.map((us) => {
    const s = getSeason(us.season_id) || ensureSeason(us.season_id);
    const [cat, why] = E.categoryFor(s, p.birth_date, !!p.disability);
    return { season_id: us.season_id, purchase_price: us.purchase_price, category_key: us.category_key, amortized_on: us.amortized_on,
      label: s.label, start_date: s.start_date, end_date: s.end_date, verified: s.verified,
      category_label: cat?.label || null, category_auto: cat?.key || null, category_explanation: why };
  }).sort((a, b) => b.season_id.localeCompare(a.season_id));
  return { id: 1, email: "", first_name: p.first_name, last_name: p.last_name, birth_date: p.birth_date, disability: p.disability ? 1 : 0,
    is_admin: 0, active_season_id: p.active_season_id, created_at: p.created_at, seasons, local: true };
}
function validateProfile(d, partial = false) {
  const o = {};
  for (const k of ["first_name", "last_name"]) {
    if (k in d || !partial) {
      const v = String(d[k] || "").trim();
      if (!v || v.length > 80) fail(400, "bad_" + k, "Bitte Vor- und Nachnamen angeben");
      o[k] = v;
    }
  }
  if ("birth_date" in d || !partial) {
    const b = String(d.birth_date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b) || b < "1900-01-01" || b > E.todayISO()) fail(400, "bad_birth_date", "Ungültiges Geburtsdatum");
    o.birth_date = b;
  }
  if ("disability" in d) o.disability = d.disability ? 1 : 0;
  return o;
}
const priceOf = (v, name = "Kaufpreis") => {
  const p = parseNum(v, name, 0, 5000);
  if (p == null) fail(400, "bad_price", `${name} fehlt oder ist ungültig`);
  return E.round2(p);
};
function recategorize() {
  for (const us of DB.seasons) {
    const [c] = E.categoryFor(ensureSeason(us.season_id), DB.profile.birth_date, !!DB.profile.disability);
    if (c) us.category_key = c.key;
  }
}

// ============================================================ Besuche
function visitView(v) {
  const f = IDX.slug.get(v.facility_slug);
  const o = { ...v };
  if (f) Object.assign(o, { facility_id: f.id, facility_name: f.name, category: f.category, kind: f.kind, town: f.town, slug: f.slug });
  o.ticket_label = TT()[o.ticket_type] || o.ticket_type;
  o.category_label = catLabel(o.category);
  return o;
}
export const listVisits = (season) => DB.visits.filter((v) => !season || v.season_id === season).map(visitView)
  .sort((a, b) => b.visit_date.localeCompare(a.visit_date) || b.id - a.id);
const getVisit = (id) => {
  const v = DB.visits.find((x) => x.id === +id);
  if (!v) fail(404, "not_found", "Besuch nicht gefunden");
  return v;
};
function priorVisits(slug, season, excludeId) {
  return DB.visits.filter((v) => v.facility_slug === slug && v.season_id === season && v.id !== excludeId).length;
}
function quoteFor(f, iso, o = {}) {
  return E.quote(CTX, f, effectiveTariffs(f), DB.profile, iso, { ...o, prior_visits: priorVisits(f.slug, E.seasonIdForDate(iso), o.exclude) });
}
function prepare(data, excludeId = null) {
  const iso = String(data.visit_date || E.todayISO());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) fail(400, "bad_date", "Ungültiges Datum");
  if (iso > E.todayISO()) fail(400, "future_date", "Besuche in der Zukunft können nicht erfasst werden");
  const season_id = E.seasonIdForDate(iso);
  if (!DB.seasons.some((s) => s.season_id === season_id))
    fail(409, "no_season", `Für die Saison ${E.seasonLabel(season_id)} ist kein Freizeitticket in deinem Profil hinterlegt`, { season_id });
  const f = getFacility(data.facility_id);
  const regular = parseNum(data.regular_price, "regular_price", 0, 2000);
  const saving = parseNum(data.saving, "saving", 0, 2000);
  const share = parseNum(data.inclusion_share, "inclusion_share", 0, 1);
  const q = quoteFor(f, iso, { ticket_type: data.ticket_type || null, tariff_id: data.tariff_id ?? null, regular_override: regular,
    saving_override: saving, inclusion_share: share ?? 1, exclude: excludeId });
  if (q.regular_price == null) fail(422, "price_required", "Für diese Einrichtung ist kein regulärer Preis bekannt. Bitte trage den Preis ein.", { quote: q });
  if (q.saving == null) fail(422, "saving_required", "Die Ersparnis lässt sich nicht automatisch berechnen. Bitte trage sie ein.", { quote: q });
  return {
    season_id, facility_slug: f.slug, facility_id: f.id, facility_name: f.name, category: f.category, kind: f.kind, town: f.town,
    visit_date: iso, ticket_type: q.ticket_type, tariff_id: q.tariff?.id ?? null, regular_price: q.regular_price, paid_price: q.paid_price,
    saving: q.saving, inclusion_share: q.inclusion_share, price_source: regular != null ? "manual" : (q.tariff?.status || "manual"),
    price_explanation: [...q.explanation, ...q.warnings.map((w) => "⚠ " + w)], manual_price: regular != null || saving != null ? 1 : 0,
    note: String(data.note || "").trim().slice(0, 1000) || null,
  };
}
const dups = (row, excludeId = null) => DB.visits.filter((v) => v.facility_slug === row.facility_slug && v.visit_date === row.visit_date &&
  v.ticket_type === row.ticket_type && v.id !== excludeId);

function createVisit(data) {
  const client_id = String(data.client_id || "").slice(0, 64) || null;
  if (client_id) {
    const ex = DB.visits.find((v) => v.client_id === client_id);
    if (ex) return [visitView(ex), false];
  }
  const row = prepare(data);
  const d = dups(row);
  if (d.length && !data.allow_duplicate) fail(409, "duplicate", "Dieser Besuch ist für diesen Tag bereits erfasst.", { existing: d.map((x) => ({ id: x.id })) });
  row.dup_index = d.length ? Math.max(...d.map((x) => x.dup_index || 0)) + 1 : 0;
  Object.assign(row, { id: DB.next_id++, client_id, created_at: E.nowStamp(), updated_at: E.nowStamp() });
  DB.visits.push(row);
  const newly = recomputeAmortization(row.season_id);
  save();
  return [{ ...visitView(row), amortized_now: newly }, true];
}
function updateVisit(id, data) {
  const old = getVisit(id);
  const merged = { facility_id: IDX.slug.get(old.facility_slug)?.id ?? old.facility_id, visit_date: old.visit_date, ticket_type: old.ticket_type,
    note: old.note, inclusion_share: old.inclusion_share };
  if (old.manual_price) { merged.regular_price = old.regular_price; if (old.kind === "bonus") merged.saving = old.saving; }
  for (const k of ["facility_id", "visit_date", "ticket_type", "tariff_id", "regular_price", "saving", "inclusion_share", "note", "allow_duplicate"])
    if (k in data) merged[k] = data[k];
  if (data.reset_price) { delete merged.regular_price; delete merged.saving; }
  const row = prepare(merged, old.id);
  const d = dups(row, old.id);
  if (d.length && !merged.allow_duplicate) fail(409, "duplicate", "Für diesen Tag existiert bereits ein identischer Besuch.", { existing: d.map((x) => ({ id: x.id })) });
  row.dup_index = d.length ? Math.max(...d.map((x) => x.dup_index || 0)) + 1 : 0;
  const oldSeason = old.season_id;
  Object.assign(old, row, { updated_at: E.nowStamp() });
  recomputeAmortization(oldSeason);
  if (row.season_id !== oldSeason) recomputeAmortization(row.season_id);
  save();
  return visitView(old);
}
function deleteVisit(id) {
  const v = getVisit(id);
  DB.visits = DB.visits.filter((x) => x.id !== v.id);
  recomputeAmortization(v.season_id);
  save();
  return visitView(v);
}
function recomputeAmortization(season) {
  const us = DB.seasons.find((s) => s.season_id === season);
  if (!us) return false;
  let cum = 0, date = null;
  for (const v of DB.visits.filter((x) => x.season_id === season).sort((a, b) => a.visit_date.localeCompare(b.visit_date) || a.id - b.id)) {
    cum = E.round2(cum + v.saving);
    if (us.purchase_price > 0 && cum >= us.purchase_price - 1e-9) { date = v.visit_date; break; }
  }
  const newly = !!date && !us.amortized_on;
  us.amortized_on = date;
  return newly;
}

// ============================================================ Statistik
const MONTHS = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_LONG = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const SWIM = new Set(["hallenbad", "freibad", "badesee", "sauna"]);
const SKI_TICKETS = new Set(["tageskarte", "halbtag", "stundenkarte", "abend"]);
const sum = (a, k) => E.round2(a.reduce((s, x) => s + x[k], 0));

function stats(season) {
  const us = DB.seasons.find((s) => s.season_id === season);
  if (!us) fail(404, "no_season", "Saison nicht im Profil");
  const s = ensureSeason(season);
  const visits = listVisits(season).sort((a, b) => a.visit_date.localeCompare(b.visit_date) || a.id - b.id);
  const price = us.purchase_price, gross = sum(visits, "saving"), n = visits.length;
  const res = {
    season: { id: s.id, label: s.label, start_date: s.start_date, end_date: s.end_date, verified: s.verified },
    purchase_price: price, category_key: us.category_key, gross, net: E.round2(gross - price), visits: n,
    avg: n ? E.round2(gross / n) : 0, progress: price ? Math.min(1, gross / price) : 1, progress_raw: price ? gross / price : 0,
    remaining: E.round2(Math.max(0, price - gross)), amortized_on: us.amortized_on, paid_total: sum(visits, "paid_price"),
  };
  if (us.amortized_on) {
    res.amortized_after_visits = visits.filter((v) => v.visit_date <= us.amortized_on).length;
    res.amortized_after_days = E.daysBetween(s.start_date, us.amortized_on) + 1;
  }
  const today = E.todayISO() < s.end_date ? E.todayISO() : s.end_date;
  const elapsed = Math.max(1, E.daysBetween(s.start_date, today) + 1), total = E.daysBetween(s.start_date, s.end_date) + 1;
  res.projection = n && today < s.end_date ? E.round2(gross / elapsed * total) : gross;
  res.days_left = Math.max(0, E.daysBetween(E.todayISO(), s.end_date));
  if (n && !us.amortized_on && res.avg) res.visits_to_break_even = Math.ceil(res.remaining / res.avg);
  const start = +season.slice(0, 4);
  const months = [10, 11, 12].map((m) => `${start}-${String(m).padStart(2, "0")}`).concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map((m) => `${start + 1}-0${m}`));
  const mm = Object.fromEntries(months.map((m) => [m, { month: m, label: MONTHS[+m.slice(5) - 1], visits: 0, saving: 0 }]));
  for (const v of visits) { const m = mm[v.visit_date.slice(0, 7)]; if (m) { m.visits++; m.saving = E.round2(m.saving + v.saving); } }
  res.monthly = Object.values(mm);
  const cats = {};
  for (const v of visits) { const c = (cats[v.category] ||= { category: v.category, label: catLabel(v.category), visits: 0, saving: 0 }); c.visits++; c.saving = E.round2(c.saving + v.saving); }
  res.by_category = Object.values(cats).sort((a, b) => b.saving - a.saving);
  const fac = {};
  for (const v of visits) { const x = (fac[v.facility_slug] ||= { facility_id: v.facility_id, name: v.facility_name, category: v.category, visits: 0, saving: 0 }); x.visits++; x.saving = E.round2(x.saving + v.saving); }
  res.top_facilities = Object.values(fac).sort((a, b) => b.visits - a.visits || b.saving - a.saving).slice(0, 10);
  const byDay = {};
  for (const v of visits) byDay[v.visit_date] = (byDay[v.visit_date] || 0) + v.saving;
  let cum = 0;
  res.cumulative = Object.keys(byDay).sort().map((d) => ({ date: d, cum: (cum = E.round2(cum + byDay[d])), day: E.round2(byDay[d]) }));
  res.max_single = visits.length ? visits.reduce((m, v) => (v.saving > m.saving ? v : m)) : null;
  res.highlights = highlights(visits, res);
  res.recent = visits.slice(-6).reverse();
  return res;
}
function highlights(visits, res) {
  if (!visits.length) return { distinct_facilities: 0, ski_days: 0, swim_visits: 0 };
  const byDay = {};
  for (const v of visits) { const d = (byDay[v.visit_date] ||= { saving: 0, visits: 0 }); d.saving = E.round2(d.saving + v.saving); d.visits++; }
  const bestDay = Object.entries(byDay).reduce((m, x) => (x[1].saving > m[1].saving ? x : m));
  const bestMonth = res.monthly.reduce((m, x) => (x.saving > m.saving ? x : m));
  const wdCount = [0, 0, 0, 0, 0, 0, 0];
  visits.forEach((v) => wdCount[E.pyWeekday(v.visit_date)]++);
  const wd = wdCount.indexOf(Math.max(...wdCount));
  // längste Serie aufeinanderfolgender Wochen
  const weekStart = (iso) => { const d = E.dateOf(iso); d.setUTCDate(d.getUTCDate() - E.pyWeekday(iso)); return E.isoOf(d); };
  const weeks = [...new Set(visits.map((v) => weekStart(v.visit_date)))].sort();
  let best = 0, cur = 0, prev = null;
  for (const w of weeks) { cur = prev && E.daysBetween(prev, w) === 7 ? cur + 1 : 1; best = Math.max(best, cur); prev = w; }
  return {
    most_visited: res.top_facilities[0],
    most_expensive: visits.reduce((m, v) => (v.regular_price > m.regular_price ? v : m)),
    best_month: { ...bestMonth, label_long: MONTHS_LONG[+bestMonth.month.slice(5) - 1] + " " + bestMonth.month.slice(0, 4) },
    best_day: { date: bestDay[0], ...bestDay[1] },
    ski_days: new Set(visits.filter((v) => v.category === "ski" && SKI_TICKETS.has(v.ticket_type)).map((v) => v.visit_date)).size,
    swim_visits: visits.filter((v) => SWIM.has(v.category)).length,
    distinct_facilities: new Set(visits.map((v) => v.facility_slug)).size,
    distinct_categories: new Set(visits.map((v) => v.category)).size,
    favorite_weekday: WEEKDAYS[wd], week_streak: best, first_visit: visits[0],
  };
}
const fmtLong = (iso) => { if (!iso) return "–"; const [y, m, d] = iso.split("-").map(Number); return `${d}. ${MONTHS_LONG[m - 1]} ${y}`; };
const e2 = (v) => v.toFixed(2).replace(".", ",") + " €";
function wrapped(season) {
  const s = stats(season), h = s.highlights;
  const slides = !s.visits ? [] : [
    { kind: "intro", title: `Deine Saison ${s.season.label}`, text: `${s.visits} Besuche. ${h.distinct_facilities} verschiedene Orte. Lass uns zurückblicken.` },
    { kind: "big", title: "Gesamtersparnis", value: s.gross, unit: "€", text: "So viel hättest du ohne Freizeitticket bezahlt." },
    { kind: "net", title: "Dein Nettovorteil", value: s.net, unit: "€", text: s.amortized_on
      ? `Dein Ticket hat sich am ${fmtLong(s.amortized_on)} bezahlt gemacht – nach ${s.amortized_after_visits} Besuchen.` : `Bis zur Gewinnschwelle fehlten ${e2(s.remaining)}.` },
    { kind: "top", title: "Dein Lieblingsort", value: h.most_visited.name, text: `${h.most_visited.visits}× besucht · ${e2(h.most_visited.saving)} gespart` },
    { kind: "category", title: "Deine Top-Kategorie", value: s.by_category[0].label, text: `${s.by_category[0].visits} Besuche · ${e2(s.by_category[0].saving)}`, breakdown: s.by_category.slice(0, 5) },
    { kind: "month", title: "Dein stärkster Monat", value: h.best_month.label_long, text: `${e2(h.best_month.saving)} in ${h.best_month.visits} Besuchen`, monthly: s.monthly },
    { kind: "stats", title: "In Zahlen", items: [{ label: "Skitage", value: h.ski_days }, { label: "Badebesuche", value: h.swim_visits },
      { label: "Lieblingstag", value: h.favorite_weekday }, { label: "Längste Wochenserie", value: h.week_streak }] },
    { kind: "record", title: "Teuerster gesparter Eintritt", value: h.most_expensive.regular_price, unit: "€", text: `${h.most_expensive.facility_name} · ${fmtLong(h.most_expensive.visit_date)}` },
    { kind: "outro", title: "Bis zur nächsten Saison!", text: `Ø ${e2(s.avg)} pro Besuch. Du warst ${s.visits}× unterwegs in Tirol.` },
  ];
  const ended = E.todayISO() > s.season.end_date;
  return { season: s.season, available: ended, preview: !ended, slides, stats: { gross: s.gross, net: s.net, visits: s.visits, avg: s.avg } };
}
function compare() {
  return DB.seasons.map((us) => {
    const s = ensureSeason(us.season_id);
    const vs = DB.visits.filter((v) => v.season_id === us.season_id);
    const gross = sum(vs, "saving");
    return { season_id: us.season_id, label: s.label, purchase_price: us.purchase_price, gross, net: E.round2(gross - us.purchase_price), visits: vs.length,
      distinct: new Set(vs.map((v) => v.facility_slug)).size, active_days: new Set(vs.map((v) => v.visit_date)).size, amortized_on: us.amortized_on,
      days_to_amortize: us.amortized_on ? E.daysBetween(s.start_date, us.amortized_on) + 1 : null, roi: us.purchase_price ? E.round2(gross / us.purchase_price) : null };
  }).sort((a, b) => a.season_id.localeCompare(b.season_id));
}

// ============================================================ Export / Import
function exportJSON() {
  DB.last_export_at = E.nowStamp();
  save();
  return { app: "FreizeitTracker", version: 2, mode: "local", exported_at: E.nowStamp(), profile: DB.profile, seasons: DB.seasons,
    visits: listVisits().map((v) => ({ ...v })), favorites: DB.favorites, user_tariffs: DB.user_tariffs, tariff_status: DB.tariff_status,
    derived_seasons: DB.derived_seasons };
}
function exportCSV() {
  const rows = [["Datum", "Saison", "Einrichtung", "Kategorie", "Art", "Ticketart", "Regulärer Preis", "Bezahlt", "Ersparnis", "Preisquelle", "Notiz"]];
  const n = (v) => v.toFixed(2).replace(".", ",");
  for (const v of listVisits().reverse())
    rows.push([v.visit_date, E.seasonLabel(v.season_id), v.facility_name, v.category_label, v.kind === "bonus" ? "Bonuspartner" : "Inkludiert",
      v.ticket_label, n(v.regular_price), n(v.paid_price), n(v.saving), v.price_source, v.note || ""]);
  DB.last_export_at = E.nowStamp();
  save();
  return "﻿" + rows.map((r) => r.map((c) => (/[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(";")).join("\r\n");
}
function importJSON(data) {
  if (!data || data.app !== "FreizeitTracker") fail(400, "bad_import", "Keine gültige FreizeitTracker-Sicherung");
  let created = 0, skipped = 0;
  if (!DB.profile && data.profile) {
    DB.profile = { ...data.profile, birth_date: data.profile.birth_date, created_at: data.profile.created_at || E.nowStamp() };
    if (!DB.profile.active_season_id && data.seasons?.[0]) DB.profile.active_season_id = data.seasons[0].season_id;
  }
  if (!DB.profile) fail(400, "bad_import", "Die Sicherung enthält kein Profil");
  Object.assign(DB.derived_seasons, data.derived_seasons || {});
  for (const s of data.seasons || []) {
    if (!DB.seasons.some((x) => x.season_id === s.season_id)) {
      ensureSeason(s.season_id);
      DB.seasons.push({ season_id: s.season_id, purchase_price: +s.purchase_price, category_key: s.category_key || "erwachsene", amortized_on: null, created_at: E.nowStamp() });
    }
  }
  for (const t of data.user_tariffs || []) if (!DB.user_tariffs.some((x) => x.id === t.id)) DB.user_tariffs.push(t);
  Object.assign(DB.tariff_status, data.tariff_status || {});
  for (const v of data.visits || []) {
    const slug = v.facility_slug || v.slug;
    const cid = v.client_id || `import-${v.id}-${v.visit_date}-${slug}`.slice(0, 64);
    if (DB.visits.some((x) => x.client_id === cid || (x.facility_slug === slug && x.visit_date === v.visit_date && x.ticket_type === v.ticket_type && x.dup_index === (v.dup_index || 0)))) { skipped++; continue; }
    if (!DB.seasons.some((s) => s.season_id === v.season_id)) { skipped++; continue; }
    const f = IDX.slug.get(slug);
    DB.visits.push({ ...v, id: DB.next_id++, facility_slug: slug, facility_id: f?.id ?? v.facility_id, client_id: cid, dup_index: v.dup_index || 0,
      price_explanation: Array.isArray(v.price_explanation) ? v.price_explanation : [] });
    created++;
  }
  for (const s of data.favorites || []) if (!DB.favorites.includes(s)) DB.favorites.push(s);
  DB.seasons.forEach((s) => recomputeAmortization(s.season_id));
  save();
  return { created, skipped };
}

// ============================================================ Endpunkte
const routes = [];
const on = (method, pattern, fn) => routes.push([method, new RegExp("^" + pattern + "$"), fn]);

on("GET", "/api/public/seasons", () => ({ seasons: allSeasons(), current: E.seasonIdForDate(E.todayISO()), today: E.todayISO() }));
on("GET", "/api/public/category", (m, q) => {
  const s = q.get("season_id") ? ensureSeason(q.get("season_id")) : null;
  const [category, explanation] = E.categoryFor(s, q.get("birth_date") || "1990-01-01", q.get("disability") === "1");
  return { category, explanation };
});
on("POST", "/api/auth/register", (m, q, b) => {
  const p = validateProfile(b);
  const sid = b.season_id || E.seasonIdForDate(E.todayISO());
  if (!/^\d{4}-\d{2}$/.test(sid)) fail(400, "bad_season", "Ungültige Saison");
  const s = ensureSeason(sid);
  const price = priceOf(b.purchase_price);
  const [cat, why] = E.categoryFor(s, p.birth_date, !!p.disability);
  if (!cat) fail(400, "no_category", why);
  DB.profile = { ...p, disability: p.disability || 0, active_season_id: sid, created_at: E.nowStamp() };
  DB.seasons = [{ season_id: sid, purchase_price: price, category_key: cat.key, amortized_on: null, created_at: E.nowStamp() }];
  save();
  requestPersist();
  return { user: publicUser() };
});
on("GET", "/api/me", () => ({ user: publicUser() }));
on("PUT", "/api/me", (m, q, b) => {
  const p = validateProfile(b, true);
  Object.assign(DB.profile, p);
  recategorize();
  save();
  return { user: publicUser() };
});
on("DELETE", "/api/me", () => {
  const keep = DB.catalog_seen;
  DB = empty();
  DB.catalog_seen = keep;
  save();
  return { ok: true };
});
on("POST", "/api/me/seasons", (m, q, b) => {
  const sid = b.season_id || "";
  if (!/^\d{4}-\d{2}$/.test(sid) || +sid.slice(5) !== (+sid.slice(0, 4) + 1) % 100) fail(400, "bad_season", "Ungültige Saison");
  const price = priceOf(b.purchase_price);
  const s = ensureSeason(sid);
  if (DB.seasons.some((x) => x.season_id === sid)) fail(409, "exists", "Diese Saison ist bereits angelegt");
  const [cat] = E.categoryFor(s, DB.profile.birth_date, !!DB.profile.disability);
  DB.seasons.push({ season_id: sid, purchase_price: price, category_key: cat?.key || "erwachsene", amortized_on: null, created_at: E.nowStamp() });
  if (b.activate) DB.profile.active_season_id = sid;
  recomputeAmortization(sid);
  save();
  return { user: publicUser() };
});
on("PUT", "/api/me/seasons/(\\d{4}-\\d{2})", (m, q, b) => {
  const us = DB.seasons.find((s) => s.season_id === m[1]);
  if (!us) fail(404, "not_found", "Saison nicht im Profil");
  if ("purchase_price" in b) us.purchase_price = priceOf(b.purchase_price);
  if (b.activate) DB.profile.active_season_id = us.season_id;
  recomputeAmortization(us.season_id);
  save();
  return { user: publicUser() };
});
on("DELETE", "/api/me/seasons/(\\d{4}-\\d{2})", (m, q, b) => {
  const sid = m[1];
  const n = DB.visits.filter((v) => v.season_id === sid).length;
  if (n && !b.confirm) fail(409, "has_visits", `Diese Saison enthält ${n} Besuche. Wirklich löschen?`, { visits: n });
  if (DB.seasons.length <= 1) fail(400, "last_season", "Die letzte Saison kann nicht gelöscht werden");
  DB.visits = DB.visits.filter((v) => v.season_id !== sid);
  DB.seasons = DB.seasons.filter((s) => s.season_id !== sid);
  if (DB.profile.active_season_id === sid) DB.profile.active_season_id = [...DB.seasons].sort((a, b) => b.season_id.localeCompare(a.season_id))[0].season_id;
  save();
  return { user: publicUser() };
});

on("GET", "/api/facilities", (m, q) => {
  const archived = q.get("archived") === "1";
  const counts = {}, last = {};
  for (const v of DB.visits) { counts[v.facility_slug] = (counts[v.facility_slug] || 0) + 1; if (!last[v.facility_slug] || v.visit_date > last[v.facility_slug]) last[v.facility_slug] = v.visit_date; }
  const facilities = CAT.facilities.filter((f) => f.status === "active" || archived).map((f) => ({ ...facilityPublic(f, true),
    n_tariffs: effectiveTariffs(f).length, n_visits: counts[f.slug] || 0, last_visit: last[f.slug] || null, favorite: DB.favorites.includes(f.slug) }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  return { facilities, categories: CAT.categories, ticket_types: CAT.ticket_types };
});
on("GET", "/api/facilities/(\\d+)", (m) => {
  const f = getFacility(m[1]);
  const vs = DB.visits.filter((v) => v.facility_slug === f.slug).sort((a, b) => b.visit_date.localeCompare(a.visit_date));
  return { ...facilityPublic(f), tariffs: effectiveTariffs(f).sort((a, b) => a.ticket_type.localeCompare(b.ticket_type) || a.price - b.price).map((t) => pubTariff(t, f)),
    history: (IDX.history.get(f.id) || []).slice(0, 40), checks: [{ status: f.price_status, message: f.price_check_message, sources: f.sources || [] }],
    log: (IDX.log.get(f.id) || []).slice(0, 10),
    usage: { visits: vs.length, saving: sum(vs, "saving"), last: vs[0]?.visit_date || null, list: vs.slice(0, 10) },
    favorite: DB.favorites.includes(f.slug), seasons: f.seasons || [] };
});
on("GET", "/api/facilities/(\\d+)/quote", (m, q) => {
  const f = getFacility(m[1]);
  const iso = q.get("date") || E.todayISO();
  const ex = q.get("exclude_visit") ? +q.get("exclude_visit") : null;
  const r = quoteFor(f, iso, { ticket_type: q.get("ticket_type") || null, tariff_id: q.get("tariff_id"), regular_override: q.get("regular_price"),
    saving_override: q.get("saving"), inclusion_share: q.get("inclusion_share") ? +q.get("inclusion_share") : 1, exclude: ex });
  r.duplicates = DB.visits.filter((v) => v.facility_slug === f.slug && v.visit_date === iso).map((v) => ({ id: v.id, ticket_type: v.ticket_type, saving: v.saving }));
  r.has_season = DB.seasons.some((s) => s.season_id === E.seasonIdForDate(iso));
  return r;
});
on("POST", "/api/facilities/(\\d+)/favorite", (m) => {
  const f = getFacility(m[1]);
  const i = DB.favorites.indexOf(f.slug);
  if (i >= 0) DB.favorites.splice(i, 1); else DB.favorites.push(f.slug);
  save();
  return { favorite: i < 0 };
});
on("POST", "/api/facilities/(\\d+)/tariffs", (m, q, b) => {
  const f = getFacility(m[1]);
  const price = priceOf(b.price, "Preis");
  const src = String(b.source_url || "").trim().slice(0, 500) || null;
  if (src && !/^https?:\/\//.test(src)) fail(400, "bad_url", "Quelle muss mit http:// oder https:// beginnen");
  const int = (v) => (v == null || v === "" ? null : parseInt(v, 10));
  const t = { id: -(Date.now() * 10 + Math.floor(Math.random() * 10)), facility_slug: f.slug, season_id: E.seasonIdForDate(E.todayISO()),
    label: String(b.label || "").trim().slice(0, 120) || "Von dir ergänzt",
    age_group: ["kind", "jugend", "erwachsene", "senior", "student", "alle"].includes(b.age_group) ? b.age_group : "alle",
    age_min: int(b.age_min), age_max: int(b.age_max), birth_year_from: null, birth_year_to: null,
    ticket_type: TT()[b.ticket_type] ? b.ticket_type : (CTX.categories[f.category] || CTX.categories.sonstiges).default_ticket,
    duration_hours: null, day_type: ["alle", "werktag", "wochenende"].includes(b.day_type) ? b.day_type : "alle", season_type: "alle",
    valid_from: null, valid_to: null, price, status: "user", confidence: 1, source_url: src, source_snippet: null, source_season: null,
    found_at: E.nowStamp(), last_confirmed_at: E.nowStamp(), note: "Von dir ergänzt" };
  DB.user_tariffs.push(t);
  save();
  return t;
});
on("POST", "/api/tariffs/(-?\\d+)/verify", (m) => {
  const id = +m[1];
  if (id < 0) return DB.user_tariffs.find((t) => t.id === id);
  DB.tariff_status[id] = "verified";
  save();
  return { ok: true };
});
on("DELETE", "/api/tariffs/(-?\\d+)", (m) => {
  const id = +m[1];
  if (id < 0) DB.user_tariffs = DB.user_tariffs.filter((t) => t.id !== id);
  else DB.tariff_status[id] = "rejected";
  save();
  return { ok: true };
});
const UNSUPPORTED = "Preise werden einmal pro Woche automatisch in der Cloud neu recherchiert. Fehlt ein Preis, kannst du ihn selbst ergänzen.";
on("POST", "/api/facilities/(\\d+)/recheck", () => fail(400, "unsupported", UNSUPPORTED));
on("PUT", "/api/facilities/(\\d+)/price-url", () => fail(400, "unsupported", UNSUPPORTED));

on("GET", "/api/visits", (m, q) => {
  const s = q.get("season");
  return { visits: listVisits(s === "all" ? null : (s || DB.profile.active_season_id)) };
});
on("POST", "/api/visits", (m, q, b) => createVisit(b)[0]);
on("PUT", "/api/visits/(\\d+)", (m, q, b) => updateVisit(m[1], b));
on("DELETE", "/api/visits/(\\d+)", (m) => ({ deleted: deleteVisit(m[1]) }));

const seasonParam = (q) => q.get("season") || DB.profile.active_season_id || DB.seasons[0]?.season_id;
on("GET", "/api/stats", (m, q) => stats(seasonParam(q)));
on("GET", "/api/wrapped", (m, q) => wrapped(seasonParam(q)));
on("GET", "/api/compare", () => ({ seasons: compare() }));

on("GET", "/api/review", () => {
  const items = [];
  for (const f of CAT.facilities) {
    if (f.status !== "active") continue;
    const ts = effectiveTariffs(f);
    const own = ts.some((t) => t.status === "user");
    const unsure = ts.filter((t) => t.status === "auto" && (t.confidence || 0) < 0.5).length;
    if (own && f.price_status !== "ok") continue;
    if (!(f.price_status !== "ok" || (f.review_needed && unsure))) continue;
    items.push({ ...facilityPublic(f, true), n_tariffs: ts.length, n_unsure: unsure, price_check_message: f.price_check_message,
      price_checked_at: f.price_checked_at, sources: f.sources || [], _v: DB.visits.filter((v) => v.facility_slug === f.slug).length });
  }
  items.sort((a, b) => b._v - a._v || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, "de"));
  return { items };
});
on("GET", "/api/status", () => {
  const act = CAT.facilities.filter((f) => f.status === "active");
  const c = (fn) => act.filter(fn).length;
  return {
    counts: { active: act.length, archived: CAT.facilities.length - act.length, included: c((f) => f.kind === "included"), bonus: c((f) => f.kind === "bonus"),
      with_prices: c((f) => f.price_status === "ok"), unreachable: c((f) => ["stale", "unreachable", "blocked"].includes(f.price_status)),
      not_found: c((f) => f.price_status === "not_found"), pending: c((f) => f.price_status === "pending"), review: 0,
      geocoded: c((f) => f.lat != null), tariffs: CAT.tariffs.length, tariffs_archived: (CAT.history || []).length },
    jobs: CAT.jobs || [], log: (CAT.log || []).slice(0, 40), generated_at: CAT.generated_at, pdf_support: true,
    own_prices: DB.user_tariffs.length, last_export_at: DB.last_export_at, visits: DB.visits.length,
  };
});
on("GET", "/api/export", (m, q) => {
  const stamp = E.todayISO();
  if (q.get("format") === "csv") return { __file: true, name: `freizeittracker-besuche-${stamp}.csv`, type: "text/csv;charset=utf-8", data: exportCSV() };
  return { __file: true, name: `freizeittracker-sicherung-${stamp}.json`, type: "application/json", data: JSON.stringify(exportJSON(), null, 1) };
});
on("POST", "/api/import", (m, q, b) => importJSON(b));
on("POST", "/api/auth/logout", () => ({ ok: true }));

export async function handle(path, method, body) {
  const [p, qs] = path.split("?");
  const q = new URLSearchParams(qs || "");
  for (const [mt, rx, fn] of routes) {
    if (mt !== method) continue;
    const m = p.match(rx);
    if (!m) continue;
    if (!CAT) await loadCatalog();
    const open = p.startsWith("/api/public") || p.startsWith("/api/auth/") || p === "/api/import" || (p === "/api/me" && method === "DELETE");
    if (!open && !DB.profile) fail(401, "auth", "Noch kein Profil angelegt");
    // tiefe Kopie, damit Ansichten den Speicher nicht versehentlich verändern
    return JSON.parse(JSON.stringify(fn(m, q, body || {})));
  }
  fail(404, "not_found", "Unbekannte Aktion");
}
