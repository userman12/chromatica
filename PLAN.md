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

### Fase 6 — CONFRONTO ✅
*Fatta il 2026-08-08. 110 test verdi (50 JS, 60 Python).*
- [x] **6.1** Due campi affiancati, non sovrapposti — la forma sovrapposta è già
      stata provata e ritirata perché leggeva come un filtro o l'altro.
- [x] **6.2** Scala condivisa: `CHROMA_AXIS` è già fisso, quindi i due lati sono
      già confrontabili.

### Fase 7 — manutenzione: la card non può più mentire ✅
*Fatta il 2026-08-08. 112 test verdi (50 JS, 62 Python).*
*Chiude i punti 3.6 e 3.7 di `~/Desktop/chromatica-analisi-ui-ux.md`.*

- [x] **7.1** Impronta nel PNG. `app/og.png` scrive in un chunk `tEXt` i tre
      numeri del dataset da cui è stato generato, e il test li confronta con
      `meta`. Serviva perché la card **stampa dei conteggi nella propria
      didascalia** ed era generata da un dataset che cambia: ricostruire la
      collezione e dimenticare lo stadio 6 lasciava una card vecchia con una
      didascalia falsa, e il deploy passava verde — un PNG stantio è un PNG
      validissimo. Confrontata via impronta e non via `mtime`, perché in CI un
      checkout pulito dà a tutti i file lo stesso timestamp: la guardia ovvia è
      proprio quella che non può funzionare.
      *Verificata sabotando la card con i numeri del build precedente: test
      rosso, deploy bloccato.*
- [x] **7.2** Action della CI ai major correnti. L'analisi diceva `@v4 → @v5`
      ed era già stantia: siamo a checkout/setup-node/setup-python **v7**,
      configure-pages v6, upload-pages-artifact e deploy-pages v5. GitHub le
      forzava su Node 24 dopo aver deprecato Node 20 — funziona finché non
      funziona più, e con `deploy` che dipende da `test` un workflow rotto non
      è un test saltato, è niente pubblicato.

---

## Verifica

Ogni fase chiude con:
- `node --test tests/*.mjs` — **il glob, non la directory**: `node --test tests/`
  tratta il percorso come un modulo da eseguire e fallisce
- `.venv/bin/python -m unittest discover -s tests`
- test nuovi per il codice nuovo — `stats.js` ha aritmetica, `story.js` ha
  affermazioni numeriche, ed entrambe vanno verificate contro il dataset

**Limite noto e dichiarato**: in questa sessione non è disponibile un browser, e
lo stub DOM non disegna. Tutto ciò che riguarda la *resa* — layout, spaziature,
il fatto che il footer non salti davvero — va guardato a schermo prima del
merge. È l'unica parte di questo piano che non posso verificare io.

*Aggiornamento del 2026-08-09*: il limite era reale e ha morso subito — vedi
fase 8. Il difetto però non era di resa ma di **consegna degli eventi**, che lo
stub avrebbe potuto coprire e copriva male. Ora lo copre. Quello che resta
davvero fuori portata è solo il pixel: dove cade una cosa, quanto è larga, se
salta.

---

## Fase 8 — il primo bug trovato usando la cosa ✅
*2026-08-09. 113 test verdi (51 JS, 62 Python).*

Segnalato dall'uso reale: **il racconto si apriva e NEXT non rispondeva.** Non
era la logica dei passi, era un conflitto di eventi — ed è esattamente la classe
di difetto che il limite dichiarato in fondo a questo file prometteva di non
poter vedere.

**Cos'era.** Il pannello STORY sta dentro `<main class="stage">`, di proposito:
è ancorato sopra il campo e il campo si ricompone sotto ogni frase. Ma lo stage
possiede i gestori del puntatore, e il suo `pointerdown` chiama
`setPointerCapture`. Premendo NEXT il `pointerdown` risaliva al bottone e poi
allo stage, lo stage sequestrava il puntatore, il `pointerup` finiva sullo stage
invece che sul bottone, **nessun `click` veniva mai consegnato** — e per giunta
il tocco veniva letto come un tocco sul campo sottostante. Stesso destino per
BACK, per i pallini e per la ×.

