// Vitrina 360 · IA para reconocer productos. La clave de Anthropic vive en Vercel (variable ANTHROPIC_API_KEY), nunca en la página.
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const { db, estado } = require('./_comun');
const crypto = require('crypto');

// Cupo de productos reconocidos con IA (se guarda en la cuenta del comerciante, donde él no lo puede tocar).
// Prueba gratis o cuenta sin pagar: LIMITE_FOTOS_PRUEBA en total (10). Planes pagos: por mes, se renueva el día 1:
// LIMITE_FOTOS_START (150), LIMITE_FOTOS_PLUS (300), LIMITE_FOTOS_PRO (500): así ningún cliente cuesta en IA más de lo que paga. IA_SIN_LIMITE (mails separados por coma) no tiene límite.
const PLAN_CUPO = { emprendedora: ['LIMITE_FOTOS_START', 150, 'Start'], comercio: ['LIMITE_FOTOS_PLUS', 300, 'Plus'], pro: ['LIMITE_FOTOS_PRO', 500, 'Pro'] };
// Cupo del chat con IA del panel (mensajes por mes): LIMITE_CHAT_START (150), LIMITE_CHAT_PLUS (300), LIMITE_CHAT_PRO (800); prueba: LIMITE_CHAT_PRUEBA (15) en total.
const PLAN_CHAT = { emprendedora: ['LIMITE_CHAT_START', 150, 'Start'], comercio: ['LIMITE_CHAT_PLUS', 300, 'Plus'], pro: ['LIMITE_CHAT_PRO', 800, 'Pro'] };
async function cupoIA(user, chat) {
  const SK = process.env.SUPABASE_SERVICE_KEY, base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  if (!SK || !user || !user.id) return null;
  const libres = String(process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (user.email && libres.includes(String(user.email).toLowerCase())) return null;
  let row = null;
  try { const rows = await db('GET', '/rest/v1/tiendas?owner=eq.' + user.id + '&select=owner,prueba_hasta,pagada_hasta,activa,plan'); row = rows && rows[0]; }
  catch (e) { return null; } // si la base no responde, no se le corta la IA a nadie
  const meta = user.app_metadata || {};
  const paga = row && estado(row).estado === 'activa';
  let limite, usadas, cambio, aviso;
  if (paga) {
    const [env, def, nombre] = (chat ? PLAN_CHAT : PLAN_CUPO)[row.plan] || (chat ? PLAN_CHAT : PLAN_CUPO).emprendedora;
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
    if (bb && bb.corte) return bb.app ? shopCutApp(req, res, KEY, bb) : shopCut(res, KEY, bb); }
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
  const ctx = typeof body.ctx === 'string' ? body.ctx.slice(0, 3000) : '';
  const system = 'Sos el asistente de ShopFlash, una tienda online con vitrinas que giran. Ayudás al dueño o la dueña del comercio a vender: '
    + 'descripciones de productos, textos para redes y WhatsApp, respuestas a clientes, ideas de precios y promociones, y cómo usar su tienda. '
    + 'Respondé en el idioma en que te escriben (si es español, en español rioplatense, con "vos"), claro, cálido y breve, con pasos o textos listos para copiar. '
    + 'No inventes datos de la tienda que no estén abajo; si falta algo, preguntá. Si te piden algo ilegal o dañino, no lo hagas.'
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
