// Hilfsfunktionen, Icons und UI-Bausteine

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const eur = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat("de-AT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtEUR = (v, round = false) => (v == null || isNaN(v) ? "–" : (round ? eur0 : eur).format(v));
export const fmtNum = (v) => num2.format(v || 0);
export const fmtSigned = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmtEUR(Math.abs(v));
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const MONTHS_S = ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export const parseISO = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
export const fmtDate = (s) => { if (!s) return "–"; const d = parseISO(s); return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtDateShort = (s) => { if (!s) return "–"; const d = parseISO(s); return `${WD[d.getDay()]}, ${d.getDate()}. ${MONTHS_S[d.getMonth()]}`; };
export const fmtMonth = (ym) => { const [y, m] = ym.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const relDate = (iso) => {
  const t = todayISO();
  if (iso === t) return "Heute";
  if (iso === addDays(t, -1)) return "Gestern";
  return fmtDateShort(iso);
};
export const seasonOf = (iso) => { const d = parseISO(iso); const y = d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };
export const seasonLabel = (id) => id ? id.replace("-", "/") : "";

export const norm = (s) => String(s || "").toLowerCase().replace(/ß/g, "ss").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const store = {
  get(k, d = null) { try { const v = localStorage.getItem("ft:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("ft:" + k, JSON.stringify(v)); } catch { /* privat / voll */ } },
  del(k) { try { localStorage.removeItem("ft:" + k); } catch { /* */ } },
};

// ------------------------------------------------------------ Kategorien
export const CAT = {
  ski: { e: "⛷️", c: "#0a84ff", l: "Skigebiet & Skilift" },
  bergbahn: { e: "🚡", c: "#30b0c7", l: "Bergbahn" },
  nacht: { e: "🌙", c: "#5e5ce6", l: "Nachtrodeln & Nachtski" },
  rodeln: { e: "🛷", c: "#ff9f0a", l: "Rodelbahn" },
  hallenbad: { e: "🏊", c: "#32ade6", l: "Hallenbad" },
  freibad: { e: "☀️", c: "#f5b400", l: "Freibad" },
  badesee: { e: "🌊", c: "#00c7be", l: "Badesee" },
  sauna: { e: "🧖", c: "#ff6b35", l: "Sauna & Therme" },
  eislaufen: { e: "⛸️", c: "#4fb3e8", l: "Eislaufplatz & Eishalle" },
  museum: { e: "🏛️", c: "#bf5af2", l: "Museum" },
  sehenswert: { e: "🏰", c: "#ff375f", l: "Sehenswürdigkeit" },
  sport: { e: "🧗", c: "#34c759", l: "Sport & Freizeit" },
  einkaufen: { e: "🛍️", c: "#ac8e68", l: "Einkaufen" },
  sonstiges: { e: "⭐", c: "#8e8e93", l: "Weitere Angebote" },
};
export const cat = (k) => CAT[k] || CAT.sonstiges;
export const catIcon = (k, size = 38) => `<span class="ic" style="background:${cat(k).c};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px">${cat(k).e}</span>`;
export const SEARCH_ALIASES = {
  schwimmbad: ["hallenbad", "freibad", "badesee"], baden: ["hallenbad", "freibad", "badesee"], bad: ["hallenbad", "freibad", "badesee", "sauna"],
  schwimmen: ["hallenbad", "freibad", "badesee"], ski: ["ski"], skifahren: ["ski"], skigebiet: ["ski"], lift: ["ski", "bergbahn"],
  bergbahn: ["bergbahn", "ski"], gondel: ["bergbahn", "ski"], seilbahn: ["bergbahn", "ski"], wandern: ["bergbahn", "ski"],
  museum: ["museum", "sehenswert"], kultur: ["museum", "sehenswert"], eislaufen: ["eislaufen"], eis: ["eislaufen"], eislaufplatz: ["eislaufen"],
  rodeln: ["rodeln", "nacht"], rodelbahn: ["rodeln"], sauna: ["sauna"], therme: ["sauna"], sehenswuerdigkeit: ["sehenswert", "museum"],
  see: ["badesee"], hallenbad: ["hallenbad"], freibad: ["freibad"], shop: ["einkaufen"], einkaufen: ["einkaufen"], sport: ["sport"],
};

// ------------------------------------------------------------ Icons (SF-Symbol-artig)
const sv = (p, s = 24, extra = "") => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${p}</svg>`;
export const I = {
  home: (s) => sv('<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>', s),
  list: (s) => sv('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>', s),
  chart: (s) => sv('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', s),
  person: (s) => sv('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>', s),
  search: (s = 20) => sv('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', s),
  plus: (s = 20) => sv('<path d="M12 5v14M5 12h14"/>', s, 'stroke-width="2.6"'),
  map: (s = 22) => sv('<path d="m9 4-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>', s),
  star: (s = 20, filled = false) => sv('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>', s, filled ? 'fill="currentColor"' : ""),
  trophy: (s = 22) => sv('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>', s),
  sparkle: (s = 22) => sv('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>', s),
  chev: (s = 16) => sv('<path d="m9 6 6 6-6 6"/>', s),
  back: (s = 22) => sv('<path d="m15 6-6 6 6 6"/>', s, 'stroke-width="2.4"'),
  close: (s = 16) => sv('<path d="M6 6l12 12M18 6 6 18"/>', s, 'stroke-width="2.6"'),
  warn: (s = 18) => sv('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>', s),
  info: (s = 18) => sv('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/>', s),
  check: (s = 18) => sv('<path d="m5 12 5 5 9-10"/>', s, 'stroke-width="2.6"'),
  edit: (s = 18) => sv('<path d="M4 20h4L19 9l-4-4L4 16z"/>', s),
  trash: (s = 18) => sv('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', s),
  link: (s = 16) => sv('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>', s),
  refresh: (s = 18) => sv('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>', s),
  download: (s = 18) => sv('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', s),
  upload: (s = 18) => sv('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>', s),
  calendar: (s = 18) => sv('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>', s),
  shield: (s = 18) => sv('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>', s),
  logout: (s = 18) => sv('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>', s),
  euro: (s = 18) => sv('<path d="M18 6.5A7 7 0 1 0 18 17.5M4 10h9M4 14h9"/>', s),
  pin: (s = 16) => sv('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>', s),
  globe: (s = 16) => sv('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', s),
  phone: (s = 16) => sv('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>', s),
  clock: (s = 16) => sv('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', s),
};

// ------------------------------------------------------------ UI-Bausteine
export function toast(msg, ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.getElementById("toasts").appendChild(el);
  setTimeout(() => { el.style.transition = "opacity .3s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, ms);
}

export function dialog({ title, text = "", buttons = [{ label: "OK", value: true, cls: "primary" }] }) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "dialog-back";
    back.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}<div class="btns">
      ${buttons.map((b, i) => `<button class="btn block ${b.cls || ""}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
    back.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i]");
      if (b) { back.remove(); resolve(buttons[+b.dataset.i].value); }
      else if (e.target === back) { back.remove(); resolve(null); }
    });
    document.getElementById("overlays").appendChild(back);
  });
}
export const confirmDlg = (title, text, ok = "Bestätigen", danger = false) =>
  dialog({ title, text, buttons: [{ label: ok, value: true, cls: danger ? "danger" : "primary" }, { label: "Abbrechen", value: false }] });

