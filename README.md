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
```

Girano senza dipendenze esterne: caricano i sorgenti in una sandbox `vm` e verificano
la mappa dei `product_id` (unicità compresa) e la cascata degli scope GPO.
Vanno eseguiti prima di ogni merge.
