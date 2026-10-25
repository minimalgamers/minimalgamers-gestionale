# Minimal Gamers — Gestionale ordini

Applicazione statica servita da GitHub Pages: apre gli ordini Shopify, li abbina alla
configurazione standard della build e produce le liste di acquisto per fornitore.

**Live:** https://minimalgamers.github.io/minimalgamers-gestionale/

## App sulla schermata Home di iPhone

Lo stesso gestionale può aprirsi come web app dalla Home, senza una versione ridotta.
Servono Internet e il normale accesso. Istruzioni di installazione, sicurezza e prova
sul telefono in [docs/iphone-home-app.md](docs/iphone-home-app.md).

## Come è fatto

Non c'è build step: `index.html` carica direttamente gli script da `assets/js/`.
Ogni `<script>` porta un `?v=` che serve da cache-busting: **quando modifichi un file
JS devi incrementare il suo `?v=` in `index.html`**, altrimenti il browser continua a
servire la versione vecchia.

I file principali:

| File | Cosa fa |
|---|---|
| `app.js` | nucleo del gestionale: ordini, componenti, stampe |
| `order-config-matcher.js` | dal `product_id` Shopify alla chiave configurazione |
| `gpo-manager.js` | mappature Globo Product Options, con scope per linea |
| `supabase-config.js` | accesso al database |
| `multi-order-handler.js` | gestione di più ordini insieme |
| `excel-export.js` | esportazioni |
| `category-summary.js`, `supplier-summary.js` | riepiloghi per categoria e fornitore |
| `message-template-engine.js`, `message-templates-page.js` | messaggi ai clienti |
| `gpo-page-manager.js`, `amazon-products-manager.js`, `api-adapter.js`, `pc-config-parser.js`, `search-fix.js` | pagine e utilità di supporto |

`session-no-timeout.js` non è in `index.html` ma lo carica `search-fix.js`. `operatoreA.js` e
`operatoreB.js` non sono caricati: restano nel repo come strumenti a sé.

La vecchia scheda «Configuratore» (`configuratore-ordini.js`, 27/08) è stata tolta il 03/10/2026: leggeva le
liste dalla tabella Supabase `configuratore_liste_fornitori`, leggibile con la chiave pubblica e non più
scritta dal configuratore. I PC del configuratore ora passano da Ordini → E1–E4 come le altre build
(`build-configuratore.js`, vedi sotto) e i loro pezzi sono anche nella Panoramica.

## PC del configuratore e colori delle linee (03/10/2026)

I PC creati dai clienti nel configuratore seguono lo stesso percorso delle altre build: compaiono in
**Ordini** e si mandano a mano in una scrivania E1–E4. `build-configuratore.js`:

- li riconosce dallo SKU della riga d'ordine (`MG-CFG-<id prodotto>`, messo dal configuratore) o dai dati
  dei listini (`configuratore` nel file cifrato) per i PC creati prima dello SKU;
- quando si elaborano, riempie la scheda con la lista dei pezzi che il configuratore salva sul prodotto
  (metafield `configurator.lista_fornitori`, letto dai listini e consegnato cifrato): per ogni pezzo lo
  **stesso prodotto** scelto dal cliente, dal fornitore più conveniente di oggi con le regole delle build
  Minimal, con codice, nome esatto e fornitore; la grafica integrata ha la sua riga. Niente regole delle
  distinte e niente «pezzi migliori» equivalenti. Se la lista non è ancora arrivata (i listini si aggiornano
  ogni 30 minuti) l'elaborazione si ferma con un avviso;
- colora le card in Ordini, nelle scrivanie e nella Panoramica: **MSI rosse**, **DeepCool ciano**,
  **configuratore viola** con l'etichetta «🧩 BUILD CONFIGURATORE». Nei finalizzati resta il colore dello
  stato e la linea si vede dall'anello attorno alla card.

Il riquadro del conto e il riepilogo fornitori funzionano come per le altre build; nella Panoramica
il confronto non è con l'Excel ma con i costi di quando il cliente ha comprato.

## Le tre linee di prodotto

Il catalogo ha tre linee e il gestionale le tiene separate:

- **MINIMAL** — i componenti ruotano fra i brand disponibili.
- **MSI** — i componenti devono essere MSI dove MSI li produce.
- **DEEPCOOL** — linea partner: case, raffreddamento e alimentatore sono DeepCool, acquistati da ABACO.

Le mappature GPO seguono una cascata a tre livelli, dalla più specifica alla più generica:

```
DEEPCOOL AURORA::DISSIPATORE   →  vale solo per quella build
DEEPCOOL DISSIPATORE           →  vale per tutta la linea DEEPCOOL
DISSIPATORE                    →  vale per tutti
```

Quando una build di linea non trova né la riga di build né quella di linea e ricade
sulla globale, in console compare un avviso `[GPO scope]`: è il segnale che manca una
mappatura dedicata, non un errore bloccante.

## Test

