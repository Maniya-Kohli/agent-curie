const CACHE_NAME = "curie-v1";
const ASSETS = ["/", "/index.html", "/manifest.json"];

// Install: cache shell assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API or WebSocket requests
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
    return;
  }

  event.respondWith(
    caches
      .match(event.request)
      .then((cached) => {
        return (
          cached ||
          fetch(event.request).then((response) => {
            // Cache successful responses
            if (response.ok) {
              const clone = response.clone();
              caches
                .open(CACHE_NAME)
                .then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
        );
      })
      .catch(() => {
        // Offline fallback
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
      }),
  );
});
