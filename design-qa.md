# Scheda ordine Liquid Glass - 29 ottobre 2026

final result: passed

## Fonte e perimetro

Direzione scelta esplicitamente da Antonio: terza immagine dell'ultima serie Liquid Glass.
Fonte: outputs/gestionale-liquid-glass-20261029/riferimento-selezionato-3.png
Risultato: outputs/gestionale-liquid-glass-20261029/demo-desktop-1488.jpg
Confronti letti insieme: confronto-desktop-finale.png e confronto-righe-finale.png nella stessa cartella.
Report precedente letto e conservato in docs/liquid-glass-20261029/design-qa-prima.md.
La prova visuale usa esclusivamente dati fittizi e nessun database.

## Dimensioni, stato e normalizzazione

Desktop Chrome: viewport impostato 1488 x 1056 CSS pixel; screenshot restituito 1478 x 1049 pixel.
Fonte Image Gen: 1487 x 1058 pixel. Confronto normalizzato a larghezza 1487, scala uniforme
1,0061 della cattura, immagine risultante 1487 x 1055 e tre pixel neutri aggiunti in basso.
Nessuna deformazione, taglio di contenuti o giudizio su differenze di tre pixel di densita'.
Stato: E1, ordine DEMO-01, tre aumenti, undici voci complete, due acquisti conservati,
extra ventole e upgrade Wi-Fi pagato dal cliente con hardware ancora da preparare.
Mobile aggiuntivo: viewport 390 x 844 CSS pixel, clientWidth e scrollWidth entrambi 380;
prova in Chrome con larghezza mobile, non test su un iPhone fisico o Safari.

## Confronto e iterazioni

- P2 iniziale: tabella troppo alta, mancavano servizi e totale nel primo viewport.
  Misurate righe di 53 px e comandi Limiti su seconda riga. Ridotti padding duplicati,
  riuniti i comandi e mantenuti modello e codice leggibili; eliminata la sola ripetizione
  visiva della caption mantenendola accessibile. Undici righe, totale e CTA visibili.
- P2 iniziale del harness mobile: testata non responsiva e offset relativo della nav
  dimostrativa causavano sovrapposizione e bodyWidth 416 su viewport380. Corretti gli
  stili del harness; verificato 380/380 e lettura della scheda sotto la navigazione.
- P2 finanziario intercettato: gli stati della barra laterale dovevano distinguere
  perdita, sotto obiettivo e costi mancanti. Collegati agli stessi esiti del conto,
  con test espliciti anche per pareggio. Nessun utile positivo con costi incompleti.
- I confronti finali mostrano gerarchia, vetro chiaro, ordine laterale selezionato,
  tre righe aumentate in testa e elenco completo. Nessun P0/P1/P2 visuale aperto
  negli stati dimostrativi provati.

## Cinque superfici di fedelta'

- Tipografia: stack di sistema Segoe/SF gia' usato dal gestionale, titolo27,
  importi25, righe12-14 a seconda della larghezza e note codice10-11. Numeri tabulari,
  nome e codice separati; nessun testo monetario tagliato. Le note non sostituiscono
  i valori principali. Dimensioni contenute per includere tutte le voci nella scheda.
- Spazi: navigazione laterale, una superficie principale, righe e separatori semplici.
  Azioni allineate, nessuna altezza rigida per contenuti reali piu' lunghi. Mobile con
  righe su due colonne e selettore ordini orizzontale indipendente dalla pagina.
- Colori: vetro bianco/azzurro traslucido, testo scuro, aumenti arancio, pagato verde,
  perdita rossa e costi incompleti ambra. Focus blu e alternativa opaca quando richiesta.
- Immagini: riusato lo sfondo originale del prodotto e le icone locali Phosphor
  con licenza gia' presente. Nessuna illustrazione, forma CSS o SVG artigianale sostituisce
  asset del riferimento. Nessun nuovo logo aziendale inventato.
- Testi: corretta intenzionalmente la dicitura Alla vendita quando manca una fonte
  storica verificabile. Il confronto diventa Riferimento Excel, con copertura esplicita.
  Nessun fornitore inventato per servizi, nessun altro prezzo attribuito ad ACTION.

## Funzioni provate e protezioni

Ricerca Sara nella navigazione; passaggio a DEMO-02; conferma dimostrativa riferita
soltanto a DEMO-02 e senza scritture; limite RAM285,83 per utile positivo e42,97 per
obiettivo170 a parita' degli altri costi; modalita' modifica costo RAM precompilata75;
annullamento senza salvataggio. Fonti e gestione componenti originali restano apribili.
Console del browser senza errori/warning nelle prove. I test del repository includono
costi mancanti, extra nominati, prezzi acquistati, quantita', ordine degli indici,
MPN non ambiguo, ambito singolo e ambito scrivania. Nessun messaggio o acquisto inviato.

## Differenze intenzionali e limiti

Rimosso il duplicato del totale rincari gia' presente nel richiamo arancione.
Conservati i controlli globali E1-E4 e di gestione del prodotto, anche se il mock
aveva solo una barra semplificata. Le azioni originali non vengono sostituite con
comandi fittizi. I codici reali sono necessari e aggiungono una nota alle righe.
Per dati storici assenti il confronto di vendita rimane indisponibile, senza
ricostruzioni o prezzi inventati. Cambiamenti di dati reali e conferme di acquisto
non sono stati eseguiti nel collaudo; passano dai percorsi esistenti testati.

## Checklist

- Fonte e cattura aperte e confrontate insieme, anche in dettaglio.
- Densita' desktop corretta e overflow mobile assente negli stati provati.
- Tutte le categorie ed extra presenti nell'elenco principale.
- Prezzi pagati protetti; conferma ristretta al PC attivo.
- Nessuna modifica a IVA, commissioni, ricavo o calcolo utile esistente.
- Nessun P0/P1/P2 aperto nel perimetro verificato.

final result: passed
