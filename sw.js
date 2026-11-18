// Harmony Horticulture Time Tracker: lets phones install the app and open it quickly.
// Always tries the network first, so a new version shows up as soon as it's on GitHub.
// Falls back to the saved copy when there's no signal. Database calls are never saved here.
const CACHE = "hh-time-v1";
const SHELL = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/config.js", "js/demo-data.js", "js/importers.js", "js/store.js", "js/exports.js", "js/app.js",
  "vendor/supabase.min.js", "vendor/exceljs.min.js",
  "assets/logo.png", "assets/logo-reversed.png", "assets/mark-reversed.png",
  "assets/icon-192.png", "assets/icon-512.png", "favicon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only this site's own files. Supabase, fonts and everything else go straight to the network.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined)))
  );
});
