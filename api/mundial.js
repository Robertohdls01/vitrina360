// ShopRevista Mundial · suscripción (US$4 por mes). Somos el puente: esto paga solo el buscador y la ayuda de Flashy.
//   POST /api/mundial?accion=suscribir {metodo:'mp'|'paypal'|'astropay'|'binance', email?}  → {codigo, url?}
//        Mercado Pago: suscripción automática. PayPal, AstroPay y Binance: pago a mano por WhatsApp y Roberto lo activa.
//   GET  /api/mundial?codigo=…                         → {activo, hasta, metodo, estado}
//   GET  /api/mundial?admin=CLAVE                      → lista de suscripciones (panel de Roberto)
//   POST /api/mundial?accion=activar {admin, codigo, meses}   activa o extiende una suscripción pagada a mano
const crypto = require('crypto');
const { cuerpo, mp } = require('./_comun');

const BUCKET = 'pedidos', DIR = 'mundial/subs/';
const base = () => String(process.env.SUPABASE_URL || '').replace(/\/+$/, '') + '/storage/v1';
const head = extra => { const k = process.env.SUPABASE_SERVICE_KEY, h = Object.assign({ apikey: k }, extra || {}); if (String(k).startsWith('eyJ')) h.Authorization = 'Bearer ' + k; return h; };
async function leer(path) { const r = await fetch(base() + '/object/' + BUCKET + '/' + path, { headers: head() }); return r.ok ? r.json().catch(() => null) : null; }
async function guardar(path, obj) { await fetch(base() + '/object/' + BUCKET + '/' + path, { method: 'POST', headers: head({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-store' }), body: JSON.stringify(obj) }); }
async function listar() {
  const r = await fetch(base() + '/object/list/' + BUCKET, { method: 'POST', headers: head({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefix: DIR, limit: 1000, sortBy: { column: 'created_at', order: 'desc' } }) });
  return r.ok ? r.json().catch(() => []) : [];
}
const PRECIO_ARS = () => Number(process.env.MUNDIAL_PRECIO_ARS) || 5900;
const okCod = c => /^[A-Z0-9]{8}$/.test(String(c || ''));
const nuevoCod = () => Array.from(crypto.randomBytes(8), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const esAdmin = k => { const a = String(process.env.MUNDIAL_ADMIN || ''); return a.length >= 12 && String(k || '') === a; };
const METODOS = ['mp', 'paypal', 'astropay', 'binance'];
// Dónde pagar a mano (se muestra después de pedir el código). AstroPay (Astrotag) y Binance se agregan cuando estén.
const DATOS_PAGO = { paypal: 'robertohdls01@gmail.com', binance: 'https://app.binance.com/uni-qr/SmWw4LdS' };
// ShopGuía: pases por días para turistas (pago único). Precios en pesos (Mercado Pago) y en dólares (resto del mundo).
const PASES = () => { try { const j = JSON.parse(process.env.GUIA_PASES || ''); if (j && j['3']) return j; } catch (e) {} return { 3: { ars: 3000, usd: 3 }, 7: { ars: 5000, usd: 5 }, 30: { ars: 9000, usd: 9 } }; };

async function estado(cod) {
  const f = await leer(DIR + cod + '.json'); if (!f) return null;
  const ahora = Date.now();
  if (f.metodo === 'mp' && f.mpSus && process.env.MP_ACCESS_TOKEN && (!f.mpCheck || ahora - Date.parse(f.mpCheck) > 6 * 3600e3)) {
    try {
      const pre = await mp('GET', '/preapproval/' + encodeURIComponent(f.mpSus));
      f.mpEstado = pre.status; f.mpCheck = new Date().toISOString();
      if (pre.status === 'authorized') { const prox = Date.parse(pre.next_payment_date || '') || (ahora + 31 * 864e5); f.hasta = new Date(Math.max(prox + 3 * 864e5, Date.parse(f.hasta || 0) || 0)).toISOString(); }
      await guardar(DIR + cod + '.json', f);
    } catch (e) { console.error('mundial mp', e.status || '', e.message); }
  }
  if (f.producto === 'guia' && f.metodo === 'mp' && !f.hasta && process.env.MP_ACCESS_TOKEN && (!f.mpCheck || ahora - Date.parse(f.mpCheck) > 60e3)) {
    try {
      const L = await mp('GET', '/v1/payments/search?external_reference=' + encodeURIComponent('guia:' + cod) + '&sort=date_created&criteria=desc');
      const ok = ((L && L.results) || []).find(p => p.status === 'approved');
      f.mpCheck = new Date().toISOString();
      if (ok) { f.hasta = new Date((Date.parse(ok.date_approved || '') || ahora) + (Number(f.dias) || 3) * 864e5).toISOString(); f.mpPago = ok.id; }
      await guardar(DIR + cod + '.json', f);
    } catch (e) { console.error('guia mp', e.status || '', e.message); }
  }
  const activo = !!f.hasta && Date.parse(f.hasta) > ahora;
  return { f, r: { activo, hasta: f.hasta || null, metodo: f.metodo, producto: f.producto || 'mundial', dias: f.dias || null, estado: activo ? 'activa' : (f.hasta ? 'vencida' : 'pendiente') } };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  try {
    if (req.method === 'GET' && q.admin) {
      if (!esAdmin(q.admin)) return res.status(403).json({ error: 'Clave incorrecta.' });
      const L = (await listar()).filter(x => /\.json$/.test(x.name)).slice(0, 300);
      const subs = (await Promise.all(L.map(x => leer(DIR + x.name)))).filter(Boolean);
      return res.status(200).json({ subs: subs.map(f => ({ producto: f.producto || 'mundial', dias: f.dias || null, codigo: f.codigo, nombre: f.nombre || '', metodo: f.metodo, email: f.email || '', creado: f.creado, hasta: f.hasta || null, mpEstado: f.mpEstado || '' })) });
    }
    if (req.method === 'GET' && q.dolar) { // cotizaciones del dólar en Argentina (fuente pública: DolarApi.com)
      try {
        const r = await fetch('https://dolarapi.com/v1/dolares', { headers: { accept: 'application/json' } });
        if (!r.ok) throw new Error('fuente ' + r.status);
        const L = (await r.json()).filter(x => x && x.casa).map(x => ({ casa: String(x.casa), nombre: String(x.nombre || x.casa), compra: Number(x.compra) || null, venta: Number(x.venta) || null, fecha: x.fechaActualizacion || null }));
        res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
        return res.status(200).json({ dolares: L, fuente: 'DolarApi.com' });
      } catch (e) { return res.status(502).json({ error: 'No pude traer el dólar ahora.' }); }
    }
    if (req.method === 'GET' && q.pases) return res.status(200).json({ pases: PASES(), datos: DATOS_PAGO });
    if (req.method === 'GET') {
      const cod = String(q.codigo || '').toUpperCase(); if (!okCod(cod)) return res.status(400).json({ error: 'Código inválido.' });
      const e = await estado(cod); if (!e) return res.status(404).json({ error: 'No encontramos ese código.' });
      return res.status(200).json(Object.assign({ nombre: e.f.nombre || '' }, e.r));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido.' });
    const b = cuerpo(req);
    if (q.accion === 'suscribir') {
      const metodo = METODOS.includes(b.metodo) ? b.metodo : null; if (!metodo) return res.status(400).json({ error: 'Elige una forma de pago.' });
      const email = String(b.email || '').trim().toLowerCase().slice(0, 120), nombre = String(b.nombre || '').trim().slice(0, 60);
      if (!nombre) return res.status(400).json({ error: 'Escribe tu nombre de usuario.' });
      const guia = b.producto === 'guia', dias = guia ? (PASES()[String(b.dias)] ? Number(b.dias) : 0) : 0;
      if (guia && !dias) return res.status(400).json({ error: 'Elige un pase.' });
      const codigo = nuevoCod(), f = { codigo, metodo, email, nombre, creado: new Date().toISOString() };
      if (guia) { f.producto = 'guia'; f.dias = dias; }
      if (guia && metodo === 'mp') {
        if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ error: 'Mercado Pago todavía no está configurado.' });
        const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host), vuelta = origin + '/guia?pagado=1&codigo=' + codigo;
        try {
          const pref = await mp('POST', '/checkout/preferences', { items: [{ title: `ShopGuía · pase de ${dias} días`, quantity: 1, unit_price: PASES()[dias].ars, currency_id: 'ARS' }], external_reference: 'guia:' + codigo, back_urls: { success: vuelta, pending: vuelta, failure: origin + '/guia' }, auto_return: 'approved' });
          await guardar(DIR + codigo + '.json', f);
          return res.status(200).json({ codigo, url: pref.init_point });
        } catch (e) { console.error('guia pase', e.status || '', e.message); return res.status(502).json({ error: 'No se pudo conectar con Mercado Pago. Prueba en un rato.' }); }
      }
      if (metodo === 'mp') {
        if (!process.env.MP_ACCESS_TOKEN) return res.status(503).json({ error: 'Mercado Pago todavía no está configurado.' });
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Escribe el mail de tu cuenta de Mercado Pago.' });
        const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
        try {
          const pre = await mp('POST', '/preapproval', { reason: 'ShopRevista Mundial · suscripción mensual', external_reference: 'mundial:' + codigo, payer_email: email, back_url: origin + '/mundial?pagado=1&codigo=' + codigo, status: 'pending',
            auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: PRECIO_ARS(), currency_id: 'ARS' } });
          f.mpSus = pre.id; await guardar(DIR + codigo + '.json', f);
          return res.status(200).json({ codigo, url: pre.init_point });
        } catch (e) {
          console.error('mundial suscribir', e.status || '', e.message, e.body ? JSON.stringify(e.body).slice(0, 300) : '');
          return res.status(502).json({ error: e.status === 400 || e.status === 422 ? 'Mercado Pago rechazó el pedido: revisa que el mail sea el de tu cuenta de Mercado Pago.' : 'No se pudo conectar con Mercado Pago. Prueba en un rato.' });
        }
      }
      await guardar(DIR + codigo + '.json', f);
      return res.status(200).json({ codigo });
    }
    if (q.accion === 'activar') {
      if (!esAdmin(b.admin)) return res.status(403).json({ error: 'Clave incorrecta.' });
      const cod = String(b.codigo || '').toUpperCase(); if (!okCod(cod)) return res.status(400).json({ error: 'Código inválido.' });
      const f = await leer(DIR + cod + '.json'); if (!f) return res.status(404).json({ error: 'No encontramos ese código.' });
      const meses = Math.max(1, Math.min(24, Number(b.meses) || 1)), dias = Math.max(0, Math.min(400, Number(b.dias) || 0)), desde = Math.max(Date.now(), Date.parse(f.hasta || 0) || 0);
      f.hasta = new Date(desde + (dias ? dias * 864e5 : meses * 30.5 * 864e5)).toISOString(); f.activadoPor = 'admin'; f.activado = new Date().toISOString();
      await guardar(DIR + cod + '.json', f);
      return res.status(200).json({ ok: true, hasta: f.hasta });
    }
    return res.status(400).json({ error: 'Acción desconocida.' });
  } catch (e) { console.error('mundial', e); return res.status(500).json({ error: 'Error interno.' }); }
};
