// Vitrina 360 · IA para reconocer productos. La clave de Anthropic vive en Vercel (variable ANTHROPIC_API_KEY), nunca en la página.
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const { db, estado, PLANES, planReal, esDemo, usuario } = require('./_comun');
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
    if (bb && bb.parque) return parqueIA(res, KEY, bb, req);
    if (bb && (bb.pqPendientes || bb.pqProcesar || bb.pqVer || bb.pqListo)) return pqPendientes(req, res, KEY, bb); }
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
// ---- Oficios: qué tiene que mirar la IA en las fotos de cada oficio (la "guía" del profesional) ----
const OFICIOS = {
  pintor: { rol: 'pintor de obra con muchos años de experiencia en Argentina', foto: 'las paredes, ambientes, fachadas, rejas o aberturas que quiere pintar', m2: true,
    guia: `- La superficie a pintar en m² (paredes y/o cielorrasos), descontando puertas y ventanas. Usá referencias: puertas ~2 m × 0,8 m, ventanas, zócalos, enchufes a ~30 cm del piso, altura de ambiente ~2,6 m.
- Si es interior o exterior, y la altura: si hace falta andamio o escalera grande (más de 3 m), es un ajuste.
- El estado de la superficie: humedad o salitre, manchas de hongos, pintura descascarada o ampollada, grietas o fisuras, revoque flojo, paredes nuevas sin pintar. Eso define si hay que rasquetear, lijar, tratar humedad, enduir o fijar antes de pintar.
- El tipo de pintura que tiene y la que conviene (látex interior, látex exterior, impermeabilizante, esmalte sintético para aberturas y rejas, antióxido, membrana para techos). Cuántas manos.
- Aberturas, rejas, portones o barandas que haya que pintar: cuántas unidades o metros.
- Si hay muebles que mover o cubrir.`,
    tips: 'Si ves humedad, decí que primero hay que resolver la causa (filtración, cañería, cimientos) o va a volver.', opc: 'el cliente pregunta "¿qué me recomendás?". Proponele 3 OPCIONES de la más económica a la más completa (por ejemplo: 1) una mano de refresco; 2) preparación completa con enduido y 2 manos; 3) lo mismo con tratamiento de humedad, colores nuevos combinados y aberturas). En "estilo" describí los colores sugeridos.' },
  plomero: { rol: 'plomero matriculado con muchos años de experiencia en Argentina', foto: 'el problema de plomería: pérdidas, canillas, inodoros, caños, termotanques, desagües', m2: false, visita: true,
    guia: `- Qué artefacto o instalación es: canilla o grifería (monocomando, de dos llaves, de pared), inodoro y mochila o depósito (botonera, flotante, válvula), bidet, vanitory, sifón, pileta de cocina, termotanque o calefón (eléctrico o a gas, litros), tanque de agua, bomba presurizadora o elevadora, rejillas y cámaras.
- El material de los caños si se ve: termofusión (PPF), hierro galvanizado (viejo, se oxida), PVC o polipropileno de desagüe, cobre, plomo.
- La falla: goteo, pérdida, mancha de humedad en pared o techo (y de dónde puede venir), sarro, óxido, flexible roto, cuerito o cartucho gastado, mochila que no corta, desagüe tapado, poca presión.
- Si es una REPARACIÓN (cambiar cuerito, cartucho, flexible, válvula) o hace falta REEMPLAZAR (grifería, tramo de caño, mochila). Si hay que romper pared o piso, y cuánto (metros de caño aproximados).
- Si hay riesgo: pérdida grande, agua cerca de la electricidad, filtración que daña la casa del vecino.`,
    tips: 'Si hay una pérdida grande, aconsejale cerrar la llave de paso mientras llega el plomero.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 o 3 OPCIONES de la más económica a la más definitiva (por ejemplo: 1) reparar lo que falla; 2) cambiar el artefacto o grifería; 3) renovar la instalación de ese sector). Decí qué dura más y qué se ahorra.' },
  electricista: { rol: 'electricista matriculado con muchos años de experiencia en Argentina', foto: 'la instalación eléctrica: tablero, tomas, llaves, cables, artefactos de luz', m2: false, visita: true,
    guia: `- El TABLERO: cuántas térmicas tiene, si tiene disyuntor diferencial (botón de prueba "T"), si hay cables sueltos, empalmes con cinta, marcas de quemado o recalentamiento, fusibles viejos de porcelana. Si no tiene disyuntor, recomendalo siempre (protege la vida).
- Tomas y llaves: si están quemados o derretidos, flojos, sin tierra (dos patas), con zapatillas o prolongaciones de más.
- Cables: a la vista, pelados, de tela o goma vieja (instalación de más de 30 años), sección chica para lo que alimentan (aire acondicionado, horno eléctrico), sin caño.
- Puesta a tierra (jabalina), pilar y medidor si se ven.
- Lo que el cliente quiere agregar: bocas nuevas, tomas, ventilador de techo, luminarias, aire acondicionado, portero, cámaras.
- Si hay PELIGRO (olor a quemado, chispas, cables pelados al alcance, agua cerca), urgencia alta.`,
    tips: 'Nunca le indiques al cliente que lo arregle él. Si hay peligro, que corte la luz desde la térmica general y no toque nada.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 o 3 OPCIONES de la más económica a la más segura (por ejemplo: 1) reparar lo que falla; 2) reparar y agregar disyuntor y puesta a tierra; 3) recablear el sector o el tablero completo según norma AEA).' },
  gasista: { rol: 'gasista matriculado con muchos años de experiencia en Argentina', foto: 'la instalación de gas: calefón, termotanque, cocina, estufas, caldera, cañerías, ventilaciones', m2: false, visita: true,
    guia: `- Qué artefacto es: calefón, termotanque, cocina u horno, estufa (tiro balanceado o de ambiente sin salida), caldera, anafe, y si es gas natural o envasado (garrafa o zeppelin).
- Ventilaciones: si el ambiente tiene rejillas reglamentarias arriba y abajo, si el calefón o termotanque tiene conducto de salida con sombrerete, si está en un baño o dormitorio (no permitido para artefactos sin tiro balanceado).
- La llama si se ve: azul es buena; amarilla o anaranjada indica mala combustión (peligro de monóxido de carbono).
- Conexiones: flexibles no reglamentarios (manguera de goma), llaves de paso, caños con óxido, manchas negras de hollín en la pared o el techo.
- Si es instalación nueva, ampliación, conexión de un artefacto, service, o prueba de hermeticidad.`,
    tips: 'Si el cliente dice que hay olor a gas: que cierre la llave general, abra puertas y ventanas, no prenda ni apague luces ni nada eléctrico, salga y llame a la urgencia de su distribuidora. No hay que esperar al turno.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 o 3 OPCIONES (por ejemplo: 1) service y ajuste del artefacto; 2) adecuar ventilaciones y conexiones a norma; 3) reemplazar el artefacto por uno más seguro y eficiente).' },
  albanil: { rol: 'albañil y colocador de cerámicos y porcelanatos con muchos años de experiencia en Argentina', foto: 'la obra o el ambiente: pisos, paredes, revestimientos, revoques, contrapisos, muros, techos', m2: true, visita: true,
    guia: `- La superficie a trabajar en m² (piso, pared o revestimiento). Usá referencias: baldosas y cerámicos (30×30, 45×45, 60×60 cm), puertas ~2 m × 0,8 m, ladrillos (~25 cm), altura de ambiente ~2,6 m.
- Qué hay que hacer: colocar cerámico o porcelanato (piso o pared), retirar el piso viejo, hacer carpeta o contrapiso, nivelar, revocar (grueso y fino), levantar muro, reparar grietas, impermeabilizar, hacer una losa, un baño o una cocina completos.
- El estado: piso flojo o que suena hueco, cerámicos rotos, desniveles, humedad que sube de los cimientos (cimiento sin capa aisladora), revoque que se cae, grietas (finas de pintura o estructurales que atraviesan la pared).
- El tamaño de la pieza que se va a colocar (las grandes, de 60×60 o más, llevan más trabajo) y si es en diagonal, con guardas o zócalos (metros lineales).
- Si hay que retirar escombros (volquete o viajes).`,
    tips: 'Si ves una grieta grande que atraviesa la pared o que sigue creciendo, recomendá que la vea un profesional antes de taparla.', opc: 'el cliente pregunta "¿qué me recomendás?". Proponele 3 OPCIONES de la más económica a la más completa (por ejemplo: 1) reparar lo dañado; 2) cerámico nuevo de buena calidad; 3) porcelanato grande con zócalos y terminaciones). En "estilo" describí el piso o revestimiento sugerido (color, tamaño, terminación).' },
  durlock: { rol: 'instalador de durlock y construcción en seco con muchos años de experiencia en Argentina', foto: 'el lugar donde va el durlock: la pared a dividir, el cielorraso, el mueble o el revestimiento', m2: true, visita: true,
    guia: `- La superficie en m² de tabique, cielorraso o revestimiento (descontá aberturas). Usá referencias: puertas ~2 m × 0,8 m, altura de ambiente ~2,6 m, placas de 1,20 × 2,40 m.
- Qué es: tabique divisorio (simple o doble placa, con o sin aislación de lana de vidrio), cielorraso suspendido o junta tomada, revestimiento sobre pared con humedad, mueble o estante de durlock, buñas, cajones para luces.
- El tipo de placa que conviene: estándar, verde resistente a la humedad (baños y cocinas) o roja ignífuga.
- Si hay aberturas (puertas, ventanas), bocas de luz o cajas a dejar, y si el lugar es alto.
- Terminación: masillado, encintado, lijado y pintura (si la incluye o no).`,
    tips: 'Si es para un baño o una cocina, recomendá placa verde resistente a la humedad.', opc: 'el cliente pregunta "¿qué me recomendás?". Proponele 2 o 3 OPCIONES (por ejemplo: 1) tabique simple; 2) tabique con aislación acústica; 3) con terminación pintada y luces embutidas).' },
  techista: { rol: 'techista e impermeabilizador con muchos años de experiencia en Argentina', foto: 'el techo: chapas, tejas, losa, membrana, canaletas, y las manchas o goteras de adentro', m2: true, visita: true,
    guia: `- El tipo de techo: losa (con membrana asfáltica, membrana líquida o sin protección), chapa (acanalada o trapezoidal, con o sin aislación), tejas (cerámicas o de hormigón), policarbonato.
- La superficie en m² a trabajar. Usá referencias: chapas de ~1,10 m de ancho útil, tejas, puertas, tanques de agua.
- El estado: membrana agrietada, ampollada o despegada, chapas oxidadas o con agujeros, tornillos flojos, tejas rotas o corridas, canaletas tapadas u oxidadas, zinguería floja, babetas.
- De adentro: manchas de humedad, goteras, cielorraso dañado, para ubicar de dónde viene el agua.
- Si hay que impermeabilizar todo o solo reparar, si hace falta retirar la membrana vieja, si es alto o de difícil acceso (andamio, arnés).`,
    tips: 'Si llueve adentro, que ponga un balde y aleje lo eléctrico de la gotera mientras tanto.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 o 3 OPCIONES de la más económica a la más definitiva (por ejemplo: 1) reparar la zona que filtra; 2) membrana nueva en todo el techo; 3) techo nuevo o con aislación térmica).' },
  solar: { rol: 'instalador de energía solar (paneles fotovoltaicos y termotanques solares) con muchos años de experiencia en Argentina', foto: 'el techo o el lugar de la instalación, el tablero eléctrico, el termotanque actual y las boletas de luz o gas', m2: false, visita: true,
    guia: `- El techo: tipo (chapa, losa, tejas), orientación si se puede deducir (en Argentina conviene mirando al norte), sombras de árboles o edificios, espacio útil en m² y cuántos paneles entran (un panel ocupa ~2 m²).
- Si hay una boleta de luz en las fotos: el consumo mensual en kWh, para dimensionar cuántos paneles hacen falta (en Argentina un panel de ~550 W genera unos 60 a 80 kWh por mes según la zona).
- Si es termotanque solar: cuántas personas viven (si lo dice) y el tamaño (150, 200 o 300 litros), si hay agua de red con presión o tanque, y dónde va (techo plano o inclinado).
- El tablero eléctrico, para saber si hace falta adecuarlo (protecciones, inversor, medidor bidireccional si es conectado a red).
- Si es conectado a la red (on grid), aislado con baterías (off grid) o híbrido.`,
    tips: 'Contale cuánto podría ahorrar por mes y en cuántos años se paga, de forma aproximada y honesta.', opc: 'el cliente pregunta "¿qué me recomendás?". Proponele 3 OPCIONES (por ejemplo: 1) termotanque solar; 2) kit chico de paneles que cubre parte del consumo; 3) sistema completo que cubre casi todo el consumo, con o sin baterías). Decí el ahorro aproximado de cada una.' },
  aire: { rol: 'técnico en aire acondicionado y refrigeración con muchos años de experiencia en Argentina', foto: 'el equipo de aire acondicionado (unidad interior y exterior), el ambiente donde va y la etiqueta del equipo', m2: true, visita: true,
    guia: `- Si es instalación nueva: los m² del ambiente para calcular las frigorías (unas 50 a 60 frigorías por m², más si da el sol de la tarde o tiene mucho vidrio), dónde va la unidad interior y la exterior y cuántos metros de cañería hacen falta. Si hace falta soporte, altura o perforar losa.
- Si es service o reparación: la etiqueta (marca, frigorías, tipo de gas R22 o R410A), suciedad de filtros y serpentinas, hielo en los caños, pérdidas de agua en la unidad interior, óxido o golpes en la exterior, desagüe.
- Si la instalación eléctrica alcanza (equipos grandes necesitan línea propia).`,
    tips: 'Recomendale hacer el service antes del verano: limpia los filtros y gasta menos luz.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 o 3 OPCIONES (por ejemplo: 1) service y carga de gas; 2) reparación; 3) equipo nuevo inverter, que gasta menos luz).' },
  volquete: { rol: 'dueño de una empresa de volquetes y contenedores con muchos años de experiencia en Argentina', foto: 'lo que hay que llevarse (escombros, tierra, ramas, muebles viejos) y el lugar donde iría el contenedor (vereda, calle, entrada)', m2: false,
    guia: `- El VOLUMEN a retirar en m³: estimalo con referencias (una carretilla ~0,06 m³; una bolsa de consorcio llena ~0,1 m³; una puerta mide 2 × 0,8 m). Un volquete común es de unos 5 m³ (los hay de 3 a 7).
- Qué material es: escombros y tierra (pesan mucho: un volquete de escombro va hasta el borde, no más arriba), restos de poda y ramas, residuos de obra mezclados, muebles y cosas voluminosas. Lo que NO se puede tirar: residuos peligrosos (pinturas, aceites, amianto, baterías).
- Cuántos contenedores hacen falta y por cuántos días.
- El lugar: si entra el camión, si va en la vereda o en la calle (en muchos municipios hace falta permiso), si hay cables bajos o árboles que molesten, si hace falta cargarlo a mano (carga con mano de obra aparte).`,
    tips: 'Recordale que no lo llene por encima del borde y que no tire residuos peligrosos.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 o 3 OPCIONES (por ejemplo: 1) un volquete chico; 2) uno grande o dos chicos; 3) volquete más la carga con personal).' },
  tecnico: { rol: 'técnico en reparación de celulares, computadoras, televisores y electrónica con muchos años de experiencia en Argentina', foto: 'el equipo que hay que arreglar: celular, tablet, notebook, PC, televisor, consola u otro aparato, y la falla que se ve', m2: false, visita: true,
    guia: `- Identificá el equipo: tipo, marca y modelo aproximados (por el diseño, las cámaras, el logo o la etiqueta si se ve).
- La falla que se ve: pantalla rota o con manchas, rayas o líneas, táctil que no responde, tapa trasera rota, batería hinchada (tapa levantada: es peligroso), pin de carga sucio o roto, golpes, signos de humedad, teclas que faltan, bisagras rotas, TV con imagen pero sin sonido o con líneas, fuente quemada.
- Lo que cuenta el cliente (no prende, se apaga, no carga, se calienta, anda lento, se mojó) para orientar el diagnóstico.
- Trabajos típicos: cambio de módulo o pantalla, cambio de batería, cambio de pin de carga, limpieza por humedad, formateo y backup, cambio de disco a SSD, ampliación de memoria RAM, limpieza y cambio de pasta térmica, reparación de placa o fuente, retroiluminación de TV.
- Si conviene arreglarlo o si el arreglo sale casi como uno nuevo (decilo con honestidad).`,
    tips: 'Si la batería está hinchada, que no lo cargue más. Recordale hacer copia de sus fotos y datos si se puede.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 o 3 OPCIONES (por ejemplo: 1) repuesto alternativo, más económico; 2) repuesto original; 3) arreglarlo y mejorarlo, como pasar a disco SSD).' },
  afilador: { rol: 'afilador de cuchillos y herramientas con muchos años de oficio en Argentina', foto: 'lo que hay que afilar: cuchillos, tijeras, alicates de manicura, herramientas de jardín, cuchillas', m2: false,
    guia: `- Contá cuántas piezas hay de cada tipo: cuchillos de cocina, cuchillos de asado o de caza, cuchillas de carnicero, tijeras (de cocina, de costura, de peluquería), alicates de manicura, tijeras de podar, machetes, hachas, cuchillas de picadora o de máquinas.
- El estado de cada una: filo gastado, mellas o puntas rotas (llevan más trabajo), óxido, cabo flojo.
- Si alguna pieza es especial (cuchillos japoneses, tijeras de peluquería) y lleva un afilado más fino.`,
    tips: 'Contale cada cuánto conviene afilar y que no los lave en el lavavajillas.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 OPCIONES (por ejemplo: 1) solo afilado; 2) afilado más arreglo de puntas, mellas y cabos).' },
  mecanico: { rol: 'mecánico (de autos, motos y bicicletas) con muchos años de experiencia en Argentina', foto: 'el auto, la moto o la bicicleta: el tablero con las luces encendidas, el motor, las ruedas, la cadena, una pérdida o el lugar del ruido', m2: false, visita: true,
    guia: `- Identificá el vehículo: si es auto, moto o bicicleta, y marca, modelo y año aproximados si se ven.
- Si es BICICLETA: transmisión (cadena estirada u oxidada, piñones y platos gastados, cambios desajustados), frenos (pastillas, zapatas, cables, hidráulicos), ruedas (rayos, llantas torcidas, cubiertas y cámaras), suspensión, rodamientos, juego de dirección. Trabajos típicos: service completo, ajuste de cambios y frenos, centrado de rueda, cambio de cadena.
- Si es MOTO: cadena y corona (tensión, desgaste), frenos, cubiertas, batería, carburación o inyección, pérdidas de aceite, luces.
- TABLERO: qué testigos están encendidos (check engine, aceite, batería, temperatura, ABS, airbag, frenos) y qué suelen indicar. Kilometraje si se ve.
- MOTOR: nivel y color del aceite y del refrigerante si se ven, correas, mangueras, batería con sulfato en los bornes, pérdidas de aceite o líquido.
- RUEDAS Y FRENOS: desgaste de los neumáticos (parejo o de un costado, que indica alineación), discos con surcos o rebaba, amortiguadores con pérdida.
- Lo que cuenta el cliente (ruido, humo y su color, vibración, tironeo, no arranca) para orientar el diagnóstico.
- Los trabajos probables: service (aceite y filtros), frenos, tren delantero y alineación, embrague, distribución, batería, escaneo electrónico, chapa y pintura.`,
    tips: 'Es un diagnóstico orientativo: para confirmar hay que revisarlo en el taller (o escanearlo). Si hay testigo de aceite o temperatura en rojo, que no siga manejando.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 o 3 OPCIONES de la más económica a la más completa (por ejemplo: 1) arreglar lo urgente; 2) arreglar y hacer el service; 3) puesta a punto completa). Decí qué es urgente y qué puede esperar.' }
};

