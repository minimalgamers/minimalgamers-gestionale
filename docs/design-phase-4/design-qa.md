# Panoramica iOS — fase 4/7

final result: passed

Preparazione locale, non pubblicata. Base main `3df3b9fe788c67601536bfb42b0416b1cfed472e`. Solo Panoramica (`#automatico-container`), nessuna logica o sorgente dati cambiata. Asset CSS/JS locali versionati.

- Confronto renderizzato prima/riferimento/dopo a CSS 1440×1023 e 390×900. Fonte: «Schede native» approvata; sfondo originale e font di sistema.
- Testo completo Panoramica identico prima/dopo (inclusi SKU, quantità, disponibilità, costi, utile e obiettivo). Esempio sintetico: 7 ordini, venduto 8750, costo 5915, utile 863,38. Non dati aziendali correnti.
- Decoratore confinato a questa root; conserva elementi, valori, stati e handler. Copia solo i titoli delle colonne in attributi di presentazione e nasconde visivamente l'emoji senza cambiare textContent.
- Telefono: tutte le colonne diventano righe etichettate, senza scroll laterale; scelta cliente e disponibilità non più occultate dal CSS mobile preesistente. Differenza intenzionale dal prototipo che comprimeva le tabelle a 10px.
- Quattro stati utile preservati con riempimenti hot trasparenti e icone locali piatte. Linee con palette più recente approvata, non con il vecchio viola del prototipo.
- Focus e disabled preservati, controlli 44px, reduced motion. Nessun nuovo framework/CDN.
- 18 script applicativi byte-identici; adapter reali esclusi preventivamente dalla preview. Barriera a connessioni esterne, non-GET e scritture. Mai premute conferme.

Prove visuali: before-desktop.jpg, reference-desktop.jpg, after-desktop.jpg, before-mobile.jpg, reference-mobile.jpg, after-mobile.jpg, pieces-mobile.jpg, comparison-desktop.jpg, comparison-mobile.jpg. Mobile più lungo per non perdere colonne: non è una perdita di dati.

Limite della prova: il filtro sintetico per numero ordine non ha cambiato l'elenco nella preview. Non viene dichiarato come verificato e non viene modificato codice di filtraggio. Conferme, esportazioni e salvataggi non eseguiti.
