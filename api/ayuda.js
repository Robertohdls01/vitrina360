// Ayuda de ShopFlash: el comerciante puede dar permiso (y sacarlo cuando quiera) para que el administrador
// entre a su tienda a cargarle productos y configurarla. Sin ese permiso, nadie más puede tocar su tienda.
//   GET  /api/ayuda?accion=estado            (dueño)  → {on, log}
//   POST /api/ayuda?accion=permitir {on}     (dueño)  → activa / desactiva el permiso
//   GET  /api/ayuda?slug=xxx                 (admin)  → los datos de esa tienda, solo si el dueño dio permiso
//   POST /api/ayuda?slug=xxx {data, nombre}  (admin)  → guarda los cambios en esa tienda, solo si hay permiso
const { cuerpo, usuario, db, stHeaders } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ST = () => SURL() + '/storage/v1';
const B = 'ayuda';
const ADMINS = () => String(process.env.ADMIN_EMAILS || process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const okSlug = s => /^[a-z0-9-]{2,60}$/.test(String(s || ''));
const okId = s => /^[0-9a-f-]{36}$/i.test(String(s || ''));

let listo = false;
async function bucket() {
  if (listo) return;
  try { await fetch(ST() + '/bucket', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: B, name: B, public: false }) }); } catch (e) {}
  listo = true;
}
async function leer(owner) {
  try { const r = await fetch(ST() + '/object/' + B + '/' + owner + '.json', { headers: stHeaders({ 'cache-control': 'no-cache' }) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function guardar(owner, obj) {
  const put = () => fetch(ST() + '/object/' + B + '/' + owner + '.json', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) });
  let r = await put(); if (!r.ok) { listo = false; await bucket(); r = await put(); }
  if (!r.ok) throw new Error('almacenamiento ' + r.status);
}
const anotar = (p, email, acc) => { p.log = [{ at: new Date().toISOString(), email, acc }, ...(p.log || [])].slice(0, 30); };

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.SUPABASE_SERVICE_KEY || !SURL()) return res.status(503).json({ error: 'Todavía no está configurado.' });
  const q = req.query || {}, a = q.accion || '';
  try {
    await bucket();
    const u = await usuario(req).catch(() => null);
    if (!u) return res.status(401).json({ error: 'Tu sesión venció. Volvé a entrar.' });
    if (!okId(u.id)) return res.status(400).json({ error: 'Cuenta no válida.' });

    // ---- El dueño de la tienda ve y cambia su permiso ----
    if (a === 'estado' && req.method === 'GET') {
      const p = await leer(u.id) || {};
      return res.status(200).json({ on: !!p.on, log: (p.log || []).slice(0, 10) });
    }
    if (a === 'permitir' && req.method === 'POST') {
      const on = !!cuerpo(req).on, p = await leer(u.id) || {};
      p.on = on; anotar(p, u.email, on ? 'el dueño activó la ayuda' : 'el dueño desactivó la ayuda');
      await guardar(u.id, p);
      return res.status(200).json({ on });
    }

    // ---- El administrador entra a ayudar ----
    const slug = String(q.slug || '').toLowerCase();
    if (!okSlug(slug)) return res.status(400).json({ error: 'Falta la tienda.' });
    if (!ADMINS().includes(String(u.email || '').toLowerCase())) return res.status(403).json({ error: 'Esta función es solo para el equipo de ShopFlash.' });
    const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + encodeURIComponent(slug) + '&select=slug,owner,nombre,data') || [];
    const row = rows[0];
    if (!row) return res.status(404).json({ error: 'No encontré esa tienda.' });
    const p = await leer(row.owner) || {};
    if (!p.on) return res.status(403).json({ error: 'El dueño de esta tienda todavía no activó “Permitir ayuda de ShopFlash”. Pedile que lo active en su panel: Mi cuenta → 🛟 Permitir ayuda.' });

    if (req.method === 'GET') {
      anotar(p, u.email, 'ShopFlash entró a ayudar'); await guardar(row.owner, p).catch(() => {});
      return res.status(200).json({ slug: row.slug, nombre: row.nombre, data: row.data });
    }
    if (req.method === 'POST') {
      const b = cuerpo(req), data = b.data;
      if (!data || !Array.isArray(data.stores) || !data.stores.length) return res.status(400).json({ error: 'Datos de tienda no válidos.' });
      const body = { data, actualizada: new Date().toISOString() };
      if (b.nombre) body.nombre = String(b.nombre).slice(0, 80);
      await db('PATCH', '/rest/v1/tiendas?slug=eq.' + encodeURIComponent(slug), body);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo completar. Probá de nuevo en un momento.' });
  }
};