async function parqueIA(res, KEY, b, req) {
  const slug = String(b.slug || '');
  // oficios: el cliente manda fotos y lo que quiere hacer, y queda guardado para el profesional (sin IA, sin precio)
  if (b.soloGuardar && esDemo(slug)) return res.status(200).json({ guardado: true, demo: true });
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
  if (!ims.length) return res.status(400).json({ error: 'Subí al menos una foto.' });
  let t = null;
  try { const rows = await db('GET', '/rest/v1/tiendas?slug=eq.' + slug + '&select=owner,activa,data'); t = rows && rows[0]; } catch (e) {}
  if (!t || t.activa === false) return res.status(404).json({ error: 'Esta tienda no está disponible.' });
  if (b.soloGuardar) {
    const nom = String(b.nombre || '').trim().slice(0, 60), tel = String(b.tel || '').trim().slice(0, 30);
    if (!nom || tel.replace(/\D/g, '').length < 8) return res.status(400).json({ error: 'Poné tu nombre y tu WhatsApp.' });
    const fotos = (Array.isArray(b.images) ? b.images : []).slice(0, 4).filter(im => im && typeof im.data === 'string' && im.data.length > 1000 && im.data.length < 4000000);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), dir = scBase() + '/object/' + SC_BUCKET + '/pqpend/' + t.owner + '/';
    let idx = []; try { const r = await fetch(dir + 'index.json', { headers: scHead({ 'cache-control': 'no-cache' }) }); if (r.ok) idx = await r.json(); } catch (e) {}
    idx = Array.isArray(idx) ? idx : []; if (idx.length >= 60) return res.status(429).json({ error: 'Tiene muchos pedidos esperando. Escribile por WhatsApp.' });
    await fetch(dir + id + '.json', { method: 'POST', headers: scHead({ 'Content-Type': 'application/json', 'x-upsert': 'true' }), body: JSON.stringify({ images: fotos, m2: Number(b.m2) || 0, quiere: String(b.quiere || '').slice(0, 800) }) });
    idx.unshift({ id, nombre: nom, tel, fecha: new Date().toISOString(), quiere: String(b.quiere || '').slice(0, 200), m2: Number(b.m2) || 0, fotos: fotos.length });
    await fetch(dir + 'index.json', { method: 'POST', headers: scHead({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(idx) });
    return res.status(200).json({ guardado: true });
  }
  let preset = ''; try { preset = String((((t.data.stores || [])[t.data.active || 0] || {}).brand || {}).preset || ''); } catch (e) {}
  let OF = OFICIOS[preset] || null;
  if (!OF && preset === 'oficio') { let nom = ''; try { nom = String((((t.data.stores || [])[t.data.active || 0] || {}).brand || {}).oficio || '').slice(0, 60); } catch (e) {}
    nom = nom || 'profesional de oficios';
    OF = { rol: nom + ' con muchos años de experiencia en Argentina', foto: 'el trabajo que necesita (lo que hay que arreglar, instalar o hacer)', m2: false, visita: true,
      guia: `- Qué es y qué hay que hacer, como lo vería un ${nom} en la visita: materiales, medidas aproximadas (usá referencias como puertas ~2 m × 0,8 m), estado y si es reparación o hay que hacerlo nuevo.\n- Lo que puede complicar el trabajo (altura, acceso, desgaste, instalación vieja).`,
      tips: 'Si ves algún peligro, avisale al cliente.', opc: 'el cliente pregunta "¿qué me conviene?". Proponele 2 o 3 OPCIONES de la más económica a la más completa.' }; }
  // oficios: la IA mira las fotos y le hace al cliente las preguntas que haría el profesional (sin precio)
  if (b.modo === 'preguntas' && OF) {
    const quiere0 = String(b.quiere || '').slice(0, 300);
    const pr = `Sos ${OF.rol}. Un cliente te manda ${ims.length > 1 ? ims.length + ' fotos' : 'una foto'} de ${OF.foto}.${quiere0 ? ' Cuenta: "' + quiere0 + '".' : ''}
NO des precios ni presupuesto: el precio lo pone el profesional. Tu tarea es mirar la foto y hacerle al cliente las preguntas que el profesional le haría para poder presupuestar bien (por ejemplo: si quiere cambiar todo o arreglar solo esa parte, medidas, materiales, acceso, si sigue perdiendo, etc.). Preguntas cortas sobre lo que se ve en la foto Y sobre lo que cuenta el cliente: si el problema no se ve en la foto (por ejemplo un caño tapado por dentro, una falla eléctrica, un ruido), preguntá lo que hace falta saber (tamaño o diámetro del caño, cuántos metros, desde cuándo pasa, si ya probó algo, dónde está). Cada pregunta con 2 a 4 respuestas cortas para tocar.
Fijate en:
${OF.guia}
Respondé en español rioplatense (con "vos") y SOLO con JSON válido:
{"veo":"1 frase corta de lo que ves en la foto","seguridad":"advertencia importante si hay peligro, o vacío","preguntas":[{"p":"pregunta corta","ops":["respuesta","respuesta"]}]}
Entre 3 y 5 preguntas.`;
    const content = ims.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.type && /^image\/(jpeg|png|webp|gif)$/.test(im.type) ? im.type : 'image/jpeg', data: im.data } })).concat([{ type: 'text', text: pr }]);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.IA_MODEL_PREGUNTAS || 'claude-haiku-5-5', max_tokens: 900, messages: [{ role: 'user', content }] }) });
      const j = await r.json().catch(() => ({})); if (!r.ok) return res.status(502).json({ error: 'No se pudo mirar la foto.' });
      const txt = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''), m = txt.match(/\{[\s\S]*\}/);
      const o = m ? JSON.parse(m[0]) : {}, cut = (v, n) => String(v || '').slice(0, n);
      const preguntas = (Array.isArray(o.preguntas) ? o.preguntas : []).slice(0, 5).map(q => ({ p: cut(q.p, 120), ops: (Array.isArray(q.ops) ? q.ops : []).slice(0, 4).map(x => cut(x, 50)).filter(Boolean) })).filter(q => q.p && q.ops.length >= 2);
      return res.status(200).json({ veo: cut(o.veo, 240), seguridad: cut(o.seguridad, 240), preguntas });
    } catch (e) { return res.status(502).json({ error: 'No se pudo mirar la foto.' }); }
  }
  // los servicios y precios del parquero (o del profesional del oficio)
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
    if (row && estado(row).estado === 'activa') { pqPaga = true; const pr = planReal(row), P = PLANES()[pr] || {}; pqLim = Number(P.pq || (pr === 'pro' ? 150 : pr === 'comercio' ? 60 : 30)); } } catch (e) {}
  const metaO = owner.app_metadata || {}, mesPq = new Date().toISOString().slice(0, 7);
  const pqUsadas = pqPaga ? (metaO.pq_mes === mesPq ? Number(metaO.pq_usadas) || 0 : 0) : Number(metaO.pq_prueba) || 0;
  const libresPq = String(process.env.IA_SIN_LIMITE || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  if (!(owner.email && libresPq.includes(String(owner.email).toLowerCase())) && pqUsadas >= pqLim) {
    if (b._interno) return res.status(429).json({ error: 'Todavía no tenés presupuestos disponibles este mes: pasate al plan siguiente para destrabarlos.' });
    // sin cupo: el pedido del cliente queda guardado (con sus fotos) y el parquero lo destraba al pasar de plan
    const nom = String(b.nombre || '').trim().slice(0, 60), tel = String(b.tel || '').trim().slice(0, 30);
    if (b.guardar && nom && tel.replace(/\D/g, '').length >= 8) {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), dir = scBase() + '/object/' + SC_BUCKET + '/pqpend/' + t.owner + '/';
      let idx = []; try { const r = await fetch(dir + 'index.json', { headers: scHead({ 'cache-control': 'no-cache' }) }); if (r.ok) idx = await r.json(); } catch (e) {}
      idx = Array.isArray(idx) ? idx : []; if (idx.length >= 60) return res.status(429).json({ error: 'El parquero tiene muchos pedidos esperando. Escribile por WhatsApp.' });
      await fetch(dir + id + '.json', { method: 'POST', headers: scHead({ 'Content-Type': 'application/json', 'x-upsert': 'true' }), body: JSON.stringify({ images: ims, m2: Number(b.m2) || 0, quiere: String(b.quiere || '').slice(0, 300) }) });
      idx.unshift({ id, nombre: nom, tel, fecha: new Date().toISOString(), quiere: String(b.quiere || '').slice(0, 120), m2: Number(b.m2) || 0, fotos: ims.length });
      await fetch(dir + 'index.json', { method: 'POST', headers: scHead({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(idx) });
      return res.status(200).json({ guardado: true });
    }
    return res.status(429).json({ cupo: true, error: 'Este mes el parquero ya usó todos sus presupuestos automáticos. Dejá tu nombre y tu WhatsApp: tus fotos quedan guardadas y te manda el presupuesto.' });
  }
  const sumarPq = async () => { try { const h = { apikey: SK, 'Content-Type': 'application/json' }; if (String(SK).startsWith('eyJ')) h.Authorization = 'Bearer ' + SK;
    const cambio = pqPaga ? { pq_mes: mesPq, pq_usadas: pqUsadas + 1 } : { pq_prueba: pqUsadas + 1 };
    await fetch(base + '/auth/v1/admin/users/' + t.owner, { method: 'PUT', headers: h, body: JSON.stringify({ app_metadata: Object.assign({}, metaO, cambio) }) }); } catch (e) {} };
  const m2 = Math.max(0, Math.min(200000, Number(b.m2) || 0));
  const quiere = String(b.quiere || '').slice(0, 300);
  const opciones = b.modo === 'opciones', diseno = b.modo === 'diseno' || opciones, estilo = String(b.estilo || '').slice(0, 120);
  // plantas y materiales: los del parquero (productos que no son servicios) + los de los viveros que conectó (sus tiendas ShopFlash)
  const cat = [];
  if (diseno) {
    const add = (p, v, vslug) => { if (!p || !p.name || p.service || p.sample || cat.length >= 220) return; cat.push({ n: String(p.name).slice(0, 70), precio: pnum(p.price), v: v, slug: vslug }); };
    try { (t.data.stores || []).forEach(st => (st.products || []).forEach(p => add(p, 'el parquero', slug))); } catch (e) {}
    try { const bv = ((t.data.stores || [])[t.data.active || 0] || {}).brand || {};
      const vs = (Array.isArray(bv.viveros) ? bv.viveros : []).filter(x => x && (OF || x.tipo !== 'taller')).map(x => String(x && x.slug || '')).filter(x => /^[a-z0-9-]{3,40}$/.test(x)).slice(0, 5);
      if (vs.length) { const rows = await db('GET', '/rest/v1/tiendas?slug=in.(' + vs.join(',') + ')&select=slug,nombre,data,activa');
        (rows || []).filter(r => r.activa !== false).forEach(r => { const d = r.data || {}, st = (d.stores || [])[d.active || 0] || {}, nom = String((st.brand || {}).name || r.nombre || r.slug).slice(0, 40);
          (st.products || []).slice(0, 80).forEach(p => add(p, nom, r.slug)); }); } } catch (e) {}
  }
  const promptOficio = OF ? `Sos ${OF.rol}. Un cliente te manda ${ims.length > 1 ? ims.length + ' fotos' : 'una foto'} de ${OF.foto} para que le pases un presupuesto.
Mirá con atención, como lo haría un profesional en la visita, y fijate en:
${OF.guia}${OF.m2 && m2 ? '\nEl cliente midió ' + m2 + ' m²: usá ese número.' : ''}
${quiere ? 'Lo que cuenta o pide el cliente: "' + quiere + '".\nIMPORTANTE: presupuestá SOLO lo que el cliente pide (por ejemplo, si pide cambiar el pico o el cuerito de la canilla, no le sumes cambiar toda la grifería). Lo demás que veas en la foto, no lo sumes a "trabajos": mencionalo en "analisis" como sugerencia ("además vi que…").\n' : ''}Trabajos y precios del profesional (usá EXACTAMENTE estos nombres cuando correspondan; "m2": true quiere decir precio por m²):
${JSON.stringify(servs)}
Para cada trabajo: si hay uno de la lista que corresponde, poné su nombre exacto en "servicio". En "cantidad" poné las unidades (bocas, artefactos, metros de caño, aberturas, horas). Si el trabajo es más difícil de lo normal (altura, romper pared, instalación vieja, mucho deterioro), poné un "ajuste_pct" positivo con el motivo. Si no hay ninguno de la lista que corresponda, dejá "servicio" vacío y poné en "precio_estimado" un precio total razonable de mano de obra en pesos argentinos de hoy. Los materiales y repuestos importantes ponelos como trabajos aparte con "precio_estimado".
En "diagnostico" poné cada cosa que ves: qué es, el detalle (medida, tipo, material), el estado y qué trabajo necesita.
${OF.tips}
${opciones ? 'ADEMÁS ' + OF.opc + ' Cada opción con sus propios trabajos (y en "plan" los materiales importantes, usando en lo posible este catálogo de sus proveedores; "i" es su posición, "v" quién lo vende: ' + JSON.stringify(cat.map((x, i) => ({ i, n: x.n, precio: x.precio, v: x.v }))) + '; si no está, "i": -1 y "precio_estimado").\n' : ''}Sé honesto: es una estimación por foto${OF.visita ? ' y el precio final se confirma en la visita' : ''}. Si en las fotos no se ve nada de ${OF.foto.split(':')[0]}, devolvé {"error":"…"} en una frase corta diciendo qué foto sacar.
Respondé en español rioplatense (con "vos") y SOLO con JSON válido:
{"analisis":"2 o 3 frases de lo que ves y qué le pasa","m2":${OF.m2 ? 'número' : '0'},"m2_confianza":"baja|media|alta","diagnostico":[{"que":"…","detalle":"…","estado":"…","trabajo":"…"}],"urgencia":"baja|media|alta","seguridad":"advertencia importante para el cliente o vacío","visita":true|false,"trabajos":[{"titulo":"nombre corto del trabajo","servicio":"nombre exacto o vacío","cantidad":número,"unidad":"m2|unidad|trabajo","ajuste_pct":número,"motivo":"…","precio_estimado":número}],"consejo":"1 frase útil para el cliente","tiempo":"duración aproximada del trabajo"${opciones ? ',"opciones":[{"titulo":"nombre corto","descripcion":"2 frases de qué incluye y para quién conviene","estilo":"colores o materiales sugeridos, o vacío","mantenimiento":"bajo|medio|alto","trabajos":[igual que arriba],"plan":[{"i":número,"que":"…","cantidad":número,"donde":"…","por_que":"…","precio_estimado":número}]}]' : ''}}` : '';
  const prompt = OF ? promptOficio : `Sos un parquero y paisajista con muchos años de experiencia en Argentina. Un cliente te manda ${ims.length > 1 ? ims.length + ' fotos' : 'una foto'} de su parque, jardín o terreno para que le pases un presupuesto.
Mirá con atención y estimá, como lo haría un profesional en la visita:
- La superficie de césped o terreno a trabajar en m² (usá referencias: puertas ~2 m de alto y ~0,8 m de ancho, ladrillos, baldosas de 30–40 cm, autos ~4,5 m, cercos ~1,8 m, personas).${m2 ? ' El cliente midió ' + m2 + ' m²: usá ese número.' : ''}
- La altura aproximada del pasto en cm y su estado (prolijo, crecido, muy crecido/abandonado, con malezas, seco, con pozos).
- Cada planta, arbusto, cerco o árbol que haya que trabajar: qué es, tamaño aproximado (altura en metros, ancho), estado y qué trabajo necesita (poda de mantenimiento, poda de formación, rebaje, extracción, etc.).
- Si hay que limpiar (ramas, hojas, escombros), desmalezar, bordear o retirar residuos.
${quiere ? 'Lo que pide el cliente: "' + quiere + '".\n' : ''}Servicios y precios del parquero (usá EXACTAMENTE estos nombres cuando correspondan; "m2": true quiere decir precio por m²):
${JSON.stringify(servs)}
Para cada trabajo: si hay un servicio de la lista que corresponde, poné su nombre exacto en "servicio". Si el parquero tiene precios distintos según la altura del pasto, elegí el que corresponde a la altura que ves. Si un servicio es "por metro lineal" (cercos, bordes, surcos, canteros), poné en "cantidad" los metros que estimás; si es por árbol o por planta, la cantidad de árboles o plantas; si es por viaje, los viajes. Si el pasto está muy crecido, hay mucha maleza, el terreno es difícil o la planta es muy grande, poné un "ajuste_pct" positivo (por ejemplo 30 o 60) con el motivo; si es fácil, 0. Si NO hay un servicio de la lista, poné "servicio": "" y en "precio_estimado" un precio razonable en pesos argentinos de hoy para ese trabajo completo.
${opciones ? `ADEMÁS el cliente pregunta "¿qué me recomendás para este patio?". Proponele 3 OPCIONES bien distintas, de la más simple y económica a la más completa (por ejemplo: 1) dejarlo prolijo: corte, bordes y limpieza; 2) prolijo + canteros con plantas; 3) rediseño completo con plantas, piedras o corteza, y luces si queda bien). Cada opción con sus propios trabajos y su propio plan de plantas y materiales. Pensá en el sol y la sombra que ves, el clima de Argentina y el mantenimiento. Usá en lo posible este catálogo ("i" es su posición; "v" es el vivero que lo vende): ${JSON.stringify(cat.map((x, i) => ({ i, n: x.n, precio: x.precio, v: x.v })))}. Si algo no está en el catálogo, poné "i": -1 y un "precio_estimado" por unidad en pesos argentinos de hoy.
` : diseno ? `ADEMÁS el cliente quiere REDISEÑAR su parque${estilo ? ' con este estilo: "' + estilo + '"' : ''}. Armá un plan concreto y realizable: qué poner, cuántas unidades y dónde (por ejemplo "frente, contra el cerco, al sol"), pensando en el sol y la sombra que ves, el clima de Argentina y poco mantenimiento. Usá en lo posible plantas y materiales de este catálogo (el número "i" es su posición; "v" es el vivero que lo vende): ${JSON.stringify(cat.map((x, i) => ({ i, n: x.n, precio: x.precio, v: x.v })))}. Si algo necesario no está en el catálogo, poné "i": -1 y un "precio_estimado" por unidad en pesos argentinos de hoy. Agregá también en "trabajos" la mano de obra del rediseño (preparar la tierra, plantar, colocar piedras, etc.) con los servicios del parquero si corresponden.
` : ''}Sé honesto: es una estimación por foto. Si en las fotos no se ve un parque, jardín, patio o terreno, devolvé {"error":"…"} en una frase corta diciendo qué foto sacar.
Respondé en español rioplatense (con "vos") y SOLO con JSON válido:
{"analisis":"2 o 3 frases de lo que ves","m2":número,"m2_confianza":"baja|media|alta","pasto_cm":número,"pasto_estado":"…","plantas":[{"que":"…","tamano":"…","estado":"…","trabajo":"…"}],"trabajos":[{"titulo":"nombre corto del trabajo","servicio":"nombre exacto o vacío","cantidad":número,"unidad":"m2|unidad|trabajo","ajuste_pct":número,"motivo":"…","precio_estimado":número}],"consejo":"1 frase útil para el cliente","tiempo":"duración aproximada del trabajo"${opciones ? ',"opciones":[{"titulo":"nombre corto y atractivo","descripcion":"2 frases de cómo queda y para quién conviene","estilo":"estilo visual en pocas palabras, para dibujarlo","mantenimiento":"bajo|medio|alto","trabajos":[igual formato que trabajos],"plan":[{"que":"…","cantidad":número,"donde":"…","por_que":"…","i":número,"precio_estimado":número}]}]' : diseno ? ',"plan":[{"que":"planta o material","cantidad":número,"donde":"dónde va","por_que":"por qué conviene, corto","i":número,"precio_estimado":número}],"resumen":"2 frases de cómo va a quedar el parque"' : ''}}`;
  // presupuesto común: IA rápida y más económica; rediseño del parque (plantas, viveros): la más potente
  const model = diseno ? (process.env.IA_MODEL_PARQUE || 'claude-opus-5-5') : (process.env.IA_MODEL_PRESUPUESTO || 'claude-sonnet-5-5');
  const ask = () => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: opciones ? 7000 : 4000, messages: [{ role: 'user', content: [
      ...ims.map(im => ({ type: 'image', source: { type: 'base64', media_type: TYPES.includes(im.type) ? im.type : 'image/jpeg', data: im.data } })),
      { type: 'text', text: prompt }] }] })
  });
  try {
    let r = await ask(), j = await r.json().catch(() => ({}));
    for (let k = 0; k < 2 && !r.ok && [429, 500, 502, 503, 529].includes(r.status); k++) { await new Promise(ok => setTimeout(ok, 1500 * (k + 1))); r = await ask(); j = await r.json().catch(() => ({})); }
    if (!r.ok) return res.status(502).json({ error: 'No pude analizar las fotos ahora. Probá en un rato.' });
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    let out = null; try { out = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch (e) {}
    if (!out) return res.status(502).json({ error: 'No pude leer bien las fotos. Probá con otras, con buena luz y que se vea bien todo.' });
    if (out.error) return res.status(422).json({ error: String(out.error).slice(0, 300) });
    await sumarPq();
    const s = (v, n) => String(v == null ? '' : v).slice(0, n || 300), num = v => Math.max(0, Number(v) || 0);
    const M2 = m2 || Math.round(num(out.m2));
    // el precio lo arma el servidor con los precios del parquero (la IA solo estima cantidades y dificultad)
    const mapTrab = arr => (Array.isArray(arr) ? arr : []).slice(0, 12).map(x => {
      const sv = servs.find(v => v.n.toLowerCase() === String(x.servicio || '').toLowerCase().trim());
      const aj = Math.max(-30, Math.min(150, Number(x.ajuste_pct) || 0));
      const porM2 = sv ? sv.m2 : x.unidad === 'm2';
      const cant = porM2 ? 0 : Math.max(1, Math.min(500, Math.round(num(x.cantidad) || 1)));
      const precio = sv && sv.precio ? sv.precio : num(x.precio_estimado) / (porM2 ? Math.max(1, M2) : (cant || 1));
      return { titulo: s(x.titulo, 80), servicio: sv ? sv.n : '', porM2, cantidad: cant, precio: Math.round(precio * 100) / 100, ajuste: aj, motivo: s(x.motivo, 160), estimado: !(sv && sv.precio) };
    }).filter(x => x.titulo);
    const mapPlan = arr => (Array.isArray(arr) ? arr : []).slice(0, 15).map(x => { const it = cat[Number(x.i)] && Number(x.i) >= 0 ? cat[Number(x.i)] : null;
        return { que: s(it ? it.n : x.que, 80), cantidad: Math.max(1, Math.min(300, Math.round(num(x.cantidad) || 1))), donde: s(x.donde, 100), por_que: s(x.por_que, 140),
          precio: it && it.precio ? it.precio : num(x.precio_estimado), vivero: it ? it.v : '', link: it && it.slug !== slug ? '/t/' + it.slug : '', estimado: !(it && it.precio) }; }).filter(x => x.que);
    const trabajos = mapTrab(out.trabajos);
    return res.status(200).json({ analisis: s(out.analisis, 600), m2: M2, m2_confianza: ['baja', 'media', 'alta'].includes(out.m2_confianza) ? out.m2_confianza : 'baja',
      pasto_cm: Math.round(num(out.pasto_cm)), pasto_estado: s(out.pasto_estado, 120), consejo: s(out.consejo, 300), tiempo: s(out.tiempo, 80),
      plantas: (Array.isArray(OF ? out.diagnostico : out.plantas) ? (OF ? out.diagnostico : out.plantas) : []).slice(0, 10).map(p => ({ que: s(p.que, 60), tamano: s(OF ? p.detalle : p.tamano, 80), estado: s(p.estado, 80), trabajo: s(p.trabajo, 100) })),
      ...(OF ? { oficio: preset, urgencia: ['baja', 'media', 'alta'].includes(out.urgencia) ? out.urgencia : '', seguridad: s(out.seguridad, 300), visita: OF.visita ? true : !!out.visita } : {}),
      trabajos,
      ...(opciones ? { opciones: (Array.isArray(out.opciones) ? out.opciones : []).slice(0, 3).map(o => ({ titulo: s(o.titulo, 60), descripcion: s(o.descripcion, 300), estilo: s(o.estilo, 120),
          mantenimiento: ['bajo', 'medio', 'alto'].includes(o.mantenimiento) ? o.mantenimiento : '', trabajos: mapTrab(o.trabajos), plan: mapPlan(o.plan) })).filter(o => o.titulo) }
        : diseno ? { resumen: s(out.resumen, 400), plan: mapPlan(out.plan) } : {}) });
  } catch (e) { return res.status(502).json({ error: 'No se pudo hablar con la IA.' }); }
}

