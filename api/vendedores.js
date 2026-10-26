// Vitrina 360 · Vendedores (revendedores que traen clientes y cobran comisión).
// Se guarda en el almacenamiento privado de Supabase (carpeta "vendedores"), sin tablas nuevas:
//   v/<CODIGO>.json  → el vendedor, sus clientes y los pagos que ya le hiciste
//   c/<usuario>.json → de qué vendedor vino cada cliente (para no asignarlo dos veces)
//   indice.json      → la lista de códigos
// Acciones:
//   POST ?accion=anotar   {nombre,email,wa,alias}  (público)        → crea el vendedor y devuelve su link y su panel
//   GET  ?accion=existe&c=CODIGO                    (público)        → {ok, nombre}
//   POST ?accion=asignar  {code}                    (cliente logueado) → lo marca como cliente de ese vendedor
//   GET  ?accion=panel&c=CODIGO&k=CLAVE             (el vendedor)    → sus clientes, lo que ganó y lo que le pagaste
//   GET  ?accion=admin                              (el dueño)       → todos los vendedores y cuánto debés a cada uno
//   POST ?accion=pagar    {code}                    (el dueño)       → marca como pagado lo que le correspondía
const crypto = require('crypto');
const { cuerpo, usuario, db, stHeaders } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ST = () => SURL() + '/storage/v1';
const B = 'vendedores';
const corto = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const nums = (env, def) => { const a = String(process.env[env] || '').split(',').map(Number); return a.length === 3 && a.every(x => x >= 0) ? a : def; };
// Premio por venta (cuando el cliente paga por primera vez) y comisión mensual (desde el mes siguiente), por plan: Start, Plus, Pro
const PREMIO = () => { const a = nums('VENDEDOR_PREMIOS', [5000, 7000, 10000]); return { emprendedora: a[0], comercio: a[1], pro: a[2] }; };
const MENSUAL = () => { const a = nums('VENDEDOR_MENSUAL', [1000, 1500, 2000]); return { emprendedora: a[0], comercio: a[1], pro: a[2] }; };
const NOMBRE_PLAN = { emprendedora: 'Start', comercio: 'Plus', pro: 'Pro' };
const ADMINS = () => String(process.env.ADMIN_EMAILS || process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const mesDe = t => new Date(t).toISOString().slice(0, 7);

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
  if (!r.ok) throw new Error('almacenamiento ' + r.status);
}
const okCode = c => /^[A-Z0-9]{3,16}$/.test(String(c || ''));

