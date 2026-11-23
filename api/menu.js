// ShopMenu · Menú QR con asistente. El dueño saca fotos de su carta, la IA la lee y cada mesa tiene su QR.
//   POST /api/menu?accion=leer     {images:[{type,data}]}            la IA lee la carta (no guarda nada). Tope por persona y por día.
//   POST /api/menu?accion=guardar  {id?, clave?, menu}               crea o actualiza el menú (sin cuenta: se edita con la clave)
//   GET  /api/menu?id=…                                              menú público (para los clientes de las mesas)
//   GET  /api/menu?id=…&clave=…                                      para editar (verifica la clave)
//   POST /api/menu?accion=pedido   {id, mesa, nombre, items, nota}   el cliente manda su pedido a la caja
//   POST /api/menu?accion=aviso    {id, mesa, nombre, tipo, texto}   llamar al mozo / pedir la cuenta / consulta al encargado (la caja responde con estado+rta)
//   GET  /api/menu?id=…&pedido=…&k=…                                 el cliente ve cómo va su pedido
//   GET  /api/menu?id=…&clave=…&caja=1                               la caja ve los pedidos y avisos
//   POST /api/menu?accion=estado   {id, clave, pid, estado}          la caja cambia el estado
const crypto = require('crypto');
const { cuerpo, mp } = require('./_comun');

const BUCKET = 'pedidos';
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1';
const head = extra => { const k = process.env.SUPABASE_SERVICE_KEY, h = Object.assign({ apikey: k }, extra || {}); if (String(k).startsWith('eyJ')) h.Authorization = 'Bearer ' + k; return h; };
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const t = (v, n) => String(v == null ? '' : v).slice(0, n);
const hash = s => crypto.createHash('sha256').update('shopmenu|' + s).digest('hex');
async function leerObj0(path) { const r = await fetch(base() + '/object/' + BUCKET + '/' + path, { headers: head() }); return r.ok ? r.json().catch(() => null) : null; }
async function guardarObj0(path, obj) { await fetch(base() + '/object/' + BUCKET + '/' + path, { method: 'POST', headers: head({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) }); }
// Café de prueba público (/shopmenu "Probalo vos mismo"): usa la carta del Café Demo, con sus propios pedidos; la caja abre con la clave "demo" y la carta no se puede cambiar.
const PUB = 'demopublico', PUB_BASE = 'fdaf46084d', BAL = 'demobalneario';
// balneario de muestra: carpas en vez de mesas, alquileres y parador (no se puede editar; los pedidos se borran solos)
const BAL_MENU = { nombre: 'Balneario Las Gaviotas (demo)', lugar: 'carpa', idioma: 'es', moneda: '$', asistente: 'Sol', deco: 'verano',
  saludo: '¡Hola! Soy Sol, del Balneario Las Gaviotas. Pedime reposeras, sombrilla o algo del parador y te lo llevamos a tu carpa.',
  cats: [
    { n: '🏖 Alquileres del día', items: [{ n: 'Reposera', d: 'Por día. Te la llevamos a tu carpa.', p: '$6.000' }, { n: 'Sombrilla', d: 'Por día, armada en tu lugar.', p: '$9.000' }, { n: 'Mesita plegable', d: 'Por día.', p: '$3.000' }, { n: 'Toallón', d: 'Grande, limpio.', p: '$3.500' }, { n: 'Locker con llave', d: 'Para dejar tus cosas.', p: '$4.000' }] },
    { n: '🥤 Bebidas', items: [{ n: 'Agua mineral 500 ml', d: 'Bien fría.', p: '$1.800' }, { n: 'Gaseosa lata', d: 'Coca, Sprite o Fanta.', p: '$2.200' }, { n: 'Licuado de frutilla', d: 'Con leche o con agua.', p: '$4.500', promo: true }, { n: 'Limonada con menta y jengibre', d: 'Jarra de 1 litro.', p: '$6.500' }, { n: 'Cerveza artesanal', d: 'Pinta, rubia o roja.', p: '$5.000' }, { n: 'Café con leche', d: 'Para la mañana.', p: '$2.800' }] },
    { n: '🍔 Parador', items: [{ n: 'Hamburguesa completa con papas', d: 'Lechuga, tomate, queso y huevo.', p: '$11.500' }, { n: 'Tostado de jamón y queso', d: 'Con papas fritas.', p: '$7.500' }, { n: 'Rabas', d: 'Porción para compartir, con limón.', p: '$14.000' }, { n: 'Ensalada de frutas', d: 'De estación.', p: '$5.000' }, { n: 'Medialunas x3', d: 'Manteca o grasa.', p: '$3.000' }] },
    { n: '🍦 Helados', items: [{ n: 'Palito de agua', d: 'Frutilla o limón.', p: '$1.500' }, { n: 'Cucurucho 2 gustos', d: '', p: '$4.000' }] },
    { n: '🏄 Actividades', items: [{ n: 'Clase de surf (1 hora)', d: 'Con tabla y traje incluidos.', p: '$25.000' }, { n: 'Alquiler de kayak (1 hora)', d: 'Con chaleco.', p: '$15.000' }] }
  ] };
async function leerObj(path) {
  if (path === 'menus/' + PUB + '.json') { const f = await leerObj0('menus/' + PUB_BASE + '.json'); if (!f) return null; f.clave = hash('demo'); f.libre = true; f.menu = Object.assign({}, f.menu, { nombre: 'Café de Prueba', dueno: '', mozos: [], paylink: '', alias: '', avatar: 'flashy', asistente: 'Flashy' }); return f; }
  if (path === 'menus/' + BAL + '.json') { const st = await leerObj0(path); return { clave: hash('demo'), libre: true, creado: '2026-11-16T00:00:00Z', menu: Object.assign({}, BAL_MENU, st && st.menu && st.menu.tr ? { tr: st.menu.tr } : {}) }; }
  return leerObj0(path);
}
async function guardarObj(path, obj) { if (path === 'menus/' + PUB + '.json' || path === 'menus/' + BAL + '.json') return; return guardarObj0(path, obj); }

// deja el menú limpio y con tamaños razonables
function limpiar(m) {
  m = m || {};
  const cats = (Array.isArray(m.cats) ? m.cats : []).slice(0, 40).map(c => ({ n: t(c && c.n, 60),
    items: (Array.isArray(c && c.items) ? c.items : []).slice(0, 80).map(i => ({ n: t(i && i.n, 90), d: t(i && i.d, 240), p: t(i && i.p, 30), promo: !!(i && i.promo) })).filter(i => i.n) })).filter(c => c.n || c.items.length);
  const logo = typeof m.logo === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(m.logo) && m.logo.length < 120000 ? m.logo : '';
  return { deco: ['navidad', 'anionuevo', 'deportes', 'fiesta', 'madre', 'padre', 'enamorados', 'halloween', 'verano', 'invierno', 'otono', 'primavera', 'pascua', 'ofertas'].includes(m.deco) ? m.deco : '', musica: !!m.musica, idioma: LANGS.includes(m.idioma) ? m.idioma : 'es', fondoV: /^\d{6,16}$/.test(String(m.fondoV || '')) ? String(m.fondoV) : '', fondoCaja: !!m.fondoCaja, envio: !!m.envio, envioTx: t(m.envioTx, 120), logo, lugar: ['mesa', 'maquina', 'habitacion', 'sombrilla', 'carpa', 'butaca'].includes(m.lugar) ? m.lugar : 'mesa', nombre: t(m.nombre, 60), wa: t(m.wa, 20).replace(/[^\d+]/g, ''), mesas: Math.max(1, Math.min(500, parseInt(m.mesas, 10) || 10)), asistente: t(m.asistente, 20) || 'Lola', avatar: ['moza', 'mozo', 'flashy'].includes(m.avatar) ? m.avatar : '', pelo: ['castano', 'rubio', 'negro', 'colorado', 'canoso'].includes(m.pelo) ? m.pelo : '', largo: m.largo === 'corto' ? 'corto' : 'largo', piel: ['clara', 'media', 'morena', 'oscura'].includes(m.piel) ? m.piel : '', barba: !!m.barba,
    saludo: t(m.saludo, 200), moneda: t(m.moneda, 4) || '$', alias: t(m.alias, 60), billeteras: (Array.isArray(m.billeteras) ? m.billeteras : []).slice(0, 6).map(x => ({ b: ['uala', 'modo', 'naranjax', 'cuentadni', 'bna', 'personalpay', 'brubank', 'prex', 'lemon', 'belo', 'galicia', 'santander', 'bbva', 'macro', 'provincia', 'astropay', 'paypal', 'applepay', 'googlepay', 'zelle', 'venmo', 'cashapp', 'wise', 'revolut', 'pix', 'binance', 'banco', 'otra'].includes(x && x.b) ? x.b : 'otra', a: t(x && x.a, 120) })).filter(x => x.a), dueno: t(m.dueno, 30), cajaAva: ['flashi', 'robot', 'gatito', 'igual'].includes(m.cajaAva) ? m.cajaAva : 'flashi', greview: /^https:\/\//i.test(String(m.greview || '')) ? t(m.greview, 300) : '', opiPub: m.opiPub !== false, mozos: (Array.isArray(m.mozos) ? m.mozos : String(m.mozos || '').split(',')).map(x => t(String(x).trim(), 20)).filter(Boolean).slice(0, 12), demora: Math.max(0, Math.min(120, parseInt(m.demora, 10) || 0)), paylink: /^https:\/\//i.test(String(m.paylink || '')) ? t(m.paylink, 300) : '', ig: t(m.ig, 60).replace(/[^\w.@/:\-]/g, ''), fb: t(m.fb, 200).replace(/[\s<>"']/g, ''), tt: t(m.tt, 60).replace(/[^\w.@/:\-]/g, ''), web: /^https:\/\//i.test(String(m.web || '')) ? t(m.web, 300) : '', tienda: /^https:\/\//i.test(String(m.tienda || '')) ? t(m.tienda, 300) : '', tiendaTx: t(m.tiendaTx, 40), nov: t(m.nov, 300), links: (Array.isArray(m.links) ? m.links : []).slice(0, 10).map(x => ({ t: t(x && x.t, 12).replace(/[^a-z]/g, ''), u: t(x && x.u, 300).replace(/[\s<>"']/g, ''), l: t(x && x.l, 40) })).filter(x => x.u && (/^https:\/\//i.test(x.u) || /^(ig|fb|tt|wa|yt)$/.test(x.t))), cats };
}


// ---- Idiomas: la carta se carga en un idioma y se traduce sola a los otros 7 (una vez, cuando cambia el texto) ----
const LANGS = ['es', 'en', 'pt', 'fr', 'it', 'de', 'ru', 'zh'];
const IDI = { es: 'castellano rioplatense (Argentina)', en: 'English', pt: 'português do Brasil', fr: 'français', it: 'italiano', de: 'Deutsch', ru: 'русский', zh: '简体中文' };
const IA = async (prompt, max) => {
  const KEY = process.env.ANTHROPIC_API_KEY; if (!KEY) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.IA_MODEL_TEXT || 'claude-haiku-5-5', max_tokens: max, messages: [{ role: 'user', content: prompt }] }) });
  if (!r.ok) return '';
  const j = await r.json(); return (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
};
// traduce un mensaje corto (consultas entre la mesa y el encargado, y lo que dice la moza en idiomas extra)
async function traducirTexto(txt, to) {
  if (!txt || !IDI[to]) return '';
  try { return String(await IA(`Traducí este mensaje de un café/restaurante al ${IDI[to]}. Es una charla entre un cliente y el local. Mantené los emojis, los nombres propios y los precios. Respondé SOLO con la traducción, sin comillas ni explicaciones.\n\n${txt}`, 600)).trim().slice(0, 600); } catch (e) { return ''; }
}
// traduce la carta a un idioma (una llamada por idioma, en paralelo)
async function traducir1(menu, L) {
  const src = { saludo: menu.saludo || '', cats: menu.cats.map(c => ({ n: c.n, items: c.items.map(i => ({ n: i.n, d: i.d })) })) };
  const tip = (menu.idioma || 'es') === 'es' ? ' Platos típicos argentinos (por ejemplo "medialuna", "milanesa", "choripán") dejalos en su nombre original y agregá entre paréntesis una explicación muy corta.' : '';
  const prompt = `Traducí esta carta de restaurante al ${IDI[L]}. Mantené EXACTAMENTE la misma estructura, el mismo orden y la misma cantidad de secciones y platos. Los nombres propios o de marca dejalos igual.${tip} Respondé SOLO con JSON: {"saludo":"","cats":[{"n":"","items":[{"n":"","d":""}]}]}
${JSON.stringify(src)}`;
  try {
    const text = await IA(prompt, 12000); if (!text) return null;
    const x = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (!x || !Array.isArray(x.cats) || x.cats.length !== menu.cats.length) return null;
    if (!x.cats.every((c, k) => c && Array.isArray(c.items) && c.items.length === menu.cats[k].items.length)) return null;
    return { saludo: t(x.saludo, 200), cats: x.cats.map(c => ({ n: t(c.n, 60), items: c.items.map(i => ({ n: t(i && i.n, 90), d: t(i && i.d, 240) })) })) };
  } catch (e) { return null; }
}
// completa los idiomas que falten (prev = traducciones que ya estaban y siguen sirviendo)
async function traducir(menu, prev, solo) {
  const src = menu.idioma || 'es', tr = {};
  Object.entries(prev || {}).forEach(([L, v]) => { if (LANGS.includes(L) && L !== src && v) tr[L] = v; });
  const faltan = (solo || LANGS).filter(L => L !== src && !tr[L]);
  const res = await Promise.all(faltan.map(L => traducir1(menu, L)));
  faltan.forEach((L, k) => { if (res[k]) tr[L] = res[k]; });
  return Object.keys(tr).length ? tr : null;
}

