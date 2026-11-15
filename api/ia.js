// Vitrina 360 · IA para reconocer productos. La clave de Anthropic vive en Vercel (variable ANTHROPIC_API_KEY), nunca en la página.
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const { db, estado, PLANES, planReal, esDemo } = require('./_comun');
const crypto = require('crypto');

// Cupo de productos reconocidos con IA (se guarda en la cuenta del comerciante, donde él no lo puede tocar).
// Prueba gratis o cuenta sin pagar: LIMITE_FOTOS_PRUEBA en total (10). Planes pagos: por mes, se renueva el día 1:
// LIMITE_FOTOS_START (150), LIMITE_FOTOS_PLUS (300), LIMITE_FOTOS_PRO (500): así ningún cliente cuesta en IA más de lo que paga. IA_SIN_LIMITE (mails separados por coma) no tiene límite.
const PLAN_CUPO = { parquero: ['LIMITE_FOTOS_START', 150, 'Parques y Jardines'], parquero_plus: ['LIMITE_FOTOS_PLUS', 300, 'Parques y Jardines Plus'], emprendedora: ['LIMITE_FOTOS_START', 150, 'Start'], comercio: ['LIMITE_FOTOS_PLUS', 300, 'Plus'], pro: ['LIMITE_FOTOS_PRO', 500, 'Pro'] };
// Cupo del chat con IA del panel (mensajes por mes): LIMITE_CHAT_START (150), LIMITE_CHAT_PLUS (300), LIMITE_CHAT_PRO (800); prueba: LIMITE_CHAT_PRUEBA (15) en total.
const PLAN_CHAT = { parquero: ['LIMITE_CHAT_START', 150, 'Parques y Jardines'], parquero_plus: ['LIMITE_CHAT_PLUS', 300, 'Parques y Jardines Plus'], emprendedora: ['LIMITE_CHAT_START', 150, 'Start'], comercio: ['LIMITE_CHAT_PLUS', 300, 'Plus'], pro: ['LIMITE_CHAT_PRO', 800, 'Pro'] };
async function cupoIA(user, chat) {
  const SK = process.env.SUPABASE_SERVICE_KEY, base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!SK || !user || !user.id) return null;
  const libres = String(process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (user.email && libres.includes(String(user.email).toLowerCase())) return null;
  let row = null;
  try { const rows = await db('GET', '/rest/v1/tiendas?owner=eq.' + user.id + '&select=owner,prueba_hasta,pagada_hasta,activa,plan,mp_plan'); row = rows && rows[0]; }
  catch (e) { return null; } // si la base no responde, no se le corta la IA a nadie
  const meta = user.app_metadata || {};
  const paga = row && estado(row).estado === 'activa';
  let limite, usadas, cambio, aviso;
  if (paga) {
    const [env, def, nombre] = (chat ? PLAN_CHAT : PLAN_CUPO)[planReal(row)] || (chat ? PLAN_CHAT : PLAN_CUPO).emprendedora;
    const mes = new Date().toISOString().slice(0, 7);
    limite = Math.max(0, Number(process.env[env] || def));
    if (chat) {
      usadas = meta.chat_mes === mes ? Number(meta.chat_usadas) || 0 : 0;
      cambio = () => ({ chat_mes: mes, chat_usadas: usadas + 1 });
      aviso = `Llegaste a los ${limite} mensajes con la IA de este mes en tu plan ${nombre}. Se renuevan el día 1, o pasate a un plan más alto para tener más.`;
    } else {
      usadas = meta.ia_mes === mes ? Number(meta.ia_usadas) || 0 : 0;
      cambio = () => ({ ia_mes: mes, ia_usadas: usadas + 1 });
      aviso = `Llegaste a los ${limite} productos reconocidos con IA de este mes en tu plan ${nombre}. Se renuevan el día 1; mientras, completá los datos a mano, o pasate a un plan más alto para tener más.`;
    }
  } else if (chat) {
    limite = Math.max(0, Number(process.env.LIMITE_CHAT_PRUEBA || 15));
    usadas = Number(meta.chat_prueba) || 0;
    cambio = () => ({ chat_prueba: usadas + 1 });
    aviso = `Usaste los ${limite} mensajes con IA de la prueba gratis. Elegí un plan para seguir usando el asistente.`;
  } else {
    limite = Math.max(0, Number(process.env.LIMITE_FOTOS_PRUEBA || 10));
    usadas = Number(meta.ia_prueba) || 0;
    cambio = () => ({ ia_prueba: usadas + 1 });
    aviso = `Usaste los ${limite} productos con IA de la prueba gratis. Elegí un plan para seguir reconociendo productos; mientras, completá los datos a mano.`;
  }
  if (usadas >= limite) return { agotado: true, limite, aviso };
  return { limite, quedan: limite - usadas - 1, sumar: async () => {
    const headers = { apikey: SK, 'Content-Type': 'application/json' };
    if (String(SK).startsWith('eyJ')) headers.Authorization = 'Bearer ' + SK;
    try { await fetch(base + '/auth/v1/admin/users/' + user.id, { method: 'PUT', headers, body: JSON.stringify({ app_metadata: Object.assign({}, meta, cambio()) }) }); } catch (e) {}
  } };
}
module.exports = async (req, res) => {
  const KEY = process.env.ANTHROPIC_API_KEY, SURL = process.env.SUPABASE_URL, SKEY = process.env.SUPABASE_KEY;
  const ready = !!(KEY && SURL && SKEY);
  if (req.method === 'GET') return res.status(200).json({ ok: ready });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!ready) return res.status(503).json({ error: 'La IA todavía no está configurada.' });

  // ShopCut: el cliente de una tienda (sin cuenta) manda su selfie o la de su mascota y recibe los cortes que mejor le quedan
  { let bb = req.body; if (typeof bb === 'string') { try { bb = JSON.parse(bb); } catch (e) { bb = null; } }
    if (bb && bb.corte) return bb.app ? shopCutApp(req, res, KEY, bb) : shopCut(res, KEY, bb);
    if (bb && bb.parque) return parqueIA(res, KEY, bb, req); }
  const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tok) return res.status(401).json({ error: 'Tenés que entrar a tu tienda.' });
  let user = null;
  try {
    const u = await fetch(SURL.replace(/\/+$/, '') + '/auth/v1/user', { headers: { apikey: SKEY, Authorization: 'Bearer ' + tok } });
    if (!u.ok) return res.status(401).json({ error: 'Tu sesión venció. Volvé a entrar.' });
    user = await u.json().catch(() => null);
  } catch (e) { return res.status(502).json({ error: 'No se pudo verificar la sesión.' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (body && Array.isArray(body.chat)) return chatIA(req, res, KEY, user, body);
  const prompt = body && typeof body.prompt === 'string' ? body.prompt : '';
  const images = Array.isArray(body && body.images) ? body.images : [];
  if (!prompt || prompt.length > 30000) return res.status(400).json({ error: 'Pedido vacío o demasiado largo.' });
  if (images.length > 8) return res.status(400).json({ error: 'Demasiadas fotos juntas.' });
  const content = [];
  for (const im of images) {
    if (!im || typeof im.data !== 'string' || im.data.length > 5000000) return res.status(400).json({ error: 'Foto inválida o muy pesada.' });
    content.push({ type: 'image', source: { type: 'base64', media_type: TYPES.includes(im.type) ? im.type : 'image/jpeg', data: im.data } });
  }
  // Cupo de IA: pocas en la prueba gratis; en los planes, un cupo por mes.
  const cupo = images.length > 0 ? await cupoIA(user) : null;
  if (cupo && cupo.agotado) return res.status(403).json({ error: cupo.aviso, limite: cupo.limite });
  content.push({ type: 'text', text: prompt + (body.json ? '\n\nRespondé únicamente con JSON válido, sin texto antes ni después.' : '') });

  // Todo lo que lleva fotos (reconocer productos, catálogos, enderezar): el modelo más potente, Opus.
  // Solo texto (sugerir precio, textos para redes): el económico.
  const model = images.length > 0 ? (process.env.IA_MODEL_VISION || 'claude-opus-5-5') : (process.env.IA_MODEL_TEXT || 'claude-haiku-5-5');
  // Respuestas parejas: sin "creatividad" al reconocer
  let temp = true;
  const ask = () => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 8000, ...(temp ? { temperature: 0 } : {}), messages: [{ role: 'user', content }] })
  });
  try {
    let r = await ask(), j = await r.json().catch(() => ({}));
    // si el modelo no acepta "temperature", se pide igual sin ese ajuste
    if (r.status === 400 && /temperature/i.test(String((j.error && j.error.message) || ''))) { temp = false; r = await ask(); j = await r.json().catch(() => ({})); }
    // si la IA está saturada o falla un momento, se reintenta solo (hasta 2 veces)
    for (let k = 0; k < 2 && !r.ok && [429, 500, 502, 503, 529].includes(r.status); k++) {
      await new Promise(ok => setTimeout(ok, 1500 * (k + 1)));
      r = await ask(); j = await r.json().catch(() => ({}));
    }
    if (!r.ok) {
      const msg = String((j.error && j.error.message) || '');
      if (/credit balance|billing|purchase credits/i.test(msg)) return res.status(402).json({ error: 'La IA se quedó sin saldo. Cargá crédito en la cuenta de Anthropic (console.anthropic.com → Billing).' });
      const busy = r.status === 429 || r.status === 529;
      return res.status(busy ? 429 : 502).json({ error: busy ? 'La IA está ocupada, probá en un rato.' : (msg || 'La IA no respondió.') });
    }
    if (cupo && cupo.sumar) await cupo.sumar();
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo hablar con la IA.' });
  }
};