// Cuenta lo que ganó cada vendedor: premio cuando el cliente paga por primera vez; después, comisión cada mes que siga pagando.
async function calcular(v) {
  const ids = (v.clientes || []).map(c => c.id).filter(id => /^[0-9a-f-]{36}$/i.test(id));
  let filas = [];
  if (ids.length) { try { filas = await db('GET', '/rest/v1/tiendas?owner=in.(' + ids.join(',') + ')&select=owner,slug,plan,pagada_hasta,prueba_hasta,activa') || []; } catch (e) { filas = []; } }
  const porId = Object.fromEntries(filas.map(f => [f.owner, f]));
  const now = Date.now(), mes = mesDe(now), P = PREMIO(), Mn = MENSUAL();
  const pagadoPremio = new Set(((v.pagado || {}).premios) || []);
  const pagadoMes = ((v.pagado || {}).meses) || {};
  const premioMes = ((v.pagado || {}).premioMes) || {};
  const debe = [];
  const clientes = (v.clientes || []).map(c => {
    const f = porId[c.id] || {}, plan = NOMBRE_PLAN[f.plan] ? f.plan : 'emprendedora';
    const pago = !!f.pagada_hasta, activo = pago && Date.parse(f.pagada_hasta) > now && f.activa !== false;
    const estado = activo ? 'pagando' : pago ? 'dejó de pagar' : (f.prueba_hasta && Date.parse(f.prueba_hasta) > now ? 'en prueba gratis' : 'sin pagar');
    if (pago && !pagadoPremio.has(c.id)) debe.push({ id: c.id, tipo: 'premio', monto: P[plan], tienda: f.slug || c.email, plan: NOMBRE_PLAN[plan] });
    // la comisión mensual arranca el mes siguiente al premio
    if (activo && pagadoPremio.has(c.id) && premioMes[c.id] && premioMes[c.id] < mes && !(pagadoMes[mes] || []).includes(c.id)) debe.push({ id: c.id, tipo: 'mes', mes, monto: Mn[plan], tienda: f.slug || c.email, plan: NOMBRE_PLAN[plan] });
    return { tienda: f.slug || '', email: c.email || '', desde: c.at, plan: NOMBRE_PLAN[plan], estado };
  });
  const total = debe.reduce((a, d) => a + d.monto, 0);
  const cobrado = (v.pagos || []).reduce((a, p) => a + (p.monto || 0), 0);
  return { code: v.code, nombre: v.nombre, wa: v.wa || '', alias: v.alias || '', creado: v.creado, clientes, debe, total, cobrado, pagos: (v.pagos || []).slice(-24).reverse(), activos: clientes.filter(c => c.estado === 'pagando').length };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.SUPABASE_SERVICE_KEY || !SURL()) return res.status(503).json({ error: 'Todavía no está configurado.' });
  const q = req.query || {}, a = q.accion || '';
  const base = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'vitrina360-kappa.vercel.app');
  try {
    await bucket();

    // ---- Un vendedor se anota solo y recibe su link al instante ----
    if (req.method === 'POST' && a === 'anotar') {
      const b = cuerpo(req), nombre = corto(b.nombre, 60), email = corto(b.email, 120).toLowerCase(), wa = corto(b.wa, 30), alias = corto(b.alias, 60);
      if (nombre.length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || wa.replace(/\D/g, '').length < 8) return res.status(400).json({ error: 'Completá tu nombre, tu mail y tu WhatsApp.' });
      const idx = (await leer('indice.json')) || { codigos: [] };
      const ya = idx.codigos.find(x => x.email === email);
      if (ya) return res.status(409).json({ error: 'Ese mail ya está anotado como vendedor. Si perdiste el link de tu panel, escribile a Vitrina 360.' });
      const raiz = (nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().match(/[A-Z0-9]+/g) || ['VENDE'])[0].slice(0, 10).padEnd(3, 'X');
      let code = raiz, n = 1;
      while (idx.codigos.some(x => x.code === code)) code = raiz + (++n);
      const v = { code, nombre, email, wa, alias, k: crypto.randomBytes(12).toString('hex'), creado: new Date().toISOString(), clientes: [], pagos: [], pagado: { premios: [], premioMes: {}, meses: {} } };
      await guardar('v/' + code + '.json', v);
      idx.codigos.push({ code, nombre, email, creado: v.creado });
      await guardar('indice.json', idx);
      return res.status(200).json({ code, link: base + '/?ref=' + code, panel: base + '/vendedor.html?c=' + code + '&k=' + v.k });
    }

    if (req.method === 'GET' && a === 'existe') {
      const c = String(q.c || '').toUpperCase(); if (!okCode(c)) return res.status(200).json({ ok: false });
      const v = await leer('v/' + c + '.json');
      return res.status(200).json(v ? { ok: true, nombre: v.nombre.split(' ')[0] } : { ok: false });
    }

    // ---- El vendedor mira su panel con su link secreto ----
    if (req.method === 'GET' && a === 'panel') {
      const c = String(q.c || '').toUpperCase(); if (!okCode(c)) return res.status(400).json({ error: 'Link inválido.' });
      const v = await leer('v/' + c + '.json');
      if (!v || !q.k || v.k !== String(q.k)) return res.status(404).json({ error: 'No encontramos tu panel. Revisá el link.' });
      const out = await calcular(v);
      delete out.alias;
      return res.status(200).json(Object.assign(out, { link: base + '/?ref=' + v.code, premios: PREMIO(), mensual: MENSUAL() }));
    }

    // ---- Un cliente nuevo queda marcado como cliente de ese vendedor ----
    if (req.method === 'POST' && a === 'asignar') {
      const u = await usuario(req); if (!u) return res.status(401).json({ error: 'Tenés que entrar a tu tienda.' });
      const c = String(cuerpo(req).code || '').toUpperCase().trim(); if (!okCode(c)) return res.status(400).json({ error: 'Código inválido.' });
      const ya = await leer('c/' + u.id + '.json');
      if (ya) return res.status(200).json({ ok: true, code: ya.code, ya: true });
      const v = await leer('v/' + c + '.json'); if (!v) return res.status(404).json({ error: 'Ese código de vendedor no existe.' });
      // solo cuentas nuevas (hasta 30 días) o que todavía no pagaron nunca
      try {
        const info = await db('GET', '/auth/v1/admin/users/' + u.id);
        const filas = await db('GET', '/rest/v1/tiendas?owner=eq.' + u.id + '&select=pagada_hasta');
        const nueva = info && info.created_at && Date.now() - Date.parse(info.created_at) < 30 * 864e5;
        const pago = filas && filas[0] && filas[0].pagada_hasta;
        if (!nueva && pago) return res.status(409).json({ error: 'Tu cuenta ya existía antes: el código de vendedor es para cuentas nuevas.' });
      } catch (e) {}
      await guardar('c/' + u.id + '.json', { code: c, at: new Date().toISOString() });
      v.clientes = (v.clientes || []).filter(x => x.id !== u.id).concat([{ id: u.id, email: u.email, at: new Date().toISOString() }]);
      await guardar('v/' + c + '.json', v);
      return res.status(200).json({ ok: true, code: c, nombre: v.nombre.split(' ')[0] });
    }

    // ---- El dueño: todos los vendedores, lo que se debe y marcar pagos ----
    if (a === 'admin' || a === 'pagar') {
      const u = await usuario(req); if (!u) return res.status(401).json({ error: 'Entrá primero a tu panel de Vitrina 360.' });
      if (!ADMINS().includes(String(u.email).toLowerCase())) return res.status(403).json({ error: 'Esta pantalla es solo para el dueño de Vitrina 360.', email: u.email });
      if (req.method === 'POST' && a === 'pagar') {
        const c = String(cuerpo(req).code || '').toUpperCase(); if (!okCode(c)) return res.status(400).json({ error: 'Código inválido.' });
        const v = await leer('v/' + c + '.json'); if (!v) return res.status(404).json({ error: 'No existe ese vendedor.' });
        const r = await calcular(v); if (!r.debe.length) return res.status(200).json({ ok: true, monto: 0 });
        v.pagado = v.pagado || { premios: [], premioMes: {}, meses: {} };
        v.pagado.premioMes = v.pagado.premioMes || {}; v.pagado.meses = v.pagado.meses || {};
        const mes = mesDe(Date.now());
        r.debe.forEach(d => { if (d.tipo === 'premio') { v.pagado.premios.push(d.id); v.pagado.premioMes[d.id] = mes; } else { (v.pagado.meses[d.mes] = v.pagado.meses[d.mes] || []).push(d.id); } });
        v.pagos = (v.pagos || []).concat([{ fecha: new Date().toISOString(), monto: r.total, detalle: r.debe.map(d => ({ tipo: d.tipo, tienda: d.tienda, plan: d.plan, monto: d.monto, mes: d.mes || '' })) }]);
        await guardar('v/' + c + '.json', v);
        return res.status(200).json({ ok: true, monto: r.total });
      }
      const idx = (await leer('indice.json')) || { codigos: [] };
      const vs = [];
      for (const x of idx.codigos) { const v = await leer('v/' + x.code + '.json'); if (v) vs.push(Object.assign(await calcular(v), { email: v.email, panel: base + '/vendedor.html?c=' + v.code + '&k=' + v.k, link: base + '/?ref=' + v.code })); }
      const totDebe = vs.reduce((s, v) => s + v.total, 0);
      return res.status(200).json({ vendedores: vs, totalDebe: totDebe, premios: PREMIO(), mensual: MENSUAL() });
    }

    return res.status(405).json({ error: 'Acción no válida.' });
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo completar. Probá de nuevo en un ratito.' });
  }
};
