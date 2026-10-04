# Collaudo responsive iOS — fase 7/7

final result: passed

CSS di rifinitura mobile, dopo le sei fasi precedenti. Non modifica azioni, dati, formule, visibilità, selezioni o stati. Input nativi a 16px in tutto il tool, incluso accesso e filtri, senza intervenire sul contenuto dei campi; margini inferiori compatibili con safe area; impaginazione più stretta a 320px. Nessuna nuova dipendenza.

## Prove effettuate

- Anteprima isolata con soli dati sintetici, senza configurazione Supabase né adapter di produzione, chiamate esterne e scritture bloccate. Nessun ordine reale aperto o modificato.
- Collaudo finale ripetuto su 110 combinazioni: 22 viste × cinque larghezze CSS osservate 320, 390, 767, 1023 e 1440px. Ordini, E1–E4, Panoramica, Finalizzati, Nascosti, GPO, Componenti, Configurazioni, Messaggi, Inventario, Impostazioni, Fornitori, sei finestre e Accesso. Nessun overflow orizzontale del documento né campo/pulsante fuori dai lati del viewport. Tutti i campi visibili a 320/390/767px sono almeno 16px.
- Nota dimensioni: il browser locale ha zoom 110%; 1024 richiesti producono 1023 CSS effettivi. La prova iniziale a 768 risultava 768,18 CSS reali, cioè oltre la media query mobile. Ripetuta a 767 CSS per verificare correttamente il suo lato mobile. Nessun cambio delle soglie di impaginazione per adattarle al simulatore.
- Griglia delle card conservata: desktop tre, tablet due, telefono una. Colori delle linee PC distinti dai colori di stato; quattro esiti di utile conservati. Panoramica generale resta disponibile, tolta soltanto la scorciatoia ridondante nella card.
- Focus visibile e pulsanti disabilitati verificati nell'ambiente sintetico. Nessun clic su conferma acquisto, finalizza, elimina, salva, invia o esporta. Le prove responsive non attestano il funzionamento di operazioni reali.
- Verifica esplicita dei quattro esiti: sotto obiettivo, perdita, in target e costi mancanti; tutti distinguibili con testo e simbolo, senza affidarsi al solo colore. Prova con 41 pulsanti disabilitati, zero riabilitati dal design; stato vuoto «Nessun ordine trovato» e titoli lunghi senza overflow. Focus Tab su `show-totals-toggle` con contorno solido blu, senza cambiare la selezione.
- Le tabelle mobile mostrano le colonne come righe etichettate, senza eliminare dati. Testi lunghi vanno a capo. Nessun vincolo al brand o modifica delle diciture commerciali.
- Verifica statica del contratto HTML originale e dei controlli; test isolati dei decoratori su ri-render ripetuti. I 18 script applicativi non sensibili sono byte-identici alla base pubblicata. I due file riservati non letti né trasferiti nelle anteprime.
- 36 verifiche locali superate, zero fallimenti, eseguendo tutti i file di test eccetto i due che leggono i file riservati (`accoppiamento-auto.test.mjs` e `config-components.test.mjs`). Non si dichiara eseguita l'intera suite riservata.
- Browser Chromium in simulazione responsive: non è un collaudo su un iPhone/Safari fisico. Le regole font e safe-area sono predisposte anche per iOS; si consiglia un rapido riscontro sul dispositivo reale dopo il rilascio.

## Rilascio

Antonio ha approvato tutti i rilasci del solo restyling il 04/10/2026. Si procede con una PR per fase, verificando Pages prima della fase successiva. Questa approvazione non autorizza cambi di prezzi, componenti, ordini, impostazioni o logiche aziendali.

## Limiti noti

La ricerca ordine nella Panoramica sintetica non ha filtrato la lista; la fase 4 lo documenta e non cambia il codice applicativo. Le regole Messaggi rigenerano ID casuali nella fixture. Non sono errori introdotti dal CSS. I test che leggono i due file riservati sono esclusi dal collaudo locale di design.
