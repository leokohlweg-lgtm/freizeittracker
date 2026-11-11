// Reine Rechenlogik (läuft auf dem Handy): Saisonen, Kategorie über Jahrgang, Preisauswahl, Ersparnis.
// Entspricht der früheren Server-Logik 1:1.
import { norm } from "../util.js";

export const STATUS_RANK = { user: 3, verified: 2, auto: 1 };
const OUTDATED_DAYS = 21;

// ------------------------------------------------------------ Datum
const pad = (n) => String(n).padStart(2, "0");
export const isoOf = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const dateOf = (iso) => new Date(iso.slice(0, 10) + "T12:00:00Z");
export const pyWeekday = (iso) => (dateOf(iso).getUTCDay() + 6) % 7; // Mo=0 … So=6
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const nowStamp = () => { const d = new Date(); return `${todayISO()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export const daysBetween = (a, b) => Math.round((dateOf(b) - dateOf(a)) / 86400000);

export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day, 12));
}
const holidayCache = {};
export function holidaysAT(y) {
  if (holidayCache[y]) return holidayCache[y];
  const s = new Set([[1, 1], [1, 6], [5, 1], [8, 15], [10, 26], [11, 1], [12, 8], [12, 25], [12, 26]].map(([m, d]) => `${y}-${pad(m)}-${pad(d)}`));
  const e = easter(y);
  for (const n of [1, 39, 50, 60]) s.add(isoOf(new Date(e.getTime() + n * 86400000)));
  return (holidayCache[y] = s);
}
export const isHoliday = (iso) => holidaysAT(+iso.slice(0, 4)).has(iso);
export function ageOn(birthIso, iso) {
  const [by, bm, bd] = birthIso.split("-").map(Number), [y, m, d] = iso.split("-").map(Number);
  return y - by - ((m < bm || (m === bm && d < bd)) ? 1 : 0);
}

// ------------------------------------------------------------ Saisonen
export function seasonIdForDate(iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  const s = m >= 10 ? y : y - 1;
  return `${s}-${pad((s + 1) % 100)}`;
}
export const seasonBounds = (id) => { const s = +id.slice(0, 4); return [`${s}-10-01`, `${s + 1}-09-30`]; };
export const seasonLabel = (id) => `${id.slice(0, 4)}/${id.slice(5)}`;
export function describeRange(lo, hi) {
  if (lo == null && hi == null) return "alle Jahrgänge";
  if (lo == null) return `Jahrgang ${hi} und älter`;
  if (hi == null) return `Jahrgang ${lo} und jünger`;
  return `Jahrgänge ${lo} bis ${hi}`;
}
export function categoryFor(season, birthIso, disability = false) {
  if (!season) return [null, "Saison unbekannt"];
  const year = +birthIso.slice(0, 4);
  if (disability) {
    const c = season.categories.find((c) => c.requires_flag === "disability");
    if (c) return [c, `Ermäßigung für Menschen mit Behinderung (GdB/MdE ab 60 %) laut Tarif ${season.label}`];
  }
  for (const c of season.categories) {
    if (c.requires_flag) continue;
    const lo = c.birth_year_from, hi = c.birth_year_to;
    if ((lo == null || year >= lo) && (hi == null || year <= hi)) return [c, `Jahrgang ${year} → ${c.label} (${describeRange(lo, hi)}) laut Tarif ${season.label}`];
  }
  return [null, `Für Jahrgang ${year} ist in der Saison ${season.label} keine Kategorie hinterlegt`];
}
// Saison ohne offizielle Daten: Jahrgangsgrenzen der nächsten bekannten Saison verschieben, als unbestätigt markieren
export function deriveSeason(id, known) {
  const start = +id.slice(0, 4);
  const ref = known.filter((s) => s.verified).sort((a, b) => Math.abs(+a.id.slice(0, 4) - start) - Math.abs(+b.id.slice(0, 4) - start))[0];
  if (!ref) return null;
  const shift = start - +ref.id.slice(0, 4);
  const [s, e] = seasonBounds(id);
  return {
    id, label: seasonLabel(id), start_date: s, end_date: e, source_url: null, verified: 0,
    notes: `Jahrgangsgrenzen aus Saison ${ref.label} um ${shift > 0 ? "+" : ""}${shift} Jahr(e) verschoben – nicht offiziell bestätigt. Preise unbekannt.`,
    categories: ref.categories.map((c) => ({ ...c, season_id: id, birth_year_from: c.birth_year_from != null ? c.birth_year_from + shift : null,
      birth_year_to: c.birth_year_to != null ? c.birth_year_to + shift : null, price_presale: null, price_regular: null, presale_until: null })),
  };
}

// ------------------------------------------------------------ Preisauswahl
export function defaultTicketType(category, tags, iso, name, categories) {
  const month = +iso.slice(5, 7);
  const glacier = norm(name).includes("gletscher");
  const winter = (glacier ? [10, 11, 12, 1, 2, 3, 4, 5, 6] : [11, 12, 1, 2, 3, 4]).includes(month);
  if (category === "ski" && !winter && (tags || []).includes("sommer:wandern")) return "berg_tal";
  return (categories[category] || categories.sonstiges).default_ticket;
}
function ageChain(age) {
  if (age <= 14) return ["kind", "jugend"];
  if (age <= 18) return ["jugend", "erwachsene"];
  if (age <= 63) return ["erwachsene"];
  return ["senior", "erwachsene"];
}
const explicit = (t) => ["age_min", "age_max", "birth_year_from", "birth_year_to"].some((k) => t[k] != null);
function explicitMatch(t, age, by) {
  if (t.birth_year_from != null || t.birth_year_to != null) {
    const lo = t.birth_year_from, hi = t.birth_year_to;
    return (lo == null || by >= lo) && (hi == null || by <= hi);
  }
  return (t.age_min == null || age >= t.age_min) && (t.age_max == null || age <= t.age_max);
}
function tightness(t, age, by) {
  let lo, hi, v;
  if (t.birth_year_from != null || t.birth_year_to != null) [lo, hi, v] = [t.birth_year_from, t.birth_year_to, by];
  else [lo, hi, v] = [t.age_min, t.age_max, age];
  if (lo != null && hi != null) return [0, hi - lo];
  if (lo != null) return [1, v - lo];
  return [1, hi - v];
}
const cmpTight = (a, b) => a[0] - b[0] || a[1] - b[1];
const within = (t, iso) => (!t.valid_from || t.valid_from <= iso) && (!t.valid_to || t.valid_to >= iso);
function specificity(t) {
  let s = explicit(t) ? 2 : 0;
  if (t.day_type !== "alle") s += 1;
  if (t.valid_from || t.valid_to) s += 1;
  if (t.season_type !== "alle" && (t.valid_from || t.valid_to)) s += 1;
  return s;
}
export function isOutdated(t, f, visitSeason) {
  if (["stale", "unreachable", "blocked"].includes(f.price_status)) return true;
  const lc = t.last_confirmed_at || t.found_at;
  if (t.status === "auto" && lc && daysBetween(lc.slice(0, 10), todayISO()) > OUTDATED_DAYS) return true;
  if (t.source_season && visitSeason && t.source_season < visitSeason) return true;
  return false;
}
export function ticketTypesFor(tariffs, TT) {
  const order = Object.keys(TT);
  return [...new Set(tariffs.map((t) => t.ticket_type))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map((k) => ({ key: k, label: TT[k] || k }));
}
function describeBounds(t) {
  if (t.birth_year_from != null || t.birth_year_to != null) return describeRange(t.birth_year_from, t.birth_year_to);
  if (t.age_min != null && t.age_max != null) return `${t.age_min}–${t.age_max} Jahre`;
  if (t.age_min != null) return `ab ${t.age_min} Jahren`;
  return `bis ${t.age_max} Jahre`;
}
const f2 = (v) => v.toFixed(2);
export const round2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

/**
 * ctx: { ticketTypes, categories (key->{default_ticket,label}), plausible }
 * opts: { ticket_type, tariff_id, regular_override, saving_override, inclusion_share, prior_visits }
 */
export function quote(ctx, facility, active, profile, iso, opts = {}) {
  const age = ageOn(profile.birth_date, iso), byear = +profile.birth_date.slice(0, 4);
  const weekend = pyWeekday(iso) >= 5, holiday = isHoliday(iso);
  const season_id = seasonIdForDate(iso);
  const tags = facility.tags || [];
  const expl = [], warn = [];
  const out = {
    facility_id: facility.id, kind: facility.kind, visit_date: iso, season_id, age, birth_year: byear, weekend, holiday,
    ticket_types: ticketTypesFor(active, ctx.ticketTypes), tariff: null, alternatives: [], regular_price: null, saving: null,
    paid_price: null, discount: null, status: "unavailable", explanation: expl, warnings: warn, possibly_outdated: false,
    inclusion_share: opts.inclusion_share ?? 1, prior_visits: opts.prior_visits || 0,
  };
  expl.push(`Alter am Besuchstag: ${age} Jahre (Jahrgang ${byear})`);
  if (weekend || holiday) expl.push(holiday ? "Feiertag in Österreich – Wochenend-/Feiertagstarife werden bevorzugt" : "Wochenende/Feiertag");
  let ticket_type = opts.ticket_type || null;
  let chosen = null, uncertain = false;
  if (opts.tariff_id != null && opts.tariff_id !== "") {
    chosen = active.find((t) => t.id === +opts.tariff_id) || null;
    if (chosen) { expl.push("Tarif manuell ausgewählt"); ticket_type = chosen.ticket_type; }
  }
  if (!chosen && active.length) {
    const available = out.ticket_types.map((x) => x.key);
    let wanted = ticket_type || defaultTicketType(facility.category, tags, iso, facility.name, ctx.categories);
    if (!available.includes(wanted)) {
      const pref = [wanted, "tageskarte", "einzeleintritt", "berg_tal", "halbtag", "stundenkarte", "abend", "bergfahrt", "sonstiges"];
      const orig = wanted;
      wanted = pref.find((p) => available.includes(p)) || available[0];
      if (ticket_type) warn.push(`Für „${ctx.ticketTypes[orig] || orig}“ ist kein Tarif hinterlegt`);
    }
    ticket_type = wanted;
    let pool = active.filter((t) => t.ticket_type === ticket_type);
    const [lo, hi] = ctx.plausible[facility.category] || [0.5, 150];
    const plausible = pool.filter((t) => t.status !== "auto" || (t.price >= lo && t.price <= hi));
    if (plausible.length < pool.length) expl.push("Unplausible automatische Funde nicht automatisch verwendet");
    pool = plausible;
    const dated = pool.filter((t) => within(t, iso));
    if (dated.length < pool.length) expl.push("Tarife außerhalb ihres Gültigkeitszeitraums ausgeschlossen");
    pool = dated;
    const wantDay = weekend || holiday ? "wochenende" : "werktag";
    pool = pool.filter((t) => t.day_type === "alle" || t.day_type === wantDay);
    if (pool.some((t) => t.day_type === wantDay)) expl.push(wantDay === "wochenende" ? "Wochenend-/Feiertagstarif" : "Werktagstarif");
    const expl_ = pool.filter(explicit);
    let matches = expl_.filter((t) => explicitMatch(t, age, byear));
    if (matches.length > 1) {
      const best = matches.map((t) => tightness(t, age, byear)).sort(cmpTight)[0];
      matches = matches.filter((t) => cmpTight(tightness(t, age, byear), best) === 0);
    }
    let pool2 = [];
    if (matches.length) {
      pool2 = [...matches, ...pool.filter((t) => !explicit(t) && t.age_group === "alle")];
      expl.push("Altersgrenze laut Betreiber: " + describeBounds(matches[0]));
    } else {
      const nonExplicit = pool.filter((t) => !explicit(t));
      for (const g of ageChain(age)) {
        pool2 = nonExplicit.filter((t) => t.age_group === g);
        if (pool2.length) {
          if (g === "erwachsene" && age >= 20 && age <= 59) expl.push("Erwachsenentarif (eindeutig, Alter weit von allen üblichen Altersgrenzen entfernt)");
          else { uncertain = true; expl.push(`Betreiber nennt keine Altersgrenzen – Zuordnung über Bezeichnung „${g}“ (bitte prüfen)`); }
          break;
        }
      }
      if (!pool2.length) {
        pool2 = nonExplicit.filter((t) => t.age_group === "alle" || t.age_group === "unbekannt");
        if (pool2.length) { uncertain = true; expl.push("Tarif ohne Altersangabe verwendet (gilt vermutlich für alle) – bitte prüfen"); }
      }
      if (!pool2.length && expl_.length) warn.push("Keine Altersgruppe des Betreibers passt zu deinem Alter");
    }
    // Selbst ergänzte Preise immer berücksichtigen (haben Vorrang vor automatischen Funden)
    const own = pool.filter((t) => t.status === "user" && !pool2.includes(t) &&
      (explicit(t) ? explicitMatch(t, age, byear) : (t.age_group === "alle" || ageChain(age).includes(t.age_group))));
    if (own.length) pool2 = [...pool2, ...own];
    const seasonal = new Set(pool2.filter((t) => !(t.valid_from || t.valid_to)).map((t) => t.season_type));
    if (seasonal.has("haupt") && seasonal.has("neben")) { uncertain = true; expl.push("Haupt-/Nebensaison ohne Zeitraum angegeben – niedrigerer Preis gewählt"); }
    if (pool2.length) {
      pool2.sort((a, b) => (STATUS_RANK[b.status] - STATUS_RANK[a.status]) || (specificity(b) - specificity(a)) || ((b.confidence || 0) - (a.confidence || 0)) || (a.price - b.price));
      const top = pool2[0];
      // nur gleich verlässliche Funde vergleichen (unbeschriftete Zeilen verlieren gegen klar beschriftete)
      const same = pool2.filter((t) => STATUS_RANK[t.status] === STATUS_RANK[top.status] && specificity(t) === specificity(top) &&
        (t.confidence || 0) >= (top.confidence || 0) - 0.1);
      const prices = [...new Set(same.map((t) => round2(t.price)))].sort((a, b) => a - b);
      if (prices.length > 1) {
        uncertain = true;
        chosen = same.reduce((m, t) => (t.price < m.price ? t : m));
        expl.push(`Mehrere passende Preise (${prices.map((p) => f2(p) + " €").join(", ")}) – niedrigster gewählt`);
      } else chosen = top;
    }
    out.alternatives = active.filter((t) => t.ticket_type === ticket_type).sort((a, b) => a.price - b.price);
  }
  out.ticket_type = ticket_type || defaultTicketType(facility.category, tags, iso, facility.name, ctx.categories);
  if (chosen) {
    out.tariff = chosen;
    out.regular_price = round2(chosen.price);
    out.possibly_outdated = isOutdated(chosen, facility, season_id);
    if (chosen.status === "auto") {
      uncertain = uncertain || (chosen.confidence || 0) < 0.5;
      expl.push(`Automatisch recherchiert (${Math.round((chosen.confidence || 0) * 100)} % Sicherheit)`);
    } else expl.push(chosen.status === "verified" ? "Bestätigter Preis" : "Von dir ergänzter Preis");
    if (chosen.note) warn.push(chosen.note);
    if (out.possibly_outdated) warn.push("Preis möglicherweise veraltet – letzte Bestätigung: " + ((chosen.last_confirmed_at || chosen.found_at || "unbekannt").slice(0, 10)));
    out.status = uncertain ? "uncertain" : "ok";
  }
  if (opts.regular_override != null && opts.regular_override !== "") {
    out.regular_price = round2(+opts.regular_override);
    out.status = "manual";
    expl.push("Regulärer Preis manuell angepasst");
  }
  if (out.regular_price == null) {
    out.status = "unavailable";
    warn.push("Kein regulärer Preis verfügbar – bitte selbst eintragen");
    return out;
  }
  computeSaving(out, facility, iso, opts.saving_override, opts.inclusion_share ?? 1);
  return out;
}

export function computeSaving(out, facility, iso, savingOverride = null, inclusionShare = 1) {
  const reg = out.regular_price;
  const share = Math.max(0, Math.min(1, +(inclusionShare ?? 1)));
  out.inclusion_share = share;
  const rules = facility.special_rules || {};
  let saving;
  if (facility.kind === "included") {
    saving = round2(reg * share);
    if (share < 1) out.explanation.push(`Nur teilweise inkludiert: ${Math.round(share * 100)} % angerechnet`);
    out.discount = null;
    out.special_rules = rules;
    const mx = rules.max_entries;
    if (mx && out.prior_visits >= mx) {
      saving = 0;
      out.warnings.push(`Das Freizeitticket gilt hier für ${mx} Zutritte pro Saison – dieser Besuch ist nicht mehr inkludiert`);
    } else if (mx) out.explanation.push(`Zutritt ${out.prior_visits + 1} von ${mx} inkludierten`);
    if (rules.note) out.explanation.push("Sonderregelung: " + rules.note);
  } else {
    let applicable = true;
    const reasons = [];
    if (rules.weekdays && !rules.weekdays.includes(pyWeekday(iso))) {
      applicable = false;
      reasons.push("Rabatt gilt nur " + rules.weekdays.map((d) => ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][d]).join(", "));
    }
    if ((rules.valid_from && iso < rules.valid_from) || (rules.valid_to && iso > rules.valid_to)) {
      applicable = false;
      reasons.push(`Aktion gilt ${rules.valid_from || "?"} bis ${rules.valid_to || "?"}${rules.approximate_dates ? " (ca.)" : ""}`);
    }
    const pct = facility.discount_percent, amount = facility.discount_amount;
    out.discount = { label: facility.discount_label, percent: pct, amount, applicable, reasons, rules };
    if (!applicable) { saving = 0; out.warnings.push(...reasons); }
    else if (pct) { saving = round2(reg * pct / 100); out.explanation.push(`Bonuspartner: ${pct} % Rabatt auf ${f2(reg)} €`); }
    else if (amount) { saving = round2(Math.min(amount, reg)); out.explanation.push(`Bonuspartner: ${f2(amount)} € Ermäßigung`); }
    else { saving = null; out.warnings.push("Rabatt nicht in Euro bezifferbar – Ersparnis bitte selbst eintragen"); }
    if (rules.not_combinable) out.explanation.push("Nicht mit anderen Rabatten kombinierbar");
  }
  if (savingOverride != null && savingOverride !== "") {
    saving = round2(Math.max(0, Math.min(+savingOverride, reg)));
    out.explanation.push("Ersparnis manuell angepasst");
  }
  out.saving = saving;
  out.paid_price = saving != null ? round2(reg - saving) : null;
  return out;
}
