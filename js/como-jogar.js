/* Página "Como jogar": monta as abas (Xadrez, Dama, Gamão) a partir de js/como-jogar-data.js.
   • A aba vem do hash (#xadrez, #dama, #gamao); os jogos linkam direto para a aba certa.
   • Só usa o hash para escolher a aba (um nome simples, sem barra nem parâmetros). */
import { GUIDES, GUIDE_IDS } from "./como-jogar-data.js";

const $ = id => document.getElementById(id);
const tabs = $("cjTabs"), panels = $("cjPanels");

const legendHtml = legend => `<aside class="cj-legend" aria-label="Como ler as figuras"><h3>Como ler as figuras</h3><ul>` +
  legend.map(([kind, text]) => `<li><span class="lg lg-${kind}" aria-hidden="true"></span>${text}</li>`).join("") + `</ul></aside>`;

const figureHtml = f => `<figure class="cj-fig ${f.cls ?? ""}">${f.html}<figcaption>${f.caption}</figcaption></figure>`;

function sectionHtml(guide, sec, index) {
  const hid = `${guide.id}-${sec.id}-h`;
  const tips = (sec.tips ?? []).map(t => `<aside class="cj-tip"><b>Dica</b><p>${t}</p></aside>`).join("");
  return `<section class="cj-sec" id="${guide.id}-${sec.id}" aria-labelledby="${hid}">` +
    `<div class="cj-sec-head"><span class="cj-num" aria-hidden="true">${index + 1}</span><h3 id="${hid}">${sec.title}</h3></div>` +
    `<div class="cj-sec-body${sec.grid ? " is-grid" : ""}">` +
      `<div class="cj-text">${sec.body.map(p => `<p>${p}</p>`).join("")}${tips}</div>` +
      (sec.figures?.length ? `<div class="cj-figs">${sec.figures.map(figureHtml).join("")}</div>` : "") +
    `</div></section>`;
}

function guideHtml(g) {
  const toc = g.sections.map((s, i) => `<button type="button" class="cj-toc-item" data-target="${g.id}-${s.id}"><span>${i + 1}</span>${s.title}</button>`).join("") +
    `<button type="button" class="cj-toc-item" data-target="${g.id}-tela"><span>★</span>${g.screen.title}</button>`;
  const steps = g.screen.steps.map(([title, text]) => `<li><div><b>${title}</b><p>${text}</p></div></li>`).join("");
  return `<article class="cj-guide">` +
    `<header class="cj-hero"><div class="cj-hero-text"><h2>${g.title}</h2><p class="cj-lead">${g.lead}</p><div class="cj-chips">${g.chips}</div></div>` +
    `<a class="cj-cta" href="${g.cta.href}">${g.cta.label}</a></header>` +
    legendHtml(g.legend) +
    `<nav class="cj-toc" aria-label="Neste guia">${toc}</nav>` +
    g.sections.map((s, i) => sectionHtml(g, s, i)).join("") +
    `<section class="cj-sec cj-screen" id="${g.id}-tela" aria-labelledby="${g.id}-tela-h"><div class="cj-sec-head"><span class="cj-num cj-star" aria-hidden="true">★</span><h3 id="${g.id}-tela-h">${g.screen.title}</h3></div>` +
    `<ol class="cj-steps">${steps}</ol></section>` +
    `<footer class="cj-end"><p>Pronto para jogar?</p><a class="cj-cta" href="${g.cta.href}">${g.cta.label}</a></footer>` +
    `</article>`;
}

function build() {
  tabs.innerHTML = GUIDES.map(g =>
    `<button type="button" role="tab" class="cj-tab" id="tab-${g.id}" aria-controls="panel-${g.id}" aria-selected="false" tabindex="-1" data-id="${g.id}">` +
    `<span class="cj-tab-glyph" aria-hidden="true">${g.glyph}</span><span>${g.name}</span></button>`).join("");
  panels.innerHTML = GUIDES.map(g =>
    `<section role="tabpanel" class="cj-panel" id="panel-${g.id}" aria-labelledby="tab-${g.id}" tabindex="-1" hidden>${guideHtml(g)}</section>`).join("");
}

const fromHash = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  return GUIDE_IDS.includes(id) ? id : GUIDE_IDS[0];
};

function activate(id, { scroll = false } = {}) {
  for (const g of GUIDES) {
    const on = g.id === id;
    const tab = $(`tab-${g.id}`), panel = $(`panel-${g.id}`);
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
    panel.hidden = !on;
  }
  const guide = GUIDES.find(g => g.id === id);
  document.title = `${guide.title} · WebMiniGames`;
  if (scroll) $(`panel-${id}`).scrollIntoView({ block: "start", behavior: "auto" });
}

function select(id, opts) {
  activate(id, opts);
  if (location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
}

tabs.addEventListener("click", event => {
  const tab = event.target.closest(".cj-tab");
  if (tab) select(tab.dataset.id, { scroll: true });
});

tabs.addEventListener("keydown", event => {
  const keys = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" };
  if (!(event.key in keys)) return;
  event.preventDefault();
  const current = GUIDE_IDS.indexOf(document.activeElement?.dataset?.id ?? fromHash());
  const step = keys[event.key];
  const next = step === "first" ? 0 : step === "last" ? GUIDE_IDS.length - 1 : (current + step + GUIDE_IDS.length) % GUIDE_IDS.length;
  select(GUIDE_IDS[next]);
  $(`tab-${GUIDE_IDS[next]}`).focus();
});

panels.addEventListener("click", event => {
  const item = event.target.closest(".cj-toc-item");
  if (!item) return;
  const target = $(item.dataset.target);
  target?.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
});

build();
activate(fromHash());
window.addEventListener("hashchange", () => activate(fromHash(), { scroll: true }));
