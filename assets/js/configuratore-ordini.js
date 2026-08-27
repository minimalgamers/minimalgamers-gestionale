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
// Verificato in produzione il 27/08/2026 su un ordine che conteneva entrambe:
// la build predefinita non e comparsa.
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

  // ── I colori del gestionale, non i miei ────────────────────────────────
  // La prima versione era disegnata per un tema scuro: bordi e testo bianchi
  // traslucidi. Il gestionale invece ha schede bianche su sfondo fotografico e
  // testo #333, quindi si leggeva a fatica. Questi valori sono presi da
  // .order-card, cosi la sezione nuova sembra parte dello stesso programma.
  const CARTA = 'rgba(255,255,255,.95)';
  const BORDO = '1px solid rgba(0,0,0,.10)';
  const OMBRA = '0 2px 10px rgba(0,0,0,.12)';
  const INCHIOSTRO = '#333';
  const INCHIOSTRO_TENUE = '#6b7280';

  // Stessi colori per fornitore che usa gia il riepilogo delle build classiche:
  // chi ordina riconosce il fornitore dal colore senza rileggere il nome.
  const COLORE_FORNITORE = {
    MAGAZZINO: '#1abc9c', PROKS: '#e74c3c', OMEGA: '#9b59b6', 'TIER ONE': '#3498db',
    AMAZON: '#f39c12', NOUA: '#2ecc71', INTEGRATA: '#7f8c8d', MSI: '#d35400',
    CASEKING: '#16a085', 'NAVY BLUE': '#1a56db', ACTION: '#0ea5e9'
  };
  function coloreDi(fornitore) {
    return COLORE_FORNITORE[String(fornitore || '').toUpperCase()] || '#64748b';
  }

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

  // Il numero d'ordine arriva a volte come "#4753" e a volte come 4753.
  // Normalizzarlo qui evita il "##4753" che si vedeva nella prima versione.
  function numeroOrdine(ordine) {
    const grezzo = String((ordine && (ordine.name || ordine.order_number)) || '').trim();
    return grezzo.replace(/^#+/, '') || '?';
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
  //
  // ATTENZIONE: .tab-content e una GRIGLIA. Senza grid-column il contenuto
  // finisce in una colonna stretta invece di occupare la pagina: e esattamente
  // quello che era successo alla prima versione.
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
      '<div style="grid-column:1 / -1;width:100%;padding:18px 20px;color:' + INCHIOSTRO + '">'
      + '<div style="background:' + CARTA + ';border:' + BORDO + ';box-shadow:' + OMBRA + ';border-radius:12px;padding:14px 16px;margin-bottom:16px;'
      + 'display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
      + '<h2 style="margin:0;font-size:1.2em;color:' + INCHIOSTRO + '">Ordini dal configuratore</h2>'
      + '<button id="conf-aggiorna" style="background:#3498db;border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600">Aggiorna</button>'
      + '<button id="conf-pdf" style="display:none;background:#2ecc71;border:none;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600">Scarica PDF per fornitore</button>'
      + '<span id="conf-stato" style="color:' + INCHIOSTRO_TENUE + ';font-size:.9em"></span>'
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
      corpo.innerHTML = '<div style="background:' + CARTA + ';border:1px solid rgba(231,76,60,.55);border-radius:12px;padding:16px;color:' + INCHIOSTRO + '">'
        + '<strong style="color:#c0392b">Non riesco a leggere le liste.</strong><br>' + scudo(messaggio)
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
      const numero = numeroOrdine(gruppo.ordine);
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
          if (voce.ordini.indexOf(numero) === -1) voce.ordini.push(numero);
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
      corpo.innerHTML = '<div style="background:' + CARTA + ';border:' + BORDO + ';box-shadow:' + OMBRA + ';border-radius:12px;padding:24px;color:' + INCHIOSTRO_TENUE + '">'
        + 'Nessun ordine dal configuratore al momento. '
        + 'Le build Minimal predefinite restano nelle loro schede, qui non compaiono.</div>';
      return;
    }

    let html = '<h3 style="margin:4px 0 12px;font-size:1.05em;color:' + INCHIOSTRO + '">Da ordinare, raggruppato per fornitore</h3>';
    html += '<div style="display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));margin-bottom:28px">';
    Object.keys(perFornitore).sort().forEach(function (fornitore) {
      const gruppo = perFornitore[fornitore];
      const colore = coloreDi(fornitore);
      html += '<div style="background:' + CARTA + ';border:' + BORDO + ';box-shadow:' + OMBRA + ';border-radius:12px;overflow:hidden">'
        + '<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 16px;background:' + colore + ';color:#fff;font-weight:700">'
        + '<span>' + scudo(fornitore) + '</span>'
        + '<span style="font-weight:600">' + gruppo.pezzi + ' pz · ' + euro(gruppo.costo) + '</span>'
        + '</div><div>';
      Object.keys(gruppo.voci).forEach(function (chiave, indice) {
        const voce = gruppo.voci[chiave];
        html += '<div style="padding:10px 16px;' + (indice ? 'border-top:1px solid rgba(0,0,0,.07);' : '') + '">'
          + '<div style="display:flex;gap:10px;align-items:baseline">'
          + '<strong style="min-width:32px;color:' + colore + '">x' + voce.quantita + '</strong>'
          + '<code style="font-size:.9em;color:' + INCHIOSTRO + '">' + scudo(testo(voce.codice)) + '</code>'
          + '<span style="margin-left:auto;font-size:.82em;color:' + INCHIOSTRO_TENUE + '">' + scudo(testo(voce.categoria)) + '</span>'
          + '</div>'
          + '<div style="font-size:.9em;margin-top:3px;color:' + INCHIOSTRO + '">' + scudo(testo(voce.nome)) + '</div>'
          + '<div style="font-size:.82em;margin-top:3px;color:' + INCHIOSTRO_TENUE + '">costo <strong>' + euro(voce.costo) + '</strong>'
          + ' · venduto <strong>' + euro(voce.vendita) + '</strong>'
          + ' · ordini ' + scudo(voce.ordini.map(function (o) { return '#' + o; }).join(' '))
          + (voce.mancante ? ' · <span style="color:#e67e22;font-weight:600">non piu a listino</span>' : '')
          + '</div></div>';
      });
      html += '</div></div>';
    });
    html += '</div>';

    html += '<h3 style="margin:4px 0 12px;font-size:1.05em;color:' + INCHIOSTRO + '">Ordine per ordine</h3>';
    ordiniConfiguratore.forEach(function (gruppo) {
      const numero = numeroOrdine(gruppo.ordine);
      gruppo.build.forEach(function (build) {
        const lista = build.lista;
        html += '<div style="background:' + CARTA + ';border:' + BORDO + ';box-shadow:' + OMBRA + ';border-radius:12px;margin-bottom:16px;overflow:hidden">'
          + '<div style="padding:12px 16px;background:rgba(0,0,0,.04);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;border-bottom:1px solid rgba(0,0,0,.07)">'
          + '<strong style="color:' + INCHIOSTRO + '">#' + scudo(numero) + ' — ' + scudo(testo(build.voce.title || lista.titolo)) + '</strong>'
          + '<span style="color:' + INCHIOSTRO_TENUE + '">costo <strong>' + euro(lista.costo_netto) + '</strong> · venduto <strong>' + euro(lista.prezzo_vendita) + '</strong></span>'
          + '</div>'
          + '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:.88em;color:' + INCHIOSTRO + '">'
          + '<thead><tr style="text-align:left;color:' + INCHIOSTRO_TENUE + ';background:rgba(0,0,0,.02)">'
          + '<th style="padding:9px 16px;font-weight:600">Categoria</th><th style="padding:9px 16px;font-weight:600">Fornitore</th>'
          + '<th style="padding:9px 16px;font-weight:600">Codice</th><th style="padding:9px 16px;font-weight:600">Componente</th>'
          + '<th style="padding:9px 16px;text-align:right;font-weight:600">Costo</th><th style="padding:9px 16px;text-align:right;font-weight:600">Venduto</th>'
          + '</tr></thead><tbody>';
        (lista.righe || []).forEach(function (riga) {
          html += '<tr style="border-top:1px solid rgba(0,0,0,.06)'
            + (riga.non_piu_a_listino ? ';background:rgba(243,156,18,.14)' : '') + '">'
            + '<td style="padding:9px 16px">' + scudo(testo(riga.categoria)) + '</td>'
            + '<td style="padding:9px 16px"><span style="color:' + coloreDi(riga.fornitore) + ';font-weight:600">' + scudo(testo(riga.fornitore)) + '</span></td>'
            + '<td style="padding:9px 16px"><code>' + scudo(testo(riga.codice_fornitore)) + '</code></td>'
            + '<td style="padding:9px 16px">' + scudo(testo(riga.nome, riga.non_piu_a_listino ? 'non piu a listino' : '—')) + '</td>'
            + '<td style="padding:9px 16px;text-align:right">' + euro(riga.costo_netto) + '</td>'
            + '<td style="padding:9px 16px;text-align:right">' + euro(riga.prezzo_vendita) + '</td>'
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