// ---- Asistente con IA del panel: conversación corta para ayudar al comerciante ----
async function chatIA(req, res, KEY, user, body) {
  const msgs = body.chat.slice(-16).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return res.status(400).json({ error: 'Escribí tu pregunta.' });
  const cupo = await cupoIA(user, true);
  if (cupo && cupo.agotado) return res.status(403).json({ error: cupo.aviso, limite: cupo.limite });
  const ctx = typeof body.ctx === 'string' ? body.ctx.slice(0, 12000) : '';
  const system = 'Sos el asistente de ShopFlash, una tienda online con vitrinas que giran. Ayudás al dueño o la dueña del comercio a vender: '
    + 'descripciones de productos, textos para redes y WhatsApp, respuestas a clientes, ideas de precios y promociones, y cómo usar su tienda. '
    + 'Respondé en el idioma en que te escriben (si es español, en español rioplatense, con "vos"), claro, cálido y breve, con pasos o textos listos para copiar. '
    + 'Usá SOLO los productos y vitrinas de la lista de abajo, que es la tienda actual. Nunca nombres productos que no estén en la lista (por ejemplo, si preguntan por autitos, hablá de los autitos de la lista, no de otra cosa). Si algo no está, decí que no lo ves cargado y preguntá. No inventes datos de la tienda que no estén abajo. Si te piden algo ilegal o dañino, no lo hagas.'
    + (ctx ? '\n\nDatos de la tienda:\n' + ctx : '');
  const model = process.env.IA_MODEL_CHAT || process.env.IA_MODEL_TEXT || 'claude-haiku-5-5';
  const ask = () => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1500, system, messages: msgs })
  });
  try {
    let r = await ask(), j = await r.json().catch(() => ({}));
    for (let k = 0; k < 2 && !r.ok && [429, 500, 502, 503, 529].includes(r.status); k++) {
      await new Promise(ok => setTimeout(ok, 1500 * (k + 1)));
      r = await ask(); j = await r.json().catch(() => ({}));
    }
    if (!r.ok) {
      const msg = String((j.error && j.error.message) || '');
      if (/credit balance|billing|purchase credits/i.test(msg)) return res.status(402).json({ error: 'La IA se quedó sin saldo. Cargá crédito en la cuenta de Anthropic (console.anthropic.com → Billing).' });
      const busy = r.status === 429 || r.status === 529;
      return res.status(busy ? 429 : 502).json({ error: busy ? 'La IA está ocupada, probá en un rato.' : 'La IA no respondió. Probá de nuevo.' });
    }
    if (cupo && cupo.sumar) await cupo.sumar();
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    return res.status(200).json({ text, quedan: cupo ? cupo.quedan : null });
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo hablar con la IA.' });
  }
}

