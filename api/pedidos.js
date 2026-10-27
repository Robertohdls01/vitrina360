// Vitrina 360 · Pedidos: el cliente manda su pedido, el comerciante lo ve en su panel y marca cuándo sale el delivery.
// Se guardan como archivos en el almacenamiento de Supabase (carpeta privada "pedidos"), sin tablas nuevas.
//   POST /api/pedidos                         (cliente)     crea un pedido → {ref, k}
//   GET  /api/pedidos?ref=...&k=...           (cliente)     estado de su pedido
//   GET  /api/pedidos                         (comerciante) sus pedidos de los últimos días
//   POST /api/pedidos?accion=estado           (comerciante) {ref, estado, repartidor}
const crypto = require('crypto');
const { cuerpo, usuario, db } = require('./_comun');

const BUCKET = 'pedidos';
const ESTADOS = ['preparando', 'salio', 'listo', 'entregado', 'cancelado'];
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1';
function headers(extra) {
  const k = process.env.SUPABASE_SERVICE_KEY, h = Object.assign({ apikey: k }, extra || {});
  if (String(k).startsWith('eyJ')) h.Authorization = 'Bearer ' + k;
  return h;
}
const corto = (v, n) => String(v == null ? '' : v).slice(0, n);
const okRef = ref => /^[0-9a-f-]{36}\/[0-9a-z]{6,24}$/i.test(String(ref || ''));

