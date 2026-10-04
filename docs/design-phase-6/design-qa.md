# Pagine secondarie iOS — fase 6/7

final result: passed

Preparazione locale, non pubblicata. Dipende dalle fasi 4–5. CSS e decorazione circoscritta alle pagine GPO, componenti personalizzati, configurazioni standard, messaggi, inventario, impostazioni, riepilogo fornitori, finalizzati e nascosti.

- Prove sintetiche a 1440×1023 e 390×900 su tutte e nove le viste. Inventario prima/riferimento/dopo; su telefono le quattro colonne diventano righe etichettate, tutte presenti. Quantità, stati disabled e comandi conservati. Nessuna quantità modificata.
- Confronto DOM prima/dopo: testi e controlli identici in otto pagine. Messaggi ha testo e 31 controlli identici; cambiano solo gli ID di regole dimostrative rigenerati con timestamp/casuale a ogni caricamento, non dal restyling.
- Colorazione di stato degli header `.mg-stato` identica prima/dopo (compreso il verde Finalizzati). Linea PC solo nel contorno. I comandi mantengono nomi e azioni; icone locali Phosphor conservano il testo originale nascosto visivamente. Nessuna aggiunta di etichette commerciali.
- Filtri GPO distinguibili, impostazioni con checkbox originali accessibili via tastiera e focus visibile, nessun cambio dei valori. Contrasto sistemato per etichette delle regole messaggi e sottotitoli del riepilogo.
- Modalità Manuale/Automatico del riepilogo provata solo nell'ambiente sintetico isolato. Nessuna chiamata di scrittura reale, invio ordine o esportazione eseguita. Totale di esempio 805 € netto, otto pezzi per un PC.
- Pulsante Genera PDF mantiene visibilità e handler applicativi, ma non copre più il titolo. Finestre GPO/configurazioni conservano gli ID e il comportamento originale, anche di autosalvataggio: nessun campo di configurazione modificato nei test.
- Nessun overflow laterale rilevato a 390px; correggi-bordo del pannello Messaggi verificato. Native form, 44px, focus, reduced motion, disabled. Nessun framework o font remoto aggiunto.
- I 18 script applicativi non sensibili restano byte-identici. Le due configurazioni/adapter reali non lette, né copiate nella preview. Icone pencil-simple e trash prelevate dal repository ufficiale Phosphor, con licenza già presente.

Prove visuali locali sintetiche: inventario prima/riferimento/dopo desktop e mobile, confronto renderizzato; screenshot delle altre viste desktop e mobile. Il collaudo responsive complessivo è nella fase 7.
