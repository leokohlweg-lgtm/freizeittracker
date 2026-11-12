// Mehrere Tickets auf einem Gerät: Wechseln, hinzufügen (jedes Ticket ist komplett unabhängig)
import { listTickets, switchTicket, addTicket } from "../local/local.js";
import { S, refreshUser, invalidate, go } from "../state.js";
import { esc, fmtEUR, I, openSheet, closeAllSheets, toast, haptic } from "../util.js";
import { resetRegistration } from "./onboarding.js";
import { trackEvent } from "../analytics.js";

export function ticketRows(tickets) {
  return tickets.map((t) => `<button class="item ticket-row ${t.active ? "on" : ""}" data-ticket="${esc(t.id)}">
    <span class="avatar" style="width:40px;height:40px;${t.has_profile ? "" : "background:var(--surface-3);color:var(--text-2)"}">${esc(t.initials)}</span>
    <div class="grow"><div class="t ellipsis">${esc(t.name)}</div>
      <div class="s" style="white-space:normal">${t.has_profile ? `${esc(t.category_label || "")}${t.season_label ? " · " + esc(t.season_label) : ""} · ${t.visits} Besuch${t.visits === 1 ? "" : "e"}` : "Einrichtung noch nicht abgeschlossen"}</div></div>
    ${t.has_profile ? `<div class="amt pos num">+${esc(fmtEUR(t.saving, true))}</div>` : ""}
    ${t.active ? `<span style="color:var(--green)">${I.check(18)}</span>` : ""}</button>`).join("");
}

export async function activateTicket(id) {
  if (!switchTicket(id)) return;
  invalidate();
  S.facilities = null;
  haptic(10);
  try {
    await refreshUser();
    toast(`Ticket von ${S.user.first_name}`);
    go("#/home");
  } catch {
    // Ticket ohne abgeschlossene Einrichtung
    S.user = null;
    resetRegistration();
    go("#/register");
  }
}

export function startNewTicket() {
  addTicket();
  invalidate();
  S.facilities = null;
  S.user = null;
  resetRegistration();
  trackEvent("ticket-hinzugefuegt");
  closeAllSheets();
  go("#/register");
}

export function openTicketSwitcher() {
  const render = () => {
    const tickets = listTickets();
    sheet.set(`<div class="row between" style="margin:6px 0 4px"><h2 style="margin:0;font-size:22px">Tickets auf diesem Handy</h2>
        <button class="close-x" id="tk-close" aria-label="Schließen">${I.close()}</button></div>
      <p class="small muted" style="margin:0 0 14px">Jedes Ticket hat eigene Besuche, Statistiken und Sicherungen – völlig unabhängig voneinander.</p>
      <div class="list">${ticketRows(tickets)}</div>
      <button class="btn block" style="margin-top:14px" id="tk-add">${I.plus(18)} Weiteres Ticket hinzufügen</button>`);
    sheet.body.querySelector("#tk-close").onclick = () => sheet.close();
    sheet.body.querySelector("#tk-add").onclick = () => { sheet.close(); startNewTicket(); };
    sheet.body.querySelectorAll("[data-ticket]").forEach((b) => (b.onclick = () => {
      const t = tickets.find((x) => x.id === b.dataset.ticket);
      sheet.close();
      if (!t.active || !t.has_profile) activateTicket(t.id);
    }));
  };
  const sheet = openSheet("");
  render();
  return sheet;
}
