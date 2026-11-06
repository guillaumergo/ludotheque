// Garde la ludothèque disponible hors ligne une fois ouverte une première fois.
const CACHE = "ludotheque-v3";
const FICHIERS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./html2canvas.min.js"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Avec internet : prend la dernière version publiée (et la garde en copie).
// Sans internet (ou réseau trop lent) : utilise la copie gardée sur l'appareil.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  // Les jeux de la collection sont déjà gardés dans la ludothèque : pas de double copie
  if (new URL(req.url).pathname.includes("/collection/")) return;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const enCache = await c.match(req, { ignoreSearch: true });
      const reseau = fetch(req, { cache: "no-cache" })
        .then((r) => { if (r.ok) c.put(req, r.clone()); return r; });
      if (!enCache) return reseau;
      const delai = new Promise((res) => setTimeout(() => res(enCache), 3000));
      return Promise.race([reseau.catch(() => enCache), delai]);
    })
  );
});
