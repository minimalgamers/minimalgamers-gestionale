# Regole confermate da Antonio il 26 ottobre 2026

Queste regole prevalgono sulle note storiche del progetto.

- Il ricavo è quello del singolo ordine Shopify: PC, opzioni collegate, accessori assegnati a quella unità, spedizione pagata e sconti. Il prezzo attuale del prodotto o dell’Excel non sostituisce mai quello dell’ordine già venduto.
- Utile prima delle tasse = vendita IVA inclusa / 1,22 − vendita IVA inclusa × 4,5% − costi netti dei componenti − costi netti di opzioni, voci personalizzate, montaggio e spedizione.
- Utile SRL = 70% dell’utile positivo. Una perdita resta intera. Gli arrotondamenti finali seguono GPU Watch, senza arrotondare anticipatamente l’utile prima della quota SRL.
- Montaggio e collaudo: 32,79 € netti. Spedizione BRT: 11 € netti. Le spese specifiche di una build restano aggiuntive secondo i dati della build.
- ACTION, OMEGA, TIER ONE e CASEKING tramite intermediario: costo netto = listino ×1,10 /1,22. CPU dirette: netto di listino. Gli altri distributori: netto di listino.
- Un costo mancante deve avere nome, codice, quantità e un comando di inserimento visibile nella scheda. Un costo noto e una disponibilità assente sono due fatti distinti.
- Il costo di un altro modello, di un altro fornitore o di un accessorio della stessa famiglia non completa il conto del pezzo scritto in scheda. Senza prezzo esatto, budget esplicitamente previsto o costo inserito, l’importo resta mancante. Le alternative restano proposte separate.
- Correzione successiva di Antonio: il costo inserito una volta per lo stesso prodotto e fornitore vale per tutti gli ordini non ancora acquistati, compresi i futuri e gli altri dispositivi. Le correzioni già salvate vengono recuperate senza reinserirle. La quantità moltiplica il netto unitario.
- Le correzioni sono registrate nel database con l’ordine di origine, separatamente da prezzi pagati e giacenza. Prevale la più recente; EAN, SKU e MPN si uniscono soltanto quando l’identità è verificata nel catalogo dello stesso fornitore. Le spese personalizzate restano specifiche dell’ordine. Il ripristino automatico vale per tutti e non fa riapparire vecchie correzioni.
- Inserire un costo non conferma acquisti. Zero esplicito è valido; un campo vuoto resta mancante. I prezzi già confermati restano fissi anche quando la correzione comune cambia.
- Nessun utile completo viene mostrato con costi mancanti. Il riepilogo somma l’utile SRL soltanto dei PC con costi completi e dichiara i totali di costo parziali.
- Ogni approvazione Telegram riuscita aggiorna i riferimenti di GPU Watch, l’Excel e il gestionale. Il gestionale riceve la nuova pubblicazione e aggiorna i conti aperti non confermati; i componenti continuano a rispettare ciò che il cliente aveva acquistato.
- «Conferma acquisto pezzi» registra insieme tutti i componenti, le opzioni e i servizi. Non parte con importi incompleti. I conti confermati sono immutabili rispetto a nuove quotazioni o approvazioni Telegram: i nuovi prezzi valgono per gli acquisti successivi.
- I prezzi pagati già registrati con il percorso precedente restano conservati. Non si ricostruiscono automaticamente spese storiche che non erano state salvate.
- Giacenza PF-600X ancora da comunicare da Antonio: non attribuire quantità presunte.

Regola confermata il 27 ottobre: un componente non disponibile viene evidenziato in rosso nella scheda con il comando «Sostituisci». Finché non viene confermata la sostituzione, codice, fornitore e quantità originali restano nella merce da acquistare e nei totali fornitori, con l’avviso di disponibilità. Un’alternativa suggerita non entra nel riepilogo al posto del prodotto dell’ordine. Un costo sconosciuto resta mancante; una disponibilità sconosciuta resta da verificare. I pezzi a magazzino e gli acquisti già confermati mantengono le protezioni esistenti.

Nel riepilogo delle schede, «magazzino» esclude dall’acquisto solo un pezzo con il prelievo registrato per quel PC. Un vecchio costo pagato o una giacenza non registrata non provano il prelievo. Prima si cerca il costo attuale del prodotto; l’eventuale costo storico resta un riferimento distinto, senza inventare quantità.

Il 28 ottobre Antonio conferma PF-600X a 35 € IVA inclusa (28,69 € netti). Le quantità restano da comunicare. «Costo e magazzino» permette di registrare il costo pagato con IVA inclusa o esclusa, anche per componenti generici fuori listino. Il costo condiviso e la giacenza sono distinti: salvare il costo non preleva pezzi. Le quantità vuote restano sconosciute, zero esplicito indica esaurito. Un prelievo registra quantità e costo del momento; le correzioni successive non cambiano quel prezzo storico.

