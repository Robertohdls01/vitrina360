// Vitrina 360 · Probador virtual con IA de imágenes (Google Gemini). La clave vive en Vercel: GEMINI_API_KEY.
//   GET  /api/probador            → { ok } (si está activado)
//   POST /api/probador { slug | (Bearer del dueño), tipo: 'ropa'|'perro'|'look', nombre, detalle, foto, prenda? }
//        foto y prenda: imágenes en base64 (data:image/jpeg;base64,...) o prenda como link https.
//        → { img: 'data:image/...;base64,...' }
// Las fotos de los clientes NO se guardan: se mandan a Google, vuelve la imagen y listo.
// Límites para que no se dispare el gasto: PROBADOR_TIENDA_DIA (40 por tienda por día) y PROBADOR_CLIENTE_DIA (4 por cliente por día).
// Modelo: GEMINI_IMAGE_MODEL (por defecto gemini-2.5-flash-image).
const { cuerpo, usuario, db, estado, stHeaders } = require('./_comun');

const SURL = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const B = 'probador';
const corto = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const MAXB = 3.2e6;   // tamaño máximo de cada imagen en base64

let listo = false;
async function bucket() {
  if (listo) return;
  try { await fetch(SURL() + '/storage/v1/bucket', { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ id: B, name: B, public: false }) }); } catch (e) {}
  listo = true;
}
async function leer(path) {
  try { const r = await fetch(SURL() + '/storage/v1/object/' + B + '/' + path, { headers: stHeaders({ 'cache-control': 'no-cache' }) }); return r.ok ? await r.json() : null; } catch (e) { return null; }
}
async function guardar(path, obj) {
  const put = () => fetch(SURL() + '/storage/v1/object/' + B + '/' + path, { method: 'POST', headers: stHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' }), body: JSON.stringify(obj) });
  try { let r = await put(); if (!r.ok) { listo = false; await bucket(); r = await put(); } } catch (e) {}
}
function dataPart(s) {
  const m = String(s || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2].length > MAXB) return null;
  return { inline_data: { mime_type: m[1], data: m[2] } };
}
async function urlPart(u) {
  if (!/^https:\/\/[^\s]+$/i.test(String(u || ''))) return null;
  try {
    const r = await fetch(u); if (!r.ok) return null;
    const type = (r.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > MAXB * 0.75) return null;
    return { inline_data: { mime_type: type, data: buf.toString('base64') } };
  } catch (e) { return null; }
}
function prompt(tipo, nombre, detalle, conRef) {
  const prod = `"${nombre}"${detalle ? ' (' + detalle + ')' : ''}`;
  if (tipo === 'perro') return `The first image is a photo of a dog. Edit it to show the SAME dog after a professional grooming session with this haircut: ${prod}.` +
    (conRef ? ' The second image is a reference of that haircut style.' : '') +
    ' Keep exactly the same dog: breed, fur color and markings, eyes, nose, face, size, pose and background. Only change the fur length and shape as a skilled groomer would. Photorealistic, natural light, no text, no watermark.';
  if (tipo === 'look') return `The first image is a photo of a person. Edit it to show the SAME person with this beauty service done: ${prod}.` +
    (conRef ? ' The second image is a reference of the result.' : '') +
    ' Keep the same face, identity, skin tone, expression, pose, clothes and background. Only change what that service changes (hair, makeup, nails, brows or lashes). Photorealistic, flattering natural light, no text, no watermark.';
  return (conRef ? `The first image is a photo of a person. The second image is a product from a store: ${prod}. Generate a photorealistic image of the SAME person from the first image wearing or using that product.`
    : `The image is a photo of a person. Generate a photorealistic image of the SAME person wearing or using this product from a store: ${prod}.`) +
    ' Keep the person exactly the same: face, identity, body shape, skin tone, hair, pose and background. Reproduce the product faithfully: color, pattern, fabric, cut, length, details. If the product is an accessory (glasses, bag, watch, jewelry, cap, shoes), place it naturally on the person. Natural light, no text, no watermark.';
}

// En pausa hasta cargar saldo en Google: las tiendas muestran el botón con "Próximamente".
// Para activarlo: poner PAUSADO = false (o la variable PROBADOR_ACTIVO=1 en Vercel).
const PAUSADO = process.env.PROBADOR_ACTIVO !== '1';

module.exports = async (req, res) => {
  const KEY = PAUSADO ? '' : process.env.GEMINI_API_KEY;
  // si Google dijo que no hay saldo, el botón se esconde en todas las tiendas por 6 horas (y se vuelve a intentar solo)
  if (req.method === 'GET') {
    let ok = !!KEY;
    if (ok && process.env.SUPABASE_SERVICE_KEY) { const f = await leer('sin-saldo.json'); if (f && Date.now() - f.t < 6 * 3600e3) ok = false; }
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).json({ ok });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
  if (!KEY) return res.status(503).json({ error: 'El probador todavía no está activado en esta tienda.' });
  if (!process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'Todavía no está configurado.' });
  const b = cuerpo(req) || {};
  const tipo = ['ropa', 'perro', 'look'].includes(b.tipo) ? b.tipo : 'ropa';
  const foto = dataPart(b.foto);
  if (!foto) return res.status(400).json({ error: 'Subí una foto (JPG o PNG) para probar.' });

  // ¿de qué tienda es? el dueño probando desde su panel, o un cliente desde la tienda pública
  let row = null, dueno = false;
  try {
    const u = await usuario(req).catch(() => null);
    if (u && u.id) { const r = await db('GET', '/rest/v1/tiendas?owner=eq.' + u.id + '&select=owner,slug,plan,pagada_hasta,prueba_hasta,activa'); row = r && r[0]; dueno = !!row; }
    if (!row && /^[a-z0-9-]{3,40}$/.test(String(b.slug || ''))) { const r = await db('GET', '/rest/v1/tiendas?slug=eq.' + b.slug + '&select=owner,slug,plan,pagada_hasta,prueba_hasta,activa'); row = r && r[0]; }
  } catch (e) {}
  if (!row) return res.status(404).json({ error: 'No encontramos la tienda.' });
  const st = estado(row).estado;
  if (row.activa === false || (st !== 'activa' && st !== 'prueba')) return res.status(403).json({ error: 'El probador no está disponible en esta tienda por ahora.' });

  // límites por día
  const dia = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // día de Argentina
  const ip = String(req.headers['x-forwarded-for'] || req.socket && req.socket.remoteAddress || '').split(',')[0].trim() || 'x';
  const path = 'c/' + row.slug + '/' + dia + '.json';
  const cnt = (await leer(path)) || { total: 0, ips: {} };
  const limT = Math.max(0, Number(process.env.PROBADOR_TIENDA_DIA || 40)), limC = Math.max(0, Number(process.env.PROBADOR_CLIENTE_DIA || 4));
  if (cnt.total >= limT) return res.status(429).json({ error: 'El probador de esta tienda ya se usó mucho hoy. Probá de nuevo mañana.' });
  if (!dueno && (cnt.ips[ip] || 0) >= limC) return res.status(429).json({ error: `Ya usaste las ${limC} pruebas de hoy. Mañana podés probar de nuevo.` });

  const ref = b.prenda ? (dataPart(b.prenda) || await urlPart(b.prenda)) : null;
  const parts = [{ text: prompt(tipo, corto(b.nombre, 90) || 'producto', corto(b.detalle, 160), !!ref) }, foto];
  if (ref) parts.push(ref);

  let r, j;
  try {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image') + ':generateContent', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } })
    });
    j = await r.json().catch(() => null);
  } catch (e) { return res.status(502).json({ error: 'No pudimos conectar con la IA. Probá de nuevo en un ratito.' }); }
  if (!r.ok) {
    const msg = String(j && j.error && j.error.message || '');
    console.error('probador', r.status, msg.slice(0, 300));
    if (r.status === 429 || /quota|billing|exhausted|free tier/i.test(msg)) { await guardar('sin-saldo.json', { t: Date.now(), msg: msg.slice(0, 200) }); return res.status(503).json({ error: 'El probador está sin saldo por ahora. Si sos el dueño de Vitrina 360: hay que cargar saldo en Google AI Studio (Configurar prepago).', saldo: true }); }
    if (r.status === 400 && /api key/i.test(msg)) return res.status(503).json({ error: 'La clave de Google no es válida. Revisá GEMINI_API_KEY en Vercel.' });
    return res.status(502).json({ error: 'La IA no pudo generar la imagen. Probá con otra foto, de frente y con buena luz.' });
  }
  const cand = j && j.candidates && j.candidates[0], out = cand && cand.content && (cand.content.parts || []).find(p => p.inlineData || p.inline_data);
  const d = out && (out.inlineData || out.inline_data);
  if (!d || !d.data) {
    const why = cand && cand.finishReason;
    return res.status(422).json({ error: why && /SAFETY|PROHIBITED|IMAGE_SAFETY/.test(why) ? 'Esa foto no se puede usar para el probador. Probá con otra.' : 'La IA no devolvió imagen. Probá con otra foto, de frente y con buena luz.' });
  }
  cnt.total++; cnt.ips[ip] = (cnt.ips[ip] || 0) + 1;
  await guardar(path, cnt);
  return res.status(200).json({ img: 'data:' + (d.mimeType || d.mime_type || 'image/png') + ';base64,' + d.data, quedan: dueno ? null : Math.max(0, limC - cnt.ips[ip]) });
};
