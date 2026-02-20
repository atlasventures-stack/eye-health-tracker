// Eye Health Tracker - Service Worker
const CACHE_NAME = 'eye-health-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-72.png',
    '/icons/icon-96.png',
    '/icons/icon-128.png',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

// Install event - cache assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Caching assets');
                return cache.addAll(ASSETS);
            })
            .catch(err => console.log('Cache error:', err))
    );
    self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch event - serve from cache, fall back to network
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
    );
});

// Push notification event
self.addEventListener('push', event => {
    const options = {
        body: event.data ? event.data.text() : 'Time for an eye break!',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        vibrate: [200, 100, 200],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            { action: 'done', title: 'Done' },
            { action: 'snooze', title: 'Snooze 5m' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('Eye Health Tracker', options)
    );
});

// Notification click event
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'snooze') {
        // Snooze for 5 minutes
        setTimeout(() => {
            self.registration.showNotification('Eye Health Tracker', {
                body: 'Snooze ended! Time for that eye break.',
                icon: '/icons/icon-192.png'
            });
        }, 5 * 60 * 1000);
    } else {
        // Open the app
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(clientList => {
                for (const client of clientList) {
                    if (client.url.includes('eye-health') && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
        );
    }
});

// Background sync for offline support
self.addEventListener('sync', event => {
    if (event.tag === 'sync-data') {
        console.log('Background sync triggered');
    }
});

// Periodic background sync for reminders (requires permission)
self.addEventListener('periodicsync', event => {
    if (event.tag === 'eye-reminder') {
        event.waitUntil(
            self.registration.showNotification('Eye Health Reminder', {
                body: 'Time to check your eye health habits!',
                icon: '/icons/icon-192.png'
            })
        );
    }
});