Un conto con budget fissi o vecchi costi di riferimento è provvisorio e indica i componenti da confermare. L’importo definitivo resta quello basato sui costi reali e sul ricavo storico Shopify. La sostituzione «definitiva» è una scelta esplicita: vale per lo stesso codice e fornitore negli ordini aperti selezionati e nei futuri; conserva quantità, scelte del cliente, colore di case/liquido e acquisti già confermati. Le regole condivise sono registrate in `_sostituzioni_componenti`, separate dalle scelte del cliente.

Correzione del 28 ottobre: «Cambia» e «Modifica costo» devono avere aree separate su ogni riga, anche nelle schede strette. Ogni cambio apre una propria finestra Buyer Desk; una scelta è accettata solo dalla finestra che ha aperto quel cambio, per evitare incroci tra componenti e schede diverse. Un costo confermato resta confermato: una quantità ancora da contare è un’informazione neutra e non richiede di nuovo il costo. Quantità effettivamente insufficienti e indisponibilità accertate restano rosse. Il costo di un modello diverso non conferma quello di un altro prodotto (esempio: NOUA VITRA non conferma CASE ATX).

I costi inseriti e le nuove conferme sono nei campi riservati `_costi_netti_gestionale` e `_acquisto_confermato_gestionale` delle proprietà dell’ordine. Questi dati non sono scelte del cliente e non devono apparire nelle descrizioni Shopify o nei fogli di montaggio.

Il confronto per componente legge la distinta Excel con le GPU approvate aggiornate. L’impronta del catalogo GPU Watch viene pubblicata nel file cifrato. Se somma della distinta e riferimento aggregato non coincidono, la differenza è segnalata: non diventa un costo inventato dell’ordine.

Il 29 ottobre Antonio richiede di riutilizzare i costi già disponibili senza
domandarli di nuovo su ogni ordine. Un budget previsto resta riconoscibile come
riferimento nel conto stimato, con il comando per modificarlo; non viene promosso
a prezzo realmente pagato. Anche l'editor parte dall'importo già noto. Una nota
di visualizzazione «(AMAZON)» non cambia l'identità del prodotto; un altro modello,
colore, dimensione o fornitore continua a richiedere il proprio costo.

La conferma della sostituzione permette l'ambito singolo, gli altri ordini aperti
selezionati oppure la regola definitiva anche per i futuri. La regola condivisa
conserva il prezzo netto scelto, l'eventuale listino originale e la data della
scelta. Questa quotazione è soltanto un riferimento quando manca un costo
attuale: non prevale sui listini aggiornati, su un costo corretto dall'operatore
o sui prezzi già pagati. Non conferma acquisti o movimenti di magazzino.

Un prezzo di listino noto rimane utilizzabile anche se il prodotto è riservato,
esaurito o non ordinabile: prezzo e disponibilità sono verifiche separate. Se uno
SKU non si trova più, il MPN esplicitamente registrato nel nome della riga può
ricondurlo alla quotazione dello stesso prodotto e fornitore. Non basta una
somiglianza nel nome. Se la quotazione esiste soltanto presso un altro fornitore,
la scheda mostra quel fornitore, il suo prezzo e la disponibilità con «Valuta
offerta»: il costo non viene attribuito al fornitore originale e la sostituzione
richiede la normale conferma dell'operatore.

La scheda Liquid Glass selezionata il 29 ottobre presenta gli ordini nella
navigazione laterale e un elenco unico di hardware, extra, upgrade e servizi.
Il conto continua a usare i calcoli e il ricavo storico esistenti. Un riferimento
Excel è etichettato come tale: non diventa un prezzo rilevato alla data di vendita.
Un costo mancante impedisce di mostrare un utile completo e i limiti di spesa.
Gli scostamenti positivi dai riferimenti disponibili sono mostrati prima delle
altre righe, senza cambiare gli indici delle azioni o l'identità dei componenti.

«Limiti» mostra il massimo netto della riga per conservare un utile positivo o
raggiungere l'obiettivo, a parità di tutti gli altri costi. Per quantità multiple
vale il totale della riga. Il margine prudenziale di un centesimo evita che gli
arrotondamenti creino un limite superiore al margine disponibile. Se l'obiettivo
non è recuperabile intervenendo solo su quella riga, il messaggio lo esplicita.

La conferma nella scheda restringe il normale percorso di conferma al solo PC
attivo. La conferma generale della scrivania mantiene il suo ambito precedente.
Gli acquisti già registrati restano bloccati. I componenti sostituiti da un
upgrade pagato sono marcati «non montare», conservandone il costo precedente.
Fonti, verifiche, scorte e controlli originari restano accessibili dalla scheda.
