// Vitrina 360 · archivos de productos digitales (PDF, plantillas, ebooks, música…).
// Se guardan en una carpeta PRIVADA de Supabase ("digitales"); nadie los ve hasta que el comercio marca el pedido como pagado.
//   POST /api/digital  (comerciante) {nombre, tipo} → {ref, url}: link para subir el archivo directo a la carpeta privada.
const crypto = require('crypto');
const { cuerpo, usuario, stHeaders } = require('./_comun');
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'El almacenamiento todavía no está configurado.' });
  try {
    const u = await usuario(req);
    if (!u) return res.status(401).json({ error: 'Tenés que entrar a tu tienda.' });
    const b = cuerpo(req);
    const limpio = String(b.nombre || 'archivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80) || 'archivo';
    const ref = u.id + '/' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex') + '-' + limpio;
    // carpeta privada (si ya existe, Supabase responde que existe y seguimos)
    await fetch(base() + '/bucket', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: 'digitales', name: 'digitales', public: false, file_size_limit: 104857600 }) }).catch(() => {});
    const r = await fetch(base() + '/object/upload/sign/digitales/' + ref, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: '{}' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.url) return res.status(502).json({ error: 'No se pudo preparar la subida del archivo.' });
    return res.status(200).json({ ref, url: base() + j.url });
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo preparar la subida del archivo.' });
  }
};
