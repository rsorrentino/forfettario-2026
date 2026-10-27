// Forfettario 2026 — app shell: drawer, shared profile, tools, in-app navigation.
(function () {
  "use strict";
  const F = window.Forf;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const eur = (v, dec) => (v || 0).toLocaleString("it-IT", { style: "currency", currency: "EUR",
    minimumFractionDigits: dec === 0 ? 0 : 2, maximumFractionDigits: dec === 0 ? 0 : 2, useGrouping: "always" });
  const pct = (v) => (v * 100).toFixed(1).replace(".", ",") + "%";
  const num = (el) => { const v = parseFloat(String(el.value).replace(",", ".")); return isFinite(v) ? v : 0; };

  // ---------- shared profile (same activity / rate / INPS scheme in every tool) ----------
  const KEY = "forf.profilo.v1";
  const DEFAULTS = { coeff: "0.67", aliquota: "0.15", gestione: "gs", riduzione: false, altraCopertura: false };
  function loadProfile() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveProfile(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (e) { /* private mode */ } }
  let profile = loadProfile();

  function bindProfile(root, onChange) {
    $$("[data-profile]", root).forEach((el) => {
      const k = el.dataset.profile;
      if (el.type === "checkbox") el.checked = !!profile[k]; else el.value = profile[k];
      el.addEventListener("input", () => {
        profile[k] = el.type === "checkbox" ? el.checked : el.value;
        saveProfile(profile);
        syncProfileVisibility(root);
        onChange();
      });
    });
    syncProfileVisibility(root);
  }
  // show options that only apply to one INPS scheme
  function syncProfileVisibility(root) {
    $$("[data-only]", root).forEach((el) => { el.hidden = el.dataset.only.split(" ").indexOf(profile.gestione) < 0; });
  }
  function params() {
    return { coeff: +profile.coeff, aliquota: +profile.aliquota, gestione: profile.gestione,
             riduzione: !!profile.riduzione && profile.gestione !== "gs",
             altraCopertura: !!profile.altraCopertura && profile.gestione === "gs" };
  }
  const set = (root, name, text) => { const el = $('[data-out="' + name + '"]', root); if (el) el.textContent = text; };
  const inputs = (root, fn) => $$("input:not([data-profile]), select:not([data-profile])", root)
    .forEach((el) => el.addEventListener("input", fn));

  // ---------- tools ----------
  const tools = {
    tasse(root) {
      const run = () => {
        const r = F.calcTasse(Object.assign(params(), { ricavi: num($("#ricavi", root)) }));
        set(root, "netto", eur(r.netto)); set(root, "reddito", eur(r.reddito)); set(root, "contributi", eur(r.contributi));
        set(root, "imponibile", eur(r.imponibile)); set(root, "imposta", eur(r.imposta)); set(root, "totale", eur(r.totale));
        set(root, "accanto", pct(r.pctAccanto));
        const n = $('[data-out="soglia"]', root);
        n.dataset.level = r.soglia.livello;
        n.textContent = r.soglia.livello === "ok" ? r.soglia.testo + eur(r.soglia.margine) : r.soglia.testo;
      };
      bindProfile(root, run); inputs(root, run); run();
    },
    tariffa(root) {
      const run = () => {
        const giorni = Math.max(1, num($("#giorni", root))), ore = Math.max(1, num($("#ore", root)));
        const r = F.ricaviNecessari(Object.assign(params(), { netto: num($("#netto", root)), spese: num($("#spese", root)) }));
        set(root, "ricavi", eur(r.ricavi, 0)); set(root, "mese", eur(r.mese, 0));
        set(root, "giorno", eur(r.ricavi / giorni, 0)); set(root, "ora", eur(r.ricavi / giorni / ore));
        const n = $('[data-out="soglia"]', root);
        n.dataset.level = r.oltreSoglia ? "fuori" : "ok";
        n.textContent = r.oltreSoglia ? "Servono più di 85.000 € di ricavi: questo netto non è raggiungibile restando nel forfettario."
          : "Le spese non si deducono nel forfettario: per questo si sommano al netto desiderato.";
      };
      bindProfile(root, run); inputs(root, run); run();
    },
    f24(root) {
      const run = () => {
        const p = params();
        const res = F.buildF24({ anno: num($("#anno", root)), impostaPrec: num($("#impostaPrec", root)),
          accontiImpostaVersati: num($("#accontiImposta", root)), gestione: p.gestione, altraCopertura: p.altraCopertura,
          contribPrec: num($("#contribPrec", root)), accontiContribVersati: num($("#accontiContrib", root)),
          codiceSede: $("#sede", root).value || "—", cf: $("#cf", root).value || "—", matricola: $("#cf", root).value || "—",
          dirittoCamerale: p.gestione === "gs" ? 0 : num($("#camerale", root)) });
        $('[data-out="f24"]', root).innerHTML = renderF24("Modello F24 · scadenza " + res.giugno.scadenza, res.giugno)
          + renderF24("Modello F24 · scadenza " + res.novembre.scadenza, res.novembre);
        set(root, "contribLabel", p.gestione === "gs" ? "Contributi Gestione Separata dovuti per l'anno precedente"
          : "Contributi sul reddito oltre il minimale dovuti per l'anno precedente");
      };
      bindProfile(root, run); inputs(root, run); run();
    },
    versamenti(root) {
      const run = () => {
        const p = params();
        const anno = num($("#annoInizio", root));
        const ricavi = [1, 2, 3].map((i) => num($("#r" + i, root)));
        const startup = $("#startup", root).checked;
        const sim = F.simulaVersamenti({ annoInizio: anno, ricavi, coeff: p.coeff, altraCopertura: p.altraCopertura,
          aliquota: startup ? [0.05, 0.05, 0.05] : p.aliquota });
        $('[data-out="anni"]', root).innerHTML = "<table><thead><tr><th>Anno</th><th class=n>Reddito</th>"
          + "<th class=n>Contributi dovuti</th><th class=n>Contributi dedotti</th><th class=n>Imposta</th></tr></thead><tbody>"
          + sim.anni.map((a) => "<tr><td>" + a.anno + "</td><td class=n>" + eur(a.reddito, 0) + "</td><td class=n>"
            + eur(a.contributiDovuti, 0) + "</td><td class=n>" + eur(a.contributiDedotti, 0) + "</td><td class=n>"
            + eur(a.imposta, 0) + "</td></tr>").join("") + "</tbody></table>";
        const max = Math.max.apply(null, sim.pagamenti.map((x) => x.totale));
        $('[data-out="pagamenti"]', root).innerHTML = "<table class=bars><thead><tr><th>Scadenza</th><th class=n>Imposta</th>"
          + "<th class=n>INPS</th><th class=n>Totale</th><th>Peso</th></tr></thead><tbody>"
          + sim.pagamenti.map((x) => "<tr" + (x.totale === max ? " class=peak" : "") + "><td>" + x.data
            + (x.soloSaldo ? " <span class=meta>(solo saldo)</span>" : "") + "</td><td class=n>" + eur(x.imposta, 0)
            + "</td><td class=n>" + eur(x.contributi, 0) + "</td><td class=n>" + eur(x.totale, 0)
            + "</td><td class=bar><div class=b style=\"width:" + (max > 0 ? Math.max(0, x.totale) / max * 100 : 0).toFixed(1)
            + "%\"></div></td></tr>").join("") + "</tbody></table>";
        const peak = sim.pagamenti.find((x) => x.totale === max);
        set(root, "picco", peak ? eur(peak.totale, 0) + " il " + peak.data : "—");
        set(root, "mensile", eur((sim.pagamenti[0] ? sim.pagamenti[0].totale + sim.pagamenti[1].totale : 0) / 12, 0));
        set(root, "totale", eur(sim.pagamenti.reduce((t, x) => t + x.totale, 0), 0));
        set(root, "imposta1", eur(sim.anni[0].imposta, 0));
        $('[data-out="nogs"]', root).hidden = p.gestione === "gs";
      };
      bindProfile(root, run); inputs(root, run); run();
    },
  };

  function renderF24(title, s) {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const er = s.righe.filter((r) => r.sezione !== "INPS"), inps = s.righe.filter((r) => r.sezione === "INPS");
    const money = (v) => (v ? eur(v) : "");
    let h = '<section class="f24"><div class="f24-head"><b>' + esc(title) + "</b><span class=num>" + eur(s.saldo) + "</span></div>";
    if (er.length) h += '<div class="f24-sec">Sezione Erario e tributi locali</div><div style="overflow-x:auto"><table><thead><tr>'
      + "<th>Codice tributo</th><th>Anno rif.</th><th>Descrizione</th><th class=n>A debito</th><th class=n>A credito</th></tr></thead><tbody>"
      + er.map((r) => "<tr><td class=code>" + r.codice + "</td><td class=rif>" + r.rif + "</td><td class=desc>" + esc(r.nota)
        + "</td><td class='n deb'>" + money(r.debito) + "</td><td class='n cred'>" + money(r.credito) + "</td></tr>").join("") + "</tbody></table></div>";
    if (inps.length) h += '<div class="f24-sec">Sezione INPS</div><div style="overflow-x:auto"><table><thead><tr>'
      + "<th>Sede</th><th>Causale</th><th>Matricola / CF</th><th>Periodo</th><th class=n>A debito</th><th class=n>A credito</th></tr></thead><tbody>"
      + inps.map((r) => "<tr><td class=sede>" + esc(r.sede) + "</td><td class=code>" + r.codice + "</td><td class=mat>"
        + esc(r.matricola) + "</td><td class=desc>" + r.rif + "</td><td class='n deb'>" + money(r.debito)
        + "</td><td class='n cred'>" + money(r.credito) + "</td></tr>").join("") + "</tbody></table></div>";
    if (!s.righe.length) h += '<div class="f24-sec">Nessun versamento</div>';
    return h + '<div class="f24-total"><span>Saldo finale</span><span class=num>' + eur(s.saldo) + "</span></div></section>";
  }

  function initPage() {
    $$("[data-tool]").forEach((el) => { const t = tools[el.dataset.tool]; if (t) t(el); });
  }

  // ---------- drawer ----------
  const side = $(".side"), scrim = $(".scrim"), btn = $(".menu-btn");
  function drawer(open) {
    if (!side) return;
    side.classList.toggle("open", open); scrim.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
  }
  if (btn) btn.addEventListener("click", () => drawer(!side.classList.contains("open")));
  if (scrim) scrim.addEventListener("click", () => drawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") drawer(false); });

  // ---------- in-app navigation (progressive enhancement; any failure falls back to a normal load) ----------
  function sameApp(a) {
    if (!a || a.target || a.hasAttribute("download") || a.origin !== location.origin) return false;
    const base = location.pathname.replace(/[^/]*$/, "");
    return a.pathname.indexOf(base) === 0 && /(\.html|\/)$/.test(a.pathname) && !a.hash;
  }
  function markCurrent(url) {
    const file = new URL(url, location.href).pathname.replace(/^.*\//, "") || "index.html";
    $$(".side a[data-nav]").forEach((a) => {
      const f = a.pathname.replace(/^.*\//, "") || "index.html";
      if (f === file) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  async function go(url, push) {
    try {
      const res = await fetch(url, { headers: { Accept: "text/html" } });
      if (!res.ok) throw new Error(res.status);
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      const main = doc.querySelector("main");
      if (!main) throw new Error("no main");
      $("main").replaceWith(document.importNode(main, true));
      document.title = doc.title;
      const d = doc.querySelector('meta[name="description"]');
      if (d) $('meta[name="description"]').setAttribute("content", d.getAttribute("content"));
      if (push) history.pushState({}, "", url);
      markCurrent(url); drawer(false); window.scrollTo(0, 0);
      initPage();
      const h = $("main h1"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
    } catch (e) { location.href = url; }
  }
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a");
    if (!sameApp(a)) return;
    e.preventDefault();
    if (a.href !== location.href) go(a.href, true); else drawer(false);
  });
  window.addEventListener("popstate", () => go(location.href, false));

  initPage();
})();
