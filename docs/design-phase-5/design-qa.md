# Popup e moduli iOS — fase 5/7

final result: passed

Preparazione locale, non pubblicata. Dipende dalla fase 4. Solo CSS e decorazione classi dentro i popup, senza cambiare ID, dati, valori, stati, handler, visibilità, ordine o apertura/chiusura delle finestre. Nessun calcolo o flusso applicativo modificato.

- Prove sintetiche a 1440×1023 e 390×900: ricerca componenti prima/riferimento/dopo. Su telefono controllati anche sostituzione massiva, ordine manuale, selezione fornitore, pagamento con coordinate oscurate, conferma cambio pezzo. Nessuna conferma premuta.
- Superfici chiare, campi e placeholder leggibili, focus visibile, controlli 44px. Conferma scura distinta da Annulla; azione Finalizza resta distinta. Radio e checkbox mantengono stato e testo, etichette lunghe ora vanno a capo.
- Finestre entro il viewport; contenuto lungo scorre verticalmente. Nessuno scroll orizzontale a 390px. Z-index e trascinamento originali non alterati.
- JS limitato alle root dei dialoghi, WeakSet evita observer duplicati. Nessun evento, rete, storage, scrittura dei valori o nuovi testi. Test isolato verifica stato disabled, valori, identità e handler prima/dopo e su elementi aggiunti.
- Ricerca testata soltanto con risposte finte: il backend della preview non filtra la ricerca per nome. Non è una verifica dell'accesso ai listini reali.
- Tutti i file applicativi originali restano byte-identici. Nessun nuovo framework/CDN.

Prove: before/reference/after desktop e mobile, comparison.jpg, e cinque popup mobile aggiuntivi.
