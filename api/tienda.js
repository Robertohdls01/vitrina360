// Tiendas simples (catálogo con WhatsApp) — Pro Video JSRHG. Cada página se edita con un link secreto: el primer guardado con un id nuevo la crea.
//   GET  /api/tienda?id=xxxx                         → datos públicos de la página
//   GET  /api/tienda?f=<id>/<archivo>.jpg            → una foto (se guarda aparte para poder tener cientos)
//   POST /api/tienda?accion=guardar {id, clave, data} → guarda (la clave queda como hash; solo quien la tiene puede editar)
//   POST /api/tienda?accion=foto {id, clave, img}     → sube una foto (dataURL jpeg) y devuelve su url
const crypto = require('crypto');
const { cuerpo } = require('./_comun');

const BUCKET = 'pedidos', DIR = 'tienda/';
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1';
const head = extra => { const k = process.env.SUPABASE_SERVICE_KEY, h = Object.assign({ apikey: k }, extra || {}); if (String(k).startsWith('eyJ')) h.Authorization = 'Bearer ' + k; return h; };
async function leer(path) { const r = await fetch(base() + '/object/' + BUCKET + '/' + path, { headers: head({ 'cache-control': 'no-cache' }) }); return r.ok ? r.json().catch(() => null) : null; }
async function subir(path, body, tipo) { const r = await fetch(base() + '/object/' + BUCKET + '/' + path, { method: 'POST', headers: head({ 'Content-Type': tipo, 'x-upsert': 'true', 'cache-control': 'no-store' }), body }); if (!r.ok) throw new Error('storage ' + r.status); }
const guardar = (path, obj) => subir(path, JSON.stringify(obj), 'application/json');
const okId = id => /^[a-z0-9-]{3,40}$/.test(String(id || ''));
const hash = k => crypto.createHash('sha256').update('tienda:' + String(k || '')).digest('hex');

module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    if (req.method === 'GET' && q.f) {
      const f = String(q.f);
      if (!/^[a-z0-9-]{3,40}\/[a-z0-9]{10,40}\.jpg$/.test(f)) return res.status(400).end();
      const r = await fetch(base() + '/object/' + BUCKET + '/' + DIR + 'fotos/' + f, { headers: head() });
      if (!r.ok) return res.status(404).end();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.status(200).send(Buffer.from(await r.arrayBuffer()));
    }
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') {
      if (!okId(q.id)) return res.status(400).json({ error: 'Página inválida.' });
      const f = await leer(DIR + q.id + '.json');
      if (!f) return res.status(404).json({ error: 'nueva' });
      if (q.clave) return res.status(200).json({ data: f.data, editor: hash(q.clave) === f.h });
      return res.status(200).json({ data: f.data });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
    const b = cuerpo(req);
    if (!okId(b.id)) return res.status(400).json({ error: 'Página inválida.' });
    const clave = String(b.clave || ''); if (clave.length < 12) return res.status(403).json({ error: 'Link de edición inválido.' });
    const prev = await leer(DIR + b.id + '.json');
    if (prev && prev.h !== hash(clave)) return res.status(403).json({ error: 'Este link no puede editar esta página.' });

    if (q.accion === 'foto') {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.img || ''));
      if (!m) return res.status(400).json({ error: 'Foto inválida.' });
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > 900000) return res.status(413).json({ error: 'La foto es muy pesada.' });
      if (!prev) await guardar(DIR + b.id + '.json', { h: hash(clave), data: {}, creado: new Date().toISOString() }); // la página queda reservada para este link
      const nombre = crypto.randomBytes(10).toString('hex') + '.jpg';
      await subir(DIR + 'fotos/' + b.id + '/' + nombre, buf, 'image/jpeg');
      return res.status(200).json({ url: '/api/tienda?f=' + b.id + '/' + nombre });
    }
    if (q.accion !== 'guardar') return res.status(405).json({ error: 'Método no permitido.' });
    const data = b.data && typeof b.data === 'object' ? b.data : null; if (!data) return res.status(400).json({ error: 'Sin datos.' });
    const txt = JSON.stringify(data); if (txt.length > 3500000) return res.status(413).json({ error: 'La página quedó muy pesada.' });
    if (Array.isArray(data.prods) && data.prods.length > 250) return res.status(413).json({ error: 'Máximo 250 productos.' });
    await guardar(DIR + b.id + '.json', { h: hash(clave), data, cambiado: new Date().toISOString(), creado: prev ? prev.creado : new Date().toISOString() });
    return res.status(200).json({ ok: true });
  } catch (e) { console.error('tienda', e); return res.status(500).json({ error: 'No se pudo guardar. Probá de nuevo.' }); }
};
