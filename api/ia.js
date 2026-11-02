// Vitrina 360 · IA para reconocer productos. La clave de Anthropic vive en Vercel (variable ANTHROPIC_API_KEY), nunca en la página.
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const { db, estado } = require('./_comun');

// Cupo de productos reconocidos con IA (se guarda en la cuenta del comerciante, donde él no lo puede tocar).
// Prueba gratis o cuenta sin pagar: LIMITE_FOTOS_PRUEBA en total (10). Planes pagos: por mes, se renueva el día 1:
// LIMITE_FOTOS_START (350), LIMITE_FOTOS_PLUS (700), LIMITE_FOTOS_PRO (2500); alcanza para llenar la tienda entera en un mes. IA_SIN_LIMITE (mails separados por coma) no tiene límite.
const PLAN_CUPO = { emprendedora: ['LIMITE_FOTOS_START', 350, 'Start'], comercio: ['LIMITE_FOTOS_PLUS', 700, 'Plus'], pro: ['LIMITE_FOTOS_PRO', 2500, 'Pro'] };
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
  const system = 'Sos el asistente de Vitrina 360, una tienda online con vitrinas que giran. Ayudás al dueño o la dueña del comercio a vender: '
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
