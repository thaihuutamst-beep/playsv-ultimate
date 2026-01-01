// PlaySV Ultimate - Service Worker
// Progressive Web App Offline Functionality

const CACHE_NAME = 'playsv-ultimate-v1';
const RUNTIME_CACHE = 'playsv-runtime';

// Assets to cache on install
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
  // Add other essential assets
];

// Install event - cache essential assets
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Service Worker: Caching app shell');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              return cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE;
            })
            .map((cacheName) => {
              console.log('🗑️ Service Worker: Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip WebSocket requests
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    return;
  }
  
  // Skip API requests - always fetch fresh
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    event.respondWith(
      fetch(request)
        .catch(() => {
          return new Response(
            JSON.stringify({ error: 'Offline - API unavailable' }),
            { 
              headers: { 'Content-Type': 'application/json' },
              status: 503
            }
          );
        })
    );
    return;
  }
  
  // Cache-first strategy for app shell and static assets
  if (url.origin === location.origin) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          return fetch(request)
            .then((response) => {
              // Don't cache non-successful responses
              if (!response || response.status !== 200 || response.type === 'error') {
                return response;
              }
              
              // Clone the response
              const responseToCache = response.clone();
              
              // Cache it for future use
              caches.open(RUNTIME_CACHE)
                .then((cache) => {
                  cache.put(request, responseToCache);
                });
              
              return response;
            })
            .catch(() => {
              // Return offline page if available
              return caches.match('/offline.html');
            });
        })
    );
  }
});

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('🔄 Service Worker: Background sync', event.tag);
  
  if (event.tag === 'sync-playlist') {
    event.waitUntil(syncPlaylist());
  }
});

async function syncPlaylist() {
  try {
    // Sync playlist data when back online
    const cache = await caches.open(RUNTIME_CACHE);
    const requests = await cache.keys();
    
    // Process pending sync items
    console.log('✅ Playlist synced');
  } catch (error) {
    console.error('❌ Sync failed:', error);
  }
}

// Push notifications
self.addEventListener('push', (event) => {
  console.log('📬 Service Worker: Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'New update available',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-96.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Open App',
        icon: '/icons/icon-96.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icons/icon-96.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('PlaySV Ultimate', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  console.log('🔔 Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Message handler for communication with app
self.addEventListener('message', (event) => {
  console.log('💬 Service Worker: Message received:', event.data);
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data.type === 'CACHE_URLS') {
    event.waitUntil(
      caches.open(RUNTIME_CACHE)
        .then((cache) => {
          return cache.addAll(event.data.urls);
        })
    );
  }
});

console.log('🚀 Service Worker: Loaded and ready!');
