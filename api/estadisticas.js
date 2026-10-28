// Vitrina 360 · Estadísticas propias (gratis): visitas a las páginas y quiénes se anotaron.
// Se guarda en el almacenamiento privado de Supabase (carpeta "estadisticas"), un archivo por día: d/AAAA-MM-DD.json
//   POST ?accion=visita {p, v, ref, src, host, slug}  (público)   → suma una visita
//   GET  ?accion=admin                                (el dueño)  → visitas de los últimos 30 días, de dónde vienen y las cuentas anotadas
const { cuerpo, usuario, db, estado, stHeaders, PLANES } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ST = () => SURL() + '/storage/v1';
const B = 'estadisticas';
const PAGINAS = { inicio: 'Página principal', ingles: 'Página en inglés', vender: 'Anotarse como vendedor', tienda: 'Tiendas de los clientes' };
const ADMINS = () => String(process.env.ADMIN_EMAILS || process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const dia = t => new Date(t - 3 * 3600e3).toISOString().slice(0, 10);   // hora de Argentina
const limpio = (v, n, rx) => String(v == null ? '' : v).replace(rx, '').slice(0, n);

let listo = false;
async function bucket() {
  if (listo) return;
  try { await fetch(ST() + '/bucket', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: B, name: B, public: false }) }); } catch (e) {}
  listo = true;
}
async function leer(path) {
  try { const r = await fetch(ST() + '/object/' + B + '/' + path, { headers: stHeaders({ 'cache-control': 'no-cache' }) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function guardar(path, obj) {
  const put = () => fetch(ST() + '/object/' + B + '/' + path, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) });
  let r = await put(); if (!r.ok) { listo = false; await bucket(); r = await put(); }
}

// De dónde vino la visita, en palabras
function fuente(b) {
  if (b.ref) return 'Link de vendedor (' + b.ref + ')';
  const s = (b.src || '') + ' ' + (b.host || '');
  if (/facebook|fb\.|fbclid/.test(s)) return 'Facebook';
  if (/instagram/.test(s)) return 'Instagram';
  if (/tiktok/.test(s)) return 'TikTok';
  if (/whatsapp|wa\.me/.test(s)) return 'WhatsApp';
  if (/youtube|youtu\.be/.test(s)) return 'YouTube';
  if (/google/.test(s)) return 'Google';
  if (/hotmart/.test(s)) return 'Hotmart';
  if (/bing|duckduckgo|yahoo/.test(s)) return 'Otros buscadores';
  if (b.src) return b.src;
  if (b.host) return b.host.replace(/^www\./, '');
  return 'Directo (link pegado o WhatsApp)';
}

module.exports = async (req, res) => {
  const accion = String((req.query && req.query.accion) || '');
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Todavía no está configurado.' });

  if (accion === 'visita' && req.method === 'POST') {
    const b = cuerpo(req);
    const p = PAGINAS[b.p] ? b.p : null;
    const v = limpio(b.v, 12, /[^a-z0-9]/g);
    if (!p || !v) return res.status(204).end();
    const ua = String(req.headers['user-agent'] || '');
    if (/bot|crawl|spider|preview|facebookexternalhit|whatsapp\/|headless/i.test(ua)) return res.status(204).end();   // no contar robots ni vistas previas de links
    const info = { ref: limpio(b.ref, 16, /[^A-Z0-9]/g), src: limpio(b.src, 24, /[^a-z0-9_-]/g), host: limpio(String(b.host || '').toLowerCase(), 80, /[^a-z0-9.-]/g) };
    const path = 'd/' + dia(Date.now()) + '.json';
    const d = (await leer(path)) || { pag: {}, src: {} };
    const pg = d.pag[p] || (d.pag[p] = { n: 0, u: [] });
    pg.n++;
    const nuevo = !pg.u.includes(v);
    if (nuevo && pg.u.length < 5000) pg.u.push(v);
    if (nuevo) { const f = fuente(info); d.src[f] = (d.src[f] || 0) + 1; }
    if (p === 'tienda' && /^[a-z0-9-]{3,40}$/.test(String(b.slug || ''))) { d.tiendas = d.tiendas || {}; d.tiendas[b.slug] = (d.tiendas[b.slug] || 0) + 1; }
    await guardar(path, d);
    return res.status(204).end();
  }

  if (accion === 'admin' && req.method === 'GET') {
    const u = await usuario(req).catch(() => null);
    if (!u) return res.status(401).json({ error: 'Tu sesión venció.' });
    if (!ADMINS().includes(String(u.email || '').toLowerCase())) return res.status(403).json({ error: 'Esta pantalla es solo para el dueño de Vitrina 360.', email: u.email });

    // visitas de los últimos 30 días
    const hoy = Date.now(), dias = [];
    for (let i = 29; i >= 0; i--) dias.push(dia(hoy - i * 864e5));
    const archivos = await Promise.all(dias.map(d => leer('d/' + d + '.json')));
    const fuentes = {}, paginas = {}, tiendasVis = {};
    const serie = dias.map((d, i) => {
      const f = archivos[i] || { pag: {}, src: {} }, unicos = new Set();
      let vistas = 0;
      for (const [p, x] of Object.entries(f.pag || {})) {
        vistas += x.n || 0; (x.u || []).forEach(id => unicos.add(id));
        const pp = paginas[p] || (paginas[p] = { nombre: PAGINAS[p] || p, vistas: 0, visitantes: 0 });
        pp.vistas += x.n || 0; pp.visitantes += (x.u || []).length;
      }
      for (const [s, n] of Object.entries(f.src || {})) fuentes[s] = (fuentes[s] || 0) + n;
      for (const [s, n] of Object.entries(f.tiendas || {})) tiendasVis[s] = (tiendasVis[s] || 0) + n;
      return { dia: d, visitantes: unicos.size, vistas };
    });

    // cuentas anotadas (mails) y sus tiendas
    let usuarios = [], filas = [];
    try {
      for (let page = 1; page <= 10; page++) {
        const r = await fetch(SURL() + '/auth/v1/admin/users?page=' + page + '&per_page=500', { headers: stHeaders() });
        if (!r.ok) break;
        const j = await r.json(), lista = (j && j.users) || [];
        usuarios = usuarios.concat(lista);
        if (lista.length < 500) break;
      }
    } catch (e) {}
    try { filas = (await db('GET', '/rest/v1/tiendas?select=*')) || []; } catch (e) { filas = []; }
    const porOwner = Object.fromEntries(filas.map(f => [f.owner, f]));
    const P = PLANES(), admins = ADMINS();
    const cuentas = usuarios.map(us => {
      const t = porOwner[us.id];
      let est = 'Se anotó, sin tienda', dias = null;
      if (t) {
        const e = estado(t); dias = e.dias;
        est = e.estado === 'activa' ? 'Pagando' : e.estado === 'prueba' ? 'En prueba gratis' : t.pagada_hasta ? 'Dejó de pagar' : 'Prueba vencida';
      }
      return {
        email: us.email || '', creado: us.created_at || (t && t.created_at) || null, ultimo: us.last_sign_in_at || null,
        tienda: t ? (t.nombre || t.slug || '') : '', slug: t ? t.slug || '' : '', plan: t && P[t.plan] ? P[t.plan].nombre : '', estado: est, dias,
        vistas: t && t.slug ? (tiendasVis[t.slug] || 0) : 0, vos: admins.includes(String(us.email || '').toLowerCase())
      };
    }).sort((a, b) => Date.parse(b.creado || 0) - Date.parse(a.creado || 0));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      serie, paginas: Object.values(paginas).sort((a, b) => b.vistas - a.vistas),
      fuentes: Object.entries(fuentes).map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n),
      cuentas, desde: dias[0]
    });
  }
  return res.status(400).json({ error: 'Acción no válida.' });
};