let bucketListo = false;
async function asegurarBucket() {
  if (bucketListo) return;
  const r = await fetch(base() + '/bucket', { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
  if (r.ok || r.status === 400 || r.status === 409) bucketListo = true; // 400/409: ya existe
}
async function leer(ref) {
  const r = await fetch(base() + '/object/' + BUCKET + '/' + ref + '.json', { headers: headers() });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}
async function guardar(ref, p, otraVez) {
  const r = await fetch(base() + '/object/' + BUCKET + '/' + ref + '.json', { method: 'POST', headers: headers({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(p) });
  if (!r.ok) {
    if (!otraVez) { bucketListo = false; await asegurarBucket(); return guardar(ref, p, true); }
    throw new Error('almacenamiento ' + r.status);
  }
}
// Lo que ve el cliente: sin los datos internos del comercio.
const paraCliente = p => ({ estado: p.estado, paga_ahora: !!p.paga_ahora, pagado: !!p.pagado, repartidor: p.repartidor || '', salio_en: p.salio_en || null, creado: p.creado, envio: p.envio || '', demora: p.demora || '', digital: (p.items || []).some(it => it.d), servicio: !!p.servicio });
// Links de descarga que vencen en 3 días, solo cuando el comercio marcó el pedido como pagado/listo.
async function descargas(p) {
  const out = [];
  for (const it of (p.items || []).filter(x => x.d && x.f)) {
    try {
      const r = await fetch(base() + '/object/sign/digitales/' + it.f, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: 3 * 86400 }) });
      const j = await r.json().catch(() => ({}));
      const u = j.signedURL || j.signedUrl;
      if (r.ok && u) out.push({ n: it.n, url: base() + u + (u.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(it.fn || it.n) });
    } catch (e) {}
  }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.SUPABASE_SERVICE_KEY || !process.env.SUPABASE_URL) return res.status(503).json({ error: 'Los pedidos todavía no están configurados.' });
  const q = req.query || {};
  try {
    // ---- Cliente: estado de su pedido ----
    if (req.method === 'GET' && q.ref) {
      if (!okRef(q.ref)) return res.status(400).json({ error: 'Pedido inválido.' });
      const p = await leer(q.ref);
      if (!p || !q.k || p.k !== String(q.k)) return res.status(404).json({ error: 'No encontramos ese pedido.' });
      const c = paraCliente(p);
      if (c.digital && (p.estado === 'listo' || p.estado === 'entregado')) c.descargas = await descargas(p);
      return res.status(200).json(c);
    }

    // ---- Cliente: manda un pedido nuevo desde la tienda pública ----
    if (req.method === 'POST' && !q.accion) {
      const b = cuerpo(req);
      const slug = String(b.slug || '');
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ error: 'Tienda inválida.' });
      const items = Array.isArray(b.items) ? b.items.slice(0, 60).map(it => ({ n: corto(it && it.n, 120), q: Math.max(1, Math.min(999, parseInt(it && it.q, 10) || 1)), p: corto(it && it.p, 30), id: corto(it && it.id, 40) })) : [];
      if (!items.length) return res.status(400).json({ error: 'El pedido está vacío.' });
      const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=owner,activa,data');
      const t = rows && rows[0];
      if (!t || t.activa === false) return res.status(404).json({ error: 'Esta tienda no está disponible.' });
      // productos digitales: el archivo sale del catálogo guardado del comercio (así nadie puede pedir un archivo ajeno)
      const catalogo = {};
      try { (((t.data || {}).stores) || []).forEach(st => (st.products || []).forEach(p => { if (p && p.id && p.digital && p.file && p.file.ref && String(p.file.ref).startsWith(t.owner + '/')) catalogo[p.id] = p.file; })); } catch (e) {}
      items.forEach(it => { const f = catalogo[it.id]; if (f) { it.d = 1; it.f = String(f.ref); it.fn = corto(f.name, 120); } it.pid = it.id; delete it.id; });   // pid: para descontar el stock
      await asegurarBucket();
      const id = Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
      const ref = t.owner + '/' + id;
      const c = b.comprador || {}, g = b.regalo || {};
      const pedido = {
        id, k: crypto.randomBytes(12).toString('hex'), creado: new Date().toISOString(), estado: 'preparando',
        items, total: corto(b.total, 30), envio: corto(b.envio, 40), envio_id: corto(b.envio_id, 20), demora: corto(b.demora, 40),
        comprador: { nombre: corto(c.nombre, 80), tel: corto(c.tel, 30), dir: corto(c.dir, 160), ref: corto(c.ref, 160), turno: corto(c.turno, 120), horario: corto(c.horario, 80), lugar: corto(c.lugar, 60) }, servicio: !!b.servicio,
        regalo: g.si ? { para: corto(g.para, 20), mensaje: corto(g.mensaje, 160) } : null,
        pago: corto(b.pago, 120), paga_ahora: !!b.paga_ahora, pagado: false,
        total_n: Number.isFinite(Number(b.total_n)) && Number(b.total_n) > 0 ? Math.round(Number(b.total_n) * 100) / 100 : null,
        moneda: /^[A-Z]{3}$/.test(String(b.moneda || '')) ? String(b.moneda) : 'ARS',
        repartidor: '', salio_en: null
      };
      await guardar(ref, pedido);
      return res.status(200).json({ ref, k: pedido.k });
    }

    // ---- Comerciante ----
    const u = await usuario(req);
    if (!u) return res.status(401).json({ error: 'Tenés que entrar a tu tienda.' });

    if (req.method === 'GET') {
      await asegurarBucket();
      const r = await fetch(base() + '/object/list/' + BUCKET, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: u.id, limit: 60, offset: 0, sortBy: { column: 'name', order: 'desc' } }) });
      const lista = r.ok ? await r.json().catch(() => []) : [];
      const archivos = (Array.isArray(lista) ? lista : []).filter(f => f && /\.json$/.test(f.name || '')).slice(0, 40);
      const pedidos = (await Promise.all(archivos.map(f => leer(u.id + '/' + f.name.replace(/\.json$/, '')).catch(() => null))))
        .filter(Boolean).map(p => Object.assign({}, p, { k: undefined, ref: u.id + '/' + p.id }))
        .sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
      return res.status(200).json({ pedidos });
    }

    if (req.method === 'POST' && q.accion === 'estado') {
      const b = cuerpo(req);
      if (!okRef(b.ref) || String(b.ref).split('/')[0] !== u.id) return res.status(403).json({ error: 'Ese pedido no es de tu tienda.' });
      if (!ESTADOS.includes(b.estado) && b.estado !== 'pagado') return res.status(400).json({ error: 'Estado inválido.' });
      const p = await leer(b.ref);
      if (!p) return res.status(404).json({ error: 'No encontramos ese pedido.' });
      // "Pago recibido": el comercio confirma que le llegó la plata; el pedido sigue en preparación y al cliente se le avisa solo
      if (b.estado === 'pagado') { p.pagado = true; p.pagado_en = new Date().toISOString(); await guardar(b.ref, p); return res.status(200).json({ ok: true, estado: p.estado, pagado: true }); }
      p.estado = b.estado;
      if (b.estado === 'salio') { p.repartidor = corto(b.repartidor, 40); p.salio_en = new Date().toISOString(); }
      await guardar(b.ref, p);
      return res.status(200).json({ ok: true, estado: p.estado });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo procesar el pedido.' });
  }
};