// ---- Cuenta del local: 7 días de prueba, después abono mensual por Mercado Pago (o cobro a mano desde Mis pruebas) ----
const PRECIO = () => parseInt(process.env.SHOPMENU_PRECIO, 10) || 18700;
// Oferta del primer día: si se suscribe dentro de las 24 h de crear el menú, el primer mes sale PRECIO_PROMO; desde el 2.º mes pasa solo al precio normal.
const PROMO = () => parseInt(process.env.SHOPMENU_PRECIO_PROMO, 10) || 14900;
const promoVigente = f => !f.precio && !f.mpSus && f.creado && Date.now() - Date.parse(f.creado) < 864e5;
const LIBRES = ['fdaf46084d']; // Café Demo
async function cuenta(id, f) {
  const ahora = Date.now(); let cambio = false;
  if (LIBRES.includes(id) || f.libre) return { estado: 'activo', libre: true };
  if (!f.creado) { f.creado = new Date().toISOString(); cambio = true; }
  const finPrueba = Date.parse(f.creado) + 7 * 864e5;
  let hasta = f.pagoHasta ? Date.parse(f.pagoHasta) : 0;
  if (hasta < ahora && f.mpSus && process.env.MP_ACCESS_TOKEN && (!f.mpCheck || ahora - Date.parse(f.mpCheck) > 3 * 3600e3)) {
    f.mpCheck = new Date().toISOString(); cambio = true;
    try { const pre = await mp('GET', '/preapproval/' + encodeURIComponent(f.mpSus));
      if (pre && pre.status === 'authorized') { const prox = Date.parse(pre.next_payment_date || '') || (ahora + 30 * 864e5); hasta = Math.max(ahora + 3 * 864e5, prox + 3 * 864e5); f.pagoHasta = new Date(hasta).toISOString(); f.mpEstado = 'authorized'; }
      else if (pre) f.mpEstado = pre.status; } catch (e) {}
  }
  // pasado el primer cobro con oferta, la suscripción sube sola al precio normal
  if (f.promo1 && f.mpSus && process.env.MP_ACCESS_TOKEN && (!f.promoCheck || ahora - Date.parse(f.promoCheck) > 6 * 3600e3)) {
    f.promoCheck = new Date().toISOString(); cambio = true;
    try { const pre = await mp('GET', '/preapproval/' + encodeURIComponent(f.mpSus));
      const cobros = pre && pre.summarized ? Number(pre.summarized.charged_quantity || 0) : 0;
      if (pre && pre.status === 'authorized' && cobros >= 1) { await mp('PUT', '/preapproval/' + encodeURIComponent(f.mpSus), { auto_recurring: { transaction_amount: f.precio || PRECIO(), currency_id: 'ARS' } }); f.promo1 = false; f.promoPasado = new Date().toISOString(); }
    } catch (e) { console.error('shopmenu promo', e.status || '', e.message); }
  }
  if (cambio) { try { await guardarObj('menus/' + id + '.json', f); } catch (e) {} }
  const pr = f.precio || PRECIO();
  if (hasta > ahora) return { estado: 'activo', hasta: new Date(hasta).toISOString(), mp: !!f.mpSus, precio: pr };
  if (ahora < finPrueba) return Object.assign({ estado: 'prueba', dias: Math.ceil((finPrueba - ahora) / 864e5), precio: pr }, promoVigente(f) ? { promo: PROMO(), promoHasta: new Date(Date.parse(f.creado) + 864e5).toISOString() } : {});
  return { estado: 'vencido', precio: pr, mpEstado: f.mpEstado || '' };
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'ShopMenu no está configurado.' });

    // ---- Pedidos y avisos de las mesas ----
    const ESTADOS = ['nuevo', 'preparando', 'listo', 'entregado', 'cancelado', 'visto', 'respondido', 'confirmado', 'rechazado'];
    const pedPath = id => 'menus/' + id + '-pedidos.json';
    const okId = id => /^[a-z0-9]{6,20}$/.test(String(id || ''));
    if (req.method === 'GET' && q.id && q.pedido) {
      if (!okId(q.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const L = (await leerObj(pedPath(q.id))) || { items: [] };
      const p = (L.items || []).find(x => x.id === String(q.pedido));
      if (!p || p.k !== String(q.k || '')) return res.status(404).json({ error: 'No encontramos ese pedido.' });
      return res.status(200).json({ estado: p.estado, n: p.n, rta: p.rta || '', mozo: p.mozo || '' });
    }
    // ---- Firmas digitales de Pro Video: acuerdo de servicio y constancia de prueba (/firmar) ----
    if (req.method === 'POST' && q.accion === 'firma') {
      const b = cuerpo(req) || {};
      const doc = ['acuerdo', 'prueba', 'galeria'].includes(b.doc) ? b.doc : '';
      if (!doc) return res.status(400).json({ error: 'Documento inválido.' });
      const okPng = u => typeof u === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(u) && u.length > 800 && u.length < 400000;
      if (!okPng(b.firmaCli)) return res.status(400).json({ error: 'Falta la firma del cliente.' });
      if (b.acepto !== true) return res.status(400).json({ error: 'Tenés que marcar que leíste y aceptás.' });
      const d = {}; Object.keys(b.datos || {}).slice(0, 30).forEach(k => { if (/^[a-zA-Z]{1,20}$/.test(k)) d[k] = t(b.datos[k], 200); });
      if (!d.negocio || !d.responsable) return res.status(400).json({ error: 'Completá el negocio y el nombre del responsable.' });
      const id = crypto.randomBytes(5).toString('hex'), k = crypto.randomBytes(8).toString('hex'), fecha = new Date().toISOString();
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), ua = t(req.headers['user-agent'], 200);
      const fpv = okPng(b.firmaVen) ? null : await leerObj0('firmas/firma-pv.json'); // la firma de Pro Video ya viene puesta (la carga Roberto una sola vez)
      const reg = { id, k, doc, datos: d, firmaCli: b.firmaCli, firmaVen: okPng(b.firmaVen) ? b.firmaVen : (fpv && fpv.img) || '', vendedor: t(b.vendedor, 80), version: t(b.version, 20), texto: t(b.texto, 20000), fecha, ip, ua };
      reg.huella = crypto.createHash('sha256').update(JSON.stringify([doc, d, reg.texto, fecha, b.firmaCli])).digest('hex').slice(0, 16);
      await guardarObj0('firmas/' + id + '.json', reg);
      const I = (await leerObj0('firmas/index.json')) || { items: [] };
      I.items = [{ id, k, doc, negocio: d.negocio, responsable: d.responsable, producto: d.producto || '', fecha, vendedor: reg.vendedor }].concat(I.items || []).slice(0, 3000);
      await guardarObj0('firmas/index.json', I);
      return res.status(200).json({ id, k, fecha, huella: reg.huella });
    }
    if (req.method === 'GET' && q.firma) {
      const id = String(q.firma); if (!/^[a-f0-9]{10}$/.test(id)) return res.status(400).json({ error: 'Firma inválida.' });
      const r = await leerObj0('firmas/' + id + '.json');
      if (!r || r.k !== String(q.k || '')) return res.status(404).json({ error: 'No encontramos ese documento.' });
      const { ip, ua, k, ...pub } = r; return res.status(200).json(pub);
    }
    if (q.accion === 'firmaPV') { // la firma fija de Pro Video: GET la muestra, POST (con la clave) la cambia
      if (req.method === 'GET') { const f = await leerObj0('firmas/firma-pv.json'); return res.status(200).json({ img: (f && f.img) || '' }); }
      const b = cuerpo(req) || {}, P = (await leerObj('menus/pruebas.json')) || {};
      if (!P.clave || hash('admin|' + String(b.admin || '')) !== P.clave) return res.status(403).json({ error: 'Clave incorrecta.' });
      if (!(typeof b.img === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(b.img) && b.img.length > 800 && b.img.length < 400000)) return res.status(400).json({ error: 'Firmá en el recuadro.' });
      await guardarObj0('firmas/firma-pv.json', { img: b.img, t: new Date().toISOString() });
      return res.status(200).json({ ok: true });
    }
    if (q.accion === 'firmas') {
      const b = req.method === 'POST' ? cuerpo(req) : {}, adm = String(b.admin || '');
      const P = (await leerObj('menus/pruebas.json')) || {};
      if (!P.clave || hash('admin|' + adm) !== P.clave) return res.status(403).json({ error: 'Clave incorrecta.' });
      const I = (await leerObj0('firmas/index.json')) || { items: [] };
      return res.status(200).json({ items: I.items || [] });
    }
    // ---- Kit de prueba: cartelitos QR genéricos (sin nombre de local) que se activan para el café que está probando ----
    const okKit = k => /^[A-Z0-9]{4,10}$/.test(String(k || ''));
    if (req.method === 'GET' && q.kit) {
      const k = String(q.kit).toUpperCase(); if (!okKit(k)) return res.status(400).json({ error: 'Código de kit inválido.' });
      const m = await leerObj('menus/kit-' + k + '.json');
      return m && m.id ? res.status(200).json({ id: m.id }) : res.status(404).json({ error: 'Kit sin activar.' });
    }
    // ---- Lista de pruebas del vendedor (cafés probando con un kit): protegida con su propia clave ----
    if (q.accion === 'pruebas') {
      const b = req.method === 'POST' ? cuerpo(req) : {}, adm = String(b.admin || q.admin || '');
      const P = (await leerObj('menus/pruebas.json')) || { items: [] };
      if (!P.clave) {
        if (req.method !== 'POST' || !b.crear || adm.length < 6) return res.status(200).json({ sinClave: true });
        P.clave = hash('admin|' + adm); await guardarObj('menus/pruebas.json', P); return res.status(200).json({ items: P.items || [] });
      }
      if (hash('admin|' + adm) !== P.clave) return res.status(403).json({ error: 'Clave incorrecta.' });
      if (req.method === 'POST' && b.pagar && okId(b.pagar.id)) { // cobro a mano (efectivo / transferencia) o dejarlo gratis
        const g = await leerObj('menus/' + b.pagar.id + '.json'); if (!g) return res.status(404).json({ error: 'No encontramos ese menú.' });
        if (b.pagar.precio !== undefined) { const v = parseInt(b.pagar.precio, 10); g.precio = v >= 1000 && v <= 5000000 ? v : 0; if (!g.precio) delete g.precio; }
        else if (b.pagar.libre !== undefined) g.libre = !!b.pagar.libre;
        else { const d = Math.max(1, Math.min(400, parseInt(b.pagar.dias, 10) || 30)), desde = Math.max(Date.now(), Date.parse(g.pagoHasta || '') || 0); g.pagoHasta = new Date(desde + d * 864e5).toISOString(); }
        await guardarObj('menus/' + b.pagar.id + '.json', g); return res.status(200).json({ ok: true, cuenta: await cuenta(b.pagar.id, g) });
      }
      if (req.method === 'POST' && b.testi && okId(b.testi.id)) { // aprobar / ocultar una opinión
        const T = (await leerObj('menus/testimonios.json')) || { items: [] };
        T.items = (T.items || []).map(x => x.id === b.testi.id ? Object.assign(x, { ok: !!b.testi.ok }) : x).filter(x => !(x.id === b.testi.id && b.testi.borrar));
        await guardarObj('menus/testimonios.json', T); return res.status(200).json({ ok: true, testimonios: T.items });
      }
      if (req.method === 'POST' && Array.isArray(b.kitsCodes)) { // asigna kits impresos a un vendedor
        P.kits = P.kits || {}; const v = t(b.vend, 40);
        b.kitsCodes.slice(0, 60).map(c => String(c).toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(okKit).forEach(c => { if (v) P.kits[c] = v; else delete P.kits[c]; });
        await guardarObj('menus/pruebas.json', P); return res.status(200).json({ ok: true, kits: P.kits });
      }
      if (req.method === 'POST' && Array.isArray(b.items)) {
        P.items = b.items.slice(0, 300).map(x => ({ kit: t(x.kit, 10).toUpperCase().replace(/[^A-Z0-9]/g, ''), id: okId(x.id) ? x.id : '', local: t(x.local, 60), wa: t(x.wa, 30), desde: t(x.desde, 30) || new Date().toISOString(), estado: ['probando', 'contrato', 'devolver', 'devuelto'].includes(x.estado) ? x.estado : 'probando', nota: t(x.nota, 400), vend: t(x.vend, 40) }));
        await guardarObj('menus/pruebas.json', P);
      }
      const cuentas = {};
      for (const x of (P.items || []).filter(x => x.id).slice(0, 40)) { if (cuentas[x.id]) continue; const g = await leerObj('menus/' + x.id + '.json'); if (g) cuentas[x.id] = await cuenta(x.id, g); }
      const TT = (await leerObj('menus/testimonios.json')) || { items: [] };
      return res.status(200).json({ items: P.items || [], kits: P.kits || {}, cuentas, testimonios: TT.items || [] });
    }
    // kits activos en este café / desvincularlos (los cartelitos quedan libres para el próximo café)
    if ((req.method === 'GET' && q.id && q.kits) || (req.method === 'POST' && q.accion === 'kitquitar')) {
      const b = req.method === 'POST' ? cuerpo(req) : q, id = String(b.id || '');
      if (!okId(id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + id + '.json');
      if (!f || hash(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      const P = (await leerObj('menus/pruebas.json')) || { items: [] };
      const cand = [...new Set((P.items || []).filter(x => x.id === id && x.kit).map(x => x.kit))], activos = [];
      for (const k of cand) { const m = await leerObj('menus/kit-' + k + '.json'); if (m && m.id === id) activos.push(k); }
      if (req.method === 'GET') return res.status(200).json({ kits: activos });
      const quitar = b.kit ? activos.filter(k => k === String(b.kit).toUpperCase()) : activos;
      for (const k of quitar) await guardarObj('menus/kit-' + k + '.json', { id: '', libre: new Date().toISOString(), antes: id });
      try { P.items = (P.items || []).map(x => x.id === id && quitar.includes(x.kit) && x.estado === 'probando' ? Object.assign({}, x, { estado: 'devuelto' }) : x); await guardarObj('menus/pruebas.json', P); } catch (e) {}
      return res.status(200).json({ ok: true, quitados: quitar });
    }
    if (req.method === 'POST' && q.accion === 'kit') {
      const b = cuerpo(req), k = String(b.kit || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!okId(b.id) || !okKit(k)) return res.status(400).json({ error: 'Revisá el código del kit (está abajo en cada cartelito).' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || hash(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      await guardarObj('menus/kit-' + k + '.json', { id: b.id, desde: new Date().toISOString() });
      // lo anota solo en la lista de pruebas del vendedor (si el kit pasaba de otro café, ese queda como terminado)
      try {
        const P = (await leerObj('menus/pruebas.json')) || { items: [] }, ahora = new Date().toISOString();
        P.items = (P.items || []).map(x => x.kit === k && x.id !== b.id && x.estado === 'probando' ? Object.assign({}, x, { estado: 'devolver' }) : x);
        const ya = P.items.find(x => x.kit === k && x.id === b.id);
        if (ya) Object.assign(ya, { local: f.menu.nombre || ya.local, wa: ya.wa || f.menu.wa || '' });
        else P.items.unshift({ kit: k, id: b.id, local: f.menu.nombre || '', wa: f.menu.wa || '', desde: ahora, estado: 'probando', nota: '', vend: (P.kits || {})[k] || '' });
        P.items = P.items.slice(0, 300); await guardarObj('menus/pruebas.json', P);
      } catch (e) {}
      return res.status(200).json({ ok: true, kit: k });
    }
    // comprobante de pago de una mesa: solo con la clave de la caja
    if (req.method === 'GET' && q.comp) {
      const id = String(q.id || ''), cid = String(q.comp); if (!okId(id) || !/^[a-z0-9]{6,40}$/.test(cid)) return res.status(400).end();
      const f = await leerObj('menus/' + id + '.json');
      if (!f || hash(String(q.clave || '')) !== f.clave) return res.status(403).end();
      const C = await leerObj0('menus/comp/' + id + '-' + cid + '.json'); const m = C && String(C.img || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!m) return res.status(404).end();
      res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).send(Buffer.from(m[2], 'base64'));
    }
    // ---- 📮 Postal de recuerdo: el cliente la firma, se la lleva y (si el dueño la aprueba) queda en el muro del café ----
    const okImg = (x, max) => typeof x === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(x) && x.length < max;
    if (req.method === 'GET' && q.postalcfg) {
      const id = String(q.postalcfg); if (!okId(id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + id + '.json'); if (!f) return res.status(404).json({ error: 'No existe.' });
      const C = (await leerObj0('menus/' + id + '-postal.json')) || {};
      return res.status(200).json({ nombre: (f.menu && f.menu.nombre) || '', fondo: C.fondo === 'local' && f.menu && f.menu.fondoV ? 'local' : 'ciudad', ciudad: C.ciudad || 'Mar del Plata', dueno: C.dueno || '', firma: C.firma || '', muro: C.muro !== false && id !== PUB, fondoV: (f.menu && f.menu.fondoV) || '' });
    }
    if (req.method === 'POST' && q.accion === 'postalcfg') {
      const b = cuerpo(req);
      if (!okId(b.id) || b.id === PUB || b.id === BAL) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || hash(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      if (b.firma && !okImg(b.firma, 160000)) return res.status(400).json({ error: 'La firma es muy pesada. Probá de nuevo.' });
      await guardarObj0('menus/' + b.id + '-postal.json', { fondo: b.fondo === 'local' ? 'local' : 'ciudad', ciudad: t(b.ciudad, 40) || 'Mar del Plata', dueno: t(b.dueno, 40), firma: b.firma || '', muro: b.muro !== false });
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && q.accion === 'postal') {
      const b = cuerpo(req);
      if (!okId(b.id) || b.id === BAL) return res.status(400).json({ error: 'Menú inválido.' });
      if (b.id === PUB) return res.status(200).json({ ok: true, demo: true }); // en el café de muestra la postal solo se descarga
      if (!okImg(b.img, 900000)) return res.status(400).json({ error: 'La postal es muy pesada.' });
      const f = await leerObj('menus/' + b.id + '.json'); if (!f) return res.status(404).json({ error: 'No existe.' });
      const P = (await leerObj0('menus/' + b.id + '-postales.json')) || { items: [] };
      const hoy = new Date().toISOString().slice(0, 10);
      if ((P.items || []).filter(x => String(x.t).slice(0, 10) === hoy).length >= 120) return res.status(429).json({ error: 'Hoy ya se dejaron muchas postales.' });
      const pid = crypto.randomBytes(6).toString('hex');
      await guardarObj0('menus/' + b.id + '-postal-' + pid + '.json', { img: b.img });
      P.items = [{ id: pid, nombre: t(b.nombre, 30), msg: t(b.msg, 160), mesa: Math.max(0, Math.min(999, parseInt(b.mesa, 10) || 0)), t: new Date().toISOString(), ok: false }].concat(P.items || []).slice(0, 300);
      await guardarObj0('menus/' + b.id + '-postales.json', P);
      return res.status(200).json({ ok: true, pid });
    }
    if (req.method === 'GET' && q.id && q.postales) {
      if (!okId(q.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + q.id + '.json'); if (!f) return res.status(404).json({ error: 'No existe.' });
      const due = q.clave && hash(String(q.clave)) === f.clave;
      const P = (await leerObj0('menus/' + q.id + '-postales.json')) || { items: [] };
      return res.status(200).json({ items: (P.items || []).filter(x => due || x.ok).slice(0, due ? 120 : 40) });
    }
    if (req.method === 'GET' && q.postal && q.id) {
      const pid = String(q.postal); if (!okId(q.id) || !/^[a-f0-9]{12}$/.test(pid)) return res.status(400).end();
      const P = (await leerObj0('menus/' + q.id + '-postales.json')) || { items: [] }, it = (P.items || []).find(x => x.id === pid);
      if (!it) return res.status(404).end();
      if (!it.ok) { const f = await leerObj('menus/' + q.id + '.json'); if (!f || hash(String(q.clave || '')) !== f.clave) return res.status(403).end(); }
      const C = await leerObj0('menus/' + q.id + '-postal-' + pid + '.json'); const m = C && String(C.img || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!m) return res.status(404).end();
      res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', it.ok ? 'public, max-age=86400' : 'private, max-age=600');
      return res.status(200).send(Buffer.from(m[2], 'base64'));
    }
    if (req.method === 'POST' && q.accion === 'postalok') {
      const b = cuerpo(req);
      if (!okId(b.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || hash(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      const P = (await leerObj0('menus/' + b.id + '-postales.json')) || { items: [] };
      if (b.borrar) P.items = (P.items || []).filter(x => x.id !== b.pid); else (P.items || []).forEach(x => { if (x.id === b.pid) x.ok = !!b.ok; });
      await guardarObj0('menus/' + b.id + '-postales.json', P);
      return res.status(200).json({ ok: true });
    }
    // foto de fondo del local (se guarda aparte para que el menú siga liviano)
    if (req.method === 'GET' && q.fondo) {
      const id = String(q.fondo); if (!okId(id)) return res.status(400).end();
      const F = await leerObj('menus/' + id + '-fondo.json'); const m = F && String(F.img || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!m) return res.status(404).end();
      res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(Buffer.from(m[2], 'base64'));
    }
    if (req.method === 'POST' && q.accion === 'fondo') {
      const b = cuerpo(req);
      if (!okId(b.id) || b.id === PUB || b.id === BAL) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || hash(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      if (b.img === null) { f.menu.fondoCaja = !!b.caja; await guardarObj('menus/' + b.id + '.json', f); return res.status(200).json({ ok: true, fondoV: f.menu.fondoV || '', fondoCaja: !!f.menu.fondoCaja }); }
      const img = String(b.img || '');
      if (img && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img) || img.length > 600000)) return res.status(400).json({ error: 'La foto es muy pesada o no es una imagen.' });
      await guardarObj('menus/' + b.id + '-fondo.json', { img });
      f.menu.fondoV = img ? String(Date.now()) : ''; if (b.caja !== undefined) f.menu.fondoCaja = !!b.caja;
      await guardarObj('menus/' + b.id + '.json', f);
      return res.status(200).json({ ok: true, fondoV: f.menu.fondoV, fondoCaja: !!f.menu.fondoCaja });
    }
    // ícono propio de cada café (SVG): su logo, o sus iniciales, sobre fondo violeta. tipo=caja le agrega la etiqueta CAJA
    if (req.method === 'GET' && q.icono) {
      const id = String(q.icono); if (!okId(id)) return res.status(400).end();
      const f = await leerObj('menus/' + id + '.json'); const m = (f && f.menu) || {}, nom = String(m.nombre || 'Menú');
      const ini = nom.replace(/^(caf[eé]|bar|resto|restaurante|el|la|los|las)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase().replace(/[<>&"']/g, '') || '🍽';
      const caja = q.tipo === 'caja';
      const centro = m.logo ? `<rect x="64" y="64" width="384" height="384" rx="70" fill="#fff"/><image href="${m.logo}" x="84" y="84" width="344" height="344" preserveAspectRatio="xMidYMid meet"/>`
        : `<circle cx="256" cy="246" r="170" fill="#fff" opacity=".96"/><text x="256" y="${ini.length > 1 ? 300 : 310}" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="${ini.length > 1 ? 150 : 180}" fill="#6d28d9">${ini}</text>`;
      const badge = caja ? `<rect x="136" y="404" width="240" height="78" rx="39" fill="#22c55e"/><text x="256" y="458" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="46" fill="#fff">CAJA</text>` : '';
      res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs><rect width="512" height="512" rx="110" fill="url(#g)"/>${centro}${badge}</svg>`);
    }
    // manifest para instalar el menú de un café como app en el celular
    if (req.method === 'GET' && q.manifest) {
      const id = String(q.manifest); if (!okId(id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + id + '.json'); const nom = (f && f.menu && f.menu.nombre) || 'Menú';
      if (q.caja && f && q.e && hash(String(q.e)) === f.clave) { // la caja del dueño como app en su compu
        const su = '/menu?m=' + id + '&e=' + encodeURIComponent(q.e) + '&caja=1';
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8'); res.setHeader('Cache-Control', 'private, max-age=600');
        return res.status(200).send(JSON.stringify({ name: 'Caja · ' + nom, short_name: ('Caja ' + nom).slice(0, 14), id: '/menu?m=' + id + '&caja=1', start_url: su, scope: '/', display: 'standalone', background_color: '#faf8ff', theme_color: '#7c3aed', lang: 'es',
          icons: [{ src: '/api/menu?icono=' + id + '&tipo=caja', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icons/menu-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icons/menu-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }] }));
      }
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).send(JSON.stringify({ name: nom + ' · Pedí acá', short_name: nom.slice(0, 14), id: '/menu?m=' + id + '&app=1', start_url: '/menu?m=' + id + '&app=1', scope: '/', display: 'standalone', orientation: 'portrait', background_color: '#faf8ff', theme_color: '#7c3aed', lang: 'es',
        icons: [{ src: '/api/menu?icono=' + id, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }, { src: '/icons/menu-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icons/menu-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icons/menu-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }] }));
    }
    if (req.method === 'GET' && q.id && q.caja) {
      if (!okId(q.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + q.id + '.json');
      if (!f || hash(String(q.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      const L = (await leerObj(pedPath(q.id))) || { items: [] };
      const cu = await cuenta(q.id, f);
      if (q.id === PUB || q.id === BAL) L.items = (L.items || []).filter(it => Date.now() - Date.parse(it.creado) < 3 * 3600e3);
      return res.status(200).json({ fondo: f.menu.fondoCaja && f.menu.fondoV ? f.menu.fondoV : '', lugar: f.menu.lugar || 'mesa', cuenta: cu, greview: !!f.menu.greview, items: (L.items || []).map(x => Object.assign({}, x, { k: undefined })), nombre: f.menu.nombre, mozos: f.menu.mozos || [], dueno: f.menu.dueno || '', cajaAva: f.menu.cajaAva || 'flashi', asistente: f.menu.asistente || 'Lola', avatar: f.menu.avatar || '', pelo: f.menu.pelo || '', largo: f.menu.largo || '', piel: f.menu.piel || '', barba: !!f.menu.barba });
    }
    // ---- Opiniones de los dueños sobre ShopMenu (para mostrar en la página de venta, solo las aprobadas) ----
    if (req.method === 'GET' && q.testimonios) {
      const T = (await leerObj('menus/testimonios.json')) || { items: [] };
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).json({ items: (T.items || []).filter(x => x.ok && x.publicar).map(x => ({ local: x.local, nombre: x.nombre, cargo: x.cargo, e: x.e, texto: x.texto, fecha: x.fecha })) });
    }
    if (req.method === 'POST' && q.accion === 'testimonio') {
      const b = cuerpo(req);
      if (!okId(b.id) || b.id === PUB || b.id === BAL) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || hash(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      const e = parseInt(b.e, 10); if (!(e >= 1 && e <= 5)) return res.status(400).json({ error: 'Elegí de 1 a 5 estrellas.' });
      const T = (await leerObj('menus/testimonios.json')) || { items: [] };
      T.items = [{ id: b.id, local: f.menu.nombre || '', nombre: t(b.nombre, 40), cargo: t(b.cargo, 40), e, texto: t(b.texto, 500), publicar: !!b.publicar, fecha: new Date().toISOString(), ok: false }].concat((T.items || []).filter(x => x.id !== b.id)).slice(0, 300);
      await guardarObj('menus/testimonios.json', T);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'POST' && q.accion === 'suscribir') {
      const b = cuerpo(req);
      if (!okId(b.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || hash(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ error: 'El cobro todavía no está configurado.' });
      const email = String(b.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Revisá el mail de Mercado Pago.' });
      const conPromo = promoVigente(f);
      const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
      try {
        const pre = await mp('POST', '/preapproval', { reason: 'ShopMenu · ' + (f.menu.nombre || 'Menú QR'), external_reference: 'menu:' + b.id, payer_email: email, back_url: origin + '/menu?pagado=1', status: 'pending',
          auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: conPromo ? PROMO() : (f.precio || PRECIO()), currency_id: 'ARS' } });
        f.mpSus = pre.id; f.promo1 = conPromo; f.mpEmail = email; f.mpCheck = ''; await guardarObj('menus/' + b.id + '.json', f);
        return res.status(200).json({ url: pre.init_point });
      } catch (e) {
        console.error('shopmenu suscribir', e.status || '', e.message, e.body ? JSON.stringify(e.body).slice(0, 400) : '');
        return res.status(502).json({ error: (e.status === 400 || e.status === 422 ? 'Mercado Pago rechazó el pedido: revisá que el mail sea el de tu cuenta de Mercado Pago.' : 'No se pudo conectar con Mercado Pago. Probá en un rato.') + ' [' + (e.status || 'error') + ': ' + String(e.message || '').slice(0, 120) + ']' });
      }
    }
    if (req.method === 'POST' && (q.accion === 'pedido' || q.accion === 'aviso')) {
      const b = cuerpo(req);
      if (!okId(b.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || !f.menu) return res.status(404).json({ error: 'No encontramos este menú.' });
      if ((await cuenta(b.id, f)).estado === 'vencido') return res.status(402).json({ error: 'Este menú está en pausa. Pedile al mozo.' });
      const mesa = Math.max(0, Math.min(500, parseInt(b.mesa, 10) || 0)), nombre = t(b.nombre, 30);
      const L = (await leerObj(pedPath(b.id))) || { items: [], n: 0 };
      const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
      if (L.dia !== dia) { L.dia = dia; L.n = 0; }
      const base0 = { id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), k: crypto.randomBytes(8).toString('hex'), mesa, nombre, creado: new Date().toISOString() };
      let nuevo;
      if (q.accion === 'aviso') {
        const lang = LANGS.includes(b.lang) && b.lang !== 'es' ? b.lang : '';
        nuevo = Object.assign(base0, { lang, tipo: ['cuenta', 'pago', 'consulta'].includes(b.tipo) ? b.tipo : 'mozo', monto: t(b.monto, 20), pedido_n: parseInt(b.pedido_n, 10) || null, texto: t(b.texto, 300), metodo: ['virtual', 'efectivo', 'caja', 'tarjeta', 'app'].includes(b.metodo) ? b.metodo : '', detalle: t(b.detalle, 30), propina: t(b.propina, 40), estado: 'nuevo' });
        if (lang && nuevo.texto) { const es = await traducirTexto(nuevo.texto, 'es'); if (es) { nuevo.orig = nuevo.texto; nuevo.texto = es; } }
        // comprobante del pago (captura de pantalla) que manda la mesa: se guarda aparte y solo lo ve la caja
        const comp = String(b.comp || '');
        if (nuevo.tipo === 'pago' && comp) {
          if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(comp) || comp.length > 900000) return res.status(400).json({ error: 'El comprobante es muy pesado o no es una imagen.' });
          await guardarObj0('menus/comp/' + b.id + '-' + nuevo.id + '.json', { img: comp }); nuevo.comp = 1;
        }
      } else {
        const valid = {}; (f.menu.cats || []).forEach(c => (c.items || []).forEach(i => { valid[i.n] = i.p; }));
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map(i => ({ n: t(i && i.n, 90), q: Math.max(1, Math.min(99, parseInt(i && i.q, 10) || 1)) })).filter(i => valid[i.n] !== undefined).map(i => Object.assign(i, { p: valid[i.n] }));
        if (!items.length) return res.status(400).json({ error: 'El pedido está vacío.' });
        L.n = (L.n || 0) + 1;
        const lv = b.llevar && ['llevar', 'llego', 'envio'].includes(b.llevar.tipo) ? { tipo: b.llevar.tipo, min: Math.max(0, Math.min(120, parseInt(b.llevar.min, 10) || 0)), dir: t(b.llevar.dir, 120) } : null;
        if (lv && lv.tipo === 'llego') lv.llega = new Date(Date.now() + lv.min * 60e3).toISOString();
        nuevo = Object.assign(base0, { tipo: 'pedido', n: L.n, items, nota: t(b.nota, 200), estado: 'nuevo' }, lv ? { llevar: lv } : {});
        // cliente: lo reconoce por el código que guarda su celular → nuevo o fijo
        const cid = /^[a-z0-9]{8,24}$/.test(String(b.cid || '')) ? String(b.cid) : '';
        if (cid) { try {
          const C = (await leerObj('menus/' + b.id + '-clientes.json')) || { c: {} }, ahora = new Date().toISOString(), c0 = C.c[cid] || { n: 0, primera: ahora };
          c0.n = (c0.n || 0) + 1; c0.ultima = ahora; if (nombre) c0.nombre = nombre; c0.modo = nuevo.llevar ? nuevo.llevar.tipo : 'mesa'; if (nuevo.llevar && nuevo.llevar.dir) c0.dir = nuevo.llevar.dir; if (mesa) c0.mesa = mesa;
          c0.ult = items.slice(0, 6).map(x => x.q + ' ' + x.n).join(', ');
          C.c[cid] = c0; const ks = Object.keys(C.c); if (ks.length > 1500) ks.sort((x, y) => String(C.c[x].ultima).localeCompare(String(C.c[y].ultima))).slice(0, ks.length - 1500).forEach(k => delete C.c[k]);
          await guardarObj('menus/' + b.id + '-clientes.json', C); nuevo.cli = { n: c0.n };
        } catch (e) {} }
      }
      L.items = [nuevo].concat((L.items || []).filter(x => Date.now() - Date.parse(x.creado) < 2 * 864e5)).slice(0, 150);
      await guardarObj(pedPath(b.id), L);
      return res.status(200).json({ ok: true, pid: nuevo.id, k: nuevo.k, n: nuevo.n || null });
    }
    // ---- Reseñas: solo quien hizo un pedido (pid + k), una por pedido ----
    if (req.method === 'POST' && q.accion === 'resena') {
      const b = cuerpo(req);
      if (!okId(b.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const e = parseInt(b.e, 10); if (!(e >= 1 && e <= 5)) return res.status(400).json({ error: 'Elegí de 1 a 5 estrellas.' });
      const L = (await leerObj(pedPath(b.id))) || { items: [] };
      const p = (L.items || []).find(x => x.id === String(b.pid || '') && x.tipo === 'pedido');
      if (!p || p.k !== String(b.k || '')) return res.status(404).json({ error: 'No encontramos tu pedido.' });
      if (p.resena) return res.status(409).json({ error: 'Ya dejaste tu opinión. ¡Gracias!' });
      p.resena = e; await guardarObj(pedPath(b.id), L);
      const R = (await leerObj('menus/' + b.id + '-resenas.json')) || { items: [] };
      R.items = [{ e, tx: t(b.tx, 300), nombre: t(b.nombre, 30) || 'Cliente', mesa: p.mesa, f: new Date().toISOString() }].concat(R.items || []).slice(0, 300);
      await guardarObj('menus/' + b.id + '-resenas.json', R);
      return res.status(200).json({ ok: true });
    }
    if (req.method === 'GET' && q.id && q.clientes) {
      if (!okId(q.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + q.id + '.json');
      if (!f || hash(String(q.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      const C = (await leerObj('menus/' + q.id + '-clientes.json')) || { c: {} };
      const items = Object.values(C.c).sort((x, y) => String(y.ultima).localeCompare(String(x.ultima))).slice(0, 300).map(x => ({ nombre: x.nombre || '', n: x.n, primera: x.primera, ultima: x.ultima, modo: x.modo, dir: x.dir || '', mesa: x.mesa || 0, ult: x.ult || '' }));
      return res.status(200).json({ items });
    }
    // opiniones públicas: las ve cualquier cliente en el menú del local (el dueño las puede ocultar)
    if (req.method === 'GET' && q.id && q.opiniones) {
      if (!okId(q.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + q.id + '.json');
      if (!f || (f.menu && f.menu.opiPub === false)) return res.status(200).json({ n: 0, items: [] });
      const R = (await leerObj('menus/' + q.id + '-resenas.json')) || { items: [] }, L = R.items || [], n = L.length;
      return res.status(200).json({ n, prom: n ? Math.round(L.reduce((a, x) => a + x.e, 0) / n * 10) / 10 : 0, items: L.filter(x => x.tx).slice(0, 12).map(x => ({ e: x.e, tx: x.tx, nombre: String(x.nombre || 'Cliente').split(' ')[0], f: x.f })) });
    }
    if (req.method === 'GET' && q.id && q.resenas) {
      if (!okId(q.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + q.id + '.json');
      if (!f || hash(String(q.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      const R = (await leerObj('menus/' + q.id + '-resenas.json')) || { items: [] }, n = (R.items || []).length;
      return res.status(200).json({ n, prom: n ? Math.round(R.items.reduce((a, x) => a + x.e, 0) / n * 10) / 10 : 0, items: (R.items || []).slice(0, 30) });
    }
    if (req.method === 'POST' && q.accion === 'estado') {
      const b = cuerpo(req);
      if (!okId(b.id) || !ESTADOS.includes(b.estado)) return res.status(400).json({ error: 'Datos inválidos.' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || hash(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      const L = (await leerObj(pedPath(b.id))) || { items: [] };
      const p = (L.items || []).find(x => x.id === String(b.pid || ''));
      if (!p) return res.status(404).json({ error: 'No encontramos ese pedido.' });
      p.estado = b.estado; p.cambiado = new Date().toISOString(); if (typeof b.rta === 'string' && b.rta.trim()) { p.rta = t(b.rta.trim(), 300); p.rtaEs = p.rta; if (p.lang) { const tr = await traducirTexto(p.rta, p.lang); if (tr) p.rta = tr; } } if (typeof b.mozo === 'string' && b.mozo.trim()) p.mozo = t(b.mozo.trim(), 20);
      await guardarObj(pedPath(b.id), L);
      return res.status(200).json({ ok: true });
    }

    // textos de la moza en los idiomas extra (fr, it, de, ru, zh): se traducen una sola vez y quedan guardados
    if (req.method === 'GET' && q.ui) {
      const L = String(q.ui); if (!LANGS.includes(L) || ['es', 'en', 'pt'].includes(L)) return res.status(400).json({ error: 'Idioma inválido.' });
      const base = require('./menu-ui.json'), path = 'menus/ui-' + L + '.json', D = (await leerObj0(path)) || {};
      const faltan = base.filter(x => !D[x]);
      for (let k = 0; k < faltan.length; k += 60) {
        const lote = faltan.slice(k, k + 60);
        try { const text = await IA(`Traducí al ${IDI[L]} estos textos de la moza virtual de un café (la app con la que el cliente pide desde la mesa). Tono cálido y natural, como una moza amable. Mantené emojis, etiquetas HTML como <b>, comillas y espacios al principio o al final exactamente igual. Respondé SOLO con un JSON array de strings, en el mismo orden y la misma cantidad.\n${JSON.stringify(lote)}`, 8000);
          const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
          if (Array.isArray(arr) && arr.length === lote.length) lote.forEach((x, i) => { if (typeof arr[i] === 'string' && arr[i].trim()) D[x] = arr[i]; });
        } catch (e) {}
      }
      if (faltan.length) { try { await guardarObj0(path, D); } catch (e) {} }
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.status(200).json({ d: D });
    }
    // traduce una frase corta de la moza o del cliente (idiomas extra). Solo para menús que existen.
    if (req.method === 'POST' && q.accion === 'trad') {
      const b = cuerpo(req), to = String(b.to || ''), txt = t(b.texto, 500).trim();
      if (!okId(b.id) || !LANGS.includes(to) || !txt) return res.status(400).json({ error: 'Datos inválidos.' });
      if (!(await leerObj('menus/' + b.id + '.json'))) return res.status(404).json({ error: 'No encontramos este menú.' });
      return res.status(200).json({ texto: (await traducirTexto(txt, to)) || '' });
    }
    if (req.method === 'GET' && q.id) {
      const id = String(q.id);
      if (!/^[a-z0-9]{6,20}$/.test(id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + id + '.json');
      if (!f || !f.menu) return res.status(404).json({ error: 'No encontramos este menú.' });
      if (q.clave) { if (hash(String(q.clave)) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' }); return res.status(200).json({ menu: f.menu, edita: true }); }
      const c = await cuenta(id, f);
      const L = String(q.lang || '');
      if (LANGS.includes(L) && L !== (f.menu.idioma || 'es') && !(f.menu.tr && f.menu.tr[L]) && f.menu.cats && f.menu.cats.length) {
        const real = id === PUB ? PUB_BASE : id, f0 = id === PUB ? await leerObj0('menus/' + PUB_BASE + '.json') : f;
        const tr = f0 && f0.menu ? await traducir(f0.menu, f0.menu.tr, [L]) : null;
        if (tr && tr[L]) { const f1 = (await leerObj0('menus/' + real + '.json')) || f0; f1.menu.tr = Object.assign({}, f1.menu.tr || {}, { [L]: tr[L] }); f.menu.tr = Object.assign({}, f.menu.tr || {}, f1.menu.tr); try { await guardarObj0('menus/' + real + '.json', f1); } catch (e) {} }
      }
      return res.status(200).json({ menu: f.menu, pausado: c.estado === 'vencido' });
    }

    if (req.method === 'POST' && q.accion === 'guardar') {
      const b = cuerpo(req), menu = limpiar(b.menu);
      if (!menu.cats.length) return res.status(400).json({ error: 'El menú está vacío.' });
      let id = String(b.id || ''), clave = String(b.clave || '');
      // traducción: solo si cambió el texto de la carta (así no se paga de nuevo por cambiar un precio)
      const firma = crypto.createHash('sha1').update(JSON.stringify([menu.idioma, menu.saludo, menu.cats.map(c => [c.n, c.items.map(i => [i.n, i.d])])])).digest('hex');
      let prev = null;
      if (id) {
        if (!/^[a-z0-9]{6,20}$/.test(id)) return res.status(400).json({ error: 'Menú inválido.' });
        if (id === PUB || id === BAL) return res.status(403).json({ error: 'El café de prueba no se puede editar.' });
        prev = await leerObj('menus/' + id + '.json');
        if (!prev || hash(clave) !== prev.clave) return res.status(403).json({ error: 'No tenés permiso para editar este menú.' });
      }
      { const tr = await traducir(menu, prev && prev.firma === firma && prev.menu ? prev.menu.tr : null); if (tr) menu.tr = tr; }
      if (prev) {
        await guardarObj('menus/' + id + '.json', Object.assign(prev, { menu, firma, cambiado: new Date().toISOString() }));
      } else {
        id = crypto.randomBytes(6).toString('hex').replace(/[^a-z0-9]/g, '').slice(0, 10);
        clave = crypto.randomBytes(9).toString('hex');
        await guardarObj('menus/' + id + '.json', { clave: hash(clave), menu, firma, creado: new Date().toISOString() });
      }
      return res.status(200).json({ ok: true, id, clave, idiomas: ['es'].concat(Object.keys(menu.tr || {})) });
    }

    if (req.method === 'POST' && q.accion === 'leer') {
      const KEY = process.env.ANTHROPIC_API_KEY;
      if (!KEY) return res.status(503).json({ error: 'La IA todavía no está configurada.' });
      const b = cuerpo(req), imgs = Array.isArray(b.images) ? b.images.slice(0, 5) : [];
      if (!imgs.length) return res.status(400).json({ error: 'Subí al menos una foto de la carta.' });
      for (const im of imgs) if (!im || typeof im.data !== 'string' || im.data.length < 1000 || im.data.length > 4500000) return res.status(400).json({ error: 'Una de las fotos no se pudo leer o es muy pesada.' });
      // topes: lecturas por persona por día y lecturas totales por día
      const porDia = Math.max(1, Number(process.env.MENU_POR_DIA || 6)), tope = Math.max(1, Number(process.env.MENU_TOPE_DIA || 100));
      const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), path = 'menu-uso/' + dia + '.json';
      const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
      const quien = crypto.createHash('sha256').update('ip|' + ip).digest('hex').slice(0, 16);
      const uso = (await leerObj(path)) || { total: 0, ip: {} }; uso.ip = uso.ip || {};
      if ((uso.total || 0) >= tope) return res.status(429).json({ error: 'Hoy ya se leyeron muchas cartas. Probá de nuevo mañana.' });
      if ((uso.ip[quien] || 0) >= porDia) return res.status(429).json({ error: `Ya leíste ${porDia} cartas hoy. Mañana podés leer más; mientras, podés editar a mano.` });
      const content = imgs.map(im => ({ type: 'image', source: { type: 'base64', media_type: TYPES.includes(im.type) ? im.type : 'image/jpeg', data: im.data } }));
      content.push({ type: 'text', text: `Estas fotos son la carta (menú) de un restaurante, bar, café o casa de comidas. Puede venir en varias fotos: juntá todo en un solo menú, sin repetir platos.
Transcribí TODO lo que dice, plato por plato, respetando las secciones de la carta (por ejemplo Entradas, Pizzas, Bebidas, Postres, Promociones).
Copiá los nombres y los precios exactamente como están escritos (por ejemplo "$12.500"). Si un plato tiene descripción o ingredientes, ponelos en "d". Si un precio no se lee, dejalo vacío. NO inventes platos ni precios.
Si una sección es de promociones, menú del día o sugerencias, marcá esos platos con "promo": true.
Si no es una carta de comidas, devolvé {"error":"…"} en una frase corta.
Respondé SOLO con JSON válido, así:
{"nombre":"nombre del local si aparece, o vacío","cats":[{"n":"nombre de la sección","items":[{"n":"plato","d":"descripción","p":"$0","promo":false}]}]}` });
      const model = process.env.IA_MODEL_VISION || 'claude-opus-5-5';
      const ask = () => fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 12000, messages: [{ role: 'user', content }] }) });
      let r = await ask(), j = await r.json().catch(() => ({}));
      for (let k = 0; k < 2 && !r.ok && [429, 500, 502, 503, 529].includes(r.status); k++) { await new Promise(ok => setTimeout(ok, 1500 * (k + 1))); r = await ask(); j = await r.json().catch(() => ({})); }
      if (!r.ok) { const msg = String((j.error && j.error.message) || ''); return res.status(/credit|billing/i.test(msg) ? 402 : 502).json({ error: /credit|billing/i.test(msg) ? 'La IA se quedó sin saldo.' : 'La IA no pudo leer la carta ahora. Probá en un rato.' }); }
      const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
      let out = null; try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) {}
      if (!out) return res.status(502).json({ error: 'No pudimos leer la carta. Probá con fotos más nítidas, de frente y con buena luz.' });
      if (out.error) return res.status(422).json({ error: t(out.error, 200) });
      uso.total = (uso.total || 0) + 1; uso.ip[quien] = (uso.ip[quien] || 0) + 1; await guardarObj(path, uso);
      const m = limpiar({ nombre: out.nombre, cats: out.cats });
      return res.status(200).json({ menu: { nombre: m.nombre, cats: m.cats } });
    }

    return res.status(405).json({ error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({ error: 'No se pudo procesar el menú.' });
  }
};
