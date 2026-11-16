// ShopFiesta · invitaciones virtuales con confirmación y app de la fiesta.
// La fiesta se guarda en el almacenamiento privado de Supabase (carpeta "fiestas"):  e/<CODIGO>.json
// Las respuestas de los invitados van en la tabla fiesta_resp (una fila por invitado, así 200 pueden confirmar a la vez).
// Acciones:
//   POST ?accion=crear     {datos}                 (público)       → crea la fiesta; devuelve código y clave del panel
//   POST ?accion=guardar   {f,k,datos}             (la familia)    → guarda diseño, datos e invitados
//   GET  ?accion=panel&f&k                          (la familia)    → todo + las confirmaciones
//   GET  ?accion=ver&f[&i=TOKEN]                    (invitados)     → la invitación (y quién es, si viene con su link)
//   GET  ?accion=buscar&f&q                         (invitados)     → buscar su nombre (link general)
//   POST ?accion=responder {f,i,va,cuantos,menu,nota} (invitados)   → confirma o avisa que no va
//   GET  ?manifest=CODIGO  /  ?icono=CODIGO                         → para guardar la fiesta como app en el celular
const crypto = require('crypto');
const { cuerpo, stHeaders, usuario } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const ST = () => SURL() + '/storage/v1';
const B = 'fiestas';
const DEMO = 'DEMO15';
const corto = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const largo = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0009\u000b-\u001f]/g, ' ').trim().slice(0, n);
const hash = s => crypto.createHash('sha256').update('fiesta:' + String(s)).digest('hex');
const okCode = c => /^[A-Z0-9]{4,12}$/.test(String(c || ''));
const azar = (n, abc) => { const b = crypto.randomBytes(n); let s = ''; for (let i = 0; i < n; i++) s += abc[b[i] % abc.length]; return s; };
const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PLANTILLAS = ['elegante', 'flores', 'brillos', 'moderna', 'mariposas', 'luna'];
const MODOS = ['especial', 'comun', 'link'];
const TIPOS = ['15', 'casamiento', 'cumple', 'bautismo', 'egresados', 'otro'];
const MENUS = ['', 'vegetariano', 'vegano', 'sin TACC', 'infantil', 'otro'];
const ADMINS = () => String(process.env.ADMIN_EMAILS || process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const EN_VIVO = () => process.env.FIESTA_EN_VIVO === '1'; // los paquetes con la fiesta en vivo se venden cuando esté lista
// Paquetes para la familia (precios cambiables desde Vercel). "extra" = recargo por más de 150 invitados (solo en los de fiesta en vivo).
const PAQ = () => ({
  invitacion: { nombre: 'Invitación', precio: Number(process.env.PRECIO_FIESTA_INV || 35000), disponible: true, incluye: 'Invitación virtual, confirmaciones, links por WhatsApp e ícono en el celular' },
  completa: { nombre: 'Fiesta completa', precio: Number(process.env.PRECIO_FIESTA_COMPLETA || 100000), disponible: EN_VIVO(), vivo: true, incluye: 'Invitación + recepción, mesas, pedidos a las mozas, avisos de comida y vals, panel en vivo' },
  recuerdos: { nombre: 'Fiesta completa + recuerdos', precio: Number(process.env.PRECIO_FIESTA_RECUERDOS || 140000), disponible: EN_VIVO(), vivo: true, incluye: 'Todo lo anterior + álbum de fotos, cuadro de firmas y resumen de la noche' }
});
const EXTRA150 = () => Number(process.env.PRECIO_FIESTA_EXTRA150 || 25000);
const montoDe = (paq, e) => { const P = PAQ()[paq]; if (!P) return 0; return P.precio + (P.vivo && (e.invitados || []).length > 150 ? EXTRA150() : 0); };
async function mpGet(path) {
  const tok = String(process.env.MP_ACCESS_TOKEN || '').trim(); if (!tok) return null;
  const r = await fetch('https://api.mercadopago.com' + path, { headers: { Authorization: 'Bearer ' + tok } });
  return r.ok ? r.json().catch(() => null) : null;
}
const marcarPago = (e, paq, pid, monto, manual) => { e.pagado = true; e.paquete = paq; e.pagos = (e.pagos || []).concat([{ paquete: paq, id: pid || '', monto: monto || 0, t: new Date().toISOString(), manual: !!manual }]); };
// Revisa en Mercado Pago si la fiesta tiene un pago aprobado que todavía no se marcó (por si el aviso no llegó).
async function revisarPago(e) {
  if (!e.pagoRef) return false;
  const j = await mpGet('/v1/payments/search?external_reference=' + encodeURIComponent(e.pagoRef) + '&sort=date_created&criteria=desc&limit=5');
  const ok = j && Array.isArray(j.results) && j.results.find(x => x.status === 'approved');
  if (!ok || (e.pagos || []).some(p => p.id === String(ok.id))) return false;
  marcarPago(e, e.pagoRef.split('/')[2], String(ok.id), ok.transaction_amount); delete e.pagoRef; return true;
}

let listo = false;
async function bucket() {
  if (listo) return;
  try { await fetch(ST() + '/bucket', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: B, name: B, public: false }) }); } catch (e) {}
  listo = true;
}
async function leer(code) {
  try { const r = await fetch(ST() + '/object/' + B + '/e/' + code + '.json', { headers: stHeaders({ 'cache-control': 'no-cache' }) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function guardarObj(code, obj) {
  const put = () => fetch(ST() + '/object/' + B + '/e/' + code + '.json', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) });
  let r = await put(); if (!r.ok) { listo = false; await bucket(); r = await put(); }
  if (!r.ok) throw new Error('almacenamiento ' + r.status);
}
async function rest(method, path, body, prefer) {
  const h = stHeaders({ 'Content-Type': 'application/json' }); if (prefer) h.Prefer = prefer;
  const r = await fetch(SURL() + '/rest/v1/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok) throw new Error('db ' + r.status + ' ' + String((j && j.message) || t).slice(0, 160));
  return j;
}

// Fiesta de muestra para mostrar a los clientes (no se guarda nada).
const demoData = () => ({
  code: DEMO, demo: true, tipo: '15', modo: 'especial', plantilla: 'elegante', color: '#c9a227',
  titulo: 'Mis 15', nombre: 'Julieta', frase: 'Hay momentos que no se olvidan. Quiero compartir este con vos.',
  fecha: proxSabado(), hora: '21:30', salon: 'Salón de ejemplo', direccion: 'Mar del Plata',
  vestimenta: 'Elegante sport', regalo: 'Lluvia de sobres o alias: JULI.15.FIESTA', mostrarMesa: true, pedirMenu: true,
  catering: 'Catering de ejemplo', mozas: ['Karina', 'Sofía', 'Lucía'],
  foto: '', invitados: [
    { id: 'g1', nombre: 'Roberto Hernández', mesa: '2', menor: false, cupo: 1, tok: 'demoroberto' },
    { id: 'g2', nombre: 'Marta Gómez', mesa: '2', menor: false, cupo: 0, tok: 'demomarta' },
    { id: 'g3', nombre: 'Sofía Pérez', mesa: '7', menor: true, cupo: 0, tok: 'demosofia' },
    { id: 'g4', nombre: 'José Martínez', mesa: '3', menor: false, cupo: 2, tok: 'demojose' }
  ]
});
function proxSabado() { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7) + 21); return d.toISOString().slice(0, 10); }

// Limpia lo que manda el panel. Conserva los links (tokens) de los invitados que ya existían.
function limpiar(d, prev) {
  d = d || {}; prev = prev || {};
  const o = {
    tipo: TIPOS.includes(d.tipo) ? d.tipo : '15',
    modo: MODOS.includes(d.modo) ? d.modo : 'especial',
    plantilla: PLANTILLAS.includes(d.plantilla) ? d.plantilla : 'elegante',
    color: /^#[0-9a-fA-F]{6}$/.test(String(d.color || '')) ? d.color : '#c9a227',
    titulo: corto(d.titulo, 40) || 'Mis 15', nombre: corto(d.nombre, 40), frase: largo(d.frase, 220),
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(d.fecha || '')) ? d.fecha : '', hora: /^\d{2}:\d{2}$/.test(String(d.hora || '')) ? d.hora : '',
    salon: corto(d.salon, 80), direccion: corto(d.direccion, 120), vestimenta: corto(d.vestimenta, 80), regalo: largo(d.regalo, 200),
    mostrarMesa: !!d.mostrarMesa, pedirMenu: d.pedirMenu !== false, organiza: corto(d.organiza, 60),
    // catering y mozas: se usan el día de la fiesta ("Ya va Karina a tu mesa")
    catering: corto(d.catering, 60), cateringTel: corto(d.cateringTel, 20).replace(/[^\d+]/g, ''),
    mozas: (Array.isArray(d.mozas) ? d.mozas : []).map(x => corto(x, 30)).filter(Boolean).slice(0, 40)
  };
  if (typeof d.foto === 'string' && (d.foto === '' || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d.foto))) {
    if (d.foto.length > 900000) throw Object.assign(new Error('La foto es muy pesada. Probá con otra.'), { st: 400 });
    o.foto = d.foto;
  } else o.foto = prev.foto || '';
  const viejos = {}; (prev.invitados || []).forEach(g => { viejos[g.id] = g; });
  const lista = Array.isArray(d.invitados) ? d.invitados.slice(0, 600) : (prev.invitados || []);
  let n = (prev.ultimo || 0);
  o.invitados = lista.map(g => {
    const v = g && g.id && viejos[g.id];
    const id = v ? v.id : 'g' + (++n);
    return { id, tok: v ? v.tok : azar(10, 'abcdefghijkmnpqrstuvwxyz23456789'), nombre: corto(g && g.nombre, 60), mesa: corto(g && g.mesa, 12),
      menor: !!(g && g.menor), cupo: Math.max(0, Math.min(10, parseInt(g && g.cupo, 10) || 0)), tel: corto(g && g.tel, 20).replace(/[^\d+]/g, '') };
  }).filter(g => g.nombre);
  o.ultimo = n;
  return o;
}
// Lo que puede ver cualquiera con el link de la fiesta (sin la lista de invitados ni claves).
function publica(e) {
  const o = {}; ['code', 'demo', 'tipo', 'modo', 'plantilla', 'color', 'titulo', 'nombre', 'frase', 'fecha', 'hora', 'salon', 'direccion', 'vestimenta', 'regalo', 'mostrarMesa', 'pedirMenu', 'foto', 'organiza'].forEach(k => { o[k] = e[k]; });
  o.total = (e.invitados || []).length; return o;
}
async function respuestas(code) {
  try { return await rest('GET', 'fiesta_resp?code=eq.' + encodeURIComponent(code) + '&select=gid,va,cuantos,menu,nota,t'); } catch (e) { return []; }
}

