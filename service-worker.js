// Nome fisso: non serve più incrementarlo a ogni modifica di index.html.
// La pagina dell'app usa la strategia "rete prima" (vedi sotto), quindi il
// contenuto si aggiorna da solo appena c'è connessione, senza bisogno di
// invalidare manualmente la cache.
const CACHE_NAME = "compositore-portafoglio-shell-v5";
// Cache separata per i caratteri (Google Fonts): restano anche quando cambia la versione sopra.
const FONT_CACHE = "compositore-portafoglio-caratteri";

// Risorse statiche che cambiano raramente: icone, manifest, librerie esterne
// (le librerie sono già "versionate" nell'URL, es. .../react/18.2.0/...,
// quindi se un domani aggiorni la versione della libreria, cambia l'URL e
// verrà scaricata automaticamente la nuova senza toccare questo file).
const STATIC_ASSETS = [
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./apple-touch-icon-167.png",
  "./apple-touch-icon-152.png",
  "./apple-touch-icon-120.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
  "./favicon-32.png",
  "./favicon-16.png",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  // Babel non serve più all'avvio: l'app arriva già compilata (index.html più veloce da aprire).
  // Librerie per l'esportazione PDF (html2canvas + jsPDF): in cache così il PDF si crea anche offline.
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
];

// Risolviamo gli URL relativi in URL assoluti (rispetto alla posizione di questo file),
// per poterli confrontare byte-per-byte con request.url nel fetch handler qui sotto.
const STATIC_ASSET_URLS = new Set(STATIC_ASSETS.map((u) => new URL(u, self.location).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        STATIC_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            // Se una risorsa esterna non è raggiungibile in fase di installazione
            // (es. offline al primo avvio), non blocchiamo l'installazione:
            // verrà messa in cache al primo fetch andato a buon fine.
          })
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== FONT_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  // La pagina dell'app (navigazione, index.html, "/") vuole sempre la
  // versione più fresca possibile: rete prima, cache solo come paracadute
  // se sei offline. Così ogni modifica a index.html è visibile al volo,
  // senza dover invalidare nulla a mano.
  const isAppShell =
    req.mode === "navigate" ||
    req.url.endsWith("/index.html") ||
    req.url.endsWith("/");

  // Rete prima, ma senza attese infinite: se la rete non risponde entro 3 secondi (segnale debole)
  // si apre subito la copia salvata; la versione nuova viene comunque salvata appena arriva e
  // sarà quella della prossima apertura.
  if (isAppShell) {
    event.respondWith(
      new Promise((resolve) => {
        let risolto = false;
        const rispondi = (r) => { if (!risolto && r) { risolto = true; resolve(r); } };
        const dallaRete = fetch(req)
          .then((response) => {
            if (response && response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            return response;
          });
        dallaRete.then(rispondi).catch(() => caches.match(req).then((c) => rispondi(c || Response.error())));
        setTimeout(() => {
          caches.match(req).then((c) => { if (c) rispondi(c); });
        }, 3000);
      })
    );
    return;
  }

  // Caratteri (Google Fonts): dalla cache se già scaricati, altrimenti dalla rete (poi salvati).
  if (req.url.startsWith("https://fonts.googleapis.com/") || req.url.startsWith("https://fonts.gstatic.com/")) {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(req).then((cached) => cached || fetch(req).then((response) => {
          if (response && (response.ok || response.type === "opaque")) cache.put(req, response.clone());
          return response;
        }))
      )
    );
    return;
  }

  // Solo gli asset statici elencati sopra (icone, manifest, librerie CDN) passano dalla
  // cache: risposta immediata, con aggiornamento in background per la prossima volta
  // (stale-while-revalidate).
  if (STATIC_ASSET_URLS.has(req.url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
            }
            return response;
          })
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
    return;
  }

  // IMPORTANTE: qualunque altra richiesta GET (in particolare le chiamate all'Apps
  // Script per leggere le appendici dal foglio Google, ma anche qualunque futura
  // chiamata API) NON deve mai passare dalla cache: sono dati dinamici, non asset
  // statici. Non chiamando event.respondWith(), il browser la gestisce in modo
  // normale, sempre in rete, esattamente come se il service worker non esistesse.
});
