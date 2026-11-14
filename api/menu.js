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
const { cuerpo } = require('./_comun');

const BUCKET = 'pedidos';
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1';
const head = extra => { const k = process.env.SUPABASE_SERVICE_KEY, h = Object.assign({ apikey: k }, extra || {}); if (String(k).startsWith('eyJ')) h.Authorization = 'Bearer ' + k; return h; };
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const t = (v, n) => String(v == null ? '' : v).slice(0, n);
const hash = s => crypto.createHash('sha256').update('shopmenu|' + s).digest('hex');
async function leerObj(path) { const r = await fetch(base() + '/object/' + BUCKET + '/' + path, { headers: head() }); return r.ok ? r.json().catch(() => null) : null; }
async function guardarObj(path, obj) { await fetch(base() + '/object/' + BUCKET + '/' + path, { method: 'POST', headers: head({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) }); }

// deja el menú limpio y con tamaños razonables
function limpiar(m) {
  m = m || {};
  const cats = (Array.isArray(m.cats) ? m.cats : []).slice(0, 40).map(c => ({ n: t(c && c.n, 60),
    items: (Array.isArray(c && c.items) ? c.items : []).slice(0, 80).map(i => ({ n: t(i && i.n, 90), d: t(i && i.d, 240), p: t(i && i.p, 30), promo: !!(i && i.promo) })).filter(i => i.n) })).filter(c => c.n || c.items.length);
  return { nombre: t(m.nombre, 60), wa: t(m.wa, 20).replace(/[^\d+]/g, ''), mesas: Math.max(1, Math.min(200, parseInt(m.mesas, 10) || 10)), asistente: t(m.asistente, 20) || 'Lola', avatar: ['moza', 'mozo'].includes(m.avatar) ? m.avatar : '', pelo: ['castano', 'rubio', 'negro', 'colorado', 'canoso'].includes(m.pelo) ? m.pelo : '', largo: m.largo === 'corto' ? 'corto' : 'largo', piel: ['clara', 'media', 'morena', 'oscura'].includes(m.piel) ? m.piel : '', barba: !!m.barba,
    saludo: t(m.saludo, 200), moneda: t(m.moneda, 4) || '$', alias: t(m.alias, 60), dueno: t(m.dueno, 30), cajaAva: ['flashi', 'robot', 'gatito', 'igual'].includes(m.cajaAva) ? m.cajaAva : 'flashi', greview: /^https:\/\//i.test(String(m.greview || '')) ? t(m.greview, 300) : '', mozos: (Array.isArray(m.mozos) ? m.mozos : String(m.mozos || '').split(',')).map(x => t(String(x).trim(), 20)).filter(Boolean).slice(0, 12), demora: Math.max(0, Math.min(120, parseInt(m.demora, 10) || 0)), paylink: /^https:\/\//i.test(String(m.paylink || '')) ? t(m.paylink, 300) : '', ig: t(m.ig, 60).replace(/[^\w.@/:\-]/g, ''), fb: t(m.fb, 200).replace(/[\s<>"']/g, ''), tt: t(m.tt, 60).replace(/[^\w.@/:\-]/g, ''), web: /^https:\/\//i.test(String(m.web || '')) ? t(m.web, 300) : '', tienda: /^https:\/\//i.test(String(m.tienda || '')) ? t(m.tienda, 300) : '', tiendaTx: t(m.tiendaTx, 40), nov: t(m.nov, 300), links: (Array.isArray(m.links) ? m.links : []).slice(0, 10).map(x => ({ t: t(x && x.t, 12).replace(/[^a-z]/g, ''), u: t(x && x.u, 300).replace(/[\s<>"']/g, ''), l: t(x && x.l, 40) })).filter(x => x.u && (/^https:\/\//i.test(x.u) || /^(ig|fb|tt|wa|yt)$/.test(x.t))), cats };
}


// Traduce la carta al inglés y al portugués (para turistas). Barato: modelo de texto. Si falla, el menú queda en castellano.
async function traducir(menu) {
  const KEY = process.env.ANTHROPIC_API_KEY; if (!KEY) return null;
  const src = { saludo: menu.saludo || '', cats: menu.cats.map(c => ({ n: c.n, items: c.items.map(i => ({ n: i.n, d: i.d })) })) };
  const prompt = `Traducí esta carta de restaurante al inglés ("en") y al portugués de Brasil ("pt"). Mantené EXACTAMENTE la misma estructura, el mismo orden y la misma cantidad de secciones y platos. Nombres propios o de marca y platos típicos argentinos (por ejemplo "medialuna", "milanesa", "choripán") dejalos en su nombre original y agregá entre paréntesis una explicación muy corta. Respondé SOLO con JSON: {"en":{"saludo":"","cats":[{"n":"","items":[{"n":"","d":""}]}]},"pt":{...}}
${JSON.stringify(src)}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.IA_MODEL_TEXT || 'claude-haiku-5-5', max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }) });
    if (!r.ok) return null;
    const j = await r.json(), text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    const tr = {};
    for (const L of ['en', 'pt']) {
      const x = out && out[L]; if (!x || !Array.isArray(x.cats) || x.cats.length !== menu.cats.length) continue;
      const ok = x.cats.every((c, k) => c && Array.isArray(c.items) && c.items.length === menu.cats[k].items.length);
      if (!ok) continue;
      tr[L] = { saludo: t(x.saludo, 200), cats: x.cats.map(c => ({ n: t(c.n, 60), items: c.items.map(i => ({ n: t(i && i.n, 90), d: t(i && i.d, 240) })) })) };
    }
    return Object.keys(tr).length ? tr : null;
  } catch (e) { return null; }
}

module.exports = async (req, res) => {
  try {
    const q = req.query || {};
    if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'ShopMenu no está configurado.' });

    // ---- Pedidos y avisos de las mesas ----
    const ESTADOS = ['nuevo', 'preparando', 'listo', 'entregado', 'cancelado', 'visto', 'respondido'];
    const pedPath = id => 'menus/' + id + '-pedidos.json';
    const okId = id => /^[a-z0-9]{6,20}$/.test(String(id || ''));
    if (req.method === 'GET' && q.id && q.pedido) {
      if (!okId(q.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const L = (await leerObj(pedPath(q.id))) || { items: [] };
      const p = (L.items || []).find(x => x.id === String(q.pedido));
      if (!p || p.k !== String(q.k || '')) return res.status(404).json({ error: 'No encontramos ese pedido.' });
      return res.status(200).json({ estado: p.estado, n: p.n, rta: p.rta || '', mozo: p.mozo || '' });
    }
    // ---- Kit de prueba: cartelitos QR genéricos (sin nombre de local) que se activan para el café que está probando ----
    const okKit = k => /^[A-Z0-9]{4,10}$/.test(String(k || ''));
    if (req.method === 'GET' && q.kit) {
      const k = String(q.kit).toUpperCase(); if (!okKit(k)) return res.status(400).json({ error: 'Código de kit inválido.' });
      const m = await leerObj('menus/kit-' + k + '.json');
      return m && m.id ? res.status(200).json({ id: m.id }) : res.status(404).json({ error: 'Kit sin activar.' });
    }
    if (req.method === 'POST' && q.accion === 'kit') {
      const b = cuerpo(req), k = String(b.kit || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!okId(b.id) || !okKit(k)) return res.status(400).json({ error: 'Revisá el código del kit (está abajo en cada cartelito).' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || hash(String(b.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      await guardarObj('menus/kit-' + k + '.json', { id: b.id, desde: new Date().toISOString() });
      return res.status(200).json({ ok: true, kit: k });
    }
    if (req.method === 'GET' && q.id && q.caja) {
      if (!okId(q.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + q.id + '.json');
      if (!f || hash(String(q.clave || '')) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' });
      const L = (await leerObj(pedPath(q.id))) || { items: [] };
      return res.status(200).json({ items: (L.items || []).map(x => Object.assign({}, x, { k: undefined })), nombre: f.menu.nombre, mozos: f.menu.mozos || [], dueno: f.menu.dueno || '', cajaAva: f.menu.cajaAva || 'flashi', asistente: f.menu.asistente || 'Lola', avatar: f.menu.avatar || '', pelo: f.menu.pelo || '', largo: f.menu.largo || '', piel: f.menu.piel || '', barba: !!f.menu.barba });
    }
    if (req.method === 'POST' && (q.accion === 'pedido' || q.accion === 'aviso')) {
      const b = cuerpo(req);
      if (!okId(b.id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + b.id + '.json');
      if (!f || !f.menu) return res.status(404).json({ error: 'No encontramos este menú.' });
      const mesa = Math.max(0, Math.min(500, parseInt(b.mesa, 10) || 0)), nombre = t(b.nombre, 30);
      const L = (await leerObj(pedPath(b.id))) || { items: [], n: 0 };
      const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
      if (L.dia !== dia) { L.dia = dia; L.n = 0; }
      const base0 = { id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), k: crypto.randomBytes(8).toString('hex'), mesa, nombre, creado: new Date().toISOString() };
      let nuevo;
      if (q.accion === 'aviso') {
        nuevo = Object.assign(base0, { tipo: ['cuenta', 'pago', 'consulta'].includes(b.tipo) ? b.tipo : 'mozo', monto: t(b.monto, 20), pedido_n: parseInt(b.pedido_n, 10) || null, texto: t(b.texto, 300), metodo: ['virtual', 'efectivo', 'caja'].includes(b.metodo) ? b.metodo : '', propina: t(b.propina, 40), estado: 'nuevo' });
      } else {
        const valid = {}; (f.menu.cats || []).forEach(c => (c.items || []).forEach(i => { valid[i.n] = i.p; }));
        const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map(i => ({ n: t(i && i.n, 90), q: Math.max(1, Math.min(99, parseInt(i && i.q, 10) || 1)) })).filter(i => valid[i.n] !== undefined).map(i => Object.assign(i, { p: valid[i.n] }));
        if (!items.length) return res.status(400).json({ error: 'El pedido está vacío.' });
        L.n = (L.n || 0) + 1;
        nuevo = Object.assign(base0, { tipo: 'pedido', n: L.n, items, nota: t(b.nota, 200), estado: 'nuevo' });
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
      p.estado = b.estado; p.cambiado = new Date().toISOString(); if (typeof b.rta === 'string' && b.rta.trim()) p.rta = t(b.rta.trim(), 300); if (typeof b.mozo === 'string' && b.mozo.trim()) p.mozo = t(b.mozo.trim(), 20);
      await guardarObj(pedPath(b.id), L);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET' && q.id) {
      const id = String(q.id);
      if (!/^[a-z0-9]{6,20}$/.test(id)) return res.status(400).json({ error: 'Menú inválido.' });
      const f = await leerObj('menus/' + id + '.json');
      if (!f || !f.menu) return res.status(404).json({ error: 'No encontramos este menú.' });
      if (q.clave) { if (hash(String(q.clave)) !== f.clave) return res.status(403).json({ error: 'La clave no es correcta.' }); return res.status(200).json({ menu: f.menu, edita: true }); }
      return res.status(200).json({ menu: f.menu });
    }

    if (req.method === 'POST' && q.accion === 'guardar') {
      const b = cuerpo(req), menu = limpiar(b.menu);
      if (!menu.cats.length) return res.status(400).json({ error: 'El menú está vacío.' });
      let id = String(b.id || ''), clave = String(b.clave || '');
      // traducción: solo si cambió el texto de la carta (así no se paga de nuevo por cambiar un precio)
      const firma = crypto.createHash('sha1').update(JSON.stringify([menu.saludo, menu.cats.map(c => [c.n, c.items.map(i => [i.n, i.d])])])).digest('hex');
      let prev = null;
      if (id) {
        if (!/^[a-z0-9]{6,20}$/.test(id)) return res.status(400).json({ error: 'Menú inválido.' });
        prev = await leerObj('menus/' + id + '.json');
        if (!prev || hash(clave) !== prev.clave) return res.status(403).json({ error: 'No tenés permiso para editar este menú.' });
      }
      if (prev && prev.firma === firma && prev.menu && prev.menu.tr) menu.tr = prev.menu.tr;
      else { const tr = await traducir(menu); if (tr) menu.tr = tr; }
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