let sheetStack = [];
export function openSheet(html, { onClose } = {}) {
  const back = document.createElement("div");
  back.className = "sheet-backdrop";
  const sh = document.createElement("div");
  sh.className = "sheet";
  sh.setAttribute("role", "dialog");
  sh.innerHTML = `<div class="grab"></div><div class="sheet-body">${html}</div>`;
  const ov = document.getElementById("overlays");
  ov.append(back, sh);
  requestAnimationFrame(() => { back.classList.add("open"); sh.classList.add("open"); });
  const api = {
    el: sh, body: sh.querySelector(".sheet-body"),
    set(h) { api.body.innerHTML = h; },
    close() {
      sh.classList.remove("open"); back.classList.remove("open");
      setTimeout(() => { sh.remove(); back.remove(); }, 330);
      sheetStack = sheetStack.filter((s) => s !== api);
      onClose && onClose();
    },
  };
  back.addEventListener("click", () => api.close());
  // nach unten wischen zum Schließen
  let y0 = null, dy = 0;
  const grab = sh.querySelector(".grab");
  const start = (e) => { if (api.body.scrollTop > 0 && e.target !== grab) return; y0 = e.touches ? e.touches[0].clientY : e.clientY; dy = 0; sh.style.transition = "none"; };
  const move = (e) => { if (y0 == null) return; dy = Math.max(0, (e.touches ? e.touches[0].clientY : e.clientY) - y0); if (dy > 4) sh.style.transform = `translateY(${dy}px)`; };
  const end = () => { if (y0 == null) return; sh.style.transition = ""; sh.style.transform = ""; if (dy > 110) api.close(); y0 = null; };
  sh.addEventListener("touchstart", start, { passive: true });
  sh.addEventListener("touchmove", move, { passive: true });
  sh.addEventListener("touchend", end);
  sheetStack.push(api);
  return api;
}
export const closeAllSheets = () => [...sheetStack].forEach((s) => s.close());
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetStack.length) sheetStack[sheetStack.length - 1].close(); });

export function countUp(el, to, { dur = 1100, fmt = fmtNum } = {}) {
  if (!el) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const from = 0, t0 = performance.now();
  if (reduce || !to) { el.textContent = fmt(to); return; }
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function confetti() {
  const box = document.createElement("div");
  box.className = "confetti";
  const colors = ["#34c759", "#0a84ff", "#ff9f0a", "#ff375f", "#bf5af2", "#ffd60a"];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement("i");
    c.style.left = Math.random() * 100 + "vw";
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.8 + Math.random() * 1.8 + "s";
    c.style.animationDelay = Math.random() * 0.5 + "s";
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(c);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 4200);
}

export function download(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
