// Saisonrückblick im Story-Format
import { api } from "../api.js";
import { go } from "../state.js";
import { esc, fmtEUR, fmtNum, countUp, I, cat } from "../util.js";

const BG = [
  "linear-gradient(160deg,#0f3b2a 0%,#134e4a 50%,#0a84ff 100%)",
  "linear-gradient(160deg,#1d976c 0%,#0f3b2a 100%)",
  "linear-gradient(160deg,#ff375f 0%,#bf5af2 100%)",
  "linear-gradient(160deg,#0a84ff 0%,#5e5ce6 100%)",
  "linear-gradient(160deg,#ff9f0a 0%,#ff375f 100%)",
  "linear-gradient(160deg,#5e5ce6 0%,#bf5af2 60%,#ff375f 100%)",
  "linear-gradient(160deg,#30b0c7 0%,#0f3b2a 100%)",
  "linear-gradient(160deg,#1c1c1e 0%,#3a3a3c 100%)",
  "linear-gradient(160deg,#34c759 0%,#0a84ff 100%)",
];

export async function renderWrapped(root, sid) {
  root.innerHTML = `<div class="wrapped" style="background:${BG[0]}"><div class="w-slide"><span class="spin"></span></div></div>`;
  let w;
  try { w = await api(`/api/wrapped?season=${sid}`); }
  catch (e) { root.innerHTML = `<div class="view"><div class="empty">${esc(e.message)}</div></div>`; return; }
  const el = root.querySelector(".wrapped");
  if (!w.slides.length) {
    el.innerHTML = `<button class="w-close" aria-label="Schließen">${I.close(20)}</button><div class="w-slide"><div class="w-k">Saison ${esc(w.season.label)}</div>
      <div class="w-v" style="font-size:44px">Noch nichts zu erzählen</div><div class="w-t">Erfasse Besuche – am Ende der Saison wartet hier dein persönlicher Rückblick.</div></div>`;
    el.querySelector(".w-close").onclick = () => go("#/stats");
    return;
  }
  let i = 0, timer = null;
  const show = () => {
    clearTimeout(timer);
    const s = w.slides[i];
    el.style.background = BG[i % BG.length];
    let content = "";
    if (s.kind === "big" || s.kind === "net" || s.kind === "record") {
      content = `<div class="w-k">${esc(s.title)}</div><div class="w-v num"><span id="wv">0</span> €</div><div class="w-t">${esc(s.text || "")}</div>`;
    } else if (s.kind === "stats") {
      content = `<div class="w-k">${esc(s.title)}</div><div class="w-grid">${s.items.map((it) => `<div><b>${esc(it.value)}</b><span>${esc(it.label)}</span></div>`).join("")}</div>`;
    } else if (s.kind === "category") {
      content = `<div class="w-k">${esc(s.title)}</div><div class="w-v" style="font-size:clamp(36px,11vw,64px)">${esc(s.value)}</div><div class="w-t">${esc(s.text)}</div>
        <div style="margin-top:22px">${s.breakdown.map((c) => `<div class="row between" style="padding:6px 0;font-weight:600"><span>${cat(c.category).e} ${esc(c.label)}</span><span>${esc(fmtEUR(c.saving, true))}</span></div>`).join("")}</div>`;
    } else if (s.kind === "month") {
      const max = Math.max(...s.monthly.map((m) => m.saving), 1);
      content = `<div class="w-k">${esc(s.title)}</div><div class="w-v" style="font-size:clamp(36px,11vw,64px)">${esc(s.value)}</div><div class="w-t">${esc(s.text)}</div>
        <div style="display:flex;align-items:flex-end;gap:5px;height:120px;margin-top:26px">${s.monthly.map((m) => `<div style="flex:1;text-align:center"><div style="height:${(m.saving / max) * 100}px;background:rgba(255,255,255,${m.saving === max ? 1 : 0.35});border-radius:6px"></div><div style="font-size:10px;margin-top:4px;opacity:.8">${esc(m.label[0])}</div></div>`).join("")}</div>`;
    } else {
      content = `<div class="w-k">${esc(s.title)}</div><div class="w-v" style="font-size:clamp(34px,10vw,60px)">${esc(s.value ?? "")}</div><div class="w-t">${esc(s.text || "")}</div>`;
    }
    el.innerHTML = `<div class="w-bg" aria-hidden="true"></div><div class="bars">${w.slides.map((_, j) => `<i class="${j < i ? "done" : j === i ? "cur" : ""}"><b></b></i>`).join("")}</div>
      <button class="w-close" aria-label="Schließen">${I.close(20)}</button>
      ${w.preview && i === 0 ? `<div style="text-align:center;font-size:12px;opacity:.8;margin-top:10px">Vorschau – die Saison läuft noch</div>` : ""}
      <div class="w-tap" style="left:0" data-dir="-1"></div><div class="w-tap" style="right:0" data-dir="1"></div>
      <div class="w-slide">${content}</div>`;
    el.querySelector(".w-close").onclick = () => { clearTimeout(timer); go("#/stats"); };
    el.querySelectorAll(".w-tap").forEach((t) => (t.onclick = () => step(+t.dataset.dir)));
    const wv = el.querySelector("#wv");
    if (wv) countUp(wv, Math.abs(s.value), { fmt: (v) => (s.value < 0 ? "−" : "") + fmtNum(v), dur: 1400 });
    timer = setTimeout(() => step(1), 6000);
  };
  const step = (d) => {
    if (!document.body.contains(el)) return clearTimeout(timer);
    const n = i + d;
    if (n < 0) return;
    if (n >= w.slides.length) { clearTimeout(timer); go("#/stats"); return; }
    i = n; show();
  };
  el.addEventListener("click", (e) => { if (!e.target.closest(".w-close, .w-tap")) step(1); });
  document.addEventListener("keydown", function k(e) {
    if (!document.body.contains(el)) return document.removeEventListener("keydown", k);
    if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "Escape") go("#/stats");
  });
  show();
}