module.exports = async (req, res) => {
  const q = req.query || {}, acc = String(q.accion || '');
  try {
    // ---- Para instalar la fiesta como app (ícono con el nombre de la fiesta) ----
    if (req.method === 'GET' && (q.manifest || q.icono)) {
      const code = String(q.manifest || q.icono).toUpperCase(); if (!okCode(code)) return res.status(400).json({ error: 'Fiesta inválida.' });
      const e = code === DEMO ? demoData() : await leer(code); if (!e) return res.status(404).json({ error: 'No existe esa fiesta.' });
      const nom = (e.tipo === '15' ? 'Los 15 de ' : 'Fiesta de ') + (e.nombre || 'la fiesta');
      if (q.icono) {
        const num = (String(e.titulo || '').match(/\d+/) || [])[0] || (e.nombre || 'F').charAt(0).toUpperCase();
        const esc = s => String(s).replace(/[<>&"]/g, '');
        res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff7ee"/><stop offset="1" stop-color="${esc(e.color)}" stop-opacity=".55"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><circle cx="256" cy="230" r="150" fill="#fff" stroke="${esc(e.color)}" stroke-width="14"/><text x="256" y="${num.length > 1 ? 285 : 290}" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="${num.length > 2 ? 110 : 160}" fill="#3b2a12">${esc(num)}</text><text x="256" y="450" text-anchor="middle" font-family="Georgia,serif" font-size="62" fill="#3b2a12">${esc(String(e.nombre || '').slice(0, 12))}</text></svg>`);
      }
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(JSON.stringify({ name: nom, short_name: nom.slice(0, 14), id: '/fiesta/' + code + '?app=1', start_url: '/fiesta/' + code + '?app=1', scope: '/', display: 'standalone', orientation: 'portrait', background_color: '#fffaf3', theme_color: e.color || '#c9a227', lang: 'es',
        icons: [{ src: '/api/fiesta?icono=' + code, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icons/fiesta-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icons/fiesta-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icons/fiesta-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }));
    }

    if (req.method === 'POST' && acc === 'crear') {
      const b = cuerpo(req); await bucket();
      let code = ''; for (let i = 0; i < 6; i++) { code = azar(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'); if (!(await leer(code))) break; }
      const clave = azar(12, 'abcdefghijkmnpqrstuvwxyz23456789');
      const e = Object.assign(limpiar(b.datos, null), { code, clave: hash(clave), creado: new Date().toISOString() });
      await guardarObj(code, e);
      return res.status(200).json({ ok: true, code, clave, panel: '/fiesta-panel?f=' + code + '&k=' + clave, link: '/fiesta/' + code });
    }

    if (acc === 'aviso') { // Mercado Pago avisa un pago
      const b = cuerpo(req);
      const tipo = b.type || b.topic || q.type || q.topic || '', pid = String((b.data && b.data.id) || q['data.id'] || q.id || '').replace(/\D/g, '');
      if (!/payment/.test(tipo) || !pid) return res.status(200).json({ ok: true });
      const pay = await mpGet('/v1/payments/' + pid);
      const ref = String(pay && pay.external_reference || ''), pr = ref.split('/');
      if (!pay || pay.status !== 'approved' || pr[0] !== 'fiesta' || !okCode(pr[1]) || !PAQ()[pr[2]]) return res.status(200).json({ ok: true });
      const e = await leer(pr[1]);
      if (e && !(e.pagos || []).some(p => p.id === pid)) { marcarPago(e, pr[2], pid, pay.transaction_amount); delete e.pagoRef; await guardarObj(pr[1], e); }
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET' && acc === 'precios') return res.status(200).json({ paquetes: PAQ(), extra150: EXTRA150() });

    const code = String(q.f || cuerpo(req).f || '').toUpperCase();
    if (!okCode(code)) return res.status(400).json({ error: 'Fiesta inválida.' });
    const esDemo = code === DEMO;

    if (req.method === 'POST' && acc === 'guardar') {
      const b = cuerpo(req);
      if (esDemo) return res.status(403).json({ error: 'La fiesta de muestra no se puede cambiar. Creá la tuya.' });
      const e = await leer(code); if (!e) return res.status(404).json({ error: 'No existe esa fiesta.' });
      if (hash(String(b.k || '')) !== e.clave) return res.status(403).json({ error: 'La clave del panel no es correcta.' });
      const n = Object.assign(limpiar(b.datos, e), { code, clave: e.clave, creado: e.creado, cambiado: new Date().toISOString(), pagado: e.pagado, paquete: e.paquete, pagos: e.pagos, pagoRef: e.pagoRef });
      await guardarObj(code, n);
      return res.status(200).json({ ok: true, invitados: n.invitados });
    }

    if (req.method === 'GET' && acc === 'panel') {
      if (esDemo) {
        const d = Object.assign(demoData(), { pagado: true, paquete: 'invitacion' }); return res.status(200).json({ ok: true, demo: true, paquetes: PAQ(), extra150: EXTRA150(), fiesta: d,
          resp: [{ gid: 'g1', va: true, cuantos: 2, menu: '', nota: '¡Ahí estaremos!', t: new Date().toISOString() }, { gid: 'g3', va: true, cuantos: 1, menu: 'sin TACC', nota: '', t: new Date().toISOString() }, { gid: 'g4', va: false, cuantos: 0, menu: '', nota: 'Estoy de viaje, ¡felicidades!', t: new Date().toISOString() }] });
      }
      const e = await leer(code); if (!e) return res.status(404).json({ error: 'No existe esa fiesta.' });
      if (hash(String(q.k || '')) !== e.clave) return res.status(403).json({ error: 'La clave del panel no es correcta.' });
      if (!e.pagado && e.pagoRef && await revisarPago(e)) await guardarObj(code, e);
      const f = Object.assign({}, e); delete f.clave; delete f.pagoRef;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, fiesta: f, resp: await respuestas(code), paquetes: PAQ(), extra150: EXTRA150() });
    }

    if (req.method === 'POST' && (acc === 'pagar' || acc === 'regalar')) {
      const b = cuerpo(req), paq = String(b.paquete || 'invitacion'), P = PAQ()[paq];
      if (esDemo) return res.status(403).json({ error: 'Esto es una muestra. Creá tu fiesta para activarla.' });
      const e = await leer(code); if (!e) return res.status(404).json({ error: 'No existe esa fiesta.' });
      if (acc === 'regalar') { // el dueño de Pro Video activa gratis (fiestas de prueba)
        const u = await usuario(req);
        if (!u || !ADMINS().includes(String(u.email).toLowerCase())) return res.status(403).json({ error: 'Solo el dueño de Pro Video puede activar gratis.' });
        if (!P) return res.status(400).json({ error: 'Paquete inválido.' });
        marcarPago(e, paq, '', 0, true); await guardarObj(code, e); return res.status(200).json({ ok: true, pagado: true });
      }
      if (hash(String(b.k || '')) !== e.clave) return res.status(403).json({ error: 'La clave del panel no es correcta.' });
      if (!P || !P.disponible) return res.status(400).json({ error: 'Ese paquete todavía no está disponible.' });
      if (e.pagado && (e.paquete === paq || (e.paquete === 'recuerdos'))) return res.status(200).json({ pagado: true });
      const tok = String(process.env.MP_ACCESS_TOKEN || '').trim();
      if (!tok) return res.status(503).json({ error: 'El cobro todavía no está configurado.' });
      const ya = e.pagado ? montoDe(e.paquete, e) : 0, monto = Math.max(0, montoDe(paq, e) - ya); // si ya pagó un paquete, paga la diferencia
      if (monto <= 0) return res.status(200).json({ pagado: true });
      const host = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || 'vitrina360app.com.ar');
      const back = host + '/fiesta-panel?f=' + code + '&k=' + encodeURIComponent(String(b.k || ''));
      const ref = 'fiesta/' + code + '/' + paq + '/' + Date.now().toString(36);
      const r = await fetch('https://api.mercadopago.com/checkout/preferences', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({
        items: [{ id: 'fiesta-' + paq, title: ('ShopFiesta · ' + P.nombre + (e.nombre ? ' · ' + e.nombre : '')).slice(0, 60), quantity: 1, unit_price: monto, currency_id: 'ARS' }],
        external_reference: ref, notification_url: host + '/api/fiesta?accion=aviso',
        back_urls: { success: back + '&pago=ok', pending: back + '&pago=pendiente', failure: back + '&pago=error' }, auto_return: 'approved', statement_descriptor: 'SHOPFIESTA'
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.init_point) { console.error('fiesta pagar', r.status, JSON.stringify(j).slice(0, 300)); return res.status(502).json({ error: 'Mercado Pago no respondió. Probá de nuevo en un rato.' }); }
      e.pagoRef = ref; await guardarObj(code, e);
      return res.status(200).json({ url: j.init_point });
    }

    const e = esDemo ? demoData() : await leer(code);
    if (!e) return res.status(404).json({ error: 'No encontramos esta fiesta. Revisá el link.' });
    if (!esDemo && !e.pagado && ['ver', 'buscar', 'responder'].includes(acc)) return res.status(402).json({ error: 'Esta invitación todavía no está activa. La familia la está terminando de preparar.' });

    if (req.method === 'GET' && acc === 'ver') {
      const out = { ok: true, fiesta: publica(e) };
      const g = q.i && (e.invitados || []).find(x => x.tok === String(q.i));
      if (g) {
        const r = esDemo ? null : ((await rest('GET', 'fiesta_resp?code=eq.' + code + '&gid=eq.' + encodeURIComponent(g.id) + '&select=va,cuantos,menu,nota').catch(() => [])) || [])[0];
        out.inv = { nombre: g.nombre, mesa: e.mostrarMesa ? g.mesa : '', cupo: g.cupo || 0, menor: !!g.menor, resp: r || null };
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(out);
    }

    if (req.method === 'GET' && acc === 'buscar') {
      const t = sinTildes(q.q).trim(); if (t.length < 3) return res.status(200).json({ ok: true, items: [] });
      const partes = t.split(/\s+/);
      const items = (e.invitados || []).filter(g => { const n = sinTildes(g.nombre); return partes.every(p => n.includes(p)); }).slice(0, 6).map(g => ({ nombre: g.nombre, tok: g.tok }));
      return res.status(200).json({ ok: true, items });
    }

    if (req.method === 'POST' && acc === 'responder') {
      const b = cuerpo(req);
      const g = (e.invitados || []).find(x => x.tok === String(b.i || ''));
      if (!g) return res.status(404).json({ error: 'No encontramos tu invitación. Pedile el link a la familia.' });
      const va = !!b.va;
      const fila = { code, gid: g.id, va, cuantos: va ? Math.max(1, Math.min(1 + (g.cupo || 0), parseInt(b.cuantos, 10) || 1)) : 0,
        menu: MENUS.includes(b.menu) ? b.menu : '', nota: largo(b.nota, 300), t: new Date().toISOString() };
      if (!esDemo) await rest('POST', 'fiesta_resp?on_conflict=code,gid', fila, 'resolution=merge-duplicates,return=minimal');
      return res.status(200).json({ ok: true, demo: esDemo, resp: fila, mesa: e.mostrarMesa ? g.mesa : '' });
    }

    return res.status(400).json({ error: 'Acción desconocida.' });
  } catch (err) {
    return res.status(err.st || 500).json({ error: err.st ? err.message : 'Algo falló. Probá de nuevo en un momento.' });
  }
};