**La correzione**, una riga: una gesture appartiene al campo solo se *inizia*
sul campo. Il test è `event.target !== el.field` invece di una lista di overlay
da escludere, perché la riga degli assi, l'hint e il chip sono tutti
`pointer-events: none` — il canvas è l'unica cosa dentro lo stage che possa
essere un target, a meno che qualcosa non ci sia stato messo sopra apposta, e
ciò che è messo sopra deve tenersi i propri click. Vale quindi anche per gli
overlay futuri.

**Perché il test non l'aveva preso, e cosa ho cambiato.** Il primo test di
regressione che ho scritto restava verde anche rimettendo il bug: lo stub
trattava `setPointerCapture` come no-op e consegnava il `click` dritto al
bottone, cioè l'unico percorso che un browser non fa mai. Ora lo stub registra
la cattura e l'helper `press()` compie la sequenza reale — `pointerdown` che
risale allo stage portando l'elemento premuto come target, `pointerup`, e il
`click` **solo se nessun antenato ha rubato il puntatore**. Verificato
rimettendo il bug: test rosso.

> **Cosa insegna, per le prossime volte.** Lo stub DOM copre la logica e non la
> resa, e questo era già scritto. Ma copriva male anche una cosa che *non* è
> resa: la consegna degli eventi. Ogni volta che si mette un controllo dentro
> `#stage` va premuto con `press()` in un test, non con `click()`.

### Fase 9 — il readout e il primo impatto ✅
*2026-08-09. 116 test verdi (54 JS, 62 Python).*
*Chiude i punti §1.1 e §2.4 dell'analisi.*

- [x] **9.1** **Il readout non mostra più una costante né una cosa due volte.**
      L'analisi (§1.1) proponeva di nascondere SPAN e WINDOW fuori dal
      timelapse, e **su SPAN aveva torto**: verificato interrogando il campo,
      SPAN segue il filtro scuola — olandesi 1562–1907, italiani 1309–1905 — ed
      è un fatto sulla collezione che vale la pena avere.
      Il vero difetto era un altro, e l'ha rivelato la verifica: **dentro** il
      timelapse SPAN e il chip della riga di stato stampano la *stessa identica
      stringa*. Quindi ora WINDOW vive solo nel timelapse (fuori la sua unica
      risposta è la parola ALL, per tutta la sessione) e SPAN solo fuori.
      Sempre tre letture vive su quattro celle, e la cella spenta resta al suo
      posto con `visibility` — il readout è allineato a destra e togliere una
      colonna dal flusso farebbe scivolare le icone dei crediti a ogni pressione.
- [x] **9.2** **Gerarchia**: WORKS più grande degli altri tre. Erano composti
      identici, il che diceva che fossero quattro fatti di pari peso; ma COLOURS
      è sempre circa 4,5× WORKS, e SPAN e WINDOW *qualificano* un numero invece
      di esserlo. Più grande, non più acceso: l'accento appartiene al campo.
- [x] **9.3** **Il campo si presenta da solo, una volta** (§2.4). Si atterrava
      su 34.062 punti senza sapere cosa fossero: la riga sotto il campo lo
      *dice*, ma è una frase su un'immagine invece dell'immagine. Ora dopo un
      attimo un anello si chiude su una particella e appare il suo chip, non
      richiesto, con un dipinto riconoscibile e l'esadecimale del colore preso
      da lì. Tre secondi, poi lascia.
      Insegna tutta la grammatica del pezzo — un punto è un colore, il colore
      appartiene a un'opera, l'opera ha un nome — senza una parola di
      istruzioni, ed è **lo stesso chip** che si otterrebbe puntando: non è una
      finta.
      La particella è scelta **per regola e non per indice**, come i permalink
      nominano le opere invece di numerarle; e non parte affatto se
      `prefers-reduced-motion`, se un link ha portato altrove, o alla prima
      interazione *qualsiasi* — ascoltata una volta sola sulla finestra in fase
      di cattura, perché agganciarla ai singoli controlli è una lista a cui
      prima o poi manca una voce, e già ne mancavano tre.

