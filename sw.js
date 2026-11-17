// Hora Salida: guarda la app en el teléfono para que abra sin internet.
// La página se busca primero en la red (toma las actualizaciones); sin conexión sale de la copia guardada.
// La planilla y el script de Google no pasan por acá (la app guarda su propia copia de las localidades).
const CACHE = 'hora-salida-v19';
const PROPIOS = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'viaticos.js', 'lib/pdf-lib.min.js', 'lib/pdf.min.js', 'lib/pdf.worker.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(PROPIOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req,{cache:'no-cache'}).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); return r; })
    .catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
