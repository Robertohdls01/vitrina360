// Vitrina 360 · IA para reconocer productos. La clave de Anthropic vive en Vercel (variable ANTHROPIC_API_KEY), nunca en la página.
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
module.exports = async (req, res) => {
  const KEY = process.env.ANTHROPIC_API_KEY, SURL = process.env.SUPABASE_URL, SKEY = process.env.SUPABASE_KEY;
  const ready = !!(KEY && SURL && SKEY);
  if (req.method === 'GET') return res.status(200).json({ ok: ready });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!ready) return res.status(503).json({ error: 'La IA todavía no está configurada.' });

  const tok = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tok) return res.status(401).json({ error: 'Tenés que entrar a tu tienda.' });
  try {
    const u = await fetch(SURL.replace(/\/+$/, '') + '/auth/v1/user', { headers: { apikey: SKEY, Authorization: 'Bearer ' + tok } });
    if (!u.ok) return res.status(401).json({ error: 'Tu sesión venció. Volvé a entrar.' });
  } catch (e) { return res.status(502).json({ error: 'No se pudo verificar la sesión.' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const prompt = body && typeof body.prompt === 'string' ? body.prompt : '';
  const images = Array.isArray(body && body.images) ? body.images : [];
  if (!prompt || prompt.length > 30000) return res.status(400).json({ error: 'Pedido vacío o demasiado largo.' });
  if (images.length > 8) return res.status(400).json({ error: 'Demasiadas fotos juntas.' });
  const content = [];
  for (const im of images) {
    if (!im || typeof im.data !== 'string' || im.data.length > 5000000) return res.status(400).json({ error: 'Foto inválida o muy pesada.' });
    content.push({ type: 'image', source: { type: 'base64', media_type: TYPES.includes(im.type) ? im.type : 'image/jpeg', data: im.data } });
  }
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
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: 'No se pudo hablar con la IA.' });
  }
};
