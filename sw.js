// Vitrina 360 · lo mínimo para que el celular la instale como app (ícono propio en la pantalla).
// No guarda nada en caché: la tienda siempre se carga actualizada desde internet.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vitrina 360</title><body style="font:16px system-ui;padding:40px 20px;text-align:center;background:#6d28d9;color:#fff"><h2>Sin conexión</h2><p>Revisá internet y volvé a abrir Vitrina 360.</p></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
