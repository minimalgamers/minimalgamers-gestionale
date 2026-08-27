// ============================================================================
// configuratore-ordini.js — sezione ordini del CONFIGURATORE
// ============================================================================
// Questa sezione e separata di proposito da tutto il resto del gestionale.
//
// Le build Minimal predefinite e i PC del configuratore sono due mestieri
// diversi, non due varianti dello stesso:
//
//   predefinite    i pezzi si prendono un po' sparsi (Amazon per i dissipatori
//                  a liquido e le archiviazioni aggiuntive, altri fornitori per
//                  certi case) e qualcosa e gia a terra. Il sistema che le
//                  gestisce funziona: qui non lo tocchiamo nemmeno di striscio.
//
//   configuratore  non c'e mai niente a terra. Il cliente ordina, si comprano i
//                  pezzi per lui e si assembla. Ogni pezzo ha un fornitore, un
//                  codice fornitore e un costo che il configuratore conosce gia
//                  nel momento in cui crea il PC.
//
// Come si distinguono, senza euristiche: un PC del configuratore ha una riga
// nella tabella configuratore_liste_fornitori, scritta dal configuratore stesso
// quando ha creato il prodotto. Le build predefinite quella riga non ce l'hanno
// e non possono averla. Quindi qui dentro non possono comparire per sbaglio.
//
// Il magazzino NON viene scalato: deciso con Antonio il 27/08/2026, perche per
// queste build non c'e niente da scalare.
// ============================================================================
(function () {
  'use strict';

  if (window.__configuratoreOrdiniAttivo) return;
  window.__configuratoreOrdiniAttivo = true;

  const TABELLA = 'configuratore_liste_fornitori';
  const CHIAVE_TAB = 'configuratore';

  // SUPABASE_URL e SUPABASE_KEY sono dichiarate con const in supabase-config.js:
  // vivono nell'ambito lessicale globale e NON su window. Si leggono cosi.
  function valoreGlobale(nome) {
    try {
      return new Function('return (typeof ' + nome + ' !== "undefined") ? ' + nome + ' : null')();
    } catch (e) {
      return null;
    }
  }

  function euro(valore) {
    const n = Number(valore);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  }

  function testo(valore, fallback) {
    const s = String(valore === null || valore === undefined ? '' : valore).trim();
    return s || (fallback || '—');
  }

  function scudo(valore) {
    return String(valore === null || valore === undefined ? '' : valore)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── La tab, creata da qui ──────────────────────────────────────────────
  // Il bottone e il contenitore si aggiungono a runtime invece che in
  // index.html: quel file e grosso e riscriverlo per intero per due elementi
  // sarebbe un rischio inutile. Il meccanismo delle tab resta quello dell'app
  // (data-tab sul bottone, data-content sul contenitore), quindi il click lo
  // gestisce app.js come per tutte le altre.
  function creaTab() {
    const barra = document.querySelector('.tab-button');
    if (!barra || !barra.parentElement) return false;
    if (document.querySelector('.tab-button[data-tab="' + CHIAVE_TAB + '"]')) return true;

    const bottone = document.createElement('button');
    bottone.className = 'tab-button';
    bottone.dataset.tab = CHIAVE_TAB;
    bottone.title = 'PC creati dai clienti col configuratore';
    bottone.textContent = 'Configuratore';
    barra.parentElement.appendChild(bottone);

    const modello = document.querySelector('.tab-content');
    if (!modello || !modello.parentElement) return false;
    const contenitore = document.createElement('div');
    contenitore.className = 'tab-content';
    contenitore.dataset.content = CHIAVE_TAB;
    contenitore.innerHTML =
      '<div style="padding:18px 20px">'
      + '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px">'
      + '<h2 style="margin:0;font-size:1.25em">Ordini dal configuratore</h2>'
      + '<button id="conf-aggiorna" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600">Aggiorna</button>'
      + '<button id="conf-pdf" style="display:none;background:rgba(46,204,113,.22);border:1px solid rgba(46,204,113,.5);color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600">Scarica PDF per fornitore</button>'
      + '<span id="conf-stato" style="opacity:.75;font-size:.9em"></span>'
      + '</div>'
      + '<div id="conf-corpo"></div>'
      + '</div>';
    modello.parentElement.appendChild(contenitore);

    bottone.addEventListener('click', function () {
      if (!statoCorrente.caricato) carica();
    });
    document.getElementById('conf-aggiorna').addEventListener('click', carica);
    document.getElementById('conf-pdf').addEventListener('click', generaPdf);
    return true;
  }

  const statoCorrente = { caricato: false, ordini: [], perFornitore: {} };

  // ── I dati ─────────────────────────────────────────────────────────────
  async function leggiOrdiniShopify() {
    // Stesso percorso che usa il resto del gestionale: lo intercetta
    // api-adapter.js e lo gira alla Edge Function shopify-proxy.
    const risposta = await fetch('api_gateway/shopify_bridge/endpoint/api-orders.php');
    const dati = await risposta.json();
    if (Array.isArray(dati)) return dati;
    return (dati && dati.orders) || [];
  }

  async function leggiListe(productIds) {
    if (!productIds.length) return {};
    const url = valoreGlobale('SUPABASE_URL');
    const chiave = valoreGlobale('SUPABASE_KEY');
    if (!url || !chiave) throw new Error('Configurazione Supabase non leggibile');
    const elenco = productIds.map(function (id) { return '"' + id + '"'; }).join(',');
    const indirizzo = String(url).replace(/\/$/, '') + '/rest/v1/' + TABELLA
      + '?select=product_id,titolo,costo_netto,prezzo_vendita,righe,creata_il'
      + '&product_id=in.(' + encodeURIComponent(elenco) + ')';
    const risposta = await fetch(indirizzo, {
      headers: { apikey: chiave, Authorization: 'Bearer ' + chiave }
    });
    if (!risposta.ok) {
      const dettaglio = await risposta.text();
      throw new Error('Supabase ' + risposta.status + ': ' + dettaglio.slice(0, 200));
    }
    const righe = await risposta.json();
    const mappa = {};
    (righe || []).forEach(function (riga) { mappa[riga.product_id] = riga; });
    return mappa;
  }

  function gid(productId) {
    const grezzo = String(productId === null || productId === undefined ? '' : productId);
    if (!grezzo) return null;
    if (grezzo.indexOf('gid://') === 0) return grezzo;
    if (/^\d+$/.test(grezzo)) return 'gid://shopify/Product/' + grezzo;
    return null;
  }

  async function carica() {
    const stato = document.getElementById('conf-stato');
    const corpo = document.getElementById('conf-corpo');
    const bottonePdf = document.getElementById('conf-pdf');
    if (!corpo) return;
    stato.textContent = 'Carico…';
    corpo.innerHTML = '';
    bottonePdf.style.display = 'none';

    try {
      const ordini = await leggiOrdiniShopify();

      // Ogni prodotto comparso negli ordini, una volta sola.
      const identificativi = new Set();
      ordini.forEach(function (ordine) {
        (ordine.line_items || []).forEach(function (voce) {
          const identificativo = gid(voce.product_id);
          if (identificativo) identificativi.add(identificativo);
        });
      });

      const liste = await leggiListe(Array.from(identificativi));

      // Un ordine entra qui SOLO se contiene una build con lista: le
      // predefinite non ce l'hanno e restano dove sono.
      const ordiniConfiguratore = [];
      ordini.forEach(function (ordine) {
        const buildDellOrdine = [];
        (ordine.line_items || []).forEach(function (voce) {
          const lista = liste[gid(voce.product_id)];
          if (lista) buildDellOrdine.push({ voce: voce, lista: lista });
        });
        if (buildDellOrdine.length) ordiniConfiguratore.push({ ordine: ordine, build: buildDellOrdine });
      });

      statoCorrente.ordini = ordiniConfiguratore;
      statoCorrente.perFornitore = raggruppaPerFornitore(ordiniConfiguratore);
      statoCorrente.caricato = true;

      disegna(ordiniConfiguratore, statoCorrente.perFornitore);
      stato.textContent = ordiniConfiguratore.length
        ? ordiniConfiguratore.length + (ordiniConfiguratore.length === 1 ? ' ordine' : ' ordini')
        : 'Nessun ordine dal configuratore';
      bottonePdf.style.display = ordiniConfiguratore.length ? 'inline-block' : 'none';
    } catch (errore) {
      console.error('Sezione configuratore:', errore);
      const messaggio = String(errore && errore.message || errore);
      const permessi = /401|403|permission|policy/i.test(messaggio);
      corpo.innerHTML = '<div style="padding:16px;border:1px solid rgba(231,76,60,.5);background:rgba(231,76,60,.12);border-radius:10px">'
        + '<strong>Non riesco a leggere le liste.</strong><br>' + scudo(messaggio)
        + (permessi
          ? '<br><br>Sembra un problema di permessi sulla tabella <code>' + TABELLA + '</code>: manca la regola di lettura.'
          : '')
        + '</div>';
      stato.textContent = '';
    }
  }

  // ── Cosa comprare, e da chi ────────────────────────────────────────────
  function raggruppaPerFornitore(ordiniConfiguratore) {
    const perFornitore = {};
    ordiniConfiguratore.forEach(function (gruppo) {
      const numeroOrdine = testo(gruppo.ordine.name || gruppo.ordine.order_number, '?');
      gruppo.build.forEach(function (build) {
        const quantita = Number(build.voce.quantity) || 1;
        (build.lista.righe || []).forEach(function (riga) {
          const fornitore = testo(riga.fornitore, riga.non_piu_a_listino ? 'DA VERIFICARE' : 'SENZA FORNITORE');
          if (!perFornitore[fornitore]) perFornitore[fornitore] = { voci: {}, pezzi: 0, costo: 0 };
          const gruppoF = perFornitore[fornitore];
          const chiave = testo(riga.codice_fornitore, riga.nome || riga.passo);
          if (!gruppoF.voci[chiave]) {
            gruppoF.voci[chiave] = {
              codice: riga.codice_fornitore,
              nome: riga.nome,
              categoria: riga.categoria,
              costo: riga.costo_netto,
              vendita: riga.prezzo_vendita,
              mancante: !!riga.non_piu_a_listino,
              quantita: 0,
              ordini: []
            };
          }
          const voce = gruppoF.voci[chiave];
          voce.quantita += quantita;
          if (voce.ordini.indexOf(numeroOrdine) === -1) voce.ordini.push(numeroOrdine);
          gruppoF.pezzi += quantita;
          gruppoF.costo = Number((gruppoF.costo + (Number(riga.costo_netto) || 0) * quantita).toFixed(2));
        });
      });
    });
    return perFornitore;
  }

  function disegna(ordiniConfiguratore, perFornitore) {
    const corpo = document.getElementById('conf-corpo');
    if (!ordiniConfiguratore.length) {
      corpo.innerHTML = '<div style="padding:24px;opacity:.7">Nessun ordine dal configuratore al momento. '
        + 'Le build Minimal predefinite restano nelle loro schede, qui non compaiono.</div>';
      return;
    }

    let html = '<h3 style="margin:18px 0 10px;font-size:1.05em;opacity:.9">Da ordinare, raggruppato per fornitore</h3>';
    html += '<div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">';
    Object.keys(perFornitore).sort().forEach(function (fornitore) {
      const gruppo = perFornitore[fornitore];
      html += '<div style="border:1px solid rgba(255,255,255,.15);border-radius:12px;overflow:hidden">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:rgba(255,255,255,.08);font-weight:700">'
        + '<span>' + scudo(fornitore) + '</span>'
        + '<span style="opacity:.8;font-weight:600">' + gruppo.pezzi + ' pz · ' + euro(gruppo.costo) + '</span>'
        + '</div><div style="padding:6px 0">';
      Object.keys(gruppo.voci).forEach(function (chiave) {
        const voce = gruppo.voci[chiave];
        html += '<div style="padding:8px 14px;border-top:1px solid rgba(255,255,255,.06)">'
          + '<div style="display:flex;gap:10px;align-items:baseline">'
          + '<strong style="min-width:34px">x' + voce.quantita + '</strong>'
          + '<code style="opacity:.95">' + scudo(testo(voce.codice)) + '</code>'
          + '<span style="margin-left:auto;opacity:.75;font-size:.85em">' + scudo(testo(voce.categoria)) + '</span>'
          + '</div>'
          + '<div style="font-size:.9em;opacity:.9;margin-top:2px">' + scudo(testo(voce.nome)) + '</div>'
          + '<div style="font-size:.82em;opacity:.7;margin-top:2px">costo ' + euro(voce.costo)
          + ' · venduto ' + euro(voce.vendita)
          + ' · ordini ' + scudo(voce.ordini.map(function (o) { return '#' + o; }).join(' '))
          + (voce.mancante ? ' · <span style="color:#f39c12">non piu a listino</span>' : '')
          + '</div></div>';
      });
      html += '</div></div>';
    });
    html += '</div>';

    html += '<h3 style="margin:26px 0 10px;font-size:1.05em;opacity:.9">Ordine per ordine</h3>';
    ordiniConfiguratore.forEach(function (gruppo) {
      const numeroOrdine = testo(gruppo.ordine.name || gruppo.ordine.order_number, '?');
      gruppo.build.forEach(function (build) {
        const lista = build.lista;
        html += '<div style="border:1px solid rgba(255,255,255,.15);border-radius:12px;margin-bottom:14px;overflow:hidden">'
          + '<div style="padding:10px 14px;background:rgba(255,255,255,.06);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">'
          + '<strong>#' + scudo(numeroOrdine) + ' — ' + scudo(testo(build.voce.title || lista.titolo)) + '</strong>'
          + '<span style="opacity:.85">costo ' + euro(lista.costo_netto) + ' · venduto ' + euro(lista.prezzo_vendita) + '</span>'
          + '</div>'
          + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.88em">'
          + '<thead><tr style="text-align:left;opacity:.7">'
          + '<th style="padding:8px 14px">Categoria</th><th style="padding:8px 14px">Fornitore</th>'
          + '<th style="padding:8px 14px">Codice</th><th style="padding:8px 14px">Componente</th>'
          + '<th style="padding:8px 14px;text-align:right">Costo</th><th style="padding:8px 14px;text-align:right">Venduto</th>'
          + '</tr></thead><tbody>';
        (lista.righe || []).forEach(function (riga) {
          html += '<tr style="border-top:1px solid rgba(255,255,255,.06)'
            + (riga.non_piu_a_listino ? ';background:rgba(243,156,18,.12)' : '') + '">'
            + '<td style="padding:8px 14px">' + scudo(testo(riga.categoria)) + '</td>'
            + '<td style="padding:8px 14px">' + scudo(testo(riga.fornitore)) + '</td>'
            + '<td style="padding:8px 14px"><code>' + scudo(testo(riga.codice_fornitore)) + '</code></td>'
            + '<td style="padding:8px 14px">' + scudo(testo(riga.nome, riga.non_piu_a_listino ? 'non piu a listino' : '—')) + '</td>'
            + '<td style="padding:8px 14px;text-align:right">' + euro(riga.costo_netto) + '</td>'
            + '<td style="padding:8px 14px;text-align:right">' + euro(riga.prezzo_vendita) + '</td>'
            + '</tr>';
        });
        html += '</tbody></table></div></div>';
      });
    });

    corpo.innerHTML = html;
  }

  // ── PDF, uno per fornitore ─────────────────────────────────────────────
  // Stessa idea dei PDF che il gestionale genera gia per le build classiche,
  // ma con le due colonne di prezzo che li non ci sono.
  function generaPdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert('Libreria PDF non disponibile.');
      return;
    }
    const perFornitore = statoCorrente.perFornitore || {};
    const fornitori = Object.keys(perFornitore).sort();
    if (!fornitori.length) return;

    const adesso = new Date();
    const giorno = String(adesso.getDate()).padStart(2, '0') + '-'
      + String(adesso.getMonth() + 1).padStart(2, '0') + '-' + adesso.getFullYear();

    fornitori.forEach(function (fornitore, indice) {
      const doc = new window.jspdf.jsPDF();
      doc.setFillColor(32, 42, 58);
      doc.rect(0, 0, 210, 34, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text('ORDINE ' + fornitore, 105, 16, { align: 'center' });
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('PC del configuratore — ' + giorno, 105, 25, { align: 'center' });

      const gruppo = perFornitore[fornitore];
      const righe = Object.keys(gruppo.voci).map(function (chiave) {
        const voce = gruppo.voci[chiave];
        return [
          'x' + voce.quantita,
          testo(voce.codice),
          testo(voce.nome),
          euro(voce.costo),
          voce.ordini.map(function (o) { return '#' + o; }).join(' ')
        ];
      });

      doc.setTextColor(0, 0, 0);
      doc.autoTable({
        startY: 42,
        head: [['QTA', 'CODICE FORNITORE', 'COMPONENTE', 'COSTO', 'ORDINI']],
        body: righe,
        theme: 'grid',
        headStyles: { fillColor: [32, 42, 58], textColor: [255, 255, 255], fontSize: 10, fontStyle: 'bold' },
        columnStyles: {
          0: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
          1: { cellWidth: 40, font: 'courier' },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 24, halign: 'right' },
          4: { cellWidth: 30 }
        },
        styles: { fontSize: 9, cellPadding: 3 },
        alternateRowStyles: { fillColor: [246, 247, 249] }
      });

      const finale = doc.lastAutoTable.finalY + 10;
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text('Totale ' + gruppo.pezzi + ' pezzi — ' + euro(gruppo.costo), 195, finale, { align: 'right' });

      setTimeout(function () {
        doc.save(giorno + '-CONFIGURATORE-' + fornitore.replace(/\s+/g, '-') + '.pdf');
      }, indice * 500);
    });
  }

  // La barra delle tab viene costruita da app.js: si aspetta che ci sia.
  let tentativi = 0;
  const attesa = setInterval(function () {
    tentativi++;
    if (creaTab() || tentativi > 60) clearInterval(attesa);
  }, 500);
})();
