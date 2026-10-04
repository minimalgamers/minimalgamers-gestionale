# Design QA — fase 1: base e navigazione

Data: 04/10/2026. Base: `ffd263f` (main). Esito: **passed per il perimetro della PR 1**.

## Perimetro e decisioni

Prima delle sette PR richieste dal brief: token, fondo, tipografia, intestazione, strumenti, barra delle schede e filtri. Direzione scelta da Antonio: iOS/macOS chiaro, sfondo montagna originale alleggerito con velo neutro, niente wallpaper multicolore.

Le card, il conto, la barra della scrivania, la Panoramica e i popup **non sono ancora ridisegnati da questa PR**. Le differenze in queste regioni rispetto all'anteprima completa sono intenzionali: fasi 2–6. I token già approvati per le linee (DeepCool cyan, MSI red, configuratore fuchsia, Minimal black) e l'utile sotto obiettivo hot orange sono predisposti, ma qui non sovrascrivono ancora i colori delle card.

Non vengono cambiate formule, importi, autenticazione, query, eventi, stati, mappature o nomi delle schede. Nessun JavaScript applicativo modificato. `data-tab="automatico"` resta la chiave della Panoramica; nessuna vecchia scheda Configuratore reintrodotta.

## Metodo

Anteprime prima/dopo isolate fuori dal repository, con risposte sintetiche al posto degli adapter di produzione, connessioni esterne e invii dei form bloccati. Nessuna password usata. Tutti i costi, componenti e ordini negli screenshot sono **fittizi**; non rappresentano listini correnti o acquisti reali.

Confronto simultaneo della direzione approvata e dell'implementazione in un'unica pagina locale: vista completa, regione della navigazione e due viste mobile affiancate. L'anteprima completa, i fixture e la pagina di confronto non fanno parte del sito pubblicato.

Viewport CSS verificati: 1440×1023 e 390×900. Controlli aggiuntivi: 375×900, 768×909, 1024×909 e 844×390 (orizzontale). Il motore di screenshot esclude alcune barre di scorrimento: i JPEG non hanno necessariamente larghezza identica al viewport CSS, che è stato letto direttamente dalla pagina. Font di sistema, zoom host 1,1; nessun font esterno aggiunto.

## Confronto per superficie

| Superficie | Risultato |
| --- | --- |
| Caratteri | Stack di sistema Apple/Segoe UI, titoli compatti, controlli leggibili. Rimosso dal titolo del sito il solo marcatore «anteprima con dati finti», che appartiene al fixture. Nessun testo operativo riscritto. |
| Spazi e layout | Intestazione e schede in flusso, strumenti allineati, filtri nella parte destra della barra desktop; al telefono le azioni restano sotto le schede. Comandi non tagliati e nessuno scroll orizzontale nelle prove indicate. |
| Colori | Chrome grigio chiaro, scheda attiva bianca e testo scuro. Wallpaper originale preservato; il velo non sostituisce `background-image`, quindi il selettore di sfondi dell'app rimane operativo. |
| Asset e icone | AVIF e logo originali, SVG Phosphor locali con licenza MIT. Icone selezione sempre visibili; modalità selezione riconoscibile anche dopo il ripristino del filtro bianco legacy. Nessuna illustrazione finta o CDN aggiunta. |
| Contenuti | Numero ordini, Ordini/Panoramica/E1–E4 e filtri conservati. Stesse classi, ID, data attribute e handler inline originali verificati con impronta del contratto DOM. |
| Stati | Selezione attiva/disattiva, scheda attiva, controlli nascosti e disabilitati conservati. Il CSS non forza visibile il contenitore delle schede mentre il codice lo nasconde in selezione. |

## Verifiche interattive e accessibilità

- Navigazione Ordini, E1, E2, E3, E4 e Panoramica: contenuto attivo corretto, senza eseguire pulsanti di elaborazione.
- Entrata/uscita dalla selezione E3 su mobile: schede `none`/`flex`, azioni `flex`/`none`, nessun ordine finalizzato o spostato.
- Strumenti e controlli delle barre: altezza CSS circa 44 px, anche a 375 px e in orizzontale.
- Focus via tastiera sulla scheda E4: contorno blu presente. Regola per riduzione movimento presente e coperta da test statico; preferenza di sistema non modificata.
- Contrasti dei token del chrome: testo schede 6,40:1; testo secondario sul fondo neutro 5,15:1; testo strumenti 14,28:1; focus blu su bianco 6,07:1. **Non è una certificazione AA dell'intero gestionale**, le altre regioni saranno verificate nelle loro PR.
- Accesso a 390 px: modulo visibile senza password o invio. Corretto il solo difetto grafico legacy che lo nascondeva sotto 768 px; meccanismo di accesso invariato.
- Console: nessun errore JavaScript nelle prove finali. Avviso atteso per il caricamento template esterno bloccato dal fixture (HTTP 403); nessuna chiamata autorizzata verso servizi reali.

## Correzioni emerse durante la verifica

1. P2 — icona di selezione bianca su fondo chiaro: sostituita da asset locale e stato attivo visibile.
2. P2 — il `flex: 1` inline comprimeva le schede mobile: corretto il dimensionamento senza forzare `display`, preservando la modalità selezione.
3. P2 — filtri in una riga desktop aggiuntiva e selezione troppo distante: riallineati alla direzione approvata.
4. P2 — modulo di accesso nascosto dal CSS mobile precedente: visibile nello stato non caricato, senza modifiche a password o handler.

Tutti risolti e riesaminati nel confronto finale. Nessun P0/P1/P2 aperto nel perimetro. Nota: le vecchie card e i loro pulsanti sono ancora presenti in questa fase, non indicano il completamento delle fasi successive.

## Prove prima/dopo con dati finti

[Desktop prima — viewport 1440](docs/design-phase-1/before-desktop.jpg) · [Desktop dopo](docs/design-phase-1/after-desktop.jpg)

[Mobile prima — viewport 390](docs/design-phase-1/before-mobile.jpg) · [Mobile dopo](docs/design-phase-1/after-mobile.jpg)

## Test e rilascio

`node --test tests/*.test.mjs`: 13 pass, 0 fail (otto file di test funzionali esistenti e cinque controlli di fondazione). `git diff --check`: pulito. Diff applicativo limitato a `index.html`, nuovo CSS e icone locali; nessuna modifica agli script o alla configurazione di Supabase.

File della PR: `index.html`, `assets/css/ios-foundation.css`, `assets/icons/` (11 SVG e licenza), `tests/ios-foundation.test.mjs`, questo report e quattro JPEG in `docs/design-phase-1/`.

**Nessun merge né pubblicazione automatica.** Antonio approva la PR prima del merge. La fase seguente è la card di Ordini, seguita dalle scrivanie e dal conto, mantenendo il layout affiancato approvato.
