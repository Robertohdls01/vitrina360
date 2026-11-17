// Vitrina 360 · lo mínimo para que el celular la instale como app (ícono propio en la pantalla).
// No guarda nada en caché: la tienda siempre se carga actualizada desde internet.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShopFlash</title><body style="font:16px system-ui;padding:40px 20px;text-align:center;background:#6d28d9;color:#fff"><h2>Sin conexión</h2><p>Revisá internet y volvé a abrir ShopFlash.</p></body>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});

// Avisos de los boliches (ShopEventos): llega un "toque" vacío; buscamos el aviso nuevo y lo mostramos con el nombre del boliche.
self.addEventListener('push', e => e.waitUntil((async () => {
  let mejor = null;
  try {
    const c = await caches.open('v360-push'), ks = await c.keys();
    const visto = await c.match('/_push_visto').then(r => r ? r.json() : []).catch(() => []);
    for (const k of ks) {
      if (!k.url.includes('/_push/')) continue;
      const info = await (await c.match(k)).json();
      const j = await (await fetch('/api/fiesta?accion=novedades&f=' + encodeURIComponent(info.code), { cache: 'no-store' })).json();
      for (const x of (j.items || [])) if (!visto.includes(x.id) && (!mejor || Date.parse(x.t) > Date.parse(mejor.t))) mejor = Object.assign({ code: info.code, nombre: info.nombre }, x);
    }
    if (mejor) await c.put('/_push_visto', new Response(JSON.stringify(visto.concat([mejor.id]).slice(-200))));
  } catch (err) {}
  if (!mejor) return self.registration.showNotification('Novedades', { body: 'Tocá para ver lo que viene.', icon: '/icons/fiesta-192.png' });
  return self.registration.showNotification((mejor.autor === 'barra' ? '🍹 ' : '') + (mejor.nombre ? mejor.nombre + ': ' : '') + mejor.titulo, { body: mejor.texto || '', icon: '/icons/fiesta-192.png', badge: '/icons/fiesta-192.png', tag: 'nov-' + mejor.id, data: { url: '/fiesta/' + mejor.code + '?app=1' } });
})()));
self.addEventListener('notificationclick', e => { e.notification.close(); const u = (e.notification.data && e.notification.data.url) || '/'; e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(L => { for (const w of L) if (w.url.includes(u.split('?')[0]) && 'focus' in w) return w.focus(); return clients.openWindow(u); })); });