// ---- ShopCut: corte de pelo ideal para personas y mascotas. Usa el cupo de fotos con IA de la tienda. La foto no se guarda. ----
async function shopCut(res, KEY, b) {
  const slug = String(b.slug || '');
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ error: 'Tienda inválida.' });
  const im = b.image || {};
  if (typeof im.data !== 'string' || im.data.length < 1000 || im.data.length > 4000000) return res.status(400).json({ error: 'La foto no se pudo leer. Probá con otra.' });
  const tipo = b.tipo === 'mascota' ? 'mascota' : 'persona';
  const largo = ['corto', 'medio', 'largo'].includes(b.largo) ? b.largo : '';
  let t = null;
  try { const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=owner,activa,data'); t = rows && rows[0]; } catch (e) {}
  if (!t || t.activa === false) return res.status(404).json({ error: 'Esta tienda no está disponible.' });
  const on = ((t.data || {}).stores || []).some(st => st && st.brand && st.brand.corte);
  if (!on) return res.status(403).json({ error: 'Esta tienda no tiene ShopCut activado.' });
  // los servicios de la tienda, para sugerir cuál reservar
  const servicios = [];
  try { (t.data.stores || []).forEach(st => (st.products || []).forEach(p => { if (p && p.name && servicios.length < 60) servicios.push(String(p.name).slice(0, 60)); })); } catch (e) {}
  // cupo: el de fotos con IA del comercio
  const SK = process.env.SUPABASE_SERVICE_KEY, base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  let owner = { id: t.owner };
  try { const h = { apikey: SK }; if (String(SK).startsWith('eyJ')) h.Authorization = 'Bearer ' + SK; const r = await fetch(base + '/auth/v1/admin/users/' + t.owner, { headers: h }); if (r.ok) owner = await r.json(); } catch (e) {}
  const cupo = await cupoIA(owner);
  if (cupo && cupo.agotado) return res.status(429).json({ error: 'ShopCut está descansando por hoy en esta tienda. ¡Probá más tarde!' });
  const pedido = tipo === 'persona'
    ? `Sos estilista profesional. Mirá la foto de esta persona y recomendá los 4 cortes de pelo que mejor le quedarían${largo ? ' (prefiere pelo ' + largo + ')' : ''}.
Fijate solo en lo que sirve para el corte: forma de la cara (ovalada, redonda, cuadrada, corazón, alargada, diamante), tipo de pelo (lacio, ondulado, rizado, afro), grosor y largo actual. No hagas comentarios sobre el cuerpo, la edad, el origen ni nada que no sea el pelo y la forma de la cara. Sé positivo y respetuoso.`
    : `Sos peluquero/a canino y felino profesional. Mirá la foto de esta mascota y recomendá los 4 cortes o estilos de peluquería que mejor le quedarían${largo ? ' (el dueño prefiere pelo ' + largo + ')' : ''}.
Fijate en la especie, la raza o cruza aproximada, el tipo de pelaje (simple, doble capa, rizado, duro, largo) y el largo actual. Si tiene doble capa (como husky, golden, ovejero), avisá que no conviene raparlo al ras porque el pelo lo protege del calor y del frío. Pensá en su bienestar y comodidad.`;
  const prompt = pedido + `
Si en la foto no se ve bien ${tipo === 'persona' ? 'una cara' : 'una mascota'}, devolvé {"error":"…"} explicando en UNA frase corta (máximo 25 palabras) qué foto sacar.
Servicios que ofrece la tienda (para sugerir cuál reservar; usá el nombre exacto o dejalo vacío si ninguno corresponde): ${JSON.stringify(servicios)}
Respondé en ${b.lang === 'en' ? 'inglés' : b.lang === 'pt' ? 'portugués' : 'español rioplatense (con "vos")'} y SOLO con JSON válido, así:
{"analisis":"2 frases sobre ${tipo === 'persona' ? 'la forma de la cara y el tipo de pelo' : 'la raza aproximada y el tipo de pelaje'}","cortes":[{"nombre":"nombre del corte","emoji":"un emoji","por_que":"por qué le queda bien, 1 o 2 frases","como_pedirlo":"qué decirle al peluquero, 1 frase","mantenimiento":"bajo|medio|alto","servicio":""}],"consejo":"un consejo corto de cuidado"}`;
  const model = process.env.IA_MODEL_CORTE || 'claude-sonnet-5-5';
  const ask = () => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1800, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: TYPES.includes(im.type) ? im.type : 'image/jpeg', data: im.data } },
      { type: 'text', text: prompt }] }] })
  });
  try {
    let r = await ask(), j = await r.json().catch(() => ({}));
    for (let k = 0; k < 2 && !r.ok && [429, 500, 502, 503, 529].includes(r.status); k++) { await new Promise(ok => setTimeout(ok, 1500 * (k + 1))); r = await ask(); j = await r.json().catch(() => ({})); }
    if (!r.ok) return res.status(502).json({ error: 'ShopCut no pudo analizar la foto ahora. Probá en un rato.' });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    let out = null; try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) {}
    if (!out) return res.status(502).json({ error: 'ShopCut no pudo leer la foto. Probá con otra, de frente y con buena luz.' });
    if (out.error) return res.status(422).json({ error: String(out.error).slice(0, 300) });
    if (cupo && cupo.sumar) await cupo.sumar();
    const s = v => String(v || '').slice(0, 400);
    return res.status(200).json({ tipo, analisis: s(out.analisis), consejo: s(out.consejo),
      cortes: (Array.isArray(out.cortes) ? out.cortes : []).slice(0, 5).map(c => ({ nombre: s(c.nombre).slice(0, 80), emoji: s(c.emoji).slice(0, 8), por_que: s(c.por_que), como_pedirlo: s(c.como_pedirlo), mantenimiento: ['bajo', 'medio', 'alto'].includes(c.mantenimiento) ? c.mantenimiento : '', servicio: servicios.includes(c.servicio) ? c.servicio : '' })) });
  } catch (e) { return res.status(502).json({ error: 'No se pudo hablar con la IA.' }); }
}

