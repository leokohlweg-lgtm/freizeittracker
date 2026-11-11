// Leichtgewichtige SVG-Diagramme (keine Abhängigkeiten)
import { esc, fmtEUR, parseISO } from "./util.js";

let gid = 0;

// Aktivitätsring im Stil von Apple Fitness; >100 % läuft als zweite Runde weiter
export function ring(progress, { size = 104, stroke = 12, color = "#34c759", track = "rgba(255,255,255,.14)" } = {}) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const p1 = Math.min(1, progress), p2 = Math.max(0, Math.min(1, progress - 1));
  const id = "rg" + ++gid;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a6f4c5"/><stop offset="1" stop-color="${color}"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#${id})" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - p1)}" style="transition:stroke-dashoffset 1.3s cubic-bezier(.2,.8,.2,1)"/>
    ${p2 > 0 ? `<circle class="ring-arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#e8fff0" stroke-width="${stroke}" stroke-linecap="round" opacity=".9"
      stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - p2)}" style="transition:stroke-dashoffset 1.3s cubic-bezier(.2,.8,.2,1) .9s"/>` : ""}
  </svg>`;
}
export const animateRings = (root) => requestAnimationFrame(() => setTimeout(() =>
  root.querySelectorAll(".ring-arc").forEach((a) => (a.style.strokeDashoffset = a.dataset.target)), 30));

// Kumulierte Ersparnis mit Gewinnschwelle (Ticketpreis)
export function areaChart(points, { threshold = null, start, end, height = 190 } = {}) {
  const W = 340, H = height, pl = 4, pr = 4, pt = 16, pb = 22;
  if (!points.length) return `<div class="empty small">Noch keine Daten</div>`;
  const t0 = parseISO(start).getTime(), t1 = Math.max(parseISO(end).getTime(), t0 + 1);
  const maxY = Math.max(threshold || 0, ...points.map((p) => p.cum)) * 1.12 || 1;
  const x = (iso) => pl + ((parseISO(iso).getTime() - t0) / (t1 - t0)) * (W - pl - pr);
  const y = (v) => pt + (1 - v / maxY) * (H - pt - pb);
  const pts = [{ date: start, cum: 0 }, ...points];
  let d = `M${x(pts[0].date)},${y(0)}`;
  for (let i = 1; i < pts.length; i++) d += ` H${x(pts[i].date).toFixed(1)} V${y(pts[i].cum).toFixed(1)}`;
  const last = pts[pts.length - 1];
  const today = new Date();
  const xe = Math.min(x(last.date) + 0, W - pr);
  const area = d + ` H${xe} V${y(0)} Z`;
  const id = "ag" + ++gid;
  const months = [];
  const s = parseISO(start);
  for (let i = 0; i < 12; i += 2) {
    const m = new Date(s.getFullYear(), s.getMonth() + i, 1);
    months.push({ x: pl + ((m.getTime() - t0) / (t1 - t0)) * (W - pl - pr), l: ["Jän", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][m.getMonth()] });
  }
  const tx = Math.min(W - pr, pl + ((today.getTime() - t0) / (t1 - t0)) * (W - pl - pr));
  const cross = threshold ? pts.find((p) => p.cum >= threshold) : null;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entwicklung der Ersparnis">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#34c759" stop-opacity=".38"/><stop offset="1" stop-color="#34c759" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line class="grid" x1="0" x2="${W}" y1="${y(maxY * f)}" y2="${y(maxY * f)}"/>`).join("")}
    ${months.map((m) => `<text x="${m.x + 2}" y="${H - 6}">${m.l}</text>`).join("")}
    ${threshold ? `<line class="thr" x1="0" x2="${W}" y1="${y(threshold)}" y2="${y(threshold)}"/><text class="thr-label" x="${W - 4}" y="${y(threshold) - 5}" text-anchor="end">Ticketpreis ${esc(fmtEUR(threshold, true))}</text>` : ""}
    <path d="${area}" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="#34c759" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${tx > pl && tx < W ? `<line x1="${tx}" x2="${tx}" y1="${pt}" y2="${H - pb}" stroke="var(--text-3)" stroke-dasharray="2 3"/>` : ""}
    ${cross ? `<circle cx="${x(cross.date)}" cy="${y(cross.cum)}" r="5" fill="#ff9f0a" stroke="var(--surface)" stroke-width="2"/>` : ""}
    <circle cx="${x(last.date)}" cy="${y(last.cum)}" r="4.5" fill="#34c759" stroke="var(--surface)" stroke-width="2"/>
  </svg>`;
}

// Balken pro Monat
export function barChart(data, { key = "saving", fmt = (v) => fmtEUR(v, true), height = 170, color = "#34c759" } = {}) {
  const W = 340, H = height, pb = 22, pt = 18;
  const max = Math.max(...data.map((d) => d[key]), 0) || 1;
  const bw = W / data.length;
  const bars = data.map((d, i) => {
    const h = (d[key] / max) * (H - pb - pt);
    const xx = i * bw + bw * 0.18, w = bw * 0.64;
    const yy = H - pb - h;
    return `<g><rect x="${xx}" y="${H - pb - (H - pb - pt)}" width="${w}" height="${H - pb - pt}" rx="5" fill="var(--surface-2)"/>
      ${h > 0 ? `<rect x="${xx}" y="${yy}" width="${w}" height="${h}" rx="5" fill="${color}"><animate attributeName="height" from="0" to="${h}" dur=".7s" fill="freeze"/><animate attributeName="y" from="${H - pb}" to="${yy}" dur=".7s" fill="freeze"/></rect>` : ""}
      ${d[key] > 0 ? `<text x="${xx + w / 2}" y="${yy - 4}" text-anchor="middle" style="font-size:9px;font-weight:700;fill:var(--text)">${esc(fmt(d[key]))}</text>` : ""}
      <text x="${xx + w / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text></g>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monatswerte">${bars}</svg>`;
}

// Ringdiagramm nach Kategorien
export function donut(items, { size = 140, stroke = 22 } = {}) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  let off = 0;
  const segs = items.map((it) => {
    const len = (it.value / total) * c;
    const gap = items.length > 1 ? Math.min(3, len * 0.3) : 0;
    const s = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${it.color}" stroke-width="${stroke}"
      stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-off}"/>`;
    off += len;
    return s;
  }).join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="transform:rotate(-90deg)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${stroke}"/>${segs}</svg>`;
}

export function hbars(items, { fmt = (v) => v, color = "#34c759" } = {}) {
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  return items.map((i) => `<div class="hbar"><div class="hb-top"><span class="ellipsis">${esc(i.label)}</span><b class="num">${esc(fmt(i.value, i))}</b></div>
    <div class="hb-track"><i style="width:${(i.value / max) * 100}%;background:${i.color || color}"></i></div></div>`).join("");
}

// Saisonvergleich: gruppierte Balken Ersparnis vs. Ticketpreis
export function compareChart(seasons) {
  const W = 340, H = 180, pb = 24, pt = 18;
  const max = Math.max(...seasons.flatMap((s) => [s.gross, s.purchase_price]), 1);
  const gw = W / seasons.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}">${seasons.map((s, i) => {
    const bw = Math.min(34, gw * 0.3), x0 = i * gw + gw / 2 - bw - 3;
    const h1 = (s.purchase_price / max) * (H - pb - pt), h2 = (s.gross / max) * (H - pb - pt);
    return `<rect x="${x0}" y="${H - pb - h1}" width="${bw}" height="${h1}" rx="5" fill="var(--surface-3)"/>
      <rect x="${x0 + bw + 6}" y="${H - pb - h2}" width="${bw}" height="${h2}" rx="5" fill="#34c759"/>
      <text x="${x0 + bw + 6 + bw / 2}" y="${H - pb - h2 - 4}" text-anchor="middle" style="font-size:9px;font-weight:700;fill:var(--text)">${esc(fmtEUR(s.gross, true))}</text>
      <text x="${i * gw + gw / 2}" y="${H - 6}" text-anchor="middle">${esc(s.label)}</text>`;
  }).join("")}</svg>`;
}
