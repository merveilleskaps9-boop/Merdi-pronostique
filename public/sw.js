self.addEventListener('install', (e) => {
  console.log('[Service Worker] Installé');
});

self.addEventListener('fetch', (e) => {
  // Laisse le navigateur gérer les requêtes via internet normalement
});