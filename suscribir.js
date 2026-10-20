// Vitrina 360 · crea la suscripción mensual en Mercado Pago y devuelve el link para pagar.
const { cuerpo, usuario, db, mp, PLANES } = require('./_comun');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.MP_ACCESS_TOKEN || !process.env.SUPABASE_SERVICE_KEY) return res.status(503).json({ error: 'El cobro todavía no está configurado.' });
  try {
    const u = await usuario(req);
    if (!u) return res.status(401).json({ error: 'Tenés que entrar a tu tienda.' });
    const b = cuerpo(req), P = PLANES(), plan = P[b.plan] ? b.plan : 'emprendedora';
    const email = String(b.email || u.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Revisá el mail de Mercado Pago.' });
    const rows = await db('GET', '/rest/v1/tiendas?owner=eq.' + u.id + '&select=slug,mp_suscripcion,mp_anterior,pagada_hasta');
    if (!rows || !rows[0]) return res.status(404).json({ error: 'Primero creá tu tienda.' });
    const origin = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host);
    const pre = await mp('POST', '/preapproval', {
      reason: 'Vitrina 360 · Plan ' + P[plan].nombre,
      external_reference: u.id,
      payer_email: email,
      back_url: origin + '/panel',
      status: 'pending',
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: P[plan].precio, currency_id: 'ARS' }
    });
    // Si ya pagaba otro plan, la suscripción vieja se da de baja recién cuando la nueva queda autorizada.
    const prev = rows[0].mp_suscripcion, pagaba = rows[0].pagada_hasta && Date.parse(rows[0].pagada_hasta) > Date.now();
    await db('PATCH', '/rest/v1/tiendas?owner=eq.' + u.id, { mp_suscripcion: pre.id, mp_plan: plan, mp_anterior: prev && pagaba ? prev : (rows[0].mp_anterior || null) });
    return res.status(200).json({ url: pre.init_point });
  } catch (e) {
    const msg = e.status === 400 || e.status === 422 ? 'Mercado Pago rechazó el pedido. Revisá que el mail sea el de tu cuenta de Mercado Pago.' : 'No se pudo conectar con Mercado Pago. Probá en un rato.';
    return res.status(502).json({ error: msg });
  }
};
