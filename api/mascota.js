// Siempre Conmigo · pedidos (servicio: el cliente manda fotos y videos de su mascota, paga, y se le arma su casa).
// Todo se guarda en una carpeta PRIVADA de Supabase ("mascota-pedidos"): pedidos/<id>.json y fotos/<id>/...
//   POST ?accion=crear  {mascota, especie, caracter, cuenta, apodo, nombre, email, whatsapp, acepta} → {id, k}
//   POST ?accion=subir  {id, k, nombre, tipo}            → {url}  (link para subir un archivo directo a la carpeta privada)
//   POST ?accion=pagar  {id, k, archivos: [nombres]}      → {url}  (pago único con Mercado Pago)
//   GET  ?accion=estado&id&k                              → {pagado, tipo, elegida}  (tipo 'generica': elige una mascota del catálogo, sin fotos)
//   POST ?accion=aviso                                    (Mercado Pago avisa un pago)
//   GET  ?accion=admin                                    (el dueño) → lista de pedidos con links a las fotos
//   POST ?accion=marcar {id, estado, link}                (el dueño) → entregado / link de su casa
const crypto = require('crypto');
const { cuerpo, usuario, stHeaders } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ST = () => SURL() + '/storage/v1';
const B = 'mascota-pedidos';
const PRECIO = () => Number(process.env.PRECIO_MASCOTA || 15800);           // con su propia mascota
const PRECIO_GEN = () => Number(process.env.PRECIO_MASCOTA_GENERICA || 7900); // eligiendo una de las nuestras
const CATALOGO = ['curri', 'dorado', 'marron', 'negro', 'blanco', 'gris'];
const MAX_ARCHIVOS = 12;
const ADMINS = () => String(process.env.ADMIN_EMAILS || process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const limpio = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const texto = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f<>]/g, ' ').trim().slice(0, n);
const okId = s => /^[a-z0-9]{10,24}$/.test(String(s || ''));
const archivoLimpio = s => String(s || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-60) || 'archivo';

