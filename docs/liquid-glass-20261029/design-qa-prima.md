# Scrivanie iOS E1–E4 — fase 3/7, 04/10/2026

final result: passed

## Ambito e stato

Base main verificata `245ae1258d312d0164aca6572a1697d8abd9c20b`, dopo PR #48 e #49 approvate e pubblicate. Questa terza fase è preparata sul branch `codex/design-ios-desks`: NON mergiata e NON pubblicata. Serve approvazione della relativa PR. Non dichiarare completato il redesign dell'intero tool.

Direzione scelta: opzione 2 «Schede native» raffinata dall'utente. Card chiare leggermente trasparenti; sfondo montagna originale; font di sistema; icone piatte. Testate Minimal black, MSI hot red, DeepCool hot cyan, Configuratore hot fuchsia. Utile hot verde/rosso/arancione trasparente con testo e icona opachi. Sotto obiettivo e costi incompleti restano condizioni distinte e mantengono le diciture originali.

Solo `#processed-container`: griglia 3/2/1, card/componenti, toolbar, conto, menu segmentato e footer. Solo scorciatoia Panoramica delle singole card nascosta; pulsante globale conservato. Login, altri tab, modali, IVA, costi, profitto, query e operazioni non modificati. Nessun framework/CDN/asset generato.

## Verifiche automatiche e isolamento

- Suite sul clone originale: 25 pass, 0 fail (17 precedenti + 8 nuovi). Diff check pulito.
- Contratto originale ID/classi/data/handler invariato. Index aggiunge soltanto i due asset versionati di presentazione.
- 18 script applicativi sicuri byte-identici nelle anteprime prima/dopo. `supabase-config.js` e `api-adapter.js` esclusi preventivamente dalle copie e dai confronti delle preview. Nessun segreto estratto o pubblicato.
- Nuovo decoratore: solo root scrivanie; nessuna rete, storage, calcolo, handler di azione o sostituzione innerHTML. Conserva nodi, testo, classi di stato, disabled e hidden. Test unitari su decorazione, rerender e idempotenza.
- Selettori CSS isolati; [hidden] e visibilità gestiti dall'app, non forzati. Test focus, disabled, reduced motion, hit area e contrasto composito >=4,5:1 sui tre esiti.
- Harness e ordini fittizi fuori repo. Adapter reali esclusi, richieste remote/non-GET, form e nuove finestre bloccati. Nessun acquisto/elaborazione/finalizzazione o modifica dati effettuati. Non eseguire la suite generale sulla preview sanitizzata: alcuni test richiedono i file originali intenzionalmente esclusi.

## Browser e confronto visuale

- Screenshot sintetici prima/riferimento/dopo: CSS 1440×1023, pixel 1584×1126; CSS 390×900, pixel 429×990. Confronti desktop della card normalizzati alla stessa scala e mobile prima/riferimento/dopo riletti affiancati, non solo separatamente.
- 1440: tre colonne; 1023: due; 390: una. Nessun overflow orizzontale negli stati provati. Card senza altezza fissa; nomi lunghi a capo. Pulsanti/badge principali min 44 px, menu stretto min 58 px.
- Navigazione E1–E4 verificata senza spostare ordini. Testate RGB: Configuratore 225/0/132, DeepCool 0/217/237, MSI 237/0/40, Minimal 5/5/5.
- Conto, Pezzi, Opzioni, Avvisi e Ordine cliente provati con dati finti. Toggle originali preservati; Ordine cliente mantiene il flip originale. Nessuna conferma/scrittura premuta.
- 54 nodi testo di componenti, conto, pezzi ed esiti: confronto DOM prima/dopo esattamente identico. Esempio DEMO: pagato 1250 €, IVA 225,41 €, commissioni 56,25 €, pezzi 805 €, servizi 40 €, lordo 123,34 €, tasse 37 €, SRL 86,34 €, obiettivo 120 €. NON prezzi correnti aziendali.
- Pezzi mobile: otto righe scrollWidth=clientWidth=310 px; dettagli IVA/intermediario/codici non tagliati. Avviso lungo e opzione aggiuntiva leggibili, contatori preservati.
- Quattro stati prodotti dai dati/calcoli originali: pos/in target, neg/perdita, basso/sotto obiettivo, incompleto/mancano 8 costi. Riempimenti rgba approvati; classi/testi non falsificati dal decoratore.
- Vuoto originale «Nessun ordine elaborato.» nel flusso. Fixture disabled: pulsanti scrivania ancora disabilitati. Titoli lunghi senza overflow.
- Focus tastiera sul menu Pezzi: outline blu visibile. Panoramica globale display:block; scorciatoia card display:none.
- Console finale: nessun errore. Warning atteso del harness: template respinto HTTP 403 dalla barriera alle scritture; nessun servizio reale contattato.

## Differenze intenzionali e correzioni

Toolbar in normale flusso sotto la navigazione già pubblicata, non assoluta nel masthead: evita collisioni con filtri/azioni. Circa 64 px di spostamento desktop dell'intera griglia rispetto al prototipo, non cambia la card. Altezza prima card normalizzata: riferimento 836,15 px, candidate 838,10 px. Masthead fasi 1–2 già approvato e non riscritto.

Non aggiunta dicitura MINIMAL assente nel markup originale: riconoscimento tramite nero e titolo esistente. Icone ufficiali locali Phosphor MIT, piatte, niente emoji sferici visualmente. Decorazioni emoji originali conservate nel textContent per compatibilità.

Prima del pass: URL mask SVG corretto rispetto al CSS; margini/padding legacy dei nomi rimossi, badge centrati, font mobile 13 px; crop corretto per devicePixelRatio 1,1. Fixture stati aggiorna prezzo dell'item oltre al totale e disabled osserva il contenitore fittizio corretto; nessuna formula app cambiata.

Nessun P0/P1/P2 aperto nel perimetro fase 3. Le guide di design hanno influenzato isolamento, confronto alla stessa scala, contrasto, wrapping e focus, non introdotto un nuovo design.

## Prove e consegna

`docs/design-phase-3/`: otto immagini sintetiche before/after/reference desktop e mobile, comparison-desktop e comparison-mobile. Report fase 2 conservato in `docs/design-phase-2/design-qa.md`. Nessuna fixture/password/cliente reale/configurazione riservata caricata.

Anteprima: `http://127.0.0.1:8776/after/?view=e3&demoGrid=1&costi=0`. Approvazione della PR prima di merge. Poi Panoramica, popup/form, pagine secondarie e audit mobile generale, con rilasci separati.

Final result: passed.

## Ultima verifica: supporto app iPhone — 05-10-2026

Questo è il controllo più recente, successivo alle sette fasi già pubblicate.
Report completo, fonte, screenshot, dimensioni, confronto e gap di dispositivo in
`docs/iphone/design-qa.md`. Base visuale main `c77b353`; implementation con la stessa
grafica e funzioni. Confronti affiancati desktop/mobile a pari stato e scala,
40 test pass e 66 combinazioni responsive con dati finti. Nessun P0/P1/P2 aperto
nel perimetro provato; installazione/Safari e operazioni reali restano da verificare
su iPhone. Main non modificato: rilascio dopo approvazione.

Final result: passed
