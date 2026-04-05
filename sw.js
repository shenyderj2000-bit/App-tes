/* ============================================================
   SERVICE WORKER — Championnat Live PWA
   Stratégie : Cache First pour les assets, Network First pour les données
============================================================ */

const CACHE_NAME = 'championnat-live-v1';
const STATIC_CACHE = 'championnat-static-v1';
const DYNAMIC_CACHE = 'championnat-dynamic-v1';

/* Fichiers à mettre en cache immédiatement à l'installation */
const STATIC_ASSETS = [
  './championnat_live.html',
  './manifest.json',
];

/* URLs externes à mettre en cache (Google Fonts) */
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800;900&family=Barlow:wght@400;500;600;700&display=swap',
];

/* ============================================================
   INSTALL — Pré-cache des assets statiques
============================================================ */
self.addEventListener('install', event => {
  console.log('[SW] Installation en cours...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => {
      console.log('[SW] Mise en cache des assets statiques');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      // Prendre le contrôle immédiatement sans attendre reload
      return self.skipWaiting();
    }).catch(err => {
      console.warn('[SW] Erreur lors du cache statique :', err);
    })
  );
});

/* ============================================================
   ACTIVATE — Nettoyage des anciens caches
============================================================ */
self.addEventListener('activate', event => {
  console.log('[SW] Activation en cours...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== DYNAMIC_CACHE)
          .map(key => {
            console.log('[SW] Suppression ancien cache :', key);
            return caches.delete(key);
          })
      );
    }).then(() => {
      console.log('[SW] Prêt — contrôle de tous les clients');
      return self.clients.claim();
    })
  );
});

/* ============================================================
   FETCH — Stratégie de récupération
============================================================ */
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorer les requêtes non-GET
  if (request.method !== 'GET') return;

  // Ignorer les extensions Chrome et protocoles non-http
  if (!url.protocol.startsWith('http')) return;

  // === Stratégie pour les fichiers locaux : Cache First ===
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // === Stratégie pour Google Fonts : Stale While Revalidate ===
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // === Autres requêtes externes : Network First avec fallback cache ===
  event.respondWith(networkFirst(request));
});

/* ============================================================
   STRATÉGIES DE CACHE
============================================================ */

/**
 * Cache First — Priorité au cache, réseau en fallback
 * Idéal pour : HTML, CSS, JS locaux (changent peu)
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    console.warn('[SW] Ressource non disponible hors-ligne :', request.url);
    return offlineFallback(request);
  }
}

/**
 * Network First — Priorité réseau, cache en fallback
 * Idéal pour : données qui peuvent changer
 */
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return offlineFallback(request);
  }
}

/**
 * Stale While Revalidate — Retourne le cache immédiatement,
 * met à jour en arrière-plan
 * Idéal pour : Google Fonts, polices externes
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  return cached || await networkFetch;
}

/**
 * Fallback hors-ligne — Retourne une page offline basique
 */
function offlineFallback(request) {
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('text/html')) {
    return new Response(offlinePage(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
  return new Response('', { status: 408, statusText: 'Hors ligne' });
}

function offlinePage() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Hors ligne — Championnat Live</title>
  <style>
    body{margin:0;background:#0e1118;color:#e8ecf4;font-family:sans-serif;
      display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;}
    .box{padding:40px 24px;}
    .icon{font-size:64px;margin-bottom:16px;}
    h1{font-size:22px;margin-bottom:8px;color:#f5c518;}
    p{font-size:14px;color:#6b7694;margin-bottom:24px;}
    button{background:#f5c518;color:#000;border:none;padding:12px 24px;
      border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;}
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">📶</div>
    <h1>Vous êtes hors ligne</h1>
    <p>Reconnectez-vous pour accéder à l'application.<br>Vos données locales sont intactes.</p>
    <button onclick="location.reload()">↺ Réessayer</button>
  </div>
</body>
</html>`;
}

/* ============================================================
   MESSAGE — Contrôle depuis l'app principale
============================================================ */
self.addEventListener('message', event => {
  // Forcer la mise à jour du cache
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Vider le cache (utile pour les mises à jour de l'app)
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => console.log('[SW] Cache vidé'));
  }
});
    
