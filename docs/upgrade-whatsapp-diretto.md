# WhatsApp e pagina personale — 10 ottobre 2026

Decisione Antonio: il pulsante WhatsApp della card deve preparare il link con tutte le proposte per quel PC. Non deve chiedere all'operatore di selezionarle né di premere prima «Pagina personale».

## Percorso

1. Un clic sulla card riserva una scheda nel gesto dell'utente (anche per browser mobili), legge i dati aggiornati del Buyer Desk e identifica il singolo PC.
2. Invia al servizio upgrade tutte le alternative ammesse del PC, non soltanto quelle consigliate. Le sette famiglie restano connettività, dissipatore, ventole RGB, scatole componenti, archiviazione aggiuntiva, software e assemblaggio in live. FPS BOOSTER resta separato; non viene riproposto se già pagato per quel PC nei dati disponibili.
3. Crea/aggiorna la pagina personale e apre WhatsApp con il messaggio commerciale e il link. **Non invia il messaggio:** l'operatore preme Invia in WhatsApp. Non è stata introdotta una WhatsApp Business API.
4. Il cliente vede tutte le proposte ammesse, senza aggiunte preselezionate. I consigliati sono un'indicazione, non un filtro. Sceglie sul telefono o sul desktop e paga soltanto le aggiunte.
5. Il servizio esistente verifica nuovamente l'ordine e prepara una bozza Shopify personale. La bozza contiene ordine originale, ID stabile della riga e unità del PC. PC 1 e PC 2 hanno offerte e bozze separate. Il checkout non riscrive l'ordine Shopify originale.
6. Solo dopo pagamento verificato il Buyer Desk associa gli upgrade al PC originale nel file cifrato del gestionale: componenti/opzioni dell'Automatico, incasso e avviso UPGRADE PAGATI. Il passaggio non è istantaneo: attende una pubblicazione riuscita del Buyer Desk (percorso normale circa ogni 30 minuti), poi l'aggiornamento dei dati del gestionale. Le schede/manualità e i prezzi d'acquisto già registrati non vengono sovrascritti da una selezione non pagata.

## Guardie

- Prezzo positivo, utile noto e non negativo, vera chiave GPO e categoria consentita. Nessun cambio di CPU, GPU, motherboard, case, RAM, SSD principale o PSU in questo flusso post-ordine.
- Nessun fallback a un messaggio senza link quando la pagina non può essere verificata/creata.
- Doppio clic sullo stesso PC: una richiesta e una finestra. Dopo un errore si può riprovare.
- Numero mancante, popup bloccato, PC ambiguo o Shopify non verificabile: errore leggibile e nessun invio.
- La finestra personale può essere aggiornata inviando di nuovo il link; le vecchie offerte non vengono riscritte in massa.
- Nessuna chiave o credenziale modificata o registrata. Nessun ordine reale o messaggio cliente nel collaudo.

## Verifica

- Gestionale: `node --test tests/*.test.mjs` — 54 test superati, inclusi 11 nuovi sul flusso diretto.
- Servizio/pagina esistenti: 65 test Node superati (checkout, prezzi dal server, gruppi esclusivi, pagamenti, identità del PC, audio e mobile).
- Accoppiamento pagati: 18 test Python superati, incluso il percorso reale di lettura ordini dal proxy del gestionale e il caso due PC uguali.
- Chrome desktop e viewport 390×844: nel collaudo 13 proposte più FPS, zero preselezioni, selezione AIO 360 display non consigliata, totale 199 euro e nessuna eccedenza orizzontale. Non equivale a una prova su Safari/iPhone fisico.

Cache: `app.js?v=69` e `accoppiamento-auto.js?v=32`.

## Template WhatsApp delle fasi finali — 12/10

Il testo richiesto da Antonio ringrazia della pazienza, annuncia le fasi finali dell'assemblaggio e collega la pagina personale. Mantiene upgrade facoltativi, montaggio a cura del team e la priorità assoluta per chi aggiunge upgrade indicata da Antonio. Chiusura: guida audio e «TI ASPETTIAMO <3». Nome, ordine e link rimangono dinamici; gli ordini con più PC conservano la distinzione della singola unità. Il grassetto WhatsApp usa asterischi singoli, senza escape o markup Markdown doppio.

Per le rate il testo dice «potrai valutare le rate disponibili al checkout»: non promette approvazione o un piano per qualunque importo. L'operatore deve usare questo messaggio soltanto quando il PC è effettivamente nelle fasi finali e la spedizione nei prossimi giorni è una previsione attendibile. Non sono stati modificati stati, tempi, algoritmi di priorità o invii: l'operatore continua a premere Invia in WhatsApp. Le conversazioni già aperte non vengono riscritte o reinviate automaticamente.

## Correzione ordini storici — 12/10

La revisione del template precedente ha superato60test Node, comprese due nuove regressioni per formattazione WhatsApp, nome mancante e identità separata dei PC. Nessun nuovo link cliente, bozza, pagamento o messaggio reale creato per le prove.

Il Buyer Desk risolve il set corrente tramite ID prodotto, anche se l’ordine conserva un set Globo rimosso. La risposta aggiunge `upgrade_catalogo`: se lo stato non è `ok`, il pulsante WhatsApp chiude la finestra provvisoria e chiede di aggiornare il Buyer Desk. Non crea una pagina incompleta con il solo FPS Booster. La lettura dei vecchi file privi di questo metadato rimane compatibile; il rilascio richiede la pubblicazione del nuovo file cifrato.

58test Node passati; quattro regressioni nuove su set non identificato, calcolo non riuscito, vecchio file senza diagnosi e catalogo verificato davvero privo di altre proposte. Nessun messaggio o checkout reale durante le prove. Le offerte già comunicate si aggiornano al normale clic WhatsApp, preservando il codice del link quando il servizio può riusarlo.
