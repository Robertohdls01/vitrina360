// Siempre Conmigo · lo mínimo para que el celular instale la mascota como app (ícono propio).
// No guarda nada en caché: siempre se carga actualizada.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Siempre Conmigo</title><body style="font:17px system-ui;padding:48px 20px;text-align:center;background:#eef3ec;color:#2e3a30"><h2>Sin conexión</h2><p>Revisá internet y volvé a abrir a tu mascota.</p></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
