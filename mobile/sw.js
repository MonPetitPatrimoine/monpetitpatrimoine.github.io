"use strict";
/* Mon Petit Patrimoine — © 2026. Tous droits réservés.
   mobile/sw.js : service worker de l'application mobile. Met en cache l'application elle-même (pour l'ouvrir hors ligne) ;
   jamais les chiffres : ils restent chiffrés dans le stockage local du téléphone (app.js). Changer VERSION à chaque modification. */
const VERSION = "mpp-mobile-4";
const FICHIERS = ["./", "index.html", "app.js?v=4", "app.css?v=4", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("mpp-mobile-") && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith("/mobile/")) return;   // le service de synchronisation n'est jamais mis en cache
  // réseau d'abord (dernière version de l'application), cache si hors ligne
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(   // toujours revalidé : jamais une ancienne version tant que le réseau répond
r => { if (r.ok) { const copie = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copie)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
