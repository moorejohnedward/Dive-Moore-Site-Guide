/* Service worker: lets the app open with no signal at the dive site.
   App files are served from the cache and refreshed in the background.
   Live conditions (Open-Meteo, NOAA, NWS) always go to the network; the app
   itself keeps the last good download on the device. */
const VERSION = "dm-v3";
const SHELL = [
  "./", "index.html", "css/app.css", "js/app.js", "js/install.js", "data/sites.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
];
const LIVE_HOSTS = ["marine-api.open-meteo.com", "api.open-meteo.com", "api.tidesandcurrents.noaa.gov", "api.weather.gov"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (LIVE_HOSTS.includes(url.hostname)) return; // straight to the network

  // App files and fonts: answer from the cache, then refresh it
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, {ignoreSearch: url.origin === location.origin});
    const net = fetch(req).then(res => {
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