let listo = false;
async function bucket() {
  if (listo) return;
  try { await fetch(ST() + '/bucket', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: B, name: B, public: false, file_size_limit: 52428800 }) }); } catch (e) {}
  listo = true;
}
async function leer(id) {
  try { const r = await fetch(ST() + '/object/' + B + '/pedidos/' + id + '.json', { headers: stHeaders({ 'cache-control': 'no-cache' }) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function guardar(p) {
  const put = () => fetch(ST() + '/object/' + B + '/pedidos/' + p.id + '.json', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(p) });
  let r = await put(); if (!r.ok) { listo = false; await bucket(); r = await put(); }
  if (!r.ok) throw new Error('No se pudo guardar el pedido.');
}
async function firmarDescarga(path) {
  try {
    const r = await fetch(ST() + '/object/sign/' + B + '/' + path, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 }) });
    const j = await r.json().catch(() => ({}));
    return r.ok && (j.signedURL || j.signedUrl) ? ST() + (j.signedURL || j.signedUrl) : null;
  } catch (e) { return null; }
}
async function mpGet(path) {
  const tok = String(process.env.MP_ACCESS_TOKEN || '').trim(); if (!tok) return null;
  const r = await fetch('https://api.mercadopago.com' + path, { headers: { Authorization: 'Bearer ' + tok } });
  return r.ok ? r.json().catch(() => null) : null;
}
// Revisa en Mercado Pago si el pedido ya tiene un pago aprobado y lo marca.
async function revisarPago(p) {
  if (!p || p.pagado) return p;
  const j = await mpGet('/v1/payments/search?external_reference=' + encodeURIComponent('mascota/' + p.id) + '&sort=date_created&criteria=desc&limit=5');
  const ok = j && Array.isArray(j.results) && j.results.find(x => x.status === 'approved');
  if (ok) { p.pagado = true; p.pago_id = String(ok.id); p.pagado_el = new Date().toISOString(); p.monto = ok.transaction_amount; await guardar(p); }
  return p;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (String((req.query || {}).accion) === 'precios') return res.status(200).json({ propia: PRECIO(), generica: PRECIO_GEN(), catalogo: CATALOGO });
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Los pedidos todavía no están activados.' });
  const q = req.query || {}, a = String(q.accion || '');
  const host = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'vitrina360-kappa.vercel.app');
  try {
    await bucket();

    if (a === 'crear' && req.method === 'POST') {
      const b = cuerpo(req);
      const email = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(String(b.email || '').trim()) ? String(b.email).trim().toLowerCase().slice(0, 120) : '';
      const p = {
        id: Date.now().toString(36) + crypto.randomBytes(4).toString('hex'),
        k: crypto.randomBytes(12).toString('hex'),
        creado: new Date().toISOString(),
        mascota: limpio(b.mascota, 40), especie: limpio(b.especie, 20), caracter: limpio(b.caracter, 30),
        cuenta: texto(b.cuenta, 1500), apodo: limpio(b.apodo, 30),
        nombre: limpio(b.nombre, 60), email, whatsapp: limpio(b.whatsapp, 30).replace(/[^\d+ ()-]/g, ''),
        archivos: [], pagado: false, estado: 'nuevo', precio: PRECIO(), tipo: 'propia'
      };
      if (b.tipo === 'generica') { p.tipo = 'generica'; p.elegida = CATALOGO.includes(b.elegida) ? b.elegida : 'curri'; p.precio = PRECIO_GEN(); p.especie = 'perro'; p.link = host + '/mascota/jugar/?c=' + p.id + '&k=' + p.k; }
      if (b.prueba) { // compra de prueba: solo el dueño (con su sesión del panel), por $1.000
        const u = await usuario(req).catch(() => null);
        if (u && ADMINS().includes(String(u.email).toLowerCase())) { p.precio = 1000; p.prueba = true; }
      }
      if (!p.mascota || !p.nombre || !email || !p.whatsapp) return res.status(400).json({ error: 'Completá el nombre de tu mascota, tu nombre, tu mail y tu WhatsApp.' });
      if (!b.acepta && b.tipo !== 'generica') return res.status(400).json({ error: 'Tenés que aceptar que usemos las fotos para armar su casa.' });
      await guardar(p);
      return res.status(200).json({ id: p.id, k: p.k, precio: p.precio });
    }

    if (a === 'subir' && req.method === 'POST') {
      const b = cuerpo(req);
      if (!okId(b.id)) return res.status(400).json({ error: 'Pedido inválido.' });
      const p = await leer(b.id);
      if (!p || p.k !== String(b.k || '')) return res.status(404).json({ error: 'No encontramos el pedido.' });
      if ((p.subidos || 0) >= MAX_ARCHIVOS) return res.status(400).json({ error: 'Llegaste al máximo de ' + MAX_ARCHIVOS + ' archivos.' });
      if (!/^(image|video)\//.test(String(b.tipo || ''))) return res.status(400).json({ error: 'Solo fotos o videos.' });
      p.subidos = (p.subidos || 0) + 1; await guardar(p);
      const path = 'fotos/' + p.id + '/' + p.subidos + '-' + archivoLimpio(b.nombre);
      const r = await fetch(ST() + '/object/upload/sign/' + B + '/' + path, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) return res.status(502).json({ error: 'No se pudo preparar la subida. Probá de nuevo.' });
      return res.status(200).json({ url: ST() + j.url, path });
    }

    if (a === 'pagar' && req.method === 'POST') {
      const b = cuerpo(req);
      if (!okId(b.id)) return res.status(400).json({ error: 'Pedido inválido.' });
      const p = await leer(b.id);
      if (!p || p.k !== String(b.k || '')) return res.status(404).json({ error: 'No encontramos el pedido.' });
      if (Array.isArray(b.archivos)) p.archivos = b.archivos.filter(s => typeof s === 'string' && s.startsWith('fotos/' + p.id + '/')).slice(0, MAX_ARCHIVOS);
      if (p.pagado) { await guardar(p); return res.status(200).json({ pagado: true }); }
      const tok = String(process.env.MP_ACCESS_TOKEN || '').trim();
      if (!tok) { await guardar(p); return res.status(200).json({ sinPago: true }); }
      const back = host + '/mascota/?pedido=' + p.id + '&k=' + p.k;
      const r = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({
        items: [{ id: 'mascota-' + p.id, title: ('Siempre Conmigo · ' + p.mascota).slice(0, 60), quantity: 1, unit_price: p.precio, currency_id: 'ARS' }],
        payer: { email: p.email, name: p.nombre },
        external_reference: 'mascota/' + p.id,
        notification_url: host + '/api/mascota?accion=aviso',
        back_urls: { success: back + '&pago=ok', pending: back + '&pago=pendiente', failure: back + '&pago=error' },
        auto_return: 'approved',
        statement_descriptor: 'SIEMPRECONMIGO'
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.init_point) { console.error('mascota pagar', r.status, JSON.stringify(j).slice(0, 300)); await guardar(p); return res.status(502).json({ error: 'Mercado Pago no respondió. Probá de nuevo en un rato.' }); }
      p.mp_pref = j.id; await guardar(p);
      return res.status(200).json({ url: j.init_point });
    }

    if (a === 'manifest') { // para instalar SU mascota en el celular, con su nombre y su link
      const c = String(q.c || ''), k = String(q.k || '');
      const p = okId(c) ? await leer(c) : null;
      const ok = p && p.k === k;
      const nombre = ok ? (p.mascota || 'Mi mascota') : 'Siempre Conmigo';
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      return res.status(200).send(JSON.stringify({
        name: nombre + ' · Siempre Conmigo', short_name: nombre.slice(0, 12),
        description: 'Tu mascota, siempre con vos.',
        id: '/mascota/jugar/?c=' + (ok ? c : ''),
        start_url: ok ? '/mascota/jugar/?c=' + c + '&k=' + k : '/mascota/jugar/',
        scope: '/mascota/jugar/', display: 'standalone', orientation: 'any',
        background_color: '#eef3ec', theme_color: '#5f8f66', lang: 'es',
        icons: [
          { src: '/mascota/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/mascota/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/mascota/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/mascota/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }));
    }

    if (a === 'estado') {
      if (!okId(q.id)) return res.status(400).json({ error: 'Pedido inválido.' });
      let p = await leer(q.id);
      if (!p || p.k !== String(q.k || '')) return res.status(404).json({ error: 'No encontramos el pedido.' });
      p = await revisarPago(p);
      return res.status(200).json({ pagado: !!p.pagado, mascota: p.mascota, estado: p.estado, tipo: p.tipo || 'propia', elegida: p.elegida || null, apodo: p.apodo || '', caracter: p.caracter || '', link: p.pagado || p.tipo !== 'generica' ? (p.link || null) : null });
    }

    if (a === 'aviso') {
      const b = cuerpo(req);
      const tipo = b.type || b.topic || q.type || q.topic || '', pid = String((b.data && b.data.id) || q['data.id'] || q.id || '').replace(/\D/g, '');
      if (!/payment/.test(tipo) || !pid) return res.status(200).json({ ok: true });
      const pay = await mpGet('/v1/payments/' + pid);
      const ref = String(pay && pay.external_reference || '');
      if (!pay || pay.status !== 'approved' || !ref.startsWith('mascota/')) return res.status(200).json({ ok: true });
      const id = ref.slice(8); if (!okId(id)) return res.status(200).json({ ok: true });
      const p = await leer(id);
      if (p && !p.pagado) { p.pagado = true; p.pago_id = pid; p.pagado_el = new Date().toISOString(); p.monto = pay.transaction_amount; await guardar(p); }
      return res.status(200).json({ ok: true });
    }

    if (a === 'admin' || a === 'marcar') {
      const u = await usuario(req);
      if (!u) return res.status(401).json({ error: 'Entrá primero a tu panel.' });
      if (!ADMINS().includes(String(u.email).toLowerCase())) return res.status(403).json({ error: 'Esta pantalla es solo para el dueño.' });

      if (a === 'marcar' && req.method === 'POST') {
        const b = cuerpo(req);
        if (!okId(b.id)) return res.status(400).json({ error: 'Pedido inválido.' });
        const p = await leer(b.id); if (!p) return res.status(404).json({ error: 'No encontramos el pedido.' });
        if (['nuevo', 'en_proceso', 'entregado'].includes(b.estado)) p.estado = b.estado;
        if (typeof b.link === 'string') p.link = b.link.trim().slice(0, 300);
        if (b.pagado === true) { p.pagado = true; p.pagado_el = p.pagado_el || new Date().toISOString(); p.pago_manual = true; }
        await guardar(p);
        return res.status(200).json({ ok: true });
      }

      const r = await fetch(ST() + '/object/list/' + B, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: 'pedidos/', limit: 500, sortBy: { column: 'created_at', order: 'desc' } }) });
      const lista = r.ok ? await r.json() : [];
      const ids = (Array.isArray(lista) ? lista : []).map(o => String(o.name || '').replace(/\.json$/, '')).filter(okId).slice(0, 200);
      let pedidos = (await Promise.all(ids.map(leer))).filter(Boolean);
      pedidos = await Promise.all(pedidos.map(async p => {
        if (!p.pagado && p.mp_pref) { try { p = await revisarPago(p); } catch (e) {} }
        const archivos = await Promise.all((p.archivos || []).map(async path => ({ nombre: path.split('/').pop().replace(/^\d+-/, ''), url: await firmarDescarga(path) })));
        const { k, ...resto } = p;
        return Object.assign(resto, { archivos });
      }));
      pedidos.sort((x, y) => String(y.creado).localeCompare(String(x.creado)));
      return res.status(200).json({ precio: PRECIO(), precio_generica: PRECIO_GEN(), pedidos });
    }

    return res.status(404).json({ error: 'No encontrado.' });
  } catch (e) {
    console.error('mascota', e && e.message);
    return res.status(500).json({ error: 'Algo falló. Probá de nuevo en un rato.' });
  }
};
