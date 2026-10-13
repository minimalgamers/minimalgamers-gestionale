# Upgrade pagati dopo acquisto hardware

La scheda mostra ciò che va montato per il cliente. Le righe salvate nel database rimangono la distinta precedente e conservano i prezzi effettivamente registrati. Il pagamento riconciliato dal motore, con linea stabile e unità PC, è condiviso fra operatori: non serve aggiornare tutti i prezzi/pezzi.

Per una sostituzione ammessa (dissipazione e categorie extra già convalidate) la riga visibile diventa la scelta pagata. Il riquadro **Upgrade** espone il pezzo precedente, “NON MONTARE”, il nuovo requisito, la proposta solo quando coerente e il costo stimato. Se manca un modello valido, mostra il requisito pagato e chiede conferma del modello: non inventa SKU, marca o disponibilità.

Il conto conserva il costo precedente, aggiunge il costo stimato del nuovo e rimane dichiaratamente provvisorio. Non accredita automaticamente il surplus come costo zero. Un prezzo d'acquisto assente non viene inventato. La destinazione fisica è magazzino per il pezzo già acquistato; ricezione e quantità vanno confermate nell'inventario esistente.

Il riepilogo automatico limita i PC con upgrade pagati ai soli nuovi pezzi di upgrade, anche se i prezzi d'acquisto non sono stati registrati. Non ripropone l'intera distinta ai listini attuali. Nessun ordine ai fornitori parte automaticamente.

La vista protegge il salvataggio manuale: modificare un altro componente conserva la riga e il prezzo precedenti, il nuovo requisito non viene scritto al posto dell'acquisto. I movimenti di inventario e l'ordine Shopify originale non vengono modificati. Offline conserva la scelta già riconciliata; un pagamento ritirato osservato nella sessione segnala verifica fisica.

Restano le cadenze del monitor: verifica ogni 60 secondi con gestionale aperto e visibile, poi attende il normale motore. Non è un webhook istantaneo. Una scheda già aperta prima del rilascio deve essere ricaricata una volta per caricare il codice nuovo.

Test di regressione: scelta 360, 360 display, mapping assente/errato, prezzo precedente intatto, PC1/PC2, riferimenti incerti, ripetizioni, aggiunta storage secondario, salvataggio altri componenti e riepilogo congelato. Il fixture HTML è una demo locale e non prova uno stato reale dell'ordine.
