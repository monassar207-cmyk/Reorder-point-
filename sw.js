// ════════════════════════════════════════════════════
//  Service Worker — Reorder Point PWA v2
//  مع دعم الاستهلاك الشهري
// ════════════════════════════════════════════════════

const CACHE_NAME    = 'reorder-v4-monthly-consumption';
const CACHE_TIMEOUT = 5000; // ms

// Only cache same-origin / known CDN assets
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/app.js',
    '/manifest.json',
    'https://unpkg.com/dexie@3.2.4/dist/dexie.min.js',
    'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;700;800;900&family=IBM+Plex+Mono:wght@400;600&display=swap'
];

// ── INSTALL ───────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                // Cache individually so one failure doesn't block all
                return Promise.allSettled(
                    STATIC_ASSETS.map(url =>
                        cache.add(url).catch(err =>
                            console.warn('[SW] Failed to cache:', url, err)
                        )
                    )
                );
            })
            .then(() => self.skipWaiting())
    );
});

// ── ACTIVATE ──────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== CACHE_NAME)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

// ── FETCH ─────────────────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;

    // Skip non-GET, chrome-extension, and non-http(s)
    if (request.method !== 'GET') return;
    if (!request.url.startsWith('http')) return;

    // Strategy: Cache-first for static assets, Network-first for navigation
    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
    } else {
        event.respondWith(cacheFirst(request));
    }
});

async function cacheFirst(request) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return fetchAndCache(request);
}

async function networkFirst(request) {
    try {
        const response = await fetchWithTimeout(request, CACHE_TIMEOUT);
        if (response && response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return caches.match('/index.html');
    }
}

async function fetchAndCache(request) {
    try {
        const response = await fetchWithTimeout(request, CACHE_TIMEOUT);
        // Only cache valid same-origin or CORS responses
        if (response && response.status === 200 &&
            (response.type === 'basic' || response.type === 'cors')) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        return response;
    } catch {
        return new Response('offline', { status: 503, statusText: 'Offline' });
    }
}

function fetchWithTimeout(request, timeout) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), timeout);
        fetch(request).then(
            res  => { clearTimeout(timer); resolve(res); },
            err  => { clearTimeout(timer); reject(err); }
        );
    });
}
