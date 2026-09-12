// Nome fisso: non serve più incrementarlo a ogni modifica di index.html.
// La pagina dell'app usa la strategia "rete prima" (vedi sotto), quindi il
// contenuto si aggiorna da solo appena c'è connessione, senza bisogno di
// invalidare manualmente la cache.
const CACHE_NAME = "compositore-portafoglio-shell-v2";

// Risorse statiche che cambiano raramente: icone, manifest, librerie esterne
// (le librerie sono già "versionate" nell'URL, es. .../react/18.2.0/...,
// quindi se un domani aggiorni la versione della libreria, cambia l'URL e
// verrà scaricata automaticamente la nuova senza toccare questo file).
const STATIC_ASSETS = [
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js",
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
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
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

  if (isAppShell) {
    event.respondWith(
      fetch(req)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return response;
        })
        .catch(() => caches.match(req))
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
