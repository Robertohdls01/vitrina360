// Vitrina 360 · Pedidos: el cliente manda su pedido, el comerciante lo ve en su panel y marca cuándo sale el delivery.
// Se guardan como archivos en el almacenamiento de Supabase (carpeta privada "pedidos"), sin tablas nuevas.
//   POST /api/pedidos                         (cliente)     crea un pedido → {ref, k}
//   GET  /api/pedidos?ref=...&k=...           (cliente)     estado de su pedido
//   GET  /api/pedidos                         (comerciante) sus pedidos de los últimos días
//   POST /api/pedidos?accion=estado           (comerciante) {ref, estado, repartidor}
//   GET  /api/pedidos?fila=slug               (cualquiera)  la fila de pedidos en preparación (número y nombre de pila)
//   GET  /api/pedidos?perfil=slug             (cualquiera)  nombre, WhatsApp y rubro de un comercio (para conectarlo a la red)
//   POST /api/pedidos?accion=conectar          (comerciante) {slug, quitar?}: se conecta con un vivero/insumos/taller
//   GET  /api/pedidos?accion=red               (comerciante) los parqueros que se conectaron con mi negocio
//   GET  /api/pedidos?ocupados=slug           (cualquiera)  turnos ya reservados (día y hora) para no ofrecerlos
//   POST con cita: "2026-11-20T10:00"         reserva ese turno (409 si ya está ocupado)
//   GET  /api/pedidos?resenas=slug            (cualquiera)  reseñas visibles y promedio
//   POST /api/pedidos?accion=resena           (cliente)     {ref, k, estrellas, texto, nombre}: una por pedido
//   GET  /api/pedidos?accion=resenas          (comerciante) todas sus reseñas
//   POST /api/pedidos?accion=resena-mod       (comerciante) {id, oculta?, rta?}
// Fila: cada pedido nuevo recibe un número del día (#1, #2…). Se guarda en fila/<dueño>.json.
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
// ---- Fila de pedidos: número del día y orden de llegada ----
const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const pila = n => corto(String(n || '').trim().split(/\s+/)[0] || '', 20);
async function leerFila(owner) {
  const r = await fetch(base() + '/object/' + BUCKET + '/fila/' + owner + '.json', { headers: headers() });
  const f = r.ok ? await r.json().catch(() => null) : null;
  return f && Array.isArray(f.activos) ? f : { dia: hoyAR(), n: 0, activos: [] };
}
async function guardarFila(owner, f) {
  try { await fetch(base() + '/object/' + BUCKET + '/fila/' + owner + '.json', { method: 'POST', headers: headers({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(f) }); } catch (e) {}
}
// Agenda de turnos (parquería y servicios con día y hora): agenda/<dueño>.json = { "2026-11-20T10:00": "id del pedido" }
const okCita = c => /^20\d\d-\d\d-\d\dT\d\d:\d\d$/.test(String(c || ''));
async function leerAgenda(owner) {
  const r = await fetch(base() + '/object/' + BUCKET + '/agenda/' + owner + '.json', { headers: headers({ 'cache-control': 'no-cache' }) });
  const f = r.ok ? await r.json().catch(() => null) : null;
  const a = f && typeof f === 'object' ? f : {}, hoy = hoyAR();
  Object.keys(a).forEach(k => { if (k.slice(0, 10) < hoy) delete a[k]; });   // los turnos pasados se olvidan
  return a;
}
async function guardarAgenda(owner, a) {
  try { await fetch(base() + '/object/' + BUCKET + '/agenda/' + owner + '.json', { method: 'POST', headers: headers({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(a) }); } catch (e) {}
}
const filaPublica = f => f.activos.slice(0, 15).map(a => ({ n: a.n, nombre: a.nombre || '' }));
// los últimos pedidos que quedaron listos o salieron (15 minutos), para el turnero
const listosPublicos = f => (Array.isArray(f.listos) ? f.listos : []).filter(x => x && Date.now() - x.t < 15 * 60e3).slice(0, 4).map(x => ({ n: x.n, nombre: x.nombre || '', e: x.e }));
// Lo que ve el cliente: sin los datos internos del comercio.
const paraCliente = p => ({ turno: p.turno || null, estado: p.estado, paga_ahora: !!p.paga_ahora, pagado: !!p.pagado, repartidor: p.repartidor || '', salio_en: p.salio_en || null, creado: p.creado, envio: p.envio || '', demora: p.demora || '', digital: (p.items || []).some(it => it.d), servicio: !!p.servicio });
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

// ---- Reseñas: solo puede opinar quien hizo un pedido (compra verificada), una vez por pedido ----
async function leerResenas(owner) {
  const r = await fetch(base() + '/object/' + BUCKET + '/resenas/' + owner + '.json', { headers: headers() });
  const f = r.ok ? await r.json().catch(() => null) : null;
  return f && Array.isArray(f.items) ? f : { items: [] };
}
async function guardarResenas(owner, f) {
  await fetch(base() + '/object/' + BUCKET + '/resenas/' + owner + '.json', { method: 'POST', headers: headers({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(f) });
}
const resumen = items => { const v = items.filter(x => !x.oculta); const n = v.length; return { n, prom: n ? Math.round(v.reduce((a, x) => a + x.e, 0) / n * 10) / 10 : 0 }; };
const resPublica = x => ({ id: x.id, nombre: x.nombre, e: x.e, tx: x.tx, f: x.f, rta: x.rta || '' });

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
      if (p.estado === 'preparando') {
        const f = await leerFila(String(q.ref).split('/')[0]), i = f.activos.findIndex(a => a.id === p.id);
        if (i >= 0) { c.delante = i; c.en_fila = f.activos.length; c.fila = filaPublica(f); c.listos = listosPublicos(f); }
      }
      return res.status(200).json(c);
    }

    // ---- Reseñas públicas de una tienda ----
    if (req.method === 'GET' && q.resenas) {
      const slug = String(q.resenas);
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ error: 'Tienda inválida.' });
      const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=owner,activa');
      const t = rows && rows[0];
      if (!t || t.activa === false) return res.status(404).json({ error: 'Esta tienda no está disponible.' });
      const f = await leerResenas(t.owner), v = f.items.filter(x => !x.oculta);
      return res.status(200).json(Object.assign(resumen(f.items), { items: v.slice(0, 60).map(resPublica) }));
    }

    // ---- Cliente: deja su reseña con el pedido que hizo ----
    if (req.method === 'POST' && q.accion === 'resena') {
      const b = cuerpo(req);
      if (!okRef(b.ref)) return res.status(400).json({ error: 'Pedido inválido.' });
      const e = parseInt(b.estrellas, 10);
      if (!(e >= 1 && e <= 5)) return res.status(400).json({ error: 'Elegí de 1 a 5 estrellas.' });
      const p = await leer(b.ref);
      if (!p || !b.k || p.k !== String(b.k)) return res.status(404).json({ error: 'No encontramos ese pedido.' });
      if (p.estado === 'cancelado') return res.status(400).json({ error: 'Ese pedido fue cancelado.' });
      if (p.resena) return res.status(409).json({ error: 'Ya dejaste tu opinión para este pedido. ¡Gracias!' });
      const owner = String(b.ref).split('/')[0];
      const f = await leerResenas(owner);
      const r = { id: p.id, nombre: pila(b.nombre || (p.comprador && p.comprador.nombre)) || 'Cliente', e, tx: corto(String(b.texto || '').trim(), 400), f: new Date().toISOString() };
      f.items = [r].concat(f.items.filter(x => x.id !== p.id)).slice(0, 300);
      await guardarResenas(owner, f);
      p.resena = e; await guardar(b.ref, p);
      return res.status(200).json(Object.assign({ ok: true }, resumen(f.items)));
    }

    // ---- Fila pública de una tienda (número y nombre de pila) ----
    // ---- App de cada tienda en el celular del cliente: ícono con el logo del negocio ----
    if (req.method === 'GET' && (q.icono || q.manifest)) {
      const slug = String(q.icono || q.manifest);
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).end();
      const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=nombre,data,activa');
      const t = rows && rows[0]; if (!t) return res.status(404).end();
      const d = t.data || {}, st = (d.stores || [])[d.active || 0] || {}, br = st.brand || {};
      const nom = String(br.name || t.nombre || 'Mi tienda').slice(0, 40);
      const verde = br.preset === 'parques' || br.preset === 'casero';
      const c1 = verde ? '#2e7d32' : '#6d28d9', c2 = verde ? '#66bb6a' : '#a855f7';
      if (q.manifest) {
        res.setHeader('Content-Type', 'application/manifest+json'); res.setHeader('Cache-Control', 'public, max-age=600');
        return res.status(200).send(JSON.stringify({ name: nom, short_name: nom.slice(0, 14), id: '/t/' + slug, start_url: '/t/' + slug + '?app=1', scope: '/t/' + slug, display: 'standalone', orientation: 'portrait',
          background_color: c1, theme_color: c1, lang: 'es', icons: [{ src: '/api/pedidos?icono=' + slug, sizes: '512x512', type: 'image/svg+xml', purpose: 'any' }, { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] }));
      }
      // el logo va adentro del ícono (un ícono no puede traer imágenes de otro lado)
      let logo = '';
      const L = String(br.logo || '');
      if (/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(L) && L.length < 600000) logo = L;
      else if (/^https:\/\//.test(L)) { try { const r = await fetch(L); const ty = (r.headers.get('content-type') || '').split(';')[0];
        if (r.ok && /^image\/(png|jpeg|webp)$/.test(ty)) { const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 450000) logo = 'data:' + ty + ';base64,' + buf.toString('base64'); } } catch (e) {} }
      const ini = nom.split(/\s+/).filter(w => w.length > 2 || /\d/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase().replace(/[<>&"']/g, '') || '⚡';
      const centro = logo ? `<rect x="56" y="56" width="400" height="400" rx="80" fill="#fff"/><image href="${logo}" x="76" y="76" width="360" height="360" preserveAspectRatio="xMidYMid meet"/>`
        : `<circle cx="256" cy="246" r="170" fill="#fff" opacity=".96"/><text x="256" y="${ini.length > 1 ? 300 : 310}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="${ini.length > 1 ? 150 : 180}" fill="${c1}">${ini}</text>`;
      res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="512" height="512" rx="110" fill="url(#g)"/>${centro}</svg>`);
    }
    // ---- Red de Parques y Jardines: datos públicos de un comercio (para conectarlo) ----
    if (req.method === 'GET' && q.perfil) {
      const slug = String(q.perfil);
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ error: 'Tienda inválida.' });
      const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=nombre,data,activa');
      const t = rows && rows[0]; if (!t || t.activa === false) return res.status(404).json({ error: 'No encontramos esa tienda.' });
      const d = t.data || {}, br = ((d.stores || [])[d.active || 0] || {}).brand || {};
      return res.status(200).json({ slug, nombre: corto(br.name || t.nombre || slug, 40), wa: corto(String(br.wa || '').replace(/[^\d+]/g, ''), 20), rubro: corto(br.preset || '', 20), dir: corto(br.addr || '', 120) });
    }
    // turnos ya reservados de una tienda (sin datos de nadie: solo día y hora)
    if (req.method === 'GET' && q.ocupados) {
      const slug = String(q.ocupados);
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ error: 'Tienda inválida.' });
      const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=owner,activa');
      const t = rows && rows[0];
      if (!t || t.activa === false) return res.status(404).json({ error: 'Esta tienda no está disponible.' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ocupados: Object.keys(await leerAgenda(t.owner)) });
    }
    if (req.method === 'GET' && q.fila) {
      const slug = String(q.fila);
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ error: 'Tienda inválida.' });
      const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=owner,activa');
      const t = rows && rows[0];
      if (!t || t.activa === false) return res.status(404).json({ error: 'Esta tienda no está disponible.' });
      const f = await leerFila(t.owner);
      return res.status(200).json({ fila: filaPublica(f), en_fila: f.activos.length, listos: listosPublicos(f) });
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
      // turno con día y hora: si alguien lo reservó recién, se avisa y no se crea el pedido
      const cita = okCita(b.cita) ? String(b.cita) : '';
      let agenda = null;
      if (cita) { agenda = await leerAgenda(t.owner); if (agenda[cita]) return res.status(409).json({ error: 'Ese horario se acaba de ocupar. Elegí otro, por favor.', ocupado: true }); }
      const ref = t.owner + '/' + id;
      const c = b.comprador || {}, g = b.regalo || {};
      const pedido = {
        id, k: crypto.randomBytes(12).toString('hex'), creado: new Date().toISOString(), estado: 'preparando',
        items, total: corto(b.total, 30), envio: corto(b.envio, 40), envio_id: corto(b.envio_id, 20), demora: corto(b.demora, 40),
        comprador: { nombre: corto(c.nombre, 80), tel: corto(c.tel, 30), dir: corto(c.dir, 160), ref: corto(c.ref, 160), turno: corto(c.turno, 120), cita, horario: corto(c.horario, 80), lugar: corto(c.lugar, 60) }, servicio: !!b.servicio,
        regalo: g.si ? { para: corto(g.para, 20), mensaje: corto(g.mensaje, 160) } : null,
        pago: corto(b.pago, 120), paga_ahora: !!b.paga_ahora, pagado: false,
        total_n: Number.isFinite(Number(b.total_n)) && Number(b.total_n) > 0 ? Math.round(Number(b.total_n) * 100) / 100 : null,
        moneda: /^[A-Z]{3}$/.test(String(b.moneda || '')) ? String(b.moneda) : 'ARS',
        repartidor: '', salio_en: null
      };
      // número de la fila (se reinicia cada día)
      const fila = await leerFila(t.owner);
      if (fila.dia !== hoyAR()) { fila.dia = hoyAR(); fila.n = 0; }
      fila.n = (Number(fila.n) || 0) + 1; pedido.turno = fila.n;
      await guardar(ref, pedido);
      if (cita) { agenda[cita] = id; await guardarAgenda(t.owner, agenda); }
      fila.activos = fila.activos.filter(a => a && a.id).concat([{ id, n: fila.n, nombre: pila(pedido.comprador.nombre), creado: pedido.creado }]).slice(-80);
      await guardarFila(t.owner, fila);
      return res.status(200).json({ ref, k: pedido.k, turno: pedido.turno, delante: fila.activos.length - 1 });
    }

    // ---- Comerciante ----
    const u = await usuario(req);
    if (!u) return res.status(401).json({ error: 'Tenés que entrar a tu tienda.' });

    // ---- Red: el parquero se conecta (o desconecta) con un vivero, tienda de insumos o taller; el otro lo ve en su panel ----
    if (q.accion === 'conectar' || q.accion === 'red') {
      const mine = await db('GET', '/rest/v1/tiendas?owner=eq.' + u.id + '&select=slug,nombre,data');
      const me = mine && mine[0]; if (!me) return res.status(404).json({ error: 'Primero creá tu tienda.' });
      const redPath = s => base() + '/object/' + BUCKET + '/red/' + s + '.json';
      const leerRed = async s => { const r = await fetch(redPath(s), { headers: headers({ 'cache-control': 'no-cache' }) }); const f = r.ok ? await r.json().catch(() => null) : null; return Array.isArray(f) ? f : []; };
      if (req.method === 'GET' && q.accion === 'red') return res.status(200).json({ red: await leerRed(me.slug) });
      if (req.method === 'POST') {
        const b = cuerpo(req), prov = String(b.slug || '');
        if (!/^[a-z0-9-]{3,40}$/.test(prov) || prov === me.slug) return res.status(400).json({ error: 'Tienda inválida.' });
        const d = me.data || {}, br = ((d.stores || [])[d.active || 0] || {}).brand || {};
        await asegurarBucket();
        let lista = (await leerRed(prov)).filter(x => x && x.slug !== me.slug);
        if (!b.quitar) lista = [{ slug: me.slug, n: corto(br.name || me.nombre || me.slug, 40), wa: corto(String(br.wa || '').replace(/[^\d+]/g, ''), 20), rubro: corto(br.preset || '', 20), dir: corto(br.addr || '', 120), desde: new Date().toISOString() }].concat(lista).slice(0, 500);
        await fetch(redPath(prov), { method: 'POST', headers: headers({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(lista) });
        return res.status(200).json({ ok: true });
      }
    }

    // ---- Comerciante: sus reseñas (también las ocultas), ocultar/mostrar y responder ----
    if (req.method === 'GET' && q.accion === 'resenas') {
      const f = await leerResenas(u.id);
      return res.status(200).json(Object.assign(resumen(f.items), { items: f.items.slice(0, 300) }));
    }
    if (req.method === 'POST' && q.accion === 'resena-mod') {
      const b = cuerpo(req), f = await leerResenas(u.id), r = f.items.find(x => x.id === String(b.id || ''));
      if (!r) return res.status(404).json({ error: 'No encontramos esa reseña.' });
      if (typeof b.oculta === 'boolean') r.oculta = b.oculta;
      if (typeof b.rta === 'string') r.rta = corto(b.rta.trim(), 300);
      await guardarResenas(u.id, f);
      return res.status(200).json(Object.assign({ ok: true }, resumen(f.items)));
    }

    if (req.method === 'GET') {
      await asegurarBucket();
      const r = await fetch(base() + '/object/list/' + BUCKET, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: u.id, limit: 60, offset: 0, sortBy: { column: 'name', order: 'desc' } }) });
      const lista = r.ok ? await r.json().catch(() => []) : [];
      const archivos = (Array.isArray(lista) ? lista : []).filter(f => f && /\.json$/.test(f.name || '')).slice(0, 40);
      const pedidos = (await Promise.all(archivos.map(f => leer(u.id + '/' + f.name.replace(/\.json$/, '')).catch(() => null))))
        .filter(Boolean).map(p => Object.assign({}, p, { k: undefined, ref: u.id + '/' + p.id }))
        .sort((a, b) => String(b.creado).localeCompare(String(a.creado)));
      const f = await leerFila(u.id);
      const activos = pedidos.filter(p => p.estado === 'preparando').sort((a, b) => String(a.creado).localeCompare(String(b.creado)))
        .map(p => ({ id: p.id, n: p.turno || null, nombre: pila(p.comprador && p.comprador.nombre), creado: p.creado }));
      if (JSON.stringify(activos.map(a => a.id)) !== JSON.stringify(f.activos.map(a => a.id))) { f.activos = activos; await guardarFila(u.id, f); }
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
      if (b.estado === 'listo') p.listo_en = new Date().toISOString();
      await guardar(b.ref, p);
      // si se cancela un turno, ese horario vuelve a quedar libre
      if (b.estado === 'cancelado' && p.comprador && okCita(p.comprador.cita)) { const a = await leerAgenda(u.id); if (a[p.comprador.cita] === p.id) { delete a[p.comprador.cita]; await guardarAgenda(u.id, a); } }
      if (b.estado !== 'preparando') {
        const f = await leerFila(u.id), antes = f.activos.length;
        f.activos = f.activos.filter(a => a.id !== p.id);
        if ((b.estado === 'listo' || b.estado === 'salio') && p.turno) f.listos = [{ n: p.turno, nombre: pila(p.comprador && p.comprador.nombre), e: b.estado, t: Date.now() }].concat((Array.isArray(f.listos) ? f.listos : []).filter(x => x.n !== p.turno)).slice(0, 6);
        if (f.activos.length !== antes || b.estado === 'listo' || b.estado === 'salio') await guardarFila(u.id, f);
      }
      return res.status(200).json({ ok: true, estado: p.estado });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo procesar el pedido.' });
  }
};