> Entrambe le guardie nuove sono state verificate **facendole fallire**: SPAN
> forzato a costante e apertura disattivata. Un test verde non dimostra niente
> finché non lo si è visto rosso per la ragione giusta.

### Fase 10 — il footer dice di che tipo è ogni controllo ✅
*2026-08-09. 116 test verdi (54 JS, 62 Python). Chiude §1.3, l'ultimo punto
aperto dell'analisi.*

- [x] **10.1** **Lo stesso difetto della fase 9, una riga più sotto.** Il blocco
      a sinistra del footer diceva `SHOWING ALL YEARS` fuori dal timelapse — una
      costante, nel corpo più grande del footer — e dentro aggiungeva un
      `WINDOW 1627–1673` che stampa la **stessa identica stringa** del chip
      della riga di stato. Resta la sola cosa viva: l'anno sotto lo scrubber,
      che il corpo grande se lo merita perché cambia sessanta volte al secondo
      mentre trascini. Fuori dal timelapse il blocco è vacante.
- [x] **10.2** **Due gruppi, non una fila.** FIND e SCHOOL *restringono la
      collezione*; CHROMATIC PLANE e TIMELAPSE *rileggono le stesse misure*.
      Stavano in una fila indifferenziata, quindi l'unico modo di sapere che
      tipo fosse un controllo era premerlo. Ora sono separati da un filetto di
      1px nel colore di linea del pannello — non un riquadro, perché il footer
      è già una barra bordata e una scatola dentro una scatola è una cornice di
      troppo.

**Il footer è passato da 12 controlli a 6**, in due gruppi nominati: tre sono
saliti nel menù delle letture (fase 5), RESET è diventato la riga di stato
(fase 1), e due erano letture morte rimosse qui.

> **Nota sullo stub**, terza infedeltà trovata e corretta: `textContent`
> accettava un Number e lo teneva tale, mentre il DOM lo converte in stringa.
> Codice perfettamente corretto in un browser consegnava al test un tipo
> sbagliato. Dopo `hidden` e la cattura del puntatore, la regola è chiara: ogni
> volta che un test si comporta in modo strano prima di sospettare l'app va
> chiesto se lo stub sta mentendo.

---

## Come provarlo in locale

```bash
cd ~/Projects/chromatica
python3 -m http.server 8765 --directory app
# poi apri http://localhost:8765
```

Un server serve davvero: `app/js/main.js` è un modulo ES e fa `fetch` del
dataset, e aprire `index.html` con un doppio click lo blocca su entrambe le
cose per via di `file://`.

**Cosa guardare per primo**, in ordine di rischio — sono le cose che nessun test
di questa sessione ha potuto vedere:

| | |
|---|---|
| **Il menù in alto** | Quattro voci centrate. Passando da una all'altra il footer deve cambiare *senza che il campo salti*: se la nuvola si sposta di qualche pixel, un controllo sta uscendo dal flusso invece che diventare `visibility: hidden`. |
| **La riga di stato** | Restringi a una scuola, cerca qualcosa, apri il timelapse: devono comparire dei chip, e ognuno deve togliere **solo** il proprio vincolo. Con niente ristretto la riga dice invece la dimensione della collezione. |
| **A 360px di larghezza** | Il punto più fragile. Il menù passa a riga propria, la lista risultati si aggancia al viewport, i pannelli diventano a colonna singola. Da provare con gli strumenti di sviluppo o su un telefono vero. |
| **STORY** | Sette passi; il campo deve ricomporsi sotto ogni frase. L'ultimo passo lascia il campo così com'è invece di richiudersi su sé stesso. |
| **COMPARE** | Apre su olandesi/italiani. La tacca su ogni barra è la posizione dell'altra scuola. |

Per rigenerare il dataset o la card serve il venv:

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
.venv/bin/python pipeline/04_build.py      # -> app/data/chromatica.json
.venv/bin/python pipeline/06_og_image.py   # -> app/og.png   (sempre dopo il 04)
```

Lo stadio 06 va **sempre** rilanciato dopo il 04, ed è esattamente ciò che la
fase 7.1 rende impossibile dimenticare in silenzio.
