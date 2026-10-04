# App iPhone — stessa versione completa del gestionale

Verifica 04/05-10-2026. Base approvata: main `c77b35349fce6d989f5f337d869c779095aa2cde`.
Questo rilascio aggiunge solo manifest, metadati Home Screen, icone ufficiali locali e CSS
per safe area. Nessuna nuova app separata e nessun service worker.

## Fonte, screenshot e confronto

- Source visual truth: `before-mobile.jpg`, `before-desktop.jpg`, catturati dall'harness
  con l'index pubblicato e gli stessi dati finti, non da ordini reali.
- Implementation: `after-mobile.jpg`, `after-desktop.jpg`; `safe-portrait.jpg`,
  `landscape.jpg` e `search.jpg` per le aree protette dello schermo e il popup.
- Stato: E3, tre card fittizie, costi chiusi, Opzioni/Avvisi presenti, stati di utile distinti.
- Desktop CSS 1440×1023, screenshot 1584×1126; mobile CSS 390×900,
  screenshot 429×990. Zoom/densità della cattura locale 1,1, uguale prima/dopo.
- Le coppie sono state aperte affiancate nello stesso input tramite pagine di confronto
  fuori repo. Desktop normalizzato a pari scala per composizione; coppia mobile a
  larghezza CSS 390 per controlli, copy e dettagli leggibili.

## Findings e superfici obbligatorie

Nessuna differenza visuale P0/P1/P2 nelle coppie senza inset. Il desktop mantiene tre
card; la grafica mobile approvata resta la stessa.

- Font/typography: stessi font di sistema, pesi, gerarchia e wrapping. Tutti i campi
  visibili a 390 px mantengono almeno 16 px. Nessun limite al pinch zoom.
- Spacing/layout: a zero inset la griglia desktop e i padding del body sono identici.
  Gli spazi aggiunti in presenza di inset sono intenzionali e proteggono notch/home bar.
- Colors/tokens: nessuna palette cambiata. Si riusano i token approvati; theme e
  launch background sono off-white `#f5f4f1`.
- Images/icons: sfondo e icone del tool originali. Le icone Home sono le varianti
  quadrate 180/512 del logo ufficiale già referenziato dal gestionale, senza ridisegno.
  Dimensioni e formato JPEG verificati direttamente dai file.
- Copy/content: body HTML, classi, ID, attributi, testi e handler sono identici alla
  base approvata (verifica con hash, normalizzando solo CRLF/LF).

## Controlli e isolamento

- 40 test pass, 0 fail nel perimetro non sensibile. Non eseguiti i due test che leggono
  adapter protetti; nessuna pretesa di copertura dell'intera suite.
- Nessuna modifica agli script applicativi o ai due CSS legacy. 18 script non sensibili
  byte-identici nelle preview; adapter Supabase/API esclusi prima della copia.
- 66 combinazioni: 22 schermate × CSS 320, 390 e 844 px. Verticale con inset simulati
  top 47/bottom 34; orizzontale left/right 44 e bottom 21. Nessun overflow orizzontale
  o clipping laterale dei controlli rilevato. A 390 tutti i campi visibili ≥16 px.
- Verificati login, Ordini, E1–E4, Panoramica, Finalizzati, Nascosti, GPO, componenti,
  configurazioni, messaggi, inventario, impostazioni, fornitori e sei popup.
- Conto e Pezzi aperti su una card sintetica: contenuti e toggler originali, nessun
  overflow. Nessuna conferma, ordine, esportazione o altra scrittura reale eseguita.
- Un errore console di salvataggio log è quello atteso dell'harness: «ANTEPRIMA:
  scrittura bloccata». La barriera impedisce richieste remote e non-GET.
- Manifest con scope/id/start_url relativo alla root di questo solo repository,
  display standalone, orientazione libera. Nessun background sync/cache/nuovo storage
  di ordini, costi o credenziali, nessuna notifica push e nessun service worker.

## Comparison history

Prima della QA: corretto il test di body equality per normalizzare CRLF/LF ed evitare
di stampare il body in un fallimento; tolto un offset relativo extra della toolbar
mobile in modo che a zero inset il layout rimanga identico. Le coppie sopra sono le
capture post-correzione. Questi erano controlli preventivi di implementazione,
non una finta seconda iterazione visuale. Il primo confronto visuale non ha trovato
altri P0/P1/P2 e non ha richiesto modifiche.

## Open questions / gap di dispositivo

Non verificato su hardware iPhone/Safari: installazione, lancio autonomo, icona,
sessione, tastiera/VoiceOver, PDF/Excel e operazioni con dati reali. Il browser di
prova è Chromium con misure/inset simulati: non equivale a un test iOS.
Internet e normale accesso restano necessari. Nessun rilascio su main senza OK utente.

## Implementation checklist

1. Approvazione e rilascio coordinato della PR.
2. Verifica che Pages serva manifest, icone e CSS.
3. Antonio aggiunge il sito alla Home da Safari e verifica il dispositivo reale.

Final result: passed
