# Upgrade pagati: aggiornamento della scheda, 13/10/2026

Il pagamento #4832 è associato correttamente al PC #4776, riga Shopify stabile e unità 0. Il pagamento è delle18:17, dopo il ciclo Buyer Desk delle18:11. Il file cifrato si rigenera normalmente ogni30minuti; la pagina aperta conservava inoltre il risultato in memoria e non ricaricava le schede da sola.

Recupero effettuato: Buyer Desk38431311052 riuscito. Nella scheda reale #4776 sono visibili Connettività, UPGRADE PAGATI #4832+69,90 e totale1468,80, cioè1398,90+69,90. Nessuna modifica all'ordine Shopify originale, pagamento, cliente o pezzi manuali nel database.

Correzione: una verifica al minuto, solo con sessione attiva e pagina visibile, legge gli ordini attraverso la normale integrazione del gestionale e ricarica il file cifrato. Se un pagamento verificato non è ancora presente sul suo PC, compare una segnalazione di aggiornamento e si richiede il normale Buyer Desk esistente (richieste distanziate almeno5minuti, scheduler senza duplicati). Quando arriva la nuova generazione, le schede e il riepilogo automatico si ricalcolano nella stessa pagina. Le richieste di decifratura concorrenti condividono una sola operazione.

Prima di preparare un nuovo messaggio WhatsApp vengono controllati i pagamenti: niente nuovo link da un catalogo che deve ancora allinearsi. Attesa, annullamenti, riga rimborsata, rimborso parziale a importo e unità ambigue non sono acquisti. PC1/PC2 separati. I dati sono applicati dal motore accoppiamento esistente: il monitor non inventa pezzi, costi o prezzi e non invia messaggi né crea ordini.

Limiti: non è un webhook istantaneo. Con il gestionale chiuso resta il ciclo server Buyer Desk; con pagina nascosta non si fanno chiamate, al ritorno si ricontrolla. Un errore di rete si ritenta, non certifica l'aggiornamento. La distinta manuale e gli acquisti confermati non vengono sovrascritti indiscriminatamente. I componenti extra, il conto e il riepilogo automatico vengono dalla copia cifrata persistente. Per i cambi sostitutivi che differiscono da una scelta manuale il normale controllo dei pezzi diversi resta attivo.
