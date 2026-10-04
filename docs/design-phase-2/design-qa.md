# Ordini iOS — seconda fase nella repo originale, 04/10/2026

final result: passed

## Ambito e stato

PR #48 approvata da Antonio e mergiata su main: d039150238b61466e7bccb9b3c1cebec052d5244. Pubblicazione GitHub Pages completata con successo (run 37198177929). La fase Ordini è trasferita sul branch codex/gestionale-ios-orders, dalla medesima base verificata. Non è ancora pubblicata: richiede approvazione della seconda PR. Nessun ordine o dato reale modificato.

Riferimento: opzione iOS «Schede native», con precisazioni successive dell'utente: card chiare leggermente trasparenti, sfondo originale con velo neutro, sola intestazione colorata — Minimal nero, MSI hot red, DeepCool hot cyan, Configuratore hot fuchsia. La palette verde/rosso/arancione trasparente degli esiti dell'utile resta il target della fase scrivanie; questo CSS non tocca i conti.

## Verifiche automatiche

- Suite completa sulla repo originale con i file Ordini trasferiti: 17 pass, 0 fail (13 precedenti + 4 nuovi). Esecuzione locale, senza servizi esterni o stampa della configurazione. git diff --check pulito.
- Quattro nuovi test sulla candidate: 4 pass, 0 fail. Isolamento selettori, contratto di navigazione, griglia 3/2/1, hit area, focus, reduced motion, palette e contrasto.
- 18 script applicativi sicuri byte-identici tra clone, candidate e anteprime; supabase-config.js e api-adapter.js esclusi dalla copia e dal confronto. Nessuna ispezione manuale dei segreti.
- index.html differisce solo per il nuovo link CSS. Nessun ID, classe, data attribute, testo o handler dell'app modificato.
- La suite completa NON va eseguita direttamente sulla preview sanitizzata: due test richiedono gli adapter esclusi intenzionalmente. È stata eseguita sul clone originale; i nuovi test sulla candidate. Non introdotti adapter fittizi per far passare i test.
- Dati sintetici nelle anteprime, adapter reali esclusi, fetch non-GET e remoto bloccato, form/nuove finestre bloccati e azioni di scrittura intercettate. Nessun flusso reale contattato.

## Verifica visuale e interazione

- Confronto affiancato prima / riferimento scelto / nuova implementazione con gli stessi sei ordini sintetici, screenshot 1440 e 390 px. Le differenze di masthead/navigazione sono intenzionali: la prima PR è già la fondazione di questa fase, non viene riscritta.
- Desktop 1440: tre card; tablet ~1023: due; 767, 390 e 374: una. Nessun overflow orizzontale rilevato né contenuto della card tagliato.
- Tutti i pulsanti Ordini: area minima 44 × 44 CSS px (tolleranza di subpixel nel browser). Nessun pulsante di elaborazione/finalizzazione premuto.
- Seleziona → selezione del primo ordine → conteggio/azioni E1–E4 mostrati → uscita da selezione: comportamento originale preservato. Area selezione 44 × 44, SVG locale e indicatore aggiuntivo per lo stato selezionato. Nessun ordine mosso.
- Navigazione verso E3: Ordini torna display:none e la scrivania grid. Nessuna forzatura della visibilità dei tab, autenticazione o pannelli.
- Stato vuoto: testo originale «Nessun ordine trovato.», nel flusso e leggibile; non sovrappone gli altri controlli.
- Fixture con titoli lunghi: testo va a capo, non viene troncato. Fixture con 30 pulsanti disabilitati: 30/30 disabilitati, no overflow.
- Focus da tastiera testato tramite Tab, senza eseguire comandi: contorno esterno e bordo interno contrastanti. Hover senza salto della card e reduced motion esplicito.
- Console browser: nessun errore applicativo osservato nella prova Ordini.
- Contrasto testate: Minimal 20,38:1; MSI 4,53:1; DeepCool 7,75:1; Configuratore 4,63:1. Testi secondari leggermente scuriti per >=4,5:1 anche sul composito conservativo #e0e0e0.

## Correzioni prima del pass

1. Dimensioni interne dei contenitori stretti allineate alla proposta scelta, sia su desktop a tre colonne sia su telefono; senza forzare l'altezza della card.
2. Stato vuoto prima fisso e chiaro su fondo chiaro: ora nel flusso con testo scuro, nessun cambio alla condizione che lo produce.
3. Selezione: classe reale orders-select-icon, non un nome inventato; min 44 px, icona locale e stato selezionato leggibile anche sul cyan.
4. Per la fixture disabilitata, gestiti i successivi render asincroni solo nel harness di prova; nessuna modifica al codice dell'app.

Nessun problema P0/P1/P2 aperto nel perimetro della fase Ordini. La sequenza dei sette rilasci non cambia: prima PR già approvata e pubblicata; questa seconda fase richiede la sua approvazione prima del merge. Niente auto-merge.

## File pronti e prossima fase

File di progetto: assets/css/ios-orders.css, tests/ios-orders.test.mjs e il solo link in index.html. Report della prima fase conservato in docs/design-phase-1/design-qa.md. In docs/design-phase-2/ sono trasferiti solo sei screenshot sintetici selezionati. Harness, dati fittizi, adapter e directory candidate non pubblicati.

Rimane la fase E1–E4 con conti/componenti/pulsanti e i tre colori trasparenti dell'utile, poi Panoramica, popup, pagine secondarie e audit mobile generale. Non dichiarare il tool intero completato né pubblicato.

## Evidenza e superfici di fedeltà

- Source visual truth: docs/design-phase-2/reference-desktop.jpg e reference-mobile.jpg.
- Implementazione: docs/design-phase-2/after-desktop.jpg e after-mobile.jpg; prima: before-desktop.jpg e before-mobile.jpg.
- CSS viewport desktop 1440×~1024; screenshot 1584×1126, stesso fattore 1,1. Mobile CSS 390×900, screenshot 429×990. Confronti alla stessa densità e con gli stessi sei ordini sintetici.
- Confronto completo riletto affiancato in comparison.html; regioni card, pulsanti e testo leggibili nel confronto mobile. Nessuna immagine sostitutiva o grafica inventata.
- Font/typography: font di sistema, gerarchia e wrapping allineati alla proposta; nessuna famiglia remota.
- Spacing/layout: compattezza delle card e gap coerenti, tre/due/una colonne responsive, niente altezze rigide.
- Colors/tokens: testate hot approvate e superfici bianche traslucide; palette degli esiti non applicata anticipatamente a E1–E4.
- Image quality: sfondo montagna originale preservato; icone Phosphor locali MIT. Nessuna asset demo inclusa nel runtime.
- Copy/content: testi, ID e handler invariati; differenza di masthead della fondazione intenzionale e già approvata.
- Trasferimento: index.html e CSS coincidono con la candidate già verificata (normalizzando solo CRLF/LF); 18 script applicativi sicuri invariati, file segreti esclusi dalle letture/confronti. Nessuna modifica agli altri tab.

Final result: passed.