// ---- Parquería: los pedidos que quedaron guardados cuando se terminó el cupo (el parquero los ve y los destraba al pasar de plan)
async function pqPendientes(req, res, KEY, b) {
  const u = await usuario(req); if (!u) return res.status(401).json({ error: 'Tenés que entrar a tu tienda.' });
  const rows = await db('GET', '/rest/v1/tiendas?owner=eq.' + u.id + '&select=slug');
  const row = rows && rows[0]; if (!row) return res.status(404).json({ error: 'Todavía no creaste tu tienda.' });
  const dir = scBase() + '/object/' + SC_BUCKET + '/pqpend/' + u.id + '/';
  let idx = []; try { const r = await fetch(dir + 'index.json', { headers: scHead({ 'cache-control': 'no-cache' }) }); if (r.ok) idx = await r.json(); } catch (e) {}
  idx = Array.isArray(idx) ? idx : [];
  if (b.pqPendientes) return res.status(200).json({ pendientes: idx });
  // el profesional mira las fotos y todo lo que contó el cliente (sin IA), o lo marca como respondido
  if (b.pqVer || b.pqListo) {
    const it0 = idx.find(x => x.id === String(b.pqVer || b.pqListo)); if (!it0) return res.status(404).json({ error: 'Ese pedido ya no está.' });
    if (b.pqListo) { try { await fetch(dir + it0.id + '.json', { method: 'DELETE', headers: scHead() }); } catch (e) {}
      const resto0 = idx.filter(x => x.id !== it0.id);
      await fetch(dir + 'index.json', { method: 'POST', headers: scHead({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(resto0) });
      return res.status(200).json({ ok: true, quedan: resto0.length }); }
    let f0 = null; try { const r = await fetch(dir + it0.id + '.json', { headers: scHead() }); if (r.ok) f0 = await r.json(); } catch (e) {}
    if (!f0) return res.status(404).json({ error: 'No encontré las fotos de ese pedido.' });
    return res.status(200).json({ fotos: (f0.images || []).map(im => 'data:' + (im.type || 'image/jpeg') + ';base64,' + im.data), quiere: f0.quiere || '', m2: f0.m2 || 0 });
  }
  const it = idx.find(x => x.id === String(b.pqProcesar)); if (!it) return res.status(404).json({ error: 'Ese pedido ya no está.' });
  let f = null; try { const r = await fetch(dir + it.id + '.json', { headers: scHead() }); if (r.ok) f = await r.json(); } catch (e) {}
  if (!f || !Array.isArray(f.images)) return res.status(404).json({ error: 'No encontré las fotos de ese pedido.' });
  // se arma con el mismo análisis que ve el cliente (y cuenta como un presupuesto del mes)
  const out = await new Promise(ok => { const fr = { _s: 200, status(s) { this._s = s; return this; }, setHeader() {}, json(j) { ok([this._s, j]); }, send(x) { ok([this._s, x]); }, end() { ok([this._s, {}]); } };
    parqueIA(fr, KEY, { parque: 1, slug: row.slug, images: f.images, m2: f.m2, quiere: f.quiere, _interno: 1 }, req); });
  if (out[0] !== 200) return res.status(out[0]).json(out[1]);
  try { await fetch(dir + it.id + '.json', { method: 'DELETE', headers: scHead() }); } catch (e) {}
  const resto = idx.filter(x => x.id !== it.id);
  await fetch(dir + 'index.json', { method: 'POST', headers: scHead({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(resto) });
  return res.status(200).json({ cliente: it, presupuesto: out[1], quedan: resto.length });
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