// ---- Parquería: el cliente de la tienda manda fotos de su parque y la IA estima m², altura del pasto, plantas y arma el presupuesto
//      con los precios del parquero. Tope de presupuestos por mes según el plan (pq en PLANES). Las fotos no se guardan.
const pnum = v => { const t = String(v || '').replace(/[^\d,.]/g, ''); if (!t) return 0; const n = Number(t.replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
async function parqueIA(res, KEY, b, req) {
  const slug = String(b.slug || '');
  // tienda de muestra: tope por día (total y por persona) para que nadie gaste de más probando
  if (esDemo(slug)) {
    const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10), path = scBase() + '/object/' + SC_BUCKET + '/demo-ia/' + dia + '.json';
    let f = null; try { const r = await fetch(path, { headers: scHead() }); if (r.ok) f = await r.json(); } catch (e) {}
    f = f && typeof f === 'object' ? f : { total: 0, ip: {} };
    const ip = String((req && req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim() || 'x';
    if (f.total >= Number(process.env.DEMO_IA_DIA || 60) || (f.ip[ip] || 0) >= Number(process.env.DEMO_IA_PERSONA || 4)) return res.status(429).json({ error: 'Esta es una tienda de muestra y ya se probó mucho hoy. ¡Probá mañana, o pedí la tuya!' });
    f.total++; f.ip[ip] = (f.ip[ip] || 0) + 1;
    try { await fetch(path, { method: 'POST', headers: scHead({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(f) }); } catch (e) {}
  }
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return res.status(400).json({ error: 'Tienda inválida.' });
  const ims = (Array.isArray(b.images) ? b.images : []).slice(0, 3).filter(im => im && typeof im.data === 'string' && im.data.length > 1000 && im.data.length < 4000000);
  if (!ims.length) return res.status(400).json({ error: 'Subí al menos una foto de tu parque.' });
  let t = null;
  try { const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=owner,activa,data'); t = rows && rows[0]; } catch (e) {}
  if (!t || t.activa === false) return res.status(404).json({ error: 'Esta tienda no está disponible.' });
  // los servicios y precios del parquero
  const servs = [];
  try { (t.data.stores || []).forEach(st => (st.products || []).forEach(p => { if (!p || !p.name || servs.length >= 60 || p.sample) return;
    const txt = (p.name + ' ' + (p.features || []).join(' ')).toLowerCase();
    servs.push({ n: String(p.name).slice(0, 60), precio: pnum(p.price), m2: !!p.m2 || /m2|m²|metro/.test(txt) }); })); } catch (e) {}
  const SK = process.env.SUPABASE_SERVICE_KEY, base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  let owner = { id: t.owner };
  try { const h = { apikey: SK }; if (String(SK).startsWith('eyJ')) h.Authorization = 'Bearer ' + SK; const r = await fetch(base + '/auth/v1/admin/users/' + t.owner, { headers: h }); if (r.ok) owner = await r.json(); } catch (e) {}
  // tope de presupuestos con IA por mes según el plan (así nunca cuesta más de lo que paga el parquero)
  let pqLim = Number(process.env.PQ_PRUEBA || 10), pqPaga = false;
  try { const rr = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=plan,mp_plan,prueba_hasta,pagada_hasta,activa'); const row = rr && rr[0];
    if (row && estado(row).estado === 'activa') { pqPaga = true; const pr = planReal(row), P = PLANES()[pr] || {}; pqLim = Number(P.pq || (pr === 'pro' ? 60 : pr === 'comercio' ? 30 : 15)); } } catch (e) {}
  const metaO = owner.app_metadata || {}, mesPq = new Date().toISOString().slice(0, 7);
  const pqUsadas = pqPaga ? (metaO.pq_mes === mesPq ? Number(metaO.pq_usadas) || 0 : 0) : Number(metaO.pq_prueba) || 0;
  const libresPq = String(process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (!(owner.email && libresPq.includes(String(owner.email).toLowerCase())) && pqUsadas >= pqLim) return res.status(429).json({ error: 'Este mes ya se armaron todos los presupuestos con IA de esta tienda. Mandale las fotos al parquero por WhatsApp y te contesta.' });
  const sumarPq = async () => { try { const h = { apikey: SK, 'Content-Type': 'application/json' }; if (String(SK).startsWith('eyJ')) h.Authorization = 'Bearer ' + SK;
    const cambio = pqPaga ? { pq_mes: mesPq, pq_usadas: pqUsadas + 1 } : { pq_prueba: pqUsadas + 1 };
    await fetch(base + '/auth/v1/admin/users/' + t.owner, { method: 'PUT', headers: h, body: JSON.stringify({ app_metadata: Object.assign({}, metaO, cambio) }) }); } catch (e) {} };
  const m2 = Math.max(0, Math.min(200000, Number(b.m2) || 0));
  const quiere = String(b.quiere || '').slice(0, 300);
  const diseno = b.modo === 'diseno', estilo = String(b.estilo || '').slice(0, 120);
  // plantas y materiales: los del parquero (productos que no son servicios) + los de los viveros que conectó (sus tiendas ShopFlash)
  const cat = [];
  if (diseno) {
    const add = (p, v, vslug) => { if (!p || !p.name || p.service || p.sample || cat.length >= 220) return; cat.push({ n: String(p.name).slice(0, 70), precio: pnum(p.price), v: v, slug: vslug }); };
    try { (t.data.stores || []).forEach(st => (st.products || []).forEach(p => add(p, 'el parquero', slug))); } catch (e) {}
    try { const bv = ((t.data.stores || [])[t.data.active || 0] || {}).brand || {};
      const vs = (Array.isArray(bv.viveros) ? bv.viveros : []).filter(x => x && x.tipo !== 'taller').map(x => String(x && x.slug || '')).filter(x => /^[a-z0-9-]{3,40}$/.test(x)).slice(0, 5);
      if (vs.length) { const rows = await db('GET', '/rest/v1/tiendas?slug=in.(' + vs.join(',') + ')&select=slug,nombre,data,activa');
        (rows || []).filter(r => r.activa !== false).forEach(r => { const d = r.data || {}, st = (d.stores || [])[d.active || 0] || {}, nom = String((st.brand || {}).name || r.nombre || r.slug).slice(0, 40);
          (st.products || []).slice(0, 80).forEach(p => add(p, nom, r.slug)); }); } } catch (e) {}
  }
  const prompt = `Sos un parquero y paisajista con muchos años de experiencia en Argentina. Un cliente te manda ${ims.length > 1 ? ims.length + ' fotos' : 'una foto'} de su parque, jardín o terreno para que le pases un presupuesto.
Mirá con atención y estimá, como lo haría un profesional en la visita:
- La superficie de césped o terreno a trabajar en m² (usá referencias: puertas ~2 m de alto y ~0,8 m de ancho, ladrillos, baldosas de 30–40 cm, autos ~4,5 m, cercos ~1,8 m, personas).${m2 ? ' El cliente midió ' + m2 + ' m²: usá ese número.' : ''}
- La altura aproximada del pasto en cm y su estado (prolijo, crecido, muy crecido/abandonado, con malezas, seco, con pozos).
- Cada planta, arbusto, cerco o árbol que haya que trabajar: qué es, tamaño aproximado (altura en metros, ancho), estado y qué trabajo necesita (poda de mantenimiento, poda de formación, rebaje, extracción, etc.).
- Si hay que limpiar (ramas, hojas, escombros), desmalezar, bordear o retirar residuos.
${quiere ? 'Lo que pide el cliente: "' + quiere + '".\n' : ''}Servicios y precios del parquero (usá EXACTAMENTE estos nombres cuando correspondan; "m2": true quiere decir precio por m²):
${JSON.stringify(servs)}
Para cada trabajo: si hay un servicio de la lista que corresponde, poné su nombre exacto en "servicio". Si el pasto está muy crecido, hay mucha maleza, el terreno es difícil o la planta es muy grande, poné un "ajuste_pct" positivo (por ejemplo 30 o 60) con el motivo; si es fácil, 0. Si NO hay un servicio de la lista, poné "servicio": "" y en "precio_estimado" un precio razonable en pesos argentinos de hoy para ese trabajo completo.
${diseno ? `ADEMÁS el cliente quiere REDISEÑAR su parque${estilo ? ' con este estilo: "' + estilo + '"' : ''}. Armá un plan concreto y realizable: qué poner, cuántas unidades y dónde (por ejemplo "frente, contra el cerco, al sol"), pensando en el sol y la sombra que ves, el clima de Argentina y poco mantenimiento. Usá en lo posible plantas y materiales de este catálogo (el número "i" es su posición; "v" es el vivero que lo vende): ${JSON.stringify(cat.map((x, i) => ({ i, n: x.n, precio: x.precio, v: x.v })))}. Si algo necesario no está en el catálogo, poné "i": -1 y un "precio_estimado" por unidad en pesos argentinos de hoy. Agregá también en "trabajos" la mano de obra del rediseño (preparar la tierra, plantar, colocar piedras, etc.) con los servicios del parquero si corresponden.
` : ''}Sé honesto: es una estimación por foto. Si en las fotos no se ve un parque, jardín, patio o terreno, devolvé {"error":"…"} en una frase corta diciendo qué foto sacar.
Respondé en español rioplatense (con "vos") y SOLO con JSON válido:
{"analisis":"2 o 3 frases de lo que ves","m2":número,"m2_confianza":"baja|media|alta","pasto_cm":número,"pasto_estado":"…","plantas":[{"que":"…","tamano":"…","estado":"…","trabajo":"…"}],"trabajos":[{"titulo":"nombre corto del trabajo","servicio":"nombre exacto o vacío","cantidad":número,"unidad":"m2|unidad|trabajo","ajuste_pct":número,"motivo":"…","precio_estimado":número}],"consejo":"1 frase útil para el cliente","tiempo":"duración aproximada del trabajo"${diseno ? ',"plan":[{"que":"planta o material","cantidad":número,"donde":"dónde va","por_que":"por qué conviene, corto","i":número,"precio_estimado":número}],"resumen":"2 frases de cómo va a quedar el parque"' : ''}}`;
  const model = process.env.IA_MODEL_PARQUE || 'claude-opus-5-5';
  const ask = () => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'user', content: [
      ...ims.map(im => ({ type: 'image', source: { type: 'base64', media_type: TYPES.includes(im.type) ? im.type : 'image/jpeg', data: im.data } })),
      { type: 'text', text: prompt }] }] })
  });
  try {
    let r = await ask(), j = await r.json().catch(() => ({}));
    for (let k = 0; k < 2 && !r.ok && [429, 500, 502, 503, 529].includes(r.status); k++) { await new Promise(ok => setTimeout(ok, 1500 * (k + 1))); r = await ask(); j = await r.json().catch(() => ({})); }
    if (!r.ok) return res.status(502).json({ error: 'No pude analizar las fotos ahora. Probá en un rato.' });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    let out = null; try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) {}
    if (!out) return res.status(502).json({ error: 'No pude leer bien las fotos. Probá con otras, con buena luz y que se vea todo el parque.' });
    if (out.error) return res.status(422).json({ error: String(out.error).slice(0, 300) });
    await sumarPq();
    const s = (v, n) => String(v == null ? '' : v).slice(0, n || 300), num = v => Math.max(0, Number(v) || 0);
    const M2 = m2 || Math.round(num(out.m2));
    // el precio lo arma el servidor con los precios del parquero (la IA solo estima cantidades y dificultad)
    const trabajos = (Array.isArray(out.trabajos) ? out.trabajos : []).slice(0, 12).map(x => {
      const sv = servs.find(v => v.n.toLowerCase() === String(x.servicio || '').toLowerCase().trim());
      const aj = Math.max(-30, Math.min(150, Number(x.ajuste_pct) || 0));
      const porM2 = sv ? sv.m2 : x.unidad === 'm2';
      const cant = porM2 ? 0 : Math.max(1, Math.min(500, Math.round(num(x.cantidad) || 1)));
      const precio = sv && sv.precio ? sv.precio : num(x.precio_estimado) / (porM2 ? Math.max(1, M2) : (cant || 1));
      return { titulo: s(x.titulo, 80), servicio: sv ? sv.n : '', porM2, cantidad: cant, precio: Math.round(precio * 100) / 100, ajuste: aj, motivo: s(x.motivo, 160), estimado: !(sv && sv.precio) };
    }).filter(x => x.titulo);
    return res.status(200).json({ analisis: s(out.analisis, 600), m2: M2, m2_confianza: ['baja', 'media', 'alta'].includes(out.m2_confianza) ? out.m2_confianza : 'baja',
      pasto_cm: Math.round(num(out.pasto_cm)), pasto_estado: s(out.pasto_estado, 120), consejo: s(out.consejo, 300), tiempo: s(out.tiempo, 80),
      plantas: (Array.isArray(out.plantas) ? out.plantas : []).slice(0, 10).map(p => ({ que: s(p.que, 60), tamano: s(p.tamano, 60), estado: s(p.estado, 80), trabajo: s(p.trabajo, 80) })),
      trabajos,
      ...(diseno ? { resumen: s(out.resumen, 400), plan: (Array.isArray(out.plan) ? out.plan : []).slice(0, 15).map(x => { const it = cat[Number(x.i)] && Number(x.i) >= 0 ? cat[Number(x.i)] : null;
        return { que: s(it ? it.n : x.que, 80), cantidad: Math.max(1, Math.min(300, Math.round(num(x.cantidad) || 1))), donde: s(x.donde, 100), por_que: s(x.por_que, 140),
          precio: it && it.precio ? it.precio : num(x.precio_estimado), vivero: it ? it.v : '', link: it && it.slug !== slug ? '/t/' + it.slug : '', estimado: !(it && it.precio) }; }).filter(x => x.que) } : {}) });
  } catch (e) { return res.status(502).json({ error: 'No se pudo hablar con la IA.' }); }
}

