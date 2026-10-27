// Forfettario 2026 calculation engine. Pure functions (no DOM) shared by every tool and by the tests.
(function (root) {
  "use strict";
  const P = {
    anno: 2026,
    soglia: 85000,
    sogliaUscita: 100000,
    gs: 0.2607,          // Gestione Separata, no other pension cover
    gsRidotta: 0.24,     // Gestione Separata with other cover / pensioners
    minimale: 18808,     // artigiani e commercianti
    art: 0.24,
    comm: 0.2448,
    maternita: 7.44,
    riduzione: 0.35,
  };
  const r2 = (v) => Math.round(v * 100) / 100;

  function aliquotaGS(p) { return p.altraCopertura ? P.gsRidotta : P.gs; }
  function fattoreRid(p) { return p.riduzione ? 1 - P.riduzione : 1; }

  // INPS contributions due for a given reddito forfettario.
  function contributi(reddito, p) {
    if (p.gestione === "gs") return reddito * aliquotaGS(p);
    const q = p.gestione === "art" ? P.art : P.comm;
    return (P.minimale * q + Math.max(0, reddito - P.minimale) * q) * fattoreRid(p) + P.maternita;
  }

  function statoSoglia(ricavi) {
    if (ricavi > P.sogliaUscita) return { livello: "fuori", testo: "Oltre 100.000 €: esci dal forfettario già quest'anno." };
    if (ricavi > P.soglia) return { livello: "attenzione", testo: "Oltre 85.000 €: dal prossimo anno passi al regime ordinario." };
    return { livello: "ok", testo: "Margine prima della soglia di 85.000 €: " , margine: P.soglia - ricavi };
  }

  /** Taxes for one year. p: { ricavi, coeff, aliquota, gestione: "gs"|"art"|"comm", riduzione, altraCopertura } */
  function calcTasse(p) {
    const ricavi = Math.max(0, p.ricavi || 0);
    const reddito = ricavi * p.coeff;
    const inps = contributi(reddito, p);
    const imponibile = Math.max(0, reddito - inps);
    const imposta = imponibile * p.aliquota;
    const totale = imposta + inps;
    return { ricavi, reddito: r2(reddito), contributi: r2(inps), imponibile: r2(imponibile), imposta: r2(imposta),
             totale: r2(totale), netto: r2(ricavi - totale), pctAccanto: ricavi ? totale / ricavi : 0,
             soglia: statoSoglia(ricavi) };
  }

  /** Revenue needed for a target net (closed form: contributions are piecewise linear). */
  function ricaviNecessari(p) {
    const T = (p.netto || 0) + (p.spese || 0), k = p.coeff, a = p.aliquota;
    let R;
    if (p.gestione === "gs") R = T / (1 - k * (a + aliquotaGS(p) * (1 - a)));
    else {
      const q = (p.gestione === "art" ? P.art : P.comm) * fattoreRid(p);
      const hi = (T + P.maternita * (1 - a)) / (1 - k * (a + q * (1 - a)));
      R = k * hi >= P.minimale ? hi : (T + (P.minimale * q + P.maternita) * (1 - a)) / (1 - k * a);
    }
    return { ricavi: r2(R), mese: r2(R / 12), oltreSoglia: R > P.soglia };
  }

  // Acconti dell'imposta sostitutiva, metodo storico (forfettari: 40% + 60%).
  function accontiImposta(base) {
    if (base <= 51.65) return { primo: 0, secondo: 0 };
    if (base < 257.52) return { primo: 0, secondo: r2(base) };
    return { primo: r2(base * 0.4), secondo: r2(base * 0.6) };
  }

  // One F24 row; negative amounts go to the credit column.
  function row(sezione, codice, rif, importo, extra) {
    return Object.assign({ sezione, codice, rif, debito: importo > 0 ? r2(importo) : 0,
                           credito: importo < 0 ? r2(-importo) : 0 }, extra || {});
  }

  /**
   * June and November F24 for payment year `anno`.
   * i: { anno, impostaPrec, accontiImpostaVersati, gestione, altraCopertura, contribPrec (gs: contributo
   *      dovuto; art/comm: eccedenza sul minimale), accontiContribVersati, codiceSede, cf, matricola, dirittoCamerale }
   */
  function buildF24(i) {
    const prev = i.anno - 1, cur = i.anno;
    const acc = accontiImposta(i.impostaPrec);
    const giugno = [], novembre = [];
    const saldo = i.impostaPrec - i.accontiImpostaVersati;
    if (saldo !== 0) giugno.push(row("Erario", "1792", String(prev), saldo, { nota: "Saldo imposta sostitutiva " + prev }));
    if (acc.primo) giugno.push(row("Erario", "1790", String(cur), acc.primo, { nota: "Primo acconto " + cur + " (40%)" }));
    if (acc.secondo) novembre.push(row("Erario", "1791", String(cur), acc.secondo,
      { nota: (acc.primo ? "Secondo acconto " : "Acconto unico ") + cur + (acc.primo ? " (60%)" : " (100%)") }));
    if (i.dirittoCamerale > 0) giugno.push(row("IMU e altri tributi locali", "3850", String(cur), i.dirittoCamerale,
      { nota: "Diritto camerale " + cur }));

    let causale, accPct, idPos;
    if (i.gestione === "gs") { causale = i.altraCopertura ? "P10" : "PXX"; accPct = 0.4; idPos = i.cf; }
    else { causale = i.gestione === "art" ? "AP" : "CP"; accPct = 0.5; idPos = i.matricola; }
    const inps = (periodo, importo, nota) => row("INPS", causale, periodo, importo,
      { sede: i.codiceSede, matricola: idPos, nota });
    const saldoC = i.contribPrec - i.accontiContribVersati;
    if (saldoC !== 0) giugno.push(inps("01/" + prev + " – 12/" + prev, saldoC, "Saldo contributi " + prev));
    const accC = r2(i.contribPrec * accPct);
    if (accC > 0) {
      giugno.push(inps("01/" + cur + " – 12/" + cur, accC, "Primo acconto contributi " + cur));
      novembre.push(inps("01/" + cur + " – 12/" + cur, accC, "Secondo acconto contributi " + cur));
    }
    const tot = (rows) => r2(rows.reduce((s, x) => s + x.debito - x.credito, 0));
    return {
      giugno: { scadenza: "30/06/" + cur, righe: giugno, saldo: tot(giugno) },
      novembre: { scadenza: "30/11/" + cur, righe: novembre, saldo: tot(novembre) },
    };
  }

  /**
   * Multi-year cash simulation for Gestione Separata (contributions deducted when paid).
   * i: { annoInizio, ricavi: [R1, R2, ...], coeff, aliquota (number or per-year array), altraCopertura }
   */
  function simulaVersamenti(i) {
    const n = i.ricavi.length, anni = [], pagamenti = [];
    const g = aliquotaGS(i);
    const C = i.ricavi.map((R) => R * i.coeff * g);
    const aliq = (y) => (Array.isArray(i.aliquota) ? i.aliquota[y] : i.aliquota);
    const tax = [], accTax = [];
    for (let y = 0; y < n; y++) {
      const anno = i.annoInizio + y;
      const accPrev = y > 0 ? accontiImposta(tax[y - 1]) : { primo: 0, secondo: 0 };
      accTax[y] = accPrev.primo + accPrev.secondo;
      // contributions paid in calendar year y: saldo of y-1 + acconti of y (80% of C[y-1])
      const contribPagati = y > 0 ? (C[y - 1] - (y > 1 ? 0.8 * C[y - 2] : 0)) + 0.8 * C[y - 1] : 0;
      const red = i.ricavi[y] * i.coeff;
      tax[y] = Math.max(0, red - contribPagati) * aliq(y);
      anni.push({ anno, ricavi: i.ricavi[y], reddito: r2(red), contributiDovuti: r2(C[y]),
                  contributiDedotti: r2(contribPagati), imposta: r2(tax[y]) });
      if (y > 0) {
        const saldoTax = tax[y - 1] - accTax[y - 1];
        const saldoC = C[y - 1] - (y > 1 ? 0.8 * C[y - 2] : 0);
        pagamenti.push({ data: "30/06/" + anno, imposta: r2(saldoTax + accPrev.primo),
                         contributi: r2(saldoC + 0.4 * C[y - 1]) });
        pagamenti.push({ data: "30/11/" + anno, imposta: r2(accPrev.secondo), contributi: r2(0.4 * C[y - 1]) });
      }
    }
    // June after the last year: saldo only (the next acconti depend on future income)
    const last = n - 1;
    pagamenti.push({ data: "30/06/" + (i.annoInizio + n), imposta: r2(tax[last] - accTax[last]),
                     contributi: r2(C[last] - (n > 1 ? 0.8 * C[last - 1] : 0)), soloSaldo: true });
    pagamenti.forEach((p) => { p.totale = r2(p.imposta + p.contributi); });
    return { anni, pagamenti };
  }

  const api = { P, calcTasse, ricaviNecessari, accontiImposta, buildF24, simulaVersamenti };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Forf = api;
})(this);
