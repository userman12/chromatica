# Piano di lavoro — modalità di consultazione e riordino dell'interfaccia

Deriva da `~/Desktop/chromatica-analisi-ui-ux.md` (2026-08-07). Questo file è la
versione eseguibile: cosa si tocca, in che ordine, e come si verifica.

Stato di partenza: 7.471 dipinti · 34.062 colori · 5 collezioni · 2.246 artisti,
commit `06f857f`.

---

## Il principio che regge tutto

Il progetto ha due regole dichiarate e rispettate ovunque, e nessuna fase qui le
rompe:

1. **Niente chrome dentro il campo.** Nessuna linea, bordo, griglia o cella: solo
   colore contro nero. Tutto il resto vive nelle due barre.
2. **Nulla nell'interfaccia si muove.** Le larghezze sono bloccate per misura
   (`lockWidths`), i controlli di una modalità sono nascosti con `visibility` e
   non con `hidden`, perché il campo è un canvas e un footer che cambia altezza
   fa saltare la figura.

Da cui la regola nuova, che è la ragione per cui il menù funziona:

3. **Entrando in una modalità il footer si ricompone**, e mostra solo i controlli
   di quella modalità. Un menù che si limita ad aggiungersi ai 12 controlli
   attuali peggiora la UI invece di migliorarla.

---

## Architettura

Due moduli nuovi, per non far diventare `main.js` un file da 3.000 righe:

| file | responsabilità |
|---|---|
| `app/js/stats.js` | misure derivate: chroma e lightness per opera, aggregati per artista/scuola/museo, percentile rispetto ai contemporanei. Puro e cacheato. |
| `app/js/views.js` | il sistema di modalità: quali controlli sono visibili, e i pannelli nuovi (classifiche, confronto, racconto). |

`main.js` resta la shell e delega. `field.js` non cambia struttura: espone solo
ciò che serve agli aggregati.

---

## Fasi

### Fase 1 — fondamenta e vittorie immediate ✅
*Migliorano l'interfaccia di oggi senza introdurre modalità.*
*Fatta il 2026-08-07. 84 test verdi (24 JS, 60 Python).*

- [x] **1.1** Riga di stato in linguaggio naturale, con segmenti rimovibili
      singolarmente. Sostituisce RESET come modo di capire e disfare lo stato.
- [x] **1.2** `⧉ copia questa vista` accanto alla riga di stato: i permalink
      esistono già ed è l'unica cosa che li rende reali.
- [x] **1.3** Il chip di hover suggerisce i colori simili — la funzione migliore
      del pezzo oggi è a due click di profondità.
- [x] **1.4** Righe della lista risultati raggiungibili da tastiera.
- [x] **1.5** Dire che oltre 200 corrispondenze non si elencano (oggi tace).
- [x] **1.6** Dire che ricerca testuale e ricerca per colore si escludono.
- [x] **1.7** `stage__hint` diventa transitoria; la lettura degli assi resta.
- [x] **1.8** Togliere i 97 bin morti dal payload: mai letti dal frontend,
      55 KB, 4,3% del JSON. Richiede stadio 4 + ricostruzione.

### Fase 2 — `stats.js` e CLASSIFICHE ✅
*Fatta il 2026-08-07. 101 test verdi (41 JS, 60 Python).*
- [x] **2.1** Modulo `stats.js` con gli aggregati e i percentili.
- [x] **2.2** Vista classifiche: artisti, scuole, musei; per chroma e per
      lightness; soglia minima di opere perché una classifica su 2 opere non è
      una classifica.
- [x] **2.3** Ogni riga riporta al CAMPO filtrato: le classifiche sono la porta
      d'ingresso che oggi manca, non un vicolo cieco.

### Fase 3 — SCHEDA arricchita ✅
*Fatta il 2026-08-08. 102 test verdi (42 JS, 60 Python).*
- [x] **3.1** Posizione dell'opera rispetto ai suoi contemporanei (percentile di
      chroma e di lightness nel suo trentennio).
- [x] **3.2** Altre opere dello stesso artista — possibile solo dopo la
      canonicalizzazione dei nomi; riguarda l'83% delle opere.
- [x] **3.3** I colori simili resi visibili invece che nascosti dietro un bottone.

### Fase 4 — RACCONTO ✅ *(era la 5: scambiata con il menù, vedi nota)*
*Fatta il 2026-08-08. 108 test verdi (48 JS, 60 Python).*
- [x] **4.1** Sei passi che impostano lo stato del campo e dicono una frase.
- [x] **4.2** Smontare il pannello *about* da 903 parole: il *perché* va nel
      racconto, il *metodo* resta come scheda tecnica, i crediti restano.

> **Perché lo scambio.** Il piano metteva il menù qui, ma l'analisi da cui
> deriva contiene l'avvertimento opposto: «va fatto *quando* ci sono almeno 3
> modalità vere, non prima», altrimenti si ottiene «un selettore con due voci e
> una UI più complessa di adesso». Arrivati qui le modalità sono due — campo e
> tabelle. Il racconto è la terza, quindi viene prima e il menù nasce già pieno.

### Fase 5 — menù di modalità e ricomposizione del footer ✅ *(era la 4)*
*Fatta il 2026-08-08. 109 test verdi (49 JS, 60 Python).*
- [x] **5.1** Il selettore in alto al centro.
- [x] **5.2** Il footer si ricompone per modalità.
- [x] **5.3** La modalità entra nella URL come le altre variabili di stato.

### Fase 6 — CONFRONTO
- [ ] **6.1** Due campi affiancati, non sovrapposti — la forma sovrapposta è già
      stata provata e ritirata perché leggeva come un filtro o l'altro.
- [ ] **6.2** Scala condivisa: `CHROMA_AXIS` è già fisso, quindi i due lati sono
      già confrontabili.

---

## Verifica

Ogni fase chiude con:
- `node --test tests/field.test.mjs` e `python -m unittest discover -s tests`
- lo smoke test che avvia `main.js` contro uno stub DOM e guida i controlli
- test nuovi per il codice nuovo (`stats.js` ha aritmetica: va testata)

**Limite noto e dichiarato**: in questa sessione non è disponibile un browser, e
lo stub DOM non disegna. Tutto ciò che riguarda la *resa* — layout, spaziature,
il fatto che il footer non salti davvero — va guardato a schermo prima del
merge. È l'unica parte di questo piano che non posso verificare io.
