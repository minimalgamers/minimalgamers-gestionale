# Gestionale su iPhone

È lo stesso gestionale pubblicato per il desktop, non una copia con funzioni ridotte.
Ordini, E1–E4, Panoramica e tutte le pagine di supporto restano nell'applicazione originale.
Le card sono su una colonna sul telefono, due sul tablet e tre sul desktop.

## Installazione dopo il rilascio

1. Apri **Safari** su iPhone e visita https://minimalgamers.github.io/minimalgamers-gestionale/.
2. Tocca **Condividi → Aggiungi alla schermata Home**.
3. Se appare **Apri come app web**, lascialo attivo; tocca **Aggiungi**.
4. Apri l'icona **MG Gestionale** ed effettua il normale accesso. Safari e l'app possono
   avere sessioni separate: potrebbe essere necessario accedere di nuovo.

Il sito deve essere quello pubblicato, non l'anteprima locale o una schermata demo.
Non occorrono App Store, abbonamenti aggiuntivi o certificati da installare sul telefono.
Su versioni di iOS diverse la posizione di Condividi può cambiare.

## Connessione e sicurezza

- Serve Internet per aprire/aggiornare i dati e svolgere operazioni. Non è un'app offline.
- Questo intervento non aggiunge service worker, cache di ordini/costi, storage,
  notifiche push, sincronizzazioni in background o code di scritture offline.
- Autenticazione, permessi, database, password, calcoli e azioni restano invariati.
- Gli aggiornamenti seguono il sito pubblicato, senza una seconda versione da gestire.
  Non viene installato un service worker che possa fissare una vecchia versione del tool.
- Le icone sono copie del logo ufficiale già usato dal gestionale, servite localmente
  nelle varianti quadrate 180 e 512 fornite dal CDN Shopify. Nessun nuovo logo.

## Verifica sul dispositivo reale

I controlli automatici/desktop non sostituiscono Safari su iPhone. Dopo il rilascio:
verificare icona, apertura autonoma, accesso, navigazione, tacca/barra inferiore in entrambe
le orientazioni, tastiera, chiusura popup e PDF/Excel con dati autorizzati.
Non dichiarare provate le operazioni reali da una semplice anteprima con dati finti.

Fonti: [guida Apple](https://support.apple.com/it-it/guide/iphone/iph42ab2f3a7/ios),
[WebKit: web app e manifest](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/#every-site-can-be-a-web-app-on-ios-and-ipados),
[WebKit: safe area](https://webkit.org/blog/7929/designing-websites-for-iphone-x/).
