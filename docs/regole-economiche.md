# Regole confermate da Antonio il 26 ottobre 2026

Queste regole prevalgono sulle note storiche del progetto.

- Il ricavo è quello del singolo ordine Shopify: PC, opzioni collegate, accessori assegnati a quella unità, spedizione pagata e sconti. Il prezzo attuale del prodotto o dell’Excel non sostituisce mai quello dell’ordine già venduto.
- Utile prima delle tasse = vendita IVA inclusa / 1,22 − vendita IVA inclusa × 4,5% − costi netti dei componenti − costi netti di opzioni, voci personalizzate, montaggio e spedizione.
- Utile SRL = 70% dell’utile positivo. Una perdita resta intera. Gli arrotondamenti finali seguono GPU Watch, senza arrotondare anticipatamente l’utile prima della quota SRL.
- Montaggio e collaudo: 32,79 € netti. Spedizione BRT: 11 € netti. Le spese specifiche di una build restano aggiuntive secondo i dati della build.
- ACTION, OMEGA, TIER ONE e CASEKING tramite intermediario: costo netto = listino ×1,10 /1,22. CPU dirette: netto di listino. Gli altri distributori: netto di listino.
- Un costo mancante deve avere nome, codice, quantità e un comando di inserimento visibile nella scheda. Un costo noto e una disponibilità assente sono due fatti distinti.
- Il costo di un altro modello, di un altro fornitore o di un accessorio della stessa famiglia non completa il conto del pezzo scritto in scheda. Senza prezzo esatto, budget esplicitamente previsto o costo inserito, l’importo resta mancante. Le alternative restano proposte separate.
- Il costo inserito per un ordine è un costo netto unitario condiviso nel database, separato dal prezzo pagato e dalla giacenza. Non conferma acquisti. Un valore zero esplicito è valido; un campo vuoto resta mancante.
- Nessun utile completo viene mostrato con costi mancanti. Il riepilogo somma l’utile SRL soltanto dei PC con costi completi e dichiara i totali di costo parziali.
- Ogni approvazione Telegram riuscita aggiorna i riferimenti di GPU Watch, l’Excel e il gestionale. Il gestionale riceve la nuova pubblicazione e aggiorna i conti aperti non confermati; i componenti continuano a rispettare ciò che il cliente aveva acquistato.
- «Conferma acquisto pezzi» registra insieme tutti i componenti, le opzioni e i servizi. Non parte con importi incompleti. I conti confermati sono immutabili rispetto a nuove quotazioni o approvazioni Telegram: i nuovi prezzi valgono per gli acquisti successivi.
- I prezzi pagati già registrati con il percorso precedente restano conservati. Non si ricostruiscono automaticamente spese storiche che non erano state salvate.
- Giacenza PF-600X ancora da comunicare da Antonio: non attribuire quantità presunte.

I costi inseriti e le nuove conferme sono nei campi riservati `_costi_netti_gestionale` e `_acquisto_confermato_gestionale` delle proprietà dell’ordine. Questi dati non sono scelte del cliente e non devono apparire nelle descrizioni Shopify o nei fogli di montaggio.

Il confronto per componente legge la distinta Excel con le GPU approvate aggiornate. L’impronta del catalogo GPU Watch viene pubblicata nel file cifrato. Se somma della distinta e riferimento aggregato non coincidono, la differenza è segnalata: non diventa un costo inventato dell’ordine.
