# Minimal Gamers — Gestionale ordini

Applicazione statica servita da GitHub Pages: apre gli ordini Shopify, li abbina alla
configurazione standard della build e produce le liste di acquisto per fornitore.

**Live:** https://minimalgamers.github.io/minimalgamers-gestionale/

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

`configuratore-ordini.js`, `operatoreA.js`, `operatoreB.js` e `session-no-timeout.js`
non sono caricati da `index.html`: restano nel repo come strumenti a sé.

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
```

Girano senza dipendenze esterne: caricano i sorgenti in una sandbox `vm` e verificano
la mappa dei `product_id` (unicità compresa) e la cascata degli scope GPO.
Vanno eseguiti prima di ogni merge.

## Accoppiamento automatico

La pagina **Automatico** (accanto a «Ordini») mostra, per ogni ordine ancora da spedire, i pezzi
scelti dal motore dei listini: fornitori prioritari al costo più basso, e ogni pezzo segue quello
che quel cliente ha comprato (opzioni scelte e titolo del prodotto nel suo ordine, anche se nel
frattempo il titolo è cambiato). Per ogni PC riporta costo, utile (prezzo del PC più le opzioni
collegate, diviso 1,22, meno il 4,5% di commissioni, meno il costo dei pezzi) e gli avvisi quando
l'ordine non corrisponde alla distinta. In fondo c'è il riepilogo per fornitore. La pagina è in
sola consultazione: non scrive nel database e non ordina nulla. La pagina «Ordini» resta manuale,
con il riquadro dell'utile sotto ogni build.

I dati arrivano da `https://minimal-gamers-listini.pages.dev/accoppiamento.bin`, prodotto dal
Buyer Desk dei listini ogni 30 minuti e cifrato con la password del gestionale: i costi dei
fornitori non sono mai in chiaro né in questo repository (la fixture dei test usa dati inventati).
Codice in `assets/js/accoppiamento-auto.js`.

L'alimentatore lo decide la scheda video finale (`applyGpuPsuRule` in `app.js`, 26/09/2026):
fino alla RX 9060 XT il DeepCool PF-600X 600W, dalla RX 7800 XT / 9070 / RTX 5070 alla RTX 5080
il DeepCool 850W Gold, con la RTX 5090 il PQ1000. Le build DeepCool e MSI tengono il loro
alimentatore se basta. Le vecchie regole scheda madre → alimentatore sono spente.