// ---- ShopCut como app propia (shopcut.html): gratis, con tope por celular/IP y tope total por día para no gastar de más ----
// SHOPCUT_POR_DIA: análisis por persona por día (3). SHOPCUT_TOPE_DIA: análisis totales por día (300 ≈ unos pocos dólares).
const SC_BUCKET = 'pedidos';
const scBase = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1';
const scHead = extra => { const k = process.env.SUPABASE_SERVICE_KEY, h = Object.assign({ apikey: k }, extra || {}); if (String(k).startsWith('eyJ')) h.Authorization = 'Bearer ' + k; return h; };
const PROD_PERSONA = { maquina_corte: 'máquina de cortar pelo', tijera: 'tijera de peluquería', shampoo_rulos: 'shampoo y crema para rulos', shampoo_lacio: 'shampoo para pelo lacio o fino', crema_peinar: 'crema para peinar', plancha: 'planchita de pelo', secador: 'secador de pelo', cera_pomada: 'cera o pomada para peinar', cepillo: 'cepillo redondo', rizador: 'rizador o buclera', barba: 'kit para barba' };
const PROD_MASCOTA = { maquina_mascota: 'máquina de cortar pelo para mascotas', cepillo_deslanador: 'cepillo deslanador', shampoo_mascota: 'shampoo para perros y gatos', tijera_mascota: 'tijera de peluquería canina', cortaunas: 'cortaúñas para mascotas', guante_cepillo: 'guante quita pelo', secador_mascota: 'secador para mascotas' };
async function scDia() {
  const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const path = scBase() + '/object/' + SC_BUCKET + '/shopcut/' + dia + '.json';
  let f = null; try { const r = await fetch(path, { headers: scHead() }); if (r.ok) f = await r.json(); } catch (e) {}
  f = f && typeof f === 'object' ? f : { total: 0, ip: {} };
  const save = async () => { try { await fetch(path, { method: 'POST', headers: scHead({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(f) }); } catch (e) {} };
  return { f, save };
}
async function shopCutApp(req, res, KEY, b) {
  const im = b.image || {};
  if (typeof im.data !== 'string' || im.data.length < 1000 || im.data.length > 4000000) return res.status(400).json({ error: 'La foto no se pudo leer. Probá con otra.' });
  const tipo = b.tipo === 'mascota' ? 'mascota' : 'persona';
  const largo = ['corto', 'medio', 'largo'].includes(b.largo) ? b.largo : '';
  const porDia = Math.max(1, Number(process.env.SHOPCUT_POR_DIA || 3)), tope = Math.max(1, Number(process.env.SHOPCUT_TOPE_DIA || 300));
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  const quien = crypto.createHash('sha256').update(ip + '|' + String(b.dev || '').slice(0, 64)).digest('hex').slice(0, 16);
  const quienIp = crypto.createHash('sha256').update('ip|' + ip).digest('hex').slice(0, 16);
  const { f, save } = await scDia();
  if ((f.total || 0) >= tope) return res.status(429).json({ error: '¡ShopCut está a full hoy! 🔥 Llegamos al máximo de análisis del día. Volvé mañana y probalo gratis.', tope: true });
  if ((f.ip[quien] || 0) >= porDia || (f.ip[quienIp] || 0) >= porDia * 3) return res.status(429).json({ error: `Ya usaste tus ${porDia} análisis gratis de hoy. ¡Mañana tenés ${porDia} más!`, limite: true });
  const lista = tipo === 'persona' ? PROD_PERSONA : PROD_MASCOTA;
  const pedido = tipo === 'persona'
    ? `Sos estilista profesional. Mirá la foto de esta persona y recomendá los 4 cortes de pelo que mejor le quedarían${largo ? ' (prefiere pelo ' + largo + ')' : ''}.
Fijate solo en lo que sirve para el corte: forma de la cara (ovalada, redonda, cuadrada, corazón, alargada, diamante), tipo de pelo (lacio, ondulado, rizado, afro), grosor y largo actual. No hagas comentarios sobre el cuerpo, la edad, el origen ni nada que no sea el pelo y la forma de la cara. Sé positivo y respetuoso.`
    : `Sos peluquero/a canino y felino profesional. Mirá la foto de esta mascota y recomendá los 4 cortes o estilos de peluquería que mejor le quedarían${largo ? ' (el dueño prefiere pelo ' + largo + ')' : ''}.
Fijate en la especie, la raza o cruza aproximada, el tipo de pelaje (simple, doble capa, rizado, duro, largo) y el largo actual. Si tiene doble capa (como husky, golden, ovejero), avisá que no conviene raparlo al ras porque el pelo lo protege del calor y del frío. Pensá en su bienestar y comodidad.`;
  const prompt = pedido + `
Si en la foto no se ve bien ${tipo === 'persona' ? 'una cara' : 'una mascota'}, devolvé {"error":"…"} explicando en UNA frase corta (máximo 25 palabras) qué foto sacar.
Elegí también hasta 3 productos útiles para mantener esos cortes en casa, SOLO de esta lista (usá la clave): ${JSON.stringify(lista)}
Respondé en ${b.lang === 'en' ? 'inglés' : b.lang === 'pt' ? 'portugués' : 'español rioplatense (con "vos")'} y SOLO con JSON válido, así:
{"analisis":"2 frases sobre ${tipo === 'persona' ? 'la forma de la cara y el tipo de pelo' : 'la raza aproximada y el tipo de pelaje'}","cortes":[{"nombre":"nombre del corte","emoji":"un emoji","por_que":"por qué le queda bien, 1 o 2 frases","como_pedirlo":"qué decirle al peluquero, 1 frase","mantenimiento":"bajo|medio|alto"}],"productos":[{"clave":"…","para":"para qué le sirve, pocas palabras"}],"consejo":"un consejo corto de cuidado"}`;
  const model = process.env.IA_MODEL_CORTE || 'claude-sonnet-5-5';
  const ask = () => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1800, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: TYPES.includes(im.type) ? im.type : 'image/jpeg', data: im.data } },
      { type: 'text', text: prompt }] }] })
  });
  try {
    let r = await ask(), j = await r.json().catch(() => ({}));
    for (let k = 0; k < 2 && !r.ok && [429, 500, 502, 503, 529].includes(r.status); k++) { await new Promise(ok => setTimeout(ok, 1500 * (k + 1))); r = await ask(); j = await r.json().catch(() => ({})); }
    if (!r.ok) return res.status(502).json({ error: 'ShopCut no pudo analizar la foto ahora. Probá en un rato.' });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    let out = null; try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) {}
    if (!out) return res.status(502).json({ error: 'ShopCut no pudo leer la foto. Probá con otra, de frente y con buena luz.' });
    if (out.error) return res.status(422).json({ error: String(out.error).slice(0, 300) });
    f.total = (f.total || 0) + 1; f.ip[quien] = (f.ip[quien] || 0) + 1; if (quienIp !== quien) f.ip[quienIp] = (f.ip[quienIp] || 0) + 1;
    await save();
    const s = v => String(v || '').slice(0, 400);
    return res.status(200).json({ tipo, quedan: Math.max(0, porDia - f.ip[quien]), analisis: s(out.analisis), consejo: s(out.consejo),
      cortes: (Array.isArray(out.cortes) ? out.cortes : []).slice(0, 5).map(c => ({ nombre: s(c.nombre).slice(0, 80), emoji: s(c.emoji).slice(0, 8), por_que: s(c.por_que), como_pedirlo: s(c.como_pedirlo), mantenimiento: ['bajo', 'medio', 'alto'].includes(c.mantenimiento) ? c.mantenimiento : '' })),
      productos: (Array.isArray(out.productos) ? out.productos : []).filter(x => x && lista[x.clave]).slice(0, 3).map(x => ({ clave: x.clave, nombre: lista[x.clave], para: s(x.para).slice(0, 120) })) });
  } catch (e) { return res.status(502).json({ error: 'No se pudo hablar con la IA.' }); }
}