```bash
node tests/order-config-matcher.test.mjs
node tests/gpo-mapping-scope.test.mjs
node tests/config-components.test.mjs
node tests/accoppiamento-auto.test.mjs
node tests/gpu-psu.test.mjs
node tests/build-configuratore.test.mjs
node tests/assembly-labels.test.mjs
node --test tests/precise-refresh.test.mjs
```

Girano senza dipendenze esterne: caricano i sorgenti in una sandbox `vm` e verificano
la mappa dei `product_id` (unicità compresa) e la cascata degli scope GPO.
Vanno eseguiti prima di ogni merge.

Le etichette di montaggio distinguono lo SKU di un bundle dal monitor incluso:
`MG-BUNDLE-*` e `MG-SETUP-*` non sono codici monitor. La descrizione viene dalla
distinta, confrontata con le specifiche del titolo acquistato; i vecchi ordini con
lo SKU PC nella riga MONITOR vengono corretti in visualizzazione, senza cambiare
codici o prezzi d'acquisto. Il colore del case deriva dal pezzo o dalla sola riga
PC, escludendo le righe OPZIONI. Le note interne di sostituzione e le firme con data
vengono nascoste nelle schede, PDF ed Excel, conservando modello, MPN e fornitore.
La regola che abbina il colore mostrato di GPU e scheda madre al case resta attiva.

## Accoppiamento automatico e Panoramica

La pagina **Panoramica** (accanto a «Ordini»; fino al 03/10/2026 si chiamava «Automatico», il codice
usa ancora `data-tab="automatico"`) mostra, per ogni ordine ancora da spedire, i pezzi
scelti dal motore dei listini: costo netto minimo fra le offerte disponibili, e ogni pezzo segue quello
che quel cliente ha comprato (opzioni scelte e titolo del prodotto nel suo ordine, anche se nel
frattempo il titolo è cambiato). Per ogni PC riporta costo, utile (prezzo del PC più le opzioni
collegate, diviso 1,22, meno il 4,5% di commissioni, meno il costo dei pezzi) e gli avvisi quando
l'ordine non corrisponde alla distinta. In fondo c'è il riepilogo per fornitore. La pagina è in
consultazione e non ordina nulla: l'unica scrittura è il magazzino, quando si conferma «Prendi dal
magazzino» o «Annulla». La pagina «Ordini» resta manuale,
con il riquadro dell'utile sotto ogni build.

I dati arrivano da `https://minimal-gamers-listini.pages.dev/accoppiamento.bin`, prodotto dal
Buyer Desk dei listini ogni 30 minuti e cifrato con la password del gestionale: i costi dei
fornitori non sono mai in chiaro né in questo repository (la fixture dei test usa dati inventati).
Codice in `assets/js/accoppiamento-auto.js`.

Il 25/10/2026 Antonio ha riconfermato il canale di acquisto: ACTION, OMEGA, TIER ONE
e CASEKING tramite intermediario (`listino ×1,10` come totale IVA inclusa, poi `÷1,22`
per il costo netto), con CPU dirette al netto di listino. Gli altri distributori restano
al netto di listino. Il Buyer Desk mostra separatamente costo d’acquisto e listino fornitore,
e usa lo stesso costo del gestionale per scegliere il minimo. I prezzi pagati già
confermati restano storici. Le automazioni GPU Watch non cambiano per questa correzione.

«Aggiorna prezzi» attende un nuovo catalogo e una nuova elaborazione oppure verifica
che l'ultima pubblicazione sia recente. Un errore, un timeout o il contratto dati
precedente non diventano un messaggio di successo. Prima del salvataggio si ricontrollano
prezzo, identità del prodotto, requisiti Shopify e quantità complessive degli ordini.
Arrivi, riservati e stock da confermare non sono proposte automatiche acquistabili.
Il colore limita gli acquisti soltanto per case e AIO; l'etichetta GPU/MOBO rimane invariata.
Gli SSD 480GB sono ammessi nella classe 500GB, come confermato da Antonio.

I tre percorsi di elaborazione condividono l'assegnazione degli accessori per unità di PC:
tastiere, mouse, cuffie, kit e monitor conservano SKU, nome e quantità, senza sostituire
gli accessori inclusi nel bundle. Le schede mostrano anche gli articoli acquistati su Shopify.
Per schede storiche non acquistate il pulsante prepara una rettifica prima/dopo:
nessuna riscrittura durante il semplice ricalcolo. Solo la conferma nella finestra
applica le righe selezionate, dopo un backup locale in `accoppiamento_backup_accessori`.
La rettifica modifica esclusivamente gli accessori, controlla eventuali modifiche concorrenti
e si blocca se trova prezzi pagati o un ordine finalizzato.

L'alimentatore lo decide la scheda video finale (`applyGpuPsuRule` in `app.js`, 26/09/2026):
fino alla RX 9060 XT il DeepCool PF-600X 600W, dalla RX 7800 XT / 9070 / RTX 5070 alla RTX 5080
il DeepCool 850W Gold, con la RTX 5090 il PQ1000. Le build DeepCool e MSI tengono il loro
alimentatore se basta. Le vecchie regole scheda madre → alimentatore sono spente.
